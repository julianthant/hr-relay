import { z } from "zod";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { ERROR_CATALOG } from "../failures/error-catalog.js";
import { PreflightReadinessWireSchema } from "../preflight/preflight-contract.js";
import { clientCauseRowAccepted } from "../failures/error-origins.js";
import { BulkRunCommandResponseSchema, CommandRejectionCodeSchema, CommandResultSchema } from "../../rules/commands/commands.js";
export const DashboardErrorReportSchema = z.strictObject({
  reportId: z.uuid(), clientId: z.string().min(1).max(128), release: z.string().min(1).max(128),
  route: z.string().min(1).max(512), surface: z.string().min(1).max(128), code: z.string().min(1).max(128),
  message: z.string().max(32768), stack: z.string().max(32768).optional(),
  runId: RunIdSchema.optional(),
  reason: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/u).optional(),
});
export type DashboardErrorReport = z.infer<typeof DashboardErrorReportSchema>;

/** The fixed message of a failed-request report; a report that is neither this nor an unhandled error carries one closed cause row. */
export const DASHBOARD_REQUEST_REPORT_MESSAGE = "Dashboard request did not complete successfully";
/** An unhandled browser error that no closed cause row names. */
export const DASHBOARD_UNHANDLED_ERROR = "DASHBOARD_UNHANDLED_ERROR";

export function dashboardReportAccepted(report: DashboardErrorReport): boolean {
  if (report.code === DASHBOARD_UNHANDLED_ERROR) return true;
  return report.message === DASHBOARD_REQUEST_REPORT_MESSAGE ? report.stack === undefined : clientCauseRowAccepted(report);
}

const FailureOutcomeSchema = z.object({ state: z.enum(["error", "failed", "refused", "rejected", "conflict", "unknown", "uncertain", "unavailable"]), code: z.string().optional() });
const TRANSPORT_CODES = new Set(["SCHEMA_INVALID", "INTERNAL_FAILURE", "REQUEST_IDENTITY_REFUSED", "ROUTE_NOT_FOUND", "SECTION_UNAVAILABLE", "PROJECTION_DEGRADED", "DEBUG_REPORT_INVALID", "DEBUG_REPORT_RATE_LIMIT", "DEBUG_REPORT_SIZE_LIMIT"]);

export function debugFailureOutcome(value: unknown, status = 200) {
  const readiness = status === 200 ? PreflightReadinessWireSchema.safeParse(value) : undefined;
  if (readiness?.success && readiness.data.state === "unavailable" && readiness.data.code === "PREFLIGHT_EVIDENCE_EXPIRED"
    && readiness.data.lastCompleted !== undefined) return undefined;
  if (z.object({ state: z.literal("signed-out"), remoteRevocation: z.literal("unconfirmed") }).safeParse(value).success) {
    return { code: "CHATGPT_AUTH_UNAVAILABLE", reason: "remote-revocation-unconfirmed" };
  }
  const parsed = FailureOutcomeSchema.safeParse(value);
  if (!parsed.success && status < 400) return undefined;
  const state = parsed.success ? parsed.data.state : "error";
  const code = parsed.success && parsed.data.code !== undefined
    && (Object.hasOwn(ERROR_CATALOG, parsed.data.code) || TRANSPORT_CODES.has(parsed.data.code) || CommandRejectionCodeSchema.safeParse(parsed.data.code).success)
    ? parsed.data.code : state === "conflict" ? "COMMAND_CONFLICT" : state === "rejected" || state === "refused" ? "COMMAND_REFUSED" : "DASHBOARD_READ_FAILED";
  const uncertain = state === "unknown" || state === "uncertain";
  return { code, reason: uncertain ? "outcome-unknown" : state === "refused" || state === "rejected" || state === "conflict" ? "operation-refused" : "operation-failed" };
}

export function debugFailureOutcomes(value: unknown, status = 200): (NonNullable<ReturnType<typeof debugFailureOutcome>> & { correlationId?: string })[] {
  const command = CommandResultSchema.safeParse(value);
  if (command.success && (command.data.state === "applied" || command.data.state === "already-applied") && command.data.workerStartup !== undefined) {
    const startup = command.data.workerStartup;
    return [{ code: startup.code, reason: startup.state === "unknown" ? "outcome-unknown" : "operation-refused",
      correlationId: startup.commandId ?? command.data.commandId }];
  }
  const bulk = BulkRunCommandResponseSchema.safeParse(value);
  if (bulk.success && bulk.data.state === "vector") return bulk.data.results.flatMap(result => {
    if (result.outcome === "applied") return [];
    const failure = debugFailureOutcome({ state: result.outcome === "errored" ? "error" : result.outcome,
      code: "code" in result ? result.code : undefined });
    return failure === undefined ? [] : [{ ...failure, correlationId: result.commandId }];
  });
  const failure = debugFailureOutcome(value, status);
  return failure === undefined ? [] : [failure];
}

const DIAGNOSTIC_ROUTE_ROOTS = new Set(["application-lifecycle", "bootstrap", "calendar", "dashboard", "search", "exports", "commands", "settings", "preflight", "profile", "runs", "queue", "start-plans", "rerun-warnings", "intake", "ocr", "workbooks", "assistant", "storage", "notifications", "explorer", "reports", "data", "trust"]);

export function diagnosticRequestRoute(path: string): string {
  const root = path.split(/[?#]/u)[0]?.split("/")[3];
  return root !== undefined && DIAGNOSTIC_ROUTE_ROOTS.has(root) ? `/api/v1/${root}` : "/api/v1";
}
