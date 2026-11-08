import type { ActionCommandKeySchema } from "../../../models/dashboard/actions.js";
import type { RunDecisionType } from "../../../models/dashboard/run-decision.js";
import type { z } from "zod";

type ActionCommand = z.infer<typeof ActionCommandKeySchema>;

/** How an option is sent, as declared; the projection binds it to the instance's served key. */
export type DeclaredSend =
  | Readonly<{ via: "action" | "row-action"; command: ActionCommand; /** Sent instead when `command` is not served. */ fallback?: ActionCommand }>
  | Readonly<{ via: "verification"; present: ActionCommand; absent: ActionCommand }>
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
const addNote: DeclaredOption = { id: "add-note", label: "Add note", hint: "Record what you found. The run stays failed.", send: { via: "command", family: "failure-resolution", type: "annotate-failure" } };

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
  "write-parked": { choiceLabel: "Answer", title: "Check whether the submit went through", recommended: ["check-result", "check-again"], options: [
    { id: "check-again", label: "Check again", hint: "Read the target system again. Nothing is submitted.", send: { via: "action", command: "check-parked-write", fallback: "recheck-write" } },
    { id: "check-result", label: "Check result", hint: "Tell Relay what you found in the target system.", send: { via: "verification", present: "recheck-write", absent: "resolve-write-absent" } },
    { id: "didnt-land", label: "It didn't land", hint: "You checked and nothing was sent. Relay may submit again.", send: { via: "action", command: "resolve-write-absent" } },
  ] },
  "write-unknown": { choiceLabel: "Answer", title: "Check whether the submit went through", recommended: ["check-result", "check-again"], options: [
    { id: "check-again", label: "Check again", hint: "Read the target system again. Nothing is submitted.", send: { via: "action", command: "check-parked-write", fallback: "recheck-write" } },
    { id: "check-result", label: "Check result", hint: "Tell Relay what you found in the target system.", send: { via: "verification", present: "recheck-write", absent: "resolve-write-absent" } },
    { id: "didnt-land", label: "It didn't land", hint: "You checked and nothing was sent. Relay may submit again.", send: { via: "action", command: "resolve-write-absent" } },
  ] },
  "failed-retryable": { choiceLabel: "Next step", title: "A step failed", recommended: ["retry", "add-note"], options: [
    { id: "retry", label: "Retry step", hint: "Nothing was written, so the step can run again.", send: { via: "action", command: "retry" } },
    addNote,
  ] },
  "failed-after-write": { title: "A step failed after a write", recommended: ["add-note"], options: [addNote] },
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
