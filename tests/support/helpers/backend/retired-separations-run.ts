import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { z } from "zod";
import { JsonValueSchema, type JsonValue } from "../../../../src/rules/validation/canonical-json.js";

function merge(example: JsonValue, value: JsonValue): JsonValue {
  if (example === null || value === null || typeof example !== "object" || typeof value !== "object" || Array.isArray(example) || Array.isArray(value)) return value;
  const result: Record<string, JsonValue> = Object.fromEntries(Object.entries(example));
  for (const [key, child] of Object.entries(value)) result[key] = result[key] === undefined ? child : merge(result[key], child);
  return result;
}

const CANONICAL_INPUT = "../../../../src/models/workflow/canonical-input.js";

const withoutInitials = (schema: z.ZodType): z.ZodType => schema instanceof z.ZodObject && "timekeeperInitials" in schema.shape
  ? schema.omit({ timekeeperInitials: true }) : schema;

/** Rebuild the module graph as the previous build, whose Separations input had no stored Timekeeper initials: its canonical hash is the pre-initials one and its predecessor the profile-name-domain one. Returns the restore. */
export function simulatePreviousSeparationsInputGeneration(): () => void {
  vi.resetModules();
  vi.doMock(CANONICAL_INPUT, async importOriginal => {
    const original = await importOriginal<typeof import("../../../../src/models/workflow/canonical-input.js")>();
    const defineCanonicalInput = (input: z.ZodType, canonical: z.ZodType, samples: readonly [unknown, ...unknown[]]): z.ZodType => {
      const [first, ...rest] = samples.map(sample => {
        if (sample === null || typeof sample !== "object" || !("timekeeperInitials" in sample)) return sample;
        const { timekeeperInitials: _initials, ...earlier } = z.record(z.string(), z.unknown()).parse(sample);
        return earlier;
      });
      return original.defineCanonicalInput(withoutInitials(input), withoutInitials(canonical), [first, ...rest]);
    };
    return { ...original, defineCanonicalInput };
  });
  return () => { vi.doUnmock(CANONICAL_INPUT); vi.resetModules(); };
}

/** A closed profile store holding a terminal Separations run with a committed Kuali write, stored as the last pre-initials build wrote it, receipt included (the whole fixture is built under that build's input schema): the run input carries the pre-initials hashes and no initials, while the write executed with the letters that build derived from the name. */
export async function retiredSeparationsRun() {
  const restoreBuild = simulatePreviousSeparationsInputGeneration();
  const { compositionHarness, compositionQueuedRun, compositionClaimRunning, compositionContext, COMPOSITION_SCOPE_OUTPUTS,
    FINALIZE_NODE } = await import("../separations-composition-fixtures.js");
  const h = await compositionHarness();
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
    const { buildFailureTerminalAuthorization } = await import("../../../../src/backend/runs/lifecycle/terminal-authorization.js");
    const { NodeIdSchema } = await import("../../../../src/rules/identity/ids.js");
    const { preInitialsSeparationsRun, preInitialsExecutionInput, preInitialsSignedComment } = await import("../../fixtures/storage/pre-initials-separations.js");
    const queued = preInitialsSeparationsRun(RunRecordSchema.parse(compositionQueuedRun()), "pre-initials");
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
    const outcome = await h.bound(() => h.sequencer.executeTransaction({ ...context,
      scope: { input: preInitialsExecutionInput(run), protectedInputBindings: run.input.parsed.protectedBindings, outputs } }));
    assert.equal(Reflect.get(Object(outcome), "disposition"), "committed");
    const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    const failure = buildNodeFailureRecord({ writes: [], run: current, failureId: randomUUID(), nodeId: NodeIdSchema.parse(FINALIZE_NODE), taskId: context.node.commit.uses.id,
      error: new Error("synthetic post-completion diagnostic failure"), occurredAt: h.clock.now().toISOString() });
    const authorization = buildFailureTerminalAuthorization({ run: current, authorizedAt: h.clock.now().toISOString(), consequence: { kind: "failed", failure } });
    const terminal = requireLifecycleApplied(testRunLifecycle(h.database, h.clock).terminalize({ commandId: randomUUID(), kind: "failure", terminal: { authorization, failure } }, descriptor));
    const checkpoints = h.database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId), writes = h.database.authority.writeIntents.listByRun(run.envelope.runId);
    const result = h.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
    const { createReceiptService } = await import("../../../../src/backend/runs/trust/receipt-service.js");
    const { testRunService } = await import("../../fixtures/run-lifecycle-fixtures.js");
    const receipt = createReceiptService({ database: h.database, runReader: testRunService(h.database, h.clock), descriptors: [descriptor] }).ensureReceipt(run.envelope.runId);
    const paths = { workspace: h.profile.workspace, stateRoot: h.profile.stateRoot, profileId: h.profile.admission.profileBinding.profileId, path: h.path };
    await h.closeController();
    return { ...paths, run: terminal, result, checkpoints, writes, receipt, cleanup: h.dispose };
  } catch (error) { await h.dispose(); throw error; }
  finally { restoreBuild(); }
}
