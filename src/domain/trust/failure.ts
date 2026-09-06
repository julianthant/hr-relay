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
} from "../ids.js";
import { WriteAuthorityReasonSchema } from "../write-authority-reason.js";

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

/**
 * Project a durable failure without replaying pre-hardening free text. Typed
 * codes, states, digests and action ids remain useful; only opaque sentences
 * (and historical page display strings) are reconstructed.
 */
export function projectFailureForOperator(failureInput: unknown, protectedInput?: boolean): FailureRecord {
  const failure = FailureRecordSchema.parse(failureInput);
  const protectedWorkflow = protectedInput ?? ["separations", "separations-kuali-finalization", "person-lookup"].includes(failure.workflowId);
  const { writeAuthorityReason, subject, ...withoutSubject } = failure;
  const operatorBase = protectedWorkflow ? withoutSubject : { ...withoutSubject, ...(subject === undefined ? {} : { subject }) };
  if (writeAuthorityReason !== undefined) {
    const safeSummary = `${failure.code}: write safety refused without replaying authority-only diagnostic detail`;
    return FailureRecordSchema.parse({
      ...operatorBase,
      summary: safeSummary,
      causeChain: failure.causeChain.map((cause) => ({
        ...cause,
        summary: `${cause.code}: write safety diagnostic detail retained only in authority`,
      })),
      remediation: failure.remediation.map((remediation) => ({
        ...remediation,
        message: "Use the typed write state and approved resolution path; authority evidence remains retained for diagnosis.",
      })),
    });
  }
  if (!protectedWorkflow && failure.diagnosticSafetyVersion === CURRENT_DIAGNOSTIC_SAFETY_VERSION) return failure;
  return FailureRecordSchema.parse({
    ...operatorBase,
    summary: protectedWorkflow && failure.diagnosticSafetyVersion === CURRENT_DIAGNOSTIC_SAFETY_VERSION ? `${failure.code}: protected diagnostic text withheld`
      : `${failure.code}: historical diagnostic text withheld (predates diagnostic safety v1)`,
    causeChain: failure.causeChain.map((cause) => ({
      ...cause,
      summary: `${cause.code}: historical ${cause.role} diagnostic text withheld`,
    })),
    remediation: failure.remediation.map((remediation) => ({
      ...remediation,
      message: `historical ${remediation.kind} text withheld; use the typed failure code and current run state`,
    })),
    ...(failure.page === undefined
      ? {}
      : {
        page: {
          ...(failure.page.screen === undefined ? {} : { screen: failure.page.screen }),
          ...(failure.page.state === undefined ? {} : { state: failure.page.state }),
        },
      }),
  });
}
