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

/** The first sentence of a failure text: what a notification shows. The whole text stays on the run. */
export function shortFailureText(text: string): string {
  return /^.*?[.!?](?=\s|$)/su.exec(text)?.[0] ?? text;
}

export const ERROR_CATALOG = Object.freeze({
  DELEGATION_CONFIG_UNAVAILABLE: catalogEntry("Saved settings could not be checked, so the next workflow stopped.", EmptyParametersSchema),
  AMBIGUOUS_ACTION_LIST_MATCH: catalogEntry("More than one Kuali Action List item matches this document.", EmptyParametersSchema),
  BLANK_TERMINATION_TYPE: catalogEntry("The separation document has no termination type.", EmptyParametersSchema),
  COMMENTS_CHANGED_SINCE_READ: catalogEntry("The Kuali comments changed after they were read.", EmptyParametersSchema),
  CONCURRENT_ACTIVE_EMPLOYMENTS: catalogEntry("More than one active UCPath job matches this employee.", EmptyParametersSchema),
  DELETE_REFUSED: catalogEntry("UCPath did not confirm clearing the pending termination.", EmptyParametersSchema),
  DEPARTMENT_CODE_NOT_OFFERED: catalogEntry("Kuali has no option for this employee’s UCPath department.", EmptyParametersSchema),
  DEPARTMENT_CODE_UNREADABLE: catalogEntry("The employee’s UCPath department code could not be read.", EmptyParametersSchema),
  DEPARTMENT_OPTION_AMBIGUOUS: catalogEntry("More than one Kuali department option matches the UCPath department.", EmptyParametersSchema),
  DEPARTMENT_OPTION_NOT_OFFERED: catalogEntry("No Kuali department option matches the UCPath department.", EmptyParametersSchema),
  DEPARTMENT_OPTION_UNUSABLE: catalogEntry("The matching Kuali department option has no usable name.", EmptyParametersSchema),
  DOCUMENT_NOT_IN_ACTION_LIST: catalogEntry("This separation document is not in the Kuali Action List.", EmptyParametersSchema),
  DOCUMENT_NUMBER_MISMATCH: catalogEntry("Kuali opened a different document than requested.", EmptyParametersSchema),
  EMPLID_NOT_RECOGNIZED: catalogEntry("UCPath did not recognize the employee ID. Check the document.", EmptyParametersSchema),
  EMPLOYEE_ID_ABSENT: catalogEntry("The separation document has no Employee ID.", EmptyParametersSchema),
  EMPLOYEE_ID_NO_MATCH: catalogEntry("No UCPath person matches the Employee ID on the separation document.", EmptyParametersSchema),
  EMPLOYEE_NAME_ABSENT: catalogEntry("The separation document has no employee name.", EmptyParametersSchema),
  EMPLOYEE_NOT_FOUND: catalogEntry("No employee found. Check the name or employee ID.", EmptyParametersSchema),
  EMPLOYMENT_RECORD_MISMATCH: catalogEntry("The UCPath job record is not the one selected for this termination.", EmptyParametersSchema),
  EMPTY_DOCUMENT: catalogEntry("The PDF has no pages to read. Choose a complete PDF.", EmptyParametersSchema),
  FILING_NOT_CURRENT: catalogEntry("UCPath could not confirm the termination filing is current.", EmptyParametersSchema),
  IDENTITY_APPROVAL_CHOICE_MISMATCH: catalogEntry("The approved choice does not match the name and employee ID shown.", EmptyParametersSchema),
  IDENTITY_APPROVAL_EID_NOT_SHOWN: catalogEntry("The choice’s employee ID is not in the UCPath results.", EmptyParametersSchema),
  IDENTITY_APPROVAL_EVIDENCE_MOVED: catalogEntry("The details changed after they were reviewed. Review them again.", EmptyParametersSchema),
  IDENTITY_APPROVAL_REJECTED: catalogEntry("The person match was rejected. Correct the person or document details.", EmptyParametersSchema),
  IDENTITY_APPROVAL_REQUIRED: catalogEntry("This separation needs the person match approved first.", EmptyParametersSchema),
  IDENTITY_SOURCE_INCONSISTENT: catalogEntry("The document’s employee ID does not match the person record.", EmptyParametersSchema),
  IDENTITY_SUBJECT_MISMATCH: catalogEntry("UCPath showed a different employee than this run selected. Stop and review.", EmptyParametersSchema),
  IDENTITY_SUPPLIED_EID_UNPROVED: catalogEntry("UCPath did not confirm the employee ID on the separation document.", EmptyParametersSchema),
  INCOMPLETE_EXTRACTION: catalogEntry("The page reading is missing required form information. Correct it.", EmptyParametersSchema),
  INDETERMINATE_EMPLOYMENT_STATUS: catalogEntry("The employee’s UCPath employment status could not be classified.", EmptyParametersSchema),
  KUALI_UNAVAILABLE: catalogEntry("Kuali could not be reached. Check the connection.", EmptyParametersSchema),
  LAST_DATE_WORKED_NOT_VERIFIED: catalogEntry("UCPath did not confirm the last day worked on the termination.", EmptyParametersSchema),
  LAST_DAY_WORKED_ABSENT: catalogEntry("The separation document has no last day worked.", EmptyParametersSchema),
  LEAVE_DATE_OUTSIDE_WINDOW: catalogEntry("A leave date falls outside the timecard date range.", EmptyParametersSchema),
  NEW_KRONOS_UNAVAILABLE: catalogEntry("Kronos could not be reached. Check the connection.", EmptyParametersSchema),
  NO_ACTIVE_EMPLOYMENT: catalogEntry("This employee has no active UCPath job.", EmptyParametersSchema),
  NO_PUNCH_IN_WINDOW: catalogEntry("No timecard punch was found in the selected date range.", EmptyParametersSchema),
  NOT_A_SEPARATION_DOCUMENT: catalogEntry("The selected Kuali document is not a separation document.", EmptyParametersSchema),
  PAGE_OUT_OF_RANGE: catalogEntry("The page number is outside the PDF. Choose a page in range.", EmptyParametersSchema),
  PAYROLL_TITLE_CODE_UNREADABLE: catalogEntry("The employee’s UCPath job code could not be read.", EmptyParametersSchema),
  PAYROLL_TITLE_UNREADABLE: catalogEntry("The employee’s UCPath job title could not be read.", EmptyParametersSchema),
  PROVIDER_UNAVAILABLE: catalogEntry("The page reading service is unavailable. Check the connection and OCR account.", EmptyParametersSchema),
  REASON_CODE_NOT_OFFERED: catalogEntry("UCPath does not offer the selected termination reason.", EmptyParametersSchema),
  REQUESTED_EMPLOYMENT_INACTIVE: catalogEntry("The job named on the separation form is no longer active.", EmptyParametersSchema),
  REQUESTED_TITLE_CONFLICT: catalogEntry("The separation form names more than one job. Correct the form.", EmptyParametersSchema),
  REQUESTED_TITLE_NOT_FOUND: catalogEntry("No UCPath job matches the title on the separation form.", EmptyParametersSchema),
  REQUESTED_TITLE_UNREADABLE: catalogEntry("The Student Title Code on the separation form could not be read.", EmptyParametersSchema),
  SAVE_REFUSED: catalogEntry("Kuali did not confirm saving the termination receipt.", EmptyParametersSchema),
  SEARCH_NO_SIGNAL: catalogEntry("The Kronos search returned no usable result. Try again.", EmptyParametersSchema),
  SEARCH_RETURNED_NO_MATCH: catalogEntry("Kronos found no employee with these details. Check the name or ID.", EmptyParametersSchema),
  SELECTION_NOT_PERSISTED: catalogEntry("UCPath did not keep the pending termination selection.", EmptyParametersSchema),
  SEPARATION_DATE_ABSENT: catalogEntry("The separation document has no separation date.", EmptyParametersSchema),
  SEPARATION_DATE_IN_FUTURE: catalogEntry("The separation date is after the document’s reference date.", EmptyParametersSchema),
  STAGE_NOT_PERSISTED: catalogEntry("The staged changes were not kept. Review the current record.", EmptyParametersSchema),
  SUBJECT_AMBIGUOUS: catalogEntry("More than one UCPath person matches the name on the document.", EmptyParametersSchema),
  SUBJECT_MISMATCH: catalogEntry("A different employee appeared than this run expects. Stop and review.", EmptyParametersSchema),
  SUBJECT_NOT_RESOLVABLE: catalogEntry("No UCPath person matches the name on the separation document.", EmptyParametersSchema),
  SUBMIT_REFUSED: catalogEntry("UCPath did not confirm the termination submission. Check its status.", EmptyParametersSchema),
  TERMINATION_NOT_IN_EFFECT: catalogEntry("UCPath’s receipt does not show the termination in effect.", EmptyParametersSchema),
  TERMINATION_RECEIPT_DATE_MISMATCH: catalogEntry("The receipt’s effective date differs from the date this run filed.", EmptyParametersSchema),
  TERMINATION_RECEIPT_SUBJECT_MISMATCH: catalogEntry("UCPath’s receipt names a different employee than this run verified.", EmptyParametersSchema),
  TERMINATION_RECEIPT_UNUSABLE: catalogEntry("Kuali cannot store the transaction number UCPath returned.", EmptyParametersSchema),
  TERMINATION_TYPE_OPTIONS_DRIFTED: catalogEntry("The termination types changed during this run. Choose again.", EmptyParametersSchema),
  TIMECARD_NAVIGATION_FAILED: catalogEntry("Kronos could not open the employee’s timecard.", EmptyParametersSchema),
  TIMECARD_RANGE_NOT_APPLIED: catalogEntry("Kronos did not apply the requested date range.", EmptyParametersSchema),
  TIMECARD_UNREADABLE: catalogEntry("Kronos could not verify the timecard. Enter the separation dates by hand.", EmptyParametersSchema),
  UCPATH_UNAVAILABLE: catalogEntry("UCPath could not be reached. Check the connection.", EmptyParametersSchema),
  UNEXPECTED_PAGE_STATE: catalogEntry("The expected page did not appear. Review the current page.", EmptyParametersSchema),
  UNKNOWN_TERMINATION_TYPE: catalogEntry("The termination type was not recognized.", EmptyParametersSchema),
  UNMAPPED_TERMINATION_TYPE: catalogEntry("The termination type has no matching UCPath reason.", EmptyParametersSchema),
  UNPARSEABLE_DATE: catalogEntry("A date on the separation document could not be read.", EmptyParametersSchema),
  UNREADABLE_ACTION_LINK: catalogEntry("Kuali gave no readable link for the matching document.", EmptyParametersSchema),
  UNREADABLE_EID: catalogEntry("The employee ID on the separation document could not be read.", EmptyParametersSchema),
  UNREADABLE_PAGE: catalogEntry("The page could not be read clearly. Correct the reading.", EmptyParametersSchema),
  UNREADABLE_PDF: catalogEntry("The PDF could not be read. Choose a valid PDF.", EmptyParametersSchema),
  PROFILE_BROWSER_CLEANUP_UNPROVED: catalogEntry("Browser profile cleanup could not be confirmed.", EmptyParametersSchema),
  PROFILE_BROWSER_MEMBERSHIP_MISMATCH: catalogEntry("Saved browser profiles do not match the browser list.", EmptyParametersSchema),
  PROFILE_BROWSER_LAUNCH_UNCLOSED: catalogEntry("Closing the browser could not be confirmed.", EmptyParametersSchema),
  PROFILE_BROWSER_NATIVE_CUSTODY_RETAINED: catalogEntry("A browser cleanup is still unfinished.", EmptyParametersSchema),
  PROFILE_BROWSER_SESSION_AHEAD: catalogEntry("The browser session is newer than the profile.", EmptyParametersSchema),
  PROFILE_BROWSER_DIRECTORY_UNBOUND: catalogEntry("A saved browser profile has no matching record.", EmptyParametersSchema),
  APPLICATION_DATA_WORKSPACE_REFUSED: catalogEntry("The Windows app data folder could not be verified. Fix it and restart.", EmptyParametersSchema),
  WINDOWS_PRIVATE_PATH_REFUSED: catalogEntry("Windows storage could not be verified. Fix it and restart Relay.", EmptyParametersSchema),
  CRM_DOCUMENT_SOURCE_UNAVAILABLE: catalogEntry("CRM document records could not be verified. Check the requested people.", EmptyParametersSchema),
  CRM_DOCUMENT_REFERENCE_UNAVAILABLE: catalogEntry("CRM people could not be matched to the spreadsheet. Check the rows.", EmptyParametersSchema),
  CRM_DOCUMENT_DOWNLOAD_FAILED: catalogEntry("CRM documents could not be downloaded. Nothing was published.", EmptyParametersSchema),
  CRM_DOCUMENT_PACKAGE_FAILED: catalogEntry("CRM documents could not be packaged. Nothing was published.", EmptyParametersSchema),
  TOO_MANY_PAGES: catalogEntry("This PDF has over 120 pages. Split it into smaller files.", EmptyParametersSchema),
  OCR_SOURCE_REFUSED: catalogEntry("This PDF is a duplicate or unreadable. Choose another under 25 MB.", EmptyParametersSchema),
  OCR_UPLOAD_FAILED: catalogEntry("The PDF did not upload. Check your connection and choose it again.", EmptyParametersSchema),
  OCR_REVIEW_REFUSED: catalogEntry("The saved review changed or could not be checked. Reload it.", EmptyParametersSchema),
  OCR_APPROVAL_UNAVAILABLE: catalogEntry("The approved OCR record is unavailable. Reload the run.", EmptyParametersSchema),
  OCR_NO_REVIEWABLE_RECORDS: catalogEntry("No reviewable records were found in the PDF.", EmptyParametersSchema),
  OCR_PAGE_CANCELLED: catalogEntry("An OCR page was cancelled.", EmptyParametersSchema),
  OCR_PUBLICATION_REFUSED: catalogEntry("The OCR reading could not be tied to its run. Review it.", EmptyParametersSchema),
  ONBOARDING_CRM_READ_FAILED: catalogEntry("CRM hire data could not be verified. Review the record first.", EmptyParametersSchema),
  ONBOARDING_WRITE_REVIEW_REFUSED: catalogEntry("The hire review is missing matching person or transaction details.", EmptyParametersSchema),
  UCPATH_HIRE_REFUSED: catalogEntry("The UCPath hire could not be verified.", EmptyParametersSchema),
  I9_WRITE_REFUSED: catalogEntry("I-9 did not confirm the saved record. Do not resubmit.", EmptyParametersSchema),
  ONBOARDING_DATA_INVALID: catalogEntry("CRM hire data is invalid. Check the source fields and overrides.", EmptyParametersSchema),
  ONBOARDING_NAME_UNRESOLVED: catalogEntry("The name cannot be split into first, middle and last. Write it as Last, First Middle, or add the middle name in CRM.", EmptyParametersSchema),
  ONBOARDING_MATCH_INVALID: catalogEntry("UCPath’s duplicate search returned conflicting people.", EmptyParametersSchema),
  ONBOARDING_EXISTING_PERSON_REQUIRED: catalogEntry("A concurrent hire needs an existing UCPath person. Check the hire mode.", EmptyParametersSchema),
  ONBOARDING_I9_LOOKUP_UNRESOLVED: catalogEntry("The I-9 lookup found nothing for this hire. No profile was created.", EmptyParametersSchema),
  DELEGATION_OUTCOME_POLICY_UNSATISFIED: catalogEntry("A step this run needs did not finish. Open it for why.", EmptyParametersSchema),
  RESUME_VALIDATION_FAILED: catalogEntry("Saved results could not be reused. Start again from the step named.", EmptyParametersSchema),
  RUN_CONTINUATION_REFUSED: catalogEntry("Saved steps could not be verified for recovery, so none were reused.", EmptyParametersSchema),
  APPLICATION_ADMISSION_REFUSED: catalogEntry("Relay could not safely pause for an update or shutdown. Restart Relay.", EmptyParametersSchema),
  UNEXPECTED_CONTACT_PAGE: catalogEntry("UCPath did not show the Emergency Contact page.", EmptyParametersSchema),
  CONTACT_IDENTITY_UNREADABLE: catalogEntry("UCPath did not show a readable employee ID and name.", EmptyParametersSchema),
  CONTACT_SUBJECT_MISMATCH: catalogEntry("UCPath showed another employee ID. No contact was saved.", EmptyParametersSchema),
  CONTACT_NAME_MISMATCH: catalogEntry("UCPath showed another employee name. No contact was saved.", EmptyParametersSchema),
  CONTACT_SET_INCOMPLETE: catalogEntry("UCPath’s contact list could not be verified. Nothing was saved.", EmptyParametersSchema),
  UNREADABLE_CONTACT_ROW: catalogEntry("A UCPath contact row could not be read completely.", EmptyParametersSchema),
  RELATIONSHIP_UNMAPPED: catalogEntry("The contact relationship is not one UCPath offers.", EmptyParametersSchema),
  ADDRESS_CHOICE_UNRESOLVED: catalogEntry("Choose the contact address before preparing this contact.", EmptyParametersSchema),
  CONTACT_SET_CHANGED: catalogEntry("UCPath contacts changed during preparation. Review the contacts again.", EmptyParametersSchema),
  CONTACT_PLAN_REFUSED: catalogEntry("The new contact conflicts with the existing contacts. Nothing was saved.", EmptyParametersSchema),
  BLANK_ROW_UNAVAILABLE: catalogEntry("UCPath did not offer exactly one blank row for this contact.", EmptyParametersSchema),
  CONTACT_NAME_LOST: catalogEntry("UCPath did not keep the contact name. No contact was saved.", EmptyParametersSchema),
  STAGED_EFFECT_MISMATCH: catalogEntry("UCPath did not keep the contact fields. No contact was saved.", EmptyParametersSchema),
  SAVED_EFFECT_MISMATCH: catalogEntry("UCPath Save did not match the approved plan. Resolve it by hand.", EmptyParametersSchema),
  CONTACT_SAVE_UNAVAILABLE: catalogEntry("Emergency Contact Save is unavailable. Use Dry Run to review the plan.", EmptyParametersSchema),
  CONTACT_APPROVED_PLAN_CONFLICT: catalogEntry("One employee has two primary contacts selected. Pick one, then approve again.", EmptyParametersSchema),
  PAYPATH_HR_TASKS_NOT_SHOWN: catalogEntry("UCPath HR Tasks has no PayPath Actions link. Nothing was changed.", EmptyParametersSchema),
  PAYPATH_SEARCH_NOT_SHOWN: catalogEntry("PayPath Actions has no Empl ID search. Nothing was changed.", EmptyParametersSchema),
  PAYPATH_MULTIPLE_RECORDS: catalogEntry("PayPath Actions found several job records. File this person by hand.", EmptyParametersSchema),
  PAYPATH_ALERT_SHOWN: catalogEntry("UCPath showed an alert on PayPath Actions. Nothing was changed.", EmptyParametersSchema),
  STAGED_VALUE_MISMATCH: catalogEntry("PayPath Actions did not keep a work-study value. Nothing was saved.", EmptyParametersSchema),
  PAYPATH_SUBMIT_REFUSED: catalogEntry("UCPath alerted on PayPath Save and Submit. Check this employee’s transactions.", EmptyParametersSchema),
  PAYPATH_IDENTITY_UNREADABLE: catalogEntry("PayPath Actions did not show the employee’s name. Nothing was changed.", EmptyParametersSchema),
  PAYPATH_POSITION_ALREADY_DATED: catalogEntry("Position Data already has a dated change. Nothing was changed.", EmptyParametersSchema),
  PAYPATH_POSITION_MISMATCH: catalogEntry("The PayPath position differs from the reviewed one. Check Position Data.", EmptyParametersSchema),
  CONTACT_APPROVED_FIELDS_INVALID: catalogEntry("The approved contact is incomplete. Correct the OCR record and approve again.", EmptyParametersSchema),
  STORAGE_AUTOMATIC_BACKUP_FAILED: catalogEntry("The shutdown backup could not be verified, so shutdown was not clean.", EmptyParametersSchema),
  STORAGE_AUTOMATIC_REPAIR_REFUSED: catalogEntry("Saved data could not be repaired. It is kept; they stay signed out.", EmptyParametersSchema),
  STORAGE_PROFILE_UPGRADE_UNRESOLVED_WRITES: catalogEntry("Saved data was not updated; an earlier write is unsettled. They stay signed out.", EmptyParametersSchema),
  STORAGE_PROFILE_UPGRADE_REFUSED: catalogEntry("Saved data could not be upgraded. It is kept; they stay out.", EmptyParametersSchema),
  DRY_RUN_SAMPLE_UNDECLARED: catalogEntry("Sample values in a dry run must be marked as a preview.", EmptyParametersSchema),
  DRY_RUN_SAMPLE_REFUSED: catalogEntry("Dry-run sample values cannot approve a real submission.", EmptyParametersSchema),
  WRITE_COMMITTED_EFFECT_ABSENT: catalogEntry("The earlier Save is gone from UCPath. Check it, then rerun.", EmptyParametersSchema),
  WRITE_BUILD_CHANGED: catalogEntry("Relay was updated after approval. Retry the run to approve it again.", EmptyParametersSchema),
  RUNTIME_LIFETIME_LOCK_RELEASED: catalogEntry("Relay has closed. Restart it to continue.", EmptyParametersSchema),
  RUNTIME_ALREADY_RUNNING: catalogEntry("Relay is already running. Close it before starting another.", EmptyParametersSchema),
  PRIVATE_FILE_LOCK_UNAVAILABLE: catalogEntry("Local storage is busy. Wait for the other operation, then try again.", EmptyParametersSchema),
  DATABASE_WRITER_UNAVAILABLE: catalogEntry("Saved data was busy too long. Nothing was written. Try again.", EmptyParametersSchema),
  STORAGE_SNAPSHOT_CHANGED: catalogEntry("Saved data changed while loading. Loading again.", EmptyParametersSchema),
  RUN_CRASH_RESOURCES_RELEASED: catalogEntry("Resources held by an interrupted worker were released.", EmptyParametersSchema),
  BROWSER_CLOSURE_UNPROVED: catalogEntry("The browser may not have closed. No file or credential was changed.", EmptyParametersSchema),
  DUO_SETUP_OPEN_FAILED: catalogEntry("The setup browser did not start. Select Reopen to try again.", EmptyParametersSchema),
  DUO_SETUP_STOP_FAILED: catalogEntry("The previous setup browser did not stop. Select Reopen to try again.", EmptyParametersSchema),
  DUO_SETUP_FILES_BUSY: catalogEntry("The setup browser’s files are in use. Select Reopen to check again.", EmptyParametersSchema),
  BROWSER_ROOT_UNAVAILABLE: catalogEntry("The browser could not be verified and stays unavailable until recovery succeeds.", EmptyParametersSchema),
  BROWSER_PROFILE_STILL_CLOSING: catalogEntry("The browser profile is still closing. Wait for it to close.", EmptyParametersSchema),
  STARTUP_CRASH_RECOVERY_REFUSED: catalogEntry("Saved runs and writes could not be reconciled after a crash.", EmptyParametersSchema),
  RUN_INTERRUPTED_BY_CRASH: catalogEntry("A crash ended this run as failed. Review it before starting another.", EmptyParametersSchema),
  RUN_CRASH_WRITE_UNRESOLVED: catalogEntry("A crash interrupted this run mid-write. The write stays held.", EmptyParametersSchema),
  RUN_STALE_QUEUE_CANCELLED: catalogEntry("This run was queued on an earlier day and never started.", EmptyParametersSchema),
  RUN_LOGOUT_CANCELLED: catalogEntry("This run was cancelled when the profile logged out.", EmptyParametersSchema),
  STARTUP_PROCESS_CLOSED: catalogEntry("A process left by a crash is gone. Unresolved writes stay held.", EmptyParametersSchema),
  PARKED_CHECK_ABSENT: catalogEntry("The target state was not found. The write stays held.", EmptyParametersSchema),
  PARKED_CHECK_AMBIGUOUS: catalogEntry("The target state is unclear. The write stays held.", EmptyParametersSchema),
  PARKED_CHECK_UNKNOWN: catalogEntry("The target state could not be determined. The write stays held.", EmptyParametersSchema),
  PARKED_CHECK_UNAVAILABLE: catalogEntry("This held write cannot be checked right now. It stays held.", EmptyParametersSchema),
  WRITE_RECOVERY_ACTIVITY_UNAVAILABLE: catalogEntry("The recovery check could not be recorded. The write stays held.", EmptyParametersSchema),
  PARKED_CHECK_OCCURRENCE_UNPROVED: catalogEntry("A matching state was found, but not tied to the original attempt. Write stays held.", EmptyParametersSchema),
  DOCUMENT_UNAVAILABLE: catalogEntry("The Kuali separation document could not be opened. Check the document number.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_UNAVAILABLE: catalogEntry("The system keychain is unavailable. Unlock it before opening Relay.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_MISSING: catalogEntry("This profile’s encryption key is missing from the keychain.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_MISMATCH: catalogEntry("The keychain key does not match this profile. Keep this installation.", EmptyParametersSchema),
  CREDENTIAL_KEYCHAIN_UNCERTAIN: catalogEntry("The encryption key could not be confirmed. Keep this installation.", EmptyParametersSchema),
  CREDENTIAL_BUSY: catalogEntry("Credentials are in use by another operation.", EmptyParametersSchema),
  CREDENTIAL_CONFLICT: catalogEntry("Credentials changed. Reload their current state and try again.", EmptyParametersSchema),
  CREDENTIAL_UNCERTAIN: catalogEntry("The credential change could not be confirmed. Leave this profile as is.", EmptyParametersSchema),
  CREDENTIAL_UNAVAILABLE: catalogEntry("Credentials could not be read or saved safely.", EmptyParametersSchema),
  DUO_CREDENTIAL_BUSY: catalogEntry("Duo credentials are in use by another operation.", EmptyParametersSchema),
  DUO_CREDENTIAL_CONFLICT: catalogEntry("The Duo credential changed. Reload its current state and try again.", EmptyParametersSchema),
  DUO_CREDENTIAL_UNCERTAIN: catalogEntry("The Duo change could not be confirmed. Leave this profile as is.", EmptyParametersSchema),
  DUO_CREDENTIAL_UNAVAILABLE: catalogEntry("Duo credentials could not be read or saved safely.", EmptyParametersSchema),
  DUO_READY_CREDENTIAL_REQUIRED: catalogEntry("Duo isn't set up. Set it up in Settings.", EmptyParametersSchema),
  DUO_SIGNING_SOURCE_REQUIRED: catalogEntry("Relay couldn't access Duo setup. Check Settings.", EmptyParametersSchema),
  CREDENTIAL_CONVERSION_COUNTER_UNPROVED: catalogEntry("The saved Duo credential has no safe counter. Keep this profile stopped.", EmptyParametersSchema),
  CREDENTIAL_CONVERSION_REQUIRED: catalogEntry("Restart Relay to finish converting this profile’s credentials, then log in.", EmptyParametersSchema),
  CREDENTIAL_CONVERSION_UNSUPPORTED: catalogEntry("Relay cannot convert these credentials. Keep the original installation.", EmptyParametersSchema),
  CREDENTIAL_OPERATION_PENDING: catalogEntry("A credential operation is unfinished. Keep this profile stopped until it finishes.", EmptyParametersSchema),
  CREDENTIAL_ABANDONED_SIGNUP_HELD: catalogEntry("An unfinished sign-up may have left a used sign-in. Quit Relay, leave its data folder alone, and ask your Relay maintainer.", EmptyParametersSchema),
  CREDENTIAL_CREATE_KEY_MISSING: catalogEntry("A new credential has no keychain key. Keep this installation.", EmptyParametersSchema),
  CREDENTIAL_CONTEXT_REQUIRED: catalogEntry("This profile’s credentials are unavailable. Restart Relay to continue.", EmptyParametersSchema),
  CREDENTIAL_INITIALIZATION_RETAINED_DUO_KEY_MISMATCH: catalogEntry("A saved Duo copy uses another key. Keep the profile and key.", EmptyParametersSchema),
  RUNTIME_CUSTODY_UNCERTAIN: catalogEntry("Relay could not confirm everything closed. Keep this installation before restarting.", EmptyParametersSchema),
  STORAGE_PROFILE_NEWER_VERSION: catalogEntry("A newer Relay saved this profile. Open it with that version.", EmptyParametersSchema),
  STORAGE_PROFILE_PROJECTION_REPAIR_FAILED: catalogEntry("This person’s run search could not be rebuilt. Restart Relay first.", EmptyParametersSchema),
  STORAGE_PROFILE_FORMAT_UNSUPPORTED: catalogEntry("This profile’s format cannot be read. Use a matching or newer Relay.", EmptyParametersSchema),
  STORAGE_DOCTOR_OBSERVATION_CHANGED: catalogEntry("Storage changed during the check, so it could not be verified.", EmptyParametersSchema),
  PROFILE_BROWSER_ROOT_REFUSED: catalogEntry("Browser storage must sit inside the profile folder, with no links.", EmptyParametersSchema),
  STORAGE_FIXED_LAYOUT_REFUSED: catalogEntry("The app data location could not be verified. Startup stopped; data is kept.", EmptyParametersSchema),
  ASSISTANT_INVALID: catalogEntry("The assistant could not use that reply. Send your message again.", EmptyParametersSchema),
  ASSISTANT_CONTEXT_UNAVAILABLE: catalogEntry("Workflow details did not load, so there was no reply. Send again.", EmptyParametersSchema),
  ASSISTANT_CONTEXT_STALE: catalogEntry("The assistant is out of date. Reload the page, then ask again.", EmptyParametersSchema),
  CHATGPT_ASSISTANT_REFUSED: catalogEntry("The assistant declined that request.", EmptyParametersSchema),
  ASSISTANT_MODEL_UNAVAILABLE: catalogEntry("That model is not available on your ChatGPT account. Pick another model.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_REFUSED: catalogEntry("The assistant declined that request.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_INCOMPLETE: catalogEntry("The reply stopped partway. Send your message again.", EmptyParametersSchema),
  ASSISTANT_RESPONSE_FAILED: catalogEntry("The assistant could not reply. Send your message again.", EmptyParametersSchema),
  ASSISTANT_MODEL_CHANGED: catalogEntry("The model or ChatGPT account changed mid-reply. Send it again.", EmptyParametersSchema),
  ASSISTANT_USAGE_LIMIT: catalogEntry("Your ChatGPT messages are used up for now. Try again later.", EmptyParametersSchema),
  ASSISTANT_PLAN_DISABLED: catalogEntry("Your ChatGPT plan can’t be used here.", EmptyParametersSchema),
  ASSISTANT_ACCOUNT_EXPIRED: catalogEntry("Reconnect ChatGPT to use the assistant.", EmptyParametersSchema),
  ASSISTANT_UNAVAILABLE: catalogEntry("The assistant is not available right now. Try again later.", EmptyParametersSchema),
  ASSISTANT_READ_UNAVAILABLE: catalogEntry("Run details are unavailable. Check the run in Logs.", EmptyParametersSchema),
  ASSISTANT_READ_STALE: catalogEntry("The run changed. Ask again.", EmptyParametersSchema),
  ASSISTANT_USAGE_LOG_UNAVAILABLE: catalogEntry("Usage could not be logged.", EmptyParametersSchema),
  ASSISTANT_HISTORY_UNAVAILABLE: catalogEntry("Chat history didn’t load. Refresh to try again.", EmptyParametersSchema),
  ASSISTANT_HISTORY_UNSAVED: catalogEntry("Chat not saved. Sending is paused.", EmptyParametersSchema),
  ASSISTANT_CHAT_FULL: catalogEntry("This chat is too long. Start a new chat.", EmptyParametersSchema),
  ASSISTANT_CHAT_LIMIT: catalogEntry("Delete an old chat before starting another.", EmptyParametersSchema),
  ASSISTANT_HISTORY_FULL: catalogEntry("Chat history is full. Delete an old chat.", EmptyParametersSchema),
  ASSISTANT_CONVERSATION_STALE: catalogEntry("This chat changed elsewhere and was reloaded.", EmptyParametersSchema),
  ASSISTANT_OUTCOME_UNKNOWN: catalogEntry("It is unclear whether this finished. Check before asking again.", EmptyParametersSchema),
  ASSISTANT_CONVERSATION_BUSY: catalogEntry("This chat is still waiting for a reply.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_UNSUPPORTED: catalogEntry("This file type can’t be attached. Use an image, PDF, text or spreadsheet.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_INVALID: catalogEntry("This file could not be read. Check it is not damaged.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_TOO_LARGE: catalogEntry("This file is too large to attach.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_BUSY: catalogEntry("Another file is still uploading. Try again when it finishes.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_TIMEOUT: catalogEntry("The file upload took too long. Attach it again.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_UNAVAILABLE: catalogEntry("An attached file is no longer available. Attach it again.", EmptyParametersSchema),
  ASSISTANT_ATTACHMENT_STORAGE_LIMIT: catalogEntry("Chat attachments are full. Delete an old chat first.", EmptyParametersSchema),
  ASSISTANT_CANCELLED: catalogEntry("The assistant request was cancelled.", EmptyParametersSchema),
  ASSISTANT_LIMIT: catalogEntry("That took the assistant too many steps. Ask for something smaller.", EmptyParametersSchema),
  ASSISTANT_SUBJECT_REQUIRED: catalogEntry("Select one person before preparing a proposal.", EmptyParametersSchema),
  ASSISTANT_VALUE_NEEDS_SOURCE: catalogEntry("Provide the exact value or a source for it.", EmptyParametersSchema),
  ASSISTANT_EDIT_STALE: catalogEntry("This changed since I read it. Ask again to use the current value.", EmptyParametersSchema),
  ASSISTANT_UNDO_STALE: catalogEntry("Not undone: changed since.", EmptyParametersSchema),
  ASSISTANT_EDIT_REFUSED: catalogEntry("Relay could not apply this edit.", EmptyParametersSchema),
  ASSISTANT_SPREADSHEET_REFUSED: catalogEntry("Spreadsheets refused this change. Review the workbook there.", EmptyParametersSchema),
  ASSISTANT_PROPOSAL_REFUSED: catalogEntry("The plan refused this proposal. Review it in Run.", EmptyParametersSchema),
  ASSISTANT_PROPOSAL_EXPIRED: catalogEntry("This card expired. Ask again for a new one.", EmptyParametersSchema),
  ASSISTANT_PROPOSAL_CHANGED: catalogEntry("This changed after you reviewed it. Ask for a new proposal.", EmptyParametersSchema),
  ASSISTANT_ROW_INVALID_STATE: catalogEntry("The run can’t do this in its current state. Nothing was changed.", EmptyParametersSchema),
  ASSISTANT_ROW_TARGET_GONE: catalogEntry("The run no longer exists. Nothing was changed.", EmptyParametersSchema),
  ASSISTANT_ROW_POLICY_REFUSED: catalogEntry("Relay’s rules refused this. Nothing was changed.", EmptyParametersSchema),
  ASSISTANT_ROW_STORAGE_UNAVAILABLE: catalogEntry("Storage could not take this right now. Nothing was changed.", EmptyParametersSchema),
  ASSISTANT_ROW_UNAVAILABLE: catalogEntry("This action is not available yet. Nothing was changed.", EmptyParametersSchema),

  RUN_LOG_DISPLAY_VALUE_UNMAPPED: catalogEntry(
    "A saved value has no display text. Update the workflow first.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_CRM_RESULTS_CHANGED: catalogEntry(
    "The CRM search results changed before they were captured.",
    EmptyParametersSchema,
  ),
  BROWSER_SCREENSHOT_CAPTURE_FAILED: catalogEntry(
    "The browser screenshot could not be saved.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_READ_UNAVAILABLE: catalogEntry(
    "Relay could not check this run. Try again.",
    EmptyParametersSchema,
  ),
  PROFILE_FIRST_RUN_CHECK_UNAVAILABLE: catalogEntry(
    "The first startup check did not finish. Resume sign-in to retry.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_RERUN_UNAVAILABLE: catalogEntry(
    "Relay could not finish checking this run. Try again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_SCOPE_UNAVAILABLE: catalogEntry(
    "Workflow scopes could not be read.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_REPORT_INVALID: catalogEntry(
    "The last check of this run is out of date. Check again.",
    EmptyParametersSchema,
  ),
  RUN_START_PLAN_EXPIRED: catalogEntry(
    "This plan expired. Review a fresh plan before starting.",
    EmptyParametersSchema,
  ),
  SAMPLE_RUN_REFUSED: catalogEntry("Sample run: nothing runs.", EmptyParametersSchema),
  RUN_START_RESTART_REQUIRED: catalogEntry("Restart Relay before starting this run.", EmptyParametersSchema),
  RUN_START_READINESS_BLOCKED: catalogEntry(
    "Readiness checks failed. Review Settings before starting.",
    EmptyParametersSchema,
  ),
  RUN_START_READINESS_UNAVAILABLE: catalogEntry(
    "Readiness could not be checked. Try Start again.",
    EmptyParametersSchema,
  ),
  RUN_START_READINESS_CHANGED: catalogEntry(
    "Readiness changed during the check. Review the plan and start again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_EVIDENCE_EXPIRED: catalogEntry(
    "The last check of this run is out of date. Check again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_SETTINGS_RESTART_REQUIRED: catalogEntry(
    "Restart Relay before checking again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_SETTINGS_UNAVAILABLE: catalogEntry(
    "Settings are unavailable. Reload Settings before checking again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_IDENTITY_CHANGED: catalogEntry(
    "The checked run changed. Refresh Settings and check again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_RUNTIME_CHANGED: catalogEntry(
    "Relay’s state changed. Check readiness again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_READ_FAILED: catalogEntry(
    "The readiness check could not be read.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_CREDENTIAL_PRESENCE_UNAVAILABLE: catalogEntry(
    "Saved sign-ins could not be checked in Settings.",
    EmptyParametersSchema,
  ),
  STORAGE_AUTHORITY_UNAVAILABLE: catalogEntry(
    "Nothing can be read or saved right now.",
    EmptyParametersSchema,
  ),
  STORAGE_DATA_UNAVAILABLE: catalogEntry(
    "Saved run data is unavailable. Review the storage checks below.",
    EmptyParametersSchema,
  ),
  STORAGE_DOCTOR_FAILED: catalogEntry(
    "Run the checks again.",
    EmptyParametersSchema,
  ),
  STORAGE_AUTHORITY_READ_FAILED: catalogEntry(
    "Saved data couldn’t be read. Review the details.",
    EmptyParametersSchema,
  ),
  STORAGE_RECOVERY_UNAVAILABLE: catalogEntry(
    "Recovery status couldn’t be checked.",
    EmptyParametersSchema,
  ),
  STORAGE_RECOVERY_INTERRUPTED: catalogEntry(
    "An interrupted operation needs review before work starts.",
    EmptyParametersSchema,
  ),
  STORAGE_RECOVERY_STARTUP_INTERRUPTED: catalogEntry(
    "An interrupted operation needs review before startup.",
    EmptyParametersSchema,
  ),
  STORAGE_UPDATE_HISTORY_UNAVAILABLE: catalogEntry(
    "Storage update history couldn’t be checked.",
    EmptyParametersSchema,
  ),
  STORAGE_CREDENTIAL_CHECK_INCOMPLETE: catalogEntry(
    "This setting wasn't included in the last check.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS: catalogEntry(
    "A date of birth or SSN is needed to match.",
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
    "The UCPath and CRM records are for different people.",
    EmptyParametersSchema,
  ),
  I9_CHECK_DATA_INVALID: catalogEntry(
    "I-9 check details are missing or inconsistent.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_UCPATH_SEARCH_FAILED: catalogEntry(
    "UCPath search failed.",
    EmptyParametersSchema,
  ),
  PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT: catalogEntry(
    "The selected CRM record changed.",
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
    "The CRM dates do not belong to this person.",
    EmptyParametersSchema,
  ),
  SHIBBOLETH_STALE_REQUEST: catalogEntry(
    "Sign-in expired partway. Run it again.",
    EmptyParametersSchema,
  ),
  DUO_PROMPT_STALLED: catalogEntry(
    "The Duo prompt never cleared. Check Fast Duo is loaded and current.",
    EmptyParametersSchema,
  ),
  DUO_REFUSAL_UNPROVEN: catalogEntry(
    "The Duo prompt never cleared, and the reason could not be read.",
    EmptyParametersSchema,
  ),
  SSO_FIRST_FACTOR_REJECTED: catalogEntry(
    "The UCSD sign-in rejected the password.",
    EmptyParametersSchema,
  ),
  LANDING_PROBE_UNAVAILABLE: catalogEntry(
    "Sign-in did not finish, and the stalled page could not be read.",
    EmptyParametersSchema,
  ),
  AUTHENTICATED_LANDING_MISSING: catalogEntry(
    "Sign-in did not finish.",
    EmptyParametersSchema,
  ),
  TRAINING_REMINDER_REPEATED: catalogEntry(
    "The UCSD training reminder came back after Continue Log In.",
    EmptyParametersSchema,
  ),
  DUO_TERMINAL_REFUSAL: catalogEntry(
    "Duo refused the sign-in. Run again; if it repeats, check Fast Duo.",
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
    "Relay could not identify where CRM sign-in stopped.",
    EmptyParametersSchema,
  ),
  ONBASE_SESSION_HELD: catalogEntry("Another session holds OnBase. Its browser must close first.", EmptyParametersSchema),
  ONBASE_IMPORT_UNPROVED: catalogEntry("The OnBase document import could not be verified. Review the saved details.", EmptyParametersSchema),
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
    "The I-9 record could not be read. Review the page before retrying.",
    EmptyParametersSchema,
  ),
  I9_LOOKUP_AMBIGUOUS: catalogEntry(
    "I-9 search did not find exactly one employee with this name.",
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
    "Relay did not recognize this failure. Open the run in Logs.",
    EmptyParametersSchema,
  ),
  INTERNAL_FAILURE: catalogEntry(
    "Relay could not complete this request. Try again.",
    EmptyParametersSchema,
  ),
  BOUNDARY_VALIDATION_FAILED: catalogEntry(
    "The data sent was not in the expected form.",
    z.strictObject({ source: BoundarySourceSchema }),
  ),
  RERUN_SOURCE_INPUT_PROTECTED: catalogEntry(
    "The original input can't be reused; use Start run.",
    EmptyParametersSchema,
  ),
  RERUN_BROWSER_MODE_UNKNOWN: catalogEntry(
    "The original browser mode is unknown; use Start run.",
    EmptyParametersSchema,
  ),
  QUEUE_READ_UNAVAILABLE: catalogEntry(
    "The queue could not load. Reload the page.",
    EmptyParametersSchema,
  ),
  RUN_READ_UNAVAILABLE: catalogEntry(
    "This run could not load. Reload the page.",
    EmptyParametersSchema,
  ),
  TASK_UNHANDLED_FAILURE: catalogEntry(
    "This task stopped for an unknown reason. Open the run in Logs.",
    EmptyParametersSchema,
  ),
  CAPABILITY_UNAVAILABLE: catalogEntry(
    "This step could not start because something it needs is unavailable.",
    EmptyParametersSchema,
  ),
  BROWSER_SESSION_ACQUISITION_TIMEOUT: catalogEntry(
    "Sign-in took too long. Run it again; if it repeats, check Sessions.",
    EmptyParametersSchema,
  ),
  ERROR_CATALOG_FORMAT_FAILED: catalogEntry(
    "The failure could not be shown safely.",
    EmptyParametersSchema,
  ),
  SEARCH_UNAVAILABLE: catalogEntry("Search is unavailable. Reopen it and try again.", EmptyParametersSchema),
  SEARCH_LIBRARY_UNAVAILABLE: catalogEntry("Spreadsheets are unavailable. Reopen search and try again.", EmptyParametersSchema),
  SEARCH_SUBJECT_UNAVAILABLE: catalogEntry("Subject unavailable", EmptyParametersSchema),
  NOTIFICATION_SOURCE_UNAVAILABLE: catalogEntry("Notification details are unavailable. Review the inbox before relying on this.", EmptyParametersSchema),
  NOTIFICATION_HISTORY_INCOMPLETE: catalogEntry("Notification history is incomplete. Check the affected work.", EmptyParametersSchema),
  NOTIFICATION_OBSERVATION_FAILED: catalogEntry("Some notifications may be missing.", EmptyParametersSchema),
  NOTIFICATION_RECEIPT_MISSING: catalogEntry("Some notifications may be missing.", EmptyParametersSchema),
  NOTIFICATION_REFRESH_PENDING: catalogEntry("Refreshing notifications…", EmptyParametersSchema),
  NOTIFICATION_COMMAND_PENDING: catalogEntry("Notification change pending.", EmptyParametersSchema),
  NOTIFICATION_TARGET_UNAVAILABLE: catalogEntry(
    "This notification’s target is gone. Refresh the inbox.",
    EmptyParametersSchema,
  ),
  NOTIFICATION_ARCHIVE_RETIRED: catalogEntry(
    "Archived notification targets are no longer available.",
    EmptyParametersSchema,
  ),
  LOGGING_UNAVAILABLE: catalogEntry(
    "Debug logging is unavailable. Check the local fault log.",
    EmptyParametersSchema,
  ),
  DASHBOARD_ERROR_REPORT_UNAVAILABLE: catalogEntry(
    "Dashboard error report was not recorded",
    EmptyParametersSchema,
  ),
  DASHBOARD_PAGE_FAILED: catalogEntry("This page could not be shown. Open the dashboard again.", EmptyParametersSchema),
  COMMAND_ID_REUSED: catalogEntry("This command ID was reused with different content.", EmptyParametersSchema),
  READ_SUPERSEDED: catalogEntry("A newer request from this tab replaced this one.", EmptyParametersSchema),
  READ_LANE_RESTARTED: catalogEntry("The dashboard reader restarted. Try again.", EmptyParametersSchema),
  DASHBOARD_SNAPSHOT_OVERTAKEN: catalogEntry("The dashboard is catching up. Trying again.", EmptyParametersSchema),
  DASHBOARD_READ_FAILED: catalogEntry(
    "This could not load. Try again.",
    EmptyParametersSchema,
  ),
  LOGS_IDENTITY_REFUSED: catalogEntry(
    "Logs could not be ordered because some entries are missing or inconsistent.",
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
    "This workflow is unavailable because one of its tasks is not registered.",
    EmptyParametersSchema,
  ),
  DASHBOARD_DAY_INVALID: catalogEntry(
    "The work date is invalid. Choose a valid date.",
    EmptyParametersSchema,
  ),
  DASHBOARD_DAY_FUTURE: catalogEntry(
    "A future work date cannot be selected.",
    EmptyParametersSchema,
  ),
  DASHBOARD_WORKFLOW_UNAVAILABLE: catalogEntry(
    "This workflow is not available to select.",
    EmptyParametersSchema,
  ),
  SESSIONS_UNAVAILABLE: catalogEntry(
    "Sessions are unavailable.",
    EmptyParametersSchema,
  ),
  WORKER_CRASHED: catalogEntry(
    "crashed",
    EmptyParametersSchema,
  ),
  WORKER_START_FAILED: catalogEntry(
    "The worker could not be started.",
    EmptyParametersSchema,
  ),
  WORKER_START_TIMED_OUT: catalogEntry(
    "The worker was not ready in time and was stopped. Retry it.",
    EmptyParametersSchema,
  ),
  WORKER_REQUEST_TIMED_OUT: catalogEntry(
    "The worker did not answer in time. Nothing was retried.",
    EmptyParametersSchema,
  ),
  WORKER_EXITED: catalogEntry(
    "The worker stopped before it answered. Nothing was retried.",
    EmptyParametersSchema,
  ),
  WORKER_EXIT_SETTLEMENT_FAILED: catalogEntry(
    "A stopped worker’s runs could not be settled, so it cannot start.",
    EmptyParametersSchema,
  ),
  WORKER_EXIT_UNOBSERVED: catalogEntry(
    "A worker did not exit when stopped. Quit Relay and wait.",
    EmptyParametersSchema,
  ),
  WORKER_ALREADY_RUNNING: catalogEntry(
    "This worker is already running.",
    EmptyParametersSchema,
  ),
  WORKER_TARGET_STALE: catalogEntry(
    "The worker changed since this loaded. Refresh and try again.",
    EmptyParametersSchema,
  ),
  WORKER_PAUSE_SETTLING: catalogEntry(
    "This worker is still pausing its run. Check Logs for unknown writes.",
    EmptyParametersSchema,
  ),
  WORKER_BUSY: catalogEntry(
    "The worker is busy. Try again when it is idle.",
    EmptyParametersSchema,
  ),
  WORKER_REMOVAL_CHILD_CLOSE_UNPROVED: catalogEntry(
    "The worker may not have closed, so it and its profiles stay.",
    EmptyParametersSchema,
  ),
  WORKER_REQUEST_EXPIRED: catalogEntry(
    "The worker request expired before it started. Nothing was done.",
    EmptyParametersSchema,
  ),
  WORKER_IPC_PROTOCOL_INVALID: catalogEntry(
    "A worker sent a bad message and was stopped.",
    EmptyParametersSchema,
  ),
  WORKER_IDENTITY_MISMATCH: catalogEntry(
    "A worker reported a different person or sign-in and was stopped.",
    EmptyParametersSchema,
  ),
  COMMAND_OUTCOME_UNCERTAIN: catalogEntry(
    "It is unclear whether this finished. Check before trying again.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_OUTCOME_UNCERTAIN: catalogEntry(
    "The plan may be saved already. Retry the same attempt; your draft is kept.",
    EmptyParametersSchema,
  ),
  SETTINGS_INITIAL_READ_UNAVAILABLE: catalogEntry(
    "Settings could not load. Reload the page.",
    EmptyParametersSchema,
  ),
  SETTINGS_REFRESH_UNAVAILABLE: catalogEntry(
    "Settings could not refresh. Your drafts are kept.",
    EmptyParametersSchema,
  ),
  SETTINGS_DRAFT_INVALID: catalogEntry(
    "Check the draft values. Nothing was sent.",
    EmptyParametersSchema,
  ),
  PROTECTED_SETTINGS_DRAFT_INVALID: catalogEntry(
    "Check the credential draft. Nothing was sent.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_DRAFT_INVALID: catalogEntry(
    "Check the folder paths. Nothing was sent.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_DRAFT_UNCHANGED: catalogEntry(
    "The draft matches the current plan. Undo the edit or pick another folder.",
    EmptyParametersSchema,
  ),
  STORAGE_RELOCATION_CANCEL_REQUIRED: catalogEntry(
    "Cancel the current plan to keep the current folders, or pick another.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_BUSY: catalogEntry(
    "A folder picker is already open.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_TIMEOUT: catalogEntry(
    "The folder picker timed out. Try again.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_UNSUPPORTED: catalogEntry(
    "The folder picker is unavailable on this computer.",
    EmptyParametersSchema,
  ),
  SETTINGS_PATH_PICKER_FAILED: catalogEntry(
    "The folder picker did not open. Try again.",
    EmptyParametersSchema,
  ),
  COMMAND_RESULT_IDENTITY_MISMATCH: catalogEntry(
    "The response did not match the request.",
    EmptyParametersSchema,
  ),
  COMMAND_READBACK_MISMATCH: catalogEntry(
    "The result could not be confirmed. Check the current state.",
    EmptyParametersSchema,
  ),
  DASHBOARD_AUTHORITY_REPLACED: catalogEntry(
    "The dashboard changed before the result could be confirmed.",
    EmptyParametersSchema,
  ),
  COMMAND_REFUSED: catalogEntry(
    "That was refused. Review the current state.",
    EmptyParametersSchema,
  ),
  COMMAND_CONFLICT: catalogEntry(
    "A newer change conflicts with this. Refresh and review.",
    EmptyParametersSchema,
  ),
  COMMAND_CONFIRMATION_REQUIRED: catalogEntry(
    "Confirm to continue.",
    EmptyParametersSchema,
  ),
  COMMAND_DISPATCH_FAILED: catalogEntry(
    "That could not be sent. Try again.",
    EmptyParametersSchema,
  ),
  PROFILE_NAME_REFUSED: catalogEntry(
    "Use a first and last name that each start with a letter.",
    EmptyParametersSchema,
  ),
  PROFILE_DISPLAY_NAME_REFUSED: catalogEntry(
    "Use a first and last name that each start with a letter.",
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
    "This profile’s credentials must be fully replaced before sign-in can continue.",
    EmptyParametersSchema,
  ),
  PROFILE_OTHER_EMAIL: catalogEntry(
    "This email already has a profile here. Log in to continue.",
    EmptyParametersSchema,
  ),
  PROFILE_ACCOUNT_DELETION_REFUSED: catalogEntry("Account deletion did not finish. Restart Relay to settle it.", EmptyParametersSchema),
  PROFILE_LOGOUT_BLOCKED: catalogEntry(
    "Log out waits until this profile’s work can stop.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGOUT_INCOMPLETE: catalogEntry("A log out did not finish. Log in to that profile to finish it.", EmptyParametersSchema),
  PROFILE_STARTUP_CONVERSION_REFUSED: catalogEntry("This profile’s startup conversion did not finish. Restart Relay.", EmptyParametersSchema),
  ONBOARDING_DUO_DIAGNOSTIC_LOG_UNAVAILABLE: catalogEntry("Duo logging is unavailable.", EmptyParametersSchema),
  PROFILE_CONNECTION_FAILED: catalogEntry("Could not connect to Relay. Check that it is running.", EmptyParametersSchema),
  PROFILE_AUTHORITY_UNAVAILABLE: catalogEntry("The profile is unavailable.", EmptyParametersSchema),
  PROFILE_SESSION_LOG_UNAVAILABLE: catalogEntry("The sign-in change could not be recorded, so it did not finish.", EmptyParametersSchema),
  PROFILE_AUTHORITY_CHANGED: catalogEntry("The profile changed. Reload it before continuing.", EmptyParametersSchema),
  DASHBOARD_FRONTEND_NOT_OWNED: catalogEntry(
    "This page was not started by this Relay. Close it and restart.",
    EmptyParametersSchema,
  ),
  PROFILE_RUNTIME_START_FAILED: catalogEntry(
    "You are signed in, but the dashboard did not open. Restart Relay.",
    EmptyParametersSchema,
  ),
  PROFILE_SESSION_STALE: catalogEntry(
    "This sign-in is no longer active. Sign in again.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGOUT_INVENTORY_BLOCKED: catalogEntry(
    "Saved work sign-in was removed, but a backup still has a copy.",
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
    "Enter a different @ucsd.edu email with no spaces. Nothing was changed.",
    EmptyParametersSchema,
  ),
  PROFILE_DETAILS_CHANGE_UNKNOWN: catalogEntry(
    "Your change may not have saved. Check it and retry if wrong.",
    EmptyParametersSchema,
  ),
  CHATGPT_CONNECT_FAILED: catalogEntry(
    "ChatGPT did not connect. Try again.",
    EmptyParametersSchema,
  ),
  CHATGPT_DISCONNECT_FAILED: catalogEntry(
    "ChatGPT did not disconnect. Try again.",
    EmptyParametersSchema,
  ),
  SETTINGS_SAVE_UNCONFIRMED: catalogEntry(
    "This change may not have saved. Check it and retry if wrong.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGIN_CHANGE_UNKNOWN: catalogEntry(
    "Your sign-in change may not have saved. Try the new login, then old.",
    EmptyParametersSchema,
  ),
  PROFILE_LOGIN_CHANGE_BUSY: catalogEntry(
    "Another save was running, so your sign-in was not changed. Try again.",
    EmptyParametersSchema,
  ),
  PROFILE_DUO_REENROL_OPEN: catalogEntry(
    "Duo setup is still open for this profile. Finish or cancel it.",
    EmptyParametersSchema,
  ),
  PROFILE_DUO_REENROL_BUSY: catalogEntry(
    "The new Duo setup can only switch in while idle. Try later.",
    EmptyParametersSchema,
  ),
  PROFILE_DUO_REENROL_REFUSED: catalogEntry(
    "The new Duo setup no longer matches the saved devices. Start again.",
    EmptyParametersSchema,
  ),
  PROFILE_DUO_REENROL_UNCERTAIN: catalogEntry(
    "The Duo switch may not have finished. If the profile stays closed, restart Relay.",
    EmptyParametersSchema,
  ),
  PROFILE_FLAT_STORE_MIGRATION_FAILED: catalogEntry("The old backup could not be verified. Startup stopped; data is kept.", EmptyParametersSchema),
  PROFILE_SIGN_UP_OTHER_SIGNED_IN: catalogEntry(
    "Another profile is signed in. Log it out first.",
    EmptyParametersSchema,
  ),
  PROFILE_TRANSITION_BLOCKED: catalogEntry(
    "Sign in waits until the other profile logs out.",
    EmptyParametersSchema,
  ),
  RUNTIME_OFFLINE_OPERATION_UNAVAILABLE: catalogEntry(
    "This offline operation is busy, expired or used. Your data is kept.",
    EmptyParametersSchema,
  ),
  RUNTIME_OLD_BUILD_ARTIFACTS: catalogEntry(
    "This installation has leftovers from an older build. Use the clean-start steps.",
    EmptyParametersSchema,
  ),
  STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE: catalogEntry(
    "Backups, restore, upgrades and account deletion are unavailable right now.",
    EmptyParametersSchema,
  ),
  STORAGE_BACKUP_SOURCE_CHANGED: catalogEntry(
    "The source no longer matches the saved backup. Keep this installation.",
    EmptyParametersSchema,
  ),
  STORAGE_BACKUP_CLOSURE_UNPROVED: catalogEntry(
    "The browser may not have closed, so the backup was refused. Keep this installation.",
    EmptyParametersSchema,
  ),
  PROFILE_RESTORE_BROWSER_CUSTODY_UNPROVED: catalogEntry(
    "The damaged profile’s browser may not have closed. Restore needs macOS and unchanged browser folders.",
    EmptyParametersSchema,
  ),
  PROFILE_RESTORE_ADMISSION_REQUIRED: catalogEntry(
    "Log out cannot finish until the restore accepts the erasure record.",
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
    "Your ChatGPT plan can't be used here.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_LIMIT: catalogEntry(
    "ChatGPT usage limit reached. Try again later.",
    EmptyParametersSchema,
  ),
  CHATGPT_USAGE_UNAVAILABLE: catalogEntry(
    "ChatGPT usage could not be checked. Keep the connection and try later.",
    EmptyParametersSchema,
  ),
  CHATGPT_MODEL_UNAVAILABLE: catalogEntry(
    "That model is unavailable for this ChatGPT connection. Pick another.",
    EmptyParametersSchema,
  ),
  CHATGPT_MODELS_UNAVAILABLE: catalogEntry(
    "The ChatGPT models could not be read. Try again.",
    EmptyParametersSchema,
  ),
  CHATGPT_CONNECTION_FAILED: catalogEntry(
    "The ChatGPT connection could not be verified. Try again.",
    EmptyParametersSchema,
  ),
  CHATGPT_CONNECTION_CANCELLED: catalogEntry(
    "The ChatGPT connection check was cancelled. Check again later.",
    EmptyParametersSchema,
  ),
  CHATGPT_REQUEST_REJECTED: catalogEntry(
    "ChatGPT rejected Relay’s request. Check the details before retrying.",
    EmptyParametersSchema,
  ),
  CHATGPT_RATE_LIMITED: catalogEntry(
    "ChatGPT is limiting requests. Keep the connection and wait before trying again.",
    EmptyParametersSchema,
  ),
  CHATGPT_DIAGNOSTICS_UNAVAILABLE: catalogEntry(
    "The ChatGPT request failed and its details could not be saved.",
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
    "A file reader may not have closed. Keep this profile stopped.",
    EmptyParametersSchema,
  ),
  CHATGPT_RESOURCE_CLOSURE_UNPROVED: catalogEntry(
    "ChatGPT resources may not have closed. Keep this profile stopped.",
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
    "The ChatGPT account changed. Reload its state and try again.",
    EmptyParametersSchema,
  ),
  CHATGPT_CREDENTIAL_UNCERTAIN: catalogEntry(
    "The ChatGPT credential change could not be confirmed. Reload and try again.",
    EmptyParametersSchema,
  ),
  SPREADSHEET_WORKSHEET_REFERENCE_INVALID: catalogEntry(
    "This workbook has a bad worksheet reference. Export a new XLSX copy.",
    EmptyParametersSchema,
  ),
  SPREADSHEET_WORKBOOK_XML_INVALID: catalogEntry(
    "This workbook could not be read. Export a new XLSX copy.",
    EmptyParametersSchema,
  ),
  SPREADSHEET_DIMENSIONS_INVALID: catalogEntry(
    "This workbook has a bad worksheet range. Export a new XLSX copy.",
    EmptyParametersSchema,
  ),
  WORKBOOK_INTAKE_SOURCE_CONFLICT: catalogEntry(
    "An active intake uses this file from another source. Finish it first.",
    EmptyParametersSchema,
  ),
  WORKBOOK_OPERATION_CONFLICT: catalogEntry("This workbook operation was already used with different input.", EmptyParametersSchema),
  WORKBOOK_NAME_EXISTS: catalogEntry("A spreadsheet with this name already exists. Choose a different name.", EmptyParametersSchema),
  WORKBOOK_VERSION_NAME_EXISTS: catalogEntry("A version with this name exists.", EmptyParametersSchema),
  WORKBOOK_TYPE_IN_USE: catalogEntry("History uses this type. Rename columns, or make a new type.", EmptyParametersSchema),
  WORKBOOK_VERSION_IN_USE: catalogEntry("This version is in use and cannot be deleted.", EmptyParametersSchema),
  WORKBOOK_LIBRARY_IN_USE: catalogEntry("A run or pending change uses this spreadsheet. Finish that first.", EmptyParametersSchema),
  WORKBOOK_MERGE_INVALID: catalogEntry("These spreadsheets cannot merge that way. Check their types, layouts and keys.", EmptyParametersSchema),
  WORKBOOK_ACTION_RETIRED: catalogEntry("This spreadsheet action was retired.", EmptyParametersSchema),
  WORKBOOK_ROW_CHOICE_UNAVAILABLE: catalogEntry("No matching row is in this run’s worksheets. Review the workbook first.", EmptyParametersSchema),
  WORKBOOK_REVISION_UNAVAILABLE: catalogEntry("This saved workbook version cannot be rebuilt.", EmptyParametersSchema),
  WORKBOOK_SYNC_LINK_REQUIRED: catalogEntry("Link a SharePoint workbook before syncing.", EmptyParametersSchema),
  WORKBOOK_SYNC_CONTEXT_CHANGED: catalogEntry("The profile, settings or credentials changed during Sync. Start Sync again.", EmptyParametersSchema),
  WORKBOOK_SYNC_IMPORT_FAILED: catalogEntry("The downloaded file is not a supported workbook.", EmptyParametersSchema),
  WORKBOOK_SYNC_FAILED: catalogEntry("Sync did not finish. Start Sync again.", EmptyParametersSchema),
  WORKBOOK_SYNC_NOT_APPLIED: catalogEntry("Sync downloaded the workbook but could not apply its rows. Sync again.", EmptyParametersSchema),
  WORKBOOK_TYPE_UNAVAILABLE: catalogEntry("This workflow’s spreadsheet type is unavailable. Restore it before importing a file.", EmptyParametersSchema),
  WORKBOOK_LIBRARY_EMPTY: catalogEntry("Import a Library spreadsheet before choosing a source.", EmptyParametersSchema),
  WORKBOOK_FIELDS_MISSING: catalogEntry("A Library worksheet lacks fields this workflow needs. Review its column mappings.", EmptyParametersSchema),
  WORKBOOK_FIELDS_DUPLICATE: catalogEntry("A Library worksheet maps a required field twice. Review its column mappings.", EmptyParametersSchema),
  WORKBOOK_REFERENCE_MISSING: catalogEntry("Add the reference spreadsheet this run looks people up in. One picked only as a check does not count.", EmptyParametersSchema),
  WORKBOOK_BINDING_UNAVAILABLE: catalogEntry("This workflow’s spreadsheet is unavailable or the wrong type. Import a replacement.", EmptyParametersSchema),
  WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE: catalogEntry("The workbook’s source workflow was not kept. Its run cannot be confirmed.", EmptyParametersSchema),
  WORKBOOK_SYNC_LAYOUT_CHANGED: catalogEntry("The SharePoint worksheets or columns no longer match this spreadsheet type.", EmptyParametersSchema),
  SHAREPOINT_LINK_UNSUPPORTED: catalogEntry("Use a direct workbook file link from the SharePoint site.", EmptyParametersSchema),
  SHAREPOINT_DOWNLOAD_FAILED: catalogEntry("The SharePoint workbook download could not be verified.", EmptyParametersSchema),
  SHAREPOINT_DOWNLOAD_TOO_LARGE: catalogEntry("The SharePoint workbook is over the 20 MiB download limit.", EmptyParametersSchema),
  COMMAND_BROWSER_BUSY: catalogEntry("Another browser task is still running or closing.", EmptyParametersSchema),
  COMMAND_BROWSER_CANCELLED: catalogEntry("The browser task was cancelled before it finished.", EmptyParametersSchema),
  COMMAND_BROWSER_UNAVAILABLE: catalogEntry("The browser task could not get its profile and session.", EmptyParametersSchema),
  COMMAND_BROWSER_CLOSURE_UNPROVED: catalogEntry("The browser or sign-in may not have closed. The profile is kept.", EmptyParametersSchema),
  WORKBOOK_METADATA_UNSUPPORTED: catalogEntry("This workbook has formulas, error cells or metadata Relay cannot keep.", EmptyParametersSchema),
  WORKBOOK_CAPTURE_LIMIT_EXCEEDED: catalogEntry("The worksheets exceed 32 sources or 250,000 cells. Select fewer.", EmptyParametersSchema),
  WORKBOOK_INVALID: catalogEntry(
    "The workbook is malformed and cannot be saved.",
    EmptyParametersSchema,
  ),
  WORKBOOK_PROVIDER_UNAVAILABLE: catalogEntry(
    "The workbook result is unconfirmed. Resume the same run to check it.",
    EmptyParametersSchema,
  ),
  WORKBOOK_NOT_FOUND: catalogEntry(
    "The saved workbook was not found.",
    EmptyParametersSchema,
  ),
  WORKBOOK_VERSION_CONFLICT: catalogEntry(
    "The saved workbook changed. Load its current version before saving.",
    EmptyParametersSchema,
  ),
  WORKBOOK_STORAGE_CORRUPT: catalogEntry(
    "The saved workbook or its history is corrupt.",
    EmptyParametersSchema,
  ),
  WORKBOOK_STORAGE_FAILED: catalogEntry(
    "The workbook library could not save.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_RANGE_INVALID: catalogEntry(
    "The Analytics date range is invalid.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_BROWSE_INVALID: catalogEntry(
    "The Analytics selection is invalid.",
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
    "The Analytics results changed. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_POPULATION_SOURCE_MISMATCH: catalogEntry(
    "The Analytics report and its runs disagree.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED: catalogEntry(
    "The Analytics selection expired. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH: catalogEntry(
    "The Analytics selection is out of date. Select the period again.",
    EmptyParametersSchema,
  ),
  ACTIVITY_SNAPSHOT_CONTENT_MISMATCH: catalogEntry(
    "The Analytics report changed. Select the period again.",
    EmptyParametersSchema,
  ),
  ASSISTANT_AUTHORITY_INVALID: catalogEntry(
    "The assistant’s permission could not be read. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_MODEL_PROPOSAL_REFUSED: catalogEntry(
    "The proposal was refused. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_PROPOSAL_MISMATCH: catalogEntry(
    "The proposal does not match this action. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_UNCLASSIFIED: catalogEntry(
    "The assistant cannot do this action. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_OPTIONS_UNBOUND: catalogEntry(
    "This action’s options cannot be matched exactly. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_SUBJECT_MISMATCH: catalogEntry(
    "This action’s person does not match. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_BINDING_STALE: catalogEntry(
    "The approval no longer matches this action. Nothing was done.",
    EmptyParametersSchema,
  ),
  ASSISTANT_UNKNOWN_NOT_REPLAYABLE: catalogEntry(
    "An unclear result cannot be repeated. Check it before doing more.",
    EmptyParametersSchema,
  ),
  ASSISTANT_EFFECT_UNDERSTATED: catalogEntry(
    "This does more than the assistant described. Nothing was done.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_BLOCKED: catalogEntry(
    "Readiness checks blocked this worker. Check Settings; the queued run waits.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_OBSERVATION_CHANGED: catalogEntry(
    "Storage changed before the next run was claimed. Check again.",
    EmptyParametersSchema,
  ),
  PREFLIGHT_TIMEOUT: catalogEntry(
    "A readiness check took too long. Check again.",
    EmptyParametersSchema,
  ),
  BULK_CHILD_ERRORED: catalogEntry(
    "An error stopped the batch at this item. Nothing changed for it.",
    EmptyParametersSchema,
  ),
  RUN_QUEUED_WORKER_UNAVAILABLE: catalogEntry(
    "Your run is queued, but its worker did not start. Don’t start it again.",
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
