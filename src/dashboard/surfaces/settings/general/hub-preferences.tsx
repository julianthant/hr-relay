import { useContext, useRef, useState } from "react";
import { Check, Hand } from "lucide-react";
import { Field, FormGroup, Input, Popover, PopoverContent, PopoverTrigger } from "../../../ds/ui.js";
import { HUB_APPROVAL_MODES, HubPreferencesPreviewContext, useHubPreferences } from "./hub-preferences-model.js";

export function HubPermissionSettings() {
  const preferences = useHubPreferences();
  const preview = useContext(HubPreferencesPreviewContext);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <FormGroup label="Assistant permission"><div className="hub-settings-row" data-source={preview ? preferences.source : "unavailable"} data-settings-path="assistant.permission">
    <div className="hub-row-label">Assistant permission<span className="hub-row-note">{preview ? "Choose when Relay asks before taking an action." : "Unavailable until the server provides approval policy."}</span></div>
    <div className="hub-setting-control"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button tabIndex={0} ref={trigger} type="button" disabled={!preview} className="hub-btn" aria-haspopup="menu" aria-expanded={open}>{preferences.value.permission}<span aria-hidden>⌄</span></button></PopoverTrigger>
      <PopoverContent title="Assistant permission" hideTitle hideClose className="hub-permission-menu" align="end" side="bottom" width="lg"><div role="menu" aria-label="How should Relay actions be approved?" onKeyDown={event => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const index = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      }}><p>Assistant permission</p>{HUB_APPROVAL_MODES.map(mode => <button tabIndex={0} type="button" key={mode.label} role="menuitemradio" aria-checked={mode.label === preferences.value.permission} onClick={() => { preferences.change({ ...preferences.value, permission: mode.label }); setOpen(false); trigger.current?.focus(); }}><Hand aria-hidden /><span>{mode.label}<small>{mode.description}</small></span>{mode.label === preferences.value.permission && <Check aria-hidden />}</button>)}</div></PopoverContent>
    </Popover></div></div></FormGroup>;
}

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
