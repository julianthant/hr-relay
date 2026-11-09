import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Tooltip } from "../../ds/ui.js";
import { assistantNeedsYou, assistantOpen, useAssistantOpen, type Launcher } from "./assistant-launcher-model.js";
import "./assistant-launcher.css";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** One simple 16px mark per option: a spark (A), a speech bubble (B) and a lens (C). */
export function LauncherMark({ launcher }: { launcher: Launcher }) {
  return <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" {...stroke}>
    {launcher === "a" ? <path d="M8 2.2c.5 3.2 2.6 5.3 5.8 5.8-3.2.5-5.3 2.6-5.8 5.8-.5-3.2-2.6-5.3-5.8-5.8C5.4 7.5 7.5 5.4 8 2.2Z" />
      : launcher === "b" ? <path d="M2.5 7.6a5.1 4.7 0 0 1 5.1-4.7h.8a5.1 4.7 0 0 1 5.1 4.7 5.1 4.7 0 0 1-5.1 4.7H5.2L2.7 13.8l.4-2.8a4.7 4.7 0 0 1-.6-3.4Z" />
      : <><circle cx="8" cy="8" r="5.500" /><circle cx="8" cy="8" r="1.700" fill="currentColor" stroke="none" /></>}
  </svg>;
}

const NEEDS = "needs you";
function needsLabel(count: number) { return count > 0 ? `, ${String(count)} ${NEEDS}` : ""; }

function toggle() { assistantOpen.toggle(); }

/** A: a 28px icon button beside the Sessions pill; a small dot says something needs you. */
export function AssistantIconLauncher() {
  const open = useAssistantOpen(), needs = assistantNeedsYou();
  return <Tooltip content="Assistant" shortcut="⌘J" side="top">
    <button type="button" data-assistant-launcher className="dock-surface dock-icon" aria-label={`Assistant${needsLabel(needs)}`} aria-expanded={open} aria-controls="hub-shell-assistant" onClick={toggle}>
      <LauncherMark launcher="a" />{needs > 0 && <span aria-hidden className="dock-dot" />}
    </button>
  </Tooltip>;
}

/** B: the Ask Relay field in the dock; focusing it opens the panel with the cursor in its composer. */
export function AssistantDockField() {
  const open = useAssistantOpen(), needs = assistantNeedsYou();
  return <Tooltip content="Ask Relay" shortcut="⌘J" side="top">
    <button type="button" data-assistant-launcher className="dock-field" aria-label={`Ask Relay${needsLabel(needs)}`} aria-expanded={open} aria-controls="hub-shell-assistant" onClick={() => { assistantOpen.set(true); queueMicrotask(() => document.querySelector<HTMLElement>("#hub-shell-assistant [role=textbox], #hub-shell-assistant textarea")?.focus()); }}>
      <LauncherMark launcher="b" /><span className="dock-field-text">Ask Relay…</span>{needs > 0 && <span aria-hidden className="dock-dot dock-dot-inline" />}
    </button>
  </Tooltip>;
}

/** C: an Assistant button at the right end of the queue toolbar; needs-you is a count chip. */
export function AssistantToolbarButton() {
  const open = useAssistantOpen(), needs = assistantNeedsYou();
  return <Tooltip content="Assistant" shortcut="⌘J" side="bottom">
    <button type="button" data-assistant-launcher className="toolbar-assistant" aria-label={`Assistant${needsLabel(needs)}`} aria-pressed={open} aria-controls="hub-shell-assistant" onClick={toggle}>
      <LauncherMark launcher="c" /><span className="toolbar-assistant-text">Assistant</span>{needs > 0 && <span aria-hidden className="toolbar-assistant-chip">{needs}</span>}
    </button>
  </Tooltip>;
}

export function DockSlot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("dock-row", className)}>{children}</div>;
}
