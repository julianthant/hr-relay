import { AssistantAuthorizationError } from "../../../assistant/authorization.js";
import { ERROR_CATALOG, createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { ActivityPopulationError } from "../../../runs/queries/activity-population.js";
import { ActivitySnapshotError } from "../../../runs/queries/activity-selection.js";
import { WorkbookLibraryError } from "../../../workbooks/workbook-library-service.js";
import { ProtectedSubjectDisplayRefusedError } from "../../../runs/start/protected-input.js";
import { PreflightAdmissionRefusal } from "../../../../rules/preflight/preflight-admission.js";
import { RerunRefusedError } from "../../../runs/start/rerun.js";
import { ProfileSessionRefusedError } from "../../../profiles/profile-session.js";
import { ProfileBrowserRootRefusalError, ProfileStorageRelocationUnsupportedError } from "../../../storage/admission/admission.js";

import { z } from "zod";
import { WireErrorSchema } from "../../../../models/dashboard/primitives.js";
import { LogDisplayRefusedError, LogIdentityRefusedError, DashboardReadFailedError, DiagnosticBundleBytesMissingError, DiagnosticBundleCorruptError, ProjectionDegradedError, RequestIdentityRefusedError, SectionUnavailableError, TargetNotFoundError } from "../../../runs/commands/refusals.js";
import { StartStepOmissionRefusedError } from "../../../runs/start/step-selection.js";
import { errorText } from "../../../runs/lifecycle/support.js";

export type WireError = z.infer<typeof WireErrorSchema>;

export function wireError(code: string, message: string, retryable: boolean): WireError {
  return WireErrorSchema.parse({ state: "error", code, message, retryable });
}

// Map status by typed refusal kind, never by substrings in an error message.
export function failureStatus(
  error: unknown,
): { status: 400 | 403 | 404 | 409 | 500; body: Record<string, unknown> } {
  if (error instanceof AssistantAuthorizationError) return { status: 409, body: wireError(error.code, ERROR_CATALOG[error.code].text, false) };
  if (error instanceof z.ZodError) {
    return { status: 400, body: wireError("SCHEMA_INVALID", z.prettifyError(error), false) };
  }
  const message = errorText(error);
  if (error instanceof ProfileSessionRefusedError || error instanceof ProfileBrowserRootRefusalError || error instanceof ProfileStorageRelocationUnsupportedError) return { status: 409, body: wireError(error.code, ERROR_CATALOG[error.code].text, false) };
  if (error instanceof DashboardReadFailedError) return { status: 500, body: wireError("DASHBOARD_READ_FAILED", ERROR_CATALOG.DASHBOARD_READ_FAILED.text, false) };
  if (error instanceof ActivitySnapshotError) return { status: 409, body: wireError(error.code, message, false) };
  if (error instanceof ActivityPopulationError) return { status: error.code === "ACTIVITY_POPULATION_RANGE_INVALID" || error.code === "ACTIVITY_POPULATION_BROWSE_INVALID" ? 400 : error.code === "ACTIVITY_POPULATION_SOURCE_MISMATCH" ? 500 : 409, body: wireError(error.code, message, false) };
  if (error instanceof WorkbookLibraryError) return { status: error.code === "WORKBOOK_NOT_FOUND" ? 404 : error.code === "WORKBOOK_INVALID" ? 400 : error.code === "WORKBOOK_VERSION_CONFLICT" || error.code === "WORKBOOK_INTAKE_SOURCE_CONFLICT" ? 409 : 500, body: wireError(error.code, message, false) };
  if (error instanceof ProtectedSubjectDisplayRefusedError) return { status: 409, body: wireError(error.code, message, false) };
  if (error instanceof PreflightAdmissionRefusal) return { status: 409, body: wireError(`PREFLIGHT_${error.reason.toUpperCase().replaceAll("-", "_")}`, message, false) };
  if (error instanceof TargetNotFoundError) {
    return { status: 404, body: wireError("TARGET_NOT_FOUND", message, false) };
  }
  if (error instanceof RerunRefusedError) {
    return { status: error.code === "target-not-found" ? 404 : 409,
      body: { ...wireError("RERUN_REFUSED", message, false), refusalCode: error.code } };
  }
  if (error instanceof StartStepOmissionRefusedError) {

    return { status: 400, body: wireError("START_STEP_OMISSION_REFUSED", message, false) };
  }
  if (error instanceof LogIdentityRefusedError || error instanceof LogDisplayRefusedError) {
    return { status: 409, body: wireError(error.code,
      formatErrorCatalogFailure(createErrorCatalogFailure(error.code, {})).text, false) };
  }
  if (error instanceof SectionUnavailableError) {
    return { status: 409, body: wireError("SECTION_UNAVAILABLE", message, false) };
  }
  if (error instanceof RequestIdentityRefusedError) {
    return { status: 403, body: wireError("REQUEST_IDENTITY_REFUSED", message, false) };
  }
  if (error instanceof ProjectionDegradedError) {
    return { status: 500, body: wireError("PROJECTION_DEGRADED", message, true) };
  }
  if (error instanceof DiagnosticBundleBytesMissingError) {
    return { status: 500, body: wireError("DIAGNOSTIC_BUNDLE_BYTES_MISSING", message, false) };
  }
  if (error instanceof DiagnosticBundleCorruptError) {
    return { status: 500, body: wireError("DIAGNOSTIC_BUNDLE_CORRUPT", message, false) };
  }
  return { status: 500, body: wireError("INTERNAL_FAILURE", message, false) };
}
