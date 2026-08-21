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
 * Port scope: the run-action renderers (footer, banner, park resolutions,
 * outcome, context menu) and the server-authored confirm dialog, typed against
 * the rebuild's `ActionDescriptorWire`. Still deferred with its surface:
 * `CommandResultFeed` + `toastAppliedCommandResult`. The reason they were once deferred on —
 * "until the app's real `CommandResult` wiring" — is spent: `settleCommandResult` (D253) is that
 * wiring, live since 2026-08-20, and all nine command-issuing surfaces settle through it. The
 * applied-result feed is ABSENT pending the operator's ruling on whether it is built at all
 * (`03a-finish-the-dashboard.md` OPEN question 24, ledger 2 B195/B196); the REFUSAL half is
 * already live and raises its own persistent toast from `park-resolve.tsx`.
 *
 * `ParkResolutions` and the park command split were deferred here on the claim
 * that "no park commands exist in the Phase-1 action vocabulary". That claim is
 * FALSE and was corrected by the R8 audit
 * (`docs/plans/2026-08-13-detail-fidelity-audit.md`, finding 1): the
 * `parked-write` section projects both resolutions with their `detail`
 * sentences (`src/server/dashboard/queries/run-detail.ts:516-551`) and they
 * reach the wire at `src/domain/dashboard/actions.ts`. They had simply been
 * rendering as bare banner pills, dropping the served `detail` on the floor.
 */
import { Fragment, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronsUp,
  CircleSlash,
  ClipboardList,
  PauseCircle,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconActionButton } from "./icon-action-button.js";
import {
  bannerPills,
  intentPill,
  outcomeAction,
  parkResolutions,
} from "./actions-model.js";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
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

/* the pill shell and the placement folds live in `actions-model.ts` — see the note there */

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
  const pills = bannerPills(actions);
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

/**
 * Ported verbatim from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `DemoActions.tsx:225-280`.
 *
 * The only two exits from Write parked. Both are the operator reporting what
 * they SAW in the system of record — neither one re-submits anything. There is
 * no Resume here because the contract never sends one: resuming an unknown
 * write is how you terminate somebody twice.
 *
 * The `detail` sentence is SERVED (`run-detail.ts:516-551`) and is the whole
 * reason these are cards rather than pills: a pill can carry a verb, and the
 * thing that separates these two verbs is a sentence about what each one
 * unlocks.
 */
export function ParkResolutions({
  actions,
  target,
  onAction = NOOP_ACTION,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  onAction?: DashboardActionHandler;
}) {
  const options = parkResolutions(actions);
  if (options.length === 0) return null;
  return (
    // A CONTAINER query: these render inside the gate banner and inside the log
    // stream, both of which live in the detail region's CENTRE column — whose
    // width is a function of the context rail's state as well as the window's.
    // Keyed to the window, two resolutions were being forced side-by-side into
    // a 414px column at a 1280px viewport.
    <div className="mt-[var(--ds-space-base)] grid gap-[var(--ds-space-snug)] @min-[35rem]:grid-cols-2">
      {options.map((a) => {
        const present = a.kind === "command" && a.command === "resolve-write-present";
        const Icon = present ? CheckCircle2 : CircleSlash;
        return (
          <button
            key={a.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction(a, target);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-start border text-left",
              "gap-[var(--ds-space-hair)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)]",
              dsRadius.md,
              dsFocus,
              dsMotion.fast,
              "hover:brightness-125",
              present
                ? "border-[color:var(--ds-success-border)] bg-[var(--ds-success-bg)]"
                : "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
            )}
          >
            <span
              className={cn(
                dsText.body,
                "inline-flex items-center gap-[var(--ds-space-snug)] font-semibold",
                present ? "text-[color:var(--ds-success-fg)]" : "text-[color:var(--ds-danger)]",
              )}
            >
              <Icon aria-hidden className={dsIcon.sm} />
              {a.label}
            </span>
            {a.detail !== undefined && (
              <span className={cn(dsText.meta, "leading-snug text-[color:var(--ds-fg-muted)]")}>{a.detail}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome — the ONE thing to do about this row
// ---------------------------------------------------------------------------

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
            // The layout only — NO second type class. `DialogPrimitive.Title`
            // already carries `dsText.section`, and nesting `dsText.title`
            // inside it made this the one dialog in the product whose title was
            // a different size from every other dialog's (R8 finding 15).
            <span className="flex items-center gap-[var(--ds-space-base)]">
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
          {/*
            THE SUBJECT LINE, in the demo's own placement
            (`DemoActions.tsx:487-489`): a bare div, NOT `DialogBody`. Two
            reasons it matters. `DialogBody` is the scrolling pane with the
            dialog's full inset — this is one quiet line of identity under a
            served body, and giving it the pane's padding made it read as the
            dialog's content rather than its footnote (R8 finding 15).

            And it now renders `subject` — the row's OWN name, which this
            component has documented on `PendingCommand` since it was written
            and has never once drawn (R8 finding 4b). The confirm body is
            server-authored and says what the command will DO; without the
            subject the operator is asked to confirm a blast radius without
            being shown the thing it lands on.
          */}
          <div className={cn(dsText.meta, "px-[var(--ds-space-loose)] pt-[var(--ds-space-cozy)] text-[color:var(--ds-fg-muted)]")}>
            <span className="font-medium text-[color:var(--ds-fg-secondary)]">{pending.subject}</span>
            <span className={cn(dsText.nums, "ml-[var(--ds-space-snug)]")}>
              {pending.workflowLabel} · {pending.traceId} · row rev {pending.action.expectedVersion}
            </span>
          </div>
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
