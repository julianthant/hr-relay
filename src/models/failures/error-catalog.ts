import { z } from "zod";
import { ErrorCodeSchema } from "../../rules/identity/ids.js";
import { BoundarySourceSchema } from "./boundary-failure.js";

export function failureCodeFromTaskCode(code: string) {
  return ErrorCodeSchema.parse(code.toUpperCase().replaceAll("-", "_"));
}

const EmptyParametersSchema = z.strictObject({});

function catalogEntry<const Parameters extends z.ZodTypeAny>(text: string, parameters: Parameters) {
  return Object.freeze({ text, parameters });
}

export const ERROR_CATALOG = Object.freeze({
  DELEGATION_CONFIG_UNAVAILABLE: catalogEntry("Relay could not verify this run's saved settings, so the child workflow did not start. Review the run evidence before continuing.", EmptyParametersSchema),
  AMBIGUOUS_ACTION_LIST_MATCH: catalogEntry("More than one Kuali Action List item matched this document. Review the list and confirm the intended item.", EmptyParametersSchema),
  BLANK_TERMINATION_TYPE: catalogEntry("The separation document does not show a termination type. Review the document before continuing.", EmptyParametersSchema),
  COMMENTS_CHANGED_SINCE_READ: catalogEntry("The Kuali comments changed after they were read. Review the current document before continuing.", EmptyParametersSchema),
  CONCURRENT_ACTIVE_EMPLOYMENTS: catalogEntry("More than one active UCPath job matched this employee. Review the job records before continuing.", EmptyParametersSchema),
  DELETE_REFUSED: catalogEntry("UCPath could not confirm clearing the pending termination. Review the run evidence before making another change.", EmptyParametersSchema),
  DEPARTMENT_CODE_NOT_OFFERED: catalogEntry("Kuali does not offer an option for the employee’s UCPath department. Check the department code and available options.", EmptyParametersSchema),
  DEPARTMENT_CODE_UNREADABLE: catalogEntry("The employee’s UCPath department code could not be read. Review the job record.", EmptyParametersSchema),
  DEPARTMENT_OPTION_AMBIGUOUS: catalogEntry("More than one Kuali department option matched the UCPath department code. Review the options.", EmptyParametersSchema),
  DEPARTMENT_OPTION_NOT_OFFERED: catalogEntry("The UCPath department has no matching Kuali option. Review the department code and current choices.", EmptyParametersSchema),
  DEPARTMENT_OPTION_UNUSABLE: catalogEntry("The matching Kuali department option has no usable name. Review the options before continuing.", EmptyParametersSchema),
  DOCUMENT_NOT_IN_ACTION_LIST: catalogEntry("The Kuali Action List does not contain this separation document. Check the document number and current list.", EmptyParametersSchema),
  DOCUMENT_NUMBER_MISMATCH: catalogEntry("Kuali opened a different document than the one requested. Check the document number before continuing.", EmptyParametersSchema),
  EMPLID_NOT_RECOGNIZED: catalogEntry("UCPath did not recognize the employee ID. Check the ID on the separation document and review the person record.", EmptyParametersSchema),
  EMPLOYEE_NAME_ABSENT: catalogEntry("The separation document does not show an employee name. Review the document before continuing.", EmptyParametersSchema),
  EMPLOYEE_NOT_FOUND: catalogEntry("The employee could not be found with the supplied search details. Check the name or employee ID.", EmptyParametersSchema),
  EMPLOYMENT_RECORD_MISMATCH: catalogEntry("The UCPath employment record does not match the record selected for this termination. Review the employee’s job history.", EmptyParametersSchema),
  EMPTY_DOCUMENT: catalogEntry("The PDF contains no pages to read. Select a complete PDF.", EmptyParametersSchema),
  FILING_NOT_CURRENT: catalogEntry("UCPath could not verify that the termination filing is current. Review the employee’s termination record.", EmptyParametersSchema),
  IDENTITY_APPROVAL_CHOICE_MISMATCH: catalogEntry("The approved identity choice does not match the identity evidence. Review the name and employee ID.", EmptyParametersSchema),
  IDENTITY_APPROVAL_EID_NOT_SHOWN: catalogEntry("The employee ID for this identity choice is not shown in the evidence. Review the UCPath search results.", EmptyParametersSchema),
  IDENTITY_APPROVAL_EVIDENCE_MOVED: catalogEntry("The identity evidence changed after it was reviewed. Review the current evidence before continuing.", EmptyParametersSchema),
  IDENTITY_APPROVAL_REJECTED: catalogEntry("The identity review was rejected. Correct the person or document details before continuing.", EmptyParametersSchema),
  IDENTITY_APPROVAL_REQUIRED: catalogEntry("Identity approval is required before this separation can continue.", EmptyParametersSchema),
  IDENTITY_SOURCE_INCONSISTENT: catalogEntry("The employee ID on the separation document does not agree with the identity source. Review the identity evidence.", EmptyParametersSchema),
  IDENTITY_SUBJECT_MISMATCH: catalogEntry("The UCPath job summary is for a different employee from the one selected for this run. Stop and review the identity.", EmptyParametersSchema),
  IDENTITY_SUPPLIED_EID_UNPROVED: catalogEntry("The employee ID supplied on the separation document was not confirmed in UCPath. Review the identity evidence.", EmptyParametersSchema),
  INCOMPLETE_EXTRACTION: catalogEntry("The page reading is missing required form information. Review the page and correct the reading.", EmptyParametersSchema),
  INDETERMINATE_EMPLOYMENT_STATUS: catalogEntry("UCPath returned an employment status that could not be classified. Review the employee’s job record.", EmptyParametersSchema),
  KUALI_UNAVAILABLE: catalogEntry("Kuali could not be reached. Check the connection and review the run evidence.", EmptyParametersSchema),
  LAST_DATE_WORKED_NOT_VERIFIED: catalogEntry("UCPath did not confirm the last day worked on the staged termination. Review the transaction before continuing.", EmptyParametersSchema),
  LAST_DAY_WORKED_ABSENT: catalogEntry("The separation document does not show a last day worked. Review the document before continuing.", EmptyParametersSchema),
  LEAVE_DATE_OUTSIDE_WINDOW: catalogEntry("A leave date falls outside the timecard range being reviewed. Check the date range and leave record.", EmptyParametersSchema),
  NEW_KRONOS_UNAVAILABLE: catalogEntry("Kronos could not be reached. Check the connection and review the run evidence.", EmptyParametersSchema),
  NO_ACTIVE_EMPLOYMENT: catalogEntry("No active UCPath employment record is available for this employee. Review the job status before continuing.", EmptyParametersSchema),
  NO_PUNCH_IN_WINDOW: catalogEntry("No timecard punch was found in the selected date range. Review the range and timecard.", EmptyParametersSchema),
  NOT_A_SEPARATION_DOCUMENT: catalogEntry("The selected Kuali document is not a separation document. Check the document number.", EmptyParametersSchema),
  PAGE_OUT_OF_RANGE: catalogEntry("The requested page number is outside the PDF. Check the page range and select a valid page.", EmptyParametersSchema),
  PAYROLL_TITLE_CODE_UNREADABLE: catalogEntry("The employee’s UCPath job code could not be read. Review the job record.", EmptyParametersSchema),
  PAYROLL_TITLE_UNREADABLE: catalogEntry("The employee’s UCPath job title could not be read. Review the job record.", EmptyParametersSchema),
  PROVIDER_UNAVAILABLE: catalogEntry("The page reading service is unavailable. Check the connection and the connected OCR account.", EmptyParametersSchema),
  REASON_CODE_NOT_OFFERED: catalogEntry("UCPath does not offer the selected termination reason. Review the reason and current options.", EmptyParametersSchema),
  SAVE_REFUSED: catalogEntry("Kuali did not confirm saving the termination receipt. Review the document and UCPath receipt before continuing.", EmptyParametersSchema),
  SEARCH_NO_SIGNAL: catalogEntry("The Kronos employee search did not return a usable result. Check the search details and try again.", EmptyParametersSchema),
  SEARCH_RETURNED_NO_MATCH: catalogEntry("Kronos found no employee matching the search details. Check the name or employee ID.", EmptyParametersSchema),
  SELECTION_NOT_PERSISTED: catalogEntry("UCPath did not retain the pending termination selection. Review the pending terminations before continuing.", EmptyParametersSchema),
  SEPARATION_DATE_ABSENT: catalogEntry("The separation document does not show a separation date. Review the document before continuing.", EmptyParametersSchema),
  SEPARATION_DATE_IN_FUTURE: catalogEntry("The separation date is after the document’s reference date. Review the dates before continuing.", EmptyParametersSchema),
  STAGE_NOT_PERSISTED: catalogEntry("The system did not retain the staged changes. Review the current record before continuing.", EmptyParametersSchema),
  SUBJECT_AMBIGUOUS: catalogEntry("More than one UCPath person matched the name on the separation document. Review the matches before continuing.", EmptyParametersSchema),
  SUBJECT_MISMATCH: catalogEntry("The system displayed a different employee from the one this run expects. Stop and review the employee identity.", EmptyParametersSchema),
  SUBJECT_NOT_RESOLVABLE: catalogEntry("No UCPath person matched the name on the separation document. Check the name and employee ID.", EmptyParametersSchema),
  SUBMIT_REFUSED: catalogEntry("UCPath did not confirm the termination submission. Review the transaction status before taking further action.", EmptyParametersSchema),
  TERMINATION_NOT_IN_EFFECT: catalogEntry("UCPath’s termination receipt does not show an effective status. Review the transaction before finalizing the Kuali document.", EmptyParametersSchema),
  TERMINATION_RECEIPT_DATE_MISMATCH: catalogEntry("The effective date on UCPath’s receipt differs from the date this run filed. Review both records before finalizing.", EmptyParametersSchema),
  TERMINATION_RECEIPT_SUBJECT_MISMATCH: catalogEntry("UCPath’s receipt names a different employee from the one verified for this run. Review the employee identity.", EmptyParametersSchema),
  TERMINATION_RECEIPT_UNUSABLE: catalogEntry("UCPath returned a transaction number that Kuali cannot store. Review the receipt before continuing.", EmptyParametersSchema),
  TERMINATION_TYPE_OPTIONS_DRIFTED: catalogEntry("The available termination types changed during this run. Review the current options and choose again.", EmptyParametersSchema),
  TIMECARD_NAVIGATION_FAILED: catalogEntry("Kronos could not open the employee’s timecard. Review the search result.", EmptyParametersSchema),
  TIMECARD_RANGE_NOT_APPLIED: catalogEntry("Kronos did not apply the requested timecard date range. Check the displayed dates before continuing.", EmptyParametersSchema),
  TIMECARD_UNREADABLE: catalogEntry("The employee’s timecard could not be read. Review the timecard and date range.", EmptyParametersSchema),
  UCPATH_UNAVAILABLE: catalogEntry("UCPath could not be reached. Check the connection and review the run evidence.", EmptyParametersSchema),
  UNEXPECTED_PAGE_STATE: catalogEntry("The system did not show the expected page. Review the current page before continuing.", EmptyParametersSchema),
  UNKNOWN_TERMINATION_TYPE: catalogEntry("The termination type was not recognized. Review the separation document and available options.", EmptyParametersSchema),
  UNMAPPED_TERMINATION_TYPE: catalogEntry("The termination type on the separation document does not map to a supported UCPath reason. Review the termination type.", EmptyParametersSchema),
  UNPARSEABLE_DATE: catalogEntry("A date on the Kuali separation document could not be read. Review the document’s dates.", EmptyParametersSchema),
  UNREADABLE_ACTION_LINK: catalogEntry("Kuali’s Action List did not provide a readable link for the matching document. Review the list and document number.", EmptyParametersSchema),
  UNREADABLE_EID: catalogEntry("The employee ID on the Kuali separation document could not be read. Review the document before continuing.", EmptyParametersSchema),
  UNREADABLE_PAGE: catalogEntry("The page could not be read clearly. Review it and correct the reading.", EmptyParametersSchema),
  UNREADABLE_PDF: catalogEntry("The PDF could not be read. Select a valid PDF and try again.", EmptyParametersSchema),
  PROFILE_BROWSER_CLEANUP_UNPROVED: catalogEntry("Browser profile cleanup could not be verified.", EmptyParametersSchema),
  PROFILE_BROWSER_MEMBERSHIP_MISMATCH: catalogEntry("Retained browser profiles do not match the browser registry.", EmptyParametersSchema),
  PROFILE_BROWSER_LAUNCH_UNCLOSED: catalogEntry("Browser launch closure could not be verified.", EmptyParametersSchema),
  PROFILE_BROWSER_NATIVE_CUSTODY_RETAINED: catalogEntry("A browser custody operation is still unresolved.", EmptyParametersSchema),
  PROFILE_BROWSER_SESSION_AHEAD: catalogEntry("The browser session is ahead of the current profile session.", EmptyParametersSchema),
  PROFILE_BROWSER_DIRECTORY_UNBOUND: catalogEntry("A registered browser profile has no matching custody record.", EmptyParametersSchema),
  APPLICATION_DATA_WORKSPACE_REFUSED: catalogEntry("Relay could not verify the Windows application data location. Restore a valid LOCALAPPDATA host setting before restarting Relay. Existing files have been preserved.", EmptyParametersSchema),
  WINDOWS_PRIVATE_PATH_REFUSED: catalogEntry("Windows storage permissions, identity or durability could not be verified. Preserve the files and resolve the storage failure before restarting Relay.", EmptyParametersSchema),
  CRM_DOCUMENT_SOURCE_UNAVAILABLE: catalogEntry("CRM document records could not be verified. Review the requested people and their latest onboarding records.", EmptyParametersSchema),
  CRM_DOCUMENT_REFERENCE_UNAVAILABLE: catalogEntry("CRM identities could not be bound to the selected spreadsheet version and its legal/lived names. Review the retained reference and row choices.", EmptyParametersSchema),
  CRM_DOCUMENT_DOWNLOAD_FAILED: catalogEntry("CRM documents could not be downloaded and verified. No document collection was published.", EmptyParametersSchema),
  CRM_DOCUMENT_PACKAGE_FAILED: catalogEntry("CRM documents could not be verified and packaged. No document collection was published.", EmptyParametersSchema),
  TOO_MANY_PAGES: catalogEntry("This PDF has more than 120 pages. Split the scan into files of at most 120 pages.", EmptyParametersSchema),
  OCR_SOURCE_REFUSED: catalogEntry("This PDF or source page could not be admitted for the current person and review. Reload the saved review or choose a valid PDF up to 25 MB.", EmptyParametersSchema),
  OCR_REVIEW_REFUSED: catalogEntry("The saved OCR review or selection changed or could not be authenticated. Reload the review before continuing.", EmptyParametersSchema),
  OCR_APPROVAL_UNAVAILABLE: catalogEntry("The approved OCR record authority is unavailable. Reload the run before continuing.", EmptyParametersSchema),
  OCR_PUBLICATION_REFUSED: catalogEntry("The OCR reading could not be bound to its saved run, source page and operator. Preserve the run and review its evidence.", EmptyParametersSchema),
  ONBOARDING_CRM_READ_FAILED: catalogEntry("CRM hire data could not be verified. Review the record before starting a new run.", EmptyParametersSchema),
  ONBOARDING_WRITE_REVIEW_REFUSED: catalogEntry("The reviewed hire path does not have complete, matching identity and transaction evidence. Review the retained findings before continuing.", EmptyParametersSchema),
  UCPATH_HIRE_REFUSED: catalogEntry("UCPath hire could not be verified. Review the retained evidence before continuing.", EmptyParametersSchema),
  I9_WRITE_REFUSED: catalogEntry("I-9 did not prove the intended identity, form or saved record. Review the retained evidence; an uncertain submission must not be retried.", EmptyParametersSchema),
  ONBOARDING_DATA_INVALID: catalogEntry("CRM hire data failed validation. Review the source fields and run overrides.", EmptyParametersSchema),
  ONBOARDING_NAME_UNRESOLVED: catalogEntry("Relay cannot tell the first, middle and last name apart in this person's roster Legal Name or Lived Name. Write it in the roster as Last, First Middle, or add the middle name to the CRM record, then run again.", EmptyParametersSchema),
  ONBOARDING_MATCH_INVALID: catalogEntry("UCPath duplicate search returned inconsistent identity evidence.", EmptyParametersSchema),
  ONBOARDING_EXISTING_PERSON_REQUIRED: catalogEntry("Concurrent hire requires an existing UCPath person. Review the hire mode and source identity.", EmptyParametersSchema),
  ONBOARDING_I9_LOOKUP_UNRESOLVED: catalogEntry("The delegated I-9 lookup did not establish a result for this hire. No profile will be created.", EmptyParametersSchema),
  RUN_CONTINUATION_REFUSED: catalogEntry("Saved completed steps could not be authenticated for recovery. No saved result was reused; review the source run before starting work.", EmptyParametersSchema),
  APPLICATION_ADMISSION_REFUSED: catalogEntry("Relay could not secure idle update or shutdown admission. Work remains held; restart Relay after resolving the retained failure.", EmptyParametersSchema),
  UNEXPECTED_CONTACT_PAGE: catalogEntry("UCPath did not show the expected Emergency Contact page.", EmptyParametersSchema),
  CONTACT_IDENTITY_UNREADABLE: catalogEntry("UCPath did not display a readable employee ID and name for these contacts.", EmptyParametersSchema),
  CONTACT_SUBJECT_MISMATCH: catalogEntry("UCPath displayed another employee ID. No contact was saved.", EmptyParametersSchema),
  CONTACT_NAME_MISMATCH: catalogEntry("UCPath displayed another employee name. No contact was saved.", EmptyParametersSchema),
  CONTACT_SET_INCOMPLETE: catalogEntry("The complete UCPath contact set could not be verified. No contact was saved.", EmptyParametersSchema),
  UNREADABLE_CONTACT_ROW: catalogEntry("A UCPath contact row could not be read completely.", EmptyParametersSchema),
  RELATIONSHIP_UNMAPPED: catalogEntry("The contact relationship does not match an offered UCPath relationship.", EmptyParametersSchema),
  ADDRESS_CHOICE_UNRESOLVED: catalogEntry("Choose the contact address explicitly before preparing this contact.", EmptyParametersSchema),
  CONTACT_SET_CHANGED: catalogEntry("UCPath contacts changed during preparation. Review the complete contact set again.", EmptyParametersSchema),
  CONTACT_PLAN_REFUSED: catalogEntry("The contact addition conflicts with the observed contacts. No contact was saved.", EmptyParametersSchema),
  BLANK_ROW_UNAVAILABLE: catalogEntry("UCPath did not provide exactly one blank row for this contact.", EmptyParametersSchema),
  CONTACT_NAME_LOST: catalogEntry("UCPath did not retain the staged contact name. No contact was saved.", EmptyParametersSchema),
  STAGED_EFFECT_MISMATCH: catalogEntry("UCPath did not retain the exact staged contact fields. No contact was saved.", EmptyParametersSchema),
  SAVED_EFFECT_MISMATCH: catalogEntry("UCPath Save could not be confirmed against the complete approved contact plan. The write requires operator resolution.", EmptyParametersSchema),
  CONTACT_SAVE_UNAVAILABLE: catalogEntry("Emergency Contact Save is unavailable. Use Dry Run to review the prepared contact plan.", EmptyParametersSchema),
  CONTACT_APPROVED_PLAN_CONFLICT: catalogEntry("The approved selection contains conflicting primary contact plans for an employee. Select one intended contact per employee or correct the OCR records, then approve again.", EmptyParametersSchema),
  CONTACT_APPROVED_FIELDS_INVALID: catalogEntry("The approved contact fields cannot form a complete UCPath contact plan. Correct and approve the OCR record again.", EmptyParametersSchema),
  STORAGE_AUTOMATIC_BACKUP_FAILED: catalogEntry("The automatic shutdown backup could not be verified. Relay has not completed a clean shutdown.", EmptyParametersSchema),
  STORAGE_AUTOMATIC_REPAIR_REFUSED: catalogEntry("Relay could not safely repair this person's saved data. Their data and unresolved writes are retained, and this person stays signed out.", EmptyParametersSchema),
  STORAGE_PROFILE_UPGRADE_UNRESOLVED_WRITES: catalogEntry("Relay could not update this person's saved data because an earlier write's outcome is not settled. Nothing was changed, their data is retained, and this person stays signed out.", EmptyParametersSchema),
  STORAGE_PROFILE_UPGRADE_REFUSED: catalogEntry("Relay could not verify and upgrade this person's saved data. Their data is retained, and this person stays signed out.", EmptyParametersSchema),
  DRY_RUN_SAMPLE_UNDECLARED: catalogEntry("Dry-run sample values require declared preview provenance.", EmptyParametersSchema),
  DRY_RUN_SAMPLE_REFUSED: catalogEntry("Dry-run samples cannot authorize a real submission.", EmptyParametersSchema),
  WRITE_BUILD_CHANGED: catalogEntry("Relay was updated after this run was approved. Retry the run to approve its write under this version.", EmptyParametersSchema),
  RUNTIME_LIFETIME_LOCK_RELEASED: catalogEntry("Relay runtime authority has closed. Restart Relay before continuing.", EmptyParametersSchema),
  RUNTIME_ALREADY_RUNNING: catalogEntry("Relay is already running. Close it before starting another runtime or storage command.", EmptyParametersSchema),
  PRIVATE_FILE_LOCK_UNAVAILABLE: catalogEntry("Local storage is busy with another operation. Wait for that operation to finish before trying again.", EmptyParametersSchema),
  DATABASE_WRITER_UNAVAILABLE: catalogEntry("Relay’s saved data was busy for too long. Nothing was written. Try again.", EmptyParametersSchema),
  RUN_CRASH_RESOURCES_RELEASED: catalogEntry("Resources held by an interrupted worker were released.", EmptyParametersSchema),
  BROWSER_CLOSURE_UNPROVED: catalogEntry("Browser closure could not be verified. No file replacement or credential erasure has started.", EmptyParametersSchema),
  DUO_SETUP_OPEN_FAILED: catalogEntry("Relay could not start the setup browser. Select Reopen to try again.", EmptyParametersSchema),
  DUO_SETUP_STOP_FAILED: catalogEntry("Relay could not stop the previous setup browser. Select Reopen to try again.", EmptyParametersSchema),
  DUO_SETUP_FILES_BUSY: catalogEntry("The setup browser’s files are still in use. Select Reopen to check again.", EmptyParametersSchema),
  BROWSER_ROOT_UNAVAILABLE: catalogEntry("Browser ownership could not be verified. The browser and its files remain unavailable until stopped recovery succeeds.", EmptyParametersSchema),
  BROWSER_PROFILE_STILL_CLOSING: catalogEntry("The browser profile is still in use or closing. Wait for it to close before continuing.", EmptyParametersSchema),
  STARTUP_CRASH_RECOVERY_REFUSED: catalogEntry("Saved runs and writes could not be reconciled after interruption. Preserve their state and resolve the refusal before starting work.", EmptyParametersSchema),
  RUN_INTERRUPTED_BY_CRASH: catalogEntry("The run was interrupted by a crash and ended as failed. Review the result before starting another run.", EmptyParametersSchema),
  RUN_CRASH_WRITE_UNRESOLVED: catalogEntry("The run was interrupted by a crash with an unresolved write. The write remains held for operator resolution and will not be retried.", EmptyParametersSchema),
  RUN_STALE_QUEUE_CANCELLED: catalogEntry("The never-claimed run was queued on a previous local day and was cancelled during startup.", EmptyParametersSchema),
  RUN_LOGOUT_CANCELLED: catalogEntry("Relay cancelled this run when the profile logged out.", EmptyParametersSchema),
  STARTUP_PROCESS_CLOSED: catalogEntry("A process left by a crash was proved gone and its process custody was settled. Any unresolved writes remain held.", EmptyParametersSchema),
  PARKED_CHECK_ABSENT: catalogEntry("The target state was not found. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_AMBIGUOUS: catalogEntry("The target evidence is ambiguous. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_UNKNOWN: catalogEntry("The target state could not be determined. The write remains held.", EmptyParametersSchema),
  PARKED_CHECK_UNAVAILABLE: catalogEntry("This exact parked occurrence cannot be checked with the current subject, worker or read capability. The write remains held.", EmptyParametersSchema),
  WRITE_RECOVERY_ACTIVITY_UNAVAILABLE: catalogEntry("Recovery could not record its activity, actions or required captures. The write remains held; preserve its evidence before checking again.", EmptyParametersSchema),
  PARKED_CHECK_OCCURRENCE_UNPROVED: catalogEntry("A matching target state was observed, but it cannot be attributed to the original attempt. The write remains held.", EmptyParametersSchema),
  DOCUMENT_UNAVAILABLE: catalogEntry("The Kuali separation document could not be opened. Review the document number before starting a new run.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_UNAVAILABLE: catalogEntry("The OS credential store is unavailable. Unlock it before opening Relay.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_MISSING: catalogEntry("The profile encryption key is missing from this machine's OS credential store. Restore requires its original key.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_MISMATCH: catalogEntry("The OS encryption key does not match this profile's binding. Preserve the current installation for recovery.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_UNCERTAIN: catalogEntry("Encryption key custody could not be confirmed. Preserve the installation and OS credential entry before continuing.", EmptyParametersSchema),
  CREDENTIAL_BUSY: catalogEntry("Credentials are in use by another operation.", EmptyParametersSchema),
  CREDENTIAL_CONFLICT: catalogEntry("Credentials changed. Read their current state before trying again.", EmptyParametersSchema),
  CREDENTIAL_UNCERTAIN: catalogEntry("The credential change could not be confirmed. Preserve this profile before continuing.", EmptyParametersSchema),
  CREDENTIAL_UNAVAILABLE: catalogEntry("Credentials could not be read or saved safely.", EmptyParametersSchema),
  DUO_CREDENTIAL_BUSY: catalogEntry("Duo credentials are in use by another operation.", EmptyParametersSchema),
  DUO_CREDENTIAL_CONFLICT: catalogEntry("The Duo credential changed. Read its current state before trying again.", EmptyParametersSchema),
  DUO_CREDENTIAL_UNCERTAIN: catalogEntry("The Duo credential change could not be confirmed. Preserve this profile before continuing.", EmptyParametersSchema),
  DUO_CREDENTIAL_UNAVAILABLE: catalogEntry("Duo credentials could not be read or saved safely.", EmptyParametersSchema),
  CREDENTIAL_CONVERSION_COUNTER_UNPROVED: catalogEntry("The retained Duo credential has no proved durable signing-counter floor. Keep this profile stopped and preserve its credential sources.", EmptyParametersSchema),
  CREDENTIAL_CONVERSION_REQUIRED: catalogEntry("Restart Relay to finish this profile's credential conversion, then log in. Saved data is preserved.", EmptyParametersSchema),
  CREDENTIAL_CONVERSION_UNSUPPORTED: catalogEntry("Credential conversion cannot prove this source format. Keep the profile stopped and preserve the original installation.", EmptyParametersSchema),
  CREDENTIAL_OPERATION_PENDING: catalogEntry("A credential operation is incomplete. Keep this profile stopped and recover that exact operation before continuing.", EmptyParametersSchema),
  CREDENTIAL_ABANDONED_SIGNUP_HELD: catalogEntry("An unfinished sign-up left a saved sign-in record Relay cannot prove is unused. Quit Relay, keep its data folder unchanged and do not delete any key; then restore your latest Relay backup or ask your Relay maintainer to recover this sign-up.", EmptyParametersSchema),
  CREDENTIAL_CREATE_KEY_MISSING: catalogEntry("A prepared credential creation has no matching OS key. Preserve the installation; its key must not be regenerated.", EmptyParametersSchema),
  CREDENTIAL_CONTEXT_REQUIRED: catalogEntry("The selected profile credential authority is unavailable. Restart the runtime before continuing.", EmptyParametersSchema),
  CREDENTIAL_INITIALIZATION_RETAINED_DUO_KEY_MISMATCH: catalogEntry("A retained Duo credential copy uses a different encryption key. Preserve the profile and its original key before continuing credential conversion.", EmptyParametersSchema),
  RUNTIME_CUSTODY_UNCERTAIN: catalogEntry("Runtime resource closure is unproved. Preserve the current installation and process custody before restarting.", EmptyParametersSchema),
  STORAGE_PROFILE_NEWER_VERSION: catalogEntry("This profile was saved by a newer Relay version. Open it with that version or newer. Your data has not been changed.", EmptyParametersSchema),
  STORAGE_PROFILE_PROJECTION_REPAIR_FAILED: catalogEntry("Relay could not rebuild this person's run search index. Saved data has not been changed. Restart Relay to try again before this person signs in.", EmptyParametersSchema),
  STORAGE_PROFILE_FORMAT_UNSUPPORTED: catalogEntry("Relay cannot read this profile format. Your data has not been changed. Use the matching or a newer Relay build.", EmptyParametersSchema),
  STORAGE_DOCTOR_OBSERVATION_CHANGED: catalogEntry("Storage changed during inspection; readiness could not be verified.", EmptyParametersSchema),
  PROFILE_BROWSER_ROOT_REFUSED: catalogEntry("Browser storage must stay inside the selected profile in an owned directory without links.", EmptyParametersSchema),
  STORAGE_FIXED_LAYOUT_REFUSED: catalogEntry("Relay could not verify its app data at the fixed location. Your data has been retained; startup cannot continue.", EmptyParametersSchema),
  ASSISTANT_INVALID: catalogEntry("The assistant request or response was invalid.", EmptyParametersSchema),
  ASSISTANT_CONTEXT_UNAVAILABLE: catalogEntry("Verified public source context is unavailable.", EmptyParametersSchema),
  ASSISTANT_CONTEXT_STALE: catalogEntry("The public source context does not match this runtime.", EmptyParametersSchema),
  CHATGPT_ASSISTANT_REFUSED: catalogEntry("The model refused this assistant request.", EmptyParametersSchema),
  ASSISTANT_MODEL_UNAVAILABLE: catalogEntry("The selected model is not available in the current ChatGPT account catalog.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_REFUSED: catalogEntry("The model refused this assistant request.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_INCOMPLETE: catalogEntry("ChatGPT returned an incomplete assistant response. Test again; if it repeats, review the model and connection.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_FAILED: catalogEntry("ChatGPT could not complete the assistant response. Review the connection and test again.", EmptyParametersSchema),
  ASSISTANT_MODEL_UNVERIFIED: catalogEntry("Test assistant to verify the selected model before chatting.", EmptyParametersSchema),
  ASSISTANT_USAGE_LIMIT: catalogEntry("This request reached a ChatGPT usage limit. Review this app's limit in ChatGPT Settings → Usage before trying again.", EmptyParametersSchema),
  ASSISTANT_PLAN_DISABLED: catalogEntry("ChatGPT plan use is not enabled or permitted for this connection. Review app permissions and plan eligibility in ChatGPT.", EmptyParametersSchema),
  ASSISTANT_ACCOUNT_EXPIRED: catalogEntry("Reconnect the ChatGPT account before using the assistant.", EmptyParametersSchema),
  ASSISTANT_UNAVAILABLE: catalogEntry("The assistant is unavailable. Check the ChatGPT connection.", EmptyParametersSchema),
  ASSISTANT_VERIFICATION_FAILED: catalogEntry("Assistant verification failed. Review the selected person, model and ChatGPT connection, then test again.", EmptyParametersSchema),
  ASSISTANT_CAPABILITY_FAILED: catalogEntry("The selected model did not complete the required assistant tool-call test. Review the model and effort or reconnect ChatGPT, then test again.", EmptyParametersSchema),
  ASSISTANT_READ_UNAVAILABLE: catalogEntry("Local run evidence is unavailable to the assistant. Review the selected run in Logs.", EmptyParametersSchema),
  ASSISTANT_READ_STALE: catalogEntry("The selected run changed while its evidence was being read. Select its current revision and ask again.", EmptyParametersSchema),
  ASSISTANT_HISTORY_UNAVAILABLE: catalogEntry("Chat history could not be loaded for the signed-in person. Refresh to try again.", EmptyParametersSchema),
  ASSISTANT_HISTORY_UNSAVED: catalogEntry("Chat history could not be saved in this tab. Keep this page open to retain the current conversation.", EmptyParametersSchema),
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
  PROFILE_FIRST_RUN_CHECK_UNAVAILABLE: catalogEntry(
    "The initial local startup check did not complete. Resume sign-in to retry startup.",
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
  RUN_START_PLAN_EXPIRED: catalogEntry(
    "This plan expired. Review a fresh plan before starting again.",
    EmptyParametersSchema,
  ),
  RUN_START_READINESS_BLOCKED: catalogEntry(
    "Readiness checks failed. Review Settings before starting again.",
    EmptyParametersSchema,
  ),
  RUN_START_READINESS_UNAVAILABLE: catalogEntry(
    "Readiness could not be checked. Try Start again.",
    EmptyParametersSchema,
  ),
  RUN_START_READINESS_CHANGED: catalogEntry(
    "Readiness changed during the check. Review the plan and try Start again.",
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
  I9_CHECK_DATA_INVALID: catalogEntry(
    "I-9 check evidence is missing, invalid, or inconsistent.",
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
    "The Duo prompt never cleared; check that Fast Duo is loaded and its credential is current.",
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
  DUO_TERMINAL_REFUSAL: catalogEntry(
    "Duo refused the sign-in. Run it again; if it repeats, check Fast Duo.",
    EmptyParametersSchema,
  ),
  UCPATH_MAINTENANCE: catalogEntry(
    "UCPath is down for maintenance. Try again later.",
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
  ONBASE_SESSION_HELD: catalogEntry("OnBase is held by another session. Its browser closure must be proven before this account can be used again.", EmptyParametersSchema),
  ONBASE_IMPORT_UNPROVED: catalogEntry("The OnBase document import could not be verified. Review the saved evidence before continuing.", EmptyParametersSchema),
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
  I9_LOOKUP_FAILED: catalogEntry(
    "The I-9 record could not be read or verified. Review the page state before retrying.",
    EmptyParametersSchema,
  ),
  I9_LOOKUP_AMBIGUOUS: catalogEntry(
    "I-9 search did not identify one exact-name employee profile. Resolve the identity before continuing.",
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
  CAPABILITY_UNAVAILABLE: catalogEntry(
    "Relay stopped before this step because a capability it needs is not available. Review local diagnostic evidence.",
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
  SEARCH_LIBRARY_UNAVAILABLE: catalogEntry("Spreadsheets are unavailable. Reopen search and try again.", EmptyParametersSchema),
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
  LOGGING_UNAVAILABLE: catalogEntry(
    "Debug logging is unavailable; inspect the local emergency fault log.",
    EmptyParametersSchema,
  ),
  DASHBOARD_ERROR_REPORT_UNAVAILABLE: catalogEntry(
    "Dashboard error report was not recorded",
    EmptyParametersSchema,
  ),
  DASHBOARD_PAGE_FAILED: catalogEntry("Relay could not display this page. Open the dashboard to continue.", EmptyParametersSchema),
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
  WORKER_START_FAILED: catalogEntry(
    "The worker process could not be started.",
    EmptyParametersSchema,
  ),
  WORKER_START_TIMED_OUT: catalogEntry(
    "The worker did not report ready in time and was stopped. Retry the worker.",
    EmptyParametersSchema,
  ),
  WORKER_REQUEST_TIMED_OUT: catalogEntry(
    "The worker did not answer in time. Nothing was retried; try again.",
    EmptyParametersSchema,
  ),
  WORKER_EXITED: catalogEntry(
    "The worker stopped before it answered. Nothing was retried.",
    EmptyParametersSchema,
  ),
  WORKER_EXIT_SETTLEMENT_FAILED: catalogEntry(
    "Relay could not settle the runs of a worker that stopped. That worker cannot start until its runs are settled.",
    EmptyParametersSchema,
  ),
  WORKER_EXIT_UNOBSERVED: catalogEntry(
    "A worker process did not exit after it was stopped. Relay will not start beside it; quit Relay and wait for the process to end.",
    EmptyParametersSchema,
  ),
  WORKER_ALREADY_RUNNING: catalogEntry(
    "This worker is already running.",
    EmptyParametersSchema,
  ),
  WORKER_TARGET_STALE: catalogEntry(
    "The worker changed since this view was loaded. Refresh and try again.",
    EmptyParametersSchema,
  ),
  WORKER_PAUSE_SETTLING: catalogEntry(
    "This worker is still pausing its run. Resolve any unknown write in Logs before resuming the worker.",
    EmptyParametersSchema,
  ),
  WORKER_BUSY: catalogEntry(
    "The worker is busy with a run or another control. Try again when it is idle.",
    EmptyParametersSchema,
  ),
  WORKER_REMOVAL_CHILD_CLOSE_UNPROVED: catalogEntry(
    "Relay could not verify that the worker process closed. The worker and its browser profiles were kept.",
    EmptyParametersSchema,
  ),
  WORKER_REQUEST_EXPIRED: catalogEntry(
    "The worker request expired before it started. Nothing was done.",
    EmptyParametersSchema,
  ),
  WORKER_IPC_PROTOCOL_INVALID: catalogEntry(
    "A worker sent an invalid message and was stopped.",
    EmptyParametersSchema,
  ),
  WORKER_IDENTITY_MISMATCH: catalogEntry(
    "A worker reported a different person or sign-in and was stopped.",
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
  PROFILE_DISPLAY_NAME_REFUSED: catalogEntry(
    "That name cannot be used. Use a first and last name that each start with a letter.",
    EmptyParametersSchema,
  ),
  PROFILE_INITIALS_REFUSED: catalogEntry(
    "Initials must be 1 to 8 letters A to Z.",
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
    "This email already has a profile on this computer. Log in to continue.",
    EmptyParametersSchema,
  ),
  PROFILE_ACCOUNT_DELETION_REFUSED: catalogEntry("Relay could not complete account deletion. If erasure has started, sign-in stays blocked; restart Relay to settle it safely.", EmptyParametersSchema),
  PROFILE_LOGOUT_BLOCKED: catalogEntry(
    "Log out waits until this profile's active work can stop.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGOUT_INCOMPLETE: catalogEntry("A previous log out did not finish. Log in to that profile to continue it before creating a profile.", EmptyParametersSchema),
  PROFILE_STARTUP_CONVERSION_REFUSED: catalogEntry("Relay could not finish this profile's startup conversion. Saved data is preserved. Review the local evidence, then restart Relay before logging in.", EmptyParametersSchema),
  ONBOARDING_DUO_DIAGNOSTIC_LOG_UNAVAILABLE: catalogEntry("Duo diagnostic logging is unavailable.", EmptyParametersSchema),
  PROFILE_CONNECTION_FAILED: catalogEntry("Could not connect to Relay. Check that Relay is running, then try again.", EmptyParametersSchema),
  PROFILE_AUTHORITY_UNAVAILABLE: catalogEntry("Current profile authority is unavailable.", EmptyParametersSchema),
  PROFILE_SESSION_LOG_UNAVAILABLE: catalogEntry("Relay could not record session transition evidence. The transition could not finish.", EmptyParametersSchema),
  PROFILE_AUTHORITY_CHANGED: catalogEntry("Profile authority changed. Capture it again before continuing.", EmptyParametersSchema),
  DASHBOARD_FRONTEND_NOT_OWNED: catalogEntry(
    "This Relay page was not started by the running Relay. Close it and start Relay again with npm run dashboard.",
    EmptyParametersSchema,
  ),
  PROFILE_RUNTIME_START_FAILED: catalogEntry(
    "You are signed in, but Relay could not open the dashboard. Nothing was changed. Close Relay and start it again.",
    EmptyParametersSchema,
  ),
  PROFILE_SESSION_STALE: catalogEntry(
    "This sign-in is no longer active. Sign in again.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGOUT_INVENTORY_BLOCKED: catalogEntry(
    "Saved work email and password were removed, but a backup still has a copy.",
    EmptyParametersSchema,
  ),
  PROFILE_CURRENT_PASSWORD_REFUSED: catalogEntry(
    "The current password was not accepted. Nothing was changed.",
    EmptyParametersSchema,
  ),
  PROFILE_USERNAME_TAKEN: catalogEntry(
    "Another profile on this computer already uses that email. Nothing was changed.",
    EmptyParametersSchema,
  ),
  PROFILE_USERNAME_REFUSED: catalogEntry(
    "Enter a different @ucsd.edu email with no spaces around it. Nothing was changed.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGIN_CHANGE_UNKNOWN: catalogEntry(
    "Relay could not confirm whether your sign-in changed, and nothing will be undone. Try your new username and password first, then your current ones.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGIN_CHANGE_UNSETTLED: catalogEntry(
    "Your sign-in change did not finish. Try it again; until it finishes, your current username and password still sign you in.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGIN_CHANGE_BUSY: catalogEntry(
    "Another save was in progress, so your sign-in was not changed. Try again.",
    EmptyParametersSchema,
  ),
  PROFILE_FLAT_STORE_MIGRATION_FAILED: catalogEntry("Relay could not verify the old store backup and start a clean profile installation. Startup is stopped; remaining data is preserved.", EmptyParametersSchema),
  PROFILE_SIGN_UP_OTHER_SIGNED_IN: catalogEntry(
    "Another profile is still signed in on this computer. Log in to it and log out, then create the new profile.",
    EmptyParametersSchema,
  ),
  PROFILE_TRANSITION_BLOCKED: catalogEntry(
    "Sign in waits until the other profile is logged out.",
    EmptyParametersSchema,
  ),
  RUNTIME_OFFLINE_OPERATION_UNAVAILABLE: catalogEntry(
    "This offline operation is busy, expired, already used, or belongs to a different runtime. Existing storage is preserved; start a new explicit command after the current owner closes.",
    EmptyParametersSchema,
  ),
  RUNTIME_OLD_BUILD_ARTIFACTS: catalogEntry(
    "This installation contains runtime lock evidence from an older build. Offline maintenance is stopped and the evidence is preserved. Use the approved start-clean procedure.",
    EmptyParametersSchema,
  ),
  STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE: catalogEntry(
    "Windows backups, restore, backup removal, upgrades, migration and account deletion are unavailable until exclusive storage custody can be proved. Existing data is preserved.",
    EmptyParametersSchema,
  ),
  STORAGE_BACKUP_SOURCE_CHANGED: catalogEntry(
    "The source no longer matches the retained backup. The first backup is preserved; keep this installation for recovery.",
    EmptyParametersSchema,
  ),
  STORAGE_BACKUP_CLOSURE_UNPROVED: catalogEntry(
    "Relay could not verify a completed browser closure step for this backup. The backup is refused; preserve the current installation for recovery.",
    EmptyParametersSchema,
  ),
  PROFILE_RESTORE_BROWSER_CUSTODY_UNPROVED: catalogEntry(
    "Browser closure for damaged profile storage could not be proved. This restore requires macOS and a complete unchanged browser-directory census. Existing storage is preserved.",
    EmptyParametersSchema,
  ),
  PROFILE_RESTORE_ADMISSION_REQUIRED: catalogEntry(
    "Log out cannot finish until restore admission accepts the machine erasure journal.",
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
    "ChatGPT plan use is not enabled or permitted for this connection. Review app permissions and plan eligibility in ChatGPT.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_LIMIT: catalogEntry(
    "This request reached a ChatGPT usage limit. Review this app's limit in ChatGPT Settings → Usage before trying again.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_UNAVAILABLE: catalogEntry(
    "ChatGPT plan usage could not be checked. Keep the connection and try again later.",
    EmptyParametersSchema,
  ),
  CHATGPT_MODEL_UNAVAILABLE: catalogEntry(
    "The requested model is unavailable for this ChatGPT connection. Review the available models before trying again.",
    EmptyParametersSchema,
  ),
  CHATGPT_MODELS_UNAVAILABLE: catalogEntry(
    "Relay could not read the models available to this ChatGPT connection. Keep the connection and try again; details are in the local diagnostics.",
    EmptyParametersSchema,
  ),
  CHATGPT_CONNECTION_FAILED: catalogEntry(
    "Relay could not verify the ChatGPT connection. Keep the connection and try again; details are in the local diagnostics.",
    EmptyParametersSchema,
  ),
  CHATGPT_CONNECTION_CANCELLED: catalogEntry(
    "The ChatGPT connection check was cancelled. Check again when the account and profile are current.",
    EmptyParametersSchema,
  ),
  CHATGPT_REQUEST_REJECTED: catalogEntry(
    "ChatGPT rejected the request Relay sent. Relay's integration needs correction; review the local diagnostics before retrying.",
    EmptyParametersSchema,
  ),
  CHATGPT_RATE_LIMITED: catalogEntry(
    "ChatGPT is limiting request frequency. Keep the connection and wait before trying again.",
    EmptyParametersSchema,
  ),
  CHATGPT_DIAGNOSTICS_UNAVAILABLE: catalogEntry(
    "The ChatGPT request failed and Relay could not save its local diagnostics.",
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
  WORKBOOK_OPERATION_CONFLICT: catalogEntry("This workbook operation ID was already used with different input.", EmptyParametersSchema),
  WORKBOOK_TYPE_IN_USE: catalogEntry("This type is used by workbook history. You can rename columns and change required fields; create a new type to change its columns or key.", EmptyParametersSchema),
  WORKBOOK_VERSION_IN_USE: catalogEntry("This version is in use. Choose another version and finish runs using it before deleting it.", EmptyParametersSchema),
  WORKBOOK_LIBRARY_IN_USE: catalogEntry("This spreadsheet is in use by a run or pending change. Finish that work before removing it.", EmptyParametersSchema),
  WORKBOOK_MERGE_INVALID: catalogEntry("These spreadsheets cannot be merged with that duplicate policy. Check their types, worksheet layouts, and matching keys, or keep both rows.", EmptyParametersSchema),
  WORKBOOK_ACTION_RETIRED: catalogEntry("This library action has been retired. Its retained evidence is unavailable here.", EmptyParametersSchema),
  WORKBOOK_ROW_CHOICE_UNAVAILABLE: catalogEntry("No matching row is available in this run's captured worksheets. Review the workbook before choosing again.", EmptyParametersSchema),
  WORKBOOK_REVISION_UNAVAILABLE: catalogEntry("This saved workbook revision cannot be reconstructed from its retained evidence.", EmptyParametersSchema),
  WORKBOOK_SYNC_LINK_REQUIRED: catalogEntry("Link a SharePoint workbook before syncing.", EmptyParametersSchema),
  WORKBOOK_SYNC_CONTEXT_CHANGED: catalogEntry("The profile, settings or credentials changed during Sync. Start a new Sync command.", EmptyParametersSchema),
  WORKBOOK_SYNC_IMPORT_FAILED: catalogEntry("The downloaded file cannot be imported as a supported workbook.", EmptyParametersSchema),
  WORKBOOK_TYPE_UNAVAILABLE: catalogEntry("This workflow's spreadsheet type is unavailable. Restore its reference definition before importing a file for it.", EmptyParametersSchema),
  WORKBOOK_LIBRARY_EMPTY: catalogEntry("Import a Library spreadsheet before selecting a workflow source.", EmptyParametersSchema),
  WORKBOOK_FIELDS_MISSING: catalogEntry("A Library worksheet is missing fields required by this workflow. Review its column mappings.", EmptyParametersSchema),
  WORKBOOK_FIELDS_DUPLICATE: catalogEntry("A Library worksheet maps a required field more than once. Review its column mappings.", EmptyParametersSchema),
  WORKBOOK_REFERENCE_MISSING: catalogEntry("No spreadsheet is bound to this workflow reference.", EmptyParametersSchema),
  WORKBOOK_BINDING_UNAVAILABLE: catalogEntry("This workflow's selected spreadsheet is unavailable or has a different type. Import a replacement for this reference.", EmptyParametersSchema),
  WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE: catalogEntry("The workbook's workflow source was not retained. Its saved data remains available, but its run cannot be confirmed.", EmptyParametersSchema),
  WORKBOOK_SYNC_LAYOUT_CHANGED: catalogEntry("The SharePoint worksheets or columns no longer match this spreadsheet type. Review the source before creating a version.", EmptyParametersSchema),
  SHAREPOINT_LINK_UNSUPPORTED: catalogEntry("Use a direct workbook file URL from the configured SharePoint tenant.", EmptyParametersSchema),
  SHAREPOINT_DOWNLOAD_FAILED: catalogEntry("The authenticated SharePoint workbook download could not be verified.", EmptyParametersSchema),
  SHAREPOINT_DOWNLOAD_TOO_LARGE: catalogEntry("The SharePoint workbook exceeds the 20 MiB download limit.", EmptyParametersSchema),
  COMMAND_BROWSER_BUSY: catalogEntry("Another browser command is still running or awaiting proven closure.", EmptyParametersSchema),
  COMMAND_BROWSER_CANCELLED: catalogEntry("The browser command was cancelled before it could finish.", EmptyParametersSchema),
  COMMAND_BROWSER_UNAVAILABLE: catalogEntry("The browser command could not acquire its current profile and session.", EmptyParametersSchema),
  COMMAND_BROWSER_CLOSURE_UNPROVED: catalogEntry("The command's browser or authentication resources could not be proven closed. Profile custody is retained.", EmptyParametersSchema),
  WORKBOOK_METADATA_UNSUPPORTED: catalogEntry("This workbook has formulas, Excel error cells or metadata Relay cannot preserve during master edits.", EmptyParametersSchema),
  WORKBOOK_CAPTURE_LIMIT_EXCEEDED: catalogEntry("The selected worksheets exceed the capture limit of 32 sources, 250,000 populated cells or 500,000 cell positions. Select fewer or smaller worksheets.", EmptyParametersSchema),
  WORKBOOK_INVALID: catalogEntry(
    "The workbook is malformed and cannot be saved.",
    EmptyParametersSchema,
  ),
  WORKBOOK_PROVIDER_UNAVAILABLE: catalogEntry(
    "The workflow workbook result is unconfirmed. Resume the same run to check its saved result.",
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
  PREFLIGHT_BLOCKED: catalogEntry(
    "Readiness checks blocked this worker. Check Settings readiness; the queued run will wait until its prerequisites are available.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_OBSERVATION_CHANGED: catalogEntry(
    "Storage changed before the next run could be claimed. Re-check readiness; use Sessions for any queued run instead of starting it again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_TIMEOUT: catalogEntry(
    "A readiness check took too long. Check again.",
    EmptyParametersSchema,
  ),
  BULK_CHILD_ERRORED: catalogEntry(
    "Relay hit an error on this item and stopped the batch here. Nothing changed for this item.",
    EmptyParametersSchema,
  ),
  RUN_QUEUED_WORKER_UNAVAILABLE: catalogEntry(
    "Your run is queued. Worker startup did not complete; review this run and Sessions. Do not start the run again.",
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
