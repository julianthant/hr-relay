/**
 * The action vocabulary's pure half — the pill shell and the placement folds.
 *
 * It lives beside `actions.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { cn } from "../lib/utils.js";
import type { CommandSettlement } from "../app/command-result.js";
import {
  actionsAt,
  type ActionDescriptorWire,
  type ActionIntent,
} from "../../models/dashboard/actions.js";
import { dsFocus, dsMotion, dsRadius, dsText } from "../ds/ui.js";

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

/**
 * Ported verbatim from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `DemoActions.tsx:193-201`.
 *
 * The two write resolutions ride the `banner` placement like every other
 * decision pill, and they must NOT be drawn as one. They are the two exits from
 * `Write parked` — each is the operator reporting what they SAW in a system of
 * record — so they get the tinted cards below, with the server's `detail`
 * sentence, and the banner row never draws them. One placement, two renderers,
 * split by the command the server named.
 */
const PARK_COMMANDS: ReadonlySet<string> = new Set(["resolve-write-present", "resolve-write-absent"]);

function isParkCommand(action: ActionDescriptorWire): boolean {
  return action.kind === "command" && PARK_COMMANDS.has(action.command);
}

export function bannerPills(actions: readonly ActionDescriptorWire[]): readonly ActionDescriptorWire[] {
  return actionsAt(actions, "banner").filter((a) => !isParkCommand(a));
}

export function parkResolutions(actions: readonly ActionDescriptorWire[]): readonly ActionDescriptorWire[] {
  return actionsAt(actions, "banner").filter(isParkCommand);
}

export function outcomeAction(actions: readonly ActionDescriptorWire[]): ActionDescriptorWire | undefined {
  return actionsAt(actions, "outcome")[0];
}

/** A client-side receipt that a command was refused. The command result owns
 * the verdict and server sentence; the surface supplies only the context it
 * already showed when the operator pressed the control. */
export interface CommandResultFeedEntry {
  readonly id: string;
  readonly targetRunId: string;
  readonly expectedVersion: number;
  readonly subject: string;
  readonly workflowLabel: string;
  readonly actionLabel: string;
  readonly clock: string;
  readonly actorId: string;
  readonly settlement: Extract<CommandSettlement, { kind: "refused" }>;
}

export function commandResultFeedEntry(input: {
  readonly settlement: CommandSettlement;
  readonly targetRunId: string;
  readonly expectedVersion: number;
  /** The result's own durable identity. A replay deliberately replaces the
   * same feed card rather than looking like a second refusal. */
  readonly commandId: string;
  readonly subject: string;
  readonly workflowLabel: string;
  readonly actionLabel: string;
  readonly clock: string;
  readonly actorId: string;
}): CommandResultFeedEntry | undefined {
  if (input.settlement.kind === "applied") return undefined;
  return {
    id: input.commandId,
    targetRunId: input.targetRunId,
    expectedVersion: input.expectedVersion,
    subject: input.subject,
    workflowLabel: input.workflowLabel,
    actionLabel: input.actionLabel,
    clock: input.clock,
    actorId: input.actorId,
    settlement: input.settlement,
  };
}

/**
 * The applied half of D253's fold. It receives the SETTLEMENT, never a raw
 * command result, so a future refusal arm cannot fall through into an
 * affirmative toast.
 *
 * It lives here rather than in `actions.tsx` because a `.tsx` under `surfaces/`
 * exports components only (`dashboard-refresh-boundary`, ref
 * frontend-backend-integration §8.14): one exported helper makes the module
 * refuse a Fast Refresh update and the invalidation climbs to
 * `dashboard-app.tsx`, remounting the app on every save.
 *
 * A non-applied settlement THROWS rather than returning quietly. Its one caller
 * reports refusals and returns before reaching this, so the other arm is
 * unreachable by construction — and a fold that silently does nothing when the
 * command was in fact refused is how "nothing was recorded" comes to look
 * exactly like "it worked", which is the one outcome this program may never
 * blur. Its sibling `commandResultFeedEntry` returns `undefined` for the
 * opposite arm on purpose: absence there means "nothing to file", which the
 * caller checks.
 */
export function toastAppliedCommandResult(
  toast: (input: { tone: "success"; title: string; description: string }) => string,
  input: {
    readonly settlement: CommandSettlement;
    readonly actionLabel: string;
    readonly command?: Extract<ActionDescriptorWire, { kind: "command" }>["command"];
    readonly subject: string;
    readonly clock: string;
    readonly actorId: string;
  },
): void {
  if (input.settlement.kind !== "applied") {
    throw new Error(
      `an applied-command toast was composed for a ${input.settlement.kind} settlement `
      + `of ${input.actionLabel} on ${input.subject}`,
    );
  }
  toast({
    tone: "success",
    title: input.command === "archive" ? "Run archived" : input.actionLabel,
    description: `${input.subject} · ${input.clock} · ${input.actorId}`,
  });
}
