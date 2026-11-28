import type { ActionCommandKeySchema } from "../../../models/dashboard/actions.js";
import type { RunDecisionType } from "../../../models/dashboard/run-decision.js";
import type { z } from "zod";

type ActionCommand = z.infer<typeof ActionCommandKeySchema>;

/** How an option is sent, as declared; the projection binds it to the instance's served key. */
export type DeclaredSend =
  | Readonly<{ via: "action" | "row-action"; command: ActionCommand }>
  | Readonly<{ via: "row-action"; navigation: "rerun" }>
  | Readonly<{ via: "gate-arm" }>
  | Readonly<{ via: "start-plan" }>
  | Readonly<{ via: "command"; family: string; type: string }>;

export type DeclaredOption = Readonly<{ id: string; label: string; hint?: string; send: DeclaredSend }>;

export type DecisionDeclaration = Readonly<{
  title: string;
  options: readonly DeclaredOption[];
  /** The dropdown's label when the decision offers more than one choice. */
  choiceLabel?: string;
  /** The first of these the instance serves is preselected. */
  recommended: readonly string[];
  /** Options come from the gate's declared arms, not this catalog. */
  gateArms?: true;
  /** Declared for the vocabulary; no run surface projects it. */
  projected?: false;
}>;

const cancelRun: DeclaredOption = { id: "cancel-run", label: "Cancel run", send: { via: "row-action", command: "cancel" } };
const annotate = { via: "command", family: "failure-resolution", type: "annotate-failure" } as const;
/** A parked write is answered by Relay re-reading it or by the operator confirming it is absent; no answer settles it on its own. */
const parkedWrite: readonly DeclaredOption[] = [
  { id: "check-again", label: "Check again", hint: "Files nothing.", send: { via: "action", command: "check-parked-write" } },
  { id: "saved", label: "Saved", hint: "Relay verifies first.", send: { via: "action", command: "recheck-write" } },
  { id: "not-saved", label: "Not saved, write it again", send: { via: "action", command: "resolve-write-absent" } },
];
export const READ_BACK_SAVED_LABEL = "Checked by hand, continue";

/** How a parked write of each registered write task is asked about: the record, its system, what Relay clicked, where to check and what Not saved does next. */
export type ParkedWriteRecord = Readonly<{ record: string; system: string; act: "Submit" | "Save" | "Import"; check: string; again: string;
  /** The display-safe identifier in the write's natural key (an EID or document number, never a date) and where the operator checks it. */
  id?: Readonly<{ segment: number; prefix?: string; where: (id: string) => string }> }>;
export const PARKED_WRITE_RECORDS: Readonly<Record<string, ParkedWriteRecord>> = Object.freeze({
  "ucpath/create-termination": { record: "termination", system: "UCPath", act: "Submit", check: "Smart HR Transactions", again: "file it again",
    id: { segment: 1, where: id => `Smart HR Transactions for ${id}` } },
  "ucpath/delete-pending-terminations": { record: "pending termination removal", system: "UCPath", act: "Save", check: "Smart HR Transactions", again: "remove them again",
    id: { segment: 1, where: id => `Smart HR Transactions for ${id}` } },
  "ucpath/submit-paypath-work-study": { record: "work-study transaction", system: "UCPath", act: "Submit", check: "Smart HR Transactions", again: "file it again",
    id: { segment: 1, where: id => `Smart HR Transactions for ${id}` } },
  "ucpath/create-hire": { record: "hire", system: "UCPath", act: "Submit", check: "Smart HR Transactions", again: "file it again" },
  "ucpath/save-emergency-contact": { record: "emergency contact", system: "UCPath", act: "Save", check: "the employee's emergency contacts", again: "save it again" },
  "kuali/save-separation-finalization": { record: "separation document", system: "Kuali", act: "Save", check: "the separation document", again: "save it again",
    id: { segment: 0, prefix: "kuali:", where: id => `document ${id} in Kuali` } },
  "i9/create-profile": { record: "I-9 profile", system: "I-9", act: "Save", check: "the employee's I-9 profile", again: "save it again" },
  "i9/create-remote-record": { record: "remote I-9 record", system: "I-9", act: "Submit", check: "the employee's I-9 records", again: "submit it again" },
  "onbase/upload-import": { record: "document", system: "OnBase", act: "Import", check: "the employee's documents", again: "import it again" },
});

export const DECISION_CATALOG: Readonly<Record<RunDecisionType, DecisionDeclaration>> = Object.freeze({
  "identity-mismatch": { choiceLabel: "Next step", title: "Is this the right person?", recommended: ["approve"], options: [
    { id: "approve", label: "Approve match", send: { via: "action", command: "resolve-gate" } },
    { id: "reject", label: "Reject match", hint: "Stops the run.", send: { via: "action", command: "resolve-gate" } },
  ] },
  "pick-person": { title: "Pick the person", recommended: ["confirm"], options: [
    { id: "confirm", label: "Confirm", send: { via: "action", command: "resolve-gate" } },
    cancelRun,
  ] },
  "pick-row": { title: "Pick a row", recommended: ["confirm"], options: [
    { id: "confirm", label: "Confirm row", send: { via: "action", command: "resolve-workbook-reference-row" } },
  ] },
  "review-before-write": { choiceLabel: "Next step", title: "Review before writing", recommended: [], gateArms: true, options: [] },
  "write-parked": { choiceLabel: "Answer", title: "Did the write save?", recommended: ["saved", "check-again"], options: parkedWrite },
  "write-unknown": { choiceLabel: "Answer", title: "Did the write save?", recommended: ["saved", "check-again"], options: parkedWrite },
  "failed-retryable": { choiceLabel: "Next step", title: "A step failed", recommended: ["retry"], options: [
    { id: "retry", label: "Retry step", hint: "Nothing was written.", send: { via: "action", command: "retry" } },
  ] },
  "failed-after-write": { choiceLabel: "Next step", title: "A step failed after a write", recommended: ["mark-as-failed"], options: [
    { id: "mark-as-failed", label: "Mark as failed", hint: "Files nothing.", send: annotate },
  ] },
  "member-failed": { title: "Member failed", recommended: ["retry"], options: [
    { id: "retry", label: "Retry member", hint: "Other members unchanged.", send: { via: "action", command: "retry" } },
  ] },
  "correct-value": { choiceLabel: "Next step", title: "Correct the value and retry", recommended: ["retry-with-value"], options: [
    { id: "retry-with-value", label: "Retry with this value", send: { via: "start-plan" } },
    { id: "check-again", label: "Check again", hint: "Same value.", send: { via: "action", command: "retry" } },
  ] },
  "workbook-row": { title: "Pick the row to write", recommended: ["confirm"], options: [
    { id: "confirm", label: "Confirm row", send: { via: "action", command: "resolve-workbook-row" } },
  ] },
  "sign-in": { choiceLabel: "Next step", title: "Sign in to continue", recommended: [], projected: false, options: [
    { id: "sign-in-again", label: "Sign in again", hint: "Needs Duo.", send: { via: "command", family: "worker-browser", type: "refresh-browser" } },
    { id: "reopen-browser", label: "Reopen browser", send: { via: "command", family: "worker-browser", type: "reopen-browser" } },
  ] },
  paused: { title: "Run paused", recommended: ["resume"], options: [
    { id: "resume", label: "Resume", send: { via: "row-action", command: "resume" } },
    cancelRun,
  ] },
  stalled: { title: "Run not responding", recommended: ["rerun"], options: [
    { id: "rerun", label: "Rerun", send: { via: "row-action", navigation: "rerun" } },
    cancelRun,
  ] },
  refused: { title: "Request refused", recommended: [], projected: false, options: [] },
  cancelling: { title: "Cancelling", recommended: [], options: [] },
});

/** The identity review's served text: why Relay asks, each comparison's label, and how each candidate was found. */
export const IDENTITY_REVIEW_TEXT = Object.freeze({
  reason: {
    "several-people": "Several UCPath people match this name.",
    name: "Form name differs from UCPath.",
    eid: "No matching Employee ID on the form; found by name.",
    "eid-entered": "Using the Employee ID you entered.",
    employment: "Not exactly one active job in UCPath.",
    "name-search": "Name search finds someone else.",
    agreed: "All checks agree.",
  },
  label: { name: "Name", eid: "Employee ID", employment: "Active jobs", "name-search": "Name search" },
  employeeIdLookup: {
    label: "Employee ID lookup",
    reason: "The Employee ID lookup did not confirm this person.",
  },
  origin: {
    "name-resolved": "Name",
    "operator-entered": "Entered ID",
    "name-search": "Name search",
    manual: "Also in name search",
  },
  value: {
    noFormEid: "Not on the form",
    oneActiveJob: "1 active job",
    soleRecord: "1 job, status not shown",
    noActiveJob: "No active job",
    unknownJob: "Unknown job status",
    noMatch: "No match",
    unnamed: "No name in UCPath",
  },
  /** A typed Employee ID: confirming starts the lookup that replaces this run; it approves nobody. */
  lookup: {
    title: "Look up this Employee ID",
    body: "You confirm the person before anything is filed.",
    confirmLabel: "Look up",
  },
  confirm: {
    agreed: "Files the rest of this separation.",
    disagreed: "Files the rest of this separation anyway.",
  },
  unavailable: "Relay cannot show this identity review. Reload, or cancel the run.",
});

/** The reference review's served text: a picked spreadsheet did not hold the person, or names them differently. */
export const REFERENCE_CHECK_REVIEW_TEXT = Object.freeze({
  title: "Review reference spreadsheet differences",
  stale: "This review changed. Reload it before answering.",
});

/** The declared identifier of a parked write, read from its natural key; a declared key that lacks it is corrupt. */
export function parkedWriteRecordId(taskId: string, idempotencyKey: string): string | undefined {
  const declared = PARKED_WRITE_RECORDS[taskId]?.id;
  if (declared === undefined) return undefined;
  const segment = idempotencyKey.split("|")[declared.segment];
  const id = declared.prefix === undefined ? segment : segment?.startsWith(declared.prefix) === true ? segment.slice(declared.prefix.length) : undefined;
  if (id === undefined || id === "") throw new Error(`PARKED_WRITE_KEY_IDENTIFIER_MISSING: ${taskId}`);
  return id;
}
