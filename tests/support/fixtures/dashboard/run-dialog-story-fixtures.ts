/** Run dialog fixtures for the state gallery: the served workflows, a client that answers what a story scripts, and the answers themselves. Browser-safe. */
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { START_DOOR_ABSENCE } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FrontendBootstrapWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { z } from "zod";
import { RerunValuesRequestSchema, RerunValuesResponseSchema, type RerunValuesResponse } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningWireSchema, type RerunWarningWire } from "../../../../src/models/dashboard/rerun-warning.js";
import { OcrSourceUploadSchema } from "../../../../src/models/ocr/review.js";
import { StartPlanWireSchema, type StartPlanWire } from "../../../../src/models/dashboard/start-plan.js";
import { PreflightReadinessWireSchema, type PreflightCheckId, type PreflightReadinessWire } from "../../../../src/models/preflight/preflight-contract.js";
import { expectedPreflightChecks, mandatoryCapabilitiesForPreflightCheck, RuntimeCapabilitySchema } from "../../../../src/rules/preflight/preflight-semantics.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import intakeSnapshot from "./run-dialog-intake-sessions.json" with { type: "json" };
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../../src/models/intake/wire.js";
import bootstrapSnapshot from "./run-dialog-bootstrap.json" with { type: "json" };

/** The served bootstrap of the one registered workflow, saved so the gallery page stays free of backend modules; run-dialog-bootstrap.integration.test.ts keeps it current. */
export const RUN_DIALOG_BOOTSTRAP = FrontendBootstrapWireSchema.parse(bootstrapSnapshot);
const FIXTURE_BOOTSTRAP = RUN_DIALOG_BOOTSTRAP;
const RUN_ID = "10000000-0000-4000-8000-000000000001";

export const RUN_DIALOG_ACTOR = "local-operator";
export const RUN_DIALOG_WORKFLOW = "person-lookup";
/** An employee number the Person Lookup input accepts. */
export const RUN_DIALOG_TYPED = "10873698";
const HASH = "a".repeat(64);

export const RUN_DIALOG_WORKFLOWS: readonly RunStartWorkflow[] = parseWorkflows(FIXTURE_BOOTSTRAP.workflows).map((entry): RunStartWorkflow => {
  const start = entry.start;
  return {
    workflowId: String(entry.id), label: entry.label, categoryId: entry.categoryId, role: entry.role, icon: entry.icon,
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...(start.summary === undefined ? {} : { summary: start.summary }),
    enqueue: start.enqueue, version: start.version, steps: start.steps,
    ...(start.rows === undefined ? {} : { rows: start.rows }),
    inputRun: start.inputRun === undefined ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] } : { state: "present", surface: start.inputRun },
    spreadsheetIntake: start.spreadsheetIntake, requiredWorkbookFields: start.requiredWorkbookFields, workbookReference: start.workbookReference,
    referenceSources: FIXTURE_BOOTSTRAP.workbookCompatibility.workflows.find(workflow => workflow.workflowId === entry.id)?.sources ?? [],
  };
});

export const RUN_DIALOG_CATALOG = buildWorkflowCatalog(RUN_DIALOG_WORKFLOWS,
  Object.freeze(Object.fromEntries(RUN_DIALOG_WORKFLOWS.map(flow => [flow.workflowId, "served" as const]))));

const catalogOf = (patch: (flow: RunStartWorkflow) => RunStartWorkflow) => buildWorkflowCatalog(RUN_DIALOG_WORKFLOWS.map(patch),
  Object.freeze(Object.fromEntries(RUN_DIALOG_WORKFLOWS.map(flow => [flow.workflowId, "served" as const]))));
const literal = (text: string) => ({ segments: [{ kind: "literal" as const, text }] });
const typedInput = (flow: RunStartWorkflow, supportsDryRun: boolean): RunStartWorkflow => flow.inputRun.state === "present"
  ? { ...flow, inputRun: { state: "present", surface: { ...flow.inputRun.surface, supportsDryRun } } } : flow;
/** The Person Lookup entry as a workflow that can preview without writing: the Options stage then offers Dry run. */
export const RUN_DIALOG_DRY_RUN_CATALOG = catalogOf(flow => typedInput(flow, true));
/** The entry as a workflow that reads its people from a required reference spreadsheet. */
export const RUN_DIALOG_REFERENCE_CATALOG = catalogOf(flow => ({ ...flow, requiredWorkbookFields: ["eid"], workbookReference: { id: "roster-type", keyFieldId: "eid", mode: "keys", writableFields: [] } }));
/** The entry as a workflow with the optional second check. */
export const RUN_DIALOG_CHECK_CATALOG = catalogOf(flow => ({ ...flow, workbookCheck: { id: "reference-check", keyFieldId: "eid" } }));
/** The entry as a PDF workflow: documents in, an OCR switch and a required choice on the Options stage. */
export const RUN_DIALOG_PDF_CATALOG = catalogOf(flow => ({ ...flow, inputRun: { state: "absent", reason: "PDF input" }, uploadRun: {
  pdfInput: { documentField: "document", fileNameField: "fileName", readingIdField: "readingId", fixed: {} }, title: literal("Upload PDFs"),
  fields: [{ kind: "boolean", field: "extractWithOcr", label: "Read with OCR", initial: true, description: "Turn off for text PDFs." },
    { kind: "select", field: "form", label: "Form", required: true, options: [{ value: "i9", label: "I-9" }, { value: "w4", label: "W-4" }] }],
  accepts: [{ mediaType: "application/pdf", extensions: [".pdf"], maxBytes: PositiveIntSchema.parse(25 * 1024 * 1024) }], successMessage: literal("Started."), supportsDryRun: true } }));

/** What the client serves for a PDF the story attaches: the upload as the actor made it, named and sized as sent. */
export const runDialogUpload: DashboardClient["uploadOcrSource"] = async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-26T21:00:00.000Z",
  artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: Array.from(request.bytes.slice(0, 32), byte => byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0") } });

export function runDialogPlan(startPlanId = "5a000000-0000-4000-8000-000000000001"): StartPlanWire {
  return StartPlanWireSchema.parse({
    wireVersion: 1, startPlanId, workflowId: RUN_DIALOG_WORKFLOW, expectedVersion: 4, expiresAt: "2026-08-26T21:47:03.000Z", dryRun: false, priority: "interactive",
    plannedBy: RUN_DIALOG_ACTOR, configSnapshotId: "c0000000-0000-4000-8000-000000000001",
    fingerprints: { descriptorFingerprint: HASH, configFingerprint: HASH, ingressSchemaHash: HASH, canonicalInputSchemaHash: HASH, inputFingerprint: HASH },
    planned: [{ logicalKey: "entry:1", title: "Ada Lovelace", subtitle: "E1234567", matchKey: "eid:E1234567" }], refused: [],
  });
}

export const RUN_DIALOG_APPLIED: CommandResult = CommandResultSchema.parse({ state: "applied", commandId: "3a000000-0000-4000-8000-000000000001",
  affectedTargets: [{ family: "start", workflowId: RUN_DIALOG_WORKFLOW, startPlanId: "5a000000-0000-4000-8000-000000000001", expectedVersion: 4 }] });
export const RUN_DIALOG_CONFLICT: CommandResult = CommandResultSchema.parse({ state: "conflict", commandId: "3a000000-0000-4000-8000-000000000002",
  currentVersion: 7, message: "The start plan was built against version 4." });

export type ServedCheck = Readonly<{ check: PreflightCheckId; status: "pass" | "warning" | "fail"; summary?: string }>;
const ALL_CAPABILITIES = RuntimeCapabilitySchema.options;
/** One served readiness report: every check the capabilities select, passing unless a named check says otherwise; a warned or failed check carries its summary. */
export function runDialogReadiness(checks: readonly ServedCheck[]): PreflightReadinessWire {
  const results = expectedPreflightChecks(ALL_CAPABILITIES).map(({ id }) => {
    const named = checks.find(({ check }) => check === id);
    const status = named?.status ?? "pass";
    const summary = named?.summary ?? `${id} is ${status === "pass" ? "ready" : "not ready"}`;
    return status === "pass" ? { status, check: id, summary }
      : status === "warning" ? { status, check: id, summary, impact: "A feature may be unavailable.", remediation: "Review it." }
      : { status, check: id, summary, blocks: mandatoryCapabilitiesForPreflightCheck(id, ALL_CAPABILITIES), remediation: "Fix it." };
  });
  return PreflightReadinessWireSchema.parse({ state: "present", report: { configFingerprint: HASH, descriptorFingerprint: HASH, checkedAt: "2026-08-26T21:00:00.000Z",
    requestedCapabilities: ALL_CAPABILITIES, results } });
}
export const RUN_DIALOG_READY = runDialogReadiness([]);

/** A client that serves only what the story scripts and READY readiness; reaching for anything else fails the story loudly. */
export function runDialogClient(served: Partial<DashboardClient> = {}): DashboardClient {
  const methods: Partial<DashboardClient> = { readPreflight: async () => RUN_DIALOG_READY, ...served };
  return new Proxy(methods, { get(target, property): unknown {
    const impl: unknown = Reflect.get(target, property);
    if (impl === undefined && typeof property === "string" && property !== "then") throw new Error(`the Run dialog story reached for client.${property}, which it does not serve`);
    return impl;
  } }) as DashboardClient;
}

/** An answer that never arrives: the story holds the state that waits on it. */
export const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

export const RUN_DIALOG_RERUN_SOURCE = { ...RerunValuesRequestSchema.parse({ runId: RUN_ID, expectedVersion: 3 }), label: "Ada Lovelace" };
const STEPS = ["searching", "cross-verify", "active-status"] as const;

/** The entry with its reading steps switchable, so a rerun can leave the steps that already succeeded off. */
export const RUN_DIALOG_RERUN_CATALOG = catalogOf(flow => ({ ...flow, steps: flow.steps.map(step => step.control.state === "required"
  ? { ...step, control: { state: "omittable" as const, form: { fields: [] }, forces: [] } } : step) }));

/** What a Person Lookup run offers a rerun: the typed input it ran on, each step's state (a failed run stops at its last step), and one value to copy. */
export function runDialogRerunSnapshot(outcome: "failed" | "done" = "failed"): RerunValuesResponse {
  return RerunValuesResponseSchema.parse({ state: "available", snapshot: {
    sourceInput: { state: "available", value: { emplId: RUN_DIALOG_TYPED } },
    source: { runId: RUN_ID, version: 3, workflow: RUN_DIALOG_WORKFLOW, descriptorVersion: RUN_DIALOG_WORKFLOWS[0]?.version ?? 1, contractFingerprint: HASH, outcome, dryRun: false, priority: "interactive", browserMode: "headless" },
    steps: STEPS.map((key, index) => { const ok = outcome === "done" || index < 2; return { key, state: ok ? "completed" : "failed",
      nodes: [{ nodeId: key, state: ok ? "completed" : "failed", reason: ok ? "checkpoint" : "failure" }] }; }),
    values: [{ state: "available", sourceStepKey: "searching", nodeId: "searching", fieldPath: "emplId", label: "Employee ID", targetFieldPath: "emplId", value: RUN_DIALOG_TYPED,
      checkpoint: { attempt: 1, writtenAt: "2026-08-26T20:00:00.000Z" },
      provenance: { path: "emplId", source: "live", observedAt: "2026-08-26T20:00:00.000Z", originalObservedAt: "2026-08-26T20:00:00.000Z" } }],
    transactions: [],
  } });
}

/** The entry as a write workflow that files one UCPath transaction and then verifies it; every step can be left off. */
const WRITE_STEPS = [["sign-in", "Sign in to UCPath"], ["submit", "Submit work-study transaction"], ["verify", "Verify the saved transaction"]] as const;
export const RUN_DIALOG_WRITE_RERUN_CATALOG = catalogOf(flow => {
  const [template] = flow.steps; if (template === undefined) throw new Error("the fixture workflow has no step");
  return { ...flow, label: "Work-Study", steps: WRITE_STEPS.map(([key, label]) => ({ ...template, key, label,
    control: { state: "omittable" as const, form: { fields: [] }, forces: [] } })) };
});
const WRITE_RECEIPT = { nodeId: "submit", taskId: "ucpath/work-study-submit", writeIntentId: "20000000-0000-4000-8000-000000000002", evidenceDigest: HASH } as const;

/** A Work-Study run cancelled while verifying: it signed in and filed its transaction, and the filing's receipt is the source's own. */
export function runDialogWriteRerunSnapshot(): RerunValuesResponse {
  return RerunValuesResponseSchema.parse({ state: "available", snapshot: {
    sourceInput: { state: "available", value: { emplId: RUN_DIALOG_TYPED } },
    source: { runId: RUN_ID, version: 3, workflow: RUN_DIALOG_WORKFLOW, descriptorVersion: RUN_DIALOG_WORKFLOWS[0]?.version ?? 1, contractFingerprint: HASH, outcome: "cancelled", dryRun: false, priority: "interactive", browserMode: "headless" },
    steps: WRITE_STEPS.map(([key], index) => { const state = index < 2 ? "completed" : "unfinished";
      return { key, state, nodes: [{ nodeId: key, state, reason: key === "submit" ? "settled-transaction" : index < 2 ? "checkpoint" : "incomplete-execution" }] }; }),
    values: [], transactions: [{ stepKey: "submit", ...WRITE_RECEIPT, disposition: "committed" }],
  } });
}

/** The repeat warning for that Work-Study source once its filing step is switched back on. */
export function runDialogWriteRerunWarning(): RerunWarningWire {
  return RerunWarningWireSchema.parse({ workflowId: RUN_DIALOG_WORKFLOW, rerun: {
    source: { runId: RUN_ID, expectedVersion: 3, intent: "rerun", selectedStepKeys: ["submit", "verify"] },
    warnings: [{ ...WRITE_RECEIPT, system: "ucpath", businessKeyDigest: HASH }], warningDigest: HASH,
  } });
}

/** A warning that the source already filed a transaction the rerun would file again. */
export function runDialogRerunWarning(repeats = true): RerunWarningWire {
  return RerunWarningWireSchema.parse({ workflowId: RUN_DIALOG_WORKFLOW, rerun: {
    source: { runId: RUN_ID, expectedVersion: 3, intent: "rerun", selectedStepKeys: [...STEPS] },
    warnings: !repeats ? [] : [{ nodeId: "active-status", taskId: "ucpath/active-status", system: "ucpath", businessKeyDigest: HASH,
      writeIntentId: "20000000-0000-4000-8000-000000000001", evidenceDigest: HASH }],
    warningDigest: HASH,
  } });
}

/** The four intake sessions of the served fixture, saved like the bootstrap; run-dialog-intake.integration.test.ts keeps them current. */
const INTAKE_KEYS = ["mapping", "validated", "manifest", "rerun"] as const;
export const RUN_DIALOG_INTAKE = z.strictObject({
  ids: z.strictObject(Object.fromEntries(INTAKE_KEYS.map(key => [key, z.string()])) as Record<(typeof INTAKE_KEYS)[number], z.ZodString>),
  sessions: z.record(z.string(), IntakeSessionWireSchema),
}).parse(intakeSnapshot);
export const intakeSession = (key: (typeof INTAKE_KEYS)[number], change: Record<string, unknown> = {}): IntakeSessionWire =>
  IntakeSessionWireSchema.parse({ ...RUN_DIALOG_INTAKE.sessions[RUN_DIALOG_INTAKE.ids[key]], ...change });
