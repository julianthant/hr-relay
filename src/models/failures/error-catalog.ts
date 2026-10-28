import { z } from "zod";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { BoundarySourceSchema } from "./boundary-failure.js";

export function failureCodeFromTaskCode(code: string): string {
  return ErrorCodeSchema.parse(code.toUpperCase().replaceAll("-", "_"));
}

const EmptyParametersSchema = z.strictObject({});

function catalogEntry<const Parameters extends z.ZodTypeAny>(text: string, parameters: Parameters) {
  return Object.freeze({ text, parameters });
}

export const ERROR_CATALOG = Object.freeze({
  STARTUP_CRASH_RECOVERY_REFUSED: catalogEntry("Crash cleanup could not prove ownership or resource closure. Preserve the held resources and resolve custody before starting work.", EmptyParametersSchema),
  RUN_INTERRUPTED_BY_CRASH: catalogEntry("The run was interrupted by a crash and ended as failed. Review the result before starting another run.", EmptyParametersSchema),
  RUN_CRASH_WRITE_UNRESOLVED: catalogEntry("The run was interrupted by a crash with an unresolved write. The write remains held for operator resolution and will not be retried.", EmptyParametersSchema),
  RUN_STALE_QUEUE_CANCELLED: catalogEntry("The never-claimed run was queued on a previous local day and was cancelled during startup.", EmptyParametersSchema),
  STARTUP_PROCESS_CLOSED: catalogEntry("A process left by a crash was proved gone and its process custody was settled. Any unresolved writes remain held.", EmptyParametersSchema),
  PARKED_CHECK_ABSENT: catalogEntry("The target state was not found. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_AMBIGUOUS: catalogEntry("The target evidence is ambiguous. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_UNKNOWN: catalogEntry("The target state could not be determined. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_UNAVAILABLE: catalogEntry("This exact parked occurrence cannot be checked with the current subject, worker or read capability. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_OCCURRENCE_UNPROVED: catalogEntry("A matching target state was observed, but it cannot be attributed to the original attempt. The write remains held.", EmptyParametersSchema),
  DOCUMENT_UNAVAILABLE: catalogEntry("The Kuali separation document could not be opened. Review the document number before starting a new run.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_UNAVAILABLE: catalogEntry("The OS credential store is unavailable. Unlock it before opening Relay.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_MISSING: catalogEntry("The profile encryption key is missing from this machine's OS credential store. Restore requires its original key.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_MISMATCH: catalogEntry("The OS encryption key does not match this profile's binding. Preserve the current installation for recovery.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_UNCERTAIN: catalogEntry("Encryption key custody could not be confirmed. Preserve the installation and OS credential entry before continuing.", EmptyParametersSchema),
  CREDENTIAL_CONTEXT_REQUIRED: catalogEntry("The selected profile credential authority is unavailable. Restart the runtime before continuing.", EmptyParametersSchema),
  RUNTIME_CUSTODY_UNCERTAIN: catalogEntry("Runtime resource closure is unproved. Preserve the current installation and process custody before restarting.", EmptyParametersSchema),
  PROFILE_BROWSER_ROOT_REFUSED: catalogEntry("Browser storage must stay inside the selected profile in an owned directory without links.", EmptyParametersSchema),
  PROFILE_STORAGE_RELOCATION_UNSUPPORTED: catalogEntry("Storage relocation is unavailable for profile installations. Keep the current installation roots.", EmptyParametersSchema),
  ASSISTANT_INVALID: catalogEntry("The assistant request or response was invalid.", EmptyParametersSchema),
  ASSISTANT_CONTEXT_UNAVAILABLE: catalogEntry("Verified public source context is unavailable.", EmptyParametersSchema),
  ASSISTANT_CONTEXT_STALE: catalogEntry("The public source context does not match this runtime.", EmptyParametersSchema),
  CHATGPT_ASSISTANT_REFUSED: catalogEntry("The model refused this assistant request.", EmptyParametersSchema),
  ASSISTANT_MODEL_UNAVAILABLE: catalogEntry("The selected model is not available in the current ChatGPT account catalog.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_REFUSED: catalogEntry("The model refused this assistant request.", EmptyParametersSchema),
  ASSISTANT_MODEL_UNVERIFIED: catalogEntry("Send /verify-assistant to verify the selected assistant model.", EmptyParametersSchema),
  ASSISTANT_USAGE_LIMIT: catalogEntry("The ChatGPT plan usage limit was reached.", EmptyParametersSchema),
  ASSISTANT_PLAN_DISABLED: catalogEntry("Enable ChatGPT plan usage before using the assistant.", EmptyParametersSchema),
  ASSISTANT_ACCOUNT_EXPIRED: catalogEntry("Reconnect the ChatGPT account before using the assistant.", EmptyParametersSchema),
  ASSISTANT_UNAVAILABLE: catalogEntry("The assistant is unavailable. Check the ChatGPT connection.", EmptyParametersSchema),
  ASSISTANT_CANCELLED: catalogEntry("The assistant request was cancelled.", EmptyParametersSchema),
  ASSISTANT_LIMIT: catalogEntry("The assistant reached its request limit.", EmptyParametersSchema),
  ASSISTANT_SUBJECT_REQUIRED: catalogEntry("Select an unambiguous subject before preparing a proposal.", EmptyParametersSchema),
  ASSISTANT_PROPOSAL_REFUSED: catalogEntry("The current planner refused this proposal. Review it in Run.", EmptyParametersSchema),

  RUN_LOG_DISPLAY_VALUE_UNMAPPED: catalogEntry(
    "A retained value has no declared display text. Update the workflow declaration before reading these Logs.",
    EmptyParametersSchema,
  ),
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
  WORKER_PROCESS_RECOVERY_REFUSED: catalogEntry(
    "Relay couldn't prove that the abandoned worker's resources are closed. Its original custody and HR records remain held.",
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
    "Duo refused the sign-in. Run it again; if it repeats, check Duo Autopilot.",
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
  INTERNAL_FAILURE: catalogEntry(
    "Relay could not complete this request. Review the recorded local evidence before trying again.",
    EmptyParametersSchema,
  ),
  BOUNDARY_VALIDATION_FAILED: catalogEntry(
    "The supplied data does not match the expected contract.",
    z.strictObject({ source: BoundarySourceSchema }),
  ),
  RERUN_SOURCE_INPUT_PROTECTED: catalogEntry(
    "The source input is protected and cannot be copied into a rerun. Start a new run and enter the values again.",
    EmptyParametersSchema,
  ),
  TASK_UNHANDLED_FAILURE: catalogEntry(
    "The task stopped with an unclassified failure. Review local diagnostic evidence.",
    EmptyParametersSchema,
  ),
  BROWSER_SESSION_ACQUISITION_TIMEOUT: catalogEntry(
    "Sign-in took too long. Run it again; if it repeats, check the system's sign-in in Sessions.",
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
    "The worker stopped responding. Run it again.",
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
  PROFILE_NAME_REFUSED: catalogEntry(
    "That name cannot be used as the timekeeper name.",
    EmptyParametersSchema,
  ),
  PROFILE_SIGN_IN_REFUSED: catalogEntry(
    "That email and password did not match a profile on this computer.",
    EmptyParametersSchema,
  ),
  PROFILE_CREDENTIAL_CONVERSION_REQUIRED: catalogEntry(
    "This profile needs an explicit complete credential replacement before sign in can continue.",
    EmptyParametersSchema,
  ),
  PROFILE_OTHER_EMAIL: catalogEntry(
    "That email belongs to a different profile.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGOUT_BLOCKED: catalogEntry(
    "Log out waits until this profile's active work can stop.",
    EmptyParametersSchema,
  ),
  PROFILE_AUTHORITY_UNAVAILABLE: catalogEntry("Current profile authority is unavailable.", EmptyParametersSchema),
  PROFILE_AUTHORITY_CHANGED: catalogEntry("Profile authority changed. Capture it again before continuing.", EmptyParametersSchema),
  PROFILE_SESSION_STALE: catalogEntry(
    "This sign-in is no longer active. Sign in again.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGOUT_INVENTORY_BLOCKED: catalogEntry(
    "Saved work email and password were removed, but a backup still has a copy.",
    EmptyParametersSchema,
  ),
  PROFILE_VERIFIER_UNAVAILABLE: catalogEntry(
    "A password change waits for a live sign-in that proves the new password.",
    EmptyParametersSchema,
  ),
  PROFILE_UPGRADE_STARTING: catalogEntry(
    "A verified backup and local storage upgrade are starting. Sign in again after Relay restarts.",
    EmptyParametersSchema,
  ),
  PROFILE_FLAT_STORE_MIGRATION_FAILED: catalogEntry("Relay could not verify the old store backup and start a clean profile installation. Startup is stopped; remaining data is preserved.", EmptyParametersSchema),
  PROFILE_UPGRADE_UNAVAILABLE: catalogEntry(
    "The authenticated storage upgrade could not finish. Storage custody is retained; do not retry the upgrade.",
    EmptyParametersSchema,
  ),
  PROFILE_TRANSITION_BLOCKED: catalogEntry(
    "Sign in waits until the other profile is logged out.",
    EmptyParametersSchema,
  ),
  PROFILE_RESTORE_ADMISSION_REQUIRED: catalogEntry(
    "Log out cannot finish until restore admission accepts the machine erasure journal.",
    EmptyParametersSchema,
  ),  CHATGPT_REVOCATION_UNCONFIRMED: catalogEntry(
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
  ARTIFACT_READ_CLOSURE_UNPROVED: catalogEntry(
    "The artifact reader could not prove its file was closed. Keep this profile stopped and review local resource custody.",
    EmptyParametersSchema,
  ),
  CHATGPT_RESOURCE_CLOSURE_UNPROVED: catalogEntry(
    "ChatGPT operation resources could not be closed. Keep this profile stopped and review local resource custody.",
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
  SPREADSHEET_WORKSHEET_REFERENCE_INVALID: catalogEntry(
    "This workbook has an invalid worksheet reference. Export a new XLSX copy and try again.",
    EmptyParametersSchema,
  ),
  SPREADSHEET_WORKBOOK_XML_INVALID: catalogEntry(
    "This workbook could not be read. Export a new XLSX copy and try again.",
    EmptyParametersSchema,
  ),
  SPREADSHEET_DIMENSIONS_INVALID: catalogEntry(
    "This workbook has an invalid worksheet range. Export a new XLSX copy and try again.",
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
  ASSISTANT_AUTHORITY_INVALID: catalogEntry(
    "The assistant permission could not be read. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_GRANT_REQUIRED: catalogEntry(
    "The assistant has no operator grant. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_MODEL_PROPOSAL_REFUSED: catalogEntry(
    "The assistant proposal was refused. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_PROPOSAL_MISMATCH: catalogEntry(
    "The assistant proposal does not match this command. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_UNCLASSIFIED: catalogEntry(
    "This command is not classified for the assistant. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_OPTIONS_UNBOUND: catalogEntry(
    "This command's options cannot be bound exactly. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_SUBJECT_MISMATCH: catalogEntry(
    "This command's subject does not match its classification. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_BINDING_STALE: catalogEntry(
    "The assistant approval no longer matches this command. No action was taken.",
    EmptyParametersSchema,
  ),
  ASSISTANT_UNKNOWN_NOT_REPLAYABLE: catalogEntry(
    "An uncertain assistant result cannot be replayed. Check its result before taking further action.",
    EmptyParametersSchema,
  ),
  ASSISTANT_EFFECT_UNDERSTATED: catalogEntry(
    "This command does more than its assistant classification says. No action was taken.",
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

/** Operator sentence for a recorded failure code. An absent code uses the unregistered-code sentence. */
export function operatorFailureSentence(code: string): string {
  const registered = ErrorCatalogCodeSchema.safeParse(code);
  if (!registered.success) return ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text;
  return ERROR_CATALOG[registered.data].text;
}

const SESSION_ACQUISITION_TIMEOUT = "browser-session-acquisition-timeout";

export function catalogCodeForThrown(error: unknown): ErrorCatalogCode | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const name = "name" in current ? current.name : undefined;
    const code = "code" in current ? current.code : undefined;
    if (name === "SessionAcquisitionTimeoutError" || code === SESSION_ACQUISITION_TIMEOUT) {
      return "BROWSER_SESSION_ACQUISITION_TIMEOUT";
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
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

    const mapped = catalogCodeForThrown(originalFailure);
    if (mapped !== undefined) return resolveAs(originalFailure, mapped, {});

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
