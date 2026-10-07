import { z } from "zod";
import { compileWorkflow, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineBrowserStore, defineServiceStore, defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { declareDriverFor, defineTask, type BrowserDriver } from "../../../src/workflow-kit/task.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { ScenarioIdSchema, taskId } from "../../../src/rules/identity/ids.js";
import { renderOperationTemplate, type OperationTemplate, type TaskOperationAction } from "../../../src/models/workflow/operation-display.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import type { DataPoint } from "../../../src/rules/workflow/task-provenance.js";
import { runDeclaredAction } from "../../../src/backend/systems/browser-shared/action-notes.js";
import { kualiSession } from "../../../src/backend/systems/kuali/session-provider.js";
import { ucpathSession } from "../../../src/backend/systems/ucpath/session-provider.js";
import { Plan1Input, Plan1CanonicalInput, Plan1Output } from "./plan1-operation-workflows.js";
import { fixtureBuildManifest } from "./workflow-definition-fixtures.js";

const slotName = (field: string) => field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
const fieldLabel = (field: string) => ({ employee: "Employee ID", documentNumber: "Document number", lastDayWorked: "Last day worked", separationDate: "Separation date", holidayPay: "Holiday pay", department: "Department", title: "Job title", reason: "Reason", effectiveDate: "Termination effective date", comments: "Comments", managerComments: "Manager comments", template: "Template", transaction: "Transaction number", finalPay: "Final pay" })[field as keyof typeof fictionalSeparationDocument] ?? field;
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
export const separationCommentTemplate: OperationTemplate = { id: "separation-comment", variables: [{ id: "effective", slot: "effective-date" }, { id: "last-day", slot: "last-day-worked" }, { id: "holiday", slot: "holiday-pay" }, { id: "document", slot: "document-number" }], segments: [
  { kind: "literal", value: "Termination eff " }, { kind: "variable", variable: "effective" }, { kind: "literal", value: ". Last Day Worked " }, { kind: "variable", variable: "last-day" }, { kind: "literal", value: "." },
  { kind: "optional", when: { kind: "is-present", variable: "holiday" }, segments: [{ kind: "literal", value: " Holiday Pay on " }, { kind: "variable", variable: "holiday" }, { kind: "literal", value: "." }] },
  { kind: "literal", value: " Kuali form #" }, { kind: "variable", variable: "document" }, { kind: "literal", value: "." },
], join: { separator: "", trim: "none" } };
export function reconcileFictionalSeparation(input: unknown): DraftFields {
  const source = documentFields.parse(input);
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(source.separationDate);
  if (date === null) throw new Error("fictional-separation-date-unparseable");
  const next = new Date(Date.UTC(Number(date[3]), Number(date[1]) - 1, Number(date[2]) + 1));
  const effectiveDate = `${String(next.getUTCMonth() + 1).padStart(2, "0")}/${String(next.getUTCDate()).padStart(2, "0")}/${next.getUTCFullYear()}`;
  const comments = renderOperationTemplate(separationCommentTemplate, { effective: effectiveDate, "last-day": source.lastDayWorked, holiday: source.holidayPay, document: source.documentNumber });
  return draftFields.parse({ ...source, effectiveDate, comments, managerComments: comments, template: "UC_VOL_TERM", pending: "none", transaction: "SIM-042", finalPay: "Does not need final pay · student", mode: "confirmed", review: source.separationDate < source.lastDayWorked ? "required" : "not-required" });
}
const recordFields = (value: Record<string, string>): DataPoint[] => [{ direction: "read", field: "fictional", value }];
const common = { subject: { kind: "none" as const, reason: "Fictional separation form; no HR authority or external effects" }, errorCodes: ["document-read-timeout"] as const, scenarios: [scenario], freshness: { defaultMaxAgeMs: 0 }, provenance: { default: "live" as const } };
const readActions = Object.keys(fictionalSeparationDocument).flatMap((field): TaskOperationAction[] => [{ id: `read-${field.toLowerCase()}`, kind: "read-field", label: fieldLabel(field), target: `kuali.fixture.${field.toLowerCase()}`, valueSlot: slotName(field), confirmationActionId: `verify-${field.toLowerCase()}` }, { id: `verify-${field.toLowerCase()}`, kind: "verify" }]);
const readContract = defineTaskContract({ ...common, id: taskId("kuali/read-separation-document"), title: "Read separation request", effect: "read", input: Plan1Input, output: z.strictObject({ fictional: documentFields }), example: { fictional: fictionalSeparationDocument },
  operation: { version: 1, id: "fictional-separation-read", system: "kuali", session: { kind: "browser", id: "fictional-kuali", system: "kuali" }, page: { screen: "kuali.fixture.separation", form: "separation-request" }, values: Object.keys(fictionalSeparationDocument).map((id) => ({ id: slotName(id), presentation: "local-operator" as const, source: { kind: "contract-output" as const, path: `fictional.${id}` } })), actions: [{ id: "request", kind: "open-page", label: "RRSS Separation Request", children: readActions }] },
});
const readTask = defineTask(kualiDriver, readContract, { sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }], async run({ ctx }) {
  await ctx.driver.visit("request");
  const fields: Record<string, string> = {};
  for (const field of Object.keys(fictionalSeparationDocument)) fields[field] = await runDeclaredAction({ id: `read-${field.toLowerCase()}`, kind: "read", targetId: `kuali.fixture.${field.toLowerCase()}` }, () => ctx.driver.read(field), (value) => value, { id: `verify-${field.toLowerCase()}`, targetId: `verify-${field.toLowerCase()}`, verify: async (value) => value === await ctx.driver.read(field) });
  const result = documentFields.parse(fields);
  ctx.recordData(recordFields(result));
  return { fictional: result };
} });
const computeContract = defineTaskContract({ ...common, id: taskId("ocr/extract-form-page"), title: "Reconcile separation dates", effect: "read", input: documentFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) }, operation: {
  version: 1, id: "reconcile-dates", system: "local", session: { kind: "local", id: "fictional-calculation" }, values: ["lastDayWorked", "separationDate", "effectiveDate", "comments", "managerComments"].map((id) => ({ id: slotName(id), presentation: "local-operator" as const, source: { kind: "contract-output" as const, path: `fictional.${id}` } })),
  transforms: [{ id: "reconcile", input: documentFields, output: draftFields, example: fictionalSeparationDocument, derive: reconcileFictionalSeparation }], actions: ["lastDayWorked", "separationDate", "effectiveDate", "comments", "managerComments"].flatMap((field): TaskOperationAction[] => [{ id: `compute-${field.toLowerCase()}`, kind: "compute", label: fieldLabel(field), valueSlot: slotName(field), transform: "reconcile", confirmationActionId: `verify-${field.toLowerCase()}` }, { id: `verify-${field.toLowerCase()}`, kind: "verify" }]),
} });
const computeTask = defineTask(computeContract, { sessions: [], async run({ input, ctx }) {
  const fields = reconcileFictionalSeparation(input);
  for (const field of ["lastDayWorked", "separationDate", "effectiveDate", "comments", "managerComments"] as const) await runDeclaredAction({ id: `compute-${field.toLowerCase()}`, kind: "computed", targetId: `compute-${field.toLowerCase()}` }, async () => fields[field], (value) => value, { id: `verify-${field.toLowerCase()}`, targetId: `verify-${field.toLowerCase()}`, verify: async (value) => value === reconcileFictionalSeparation(input)[field] });
  if (fields.review === "required") ctx.log.warn("Separation date precedes the last day worked. Explicit operator confirmation is required before staging.");
  ctx.recordData(recordFields(fields));
  return { fictional: fields };
} });
const ucpathFields = ["employee", "template", "reason", "effectiveDate", "lastDayWorked", "comments", "managerComments"] as const;
const kualiFields = ["department", "title", "lastDayWorked", "separationDate", "effectiveDate", "transaction", "finalPay", "comments"] as const;
const stageValues = Object.keys(draftFields.shape).filter((field) => field !== "mode" && field !== "review").map((id) => ({ id: slotName(id), presentation: "local-operator" as const, source: { kind: "contract-input" as const, path: id } }));
const fillActions = (system: "kuali" | "ucpath", fields: readonly string[]): TaskOperationAction[] => fields.flatMap((field) => [{ id: `fill-${field.toLowerCase()}`, kind: "fill-field" as const, label: fieldLabel(field), target: `${system}.fixture.${field.toLowerCase()}`, valueSlot: slotName(field), ...(field === "comments" || field === "managerComments" ? { templateId: separationCommentTemplate.id } : {}), confirmationActionId: `verify-${field.toLowerCase()}` }, { id: `verify-${field.toLowerCase()}`, kind: "verify" as const, children: [{ id: `read-staged-${field.toLowerCase()}`, kind: "read-field" as const, label: `Read back ${fieldLabel(field)}`, target: `${system}.fixture.${field.toLowerCase()}`, valueSlot: `staged-${slotName(field)}` }] }]);
const ucpathContract = defineTaskContract({ ...common, id: taskId("ucpath/search-person-org"), title: "Stage termination", effect: "read", input: draftFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) }, operation: { version: 1, id: "stage-termination", system: "ucpath", session: { kind: "browser", id: "fictional-ucpath", system: "ucpath" }, page: { screen: "ucpath.fixture.termination", form: "termination" }, values: [...stageValues, ...ucpathFields.map((id) => ({ id: `staged-${slotName(id)}`, presentation: "local-operator" as const, source: { kind: "contract-output" as const, path: `fictional.${id}` } }))], templates: [separationCommentTemplate], actions: [{ id: "pending", kind: "open-page", label: "Transactions in Progress", outcomes: [{ id: "none", label: "No pending terminations", when: { kind: "equals", variable: "pending", value: "none" }, continuation: "termination" }], children: [{ id: "read-pending", kind: "read-field", label: "Pending termination rows", target: "ucpath.fixture.pending", valueSlot: "pending", confirmationActionId: "verify-pending" }, { id: "verify-pending", kind: "verify" }] }, { id: "termination", kind: "open-page", label: "Smart HR transaction", children: fillActions("ucpath", ucpathFields) }] } });
async function stageFields(driver: FieldsDriver, fields: readonly string[], input: DraftFields) {
  const staged = { ...input };
  for (const field of fields) {
    const expected = input[field as keyof DraftFields];
    await runDeclaredAction({ id: `fill-${field.toLowerCase()}`, kind: "typed", targetId: `${driver.system}.fixture.${field.toLowerCase()}` }, async () => { await driver.fill(field, expected); return expected; }, (value) => value, { id: `verify-${field.toLowerCase()}`, targetId: `verify-${field.toLowerCase()}`, verify: async () => expected === await runDeclaredAction({ id: `read-staged-${field.toLowerCase()}`, kind: "read", targetId: `${driver.system}.fixture.${field.toLowerCase()}` }, () => driver.read(field), (value) => value) });
    staged[field as keyof DraftFields] = await driver.read(field);
  }
  return draftFields.parse(staged);
}
const ucpathTask = defineTask(ucpathDriver, ucpathContract, { sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
  await ctx.driver.visit("pending");
  await runDeclaredAction({ id: "read-pending", kind: "read", targetId: "ucpath.fixture.pending" }, () => ctx.driver.read("pending"), (value) => value, { id: "verify-pending", targetId: "verify-pending", verify: async (value) => value === await ctx.driver.read("pending") });
  await ctx.driver.visit("termination");
  const result = await stageFields(ctx.driver, ucpathFields, input);
  ctx.recordData(recordFields(result));
  return { fictional: result };
} });
const kualiContract = defineTaskContract({ ...common, id: taskId("kuali/match-separation-finalization"), title: "Finalize separation document", effect: "read", input: draftFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) }, operation: { version: 1, id: "finalize-document", system: "kuali", session: { kind: "browser", id: "fictional-kuali", system: "kuali" }, page: { screen: "kuali.fixture.finalization", form: "finalization" }, values: [...stageValues, ...kualiFields.map((id) => ({ id: `staged-${slotName(id)}`, presentation: "local-operator" as const, source: { kind: "contract-output" as const, path: `fictional.${id}` } }))], templates: [separationCommentTemplate], actions: [{ id: "initial", kind: "open-page", label: "RRSS Separation Request", children: fillActions("kuali", kualiFields.slice(0, 2)) }, { id: "continued", kind: "resume-page", continuedFrom: "initial", label: "RRSS Separation Request · continued", children: fillActions("kuali", kualiFields.slice(2)) }] } });
const kualiTask = defineTask(kualiDriver, kualiContract, { sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }], async run({ input, ctx }) { await ctx.driver.visit("finalization"); const result = await stageFields(ctx.driver, kualiFields, input); ctx.recordData(recordFields(result)); return { fictional: result }; } });
const verifyContract = defineTaskContract({ ...common, id: taskId("kuali/verify-separation-finalization"), title: "Verify saved separation document", effect: "read", input: draftFields, output: z.strictObject({ fictional: draftFields }), example: { fictional: reconcileFictionalSeparation(fictionalSeparationDocument) }, operation: { version: 1, id: "verify-document", system: "kuali", session: { kind: "browser", id: "fictional-kuali", system: "kuali" }, page: { screen: "kuali.fixture.finalization", form: "finalization" }, values: Object.keys(draftFields.shape).map((id) => ({ id: slotName(id), presentation: "local-operator" as const, source: { kind: "contract-output" as const, path: `fictional.${id}` } })), actions: [{ id: "reloaded", kind: "open-page", label: "RRSS Separation Request · reloaded", outcomes: [{ id: "verified", label: "Document fields match", when: { kind: "is-present", variable: "transaction" } }], children: kualiFields.flatMap((field): TaskOperationAction[] => [{ id: `read-${field.toLowerCase()}`, kind: "read-field", label: fieldLabel(field), target: `kuali.fixture.${field.toLowerCase()}`, valueSlot: slotName(field), confirmationActionId: `verify-${field.toLowerCase()}` }, { id: `verify-${field.toLowerCase()}`, kind: "verify" }]) }] } });
const verifyTask = defineTask(kualiDriver, verifyContract, { sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
  await ctx.driver.visit("reloaded");
  const result = { ...input };
  for (const field of kualiFields) result[field] = await runDeclaredAction({ id: `read-${field.toLowerCase()}`, kind: "read", targetId: `kuali.fixture.${field.toLowerCase()}` }, async () => { if (input.mode === "fail") ctx.fail("document-read-timeout", "Fictional document session expired; document fields unavailable after reload.", { transient: true }); return ctx.driver.read(field); }, (value) => value, { id: `verify-${field.toLowerCase()}`, targetId: `verify-${field.toLowerCase()}`, verify: async (value) => value === input[field] });
  const parsed = draftFields.parse(result);
  ctx.recordData(recordFields(parsed));
  return { fictional: parsed };
} });
export const plan1SeparationStores = defineTaskStoreRegistry([defineServiceStore("ocr", { reconcile: computeTask }), defineBrowserStore("kuali", kualiDriver, kualiSession, { read: readTask, stage: kualiTask, verify: verifyTask }), defineBrowserStore("ucpath", ucpathDriver, ucpathSession, { stage: ucpathTask })], { scenarioIds: [scenario], tasks: [readContract, computeContract, ucpathContract, kualiContract, verifyContract].map(({ id, effect }) => ({ id, effect })) });
const stagedBindings = (afterUcpath = false) => stageValues.map(({ id, source }) => {
  const field = source.path;
  if (afterUcpath && ucpathFields.some((item) => item === field)) return { slot: id, value: { kind: "task-output" as const, entryId: "ucpath", path: `fictional.${field}` } };
  if (["lastDayWorked", "separationDate", "effectiveDate", "comments", "managerComments"].includes(field)) return { slot: id, value: { kind: "task-output" as const, entryId: "compute", path: `fictional.${field}` } };
  if (Object.hasOwn(fictionalSeparationDocument, field)) return { slot: id, value: { kind: "task-output" as const, entryId: "read", path: `fictional.${field}` } };
  const constants: Record<string, string> = { template: "UC_VOL_TERM", pending: "none", transaction: "SIM-042", finalPay: "Does not need final pay · student" };
  const value = constants[field];
  if (value === undefined) throw new Error(`fictional-binding-unavailable:${field}`);
  return { slot: id, value: { kind: "constant" as const, value } };
});
export const plan1SeparationWorkflow = compileWorkflow(defineWorkflow({ id: "fixture-plan1-separation", version: 1, code: "fps", label: "Fictional separation", icon: "Search", category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Plan1Input>) => input.emplId }, presentation: { title: () => "Fictional separation" }, scenarios: ["fixture-separation/confirmed-actions"] as const, role: defineWorkflowRole({ kind: "standalone" }),
  operationDisplay: { capability: "complete", version: 1, invocations: [
    { id: "read-operation", entryId: "read", contractRole: "task", occurrencePath: ["read"], bindings: [] },
    { id: "compute-operation", entryId: "compute", contractRole: "task", occurrencePath: ["compute"], bindings: [] },
    { id: "ucpath-operation", entryId: "ucpath", contractRole: "task", occurrencePath: ["ucpath"], bindings: stagedBindings() },
    { id: "kuali-operation", entryId: "kuali", contractRole: "task", occurrencePath: ["kuali"], bindings: stagedBindings(true) },
    { id: "verify-operation", entryId: "verify", contractRole: "task", occurrencePath: ["verify"], bindings: [] },
  ], presentation: [{ id: "read-node", kind: "operation", invocationId: "read-operation" }, { id: "compute-node", kind: "operation", invocationId: "compute-operation" }, { id: "review-node", kind: "operator-gate", entryId: "review" }, { id: "ucpath-node", kind: "operation", invocationId: "ucpath-operation" }, { id: "kuali-node", kind: "operation", invocationId: "kuali-operation" }, { id: "verify-node", kind: "operation", invocationId: "verify-operation" }] },
  steps: ({ task, gate, result }) => {
    const read = task({ id: "read", label: "Read separation request", contract: readContract, replay: "checkpoint" }, [], ({ input }) => input);
    const compute = task({ id: "compute", label: "Reconcile dates", contract: computeContract, replay: "checkpoint" }, [read], ({ outputs }) => outputs.read.fictional);
    const review = gate({ id: "review", label: "Resolve conflicting separation dates", statusKey: "awaitingReview", result: z.strictObject({ approved: z.boolean() }), when: { kind: "equals", of: { from: "node", nodeId: "compute", path: "fictional.review" }, value: "required" } }, [read, compute]);
    const ucpath = task({ id: "ucpath", label: "Stage termination", contract: ucpathContract, replay: "checkpoint" }, [read, compute, review], ({ input, outputs }) => { if (outputs.compute.fictional.review === "required" && outputs.review?.approved !== true) throw new Error("fictional-separation-review-not-approved"); return { ...outputs.compute.fictional, mode: input.mode }; });
    const kuali = task({ id: "kuali", label: "Finalize separation document", contract: kualiContract, replay: "checkpoint" }, [read, compute, ucpath], ({ outputs }) => outputs.ucpath.fictional);
    const verify = task({ id: "verify", label: "Verify saved document", contract: verifyContract, replay: "checkpoint" }, [kuali], ({ outputs }) => outputs.kuali.fictional);
    return { steps: [[{ key: "read", label: "Read request" }, [read]], [{ key: "compute", label: "Reconcile dates" }, [compute]], [{ key: "review", label: "Resolve ambiguity" }, [review]], [{ key: "ucpath", label: "Stage termination" }, [ucpath]], [{ key: "kuali", label: "Finalize document" }, [kuali]], [{ key: "verify", label: "Verify document" }, [verify]]], result: result(Plan1Output, [verify], ({ input, outputs }) => ({ eid: input.emplId, disposition: outputs.verify.fictional.transaction, providerState: "verified" })) };
  },
}), { manifest: fixtureBuildManifest(["fixture-plan1-separation"]) });
export function fictionalSeparationDrivers(ambiguous = false) {
  const kuali = new Map(Object.entries({ ...fictionalSeparationDocument, ...reconcileFictionalSeparation(fictionalSeparationDocument) }));
  if (ambiguous) kuali.set("separationDate", "09/24/2026");
  const ucpath = new Map(Object.entries({ pending: "none" }));
  const driver = <S extends "kuali" | "ucpath">(system: S, fields: Map<string, string>) => ({ system, async read(field: string) { const value = fields.get(field); if (value === undefined) throw new Error(`fictional-${system}-field-unavailable:${field}`); return value; }, async fill(field: string, value: string) { fields.set(field, value); }, async visit(_page: string) {} });
  return { kuali: driver("kuali", kuali), ucpath: driver("ucpath", ucpath) };
}
