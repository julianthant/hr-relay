import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { appendLogPage } from "../../../../src/dashboard/surfaces/run-detail/logs-model.js";
import { OperationActionObservationWireSchema } from "../../../../src/models/dashboard/operation-structure.js";
import { NotePageSchema } from "../../../../src/models/dashboard/run-detail.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../../src/models/workflow/operation-display-snapshot.js";
import { plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";

const definition = freezeWorkflowOperationDisplaySnapshot({ display: plan1Leaf.descriptor.operationDisplay, workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint })!;
const runId = "00000000-0000-4000-8000-000000000001";
const observation = (sequence: number) => OperationActionObservationWireSchema.parse({
  logId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, at: "2026-09-29T12:00:00.000Z", action: "read", targetId: "consume-text",
  occurrence: { runId, definitionFingerprint: definition.definitionFingerprint, invocationId: "first-operation", occurrencePath: ["first"], nodeId: "first", taskId: "ocr/extract-form-page", logicalActionId: "consume-text", logicalSessionId: "plan1-local", attempt: 1, claimGeneration: 1, taskAttempt: 1, occurrence: sequence, state: "completed", value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } },
});

describe("shared operation structure model", () => {
  it("preserves exact confirmation bindings across pages and refuses duplicate publication identities", () => {
    const cursor = `lc:${"a".repeat(64)}:1`;
    const page = (sequence: number, next?: string) => NotePageSchema.parse({ runId, rows: [], notes: [],
      confirmedActions: [], confirmedActionBindings: [{ eventId: `stream/${sequence}`, logId: observation(1).logId,
        native: { eventId: observation(sequence).logId, order: sequence, runId, attempt: 1,
          traceId: "pl-100000-0001", spanPath: "confirmed/first", nodeId: "first" } }],
      nextCursor: next === undefined ? { state: "absent", reason: "end-of-page" } : { state: "present", value: next } });
    const first = page(1, cursor), second = page(2);
    assert.deepEqual(appendLogPage(first, cursor, second).confirmedActionBindings,
      [...(first.confirmedActionBindings ?? []), ...(second.confirmedActionBindings ?? [])]);
    assert.equal(appendLogPage(first, cursor, { ...second, confirmedActionBindings: undefined }).confirmedActionBindings, undefined);
    assert.throws(() => appendLogPage(first, cursor, { ...second, confirmedActionBindings: first.confirmedActionBindings }), /binding-duplicate/);
  });

  it("appends frozen observations with the exact ledger sequence and refuses a changed definition", () => {
    const page = (sequence: number, cursor?: string) => NotePageSchema.parse({ runId, rows: [], notes: [], operationStructure: { state: "observed", runId, definition, observations: [observation(sequence)] }, nextCursor: cursor === undefined ? { state: "absent", reason: "end-of-page" } : { state: "present", value: cursor } });
    const cursor = `lc:${"a".repeat(64)}:1`;
    const result = appendLogPage(page(1, cursor), cursor, page(2));
    assert.equal(result.operationStructure?.state, "observed");
    if (result.operationStructure?.state === "observed") assert.deepEqual(result.operationStructure.observations.map((item) => item.logId), [observation(1).logId, observation(2).logId]);
    assert.throws(() => appendLogPage(page(1, cursor), cursor, { ...page(2), operationStructure: { state: "legacy", reason: "old" } }), /frozen-definition-mismatch/u);
  });
});
