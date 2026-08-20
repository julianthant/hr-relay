/**
 * The Run Modal's pure half — its vocabularies and its one fold (doc 13 §8.14).
 *
 * It lives beside `run-start.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 *
 * Everything here is D251: three facts the modal already held and did not draw.
 */
import type { EnqueuePolicy } from "../../domain/workflow/presentation.js";

/**
 * Why THIS DIALOG cannot start a workflow.
 *
 * The set is the MODAL's own preconditions, and the wording says so, because
 * the modal must never spell a refusal the server would not make: `POST
 * /start-plans` takes JSON submissions and parses them with `descriptor.input`,
 * so a caller that composes its own submission can start a workflow that
 * declares no typed-input surface. What this dialog lacks is a box to type into.
 *
 * There is exactly one arm today, and `availability` is deliberately not a
 * second: `buildBootstrap` serves every workflow `{state:"available"}`
 * unconditionally and no start path reads it, so an arm keyed on it would be a
 * reason nothing produces and nothing enforces.
 */
export const START_DOOR_ABSENCE = Object.freeze({
  "no-typed-input": "This workflow declares no typed-input surface, so this dialog has no box for it.",
});
export type StartDoorAbsenceCode = keyof typeof START_DOOR_ABSENCE;

/**
 * What the descriptor's declared `enqueue` policy MEANS — stated as what the
 * planner does, never as what the arm's name suggests (D251).
 *
 * `services/start/plan.ts` runs its active-run check under exactly one arm.
 * `allow-parallel` therefore runs no check at all, which the text says; and
 * **`supersede-active` supersedes nothing** — no planner path implements it and
 * no registered descriptor declares it. Writing "supersedes the running one"
 * here would put a claim on screen that the server does not honour, which is
 * the same defect as offering the policy as an operator choice.
 */
export const ENQUEUE_POLICY_MEANING: Readonly<Record<EnqueuePolicy, string>> = Object.freeze({
  "reject-active": "Refuses the start while a run for the same subject is unfinished",
  "supersede-active": "Declared, and not implemented — the planner supersedes nothing",
  "allow-parallel": "Starts regardless of what is already running for the same subject",
});

/**
 * Why the policy is not a control. The demo offers a `Select`; this tree reads
 * `descriptor.enqueue` in the planner and accepts no per-start override, so a
 * select would let an operator choose an answer the server would ignore.
 */
export const ENQUEUE_POLICY_REASON = "declared by this workflow — the planner reads it, not the form";
