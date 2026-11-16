import { z } from "zod";
import { compileWorkflow, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { EidSchema, ScenarioIdSchema, taskId } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";

export const Plan1Input = z.strictObject({ emplId: EidSchema, text: z.string(), mode: z.enum(["ok", "fail", "repeat", "confirmed"]) });
export const Plan1Output = z.strictObject({ eid: EidSchema, disposition: z.string(), providerState: z.string() });
export const Plan1CanonicalInput = defineCanonicalInput(Plan1Input, Plan1Input, [{ emplId: "10800000", text: "same", mode: "ok" }]);
const scenario = ScenarioIdSchema.parse("ocr/capability-wiring-happy");
export const plan1Contract = defineTaskContract({ id: taskId("ocr/extract-form-page"), title: "Plan 1 local observations", effect: "read",
  input: Plan1Input, output: Plan1Output, subject: { kind: "none", reason: "Synthetic local operation evidence" }, errorCodes: ["provider-unavailable"], scenarios: [scenario],
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" }, provenance: { default: "live" },
  example: { eid: "10800000", disposition: "same", providerState: "same" },
});
const { __sealed: _sealed, ...plan1ReadDefinition } = plan1Contract;
export const plan1ExpiringContract = defineTaskContract({ ...plan1ReadDefinition,
  freshness: { defaultMaxAgeMs: 1000, defaultOverride: "forbidden" } });
type Plan1ReadContract = typeof plan1Contract | typeof plan1ExpiringContract;
const createPlan1Task = (shouldFail: (input: z.output<typeof Plan1Input>) => boolean, onRun?: (input: z.output<typeof Plan1Input>) => void, contract: Plan1ReadContract = plan1Contract) => defineTask(contract, { sessions: [], async run({ input, ctx }) {
  onRun?.(input);
  const eid = input.emplId;
  if (shouldFail(input)) throw new Error("synthetic callback failure");
  const disposition = input.text, providerState = input.text;
  ctx.recordData([{ direction: "read", field: "eid", value: eid }, { direction: "read", field: "disposition", value: disposition }, { direction: "read", field: "providerState", value: providerState }]);
  return { eid, disposition, providerState };
} });
export const plan1Task = createPlan1Task(input => input.mode === "fail");
export const plan1Stores = defineTaskStoreRegistry([defineServiceStore("ocr", { observe: plan1Task })], { scenarioIds: [scenario], tasks: [{ id: plan1Contract.id, effect: "read" }] });
export function plan1ExpiringFailureStores(shouldFail: (input: z.output<typeof Plan1Input>) => boolean) {
  return defineTaskStoreRegistry([defineServiceStore("ocr", { observe: createPlan1Task(shouldFail,undefined,plan1ExpiringContract) })],
    { scenarioIds: [scenario], tasks: [{ id: plan1Contract.id, effect: "read" }] });
}
export const plan1ExpiringStores = plan1ExpiringFailureStores(input => input.mode === "fail");
export function plan1ControlledFailureStores(shouldFail: (input: z.output<typeof Plan1Input>) => boolean) {
  return defineTaskStoreRegistry([defineServiceStore("ocr", { observe: createPlan1Task(shouldFail) })], { scenarioIds: [scenario], tasks: [{ id: plan1Contract.id, effect: "read" }] });
}
export function plan1TransientFailureStores(onRun: (input: z.output<typeof Plan1Input>) => void) {
  let failed = false;
  const task = createPlan1Task(input => {
    if (input.mode !== "fail" || failed) return false;
    failed = true; return true;
  }, onRun);
  return defineTaskStoreRegistry([defineServiceStore("ocr", { observe: task })], { scenarioIds: [scenario], tasks: [{ id: plan1Contract.id, effect: "read" }] });
}
const ids = ["fixture-plan1-leaf", "fixture-plan1-child", "fixture-plan1-parent"];
const common = { version: 1, code: "fpo", label: "Plan 1 synthetic workflow", icon: "Search" as const, category: "operations" as const,
  input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid" as const, surface: { shape: "single" as const }, enqueue: "reject-active" as const,
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Plan1Input>) => input.emplId },
  presentation: { title: () => "Plan 1 synthetic workflow" }, scenarios: ["fixture-plan1/happy"] as const, role: defineWorkflowRole({ kind: "standalone" }) };
const policy = { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const, afterChildRetry: "resume-parent" as const, visibility: "inline" as const };
function plan1ReadLeaf(id: string, contract: Plan1ReadContract) { return compileWorkflow(defineWorkflow({ ...common, id, steps: ({ task, result }) => {
  const first = task({ id: "first", contract, replay: "checkpoint" }, [], ({ input }) => input);
  const second = task({ id: "second", contract, replay: "checkpoint" }, [], ({ input }) => input);
  return { steps: [[{ key: "first", label: "First" }, [first]], [{ key: "second", label: "Second" }, [second]]], result: result(Plan1Output, [first, second], ({ outputs }) => ({ ...outputs.first, disposition: `${outputs.first.disposition}/${outputs.second.providerState}` })) };
} })); }
export const plan1Leaf = plan1ReadLeaf(ids[0],plan1Contract);
export const plan1ExpiringLeaf = plan1ReadLeaf("fixture-plan1-expiring-leaf",plan1ExpiringContract);

const leafRef = { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output };
export const plan1Child = compileWorkflow(defineWorkflow({ ...common, id: ids[1], steps: ({ delegate, result }) => {
  const child = delegate({ id: "nested", target: leafRef, edgeId: "plan1-nested", cardinality: "one", await: "terminal", join: "one", policy }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  return { steps: [[{ key: "nested", label: "Nested" }, [child]]], result: result(Plan1Output, [child], ({ outputs }) => { const outcome = outputs.nested; if (outcome.state !== "done") throw new Error("child-not-done"); return outcome.output; }) };
} }));
export function plan1Summary(input: unknown) {
  const value = z.strictObject({ left: z.string(), right: z.string(), label: z.string() }).parse(input);
  return { text: `${value.left}/${value.right}/${value.label}` };
}
export const plan1Parent = compileWorkflow(defineWorkflow({ ...common, id: ids[2], steps: ({ delegate, task, result }) => {
  const left = delegate({ id: "left", target: { id: plan1Child.descriptor.id, input: Plan1Input, result: Plan1Output }, edgeId: "plan1-left", cardinality: "one", await: "terminal", join: "one", policy }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  const right = delegate({ id: "right", target: leafRef, edgeId: "plan1-right", cardinality: "one", await: "terminal", join: "one", policy }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  const observe = task({ id: "observe", contract: plan1Contract, replay: "checkpoint" }, [left, right], ({ input, outputs }) => {
    if (outputs.left.state !== "done" || outputs.right.state !== "done") throw new Error("child-not-done");
    return { ...input, text: plan1Summary({ left: outputs.left.output.disposition, right: outputs.right.output.providerState, label: "Operator" }).text };
  });
  return { steps: [[{ key: "left", label: "Left child" }, [left]], [{ key: "right", label: "Right child" }, [right]], [{ key: "observe", label: "Observe" }, [observe]]], result: result(Plan1Output, [left, right, observe], ({ outputs }) => outputs.observe) };
} }));
export const plan1Workflows = [plan1Leaf, plan1Child, plan1Parent];
