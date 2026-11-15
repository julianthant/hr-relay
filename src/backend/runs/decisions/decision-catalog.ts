import type { ActionCommandKeySchema } from "../../../models/dashboard/actions.js";
import type { RunDecisionType } from "../../../models/dashboard/run-decision.js";
import type { z } from "zod";

type ActionCommand = z.infer<typeof ActionCommandKeySchema>;

/** How an option is sent, as declared; the projection binds it to the instance's served key. */
export type DeclaredSend =
  | Readonly<{ via: "action" | "row-action"; command: ActionCommand }>
  | Readonly<{ via: "gate-arm" }>
  | Readonly<{ via: "start-plan" }>
  | Readonly<{ via: "command"; family: string; type: string }>;

export type DeclaredOption = Readonly<{ id: string; label: string; hint: string; send: DeclaredSend }>;

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

const cancelRun: DeclaredOption = { id: "cancel-run", label: "Cancel run", hint: "Stop this run. Nothing more is written.", send: { via: "row-action", command: "cancel" } };
const annotate = { via: "command", family: "failure-resolution", type: "annotate-failure" } as const;
const addNote: DeclaredOption = { id: "add-note", label: "Add note", hint: "Record what you found. The run stays failed.", send: annotate };
/** A parked write is answered by Relay re-reading it or by the operator confirming it is absent; no answer settles it on its own. */
const parkedWrite: readonly DeclaredOption[] = [
  { id: "check-again", label: "Check again", hint: "Reads the target system again; files nothing.", send: { via: "action", command: "check-parked-write" } },
  { id: "saved", label: "Saved", hint: "Relay checks it, then the run continues.", send: { via: "action", command: "recheck-write" } },
  { id: "not-saved", label: "Not saved, write it again", hint: "Relay writes it once more.", send: { via: "action", command: "resolve-write-absent" } },
];

/** How a parked write of each registered write task is asked about: the record, its system, what Relay clicked, where to check and what Not saved does next. */
export type ParkedWriteRecord = Readonly<{ record: string; system: string; act: "Submit" | "Save" | "Import"; check: string; again: string; againHint: string;
  /** The display-safe identifier in the write's natural key (an EID or document number, never a date) and where the operator checks it. */
  id?: Readonly<{ segment: number; prefix?: string; where: (id: string) => string }> }>;
export const PARKED_WRITE_RECORDS: Readonly<Record<string, ParkedWriteRecord>> = Object.freeze({
  "ucpath/create-termination": { record: "termination", system: "UCPath", act: "Submit", check: "Smart HR Transactions", again: "file it again", againHint: "Relay files the termination once more.",
    id: { segment: 1, where: id => `Smart HR Transactions for ${id}` } },
  "ucpath/delete-pending-terminations": { record: "pending termination removal", system: "UCPath", act: "Save", check: "Smart HR Transactions", again: "remove them again", againHint: "Relay removes the pending terminations once more.",
    id: { segment: 1, where: id => `Smart HR Transactions for ${id}` } },
  "ucpath/submit-paypath-work-study": { record: "work-study transaction", system: "UCPath", act: "Submit", check: "Smart HR Transactions", again: "file it again", againHint: "Relay files the work-study transaction once more.",
    id: { segment: 1, where: id => `Smart HR Transactions for ${id}` } },
  "ucpath/create-hire": { record: "hire", system: "UCPath", act: "Submit", check: "Smart HR Transactions", again: "file it again", againHint: "Relay files the hire once more." },
  "ucpath/save-emergency-contact": { record: "emergency contact", system: "UCPath", act: "Save", check: "the employee's emergency contacts", again: "save it again", againHint: "Relay saves the emergency contact once more." },
  "kuali/save-separation-finalization": { record: "separation document", system: "Kuali", act: "Save", check: "the separation document", again: "save it again", againHint: "Relay saves the document once more.",
    id: { segment: 0, prefix: "kuali:", where: id => `document ${id} in Kuali` } },
  "i9/create-profile": { record: "I-9 profile", system: "I-9", act: "Save", check: "the employee's I-9 profile", again: "save it again", againHint: "Relay saves the profile once more." },
  "i9/create-remote-record": { record: "remote I-9 record", system: "I-9", act: "Submit", check: "the employee's I-9 records", again: "submit it again", againHint: "Relay submits the record once more." },
  "onbase/upload-import": { record: "document", system: "OnBase", act: "Import", check: "the employee's documents", again: "import it again", againHint: "Relay imports the document once more." },
});

export const DECISION_CATALOG: Readonly<Record<RunDecisionType, DecisionDeclaration>> = Object.freeze({
  "identity-mismatch": { choiceLabel: "Next step", title: "Is this the right person?", recommended: ["approve"], options: [
    { id: "approve", label: "Approve match", hint: "The person found is the one the request means.", send: { via: "action", command: "resolve-gate" } },
    { id: "reject", label: "Reject match", hint: "This is not the right person. The run stops.", send: { via: "action", command: "resolve-gate" } },
  ] },
  "pick-person": { title: "Pick the person this run is about", recommended: ["confirm"], options: [
    { id: "confirm", label: "Confirm", hint: "Continue with the picked person.", send: { via: "action", command: "resolve-gate" } },
    cancelRun,
  ] },
  "pick-row": { title: "Pick the row to use", recommended: ["confirm"], options: [
    { id: "confirm", label: "Confirm row", hint: "Use the picked row.", send: { via: "action", command: "resolve-workbook-reference-row" } },
  ] },
  "review-before-write": { choiceLabel: "Next step", title: "Review before Relay writes", recommended: [], gateArms: true, options: [] },
  "write-parked": { choiceLabel: "Answer", title: "Did the write save?", recommended: ["saved", "check-again"], options: parkedWrite },
  "write-unknown": { choiceLabel: "Answer", title: "Did the write save?", recommended: ["saved", "check-again"], options: parkedWrite },
  "failed-retryable": { choiceLabel: "Next step", title: "A step failed", recommended: ["retry", "add-note"], options: [
    { id: "retry", label: "Retry step", hint: "Nothing was written, so the step can run again.", send: { via: "action", command: "retry" } },
    addNote,
  ] },
  "failed-after-write": { choiceLabel: "Next step", title: "A step failed after a write", recommended: ["mark-as-failed"], options: [
    { id: "mark-as-failed", label: "Mark as failed", hint: "Ends this person's run as failed; files nothing.", send: annotate },
    addNote,
  ] },
  "member-failed": { title: "This member failed", recommended: ["retry"], options: [
    { id: "retry", label: "Retry member", hint: "Run this member again. The rest of the batch is unchanged.", send: { via: "action", command: "retry" } },
  ] },
  "correct-value": { choiceLabel: "Next step", title: "Correct the value and retry", recommended: ["retry-with-value"], options: [
    { id: "retry-with-value", label: "Retry with this value", hint: "Start again with the corrected value.", send: { via: "start-plan" } },
    { id: "check-again", label: "Check again", hint: "Run the step again with the same value.", send: { via: "action", command: "retry" } },
  ] },
  "workbook-row": { title: "Pick the workbook row to write", recommended: ["confirm"], options: [
    { id: "confirm", label: "Confirm row", hint: "Write to the picked row.", send: { via: "action", command: "resolve-workbook-row" } },
  ] },
  "sign-in": { choiceLabel: "Next step", title: "Sign in to continue", recommended: [], projected: false, options: [
    { id: "sign-in-again", label: "Sign in again", hint: "Refresh the browser session and approve Duo.", send: { via: "command", family: "worker-browser", type: "refresh-browser" } },
    { id: "reopen-browser", label: "Reopen browser", hint: "Open a new browser session.", send: { via: "command", family: "worker-browser", type: "reopen-browser" } },
  ] },
  paused: { title: "This run is paused", recommended: ["resume"], options: [
    { id: "resume", label: "Resume", hint: "Continue from the next step.", send: { via: "row-action", command: "resume" } },
    cancelRun,
  ] },
  stalled: { title: "This run stopped answering", recommended: ["recover"], options: [
    { id: "recover", label: "Recover", hint: "Restart from the last completed step.", send: { via: "row-action", command: "recover-run" } },
    cancelRun,
  ] },
  refused: { title: "Command refused", recommended: [], projected: false, options: [] },
  cancelling: { title: "Cancelling this run", recommended: [], options: [] },
});

/** The identity review's served text: why Relay asks, each comparison's label, and how each candidate was found. */
export const IDENTITY_REVIEW_TEXT = Object.freeze({
  reason: {
    "several-people": "More than one person in UCPath matches the name on the form.",
    name: "The name on the form differs from the name in UCPath.",
    eid: "The form has no matching Employee ID, so Relay found this person by name.",
    "eid-entered": "Relay is using the Employee ID you entered.",
    employment: "UCPath does not show exactly one active job for this person.",
    "name-search": "A UCPath search on the name on the form finds someone else.",
    agreed: "Confirm this is the person the form means.",
  },
  label: { name: "Name", eid: "Employee ID", employment: "Active jobs", "name-search": "Name search" },
  origin: {
    "name-resolved": "Found by name in UCPath",
    "operator-entered": "Employee ID you entered",
    "name-search": "UCPath search on the name on the form",
    manual: "Also listed by the name search",
  },
  value: {
    noFormEid: "Not on the form",
    oneActiveJob: "1 active job",
    noActiveJob: "No active job",
    unknownJob: "A job status Relay does not recognize",
    noMatch: "No match",
    unnamed: "Name not shown in UCPath",
  },
  confirm: {
    agreed: "Every check agreed. Approving files the rest of this separation for this person.",
    disagreed: "Approving files the rest of this separation for this person anyway.",
  },
  unavailable: "Relay cannot show this identity review. Reload, or cancel the run.",
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
