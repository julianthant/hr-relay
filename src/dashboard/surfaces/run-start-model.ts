/**
 * The Run Modal's pure half — its vocabularies and its one fold (ref frontend-backend-integration §8.14).
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

/** the two queue priorities `StartPlanIngress` accepts */
export type StartPriority = "interactive" | "bulk";

// ---------------------------------------------------------------------------
// D296 — the two ways work enters this queue, inside the dialog that starts it
// ---------------------------------------------------------------------------

/**
 * HOW the operator is starting this run.
 *
 * The demo's `LauncherStartMethodKind` has four arms (`typed`, `upload`,
 * `spreadsheet`, `bare`); this tree serves two, and serves them from
 * DECLARATIONS rather than from a fixture: `typed` exists when the descriptor
 * declares `surfaces.inputRun`, and `spreadsheet` exists when the module
 * declares an intake projection. `upload` and `bare` are deliberately absent
 * for the reason `WorkflowStartWireSchema` gives about `uploadRun` — no
 * registered workflow produces one, and an arm nothing can produce is the
 * D181/`degraded` shape.
 */
export type StartMethod = "typed" | "spreadsheet";

export const START_METHOD_LABEL: Readonly<Record<StartMethod, string>> = Object.freeze({
  typed: "Type values",
  spreadsheet: "Import a spreadsheet",
});

/*
 * D298 — the spreadsheet arm IS the dropzone, and it has no primary.
 *
 * D296 shipped this arm as an explanatory panel over an `Open the intake…`
 * primary, on the reading that a file picker here would be "a door into the
 * middle of the workspace, past the mapping". That reading was wrong about its
 * own workspace: the workspace's FIRST screen is that same dropzone
 * (`intake.tsx`'s `resource.state === "empty"` arm), and dropping a file there
 * skips no mapping — it opens the session and lands on the mapping grid. So
 * what D296 actually drew was a paragraph describing a zone, above a button
 * whose only job was to reach that zone one screen later.
 *
 * The panel is now the zone itself, drawn from the workspace's own
 * `INTAKE_ACCEPT` / `INTAKE_DROPZONE_HINT` / `intakeDropzoneLabel` so the two
 * doors cannot describe different caps. The upload IS the press: the dialog
 * closes on `?intake=<sessionId>` with the file already read. Nothing here
 * maps, validates or enqueues — those stay in the workspace, because the
 * session is durable and a modal would trap a task that takes minutes
 * (D170/D173).
 *
 * There is consequently NO `SPREADSHEET_HANDOFF_TITLE`/`_BODY` any more, and
 * no handoff primary; the arm's footer carries `Cancel` alone. The hint the
 * zone already prints — "Nothing runs until you map its columns and review what
 * it rejects" — says what the deleted paragraph said, on the control it is
 * about.
 */

/**
 * Why a workflow shows no spreadsheet method.
 *
 * Stated as the MODULE's own missing declaration, in the same words
 * `command-kernel.ts` refuses an intake commit with, so the dialog never spells
 * a refusal the server would not make.
 */
export const SPREADSHEET_METHOD_ABSENCE =
  "This workflow declares no intake projection, so it is not spreadsheet-capable.";

// ---------------------------------------------------------------------------
// C109 — a plan, and the result behind it, outlive nothing that shaped them
// ---------------------------------------------------------------------------

/**
 * Everything the operator can change that changes what `POST /start-plans`
 * would answer. The demo cleared its result from inside every control's own
 * `onChange` (`DemoRunStart.tsx:882,893`); this tree derives the same thing
 * from ONE identity instead, because a control added tomorrow that forgets the
 * line leaves a settled result standing over a request that no longer exists —
 * exactly the shape the queue's `bulkPlans` bug had (`src/dashboard/CLAUDE.md`,
 * 2026-08-26).
 *
 * D272 item 8 (`ref dashboard-surfaces` §10, ledger 1 row C109).
 */
export interface StartRequestShape {
  workflowId: string;
  text: string;
  dryRun: boolean;
  priority: StartPriority;
  selectedStepKeys: readonly string[];
}

/**
 * The identity of the request a plan was made for. Two requests share a
 * fingerprint exactly when the server would be asked the same question.
 */
export function startRequestFingerprint(request: StartRequestShape): string {
  return JSON.stringify([
    request.workflowId,
    request.text,
    request.dryRun,
    request.priority,
    [...request.selectedStepKeys].sort(),
  ]);
}

// ---------------------------------------------------------------------------
// C83 / C84 — the run-control rail is numbered by what it DRAWS
// ---------------------------------------------------------------------------

export type RunControlGroupKey = "queue" | "safety";

export interface RunControlGroupSpec {
  key: RunControlGroupKey;
  /** the chip the group carries — `01`-based, contiguous, in reading order */
  step: string;
  title: string;
  description: string;
}

const RUN_CONTROL_GROUP_COPY: Readonly<Record<RunControlGroupKey, { title: string; description: string }>> =
  Object.freeze({
    queue: {
      title: "Queue behavior",
      description: "Choose how this work enters the browser queue.",
    },
    safety: {
      title: "Safety & mode",
      description: "Apply optional limits before the run starts.",
    },
  });

/**
 * The run-control groups this workflow actually draws, numbered in reading
 * order (C83/C84, D272 item 9).
 *
 * D293 removes Destination from this dashboard form: the planner resolves
 * every declared browser system to production when the request carries no
 * override. A workflow that declares no dry run draws NO Safety group:
 * `DESIGN.md:305`'s
 * rule for a declaration-driven control is "a workflow that declares none shows
 * none: no empty scaffolding", and its offer-disabled rule is written for an
 * OPTION inside a control, not for the group around it. The numbers then have
 * to close up — a frozen `03` beside a two-group rail leaves a gap in the
 * reading path the numbers exist to give.
 */
export function runControlGroups(supportsDryRun: boolean): readonly RunControlGroupSpec[] {
  const keys: readonly RunControlGroupKey[] = supportsDryRun
    ? ["queue", "safety"]
    : ["queue"];
  return keys.map((key, index) => ({
    key,
    step: String(index + 1).padStart(2, "0"),
    ...RUN_CONTROL_GROUP_COPY[key],
  }));
}
