import { useEffect, useState } from "react";
import { BodySection, FormGroup, ResultRow, Select, Switch } from "../../../ds/ui.js";
import { setFullAccessAllowed, useAssistantModelChoice, useFullAccessAllowed } from "../../shell/assistant-approval-model.js";
import { ASSISTANT_EFFORT_LABELS, AssistantModelPreferenceSchema, assistantModelLabel, type AssistantModelPreference } from "../../../../models/config/assistant-model-preference.js";
import { ChatGptAccountSettings } from "./chatgpt-account.js";

/** The model and effort the assistant uses: the served account's models, saved at once; a refused save leaves the value as it was. */
function AssistantModelRows() {
  const choice = useAssistantModelChoice();
  const [picked, setPicked] = useState<AssistantModelPreference>();
  useEffect(() => { setPicked(undefined); }, [choice?.preference]);
  const shown = picked ?? choice?.preference;
  const save = (next: AssistantModelPreference) => {
    if (choice === undefined) return;
    setPicked(next);
    void choice.choose(next).finally(() => setPicked(undefined));
  };
  const unavailable = choice === undefined || shown === undefined;
  return <>
    <div className="settings-compact-row" data-settings-path="assistant.model">
      <ResultRow label="Model" value={<Select aria-label="Model" value={shown?.slug ?? ""} disabled={unavailable}
        onChange={event => { if (shown !== undefined && event.target.value !== shown.slug) save({ slug: event.target.value, effort: shown.effort }); }}>
        {unavailable ? <option value="">Model unavailable</option> : choice.models.map(model => <option key={model.slug} value={model.slug}>{assistantModelLabel(model.slug)}</option>)}
      </Select>} />
    </div>
    <div className="settings-compact-row" data-settings-path="assistant.effort">
      <ResultRow label="Effort" value={<Select aria-label="Effort" value={shown?.effort ?? ""} disabled={unavailable}
        onChange={event => { const effort = AssistantModelPreferenceSchema.shape.effort.safeParse(event.target.value); if (shown !== undefined && effort.success && effort.data !== shown.effort) save({ slug: shown.slug, effort: effort.data }); }}>
        {unavailable && <option value="">Unavailable</option>}
        {Object.entries(ASSISTANT_EFFORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>} />
    </div>
  </>;
}

/** General > Assistant: the ChatGPT status, the model and effort, and Full access. */
export function AssistantSettings() {
  const fullAccess = useFullAccessAllowed();
  return <BodySection title="Assistant"><FormGroup label="Assistant">
    <ChatGptAccountSettings grouped />
    <AssistantModelRows />
    <div data-settings-path="assistant.fullAccess" className="settings-compact-row">
      <Switch name="assistant.fullAccess" label="Full access" description="Lets the assistant act without asking first." checked={fullAccess} onCheckedChange={setFullAccessAllowed} />
    </div>
  </FormGroup></BodySection>;
}
