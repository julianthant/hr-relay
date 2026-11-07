import { useContext } from "react";
import { Field, Input } from "../../../ds/ui.js";
import { HubPreferencesPreviewContext, useHubPreferences } from "./hub-preferences-model.js";

export function HubBrowserWindowSettings({ binding }: { binding?: { width: string; height: string; disabled: boolean; error?: string; onChange: (path: "display.screenWidth" | "display.screenHeight", value: string) => void } }) {
  const preferences = useHubPreferences();
  const preview = useContext(HubPreferencesPreviewContext);
  return <div className="settings-compact-row" data-source={preview ? preferences.source : binding ? "served" : "unavailable"} data-settings-path="browser.window">
    <Field orientation="horizontal" label="Browser window" error={binding?.error} description={preview || binding ? "Size used when Relay opens a browser." : "Browser dimensions are unavailable from the current settings authority."}><div className="hub-window-size" data-settings-path={!preview && binding ? "display.screenWidth" : undefined}>
      <Input disabled={preview ? false : !binding || binding.disabled} name="display.screenWidth" aria-label="Browser window width" type="number" min={1} value={!preview && binding ? binding.width : preferences.value.width} onChange={event => { if (!preview && binding) binding.onChange("display.screenWidth", event.target.value); else preferences.change({ ...preferences.value, width: event.target.value }); }} />
      <span aria-hidden>×</span><Input disabled={preview ? false : !binding || binding.disabled} name="display.screenHeight" aria-label="Browser window height" type="number" min={1} value={!preview && binding ? binding.height : preferences.value.height} onChange={event => { if (!preview && binding) binding.onChange("display.screenHeight", event.target.value); else preferences.change({ ...preferences.value, height: event.target.value }); }} />
    </div></Field>
  </div>;
}
