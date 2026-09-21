/**
 * The per-row action projection (ref dashboard-surfaces §2.4, ref frontend-backend-integration §3.2/§8.5).
 *
 * Ref frontend-backend-integration §8.5: *interactive run controls require an `ActionDescriptorWire`;
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
  /** ref workflow-model §2's envelope flag — decides whether a re-run can touch a real system */
  readonly dryRun: boolean;
  /** a delegated child; the kernel refuses generic retry for one */
  readonly isChild: boolean;
  /** the run is parked on a fenced write whose outcome is unknown (ref write-safety §4.1) */
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
  /** ref dashboard-surfaces §2.4's `has-review-panel` condition input */
  readonly hasReviewPanel: boolean;
}

/** The verbs this projection may serve, each a member of `ActionCommandKeySchema`. */
type ServedCommand = "cancel" | "bump" | "rename" | "delete";

/**
 * The kernel's own preconditions, restated as row-level admission.
 *
 * Each arm cites the kernel function that would reject the command, so a
 * precondition that moves has exactly one place here to move with it. Nothing
 * below guesses: a verb whose kernel arm has no state precondition (`rename`)
 * is admitted in every state, because that IS what the kernel accepts.
 */
const KERNEL_ADMITS: Readonly<Record<ServedCommand, (facts: QueueRowActionFacts) => boolean>> = {
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
  /*
   * `executeDelete` (D308): rejects a non-terminal run ("only a terminal run
   * can be deleted — cancel it first"), rejects an ARCHIVED run by name (the
   * Archive's own `delete-archived-run` door cites the record's content
   * digest), and rejects any run whose `envelope.parent` is set ("delete the
   * group") because the tree goes leaves-first from its anchor.
   *
   * Two of those three are mirrored here and the third is not, each for a
   * reason:
   *
   *  - TERMINAL is a stable row fact, so it is mirrored. A row that goes
   *    terminal between the projection and the click is the kernel's CAS to
   *    catch, not this projector's to pre-empt.
   *  - `isChild` is the exact projection of `envelope.parent !== undefined`
   *    (`run-queue-projection.ts`), so it is the kernel's own condition and
   *    not a paraphrase. It is deliberately WIDER than `isMember`: a `linked`
   *    child keeps its own row, and serving it a 🗑 would draw a control the
   *    kernel refuses by name every single time — the one thing this module
   *    exists to make impossible.
   *  - ARCHIVED is not mirrored because it cannot occur: an archived run is
   *    not folded into the queue projection at all, so no row exists to hang
   *    this descriptor off.
   */
  delete: (facts) => TERMINAL_QUEUE_STATUSES.has(facts.status) && !facts.isChild,
};

/** Ref dashboard-surfaces §2.4's closed condition rules, evaluated over projected row state. */
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
 * The demo's own footer set, restated as a placement decision (ref frontend-backend-integration §1 — the
 * demo is the visual oracle). A queued row's frequent commands are `≫` and `×`;
 * a finished row's is `↺`. Everything served is ALSO at `menu`, which is what
 * makes the right-click the row's full set and the footer a subset of the same
 * list rather than a second vocabulary. D234 retired `hide`, whose `🗑` was the
 * one footer slot that depended on the row being terminal, and for that window
 * placement did not vary with status at all. D308 puts a `🗑` back in that
 * slot: `delete` is terminal-only, so the footer's shape is once again a fact
 * about the row's lifecycle. Placement itself is still unconditional — it is
 * `KERNEL_ADMITS.delete` that decides whether the descriptor is served, which
 * keeps "where a control sits" and "whether it exists" separate questions.
 */
function placementOf(command: ServedCommand): ActionDescriptorWire["placement"] {
  // `rename` is menu-only in the demo and here, for the reason the footer set
  // exists: the footer is the FREQUENT subset. Naming a run is a thing an
  // operator does once, to one run, on purpose.
  if (command === "rename") return ["menu"];
  return ["footer", "menu"];
}

/**
 * D246 changed what this sentence has to say for a parked-write row, and the
 * change is the difference between a warning and the truth. It used to admit
 * that cancelling "does not answer whether that transaction landed" — which
 * was accurate and incomplete, because the cancel also took both typed
 * resolutions off the surface, so nobody could answer it afterwards either.
 * The kernel now REFUSES that cancel, and the copy says so.
 *
 * The control is still served and still clickable. Only the kernel's own
 * transaction can see whether an intent is still unresolved at the instant the
 * command lands, and a button greyed out by a projected fact would be this
 * projector claiming to know what only that transaction knows (D179's rule for
 * the archive's Apply, same shape).
 */
function cancelBody(facts: QueueRowActionFacts): string {
  const scope = facts.memberCount > 0
    ? `This cancels the group and every one of its ${String(facts.memberCount)} delegated members. `
    : "This stops the run where it is and settles it cancelled. ";
  if (facts.parkedWrite) {
    return `${scope}This run is parked on a fenced write whose outcome is UNKNOWN, and cancelling is `
      + "REFUSED until that write is answered — a cancelled run cannot be resolved, so the cancel would "
      + "strand a real HR transaction nobody settled. Record it present or absent on the run's parked "
      + "write panel first, then cancel.";
  }
  return `${scope}Cancelling is final: a cancelled run is never resumed, only run again.`;
}

/**
 * D308's blast radius, in the operator's own terms.
 *
 * The idempotency sentence is UNCONDITIONAL and that is the load-bearing
 * choice. This projector knows the run is terminal; it does not know whether
 * the run reached a fenced write, and a body that only warned about released
 * keys when it thought a write had happened would be this module guessing at
 * write-safety authority from a lifecycle status. The permanent key in
 * `run_operations` is what stops the same live HR transaction from being
 * submitted twice, so the honest sentence names the condition ("if this run
 * wrote…") and lets the operator hold it against what they know.
 */
function deleteBody(facts: QueueRowActionFacts): string {
  const scope = facts.memberCount > 0
    ? "This removes the run and every row it owns from the database — results, checkpoints, receipts, "
      + `diagnostics, and its write ledger — and its ${String(facts.memberCount)} delegated members with it. `
    : "This removes the run and every row it owns from the database — results, checkpoints, receipts, "
      + "diagnostics, and its write ledger. ";
  return `${scope}If this run wrote to ${facts.workflowLabel}'s systems, the permanent idempotency key `
    + "that stops the same write from being submitted twice is released with it. "
    + "This is final; there is no undo.";
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
    case "delete":
      return {
        ...base,
        key: "delete",
        label: facts.memberCount > 0 ? "Delete group" : "Delete run",
        intent: "destructive",
        icon: "delete",
        confirm: {
          title: facts.memberCount > 0 ? "Delete this group" : "Delete this run",
          body: deleteBody(facts),
          confirmLabel: "Delete",
          tone: "destructive",
        },
      };
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

/**
 * The served command order, which is also the footer's left-to-right order.
 *
 * `delete` is LAST so its `🗑` sits at the right end, after the `✕` — the
 * demo's own footer order, and the one that keeps the most destructive control
 * furthest from the click an operator makes by reflex.
 */
const SERVED_ORDER: readonly ServedCommand[] = ["bump", "cancel", "rename", "delete"];

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
  const rerun = !facts.isChild && !facts.parkedWrite
    && ["done", "failed", "partial"].includes(facts.status)
    && (policyEnables(policy, "retry", facts) || policyEnables(policy, "restart", facts))
    ? [ActionDescriptorWireSchema.parse({ key: "rerun", label: "Rerun", kind: "navigation",
      navigate: { kind: "rerun", expectedVersion: facts.rowRevision },
      intent: "primary", icon: "retry", placement: ["footer", "menu"] })] : [];
  return [...rerun, ...SERVED_ORDER
    .filter((command) => policyEnables(policy, command, facts) && KERNEL_ADMITS[command](facts))
    .map((command) => ActionDescriptorWireSchema.parse(describe(command, facts)))];
}
