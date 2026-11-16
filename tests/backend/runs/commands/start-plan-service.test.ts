import assert from "node:assert/strict";
import { it } from "vitest";
import { createStartPlanService, type StartPlanServiceDeps } from "../../../../src/backend/runs/commands/start-plan-service.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { omissionAssertingDescriptor } from "../../../support/fixtures/start-step-omission-fixtures.js";

function harness(held: boolean, lateHold = false, descriptor: AnyWorkflowDescriptor = omissionAssertingDescriptor) {
  const effects = { transactions: 0, secrets: 0, preflight: 0, identity: 0 };
  const ids = sequentialIdFactory();
  const admission = (): ReturnType<AuthorityRepositories["runs"]["admission"]> => held
    ? { state: "draining", commandId: "held-command", hold: "update" } : { state: "open" };
  // Only admission may be read when the transaction discovers a late hold.
  const repositories = new Proxy({} as AuthorityRepositories, { get(_target, key) {
    if (key === "runs") return { admission };
    effects.identity += 1;
    throw new Error("identity-reached");
  } });
  const deps: StartPlanServiceDeps = {
    authorityRead: { authority: { runs: { admission, listByItem: () => [] } } },
    authority: { withAuthorityTransaction(work) {
      effects.transactions += 1;
      if (lateHold) held = true;
      return work(repositories);
    } },
    protectedSecrets: { read() { effects.secrets += 1; throw new Error("secret-reached"); } },
    preflight: {
      async prepare() { effects.preflight += 1; throw new Error("preflight-reached"); },
      assertReady() { effects.preflight += 1; },
      read() { throw new Error("preflight-read-reached"); },
    },
    descriptors: { resolve: () => descriptor },
    clock: manualClock(new Date(NOW)), ids, planTtlMs: 60_000,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
    plannedBy: "local-operator",
  };
  const { preflight: _preflight, ...withoutPreflight } = deps;
  return { service: createStartPlanService(deps), plain: createStartPlanService(withoutPreflight), effects, ids };
}
const request = { workflowId: omissionAssertingDescriptor.id, submissions: [{ eid: "10873698" }], dryRun: false };
const refused = (error: unknown) => error instanceof RerunRefusedError && error.code === "invalid-state";

it("refuses held planning and preparation before transactions, secrets, preflight or identities", async () => {
  const h = harness(true);
  assert.throws(() => h.service.plan(request), refused);
  await assert.rejects(h.service.prepare?.(request, new AbortController().signal) ?? assert.fail("prepare missing"), refused);
  assert.deepEqual(h.effects, { transactions: 0, secrets: 0, preflight: 0, identity: 0 });
  assert.deepEqual(h.ids.minted(), []);
});
it("rejects invalid ingress without opening an authority transaction", () => {
  const h = harness(false);
  assert.throws(() => h.plain.plan({ ...request, dryRun: "invalid" }));
  assert.equal(h.effects.transactions, 0);
  assert.deepEqual(h.ids.minted(), []);
});
it("rechecks a late hold before identity or storage in the sole plan transaction", () => {
  const h = harness(false, true);
  assert.throws(() => h.plain.plan(request), refused);
  assert.deepEqual(h.effects, { transactions: 1, secrets: 0, preflight: 0, identity: 0 });
  assert.ok(h.ids.minted().length > 0, "the read-only plan was built before the late hold");
});
it("reuses the existing preflight scope transaction and checks admission before identity", async () => {
  const h = harness(false, true);
  await assert.rejects(h.service.prepare?.(request, new AbortController().signal) ?? assert.fail("prepare missing"), refused);
  assert.deepEqual(h.effects, { transactions: 1, secrets: 0, preflight: 0, identity: 0 });
  assert.deepEqual(h.ids.minted(), []);
});

it("blocks the real protected input source while held and reaches it when admission is open", () => {
  const input = { workflowId: separationsDescriptor.id, submissions: [{ documentNumber: "4502" }], dryRun: true };
  const held = harness(true, false, separationsDescriptor);
  assert.throws(() => held.plain.plan(input), refused);
  assert.deepEqual(held.effects, { transactions: 0, secrets: 0, preflight: 0, identity: 0 });
  assert.deepEqual(held.ids.minted(), []);
  const open = harness(false, false, separationsDescriptor);
  assert.throws(() => open.plain.plan(input), /^SecretSourceError: admitted profile identity is unreadable$/u);
  assert.deepEqual(open.effects, { transactions: 0, secrets: 1, preflight: 0, identity: 0 });
  assert.deepEqual(open.ids.minted(), []);
});
