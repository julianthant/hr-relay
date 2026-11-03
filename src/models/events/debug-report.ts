import { z } from "zod";
import { ERROR_CATALOG } from "../failures/error-catalog.js";
import { BulkRunCommandResponseSchema, CommandRejectionCodeSchema } from "../../rules/commands/commands.js";
export const DashboardErrorReportSchema = z.strictObject({
  reportId: z.uuid(), clientId: z.string().min(1).max(128), release: z.string().min(1).max(128),
  route: z.string().min(1).max(512), surface: z.string().min(1).max(128), code: z.string().min(1).max(128),
  message: z.string().max(32768), stack: z.string().max(32768).optional(),
  level: z.enum(["error", "warn", "info"]).optional(),
  reason: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/u).optional(),
});
export type DashboardErrorReport = z.infer<typeof DashboardErrorReportSchema>;

const FailureOutcomeSchema = z.object({ state: z.enum(["error", "failed", "refused", "rejected", "conflict", "unknown", "uncertain", "unavailable"]), code: z.string().optional() });
const TRANSPORT_CODES = new Set(["SCHEMA_INVALID", "INTERNAL_FAILURE", "REQUEST_IDENTITY_REFUSED", "ROUTE_NOT_FOUND", "SECTION_UNAVAILABLE", "PROJECTION_DEGRADED", "LOGGING_UNAVAILABLE", "DEBUG_REPORT_INVALID", "DEBUG_REPORT_RATE_LIMIT", "DEBUG_REPORT_SIZE_LIMIT"]);

export function debugFailureOutcome(value: unknown, status = 200) {
  if (z.object({ state: z.literal("signed-out"), remoteRevocation: z.literal("unconfirmed") }).safeParse(value).success) {
    return { code: "CHATGPT_AUTH_UNAVAILABLE", level: "warn" as const, reason: "remote-revocation-unconfirmed" };
  }
  const parsed = FailureOutcomeSchema.safeParse(value);
  if (!parsed.success && status < 400) return undefined;
  const state = parsed.success ? parsed.data.state : "error";
  const code = parsed.success && parsed.data.code !== undefined
    && (Object.hasOwn(ERROR_CATALOG, parsed.data.code) || TRANSPORT_CODES.has(parsed.data.code) || CommandRejectionCodeSchema.safeParse(parsed.data.code).success)
    ? parsed.data.code : state === "conflict" ? "COMMAND_CONFLICT" : state === "rejected" || state === "refused" ? "COMMAND_REFUSED" : "DASHBOARD_READ_FAILED";
  const uncertain = state === "unknown" || state === "uncertain";
  return { code, level: status >= 500 || uncertain || state === "error" || state === "failed" ? "error" as const : "warn" as const,
    reason: uncertain ? "outcome-unknown" : state === "refused" || state === "rejected" || state === "conflict" ? "operation-refused" : "operation-failed" };
}

export function debugFailureOutcomes(value: unknown, status = 200): (NonNullable<ReturnType<typeof debugFailureOutcome>> & { correlationId?: string })[] {
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

const DIAGNOSTIC_ROUTE_ROOTS = new Set(["application-lifecycle", "bootstrap", "calendar", "search", "exports", "commands", "settings", "preflight", "profile", "runs", "queue", "start-plans", "rerun-warnings", "intake", "ocr", "workbooks", "assistant", "storage", "notifications", "explorer", "reports", "data", "trust"]);

export function diagnosticRequestRoute(path: string): string {
  const root = path.split(/[?#]/u)[0]?.split("/")[3];
  return root !== undefined && DIAGNOSTIC_ROUTE_ROOTS.has(root) ? `/api/v1/${root}` : "/api/v1";
}
