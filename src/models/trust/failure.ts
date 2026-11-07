import { z } from "zod";
import {
  DiagnosticBundleIdSchema,
  ElementIdSchema,
  ErrorCodeSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  PageStateIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  ScreenIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  WriteBindingProofIdSchema,
} from "../../rules/identity/ids.js";
import { operatorFailureSentence } from "../failures/error-catalog.js";
import { WriteAuthorityReasonSchema } from "../../rules/write-safety/write-authority-reason.js";

export const WriteStateSchema = z.enum([
  "not-attempted", "prepared", "attempting", "committed", "verified", "unknown",
]);

/** Absent on durable rows written before diagnostic projection was hardened. */
export const DiagnosticSafetyVersionSchema = z.literal(1);
export const CURRENT_DIAGNOSTIC_SAFETY_VERSION = 1 as const;

export const SubjectEvidenceWireSchema = z.strictObject({
  kind: z.enum(["eid", "name", "email", "kuali-id", "file", "catalog"]),
  digest: FailureFingerprintSchema,
  displayRedacted: z.string().min(1).optional(),
});

export const FailureCauseSchema = z.strictObject({
  code: ErrorCodeSchema,
  summary: z.string().min(1),
  role: z.enum(["primary", "secondary"]),
  transient: z.boolean(),
});

export const RemediationActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("retry-when-served"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("operator-action"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("configuration"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("code-change"), message: z.string().min(1) }),
  z.strictObject({ kind: z.literal("no-safe-action"), message: z.string().min(1) }),
]);

const FailureSubjectSchema = z.strictObject({
  expected: SubjectEvidenceWireSchema.optional(),
  observed: SubjectEvidenceWireSchema.optional(),
  proofRef: WriteBindingProofIdSchema.optional(),
}).superRefine((subject, context) => {
  if (subject.expected === undefined && subject.observed === undefined && subject.proofRef === undefined) {
    context.addIssue({ code: "custom", message: "failure subject cannot be empty" });
  }
});

const FailurePageSchema = z.strictObject({
  screen: ScreenIdSchema.optional(),
  state: PageStateIdSchema.optional(),
  urlRedacted: z.string().min(1).optional(),
  titleRedacted: z.string().min(1).optional(),
}).superRefine((page, context) => {
  if (Object.keys(page).length === 0) context.addIssue({ code: "custom", message: "failure page cannot be empty" });
});

const FailureActionSchema = z.strictObject({
  elementId: ElementIdSchema.optional(),
  operation: z.enum(["goto", "wait", "read", "fill", "click", "choose", "commit"]).optional(),
  sequence: PositiveIntSchema.optional(),
}).superRefine((action, context) => {
  if (Object.keys(action).length === 0) context.addIssue({ code: "custom", message: "failure action cannot be empty" });
});

export const FailureRecordSchema = z.strictObject({
  diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
  failureId: FailureIdSchema,
  fingerprint: FailureFingerprintSchema,
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  attempt: PositiveIntSchema,
  workflowId: WorkflowIdSchema,
  nodeId: NodeIdSchema.optional(),
  taskId: TaskIdSchema.optional(),
  code: ErrorCodeSchema,
  summary: z.string().min(1),
  transient: z.boolean(),
  writeState: WriteStateSchema,
  subject: FailureSubjectSchema.optional(),
  page: FailurePageSchema.optional(),
  action: FailureActionSchema.optional(),
  causeChain: z.array(FailureCauseSchema).min(1).max(12),
  diagnosticBundleId: DiagnosticBundleIdSchema.optional(),
  debug: z.strictObject({
    stack: z.string(), causes: z.array(z.string()).max(12),
    originalBytes: z.number().int().nonnegative(), omittedBytes: z.number().int().nonnegative(),
  }).optional(),
  remediation: z.array(RemediationActionSchema).min(1),
  /** Authority-only; every operator projection removes this classified evidence reference. */
  writeAuthorityReason: WriteAuthorityReasonSchema.optional(),
  occurredAt: IsoInstantSchema,
}).superRefine((failure, context) => {
  const primary = failure.causeChain.filter(({ role }) => role === "primary");
  if (primary.length !== 1) {
    context.addIssue({ code: "custom", path: ["causeChain"], message: "failure cause chain requires exactly one primary cause" });
  }
  if (primary[0]?.transient !== failure.transient) {
    context.addIssue({ code: "custom", path: ["transient"], message: "failure transient flag must match the primary cause" });
  }
  if ((failure.writeState === "attempting" || failure.writeState === "unknown") && failure.action?.operation !== "commit") {
    context.addIssue({ code: "custom", path: ["action"], message: "attempting or unknown write state requires a commit action" });
  }
});

export type FailureRecord = z.infer<typeof FailureRecordSchema>;

function subjectEvidence(evidence: z.infer<typeof SubjectEvidenceWireSchema>) {
  return { kind: evidence.kind, digest: evidence.digest };
}

/** Catalog sentence for the code. Protected input drops raw diagnostic text. */
export function projectFailureForOperator(failureInput: unknown, protectedInput = false): FailureRecord {
  const failure = FailureRecordSchema.parse(failureInput);
  const summary = operatorFailureSentence(failure.code);
  if (!protectedInput) return FailureRecordSchema.parse({ ...failure, summary });
  const subject = failure.subject === undefined ? undefined : {
    ...(failure.subject.expected === undefined ? {} : { expected: subjectEvidence(failure.subject.expected) }),
    ...(failure.subject.observed === undefined ? {} : { observed: subjectEvidence(failure.subject.observed) }),
    ...(failure.subject.proofRef === undefined ? {} : { proofRef: failure.subject.proofRef }),
  };
  const page = failure.page === undefined ? undefined : {
    ...(failure.page.screen === undefined ? {} : { screen: failure.page.screen }),
    ...(failure.page.state === undefined ? {} : { state: failure.page.state }),
  };
  return FailureRecordSchema.parse({
    ...(failure.diagnosticSafetyVersion === undefined ? {} : { diagnosticSafetyVersion: failure.diagnosticSafetyVersion }),
    failureId: failure.failureId,
    fingerprint: failure.fingerprint,
    runId: failure.runId,
    traceId: failure.traceId,
    attempt: failure.attempt,
    workflowId: failure.workflowId,
    ...(failure.nodeId === undefined ? {} : { nodeId: failure.nodeId }),
    ...(failure.taskId === undefined ? {} : { taskId: failure.taskId }),
    code: failure.code,
    summary,
    transient: failure.transient,
    writeState: failure.writeState,
    ...(subject === undefined || Object.keys(subject).length === 0 ? {} : { subject }),
    ...(page === undefined || Object.keys(page).length === 0 ? {} : { page }),
    ...(failure.action === undefined ? {} : { action: failure.action }),
    causeChain: failure.causeChain.map(cause => ({ ...cause, summary })),
    remediation: failure.remediation.map(action => ({ ...action, message: summary })),
    occurredAt: failure.occurredAt,
  });
}
