import { afterAll } from "vitest";
import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());
const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld(profiles.create);

afterEach(cleanup);


describe("original claim at failure terminalization", () => {
  it("cannot borrow a replacement worker claim after awaiting diagnostic capture", async () => {
    const h = await executorHarness();
    const { database, clock } = h.authority;
    const invalid = RunRecordSchema.parse(personLookupQueuedRun());
    const claimed = enqueueAndClaim(database, { ...invalid, input: {
      ...invalid.input, parsed: { protectedBindings: [], schemaHash: "a".repeat(64), value: {} },
    } }, clock.now().toISOString());
    const lifecycle = h.deps.lifecycle;
    const deps: RunExecutorDependencies = { ...h.deps, diagnostics: {
      captureForFailure: async (context) => {
        const current = database.authority.runs.get(RUN_ID);
        assert.ok(current);
        assert.equal(lifecycle.requeue({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: RUN_ID,
          expectedVersion: current.version, claim: claimed.claim, cause: "recovery" }).state, "applied");
        const { workerId, workerLifetime } = testAdmittedWorker(database, clock, { path: h.authority.path,
          workflow: WORKFLOW_ID, poolIndex: 2, browserSystems: ["ucpath", "crm"] });
        const replacement = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, workerLifetime,
          now: clock.now().toISOString() });
        assert.equal(replacement.state, "claimed");
        return DiagnosticBundleSchema.parse({ bundleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          runId: RUN_ID, origin: { kind: "failure", failureId: context.failure.failureId },
          createdAt: clock.now().toISOString(), contentDigest: "a".repeat(64),
          configFingerprint: context.configFingerprint, descriptorFingerprint: context.descriptorFingerprint,
          redaction: { fields: [], warnings: [] }, attachments: [],
          retention: { kind: "pinned", reason: "write-recovery" },
        });
      },
      persist: () => { throw new Error("lost claimant must never persist the prepared bundle"); },
      discard: () => {},
    } };
    const result = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(result.state, "abandoned");
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "claimed");
    assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
    assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run").length, 0);
  });
});
