import { ResultRow, SegmentedChoice, Switch, type DemoTheme } from "../../../ds/ui.js";
import { usePersonPreferences } from "../../../lib/person-preferences.js";
import { useHubMotion } from "../../../ds/theme/motion.js";

export function AppearanceSettings({ theme, onToggleTheme }: { theme: DemoTheme; onToggleTheme: () => void }) {
  const motion = useHubMotion();
  const preferences = usePersonPreferences();
  const notice = preferences.state === "saving" ? "Saving appearance preferences."
    : preferences.state === "loading" ? "Loading appearance preferences."
    : preferences.state === "signed-out" ? "Sign in to save appearance preferences." : "Appearance changes are unavailable.";
  const disabled = preferences.state !== "ready";
  return <>
    <div data-settings-path="appearance.theme" className="settings-compact-row">
      <ResultRow label="Theme" value={<SegmentedChoice hideLabel label="Theme" value={theme} disabled={disabled} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={next => { if (next !== theme) onToggleTheme(); }} />} />
    </div>
    <div data-settings-path="appearance.animations" className="settings-compact-row">
      <Switch name="appearance.animations" label="Animations" disabled={disabled} checked={motion.enabled} onCheckedChange={motion.change} />
    </div>
    {(disabled || motion.problem !== undefined) && <p role="status">{motion.problem ?? notice}</p>}
  </>;
}
