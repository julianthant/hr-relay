import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { predecessorEvidenceSchemaHash } from "../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js";
import { JsonValueSchema, type JsonValue } from "../../../../src/rules/validation/canonical-json.js";
import { simulatePreviousSeparationsInputGeneration } from "./retired-separations-run.js";

function merge(example: JsonValue, value: JsonValue): JsonValue {
  if (example === null || value === null || typeof example !== "object" || typeof value !== "object" || Array.isArray(example) || Array.isArray(value)) return value;
  const result: Record<string, JsonValue> = Object.fromEntries(Object.entries(example));
  for (const [key, child] of Object.entries(value)) result[key] = result[key] === undefined ? child : merge(result[key], child);
  return result;
}

/** A closed profile store whose Separations run was stored by the profile-name-domain build (input generation 1, no stored initials) with its committed Kuali write, plus predecessor credentials. */
export async function predecessorSeparationsRerun(options: Readonly<{ predecessorCredentials?: boolean; keepOpen?: boolean }> = {}) {
  const __p0 = performance.now(); const prof = (label: string) => process.stderr.write(`[prof] ${label} ${Math.round(performance.now() - __p0)}ms\n`);
  vi.resetModules();
  vi.doMock("../../../../src/models/validation/schema-bound-value.js", async importOriginal => {
    const current = await importOriginal<typeof import("../../../../src/models/validation/schema-bound-value.js")>();
    const { FingerprintSchema } = await import("../../../../src/rules/identity/ids.js");
    const memo = new WeakMap<object, Map<string, ReturnType<typeof FingerprintSchema.parse>>>(); let hashMs = 0, hashes = 0; Reflect.set(globalThis, "__hashStats", () => `${hashes} hashes ${Math.round(hashMs)}ms`);
    return { ...current, deriveSchemaHash: (schema: Parameters<typeof current.deriveSchemaHash>[0], io: "input" | "output") => {
      const s0 = performance.now(); try { const byIo = memo.get(schema) ?? new Map<string, ReturnType<typeof FingerprintSchema.parse>>(); memo.set(schema, byIo);
        const hit = byIo.get(io); if (hit !== undefined) return hit; const hash = FingerprintSchema.parse(predecessorEvidenceSchemaHash(schema, io)); byIo.set(io, hash); hashes++; return hash; } finally { hashMs += performance.now() - s0; } } };
  });
  // The receipt is derived by the build that stored the run: the profile-name-domain build, whose Separations input had no stored initials.
  const restoreBuild = simulatePreviousSeparationsInputGeneration();
  const { compositionHarness, compositionQueuedRun, compositionClaimRunning, compositionContext, COMPOSITION_SCOPE_OUTPUTS,
    COMPOSITION_TIMEKEEPER, FINALIZE_NODE } = await import("../separations-composition-fixtures.js");
  prof("fixture:reset");
  await import("../../../../src/models/validation/schema-bound-value.js"); prof("fixture:schema-bound-value");
  await import("../registered-workflows.js"); prof("fixture:registered-workflows " + String(Reflect.apply(Reflect.get(globalThis, "__hashStats") ?? (() => "no-hash"), undefined, [])));
  prof("fixture:reset+imports");
  const h = await compositionHarness();
  prof("fixture:harness");
  try {
    const { FINALIZATION_SCOPE_OUTPUTS } = await import("../kuali-finalization-fixtures.js");
    const { RunRecordSchema } = await import("../../../../src/models/run/record.js");
    const { RunCheckpointRecordSchema } = await import("../../../../src/models/workflow/checkpoint.js");
    const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
    const { descriptorRuntimeNodes } = await import("../../../../src/workflow-kit/workflow.js");
    const { evidenceLeaves } = await import("../../../../src/models/trust/evidence-classification.js");
    const { separationsDescriptor: descriptor } = await import("../registered-workflows.js");
    const { testRunLifecycle } = await import("../../fixtures/run-lifecycle-fixtures.js");
    const { requireLifecycleApplied } = await import("../../../../src/backend/runs/lifecycle/run-record-service.js");
    const { buildNodeFailureRecord } = await import("../../../../src/backend/runtime/execution/run-failure.js");
    const { buildTerminalAuthorization } = await import("../../../../src/backend/runs/lifecycle/terminal-authorization.js");
    const { NodeIdSchema } = await import("../../../../src/rules/identity/ids.js");
    const { preInitialsSeparationsRun, preInitialsExecutionInput, preInitialsSignedComment } = await import("../../fixtures/storage/pre-initials-separations.js");
    prof("fixture:imports2");
    const valueId = randomUUID(), raw = preInitialsSeparationsRun(RunRecordSchema.parse(compositionQueuedRun()), "name-domain");
    const queued = { ...raw, input: { ...raw.input, parsed: { ...raw.input.parsed,
      protectedBindings: [{ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId }] } } };
    const { run, claim } = compositionClaimRunning(h.database, h.clock, queued, FINALIZE_NODE);
    const { createTimelineEmitter } = await import("../../../../src/backend/storage/events/timeline-emitter.js");
    const { runQueuedSpanEvent } = await import("../../../../src/backend/runs/commands/run-queued-span.js");
    const { LOCAL_OPERATOR_ACTOR_ID } = await import("../../../../src/rules/identity/ids.js");
    createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock }).emit(runQueuedSpanEvent({ run,
      actorId: LOCAL_OPERATOR_ACTOR_ID, title: descriptor.label }));
    const context = compositionContext(run, claim, FINALIZE_NODE), nodes = descriptorRuntimeNodes(descriptor), outputs: Record<string, JsonValue> = {};
    for (const id of context.node.dependsOn) {
      const node = nodes.find(node => node.id === id); assert.ok(node?.kind === "task");
      const override: unknown = id === "approval" ? { ...COMPOSITION_SCOPE_OUTPUTS.approval, jobs: FINALIZATION_SCOPE_OUTPUTS.approval.jobs }
        : id === "dates" ? { ...COMPOSITION_SCOPE_OUTPUTS.dates, dateChangeComments: preInitialsSignedComment(COMPOSITION_SCOPE_OUTPUTS.dates.dateChangeComments) } : Reflect.get(COMPOSITION_SCOPE_OUTPUTS, id);
      const value = JsonValueSchema.parse(node.uses.output.parse(merge(JsonValueSchema.parse(node.uses.example), JsonValueSchema.parse(override))));
      outputs[id] = value;
      h.database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ workflowId: descriptor.id, runId: run.envelope.runId,
        itemId: run.envelope.itemId, nodeId: id, attempt: run.envelope.attempt, claimGeneration: run.claimGeneration,
        descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, implFingerprint: "c".repeat(64),
        output: { schemaHash: deriveSchemaHash(node.uses.output, "output"), value }, writtenAt: h.clock.now().toISOString(),
        provenance: evidenceLeaves(value).map(({ path }) => ({ path, source: "live", observedAt: h.clock.now().toISOString(), originalObservedAt: h.clock.now().toISOString() })) }));
    }
    prof("fixture:checkpoints");
    const outcome = await h.bound(() => h.sequencer.executeTransaction({ ...context,
      scope: { input: preInitialsExecutionInput(run), protectedInputBindings: run.input.parsed.protectedBindings, outputs } }));
    assert.equal(Reflect.get(Object(outcome), "disposition"), "committed");
    prof("fixture:transaction");
    const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    const failure = buildNodeFailureRecord({ writes: [], run: current, failureId: randomUUID(), nodeId: NodeIdSchema.parse(FINALIZE_NODE), taskId: context.node.commit.uses.id,
      error: new Error("synthetic post-completion diagnostic failure"), occurredAt: h.clock.now().toISOString() });
    const authorization = buildTerminalAuthorization({ run: current, authorizedAt: h.clock.now().toISOString(), consequence: { kind: "failed", failure } });
    assert.equal(authorization.kind, "failed");
    const terminal = requireLifecycleApplied(testRunLifecycle(h.database, h.clock).terminalize({ commandId: randomUUID(), kind: "failure", terminal: { authorization, failure } }, descriptor));
    const checkpoints = h.database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId), writes = h.database.authority.writeIntents.listByRun(run.envelope.runId);
    const result = h.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
    const { createReceiptService } = await import("../../../../src/backend/runs/trust/receipt-service.js");
    const { testRunService } = await import("../../fixtures/run-lifecycle-fixtures.js");
    const receipt = createReceiptService({ database: h.database, runReader: testRunService(h.database, h.clock), descriptors: [descriptor] }).ensureReceipt(run.envelope.runId);
    prof("fixture:terminal+receipt");
    const { captureProfileCredentialFixture, installPredecessorProfileCredentials } = await import("../predecessor-profile-credentials.js");
    const credential = captureProfileCredentialFixture(h.profile.admission), paths = { workspace: h.profile.workspace, stateRoot: h.profile.stateRoot,
      profileId: h.profile.admission.profileBinding.profileId, path: h.path };
    if (!options.keepOpen) await h.closeController(); if (!options.keepOpen && options.predecessorCredentials !== false) installPredecessorProfileCredentials(credential, COMPOSITION_TIMEKEEPER, valueId);
    prof("fixture:close+credentials"); prof(String(Reflect.apply(Reflect.get(globalThis, "__hashStats") ?? (() => "no-hash"), undefined, [])));
    return { ...paths, database: h.database, clock: h.clock, run: terminal, result, checkpoints, writes, receipt, valueId, cleanup: h.dispose };
  } catch (error) { await h.dispose(); throw error; }
  finally { restoreBuild(); vi.doUnmock("../../../../src/models/validation/schema-bound-value.js"); vi.resetModules(); }
}
