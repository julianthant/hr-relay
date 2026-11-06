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

describe("direct workbook type requirements", () => {
  it("derives lookups from admitted ingress before canonical reference binding", () => {
    let parses = 0;
    const ingress = z.strictObject({ value: z.string().transform(value => { parses++; return `${value}!`; }), captured: z.string().optional() });
    const captured = defineCanonicalInput(ingress, Input.extend({ captured: z.string() }), [{ value: "fixture", captured: "retained" }]);
    const ingressFlow = flow(ingress).step("reading", contract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ value: input.value }) })
      .build({ schema: Input, dependsOn: ["reading"], derive: ({ outputs }) => outputs.reading });
    const descriptor = defineWorkflowDescriptor({ ...descriptorSpec, flow: ingressFlow, canonicalInput: captured,
      requiredWorkbookTypeIds: ["roster"], referenceLookups: input => [{ typeId: "roster", keys: [input.value], fields: ["email"] }],
      plannedOutputs: input => [{ kind: "workbook", name: `${input.value}.xlsx`, rowSubject: "person", rows: { state: "known", count: 1 } }] });
    const planning = workflowPlanning(descriptor);
    parses = 0;
    const admitted = planning.parseInput({ value: "fixture" });
    expect(admitted.lookups).toEqual([{ typeId: "roster", keys: ["fixture!"], fields: ["email"] }]);
    expect(parses).toBe(1);
    expect(() => planning.plannedOutputs({ value: "fixture" }, [])).toThrow();
    expect(planning.plannedOutputs({ value: "fixture", captured: "retained" }, [])).toEqual([
      { kind: "workbook", name: "fixture.xlsx", rowSubject: "person", rows: { state: "known", count: 1 } },
    ]);
  });

  it("authors the Onboarding roster lookup without caller-supplied roster values", () => {
    const planning = workflowPlanning(compileWorkflow(onboardingWorkflow).descriptor);
    const ingress = planning.parseInput({ email: "hire@example.test", mode: "new-hire" });
    expect(() => planning.parseCanonicalInput(ingress.input)).toThrow();
    expect(ingress.lookups).toEqual([
      { typeId: "onboarding-roster", keys: ["hire@example.test"], fields: [...ONBOARDING_ROSTER_FIELDS] },
    ]);
  });

  it("preserves exact nonempty IDs and order through compilation and sealed readers", () => {
    const ids = ["roster/custom:2026", "Mixed Case type"];
    const definition = defineWorkflow({ ...base, requiredWorkbookTypeIds: ids });
    const { descriptor } = compileWorkflow(definition);
    expect(definition.requiredWorkbookTypeIds).toEqual(ids);
    expect(descriptor.requiredWorkbookTypeIds).toEqual(ids);
    expect(descriptor.requiredWorkbookTypeIds).not.toBe(definition.requiredWorkbookTypeIds);
    expect(workflowPlanning(descriptor).requiredWorkbookTypeIds).toBe(descriptor.requiredWorkbookTypeIds);
    expect(workflowProjections(descriptor).requiredWorkbookTypeIds).toBe(descriptor.requiredWorkbookTypeIds);
    expect(descriptor.contractFingerprint).toBe(fingerprint);
    expect(definition.role).toEqual({ kind: "standalone" });
    expect(() => workflowPlanning({ ...descriptor })).toThrow(/only available for a descriptor/u);
    expect(() => workflowProjections({ ...descriptor })).toThrow(/exact object/u);
  });

  it("copies both factory inputs and freezes every retained requirement array", () => {
    const ids = ["first", "second"];
    const definition = defineWorkflow({ ...base, requiredWorkbookTypeIds: ids });
    ids.reverse(); ids.push("third");
    expect(definition.requiredWorkbookTypeIds).toEqual(["first", "second"]);
    const lowLevelIds = ["master"];
    const descriptor = defineWorkflowDescriptor({ ...descriptorSpec, requiredWorkbookTypeIds: lowLevelIds });
    lowLevelIds[0] = "changed";
    for (const retained of [definition.requiredWorkbookTypeIds, descriptor.requiredWorkbookTypeIds,
      workflowPlanning(descriptor).requiredWorkbookTypeIds, workflowProjections(descriptor).requiredWorkbookTypeIds]) {
      expect(Object.isFrozen(retained)).toBe(true);
      expect(Reflect.set(retained, "0", "tampered")).toBe(false);
    }
    expect(descriptor.requiredWorkbookTypeIds).toEqual(["master"]);
  });

  it.each([null, "roster", [""], [42], ["roster", "roster"]].map(value => ({ value })))("rejects invalid declaration $value in both factories", ({ value }) => {
    const requiredWorkbookTypeIds = value as readonly string[];
    expect(() => defineWorkflow({ ...base, requiredWorkbookTypeIds })).toThrow();
    expect(() => defineWorkflowDescriptor({ ...descriptorSpec, requiredWorkbookTypeIds })).toThrow();
  });

  it("normalizes omitted requirements to an immutable empty declaration", () => {
    const definition = defineWorkflow(base);
    const descriptor = defineWorkflowDescriptor(descriptorSpec);
    expect(definition.requiredWorkbookTypeIds).toEqual([]);
    expect(descriptor.requiredWorkbookTypeIds).toEqual([]);
    expect(Object.isFrozen(definition.requiredWorkbookTypeIds)).toBe(true);
    expect(Object.isFrozen(descriptor.requiredWorkbookTypeIds)).toBe(true);
  });

  it("inherits a parent's nonempty declaration into its retained step proof", () => {
    const parent = defineWorkflow({ ...base, role: { kind: "composition" }, requiredWorkbookTypeIds: ["existing-master"] });
    const { definition } = defineStepProof(parent, {
      group,
      proof: { id: "workbook-requirements-proof", order: 1,
        build: actual => ({ ...inheritStepProof(actual), code: "wbp", label: "Workbook proof", steps: authored }) },
    });
    expect(definition.requiredWorkbookTypeIds).toEqual(parent.requiredWorkbookTypeIds);
    expect(definition.requiredWorkbookTypeIds).not.toBe(parent.requiredWorkbookTypeIds);
    expect(definition.role).toEqual({ kind: "chunk-harness", of: parent.id, step: "reading" });
    const { descriptor } = compileWorkflow(definition);
    expect(workflowPlanning(descriptor).requiredWorkbookTypeIds).toEqual(["existing-master"]);
    expect(descriptor.contractFingerprint).not.toBe(compileWorkflow(parent).descriptor.contractFingerprint);
  });

  it.each(currentDefinitions)(
    "preserves $id declared workbook requirements without phantom types", definition => {
      const expected = definition.id === "ocr" ? ["ocr-roster"] : [];
      expect(Object.hasOwn(definition, "requiredWorkbookTypeIds")).toBe(true);
      expect(definition.requiredWorkbookTypeIds).toEqual(expected);
      const { descriptor } = compileWorkflow(definition);
      expect(workflowPlanning(descriptor).requiredWorkbookTypeIds).toEqual(expected);
      expect(workflowProjections(descriptor).requiredWorkbookTypeIds).toEqual(expected);
      expect(definition.role).toEqual({ kind: "composition" });
    },
  );
});
