/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoActions.tsx
 *
 * Every run control, rendered from the server-sent `actions[]` and nothing
 * else. This file exists to make one rule mechanically true: **no component
 * decides which buttons a row gets.** There is no `status === "failed" ?
 * <Retry/> : …` anywhere. A component asks for the descriptors at a placement
 * and renders them; if the surface did not send one, there is no button to
 * render — a command that must not be offered is structurally unreachable
 * rather than merely hidden.
 *
 * 1i port scope: the run-action renderers (footer, banner, outcome, context
 * menu) and the server-authored confirm dialog, typed against the rebuild's
 * `ActionDescriptorWire`. Deferred with their surfaces (2g): `ParkResolutions`
 * and the park command split (no park commands exist in the Phase-1 action
 * vocabulary), `CommandResultFeed` + `toastAppliedCommandResult` (the command
 * result surfaces land with the app's real `CommandResult` wiring).
 */
import { Fragment, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronsUp,
  ClipboardList,
  PauseCircle,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconActionButton } from "../shared/icon-action-button.js";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  dsBorder,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
} from "../ds/ui.js";
import {
  actionsAt,
  type ActionDescriptorWire,
  type ActionIconKey,
  type ActionIntent,
} from "../../domain/dashboard/actions.js";

/** The object a run action is about — the row id and the revision it was projected at. */
export interface ActionTarget {
  runId: string;
  expectedVersion: number;
}

/**
 * Every control calls this. The surface hands back the action and its target;
 * the app owns turning that into the one command envelope (and reacting to
 * conflict / rejected in place). Navigation actions route instead of command.
 */
export type DashboardActionHandler = (action: ActionDescriptorWire, target: ActionTarget) => void;

const NOOP_ACTION: DashboardActionHandler = () => {};

const ICONS: Record<ActionIconKey, ReactNode> = {
  retry: <RotateCcw aria-hidden className={dsIcon.md} />,
  cancel: <X aria-hidden className={dsIcon.md} />,
  bump: <ChevronsUp aria-hidden className={dsIcon.md} />,
  delete: <Trash2 aria-hidden className={dsIcon.md} />,
  review: <ClipboardList aria-hidden className={dsIcon.md} />,
  resolve: <PauseCircle aria-hidden className={dsIcon.md} />,
  rename: <Pencil aria-hidden className={dsIcon.md} />,
  external: <ArrowUpRight aria-hidden className={dsIcon.md} />,
  drill: <Search aria-hidden className={dsIcon.md} />,
};

/**
 * The wire's seven intents, as colour only. These are NOT `Button` variants:
 * a descriptor's intent is chosen by the server for a command, and mapping four
 * of them onto Button would either invent four chromatic variants or flatten
 * them all to "secondary". So the tone stays a map and the SHELL is shared —
 * which is the part that was actually broken.
 */
const INTENT_PILL: Record<ActionIntent, string> = {
  primary: "border-transparent bg-[var(--ds-accent)] font-semibold text-[color:var(--ds-accent-fg)] hover:bg-[var(--ds-accent-hover)]",
  neutral: cn(
    "border-[color:var(--ds-border-strong)] bg-[var(--ds-control-bg)] font-medium",
    "text-[color:var(--ds-control-fg)] hover:bg-[var(--ds-control-bg-hover)]",
  ),
  destructive:
    "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)] font-semibold text-[color:var(--ds-danger)] hover:brightness-125",
  violet: cn(
    "border-[color:var(--ds-status-parked-border)] bg-[var(--ds-status-parked-bg)]",
    "font-semibold text-[color:var(--ds-status-parked-fg)] hover:brightness-125",
  ),
  success:
    "border-[color:var(--ds-success-border)] bg-[var(--ds-success-bg)] font-semibold text-[color:var(--ds-success-fg)] hover:brightness-125",
  info: "border-[color:var(--ds-info-border)] bg-[var(--ds-info-bg)] font-semibold text-[color:var(--ds-info-fg)] hover:brightness-125",
  warning: cn(
    "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]",
    "font-semibold text-[color:var(--ds-status-waiting-fg)] hover:brightness-125",
  ),
};

/**
 * ONE shell for every intent pill. The banner and the inline outcome button
 * were two different heights, paddings and font sizes for the same control,
 * which is why the same command looked like two commands depending on where you
 * met it. `sm` is the inline slot beside a subline; `md` is the banner.
 */
export const intentPill = (intent: ActionIntent, size: "sm" | "md"): string =>
  cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap border",
    size === "sm"
      ? "h-[var(--ds-h-xs)] gap-[var(--ds-space-tight)] px-[var(--ds-space-base)]"
      : "h-[var(--ds-h-sm)] gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)]",
    // The INLINE pill drops its outline: it sits on a card among chips that are
    // now a fill and no line, and an extra edge there made `Open failure` the
    // heaviest thing on a row whose loudest fact should be its status. The
    // BANNER pill keeps its outline — it sits on a band of its own hue, where
    // a fill alone does not separate it. Weight, focus ring and press dip are
    // what say "command"; the border was not carrying that.
    size === "sm" && "border-transparent",
    dsRadius.md,
    size === "sm" ? dsText.meta : dsText.body,
    dsFocus,
    dsMotion.fast,
    "active:translate-y-px",
    INTENT_PILL[intent],
  );

/** the IconActionButton palette is narrower than the wire's intents */
const INTENT_TONE: Record<ActionIntent, "destructive" | "warning" | "primary" | "muted"> = {
  primary: "primary",
  neutral: "muted",
  destructive: "destructive",
  violet: "muted",
  success: "primary",
  info: "primary",
  warning: "warning",
};

// ---------------------------------------------------------------------------
// Footer — the queue row's own controls
// ---------------------------------------------------------------------------

/**
 * D16's no-undo sentence, on the group cancel's own ✕ (R3 finding 22).
 *
 * Ported verbatim from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `DemoActions.tsx:171-174`. D16 keeps group cancel exempt from a confirm
 * dialog by construction — the descriptor carries no `confirm` — so this title
 * is the ONLY place an operator is told what the ✕ takes with it, which is
 * exactly why losing it mattered.
 *
 * BOUND BY `key`, NOT BY `command`, and that is a deviation with a cause: the
 * demo tests `a.command === "cancel-tree"`, and this repository's
 * `ActionCommandKeySchema` has no such verb — the kernel accepts `cancel`, and
 * binding to that would put a sentence about "every member" on a single run's
 * cancel. `key` is the descriptor's stable per-row identifier, so the action
 * projection names this control by naming this key. Inert until it serves one.
 */
const CANCEL_TREE_KEY = "cancel-tree";
const CANCEL_TREE_TITLE =
  "Cancels this group, its delegated review and every member. Final — there is no undo.";

export function FooterActions({
  actions,
  target,
  onAction = NOOP_ACTION,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  onAction?: DashboardActionHandler;
}) {
  const footer = actionsAt(actions, "footer");
  if (footer.length === 0) return null;
  // The `Cancel group` caption beside the ✕ is GONE. An icon that already means
  // cancel, captioned "cancel", is the same word twice — and it was the only
  // label in the footer's action cluster, so it made one row's buttons a
  // different shape from every other row's. D16's warning did not live in that
  // caption: it is the ✕'s own `title` below.
  return (
    <span className="flex items-center gap-[var(--ds-space-hair)]">
      {footer.map((a) => (
        <IconActionButton
          key={a.key}
          tone={INTENT_TONE[a.intent]}
          icon={ICONS[a.icon ?? "external"]}
          label={a.label}
          title={
            a.key === CANCEL_TREE_KEY
              ? CANCEL_TREE_TITLE
              : a.kind === "command" && a.confirm
                ? `${a.label} — asks first`
                : a.label
          }
          onClick={(e) => {
            e.stopPropagation();
            onAction(a, target);
          }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Banner — the decision the row is sitting on
// ---------------------------------------------------------------------------

export function BannerActions({
  actions,
  target,
  onAction = NOOP_ACTION,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  onAction?: DashboardActionHandler;
}) {
  const pills = actionsAt(actions, "banner");
  if (pills.length === 0) return null;
  return (
    <div className="mt-[var(--ds-space-base)] flex flex-wrap gap-[var(--ds-space-snug)]">
      {pills.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction(a, target);
          }}
          className={intentPill(a.intent, "md")}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome — the ONE thing to do about this row
// ---------------------------------------------------------------------------

export function outcomeAction(actions: readonly ActionDescriptorWire[]): ActionDescriptorWire | undefined {
  return actionsAt(actions, "outcome")[0];
}

export function OutcomeActionButton({
  actions,
  target,
  onAction = NOOP_ACTION,
  className,
  omitKeys,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  onAction?: DashboardActionHandler;
  className?: string;
  /**
   * Keys this SURFACE refuses to draw, because it already renders the thing the
   * action travels to. Queue cards omit the Review ↗ (`open-gate`) — the
   * operator clicks the row — and inside the detail panel the gate options are
   * already on screen, so a pill that only scrolls is redundant.
   */
  omitKeys?: readonly string[];
}) {
  const action = outcomeAction(actions);
  if (!action || omitKeys?.includes(action.key)) return null;

  // Waiting used to open with a gray ↗ beside the gate line. Queue cards now
  // omit `open-gate` entirely — clicking the row is enough. This branch stays
  // for any surface that still asks for the icon-only Review jump.
  if (action.key === "open-gate") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction(action, target);
        }}
        title={action.label}
        aria-label={action.label}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center border",
          "h-[var(--ds-h-xs)] w-[var(--ds-h-xs)]",
          "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)]",
          "text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
          dsRadius.sm,
          dsFocus,
          dsMotion.fast,
          "active:translate-y-px",
          className,
        )}
      >
        <ArrowUpRight aria-hidden className={dsIcon.sm} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAction(action, target);
      }}
      className={cn(intentPill(action.intent, "sm"), "font-sans", className)}
    >
      {action.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The row's own commands, on the row — right-click, not a `⋯`
// ---------------------------------------------------------------------------

/**
 * Wraps a row so right-clicking it opens its full command set.
 *
 * WHY THIS REPLACED THE `⋯`. The overflow button was a control whose only job
 * was to admit there were more controls: it took a slot in every footer in the
 * queue, it named nothing, and it put the row's commands behind a 24px target.
 *
 * WHAT IS IN IT is not a client decision. The items are `actions[]` at the
 * `menu` placement, and the server sends every footer and outcome descriptor
 * with that placement too — so the menu is the row's FULL set, the footer is
 * the frequent subset of the same list, and a command the surface never sent is
 * structurally unreachable from either.
 *
 * The order is by KIND, which is the only grouping that survives a new
 * descriptor: go-somewhere first, do-something next, the one irreversible
 * command last behind a rule.
 */
export function RowContextMenu({
  actions,
  target,
  rowLabel,
  onAction = NOOP_ACTION,
  children,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  /** what the menu is FOR — the row's own name, for the menu's accessible label */
  rowLabel: string;
  onAction?: DashboardActionHandler;
  children: ReactNode;
}) {
  const items = actionsAt(actions, "menu");
  if (items.length === 0) return <>{children}</>;
  const navigate = items.filter((a) => a.kind === "navigation");
  const commands = items.filter((a) => a.kind === "command" && a.intent !== "destructive");
  const destructive = items.filter((a) => a.kind === "command" && a.intent === "destructive");
  const groups = [navigate, commands, destructive].filter((g) => g.length > 0);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent label={`Commands for ${rowLabel}`}>
        {groups.map((group, i) => (
          <Fragment key={i}>
            {i > 0 && <ContextMenuSeparator className={cn("my-[var(--ds-space-tight)] h-px", dsBorder.subtle, "border-t")} />}
            {group.map((a) => (
              <ContextMenuItem
                key={a.key}
                icon={ICONS[a.icon ?? "external"]}
                tone={a.intent === "destructive" ? "destructive" : "neutral"}
                hint={a.kind === "command" && a.confirm ? "asks first" : undefined}
                onSelect={() => onAction(a, target)}
              >
                {a.label}
              </ContextMenuItem>
            ))}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// Confirmation — server-authored, because only the server knows the casualties
// ---------------------------------------------------------------------------

export interface PendingCommand {
  action: Extract<ActionDescriptorWire, { kind: "command" }>;
  target: ActionTarget;
  /** the row's own name — the subject line under the served body */
  subject: string;
  traceId: string;
  workflowLabel: string;
}

/**
 * On the ds Dialog (which registers its own modal presence, so a persistent
 * `danger` toast steps aside and cannot intercept the confirm click). The
 * blast-radius copy is served with the descriptor — the client never writes a
 * confirmation message, because only the server knows how many rows are
 * involved.
 */
export function ConfirmCommandDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingCommand | null;
  onCancel: () => void;
  onConfirm: (pending: PendingCommand) => void;
}) {
  const confirm = pending?.action.confirm;
  return (
    <Dialog open={Boolean(pending && confirm)} onOpenChange={(open) => !open && onCancel()}>
      {pending && confirm && (
        <DialogContent
          size="sm"
          title={
            <span className={cn(dsText.title, "flex items-center gap-[var(--ds-space-base)]")}>
              <AlertTriangle
                aria-hidden
                className={cn(
                  dsIcon.lg,
                  "shrink-0",
                  confirm.tone === "destructive"
                    ? "text-[color:var(--ds-danger)]"
                    : "text-[color:var(--ds-status-waiting-fg)]",
                )}
              />
              {confirm.title}
            </span>
          }
          description={confirm.body}
        >
          <DialogBody className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
            {pending.workflowLabel} · {pending.traceId} · row rev {pending.action.expectedVersion}
          </DialogBody>
          <DialogFooter>
            {/* The safe exit is `secondary` and it comes FIRST; the surface's one
                committing action is last, so the eye ends on the verb. */}
            <Button variant="secondary" onClick={onCancel}>
              Keep it as it is
            </Button>
            <Button variant={confirm.tone === "destructive" ? "danger" : "primary"} onClick={() => onConfirm(pending)}>
              {confirm.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
