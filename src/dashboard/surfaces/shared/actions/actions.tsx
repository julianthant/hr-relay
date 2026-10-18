import { useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
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
import { runDisplayId } from "../status/run-display-model.js";
import { cn } from "../../../lib/utils.js";
import { IconActionButton } from "./icon-action-button.js";
import {
  bannerPills,
  type CommandResultFeedEntry,
  intentPill,
  outcomeAction,
  parkResolutions,
} from "./actions-model.js";
import {
  BareButton,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  IconButton,
  dsBorder,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
} from "../../../ds/ui.js";
import {
  actionsAt,
  type ActionDescriptorWire,
  type ActionIconKey,
  type ActionIntent,
} from "../../../../models/dashboard/actions.js";

/** The object a run action */
export interface ActionTarget {
  runId: string;
  expectedVersion: number;
}

/** Every control calls this. */
export type DashboardActionHandler = (action: ActionDescriptorWire, target: ActionTarget) => void;

const NOOP_ACTION: DashboardActionHandler = () => {};

/** Persistent refusal context. It is a client-side feed of command
 * answers not a replacement for the durable audit trail */
export function CommandResultFeed({
  results,
  onDismiss,
  onRefreshRow,
}: {
  results: readonly CommandResultFeedEntry[];
  onDismiss: (id: string) => void;
  onRefreshRow: (entry: CommandResultFeedEntry) => void;
}) {
  if (results.length === 0) return null;
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-b bg-[var(--ds-recess-bg)]",
        dsBorder.subtle,
        "gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
      )}
      aria-live="polite"
      data-queue-command-result-feed=""
    >
      {results.map((entry) => {
        const conflict = entry.settlement.reason === "conflict";
        const tone = conflict
          ? {
            wrap: "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]",
            text: "text-[color:var(--ds-status-waiting-fg)]",
            icon: <AlertTriangle aria-hidden className={dsIcon.md} />,
            word: "Conflict",
          }
          : {
            wrap: "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
            text: "text-[color:var(--ds-danger)]",
            icon: <Ban aria-hidden className={dsIcon.md} />,
            word: "Rejected",
          };
        return (
          <div key={entry.id} className={cn("border px-[var(--ds-space-base)] py-[var(--ds-space-snug)]", dsRadius.md, tone.wrap)}>
            <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
              <span className={cn("inline-flex shrink-0", tone.text)}>{tone.icon}</span>
              <span className={cn(dsText.caps, "shrink-0", tone.text)}>{tone.word}</span>
              <span className={cn(dsText.body, "min-w-0 truncate font-semibold text-[color:var(--ds-fg)]")}>
                {entry.actionLabel} — {entry.subject}
              </span>
              <span className={cn(dsText.micro, dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-muted)]")}>
                {entry.actionLabel} · {entry.clock}
              </span>
              <IconButton
                size="sm"
                label="Dismiss this result"
                onClick={() => onDismiss(entry.id)}
                icon={<X aria-hidden className={dsIcon.sm} />}
              />
            </div>
            <p className={cn(dsText.meta, "mt-[var(--ds-space-hair)] pl-5 leading-relaxed text-[color:var(--ds-fg-muted)]")}>
              {entry.settlement.message}
            </p>
            {conflict ? (
              <div className="mt-[var(--ds-space-tight)] flex items-center gap-[var(--ds-space-base)] pl-5">
                <span className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-status-waiting-fg)]")}>
                  row rev {entry.expectedVersion} → server {entry.settlement.currentVersion}
                </span>
                <Button size="sm" variant="outline" onClick={() => onRefreshRow(entry)}>
                  Refresh this row
                </Button>
              </div>
            ) : (
              <p className={cn(dsText.micro, dsText.nums, "mt-[var(--ds-space-hair)] pl-5 text-[color:var(--ds-danger)]")}>
                code {(entry.settlement.reason === "rejected" ? entry.settlement.code : "confirmation-required")} · {entry.subject} · {entry.workflowLabel}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ICONS: Record<ActionIconKey, ReactNode> = {
  archive: undefined,
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

/** the pill shell and the placement folds live in `actions-model.ts` — see the note there */

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

// Footer — the queue row's own controls

/** The no-undo sentence, on the group cancel's own ✕. */
const CANCEL_TREE_KEY = "cancel-tree";
const CANCEL_TREE_TITLE =
  "Cancels this group, its delegated review and every member. Final — there is no undo.";

export function FooterActions({
  actions,
  target,
  onAction = NOOP_ACTION,
  onPreviewAction,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  onAction?: DashboardActionHandler;
  onPreviewAction?: (action: 'retry' | 'delete') => void;
}) {
  const footer = actionsAt(actions, "footer");
  if (footer.length === 0 && !onPreviewAction) return null;
  // No `Cancel group` caption beside the ✕: an icon that already means cancel,
  // captioned "cancel", is the same word twice; the warning lives in the ✕'s own `title`.
  return (
    <span className="flex items-center gap-[var(--ds-space-hair)]">
      {onPreviewAction && footer.length === 0 && <>
        <IconActionButton tone="muted" icon={<RotateCcw aria-hidden className={dsIcon.sm} />} label="Retry" onClick={event => { event.stopPropagation(); onPreviewAction('retry'); }} />
        <IconActionButton tone="destructive" icon={<Trash2 aria-hidden className={dsIcon.sm} />} label="Delete" onClick={event => { event.stopPropagation(); onPreviewAction('delete'); }} />
      </>}
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



export function DataActions({ actions, target, onAction = NOOP_ACTION }: { actions: readonly ActionDescriptorWire[]; target: ActionTarget; onAction?: DashboardActionHandler }) {
  return <div className="flex gap-[var(--ds-space-snug)]">{actionsAt(actions, "data").map((action) => <BareButton key={action.key} className={intentPill(action.intent, "md")} onClick={() => onAction(action, target)}>{action.label}</BareButton>)}</div>;
}

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
        <BareButton
          key={a.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction(a, target);
          }}
          className={intentPill(a.intent, "md")}
        >
          {a.label}
        </BareButton>
      ))}
    </div>
  );
}

/** Park resolution reports observed outcomes only; never resume or resubmit an unknown write. */
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
    // Measure the detail column, not viewport width; context rails change the space controls share.
    <div className="mt-[var(--ds-space-base)] grid gap-[var(--ds-space-snug)] @min-[35rem]:grid-cols-2">
      {options.map((a) => {
        const present = a.kind === "command" && a.command === "resolve-write-present";
        const Icon = present ? CheckCircle2 : CircleSlash;
        return (
          <BareButton
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
          </BareButton>
        );
      })}
    </div>
  );
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
  /** Suppress jumps to evidence already rendered by this surface. */
  omitKeys?: readonly string[];
}) {
  const action = outcomeAction(actions);
  if (!action || omitKeys?.includes(action.key)) return null;

  // Keep the review jump only where requested; queue rows already open their gate by selection.
  if (action.key === "open-gate") {
    return (
      <BareButton
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
      </BareButton>
    );
  }

  return (
    <BareButton
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAction(action, target);
      }}
      className={cn(intentPill(action.intent, "sm"), "font-sans", className)}
    >
      {action.label}
    </BareButton>
  );
}



export interface PendingCommand {
  action: Extract<ActionDescriptorWire, { kind: "command" }>;
  target: ActionTarget;
  /** the row's own name — the subject line under the served body */
  subject: string;
  traceId: string;
  workflowLabel: string;
  source?: "queue" | "run-detail" | undefined;
  commandId?: string | undefined;
  requestedAt?: string | undefined;
  triggerElement?: HTMLElement | null | undefined;
}

/** Use served blast-radius copy and modal presence so danger toasts cannot intercept confirmation. */
export function ConfirmCommandDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingCommand | null;
  onCancel: () => void;
  onConfirm: (pending: PendingCommand) => void;
}) {
  const safeAction = useRef<HTMLButtonElement>(null);
  const confirm = pending?.action.confirm;
  return (
    <Dialog open={Boolean(pending && confirm)} onOpenChange={(open) => !open && onCancel()}>
      {pending && confirm && (
        <DialogContent
          size="sm"
          className="command-confirm-dialog ui-theme-scope"
          onOpenAutoFocus={event => { event.preventDefault(); safeAction.current?.focus(); }}
          onCloseAutoFocus={(e) => {
            if (pending.triggerElement?.isConnected) {
              e.preventDefault();
              pending.triggerElement.focus();
            }
          }}
          title={
            // Use the dialog primitive’s title typography; nested title classes would create a different heading scale.
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
          <div className="command-confirm-target">
            <span className="text-caption text-ui-muted">Selected run</span>
            <strong className="text-heading font-medium text-ui-primary">{pending.subject}</strong>
            <span className="text-body text-ui-secondary">{pending.workflowLabel}</span>
            <span className="command-confirm-reference font-data text-caption text-ui-muted">{pending.action.command === "delete" ? runDisplayId(pending.target.runId, pending.traceId) : pending.traceId} · revision {pending.action.expectedVersion}</span>
          </div>
          <DialogFooter>
            {/* The safe exit is `secondary` and it comes FIRST; the surface's one
                committing action is last, so the eye ends on the verb. */}
            <Button ref={safeAction} variant="secondary" onClick={onCancel}>
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
