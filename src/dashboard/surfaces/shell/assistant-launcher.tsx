import { Tooltip } from "../../ds/ui.js";
import { AssistantMark } from "./assistant-mark.js";
import { assistantNeedsYou, assistantOpen, useAssistantMarkState, useAssistantOpen } from "./assistant-launcher-model.js";
import "./assistant-launcher.css";

/** The assistant button at the bottom right: the Orbit mark and `Ask` in a 28px control inside a 46px card, icon only below 1100px; the mark's state says replying, needs you, done or error. */
export function AssistantLauncher() {
  const open = useAssistantOpen(), needs = assistantNeedsYou(), state = useAssistantMarkState();
  return <div className="assistant-launcher-card">
    <Tooltip content="Assistant" shortcut="⌘J" side="top">
      <button type="button" data-assistant-launcher className="assistant-launcher" aria-label={needs > 0 ? `Assistant, ${String(needs)} needs you` : "Assistant"} aria-expanded={open} aria-controls="hub-shell-assistant" onClick={() => assistantOpen.toggle()}>
        <AssistantMark direction="orbit" state={state} /><span className="assistant-launcher-text">Ask</span>
      </button>
    </Tooltip>
  </div>;
}
