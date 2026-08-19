/**
 * The per-row action projection (doc 03 §2.4, doc 13 §3.2/§8.5).
 *
 * Doc 13 §8.5: *interactive run controls require an `ActionDescriptorWire`;
 * status-key-to-command branches fail.* This module is the run ROW's half of
 * that rule — `run-detail.ts` already projects the two SECTION-level decision
 * sets (`parked-write`, `identity-gate`) and this is the generic arm that was
 * missing, which is why every queue row drew no controls at all.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: **an action descriptor with no
 * command behind it may not be served.** A control the surfaces draw is a
 * control the operator will press, and a press that 422s — or worse, one whose
 * verb the kernel does not implement at all — is a lie told by a button. So
 * every descriptor below is admitted by a check written against the kernel's
 * OWN preconditions (`src/core/command-kernel.ts`), each cited at its arm, and
 * the served vocabulary is `ActionCommandKeySchema`, which `wire-connectivity`
 * already pins member-for-member against `CommandRequestSchema`.
 *
 * WHAT IT IS NOT is a second authority. The command service re-validates every
 * request on receipt, and it is the only party that can: the row is a snapshot
 * and the run moves. So the checks here are the ones that are STABLE facts
 * about the row (its lifecycle class, its lineage, what its descriptor
 * enables), never the racy ones — a run that goes queued between the
 * projection and the click must be refused by the kernel's CAS, with the
 * server's own sentence, rather than pre-filtered into invisibility. That is
 * D179's "Apply stays clickable" rule at row scale: a control disabled by a
 * client-side guess is the client claiming to know what only a transaction can.
 *
 * The kernel-accepted run verbs this projection deliberately never serves, each
 * for a reason rather than an omission:
 *
 *  - `resolve-gate` / `resolve-write-present` / `resolve-write-absent` — these
 *    are answered from their own run-detail SECTIONS, which carry the packet
 *    and the evidence note their payloads require. A row control could not
 *    compose either payload, and offering one irreversible answer by two roads
 *    (one of which cannot carry the note) is exactly what `command-dispatch.ts`
 *    already refuses by name.
 */
import {
  ActionDescriptorWireSchema,
  type ActionDescriptorWire,
} from "../../../domain/dashboard/actions.js";
import {
  TERMINAL_QUEUE_STATUSES,
  type QueueSurfaceWire,
} from "../../../domain/dashboard/projection.js";
import type {
  ActionConditionRule,
  WorkflowActionId,
  WorkflowActionPolicy,
} from "../../../domain/workflow/presentation.js";

type QueueStatus = QueueSurfaceWire["status"];

/**
 * The row facts an admission check may read.
 *
 * Deliberately a flat value rather than the `RunRecord`: everything here is
 * already a projected fact the operator can SEE on the row, which is what makes
 * the served set explainable. A check that needed something invisible would be
 * a control appearing and disappearing for reasons nobody could read.
 */
export interface QueueRowActionFacts {
  readonly status: QueueStatus;
  /** the CAS target every served command binds to */
  readonly rowRevision: number;
  /** doc 02 §2's envelope flag — decides whether a re-run can touch a real system */
  readonly dryRun: boolean;
  /** a delegated child; the kernel refuses generic retry for one */
  readonly isChild: boolean;
  /** the run is parked on a fenced write whose outcome is unknown (doc 09 §4.1) */
  readonly parkedWrite: boolean;
  /** delegated members under an operation row; `0` for every other surface */
  readonly memberCount: number;
  /**
   * This row IS one delegated member of a group (`surfaceKind === "member"`),
   * rather than a root run or the group anchor itself. Only `rename` reads it —
   * see `KERNEL_ADMITS.rename`.
   */
  readonly isMember: boolean;
  /**
   * The operator has already named this run. It changes one word of one label
   * ("Rename run…" against "Name this run…"), which is a served-copy decision
   * like every other label in this file: the server knows whether a name exists
   * and the client must not re-derive it from a `displayName` field it happens
   * to also hold.
   */
  readonly named: boolean;
  /** the workflow's own label, for confirm copy that names what is about to run */
  readonly workflowLabel: string;
  /** doc 03 §2.4's `has-review-panel` condition input */
  readonly hasReviewPanel: boolean;
}

/** The verbs this projection may serve, each a member of `ActionCommandKeySchema`. */
type ServedCommand = "retry" | "cancel" | "bump" | "rename";

/**
 * The kernel's own preconditions, restated as row-level admission.
 *
 * Each arm cites the kernel function that would reject the command, so a
 * precondition that moves has exactly one place here to move with it. Nothing
 * below guesses: a verb whose kernel arm has no state precondition (`rename`)
 * is admitted in every state, because that IS what the kernel accepts.
 */
const KERNEL_ADMITS: Readonly<Record<ServedCommand, (facts: QueueRowActionFacts) => boolean>> = {
  /*
   * `executeRetry`: rejects a non-terminal run ("only a terminal run can be
   * retried"), rejects a `parked-write` run by name (doc 09 §4.1's resolutions
   * are the only exits), and refuses a delegated child ("child retries route
   * through their delegation edge policy").
   *
   * Its `reject-active` enqueue check is NOT mirrored here on purpose: whether
   * another run for this item is active is exactly the fact that can change
   * between the projection and the click, so it belongs to the kernel's
   * transaction and to the toast that prints its refusal.
   */
  retry: (facts) => TERMINAL_QUEUE_STATUSES.has(facts.status) && !facts.isChild,
  /* `executeCancel`: "already terminal; there is nothing to cancel". */
  cancel: (facts) => !TERMINAL_QUEUE_STATUSES.has(facts.status),
  /*
   * `executeBump`: "the scheduler supports no cooperative yield, so only a
   * queued run's claim order can be bumped".
   */
  bump: (facts) => facts.status === "queued",
  /*
   * `executePresentation`: no state precondition at all — a name changes no
   * outcome, task, checkpoint, intent or evidence, so the kernel accepts a
   * rename in every state, including on a run that has already written to
   * UCPath. That is the whole reason a rename is safe to offer at all.
   *
   * The ONE narrowing is row shape, and it is not a kernel fact: a MEMBER row
   * is one delegated item inside a group, and `displayName` REPLACES the title
   * on the row it rides. So naming a member would put free text where that
   * group list prints the person the item is about — a subject's name silently
   * becoming "Friday exception pack" in a list of fifty is the wrong-person
   * hazard this product spends a gate on. The group anchor is where a name
   * belongs, and it keeps its control. (The demo excludes the same rows,
   * `demo-wire.ts:2564`, `spec.rowType !== "member"`.)
   */
  rename: (facts) => !facts.isMember,
};

/** Doc 03 §2.4's closed condition rules, evaluated over projected row state. */
function conditionHolds(rule: ActionConditionRule, facts: QueueRowActionFacts): boolean {
  switch (rule.requires) {
    case "gate-open": return facts.status === "awaiting-approval";
    case "write-parked": return facts.parkedWrite;
    case "failed": return facts.status === "failed";
    case "terminal": return TERMINAL_QUEUE_STATUSES.has(facts.status);
    case "has-review-panel": return facts.hasReviewPanel;
  }
}

/**
 * The descriptor's declared policy (`WorkflowActionPolicy`), which is the
 * workflow's own statement of what it offers. Every condition naming an action
 * must hold — a rule that narrows an action can only narrow it, never widen it
 * back.
 */
function policyEnables(
  policy: WorkflowActionPolicy,
  action: WorkflowActionId,
  facts: QueueRowActionFacts,
): boolean {
  if (!policy.enabled.includes(action)) return false;
  return (policy.conditions ?? [])
    .filter((rule) => rule.action === action)
    .every((rule) => conditionHolds(rule, facts));
}

/**
 * The demo's own footer set, restated as a placement decision (doc 13 §1 — the
 * demo is the visual oracle). A queued row's frequent commands are `≫` and `×`;
 * a finished row's is `↺`. Everything served is ALSO at `menu`, which is what
 * makes the right-click the row's full set and the footer a subset of the same
 * list rather than a second vocabulary. Since D234 retired `hide` — whose `🗑`
 * was the one footer slot that depended on the row being terminal — placement
 * no longer varies with status at all.
 */
function placementOf(command: ServedCommand): ActionDescriptorWire["placement"] {
  // `rename` is menu-only in the demo and here, for the reason the footer set
  // exists: the footer is the FREQUENT subset. Naming a run is a thing an
  // operator does once, to one run, on purpose.
  if (command === "rename") return ["menu"];
  return ["footer", "menu"];
}

function cancelBody(facts: QueueRowActionFacts): string {
  const scope = facts.memberCount > 0
    ? `This cancels the group and every one of its ${String(facts.memberCount)} delegated members. `
    : "This stops the run where it is and settles it cancelled. ";
  const park = facts.parkedWrite
    ? "This run is parked on a fenced write whose outcome is UNKNOWN — cancelling records the run as "
      + "cancelled and does not answer whether that transaction landed. "
    : "";
  return `${scope}${park}Cancelling is final: a cancelled run is never resumed, only run again.`;
}

function retryBody(facts: QueueRowActionFacts): string {
  return facts.dryRun
    ? `This starts a NEW rehearsal run of ${facts.workflowLabel}. A rehearsal performs no real `
      + "transaction. The run you are looking at is left exactly as it is."
    : `This starts a NEW run of ${facts.workflowLabel} against the real systems it writes to. The run `
      + "you are looking at is left exactly as it is.";
}

/**
 * The one descriptor builder. Copy is authored HERE rather than on the client
 * for the reason `ConfirmCommandDialog` states: only the server knows the blast
 * radius, and the member count in `cancelBody` is the live example.
 */
function describe(command: ServedCommand, facts: QueueRowActionFacts): unknown {
  const placement = placementOf(command);
  const base = { command, expectedVersion: facts.rowRevision, kind: "command", placement } as const;
  switch (command) {
    case "retry":
      return {
        ...base,
        key: "retry",
        label: "Run again",
        intent: "primary",
        icon: "retry",
        confirm: {
          title: "Run this again",
          body: retryBody(facts),
          confirmLabel: "Run again",
          // A rehearsal cannot file anything; a real re-run can, and the
          // dialog's tone is the last place that difference is visible.
          tone: facts.dryRun ? "neutral" : "destructive",
        },
      };
    case "cancel":
      return {
        ...base,
        // `FooterActions` special-cases this key to title the ✕ with the
        // tree's blast radius; a plain row keeps the plain key.
        key: facts.memberCount > 0 ? "cancel-tree" : "cancel",
        label: facts.memberCount > 0 ? "Cancel group" : "Cancel run",
        intent: "destructive",
        icon: "cancel",
        confirm: {
          title: facts.memberCount > 0 ? "Cancel this group" : "Cancel this run",
          body: cancelBody(facts),
          confirmLabel: facts.memberCount > 0 ? "Cancel the group" : "Cancel the run",
          tone: "destructive",
        },
      };
    case "bump":
      // No confirm: bumping changes claim ORDER and nothing else — no input, no
      // descriptor version, no archive — and a dialog in front of a reversible
      // reordering is ceremony that teaches the operator to click through.
      return { ...base, key: "bump", label: "Run next", intent: "neutral", icon: "bump" };
    case "rename":
      /*
       * No `confirm` — and that is not the same omission `bump` makes. A
       * confirm dialog re-states a decision the operator already made; rename
       * has no decision to re-state until they have TYPED one, so the surface
       * intercepts this descriptor and opens the rename dialog, which is where
       * the value comes from. Handing it a `confirm` as well would ask twice
       * about one act, and `command-dispatch.ts` refuses to compose a rename
       * with no name rather than sending a plausible one.
       *
       * The label follows the demo (`demo-wire.ts:2568`): a run that has never
       * been named is being NAMED, not renamed.
       */
      return {
        ...base,
        key: "rename",
        label: facts.named ? "Rename run…" : "Name this run…",
        intent: "neutral",
        icon: "rename",
      };
  }
}

/** The served command order, which is also the footer's left-to-right order. */
const SERVED_ORDER: readonly ServedCommand[] = ["retry", "bump", "cancel", "rename"];

/**
 * Every control this row may draw.
 *
 * It takes the descriptor's `WorkflowActionPolicy` rather than the descriptor,
 * because that policy plus the facts above is the whole input — a seam narrow
 * enough that the fixture corpus and a unit sweep drive the SAME function the
 * projector does, rather than a second table that can drift from it.
 *
 * A run whose workflow has NO registered descriptor in this build (`undefined`)
 * serves an empty list, exactly as `#pipeline` serves only observed nodes for
 * one: the policy is the workflow's own statement of what it offers, and a
 * build that cannot read it must not guess a default set onto a run it cannot
 * describe.
 */
export function queueRowActions(
  policy: WorkflowActionPolicy | undefined,
  facts: QueueRowActionFacts,
): ActionDescriptorWire[] {
  if (policy === undefined) return [];
  return SERVED_ORDER
    .filter((command) => policyEnables(policy, command, facts) && KERNEL_ADMITS[command](facts))
    .map((command) => ActionDescriptorWireSchema.parse(describe(command, facts)));
}
