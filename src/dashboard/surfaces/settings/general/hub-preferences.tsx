import { BodySection, FormGroup, Switch } from "../../../ds/ui.js";
import { setFullAccessAllowed, useFullAccessAllowed } from "../../shell/assistant-approval-model.js";

/** The Assistant's permission settings, directly under the ChatGPT card in General. */
export function AssistantPermissionsSettings() {
  const fullAccess = useFullAccessAllowed();
  return <BodySection title="Permissions"><FormGroup label="Permissions">
    <div data-settings-path="assistant.fullAccess" className="settings-compact-row">
      <Switch name="assistant.fullAccess" label="Full access" description="Lets the assistant choose Full access in its approval menu. Off, every action waits for your confirmation." checked={fullAccess} onCheckedChange={setFullAccessAllowed} />
    </div>
  </FormGroup></BodySection>;
}
