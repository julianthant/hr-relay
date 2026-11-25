import { BodySection, FormGroup, Switch } from "../../../ds/ui.js";
import { setFullAccessAllowed, useFullAccessAllowed } from "../../shell/assistant-approval-model.js";
import { ChatGptAccountSettings } from "./chatgpt-account.js";

/** General > Assistant: the ChatGPT status and Full access. */
export function AssistantSettings() {
  const fullAccess = useFullAccessAllowed();
  return <BodySection title="Assistant" description="ChatGPT sign-in and assistant permissions."><FormGroup label="Assistant">
    <ChatGptAccountSettings grouped />
    <div data-settings-path="assistant.fullAccess" className="settings-compact-row">
      <Switch name="assistant.fullAccess" label="Full access" checked={fullAccess} onCheckedChange={setFullAccessAllowed} />
    </div>
  </FormGroup></BodySection>;
}
