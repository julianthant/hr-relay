import { z } from "zod";
import { compileWorkflow, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { EidSchema, ScenarioIdSchema, taskId } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { runDeclaredAction, recordDeclaredActionNotRun } from "../../../src/backend/systems/browser-shared/action-notes.js";
import { fixtureBuildManifest } from "./workflow-definition-fixtures.js";

export const Plan1Input = z.strictObject({ emplId: EidSchema, text: z.string(), mode: z.enum(["ok", "fail", "repeat", "confirmed"]) });
export const Plan1Output = z.strictObject({ eid: EidSchema, disposition: z.string(), providerState: z.string() });
export const Plan1CanonicalInput = defineCanonicalInput(Plan1Input, Plan1Input, [{ emplId: "10800000", text: "same", mode: "ok" }]);
const scenario = ScenarioIdSchema.parse("ocr/capability-wiring-happy");
export const plan1Contract = defineTaskContract({ id: taskId("ocr/extract-form-page"), title: "Plan 1 local observations", effect: "read",
  input: Plan1Input, output: Plan1Output, subject: { kind: "none", reason: "Synthetic local operation evidence" }, errorCodes: ["provider-unavailable"], scenarios: [scenario],
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" }, provenance: { default: "live" },
  example: { eid: "10800000", disposition: "same", providerState: "same" },
  operation: { version: 1, id: "plan1-observe", system: "local", session: { kind: "local", id: "plan1-local" }, values: [
    { id: "text", presentation: "local-operator", source: { kind: "contract-input", path: "text" } },
    { id: "eid", presentation: "local-operator", source: { kind: "contract-output", path: "eid" } },
    { id: "disposition", presentation: "local-operator", source: { kind: "contract-output", path: "disposition" } },
    { id: "provider-state", presentation: "local-operator", source: { kind: "contract-output", path: "providerState" } },
  ], actions: [
    { id: "consume-text", kind: "read-field", confirmationActionId: "verify-consume-text", valueSlot: "text" },
    { id: "read-eid", kind: "read-field", confirmationActionId: "verify-read-eid", valueSlot: "eid" },
    { id: "read-disposition", kind: "read-field", confirmationActionId: "verify-read-disposition", valueSlot: "disposition" },
    { id: "read-provider-state", kind: "read-field", confirmationActionId: "verify-read-provider-state", valueSlot: "provider-state" },
    { id: "verify-consume-text", kind: "verify" },
    { id: "verify-read-eid", kind: "verify" },
    { id: "verify-read-disposition", kind: "verify" },
    { id: "verify-read-provider-state", kind: "verify" },
    { id: "optional-read", kind: "read-field", valueSlot: "provider-state" },
  ] },
});
export const plan1Task = defineTask(plan1Contract, { sessions: [], async run({ input, ctx }) {
  const confirm = (id: string, expected: string) => input.mode === "confirmed" ? { id: `verify-${id}`, targetId: `verify-${id}`, verify: async (value: string) => value === expected } : undefined;
  await runDeclaredAction({ id: "consume-text", kind: "read", targetId: "consume-text" }, async () => input.text, (value) => value, confirm("consume-text", input.text));
  recordDeclaredActionNotRun({ id: "optional-read", kind: "read", targetId: "optional-read" }, "condition-false");
  const eid = await runDeclaredAction({ id: "read-eid", kind: "read", targetId: "read-eid" }, async () => input.emplId, (value) => value, confirm("read-eid", input.emplId));
  const disposition = await runDeclaredAction({ id: "read-disposition", kind: "read", targetId: "read-disposition" }, async () => {
    if (input.mode === "fail") throw new Error("synthetic callback failure"); return input.text;
  }, (value) => value, confirm("read-disposition", input.text));
  if (input.mode === "repeat") await runDeclaredAction({ id: "read-disposition", kind: "read", targetId: "read-disposition" }, async () => input.text, (value) => value);
  const providerState = await runDeclaredAction({ id: "read-provider-state", kind: "read", targetId: "read-provider-state" }, async () => input.text, (value) => value, confirm("read-provider-state", input.text));
  ctx.recordData([{ direction: "read", field: "eid", value: eid }, { direction: "read", field: "disposition", value: disposition }, { direction: "read", field: "providerState", value: providerState }]);
  return { eid, disposition, providerState };
} });
export const plan1Stores = defineTaskStoreRegistry([defineServiceStore("ocr", { observe: plan1Task })], { scenarioIds: [scenario], tasks: [{ id: plan1Contract.id, effect: "read" }] });
const ids = ["fixture-plan1-leaf", "fixture-plan1-child", "fixture-plan1-parent"];
const manifest = fixtureBuildManifest(ids);
const common = { version: 1, code: "fpo", label: "Plan 1 synthetic workflow", icon: "Search" as const, category: "operations" as const,
  input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid" as const, surface: { shape: "single" as const }, enqueue: "reject-active" as const,
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Plan1Input>) => input.emplId },
  presentation: { title: () => "Plan 1 synthetic workflow" }, scenarios: ["fixture-plan1/happy"] as const, role: defineWorkflowRole({ kind: "standalone" }) };
const policy = { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const, afterChildRetry: "resume-parent" as const, visibility: "inline" as const };
const bindings = [{ slot: "text", value: { kind: "run-input" as const, path: "text" } }];
export const plan1Leaf = compileWorkflow(defineWorkflow({ ...common, id: ids[0], operationDisplay: { capability: "complete", version: 1, invocations: [
  { id: "first-operation", entryId: "first", contractRole: "task", occurrencePath: ["first"], bindings },
  { id: "second-operation", entryId: "second", contractRole: "task", occurrencePath: ["second"], bindings },
], presentation: [{ id: "first-node", kind: "operation", invocationId: "first-operation" }, { id: "second-node", kind: "operation", invocationId: "second-operation" }] }, steps: ({ task, result }) => {
  const first = task({ id: "first", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
  const second = task({ id: "second", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
  return { steps: [[{ key: "first", label: "First" }, [first]], [{ key: "second", label: "Second" }, [second]]], result: result(Plan1Output, [first, second], ({ outputs }) => ({ ...outputs.first, disposition: `${outputs.first.disposition}/${outputs.second.providerState}` }), [
    { path: "eid", source: { kind: "task-output", entryId: "first", path: "eid" } },
    { path: "providerState", source: { kind: "task-output", entryId: "second", path: "providerState" } },
    { path: "disposition", source: { kind: "derived", inputs: [{ id: "first", source: { kind: "task-output", entryId: "first", path: "disposition" } }, { id: "second", source: { kind: "task-output", entryId: "second", path: "providerState" } }] } },
  ]) };
} }), { manifest });
const leafRef = { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output };
export const plan1Child = compileWorkflow(defineWorkflow({ ...common, id: ids[1], operationDisplay: { capability: "complete", version: 1, invocations: [], presentation: [{ id: "nested-node", kind: "delegate", entryId: "nested", targetWorkflowId: leafRef.id }] }, steps: ({ delegate, result }) => {
  const child = delegate({ id: "nested", target: leafRef, edgeId: "plan1-nested", cardinality: "one", await: "terminal", join: "one", policy }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  return { steps: [[{ key: "nested", label: "Nested" }, [child]]], result: result(Plan1Output, [child], ({ outputs }) => { const outcome = outputs.nested; if (outcome.state !== "done") throw new Error("child-not-done"); return outcome.output; }, [
    { path: "eid", source: { kind: "child-output", entryId: "nested", path: "eid" } },
    { path: "providerState", source: { kind: "child-output", entryId: "nested", path: "providerState" } },
    { path: "disposition", source: { kind: "derived", inputs: [{ id: "nested", source: { kind: "child-output", entryId: "nested", path: "disposition" } }] } },
  ]) };
} }), { manifest });
export function plan1Summary(input: unknown) {
  const value = z.strictObject({ left: z.string(), right: z.string(), label: z.string() }).parse(input);
  return { text: `${value.left}/${value.right}/${value.label}` };
}
export const plan1Parent = compileWorkflow(defineWorkflow({ ...common, id: ids[2], operationDisplay: { capability: "complete", version: 1, transforms: [
  { id: "child-summary", input: z.strictObject({ left: z.string(), right: z.string(), label: z.string() }), output: z.strictObject({ text: z.string() }),
    inputs: [{ id: "left", inputPath: "left", value: { kind: "child-output", entryId: "left", path: "disposition" } }, { id: "right", inputPath: "right", value: { kind: "child-output", entryId: "right", path: "providerState" } }, { id: "label", inputPath: "label", value: { kind: "configuration", key: "actor.label", schema: z.string(), example: "Operator" } }],
    example: { left: "same/same", right: "same", label: "Operator" }, derive: plan1Summary },
], invocations: [{ id: "observe-operation", entryId: "observe", contractRole: "task", occurrencePath: ["observe"], bindings: [{ slot: "text", value: { kind: "transformation", transformId: "child-summary", path: "text" } }] }],
  presentation: [{ id: "left-node", kind: "delegate", entryId: "left", targetWorkflowId: plan1Child.descriptor.id }, { id: "right-node", kind: "delegate", entryId: "right", targetWorkflowId: leafRef.id }, { id: "observe-node", kind: "operation", invocationId: "observe-operation" }] }, steps: ({ delegate, task, result }) => {
  const left = delegate({ id: "left", target: { id: plan1Child.descriptor.id, input: Plan1Input, result: Plan1Output }, edgeId: "plan1-left", cardinality: "one", await: "terminal", join: "one", policy }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  const right = delegate({ id: "right", target: leafRef, edgeId: "plan1-right", cardinality: "one", await: "terminal", join: "one", policy }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  const observe = task({ id: "observe", contract: plan1Contract, replay: "checkpoint" }, [left, right], ({ input, outputs, configuration }) => {
    if (outputs.left.state !== "done" || outputs.right.state !== "done") throw new Error("child-not-done");
    return { ...input, text: plan1Summary({ left: outputs.left.output.disposition, right: outputs.right.output.providerState, label: configuration?.["actor.label"] }).text };
  });
  return { steps: [[{ key: "left", label: "Left child" }, [left]], [{ key: "right", label: "Right child" }, [right]], [{ key: "observe", label: "Observe" }, [observe]]], result: result(Plan1Output, [left, right, observe], ({ outputs }) => outputs.observe, [{ path: "disposition", source: { kind: "task-output", entryId: "observe", path: "disposition" } }]) };
} }), { manifest });
export const plan1Workflows = [plan1Leaf, plan1Child, plan1Parent];
