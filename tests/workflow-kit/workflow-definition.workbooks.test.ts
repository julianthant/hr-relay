import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTaskContract } from "../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { FingerprintSchema, taskId } from "../../src/rules/identity/ids.js";
import { flow } from "../../src/workflow-kit/flow.js";
import { compileWorkflow, defineStepEntries, defineStepProof, defineWorkflow, inheritStepProof } from "../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDefinition, WorkflowAuthor } from "../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowDescriptor, defineWorkflowStep, workflowPlanning, workflowProjections } from "../../src/workflow-kit/workflow.js";
import { i9CheckWorkflow } from "../../src/workflows/i9-check/workflow.js";
import { i9LookupWorkflow } from "../../src/workflows/i9-lookup/workflow.js";
import { ocrPageWorkflow } from "../../src/workflows/ocr-page/workflow.js";
import { ocrWorkflow } from "../../src/workflows/ocr/workflow.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { onbaseWorkflow } from "../../src/workflows/onbase/workflow.js";
import { separationsWorkflow } from "../../src/workflows/separations/workflow.js";
import { onboardingWorkflow } from "../../src/workflows/onboarding/workflow.js";
import { ONBOARDING_ROSTER_FIELDS } from "../../src/models/workflows/onboarding/roster.js";
import { OCR_ROSTER_FIELDS } from "../../src/models/workflows/ocr/roster.js";

const Input = z.strictObject({ value: z.string() });
const canonicalInput = defineCanonicalInput(Input, Input, [{ value: "fixture" }]);
const contract = defineTaskContract({
  id: taskId("workflow:workbook-requirements/read-value"), title: "Read fixture value", effect: "read",
  input: Input, output: Input, errorCodes: ["provider-unavailable"],
  subject: { kind: "none", reason: "Pure workbook requirement fixture" }, scenarios: [],
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  example: { value: "fixture" },
});
const group = defineWorkflowStep({ key: "reading", label: "Read fixture value" });
const entries = defineStepEntries(group);
const authored = (author: WorkflowAuthor<typeof Input>) => {
  const read = author.task(entries.task("reading", contract, { replay: "checkpoint" }), [], ({ input }) => input);
  return { steps: [[group, [read]]] as const, result: author.result(Input, [read], ({ outputs }) => outputs.reading) };
};
const base = {
  id: "workbook-requirements", version: 1, code: "wbr", label: "Workbook requirements", icon: "Search", category: "search",
  input: Input, canonicalInput, inputSubject: "name", surface: { shape: "single" }, enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Input>) => input.value },
  presentation: { title: (input: z.output<typeof Input>) => input.value }, scenarios: ["workbook-requirements/read"],
  role: { kind: "standalone" }, steps: authored,
} as const;
const fixtureFlow = flow(Input)
  .step("reading", contract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
  .build({ schema: Input, dependsOn: ["reading"], derive: ({ outputs }) => outputs.reading });
const fingerprint = FingerprintSchema.parse("f".repeat(64));
const descriptorSpec = { ...base, flow: fixtureFlow, contractFingerprint: fingerprint };
const currentDefinitions: readonly AnyWorkflowDefinition[] = [
  personLookupWorkflow, separationsWorkflow, i9CheckWorkflow, i9LookupWorkflow, ocrWorkflow, ocrPageWorkflow, onbaseWorkflow,
];

describe("workbook field requirements", () => {
  const requirement = { id: "onboarding-roster", keyFieldId: "email", mode: "keys" as const, writableFields: ["eid"] };

  it("derives lookups from admitted ingress and frozen static fields", () => {
    let parses = 0;
    const ingress = z.strictObject({ value: z.string().transform(value => { parses++; return `${value}!`; }), captured: z.string().optional() });
    const captured = defineCanonicalInput(ingress, Input.extend({ captured: z.string() }), [{ value: "fixture", captured: "retained" }]);
    const ingressFlow = flow(ingress).step("reading", contract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ value: input.value }) })
      .build({ schema: Input, dependsOn: ["reading"], derive: ({ outputs }) => outputs.reading });
    const descriptor = defineWorkflowDescriptor({ ...descriptorSpec, flow: ingressFlow, canonicalInput: captured,
      requiredWorkbookFields: ["email", "eid"], workbookReference: requirement, referenceKeys: input => [input.value],
      plannedOutputs: input => [{ kind: "workbook", name: `${input.value}.xlsx`, rowSubject: "person", rows: { state: "known", count: 1 } }] });
    const planning = workflowPlanning(descriptor);
    parses = 0;
    const admitted = planning.parseInput({ value: "fixture" });
    expect(admitted.lookups).toEqual([{ typeId: "onboarding-roster", keys: ["fixture!"], fields: ["email", "eid"] }]);
    expect(parses).toBe(1);
    expect(() => planning.plannedOutputs({ value: "fixture" }, [])).toThrow();
    expect(planning.plannedOutputs({ value: "fixture", captured: "retained" }, [])).toEqual([
      { kind: "workbook", name: "fixture.xlsx", rowSubject: "person", rows: { state: "known", count: 1 } },
    ]);
  });

  it("authors Onboarding lookup without caller supplied roster values", () => {
    const planning = workflowPlanning(compileWorkflow(onboardingWorkflow).descriptor);
    const ingress = planning.parseInput({ email: "hire@example.test", mode: "new-hire" });
    expect(() => planning.parseCanonicalInput(ingress.input)).toThrow();
    expect(ingress.lookups).toEqual([{ typeId: "onboarding-roster", keys: ["hire@example.test"], fields: [...ONBOARDING_ROSTER_FIELDS] }]);
  });

  it("copies and recursively freezes fields, reference and writable outputs", () => {
    const fields = ["email", "eid"], writableFields = ["eid"];
    const definition = defineWorkflow({ ...base, requiredWorkbookFields: fields,
      workbookReference: { ...requirement, writableFields }, referenceKeys: input => [input.value] });
    fields.push("fullName"); writableFields.push("email");
    const { descriptor } = compileWorkflow(definition);
    expect(definition.requiredWorkbookFields).toEqual(["email", "eid"]);
    expect(descriptor.requiredWorkbookFields).toEqual(["email", "eid"]);
    expect(descriptor.workbookReference?.writableFields).toEqual(["eid"]);
    const lowLevelFields = ["email", "eid"], lowLevelWritable = ["eid"];
    const lowLevel = defineWorkflowDescriptor({ ...descriptorSpec, requiredWorkbookFields: lowLevelFields,
      workbookReference: { ...requirement, writableFields: lowLevelWritable }, referenceKeys: input => [input.value] });
    lowLevelFields.push("fullName"); lowLevelWritable.push("email");
    expect(lowLevel.requiredWorkbookFields).toEqual(["email", "eid"]);
    expect(lowLevel.workbookReference?.writableFields).toEqual(["eid"]);
    for (const retained of [definition.requiredWorkbookFields, descriptor.requiredWorkbookFields,
      workflowPlanning(descriptor).requiredWorkbookFields, workflowProjections(descriptor).requiredWorkbookFields,
      descriptor.workbookReference?.writableFields, lowLevel.requiredWorkbookFields,
      lowLevel.workbookReference?.writableFields]) expect(Object.isFrozen(retained)).toBe(true);
    expect(descriptor.contractFingerprint).not.toBe(compileWorkflow(defineWorkflow(base)).descriptor.contractFingerprint);
    expect(descriptor.contractFingerprint).toBe(compileWorkflow(defineWorkflow({ ...base, requiredWorkbookFields: ["email", "eid"],
      workbookReference: { ...requirement, writableFields: ["eid"] }, referenceKeys: input => [input.value] })).descriptor.contractFingerprint);
    expect(() => workflowPlanning({ ...descriptor })).toThrow(/only available for a descriptor/u);
    expect(() => workflowProjections({ ...descriptor })).toThrow(/exact object/u);
    const changed = compileWorkflow(defineWorkflow({ ...base, requiredWorkbookFields: ["email", "eid", "fullName"],
      workbookReference: { ...requirement, writableFields: [] }, referenceKeys: input => [input.value] })).descriptor;
    expect(changed.contractFingerprint).not.toBe(descriptor.contractFingerprint);
    const changedWrite = compileWorkflow(defineWorkflow({ ...base, requiredWorkbookFields: ["email", "eid"],
      workbookReference: { ...requirement, writableFields: [] }, referenceKeys: input => [input.value] })).descriptor;
    const changedKey = compileWorkflow(defineWorkflow({ ...base, requiredWorkbookFields: ["email", "eid"],
      workbookReference: { ...requirement, keyFieldId: "eid" }, referenceKeys: input => [input.value] })).descriptor;
    const changedMode = compileWorkflow(defineWorkflow({ ...base, requiredWorkbookFields: ["email", "eid"],
      workbookReference: { ...requirement, mode: "all" } })).descriptor;
    for (const candidate of [changedWrite, changedKey, changedMode])
      expect(candidate.contractFingerprint).not.toBe(descriptor.contractFingerprint);
  });

  it.each([null, "roster", ["unknown"], ["eid", "eid"]].map(value => ({ value })))("rejects invalid field declaration $value", ({ value }) => {
      expect(() => defineWorkflow({ ...base, requiredWorkbookFields: value as readonly string[] })).toThrow();
      expect(() => defineWorkflowDescriptor({ ...descriptorSpec, requiredWorkbookFields: value as readonly string[] })).toThrow();
    });

  it("requires key and writable fields within the required set", () => {
    expect(() => defineWorkflow({ ...base, requiredWorkbookFields: ["email"], workbookReference: requirement,
      referenceKeys: input => [input.value] })).toThrow();
    expect(() => defineWorkflow({ ...base, requiredWorkbookFields: ["email", "eid"],
      workbookReference: { ...requirement, keyFieldId: "fullName" }, referenceKeys: input => [input.value] })).toThrow();
  });

  it("normalizes omitted fields to a frozen empty declaration in both factories", () => {
    const definition = defineWorkflow(base);
    const descriptor = defineWorkflowDescriptor(descriptorSpec);
    expect(definition.requiredWorkbookFields).toEqual([]);
    expect(descriptor.requiredWorkbookFields).toEqual([]);
    expect(Object.isFrozen(definition.requiredWorkbookFields)).toBe(true);
    expect(Object.isFrozen(descriptor.requiredWorkbookFields)).toBe(true);
  });

  it("inherits an exact independent declaration into a step proof", () => {
    const parent = defineWorkflow({ ...base, role: { kind: "composition" }, requiredWorkbookFields: ["email", "eid"],
      workbookReference: requirement, referenceKeys: input => [input.value] });
    const { definition } = defineStepProof(parent, { group, proof: { id: "workbook-requirements-proof", order: 1,
      build: actual => ({ ...inheritStepProof(actual), code: "wbp", label: "Workbook proof", steps: authored }) } });
    expect(definition.requiredWorkbookFields).toEqual(parent.requiredWorkbookFields);
    expect(definition.requiredWorkbookFields).not.toBe(parent.requiredWorkbookFields);
    expect(definition.workbookReference).toEqual(parent.workbookReference);
    expect(workflowPlanning(compileWorkflow(definition).descriptor).requiredWorkbookFields).toEqual(["email", "eid"]);
  });

  it.each(currentDefinitions)("preserves $id declared fields", definition => {
    const expected = definition.id === "ocr" ? [...OCR_ROSTER_FIELDS] : [];
    expect(Object.hasOwn(definition, "requiredWorkbookFields")).toBe(true);
    expect(definition.requiredWorkbookFields).toEqual(expected);
    const { descriptor } = compileWorkflow(definition);
    expect(workflowPlanning(descriptor).requiredWorkbookFields).toEqual(expected);
    expect(workflowProjections(descriptor).requiredWorkbookFields).toEqual(expected);
  });
});
