import { Tooltip } from "../../ds/ui.js";
import { AssistantMark } from "./assistant-mark.js";
import { assistantOpen, useAssistantNeedsYou, useAssistantMarkState, useAssistantOpen } from "./assistant-launcher-model.js";
import "./assistant-launcher.css";

/** The assistant button: the first icon of the queue header, a plain target at rest; any other state shows the Orbit mark in that state. */
export function AssistantLauncher() {
  const open = useAssistantOpen(), needs = useAssistantNeedsYou(), state = useAssistantMarkState();
  return <Tooltip content="Assistant" shortcut="⌘J" side="bottom">
    <button type="button" data-assistant-launcher className="assistant-launcher" aria-label={needs > 0 ? `Assistant, ${String(needs)} needs you` : "Assistant"} aria-expanded={open} aria-controls="hub-shell-assistant" onClick={() => assistantOpen.toggle()}>
      {state === "idle"
        ? <svg aria-hidden viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.75}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></svg>
        : <AssistantMark direction="orbit" state={state} />}
    </button>
  </Tooltip>;
}
