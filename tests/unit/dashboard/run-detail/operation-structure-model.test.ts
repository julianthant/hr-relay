import { exactOperationCaptures } from "../../../../src/dashboard/surfaces/run-captures-model.js";
import { RunCaptureArtifactWireSchema } from "../../../../src/domain/dashboard/run-detail.js";
import assert from "node:assert/strict";
import { ActionValueProducerSchema } from "../../../../src/domain/task-provenance.js";
import { describe, it } from "vitest";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../../src/domain/workflow/operation-display-snapshot.js";
import { OperationActionObservationWireSchema } from "../../../../src/domain/dashboard/operation-structure.js";
import { appendLogPage } from "../../../../src/dashboard/surfaces/run-detail/logs-model.js";
import { NotePageSchema } from "../../../../src/domain/dashboard/run-detail.js";
import { operationObservationKey, definitionMutedPresentation, presentationAddress, definitionActionAddress, definitionMutedActions, definitionValueSources, operationFieldTemplate, operationAddress, operationGroupBreakIds, observedOperationOutcome, operationAction, operationSourceIdentities, operationValueText } from "../../../../src/dashboard/surfaces/operation-structure-model.js";
import { plan1Parent, plan1Leaf } from "../../../fixtures/plan1-operation-workflows.js";

const definition = freezeWorkflowOperationDisplaySnapshot({ display: plan1Leaf.descriptor.operationDisplay, workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint })!;
const runId = "00000000-0000-4000-8000-000000000001";
const observation = (sequence: number) => OperationActionObservationWireSchema.parse({
  logId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, at: "2026-09-29T12:00:00.000Z", action: "read", targetId: "consume-text",
  occurrence: { runId, definitionFingerprint: definition.definitionFingerprint, invocationId: "first-operation", occurrencePath: ["first"], nodeId: "first", taskId: "ocr/extract-form-page", logicalActionId: "consume-text", logicalSessionId: "plan1-local", attempt: 1, claimGeneration: 1, taskAttempt: 1, occurrence: sequence, state: "completed", value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "same" } },
});

describe("shared operation structure model", () => {
  it("keeps nested verification readbacks in the containing form without splitting each confirmed field", () => {
    const nested = { ...definition, invocations: definition.invocations.map((invocation) => ({ ...invocation, operation: { ...invocation.operation, actions: [{ id: "form", kind: "open-page" as const, children: [{ id: "typed", kind: "fill-field" as const }, { id: "check", kind: "verify" as const, children: [{ id: "readback", kind: "read-field" as const }] }] }] } })) };
    const first = observation(1);
    const filled = { ...first, occurrence: { ...first.occurrence, logicalActionId: "typed" } };
    const readback = { ...first, occurrence: { ...first.occurrence, logicalActionId: "readback", occurrence: 2 } };
    assert.equal(operationObservationKey(nested, filled), operationObservationKey(nested, readback));
  });
  it("keeps definition addresses distinct across delimiter-shaped invocation/action ids", () => {
    assert.notEqual(definitionActionAddress("a-b", "c"), definitionActionAddress("a", "b-c"));
  });
  it("shows every declared producer and transform input without copying protected constants", () => {
    const invocation = definition.invocations[0];
    assert.deepEqual(definitionValueSources(definition, invocation, "text").map((item) => item.label), ["Run input · text"]);
    const parent = freezeWorkflowOperationDisplaySnapshot({ display: plan1Parent.descriptor.operationDisplay, workflowId: plan1Parent.descriptor.id, definitionFingerprint: plan1Parent.descriptor.contractFingerprint })!;
    assert.deepEqual(definitionValueSources(parent, parent.invocations[0], "text").map((item) => item.label), ["Transform child-summary · text", "Child left · disposition", "Child right · providerState", "Configuration · actor.label"]);
    const linked = { ...invocation, bindings: [{ slot: "text", value: { kind: "task-output" as const, entryId: "first", path: "disposition" } }] };
    const sources = definitionValueSources(definition, linked, "text");
    assert.equal(sources.length, 1);
    assert.equal(sources[0].invocationId, "first-operation");
    assert.equal(sources[0].actionId, "read-disposition");
    const constant = { ...invocation, bindings: [{ slot: "text", value: { kind: "constant" as const, valueDigest: "a".repeat(64) } }] };
    assert.equal(definitionValueSources(definition, constant, "text")[0].label, "Declared constant · value withheld");
    assert.deepEqual(definitionValueSources(definition, invocation, "missing"), []);
    const missing = { ...invocation, bindings: [{ slot: "text", value: { kind: "transformation" as const, transformId: "missing", path: "text" } }] };
    assert.throws(() => definitionValueSources(definition, missing, "text"), /transform-missing/u);
  });
  it("previews declared continuations, preserves shared targets, and stops after unknown forms", () => {
    const base = definition.invocations[0];
    const actions = [{ id: "read-form", kind: "open-page" as const, children: [{ id: "read", kind: "read-field" as const }], outcomes: [
      { id: "a", label: "A", when: { kind: "equals" as const, variable: "text", value: "a" }, continuation: "target-a" },
      { id: "b", label: "B", when: { kind: "equals" as const, variable: "text", value: "b" }, continuation: "target-b" },
      { id: "also-a", label: "Also A", when: { kind: "equals" as const, variable: "text", value: "other" }, continuation: "target-a" },
    ] }, { id: "target-a", kind: "open-page" as const, children: [{ id: "fill-a", kind: "fill-field" as const }] }, { id: "target-b", kind: "open-page" as const, children: [{ id: "fill-b", kind: "fill-field" as const }] }, { id: "shared", kind: "click" as const }];
    const invocation = { ...base, operation: { ...base.operation, actions } };
    const address = definitionActionAddress(base.id, "read-form");
    assert.deepEqual([...definitionMutedActions(invocation, { [address]: "a" })], ["target-b", "fill-b"]);
    assert.deepEqual([...definitionMutedActions(invocation, { [address]: "unknown" })], ["target-a", "fill-a", "target-b", "fill-b", "shared"]);
    assert.deepEqual([...definitionMutedActions(invocation, {})], []);
    assert.throws(() => definitionMutedActions(invocation, { [address]: "unrecognized" }), /unknown-outcome/u);
  });
  it("stops later presentation work on unknown task results without changing declarations", () => {
    const address = definitionActionAddress(definition.invocations[0].id, "consume-text");
    assert.deepEqual([...definitionMutedPresentation(definition, { [address]: "unknown" })], ["second-node"]);
    assert.deepEqual([...definitionMutedPresentation(definition, { [presentationAddress("first-node")]: "unknown" })], ["second-node"]);
    assert.deepEqual([...definitionMutedPresentation(definition, {})], []);
    assert.equal(definition.presentation.length, 2);
  });
  it("binds a fill to its exact declared template and fails loudly for a missing reference", () => {
    const invocation = definition.invocations[0];
    const template = { id: "comment", variables: [{ id: "text", slot: "text" }], segments: [{ kind: "literal" as const, value: "Exact: " }, { kind: "variable" as const, variable: "text" }], join: { separator: "", trim: "none" as const } };
    const action = { id: "fill-comment", kind: "fill-field" as const, templateId: template.id };
    assert.equal(operationFieldTemplate({ ...invocation, operation: { ...invocation.operation, templates: [template] } }, action), template);
    assert.equal(operationFieldTemplate(invocation, { ...action, templateId: undefined }), undefined);
    assert.throws(() => operationFieldTemplate(invocation, action), /template-missing/u);
  });
  it("admits anchors before the first log and empty streams without inventing row identities", () => {
    assert.deepEqual([...operationGroupBreakIds([{ logId: "first" }], [-1, 0, undefined])], ["first"]);
    assert.deepEqual([...operationGroupBreakIds([], [-1, undefined])], []);
    assert.throws(() => operationGroupBreakIds([], [0]), /anchor-outside-retained-sequence/u);
  });
  it("joins images only to their exact full retained action identity", () => {
    const { value: _value, ...identity } = observation(1).occurrence;
    const capture = RunCaptureArtifactWireSchema.parse({ artifact: { artifactId: runId, mediaKind: "image", mediaType: "image/png", byteLength: 68, sha256: "c".repeat(64), sensitivity: "safe", redaction: "not-required", width: 320, height: 240 }, origins: [{ bundleId: runId, originKind: "operator-request", operation: identity, capturedAt: "2026-09-29T12:00:01.000Z" }] });
    const item = { capture, downloadUrl: "/exact-artifact" };
    assert.deepEqual(exactOperationCaptures([item], observation(1).occurrence), [{ item, capturedAt: "2026-09-29T12:00:01.000Z" }]);
    assert.deepEqual(exactOperationCaptures([item], { ...identity, physicalSessionId: "00000000-0000-4000-8000-000000000099" }), []);
    assert.deepEqual(exactOperationCaptures([item], { ...identity, occurrence: 2 }), []);
    assert.deepEqual(exactOperationCaptures([{ ...item, capture: { ...capture, origins: [{ bundleId: runId, originKind: "operator-request" }] } }], identity), []);
    assert.throws(() => RunCaptureArtifactWireSchema.parse({ ...capture, origins: [{ ...capture.origins[0], capturedAt: undefined }] }), /capture instant/u);
  });
  it("addresses complete identities without conflating session, definition or path", () => {
    const { value: _value, ...identity } = observation(1).occurrence;
    const address = operationAddress(identity);
    assert.equal(operationAddress(observation(1).occurrence), address);
    for (const changed of [
      { ...identity, physicalSessionId: "00000000-0000-4000-8000-000000000099" },
      { ...identity, definitionFingerprint: "b".repeat(64) },
      { ...identity, occurrencePath: ["other"] },
      { ...identity, occurrence: 2 },
    ]) assert.notEqual(operationAddress(changed), address);
  });
  it("joins the exact frozen invocation/action and refuses unknown actions", () => {
    assert.equal(operationAction(definition, observation(1)).action.id, "consume-text");
    assert.throws(() => operationAction(definition, { ...observation(1), occurrence: { ...observation(1).occurrence, logicalActionId: "foreign-action" } }), /unknown-frozen-action/u);
  });
  it("never turns redacted or withheld metadata into a displayed raw value", () => {
    const base = { slot: "text", fieldPath: "text", producer: { kind: "run-input" as const, path: "text" } };
    const value = (input: unknown) => OperationActionObservationWireSchema.parse({ ...observation(1), occurrence: { ...observation(1).occurrence, value: input } }).occurrence.value!;
    assert.equal(operationValueText(value({ ...base, state: "redacted", binding: { kind: "legacy-protected-input", inputPath: "emplId", name: "personLookupCanaryEid" } })), "Protected value · redacted");
    assert.equal(operationValueText(value({ ...base, state: "withheld", reason: "protection-unresolved" })), "Value unavailable · protection-unresolved");
  });
  it("keeps every exact transformed input identity rather than selecting a guessed last source", () => {
    const { value: _firstValue, ...first } = observation(1).occurrence;
    const { value: _secondValue, ...second } = observation(2).occurrence;
    assert.deepEqual(operationSourceIdentities(ActionValueProducerSchema.parse({ kind: "transformation", transformId: "summary", path: "text", inputs: [{ inputId: "input", source: { kind: "task-output", entryId: "first", path: "disposition" }, identities: [first, second], state: "retained" }] })), [first, second]);
  });
  it("selects declared result cases only from confirmed, available values in its group", () => {
    const action = { id: "form", kind: "open-page" as const, outcomes: [
      { id: "same", label: "Matched", when: { kind: "equals" as const, variable: "text", value: "same" } },
      { id: "absent", label: "Absent", when: { kind: "is-absent" as const, variable: "text" } },
    ] };
    const base = observation(1);
    const confirmed = { ...base, occurrence: { ...base.occurrence, state: "confirmed" as const } };
    assert.deepEqual(observedOperationOutcome(action, [confirmed]), { state: "selected", label: "Matched" });
    assert.equal(observedOperationOutcome(action, [base])?.state, "unavailable");
    assert.equal(observedOperationOutcome(action, [])?.state, "unavailable");
    assert.equal(observedOperationOutcome({ ...action, outcomes: [action.outcomes[0], { ...action.outcomes[0], id: "overlap" }] }, [confirmed])?.state, "unavailable");
    const withheld = { ...confirmed, occurrence: { ...confirmed.occurrence, value: { ...confirmed.occurrence.value!, state: "withheld" as const, reason: "protection-unresolved" } } };
    assert.equal(observedOperationOutcome(action, [withheld])?.state, "unavailable");
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
