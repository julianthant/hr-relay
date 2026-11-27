import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronsUp,
  ClipboardList,
  PauseCircle,
  Pause,
  Play,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../../../lib/utils.js";
import { IconActionButton } from "./icon-action-button.js";
import {
  commandResultTitle,
  type CommandResultFeedEntry,
  intentPill,
  outcomeAction,
} from "./actions-model.js";
import {
  BareButton,
  ConfirmDialog,
  FailureNotice,
  Notice,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
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

type CommandAction = Extract<ActionDescriptorWire, { kind: "command" }>;

/** Every control calls this; a command resolves true only when its effect is confirmed. */
export type DashboardActionHandler = (action: ActionDescriptorWire, target: ActionTarget) => Promise<void | boolean> | void;

const NOOP_ACTION: DashboardActionHandler = () => {};

/** Pending ends when the command's reply arrives; this backstop ends it if no reply ever does. */
const PENDING_LIMIT_MS = 15_000;


/** A refused command toasts one line; its Priority notification item opens the run. */
export function CommandResultFeed({ results }: { results: readonly CommandResultFeedEntry[] }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  return <>{results.filter(entry => !dismissed.has(entry.id)).map(entry => entry.settlement.reason === "conflict"
    ? <Notice key={entry.id} tone="warning" title={commandResultTitle(entry)} />
    : <FailureNotice key={entry.id} sentence={commandResultTitle(entry)} onDismiss={() => setDismissed(current => new Set(current).add(entry.id))} />)}</>;
}

const ICONS: Record<ActionIconKey, ReactNode> = {
  pause: <Pause aria-hidden className={dsIcon.md} />,
  resume: <Play aria-hidden className={dsIcon.md} />,
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
  groupCount,
}: {
  actions: readonly ActionDescriptorWire[];
  target: ActionTarget;
  onAction?: DashboardActionHandler;
  onPreviewAction?: (action: 'retry' | 'delete') => void;
  /** A group or batch card: Pause and Stop act on every member still running. */
  groupCount?: number;
}) {
  const footer = actionsAt(actions, "footer");
  // Pending runs from press until the row's revision moves; a confirmed action has its own dialog.
  const [pressed, setPressed] = useState<{ key: string; version: number } | null>(null);
  useEffect(() => {
    if (pressed === null) return undefined;
    const timer = setTimeout(() => setPressed(null), PENDING_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [pressed]);
  // Pause and Resume show their opposite at once and keep it until the run's served control changes;
  // a refused or unconfirmed press restores the served control. A press on the shown opposite is kept
  // (`queued`) and sent once against the fresh served descriptor.
  const [flip, setFlip] = useState<{ runId: string; command: string; version: number; queued: boolean; confirmed: boolean } | null>(null);
  const servedToggle = footer.find((entry): entry is CommandAction => entry.kind === "command" && (entry.command === "pause" || entry.command === "resume"));
  const flipHolds = flip !== null && servedToggle !== undefined && flip.runId === target.runId
    && flip.command === servedToggle.command && flip.version === target.expectedVersion;
  useEffect(() => {
    // The queued press waits for the Pause's own confirmation: sending earlier would race its settlement.
    if (flip === null || flipHolds || !flip.confirmed) return;
    if (flip.runId === target.runId && flip.queued && servedToggle !== undefined && servedToggle.command !== flip.command) void onAction(servedToggle, target);
    setFlip(null);
  }, [flip, flipHolds, servedToggle, target, onAction]);
  if (footer.length === 0 && !onPreviewAction) return null;
  // No `Cancel group` caption beside the ✕: an icon that already means cancel,
  // captioned "cancel", is the same word twice; the warning lives in the ✕'s own `title`.
  return (
    <span className="flex items-center gap-[var(--ds-space-hair)]">
      {onPreviewAction && footer.length === 0 && <>
        <IconActionButton tone="muted" icon={<RotateCcw aria-hidden className={dsIcon.sm} />} label="Retry" onClick={event => { event.stopPropagation(); onPreviewAction('retry'); }} />
        <IconActionButton tone="destructive" icon={<Trash2 aria-hidden className={dsIcon.sm} />} label="Delete" onClick={event => { event.stopPropagation(); onPreviewAction('delete'); }} />
      </>}
      {footer.map((a) => {
        const toggle = a.kind === "command" && (a.command === "pause" || a.command === "resume");
        const isFlipped = toggle && flipHolds && a === servedToggle;
        // A press on the served opposite while the Pause is still unconfirmed is held too.
        const holdPress = isFlipped || toggle && flip !== null && !flip.confirmed && flip.runId === target.runId && a.command !== flip.command;
        const shown = isFlipped ? (a.key === "pause" ? { key: "resume", label: "Resume", icon: "resume" as const } : { key: "pause", label: "Pause", icon: "pause" as const })
          : { key: a.key, label: a.label, icon: a.icon };
        const label = groupCount === undefined ? shown.label
          : shown.key === "pause" ? `Pause all ${groupCount}` : a.key === CANCEL_TREE_KEY ? `Stop all ${groupCount}` : shown.label;
        return (
        <IconActionButton
          key={a.key}
          pending={pressed?.key === a.key && pressed.version === target.expectedVersion}
          tone={INTENT_TONE[a.intent]}
          icon={ICONS[shown.icon ?? "external"]}
          label={label}
          title={
            a.key === CANCEL_TREE_KEY && groupCount === undefined
              ? CANCEL_TREE_TITLE
              : a.kind === "command" && a.confirm
                ? `${label} — asks first`
                : label
          }
          onClick={(e) => {
            e.stopPropagation();
            const row = e.currentTarget.closest<HTMLElement>('[data-demo-row-id]')?.querySelector<HTMLElement>("[data-queue-open]") ?? null;
            if (holdPress) { setFlip(now => now === null ? now : { ...now, queued: true }); return; }
            const press = { key: a.key, runId: target.runId, version: target.expectedVersion };
            if (toggle) setFlip({ runId: press.runId, command: a.key, version: press.version, queued: false, confirmed: false });
            else if (a.kind === "command" && !a.confirm) setPressed({ key: a.key, version: target.expectedVersion });
            const settled = onAction(a, target);
            if (toggle) {
              // Only a confirmed command keeps the flip, until the stream serves the new control.
              const settle = (confirmed: unknown) => setFlip(now => now?.runId !== press.runId || now.version !== press.version ? now
                : confirmed === true ? { ...now, confirmed: true } : null);
              if (settled === undefined) settle(false);
              else void settled.then(settle, (cause: unknown) => { window.reportError(cause); settle(false); });
            } else if (a.kind === "command" && !a.confirm) {
              if (settled === undefined) setPressed(null);
              else void settled.catch((cause: unknown) => { window.reportError(cause); })
                .finally(() => setPressed(now => now?.key === press.key && now.version === press.version ? null : now));
            }
            if (a.kind === "command" && (a.command === "pause" || a.command === "resume")) row?.focus({ preventScroll: true });
          }}
        />
        );
      })}
    </span>
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
          void onAction(action, target);
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
        void onAction(action, target);
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
  const confirm = pending?.action.confirm;
  if (pending === null || confirm === undefined) return null;
  const destructive = confirm.tone === "destructive";
  const isDelete = pending.action.command === "delete";
  const group = pending.action.label === "Delete group";
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      destructive={destructive}
      title={`${confirm.title.replace(/\?+$/, "")}?`}
      description={confirm.body ?? (isDelete
        ? (group ? `Removes ${pending.subject}, its people and their logs from the queue.` : `Removes ${pending.subject} and its logs from the queue.`)
        : undefined)}
      confirmLabel={isDelete ? pending.action.label : confirm.confirmLabel}
      onConfirm={() => onConfirm(pending)}
      onCloseAutoFocus={(e) => {
        if (pending.triggerElement?.isConnected) {
          e.preventDefault();
          pending.triggerElement.focus();
        }
      }}
    />
  );
}
