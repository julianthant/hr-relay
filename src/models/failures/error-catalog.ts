import { z } from "zod";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { BoundarySourceSchema } from "./boundary-failure.js";

const EmptyParametersSchema = z.strictObject({});

function catalogEntry<const Parameters extends z.ZodTypeAny>(text: string, parameters: Parameters) {
  return Object.freeze({ text, parameters });
}

export const ERROR_CATALOG = Object.freeze({
  PERSON_LOOKUP_CRM_RESULTS_CHANGED: catalogEntry(
    "CRM search results changed before they could be captured.",
    EmptyParametersSchema,
  ),
  BROWSER_SCREENSHOT_CAPTURE_FAILED: catalogEntry(
    "The browser screenshot could not be captured or saved.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_READ_UNAVAILABLE: catalogEntry(
    "Preflight report could not be read or verified. Re-check readiness.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_RERUN_UNAVAILABLE: catalogEntry(
    "Preflight re-check could not be completed or verified. Read current readiness before retrying.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_SCOPE_UNAVAILABLE: catalogEntry(
    "Workflow scopes could not be read.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_REPORT_INVALID: catalogEntry(
    "Preflight report is stale or empty. Re-check readiness.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_EVIDENCE_EXPIRED: catalogEntry(
    "Preflight evidence expired; re-check readiness.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_SETTINGS_RESTART_REQUIRED: catalogEntry(
    "Settings restart required. Restart the runtime before re-checking.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_SETTINGS_UNAVAILABLE: catalogEntry(
    "Current settings are unavailable. Reload Settings before re-checking.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_IDENTITY_CHANGED: catalogEntry(
    "Preflight identity changed; refresh settings and re-check readiness.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_RUNTIME_CHANGED: catalogEntry(
    "Runtime state changed; re-check readiness.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_READ_FAILED: catalogEntry(
    "Preflight could not be read.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_CREDENTIAL_PRESENCE_UNAVAILABLE: catalogEntry(
    "Credential presence could not be verified from Settings.",
    EmptyParametersSchema,
  ),
  STORAGE_AUTHORITY_UNAVAILABLE: catalogEntry(
    "Nothing durable can be read or recorded.",
    EmptyParametersSchema,
  ),
  STORAGE_DATA_UNAVAILABLE: catalogEntry(
    "Saved run data is unavailable. Review the storage checks below.",
    EmptyParametersSchema,
  ),
  STORAGE_DOCTOR_FAILED: catalogEntry(
    "Try running the checks again.",
    EmptyParametersSchema,
  ),
  STORAGE_AUTHORITY_READ_FAILED: catalogEntry(
    "Stored data couldn't be read. Review the technical details.",
    EmptyParametersSchema,
  ),
  STORAGE_RECOVERY_UNAVAILABLE: catalogEntry(
    "Recovery status couldn't be checked.",
    EmptyParametersSchema,
  ),
  STORAGE_RECOVERY_INTERRUPTED: catalogEntry(
    "An interrupted operation needs review before starting work.",
    EmptyParametersSchema,
  ),
  STORAGE_RECOVERY_STARTUP_INTERRUPTED: catalogEntry(
    "An interrupted operation needs review before startup.",
    EmptyParametersSchema,
  ),
  STORAGE_UPDATE_HISTORY_UNAVAILABLE: catalogEntry(
    "Storage update history couldn't be checked.",
    EmptyParametersSchema,
  ),
  STORAGE_CREDENTIAL_CHECK_INCOMPLETE: catalogEntry(
    "This setting wasn't included in the last check.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS: catalogEntry(
    "Match requires a date of birth or SSN.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_NOT_FOUND: catalogEntry(
    "Person not found.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_MULTIPLE_MATCHES: catalogEntry(
    "Multiple people match; none was chosen.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_MATCH_MULTIPLE_MATCHES: catalogEntry(
    "Multiple UCPath people match; none was chosen.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_EMPLOYMENT_STATUS_UNDETERMINED: catalogEntry(
    "Employment status could not be determined.",
    EmptyParametersSchema,
  ),
  INCONSISTENT_INPUTS: catalogEntry(
    "Person Lookup received inconsistent UCPath and CRM identities.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_UCPATH_SEARCH_FAILED: catalogEntry(
    "UCPath search failed.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT: catalogEntry(
    "CRM selected record identity changed.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_CRM_CHECK_FAILED: catalogEntry(
    "CRM check failed.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_CRM_DATES_CHECK_FAILED: catalogEntry(
    "CRM dates check failed.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_CRM_DATES_BINDING_INVALID: catalogEntry(
    "CRM dates subject binding is invalid.",
    EmptyParametersSchema,
  ),
  SHIBBOLETH_STALE_REQUEST: catalogEntry(
    "Shibboleth served its stale-request page; the SAML execution expired during login.",
    EmptyParametersSchema,
  ),
  DUO_PROMPT_STALLED: catalogEntry(
    "The Duo prompt never cleared; check that Duo Autopilot is loaded and its credential is current.",
    EmptyParametersSchema,
  ),
  DUO_REFUSAL_UNPROVEN: catalogEntry(
    "The Duo prompt never cleared, and its terminal refusal could not be probed.",
    EmptyParametersSchema,
  ),
  SSO_FIRST_FACTOR_REJECTED: catalogEntry(
    "The UCSD SSO form is still on the page; the first factor was rejected.",
    EmptyParametersSchema,
  ),
  LANDING_PROBE_UNAVAILABLE: catalogEntry(
    "No authenticated landing appeared, and the stalled page could not be probed.",
    EmptyParametersSchema,
  ),
  AUTHENTICATED_LANDING_MISSING: catalogEntry(
    "No authenticated landing appeared.",
    EmptyParametersSchema,
  ),
  TRAINING_REMINDER_REPEATED: catalogEntry(
    "The UCSD training reminder appeared again after Continue Log In.",
    EmptyParametersSchema,
  ),
  ORPHAN_VERIFICATION_RETIREMENT_REFUSED: catalogEntry(
    "Relay couldn't safely retire an abandoned sign-in check, so close other Relay windows and try again.",
    EmptyParametersSchema,
  ),
  LIVE_SMOKE_RECOVERY_REFUSED: catalogEntry(
    "Relay couldn't safely clean up an abandoned sign-in check, so close other Relay windows and try again.",
    EmptyParametersSchema,
  ),
  DUO_TERMINAL_REFUSAL: catalogEntry(
    "Duo refused the WebAuthn assertion and rendered its terminal \"canceled or timed out\" screen; this login is dead and the prompt will not clear on its own. The cause is almost never Duo hand-approval: it is a Duo Autopilot signCount regression, where this browser profile's stored counter has fallen behind the value Duo has already observed for the shared credential (a counter that does not advance is a cloned-key signal), which is what happens when any other profile using the same credential signed more recently. Check the extension's stored signCount before touching timeouts.duoApprovalSeconds or timeouts.sessionAcquireMs.",
    EmptyParametersSchema,
  ),
  UCPATH_SIGN_IN_FAILED: catalogEntry(
    "UCPath sign-in failed.",
    EmptyParametersSchema,
  ),
  CRM_SIGN_IN_FAILED: catalogEntry(
    "CRM sign-in failed.",
    EmptyParametersSchema,
  ),
  ONBASE_SIGN_IN_FAILED: catalogEntry(
    "OnBase sign-in failed.",
    EmptyParametersSchema,
  ),
  KUALI_SIGN_IN_FAILED: catalogEntry(
    "Kuali sign-in failed.",
    EmptyParametersSchema,
  ),
  SERVICENOW_SIGN_IN_FAILED: catalogEntry(
    "ServiceNow sign-in failed.",
    EmptyParametersSchema,
  ),
  I9_SIGN_IN_FAILED: catalogEntry(
    "I-9 sign-in failed.",
    EmptyParametersSchema,
  ),
  NEW_KRONOS_SIGN_IN_FAILED: catalogEntry(
    "New Kronos sign-in failed.",
    EmptyParametersSchema,
  ),
  OLD_KRONOS_SIGN_IN_FAILED: catalogEntry(
    "Old Kronos sign-in failed.",
    EmptyParametersSchema,
  ),
  SHAREPOINT_SIGN_IN_FAILED: catalogEntry(
    "SharePoint sign-in failed.",
    EmptyParametersSchema,
  ),
  ERROR_CATALOG_CODE_UNREGISTERED: catalogEntry(
    "This failure code is not in the current catalog. Review the recorded local evidence.",
    EmptyParametersSchema,
  ),
  BOUNDARY_VALIDATION_FAILED: catalogEntry(
    "The supplied data does not match the expected contract.",
    z.strictObject({ source: BoundarySourceSchema }),
  ),
  RERUN_SOURCE_INPUT_PROTECTED: catalogEntry(
    "The source input is protected and cannot be copied into a rerun.",
    EmptyParametersSchema,
  ),
  TASK_UNHANDLED_FAILURE: catalogEntry(
    "The task stopped with an unclassified failure. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  ERROR_CATALOG_FORMAT_FAILED: catalogEntry(
    "The failure could not be formatted safely. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  SEARCH_LOADING: catalogEntry("Loading runs…", EmptyParametersSchema),
  SEARCH_UNAVAILABLE: catalogEntry("Search is unavailable. Reopen search and try again.", EmptyParametersSchema),
  SEARCH_SUBJECT_UNAVAILABLE: catalogEntry("Subject unavailable", EmptyParametersSchema),
  NOTIFICATION_SOURCE_UNAVAILABLE: catalogEntry("Notification source evidence is unavailable. Review the inbox before relying on this update.", EmptyParametersSchema),
  NOTIFICATION_HISTORY_INCOMPLETE: catalogEntry("Notification history is incomplete. Reconcile the affected work before relying on it.", EmptyParametersSchema),
  NOTIFICATION_OBSERVATION_FAILED: catalogEntry("Notification observation failed. Some updates may be unavailable.", EmptyParametersSchema),
  NOTIFICATION_RECEIPT_MISSING: catalogEntry("Notification receipt evidence is missing. Some updates may be unavailable.", EmptyParametersSchema),
  NOTIFICATION_CONTEXT_UNAVAILABLE: catalogEntry("Notification context unavailable", EmptyParametersSchema),
  NOTIFICATION_REFRESH_PENDING: catalogEntry("Refreshing notifications…", EmptyParametersSchema),
  NOTIFICATION_COMMAND_PENDING: catalogEntry("Notification change pending.", EmptyParametersSchema),
  NOTIFICATION_TARGET_UNAVAILABLE: catalogEntry(
    "This notification target is no longer available. Refresh the inbox and try again.",
    EmptyParametersSchema,
  ),
  NOTIFICATION_ARCHIVE_RETIRED: catalogEntry(
    "Archived notification targets are no longer available.",
    EmptyParametersSchema,
  ),
  DASHBOARD_READ_FAILED: catalogEntry(
    "The dashboard could not load this from the local service. Try again.",
    EmptyParametersSchema,
  ),
  LOGS_IDENTITY_REFUSED: catalogEntry(
    "Logs cannot be ordered because their recorded identities are missing or inconsistent.",
    EmptyParametersSchema,
  ),
  LOGS_READ_FAILED_TITLE: catalogEntry(
    "Could not load logs",
    EmptyParametersSchema,
  ),
  LOGS_UNAVAILABLE_TITLE: catalogEntry(
    "Logs unavailable",
    EmptyParametersSchema,
  ),
  LOGS_CONFIRMED_ACTIONS_UNAVAILABLE_TITLE: catalogEntry(
    "Confirmed actions unavailable",
    EmptyParametersSchema,
  ),
  LOGS_CONFIRMED_ACTION_EVIDENCE_INCOMPLETE: catalogEntry(
    "The response did not supply complete confirmed-action evidence.",
    EmptyParametersSchema,
  ),
  EXPLORER_TASK_BINDING_UNAVAILABLE: catalogEntry(
    "This workflow definition is unavailable because a task implementation is not registered.",
    EmptyParametersSchema,
  ),
  DASHBOARD_DAY_INVALID: catalogEntry(
    "The selected work date is invalid. Choose a valid date.",
    EmptyParametersSchema,
  ),
  DASHBOARD_DAY_FUTURE: catalogEntry(
    "A future work date cannot be selected.",
    EmptyParametersSchema,
  ),
  DASHBOARD_WORKFLOW_UNAVAILABLE: catalogEntry(
    "This workflow is not available for selection in the current catalog.",
    EmptyParametersSchema,
  ),
  SESSIONS_UNAVAILABLE: catalogEntry(
    "Session information is unavailable.",
    EmptyParametersSchema,
  ),
  WORKER_CRASHED: catalogEntry(
    "crashed",
    EmptyParametersSchema,
  ),
  WORKER_LEASE_EXPIRED: catalogEntry(
    "lease expired — its process stopped reporting",
    EmptyParametersSchema,
  ),
  COMMAND_OUTCOME_UNCERTAIN: catalogEntry(
    "The command outcome is uncertain. Check its result before taking further action.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_OUTCOME_UNCERTAIN: catalogEntry(
    "The plan write could not be confirmed. It may already be recorded. Retry the exact attempt; your draft is retained.",
    EmptyParametersSchema,
  ),
  SETTINGS_INITIAL_READ_UNAVAILABLE: catalogEntry(
    "Settings could not be read. Try again.",
    EmptyParametersSchema,
  ),
  SETTINGS_REFRESH_UNAVAILABLE: catalogEntry(
    "Current settings could not be read. Your drafts are retained.",
    EmptyParametersSchema,
  ),
  SETTINGS_DRAFT_INVALID: catalogEntry(
    "Check the draft values. No request was sent.",
    EmptyParametersSchema,
  ),
  PROTECTED_SETTINGS_DRAFT_INVALID: catalogEntry(
    "Check the credential draft. No request was sent.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_DRAFT_INVALID: catalogEntry(
    "Check the folder paths. No plan was sent.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_DRAFT_UNCHANGED: catalogEntry(
    "The draft matches the current plan. Undo the edit or choose another folder.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_CANCEL_REQUIRED: catalogEntry(
    "Cancel the current plan to keep the active locations, or choose another folder.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_BUSY: catalogEntry(
    "Another path picker is already open.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_TIMEOUT: catalogEntry(
    "The path picker timed out. Try again.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_UNSUPPORTED: catalogEntry(
    "The path picker is unavailable on this host.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_FAILED: catalogEntry(
    "The path picker could not be opened. Try again.",
    EmptyParametersSchema,
  ),
  COMMAND_RESULT_IDENTITY_MISMATCH: catalogEntry(
    "The command response did not match the requested command. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  COMMAND_READBACK_MISMATCH: catalogEntry(
    "The command result could not be confirmed by the current state. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  DASHBOARD_AUTHORITY_REPLACED: catalogEntry(
    "The dashboard context changed before the command result could be confirmed.",
    EmptyParametersSchema,
  ),
  COMMAND_REFUSED: catalogEntry(
    "The command was refused. Review the current state before continuing.",
    EmptyParametersSchema,
  ),
  COMMAND_CONFLICT: catalogEntry(
    "The command conflicted with a newer state. Refresh and review the current result.",
    EmptyParametersSchema,
  ),
  COMMAND_CONFIRMATION_REQUIRED: catalogEntry(
    "The command requires confirmation before it can proceed.",
    EmptyParametersSchema,
  ),
  COMMAND_DISPATCH_FAILED: catalogEntry(
    "The command could not be dispatched. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  CHATGPT_REVOCATION_UNCONFIRMED: catalogEntry(
    "Your ChatGPT account is signed out locally. Remote revocation could not be confirmed.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_BUSY: catalogEntry(
    "A ChatGPT sign-in is already in progress.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_CANCELLED: catalogEntry(
    "ChatGPT sign-in was cancelled.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_EXPIRED: catalogEntry(
    "ChatGPT sign-in expired. Start a new sign-in.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_INVALID: catalogEntry(
    "The ChatGPT sign-in response could not be verified.",
    EmptyParametersSchema,
  ),
  CHATGPT_AUTH_UNAVAILABLE: catalogEntry(
    "ChatGPT sign-in is unavailable. Try again later.",
    EmptyParametersSchema,
  ),
  CHATGPT_ACCOUNT_EXPIRED: catalogEntry(
    "The ChatGPT session expired. Sign in again.",
    EmptyParametersSchema,
  ),
  CHATGPT_PLAN_DISABLED: catalogEntry(
    "ChatGPT plan use is not enabled for this connection.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_LIMIT: catalogEntry(
    "The ChatGPT plan usage limit has been reached.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_UNAVAILABLE: catalogEntry(
    "ChatGPT plan usage is unavailable.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_INVALID: catalogEntry(
    "The OCR request is invalid.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_FAILED: catalogEntry(
    "ChatGPT could not complete the OCR request.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_INCOMPLETE: catalogEntry(
    "ChatGPT returned an incomplete OCR response.",
    EmptyParametersSchema,
  ),
  CHATGPT_OCR_CANCELLED: catalogEntry(
    "The OCR request was cancelled.",
    EmptyParametersSchema,
  ),
  CHATGPT_SERVICE_CLOSED: catalogEntry(
    "The ChatGPT account service is closed.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_UNAVAILABLE: catalogEntry(
    "ChatGPT credentials could not be read or saved safely.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_BUSY: catalogEntry(
    "ChatGPT credentials are in use by another operation.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_CONFLICT: catalogEntry(
    "The ChatGPT account changed. Read its current state before trying again.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_UNCERTAIN: catalogEntry(
    "The ChatGPT credential change could not be confirmed. Read its current state before trying again.",
    EmptyParametersSchema,
  ),
  WORKBOOK_INTAKE_SOURCE_CONFLICT: catalogEntry(
    "An active intake uses the same file with different workbook provenance. Finish that intake before importing this workbook.",
    EmptyParametersSchema,
  ),
  WORKBOOK_INVALID: catalogEntry(
    "The workbook is malformed and cannot be saved.",
    EmptyParametersSchema,
  ),
  WORKBOOK_NOT_FOUND: catalogEntry(
    "The saved workbook was not found.",
    EmptyParametersSchema,
  ),
  WORKBOOK_VERSION_CONFLICT: catalogEntry(
    "The saved workbook changed. Read its current version before saving.",
    EmptyParametersSchema,
  ),
  WORKBOOK_STORAGE_CORRUPT: catalogEntry(
    "The saved workbook or its history is corrupt.",
    EmptyParametersSchema,
  ),
  WORKBOOK_STORAGE_FAILED: catalogEntry(
    "The workbook library storage operation failed.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_RANGE_INVALID: catalogEntry(
    "The Analytics date range is invalid.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_BROWSE_INVALID: catalogEntry(
    "The Analytics browse selection is invalid.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_WORKFLOW_UNAVAILABLE: catalogEntry(
    "This workflow has no runs in the selected Analytics period.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_PAGE_UNAVAILABLE: catalogEntry(
    "This Analytics page is unavailable.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_RUN_UNAVAILABLE: catalogEntry(
    "This run is not part of the selected Analytics result.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_CONTENT_MISMATCH: catalogEntry(
    "The selected Analytics population has changed. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_SOURCE_MISMATCH: catalogEntry(
    "The Analytics report and run population disagree.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED: catalogEntry(
    "The Analytics selection has expired. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH: catalogEntry(
    "The Analytics selection no longer matches the current data. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_CONTENT_MISMATCH: catalogEntry(
    "The selected Analytics report has changed. Select the period again.",
    EmptyParametersSchema,
  ),
});

export type ErrorCatalogCode = keyof typeof ERROR_CATALOG;

export const ErrorCatalogCodeSchema = z.enum(
  Object.keys(ERROR_CATALOG) as [ErrorCatalogCode, ...ErrorCatalogCode[]],
);

export type ErrorCatalogParameters<Code extends ErrorCatalogCode> = z.infer<
  (typeof ERROR_CATALOG)[Code]["parameters"]
>;

export type ErrorCatalogFailure<Code extends ErrorCatalogCode = ErrorCatalogCode> = {
  [RegisteredCode in Code]: Readonly<{
    code: RegisteredCode;
    parameters: ErrorCatalogParameters<RegisteredCode>;
  }>;
}[Code];

export type ErrorCatalogMessage = ErrorCatalogFailure & Readonly<{ text: string }>;

export type ErrorCatalogFormattingFault = Readonly<{
  code: "ERROR_CATALOG_FORMAT_FAILED";
  text: (typeof ERROR_CATALOG)["ERROR_CATALOG_FORMAT_FAILED"]["text"];
  cause: unknown;
}>;

export type ErrorCatalogResolution<Failure> =
  | (ErrorCatalogMessage & Readonly<{ state: "resolved"; originalFailure: Failure }>)
  | Readonly<{
    state: "format-failed";
    originalFailure: Failure;
    catalogFault: ErrorCatalogFormattingFault;
  }>;

export function createErrorCatalogFailure<Code extends ErrorCatalogCode>(
  code: Code,
  parameters: ErrorCatalogParameters<Code>,
): ErrorCatalogFailure<Code> {
  const entry = ERROR_CATALOG[code];
  return Object.freeze({ code, parameters: entry.parameters.parse(parameters) }) as ErrorCatalogFailure<Code>;
}

export function formatErrorCatalogFailure(failure: ErrorCatalogFailure): ErrorCatalogMessage {
  const code = ErrorCatalogCodeSchema.parse(failure.code);
  const parameters = ERROR_CATALOG[code].parameters.parse(failure.parameters);
  return Object.freeze({ code, text: ERROR_CATALOG[code].text, parameters }) as ErrorCatalogMessage;
}

function resolveAs<Failure>(
  originalFailure: Failure,
  code: ErrorCatalogCode,
  parameters: unknown,
): ErrorCatalogResolution<Failure> {
  const message = formatErrorCatalogFailure({ code, parameters } as ErrorCatalogFailure);
  return Object.freeze({ ...message, state: "resolved", originalFailure });
}

export function resolveErrorCatalogFailure<Failure>(
  originalFailure: Failure,
  boundarySource: z.infer<typeof BoundarySourceSchema>,
): ErrorCatalogResolution<Failure> {
  try {
    const parsedSource = BoundarySourceSchema.safeParse(boundarySource);
    if (!parsedSource.success) {
      return resolveAs(originalFailure, "TASK_UNHANDLED_FAILURE", {});
    }

    if (typeof originalFailure !== "object" || originalFailure === null || !("code" in originalFailure)) {
      return resolveAs(originalFailure, "TASK_UNHANDLED_FAILURE", {});
    }

    const parsedCode = ErrorCodeSchema.safeParse(originalFailure.code);
    if (!parsedCode.success) {
      return resolveAs(originalFailure, "TASK_UNHANDLED_FAILURE", {});
    }

    const registeredCode = ErrorCatalogCodeSchema.safeParse(parsedCode.data);
    if (!registeredCode.success) {
      return resolveAs(originalFailure, "ERROR_CATALOG_CODE_UNREGISTERED", {});
    }

    const entry = ERROR_CATALOG[registeredCode.data];
    const parameters = "parameters" in originalFailure ? originalFailure.parameters : undefined;
    const parsedParameters = entry.parameters.safeParse(parameters);
    if (!parsedParameters.success) {
      return resolveAs(originalFailure, "BOUNDARY_VALIDATION_FAILED", { source: parsedSource.data });
    }

    return resolveAs(originalFailure, registeredCode.data, parsedParameters.data);
  } catch (cause) {
    const catalogFault = Object.freeze({
      code: "ERROR_CATALOG_FORMAT_FAILED" as const,
      text: ERROR_CATALOG.ERROR_CATALOG_FORMAT_FAILED.text,
      cause,
    });
    return Object.freeze({ state: "format-failed", originalFailure, catalogFault });
  }
}
