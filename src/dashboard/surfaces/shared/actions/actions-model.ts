/** The action vocabulary's pure half — the pill shell and the placement folds. */
import { cn } from "../../../lib/utils.js";
import type { CommandSettlement } from "../../../app/commands/command-result.js";
import {
  actionsAt,
  type ActionDescriptorWire,
  type ActionIntent,
} from "../../../../models/dashboard/actions.js";
import { dsFocus, dsMotion, dsRadius, dsText } from "../../../ds/ui.js";

/** The wire's seven intents, as colour only. These are NOT `Button` variants
 * a descriptor's intent is chosen by the server for a command, and mapping four */
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

/** ONE shell for every intent pill: the banner and the inline outcome button
 * share one height, padding and font size */
export const intentPill = (intent: ActionIntent, size: "sm" | "md"): string =>
  cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap border",
    size === "sm"
      ? "h-[var(--ds-h-xs)] gap-[var(--ds-space-tight)] px-[var(--ds-space-base)]"
      : "h-[var(--ds-h-sm)] gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)]",
    // The INLINE pill drops its outline: it sits among chips that are a fill and no line.
    // fill and no line, and an extra edge would outweigh the row's own status.
    size === "sm" && "border-transparent",
    dsRadius.md,
    size === "sm" ? dsText.meta : dsText.body,
    dsFocus,
    dsMotion.fast,
    "active:translate-y-px",
    INTENT_PILL[intent],
  );

const PARK_COMMANDS: ReadonlySet<string> = new Set(["recheck-write", "resolve-write-absent"]);

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

/** A client-side receipt that a command was refused. The
 * command result owns the verdict and server sentence */
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

/** The applied half of the settlement fold. */
export function toastAppliedCommandResult(
  toast: (input: { tone: "success"; title: string; description: string }) => string,
  input: {
    readonly settlement: CommandSettlement;
    readonly actionLabel: string;
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
    title: input.actionLabel,
    description: `${input.subject} · ${input.clock}`,
  });
}
