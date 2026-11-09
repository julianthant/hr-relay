import { z } from "zod";
import { compileWorkflow, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { declareDriverFor, defineTask, type BrowserDriver } from "../../../src/workflow-kit/task.js";
import { SearchPersonOrgInputSchema, SearchPersonOrgOutputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { ScenarioIdSchema, taskId } from "../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { ucpathSession } from "../../../src/backend/systems/ucpath/session-provider.js";
import { Plan1Input, Plan1CanonicalInput, Plan1Output, plan1Stores } from "./plan1-operation-workflows.js";

export interface FictionalFormDriver extends BrowserDriver {
  readonly system: "ucpath";
  fillEmployee(value: string): Promise<void>;
  readEmployee(): Promise<string>;
  search(): Promise<void>;
  readResult(): Promise<string>;
}
const driver = declareDriverFor<FictionalFormDriver>()("ucpath", "semantic-ready");
const scenario = ScenarioIdSchema.parse("person-lookup/happy-by-eid");
const fictionalCandidate = { emplId: "10800000", name: "Fictional Employee", department: "Demonstration", jobTitle: "Fixture", employeeStatus: "active" as const, hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true };
const formOutput = () => SearchPersonOrgOutputSchema.parse({ results: [fictionalCandidate], selection: { status: "resolved", selected: fictionalCandidate, candidateEids: [fictionalCandidate.emplId] } });
const contract = defineTaskContract({ id: taskId("ucpath/search-person-org"), title: "Find fictional employee", effect: "read", input: SearchPersonOrgInputSchema, output: SearchPersonOrgOutputSchema,
  subject: { kind: "none", reason: "Fictional form fixture; no HR authority" }, errorCodes: ["unexpected-page-state"], scenarios: [scenario],
  freshness: { defaultMaxAgeMs: 0 }, provenance: { default: "live" }, example: formOutput()
});
const task = defineTask(driver, contract, { sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
  if (input.kind !== "by-eid") throw new Error("fixture-requires-eid-search");
  await ctx.driver.fillEmployee(input.emplId);
  if (await ctx.driver.readEmployee() !== input.emplId) throw new Error("fixture-employee-not-filled");
  await ctx.driver.search();
  const result = await ctx.driver.readResult();
  const output = formOutput();
  if (output.selection.status !== result) throw new Error("fixture-readback-mismatch");
  ctx.recordData([{ direction: "read", field: "results", value: output.results }, { direction: "read", field: "selection", value: output.selection }]);
  return output;
} });
export const plan1BrowserStores = defineTaskStoreRegistry([...plan1Stores.stores, defineBrowserStore("ucpath", driver, ucpathSession, { search: task })], {
  scenarioIds: [ScenarioIdSchema.parse("ocr/capability-wiring-happy"), scenario], tasks: [{ id: taskId("ocr/extract-form-page"), effect: "read" }, { id: contract.id, effect: "read" }],
});
export const plan1BrowserWorkflow = compileWorkflow(defineWorkflow({ id: "fixture-plan1-browser", version: 1, code: "fpb", label: "Fictional employee search", icon: "Search", category: "operations",
  input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Plan1Input>) => input.emplId },
  presentation: { title: () => "Fictional employee search" }, scenarios: ["fixture-plan1-browser/happy"] as const, role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task: node, result }) => { const search = node({ id: "search", label: "Find employee", contract, replay: "checkpoint" }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId })); return { steps: [[{ key: "search", label: "Find employee" }, [search]]], result: result(Plan1Output, [search], ({ input, outputs }) => ({ eid: input.emplId, disposition: outputs.search.selection.status, providerState: outputs.search.selection.status })) }; },
}));

/** Mutable fictional page; readback observes the driver's actual field/result state. */
export function fictionalFormDriver(): FictionalFormDriver {
  let employee = ""; let result = "No search performed";
  return { system: "ucpath", async fillEmployee(value) { employee = value; }, async readEmployee() { return employee; }, async search() { if (employee !== "10800000") throw new Error("fixture-employee-mismatch"); result = "resolved"; }, async readResult() { return result; } };
}
