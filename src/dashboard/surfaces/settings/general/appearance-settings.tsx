import { BodySection, FormGroup, Switch, type DemoTheme } from "../../../ds/ui.js";
import { usePersonPreferences } from "../../../lib/person-preferences.js";
import { useHubMotion } from "../../../ds/theme/motion.js";

export function AppearanceSettings({ theme, onToggleTheme, personName }: { theme: DemoTheme; onToggleTheme: () => void; personName?: string }) {
  const motion = useHubMotion();
  const preferences = usePersonPreferences();
  const savedFor = preferences.state === "ready" ? personName : undefined;
  const notice = preferences.state === "saving" ? "Saving appearance preferences."
    : preferences.state === "loading" ? "Loading appearance preferences."
    : preferences.state === "signed-out" ? "Sign in to save appearance preferences." : "Appearance changes are unavailable.";
  return <BodySection title="Appearance"><FormGroup label="Appearance"><div data-settings-path="appearance.theme" className="settings-compact-row">
    <Switch name="appearance.theme" label="Dark theme" description={savedFor ? `Saved for ${savedFor} on this Mac.` : notice} disabled={preferences.state !== "ready"} checked={theme === "dark"} onCheckedChange={onToggleTheme} />
  </div><div data-settings-path="appearance.animations" className="settings-compact-row">
    <Switch name="appearance.animations" label="Animations" description={`${savedFor ? `Saved for ${savedFor}.` : notice} Your reduced-motion preference takes priority.`} disabled={preferences.state !== "ready"} checked={motion.enabled} onCheckedChange={motion.change} />
    {motion.problem && <p role="status">{motion.problem}</p>}
  </div></FormGroup></BodySection>;
}
