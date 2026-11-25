import { Tooltip } from "../../ds/ui.js";
import { AssistantMark } from "./assistant-mark.js";
import { assistantOpen, useAssistantNeedsYou, useAssistantMarkState, useAssistantOpen } from "./assistant-launcher-model.js";
import "./assistant-launcher.css";

/** The assistant button: the Orbit mark as the first icon of the queue header; the mark's state says replying, needs you, done or error. */
export function AssistantLauncher() {
  const open = useAssistantOpen(), needs = useAssistantNeedsYou(), state = useAssistantMarkState();
  return <Tooltip content="Assistant" shortcut="⌘J" side="bottom">
    <button type="button" data-assistant-launcher className="assistant-launcher" aria-label={needs > 0 ? `Assistant, ${String(needs)} needs you` : "Assistant"} aria-expanded={open} aria-controls="hub-shell-assistant" onClick={() => assistantOpen.toggle()}>
      <AssistantMark direction="orbit" state={state} />
    </button>
  </Tooltip>;
}
