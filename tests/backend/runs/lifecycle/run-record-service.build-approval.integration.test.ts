import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, vi } from "vitest";
import { z } from "zod";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { WORKFLOW_KIT_VERSION, workflowContractFingerprint } from "../../../../src/workflow-kit/fingerprints.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";

const build = vi.hoisted(() => ({ id: "c".repeat(64) }));
vi.mock("../../../../src/backend/runtime/build-id.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../src/backend/runtime/build-id.js")>(),
  currentBuildId: () => build.id,
}));

const BUILD_X = "c".repeat(64);
const BUILD_Y = "d".repeat(64);
const PUBLICATION = { title: "Retry", actorId: "local-operator" };
const { fixture, created, cleanup } = createRunRecordServiceTestWorld();
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  build.id = BUILD_X;
  for (const close of cleanups.splice(0).reverse()) await close();
  await cleanup();
});

const shape = z.object({ n: z.string() });
const printed = { id: "drift", version: 1, input: shape, canonicalInput: shape, result: shape, graph: [{ id: "n", kind: "step", dependsOn: [] }], contracts: [] };

describe("read-only admission across builds", () => {
  it("retries a read under a later build without restarting from scratch", async () => {
    build.id = BUILD_X;
    const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, [2]));
    cleanups.push(h.dispose);
    const queued = h.start(h.proposal());
    assert.equal(queued.envelope.buildId, BUILD_X);
    assert.equal((await h.execute(queued)).state, "failed");
    const source = h.fresh(queued);
    build.id = BUILD_Y;
    const retried = h.lifecycle.retry({
      commandId: randomUUID(), runId: source.envelope.runId, expectedVersion: source.version,
      runtimeConfig: selectRunRuntime(h.database.authority),
    }, h.descriptor, PUBLICATION);
    assert.equal(retried.state, "applied");
    if (retried.state !== "applied") throw new Error("retry refused");
    assert.equal(retried.run.envelope.buildId, BUILD_Y);
    assert.equal(retried.run.envelope.recovery, undefined);
    assert.equal(retried.run.envelope.continuation, undefined);
    assert.equal((await h.execute(retried.run)).state, "done");
  });

  it("recovers a failed read under a later build and keeps the source checkpoint", async () => {
    build.id = BUILD_X;
    const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, [2]));
    cleanups.push(h.dispose);
    const queued = h.start(h.proposal());
    assert.equal((await h.execute(queued)).state, "failed");
    const source = h.fresh(queued);
    const checkpoint = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId)[0];
    assert.ok(checkpoint);
    const frozen = canonicalJsonStringify(checkpoint);
    build.id = BUILD_Y;
    const applied = h.kernel.execute({
      commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
      source: "dashboard", family: "run", type: "recover-run",
      target: { runId: source.envelope.runId, expectedVersion: source.version },
    });
    assert.equal(applied.state, "applied");
    if (applied.state !== "applied") throw new Error("recover refused");
    const target = applied.affectedTargets[0];
    assert.ok(target?.family === "run");
    const next = h.database.authority.runs.get(target.runId);
    assert.ok(next);
    assert.equal(next.envelope.buildId, BUILD_X);
    assert.equal(next.envelope.recovery, undefined);
    assert.ok(next.envelope.continuation);
    assert.equal((await h.execute(next)).state, "done");
    assert.equal(canonicalJsonStringify(h.fresh(source)), canonicalJsonStringify(source));
    assert.equal(canonicalJsonStringify(h.database.authority.runCheckpoints.get(
      checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration,
    )), frozen);
  });

  it("refuses descriptor version, schema, and kit drift at retry", async () => {
    build.id = BUILD_X;
    const { service, request, runtimeConfig, clock } = await fixture();
    const cancelledSource = (overrides: Readonly<{ descriptorVersion?: number; contractFingerprint?: string }>) => {
      const source = created(service, { ...request, commandId: randomUUID(), descriptorVersion: personLookupDescriptor.version,
        contractFingerprint: personLookupDescriptor.contractFingerprint, ...overrides });
      const cancelled = service.transition({
        commandId: randomUUID(), runId: source.envelope.runId, expectedVersion: source.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
      });
      if (cancelled.state !== "applied") throw new Error("cancel refused");
      return cancelled.run;
    };
    const retry = (source: Readonly<{ envelope: { runId: string }; version: number }>) => service.retry({
      commandId: randomUUID(), runId: source.envelope.runId, expectedVersion: source.version, runtimeConfig,
    }, personLookupDescriptor, PUBLICATION);
    const kitDrift = workflowContractFingerprint({ ...printed, kit: WORKFLOW_KIT_VERSION + 1 });
    const schemaDrift = workflowContractFingerprint({ ...printed, result: z.object({ n: z.number() }) });
    assert.notEqual(kitDrift, workflowContractFingerprint(printed));
    assert.notEqual(schemaDrift, workflowContractFingerprint(printed));
    for (const drift of [{ descriptorVersion: personLookupDescriptor.version + 1 }, { contractFingerprint: schemaDrift }, { contractFingerprint: kitDrift }]) {
      const source = cancelledSource(drift);
      assert.deepEqual(retry(source), { state: "refused", refusal: { reason: "schema-mismatch", digest: source.envelope.contractFingerprint } });
    }
    const source = cancelledSource({});
    build.id = BUILD_Y;
    const next = retry(source);
    assert.equal(next.state, "applied");
    if (next.state !== "applied") throw new Error("same-contract retry refused");
    assert.equal(next.run.envelope.buildId, BUILD_Y);
    assert.equal(next.run.envelope.recovery, undefined);
    assert.equal(next.run.envelope.continuation, undefined);
  });
});
