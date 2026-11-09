import { z } from "zod";
import { compileWorkflow, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineBrowserStore, defineServiceStore, defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { declareDriverFor, defineTask, type BrowserDriver } from "../../../src/workflow-kit/task.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { ScenarioIdSchema, taskId } from "../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import type { DataPoint } from "../../../src/rules/workflow/task-provenance.js";
import { kualiSession } from "../../../src/backend/systems/kuali/session-provider.js";
import { ucpathSession } from "../../../src/backend/systems/ucpath/session-provider.js";
import { Plan1Input, Plan1CanonicalInput, Plan1Output } from "./plan1-operation-workflows.js";

const scenario = ScenarioIdSchema.parse("fixture-separation/confirmed-actions");
const documentFields = z.strictObject({ employee: z.string(), documentNumber: z.string(), lastDayWorked: z.string(), separationDate: z.string(), holidayPay: z.string(), department: z.string(), title: z.string(), reason: z.string() });
const draftFields = documentFields.extend({ effectiveDate: z.string(), template: z.string(), comments: z.string(), managerComments: z.string(), pending: z.string(), transaction: z.string(), finalPay: z.string(), mode: z.string(), review: z.enum(["required", "not-required"]) });
type DocumentFields = z.output<typeof documentFields>;
type DraftFields = z.output<typeof draftFields>;
interface FieldsDriver extends BrowserDriver { read(field: string): Promise<string>; fill(field: string, value: string): Promise<void>; visit(page: string): Promise<void>; }
interface KualiFieldsDriver extends FieldsDriver { readonly system: "kuali"; }
interface UcpathFieldsDriver extends FieldsDriver { readonly system: "ucpath"; }
const kualiDriver = declareDriverFor<KualiFieldsDriver>()("kuali", "semantic-ready");
const ucpathDriver = declareDriverFor<UcpathFieldsDriver>()("ucpath", "semantic-ready");
export const fictionalSeparationDocument: DocumentFields = { employee: "10800000", documentNumber: "SIM-48216", lastDayWorked: "09/25/2026", separationDate: "09/25/2026", holidayPay: "09/25/2026", department: "Fictional Dining", title: "Student Assistant", reason: "Resign - Accept Another Job" };
export function reconcileFictionalSeparation(input: unknown): DraftFields {
  const source = documentFields.parse(input);
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(source.separationDate);
  if (date === null) throw new Error("fictional-separation-date-unparseable");
  const next = new Date(Date.UTC(Number(date[3]), Number(date[1]) - 1, Number(date[2]) + 1));
  const effectiveDate = `${String(next.getUTCMonth() + 1).padStart(2, "0")}/${String(next.getUTCDate()).padStart(2, "0")}/${next.getUTCFullYear()}`;
  const holiday = source.holidayPay === "" ? "" : ` Holiday Pay on ${source.holidayPay}./`;
  const comments = `Termination eff ${effectiveDate}. Last Day Worked ${source.lastDayWorked}./${holiday} Kuali form #${source.documentNumber}./`;
  return draftFields.parse({ ...source, effectiveDate, comments, managerComments: comments, template: "UC_VOL_TERM", pending: "none", transaction: "SIM-042", finalPay: "Does not need final pay · student", mode: "confirmed", review: source.separationDate < source.lastDayWorked ? "required" : "not-required" });
}
const recordFields = (value: Record<string, string>): DataPoint[] => [{ direction: "read", field: "fictional", value }];
const common = { subject: { kind: "none" as const, reason: "Fictional separation form; no HR authority or external effects" }, errorCodes: ["document-read-timeout"] as const, scenarios: [scenario], freshness: { defaultMaxAgeMs: 0 }, provenance: { default: "live" as const } };
const readContract = defineTaskContract({ ...common, id: taskId("kuali/read-separation-document"), title: "Read separation request", effect: "read", input: Plan1Input, output: z.strictObject({ fictional: documentFields }), example: { fictional: fictionalSeparationDocument }
});
const readTask = defineTask(kualiDriver, readContract, { sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }], async run({ ctx }) {
  await ctx.driver.visit("request");
  const fields: Record<string, string> = {};
  for (const field of Object.keys(fictionalSeparationDocument)) fields[field] = await ctx.driver.read(field);
  const result = documentFields.parse(fields);
  ctx.recordData(recordFields(result));
  return { fictional: result };
} });
const computeContract = defineTaskContract({ ...common, id: taskId("ocr/extract-form-page"), title: "Reconcile separation dates", effect: "read", input: documentFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) } });
const computeTask = defineTask(computeContract, { sessions: [], async run({ input, ctx }) {
  const fields = reconcileFictionalSeparation(input);
  if (fields.review === "required") ctx.log.warn("Separation date precedes the last day worked. Explicit operator confirmation is required before staging.");
  ctx.recordData(recordFields(fields));
  return { fictional: fields };
} });
const ucpathFields = ["employee", "template", "reason", "effectiveDate", "lastDayWorked", "comments", "managerComments"] as const;
const kualiFields = ["department", "title", "lastDayWorked", "separationDate", "effectiveDate", "transaction", "finalPay", "comments"] as const;
const ucpathContract = defineTaskContract({ ...common, id: taskId("ucpath/search-person-org"), title: "Stage termination", effect: "read", input: draftFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) } });
async function stageFields(driver: FieldsDriver, fields: readonly string[], input: DraftFields) {
  const staged: Record<string, string> = { ...input };
  for (const field of fields) {
    const expected = input[field as keyof DraftFields];
    await driver.fill(field, expected);
    staged[field] = await driver.read(field);
  }
  return draftFields.parse(staged);
}
const ucpathTask = defineTask(ucpathDriver, ucpathContract, { sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
  await ctx.driver.visit("pending");
  await ctx.driver.read("pending");
  await ctx.driver.visit("termination");
  const result = await stageFields(ctx.driver, ucpathFields, input);
  ctx.recordData(recordFields(result));
  return { fictional: result };
} });
const kualiContract = defineTaskContract({ ...common, id: taskId("kuali/match-separation-finalization"), title: "Finalize separation document", effect: "read", input: draftFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) } });
const kualiTask = defineTask(kualiDriver, kualiContract, { sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }], async run({ input, ctx }) { await ctx.driver.visit("finalization"); const result = await stageFields(ctx.driver, kualiFields, input); ctx.recordData(recordFields(result)); return { fictional: result }; } });
const verifyContract = defineTaskContract({ ...common, id: taskId("kuali/verify-separation-finalization"), title: "Verify saved separation document", effect: "read", input: draftFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) } });
const verifyTask = defineTask(kualiDriver, verifyContract, { sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
  await ctx.driver.visit("reloaded");
  const result = { ...input };
  for (const field of kualiFields) { if (input.mode === "fail") ctx.fail("document-read-timeout", "Fictional document session expired; document fields unavailable after reload.", { transient: true }); result[field] = await ctx.driver.read(field); }
  const parsed = draftFields.parse(result);
  ctx.recordData(recordFields(parsed));
  return { fictional: parsed };
} });
export const plan1SeparationStores = defineTaskStoreRegistry([defineServiceStore("ocr", { reconcile: computeTask }), defineBrowserStore("kuali", kualiDriver, kualiSession, { read: readTask, stage: kualiTask, verify: verifyTask }), defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { stage: ucpathTask })], { scenarioIds: [scenario], tasks: [readContract, computeContract, ucpathContract, kualiContract, verifyContract].map(({ id, effect }) => ({ id, effect })) });
export const plan1SeparationWorkflow = compileWorkflow(defineWorkflow({ id: "fixture-plan1-separation", version: 1, code: "fps", label: "Fictional separation", icon: "Search", category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Plan1Input>) => input.emplId }, presentation: { title: () => "Fictional separation" }, scenarios: ["fixture-separation/confirmed-actions"] as const, role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task, gate, result }) => {
    const read = task({ id: "read", label: "Read separation request", contract: readContract, replay: "checkpoint" }, [], ({ input }) => input);
    const compute = task({ id: "compute", label: "Reconcile dates", contract: computeContract, replay: "checkpoint" }, [read], ({ outputs }) => outputs.read.fictional);
    const review = gate({ id: "review", label: "Resolve conflicting separation dates", statusKey: "awaitingReview", result: z.strictObject({ approved: z.boolean() }), when: { kind: "equals", of: { from: "node", nodeId: "compute", path: "fictional.review" }, value: "required" } }, [read, compute]);
    const ucpath = task({ id: "ucpath", label: "Stage termination", contract: ucpathContract, replay: "checkpoint" }, [read, compute, review], ({ input, outputs }) => { if (outputs.compute.fictional.review === "required" && outputs.review?.approved !== true) throw new Error("fictional-separation-review-not-approved"); return { ...outputs.compute.fictional, mode: input.mode }; });
    const kuali = task({ id: "kuali", label: "Finalize separation document", contract: kualiContract, replay: "checkpoint" }, [read, compute, ucpath], ({ outputs }) => outputs.ucpath.fictional);
    const verify = task({ id: "verify", label: "Verify saved document", contract: verifyContract, replay: "checkpoint" }, [kuali], ({ outputs }) => outputs.kuali.fictional);
    return { steps: [[{ key: "read", label: "Read request" }, [read]], [{ key: "compute", label: "Reconcile dates" }, [compute]], [{ key: "review", label: "Resolve ambiguity" }, [review]], [{ key: "ucpath", label: "Stage termination" }, [ucpath]], [{ key: "kuali", label: "Finalize document" }, [kuali]], [{ key: "verify", label: "Verify document" }, [verify]]], result: result(Plan1Output, [verify], ({ input, outputs }) => ({ eid: input.emplId, disposition: outputs.verify.fictional.transaction, providerState: "verified" })) };
  },
}));
export function fictionalSeparationDrivers(ambiguous = false) {
  const kuali = new Map(Object.entries({ ...fictionalSeparationDocument, ...reconcileFictionalSeparation(fictionalSeparationDocument) }));
  if (ambiguous) kuali.set("separationDate", "09/24/2026");
  const ucpath = new Map(Object.entries({ pending: "none" }));
  const driver = <S extends "kuali" | "ucpath">(system: S, fields: Map<string, string>) => ({ system, async read(field: string) { const value = fields.get(field); if (value === undefined) throw new Error(`fictional-${system}-field-unavailable:${field}`); return value; }, async fill(field: string, value: string) { fields.set(field, value); }, async visit(_page: string) {} });
  return { kuali: driver("kuali", kuali), ucpath: driver("ucpath", ucpath) };
}
