
import {
  ActionDescriptorWireSchema,
  type ActionDescriptorWire,
} from "../../../models/dashboard/actions.js";
import {
  TERMINAL_QUEUE_STATUSES,
  type QueueSurfaceWire,
} from "../../../models/dashboard/projection.js";
import type {
  ActionConditionRule,
  WorkflowActionId,
  WorkflowActionPolicy,
} from "../../../models/workflow/presentation.js";

type QueueStatus = QueueSurfaceWire["status"];


export interface QueueRowActionFacts {
  readonly pauseControl?: QueueSurfaceWire["pauseControl"];
  readonly status: QueueStatus;
  readonly interrupted?: boolean;
  /** the run ended by an operator or system cancel; a discarded or superseded row shows "cancelled" too but never reruns */
  readonly cancelled?: boolean;
  /** the CAS target every served command binds to */
  readonly rowRevision: number;
  /** ref workflow-model's envelope flag — decides whether a re-run can touch a real system */
  readonly dryRun: boolean;
  readonly isChild: boolean;
  /** the run is parked on a fenced write whose outcome is unknown (ref write-safety ) */
  readonly parkedWrite: boolean;
  /** delegated members under an operation row; `0` for every other surface */
  readonly memberCount: number;

  readonly isMember: boolean;

  readonly named: boolean;
  /** ref dashboard-surfaces's `has-review-panel` condition input */
  readonly hasReviewPanel: boolean;
  readonly batchMemberRetryAvailable?: boolean;
  readonly aggregateMemberRetryAvailable?: boolean;
}

/** The verbs this projection may serve, each a member of `ActionCommandKeySchema`. */
type ServedCommand = "cancel" | "bump" | "rename" | "delete";


const KERNEL_ADMITS: Readonly<Record<ServedCommand, (facts: QueueRowActionFacts) => boolean>> = {
  /* `executeCancel`: "already terminal; there is nothing to cancel". */
  cancel: (facts) => !TERMINAL_QUEUE_STATUSES.has(facts.status) && !facts.parkedWrite,

  bump: (facts) => facts.status === "queued",

  rename: (facts) => !facts.isMember,

  delete: (facts) => TERMINAL_QUEUE_STATUSES.has(facts.status) && !facts.isChild,
};

/** Ref dashboard-surfaces's closed condition rules, evaluated over projected row state. */
function conditionHolds(rule: ActionConditionRule, facts: QueueRowActionFacts): boolean {
  switch (rule.requires) {
    case "gate-open": return facts.status === "awaiting-approval";
    case "write-parked": return facts.parkedWrite;
    case "failed": return facts.status === "failed";
    case "terminal": return TERMINAL_QUEUE_STATUSES.has(facts.status);
    case "has-review-panel": return facts.hasReviewPanel;
  }
}


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


function placementOf(command: ServedCommand): ActionDescriptorWire["placement"] {

  if (command === "rename") return ["menu"];
  return ["footer", "menu"];
}

function cancelBody(facts: QueueRowActionFacts): string {
  const scope = facts.memberCount > 0 ? `Cancels the group and its ${String(facts.memberCount)} delegated members. ` : "";
  return `${scope}Final: a cancelled run is never resumed.`;
}

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
          confirmLabel: "Delete",
          tone: "destructive",
        },
      };
    case "rename":
      // Write resolution opens its own ceremony; a generic confirmation would not prove the write.
      return {
        ...base,
        key: "rename",
        label: facts.named ? "Rename run…" : "Name this run…",
        intent: "neutral",
        icon: "rename",
      };
  }
}


const SERVED_ORDER: readonly ServedCommand[] = ["bump", "cancel", "rename", "delete"];


export function queueRowActions(
  policy: WorkflowActionPolicy | undefined,
  facts: QueueRowActionFacts,
): ActionDescriptorWire[] {
  if (policy === undefined) return [];
  const memberRetry = facts.aggregateMemberRetryAvailable === true && facts.status === "failed" && facts.isChild && !facts.parkedWrite
    && policyEnables(policy, "retry", facts)
    ? [ActionDescriptorWireSchema.parse({ key: "retry-member", label: "Retry failed member", kind: "command", command: "retry",
      expectedVersion: facts.rowRevision, intent: "primary", icon: "retry", placement: ["footer", "menu"] })] : [];
  const retry = facts.batchMemberRetryAvailable === true && facts.status === "failed" && !facts.isChild && !facts.parkedWrite
    && policyEnables(policy, "retry", facts)
    ? [ActionDescriptorWireSchema.parse({ key: "retry-batch-member", label: "Retry", kind: "command", command: "retry",
      expectedVersion: facts.rowRevision, intent: "neutral", icon: "retry", placement: ["banner"] })] : [];
  const rerun = !facts.isChild && !facts.parkedWrite
    && (facts.interrupted || ["done", "failed", "partial"].includes(facts.status) || facts.status === "cancelled" && facts.cancelled === true)
    && (policyEnables(policy, "retry", facts) || policyEnables(policy, "restart", facts))
    ? [ActionDescriptorWireSchema.parse({ key: "rerun", label: "Rerun", kind: "navigation",
      navigate: { kind: "rerun", expectedVersion: facts.rowRevision },
      intent: "primary", icon: "retry", placement: ["footer", "menu", "data"] })] : [];
  const pause = facts.pauseControl?.command;
  const pauseActions = pause === undefined ? [] : [ActionDescriptorWireSchema.parse({
    key: pause, kind: "command", command: pause, expectedVersion: facts.pauseControl?.expectedVersion,
    label: pause === "pause" ? "Pause" : "Resume", intent: "neutral", icon: pause, placement: ["footer"],
  })];
  return [...pauseActions, ...memberRetry, ...retry, ...rerun, ...SERVED_ORDER
    .filter((command) => policyEnables(policy, command, facts) && KERNEL_ADMITS[command](facts))
    .map((command) => ActionDescriptorWireSchema.parse(describe(command, facts)))];
}
