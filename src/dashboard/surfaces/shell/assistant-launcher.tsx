import { Tooltip } from "../../ds/ui.js";
import { assistantNeedsYou, assistantOpen, useAssistantOpen } from "./assistant-launcher-model.js";
import "./assistant-launcher.css";

/** A 16px spark mark. */
function SparkMark() {
  return <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.2c.5 3.2 2.6 5.3 5.8 5.8-3.2.5-5.3 2.6-5.8 5.8-.5-3.2-2.6-5.3-5.8-5.8C5.4 7.5 7.5 5.4 8 2.2Z" />
  </svg>;
}

/** The standalone assistant button at the bottom right: `Ask Relay` with the spark, icon only below 1100px; a dot says something needs you. */
export function AssistantLauncher() {
  const open = useAssistantOpen(), needs = assistantNeedsYou();
  return <Tooltip content="Assistant" shortcut="⌘J" side="top">
    <button type="button" data-assistant-launcher className="assistant-launcher" aria-label={needs > 0 ? `Assistant, ${String(needs)} needs you` : "Assistant"} aria-expanded={open} aria-controls="hub-shell-assistant" onClick={() => assistantOpen.toggle()}>
      <SparkMark /><span className="assistant-launcher-text">Ask Relay</span>{needs > 0 && <span aria-hidden className="assistant-launcher-dot" />}
    </button>
  </Tooltip>;
}
