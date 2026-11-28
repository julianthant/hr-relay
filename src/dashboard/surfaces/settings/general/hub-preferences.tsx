import { BodySection, FormGroup, ResultRow, Switch } from "../../../ds/ui.js";
import { usePersonPreferences } from "../../../lib/person-preferences.js";
import { ChatGptAccountSettings } from "./chatgpt-account.js";

/** General > Assistant: the ChatGPT status and Full access. */
export function AssistantSettings() {
  const { value, state, change } = usePersonPreferences();
  return <BodySection title="Assistant" description="ChatGPT sign-in and assistant permissions."><FormGroup label="Assistant">
    <ChatGptAccountSettings grouped />
    <div data-settings-path="assistant.fullAccess" className="settings-compact-row">
      {state === "ready" || state === "saving" ? <Switch name="preferences.assistantFullAccess" label="Full access" checked={value.assistantFullAccess} disabled={state !== "ready"}
        onCheckedChange={enabled => { void change?.({ "preferences.assistantFullAccess": { set: enabled } }); }} />
        : <ResultRow label="Full access" value={state === "loading" ? "Loading…" : "Unavailable"} />}
    </div>
  </FormGroup></BodySection>;
}
