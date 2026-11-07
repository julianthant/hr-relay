import { Moon, Sun } from "lucide-react";
import { BodySection, Button, FormGroup, ResultRow, Switch, dsIcon, type DemoTheme } from "../../../ds/ui.js";
import { usePersonPreferences } from "../../../lib/person-preferences.js";
import { useHubMotion } from "../../../ds/theme/motion.js";

export function AppearanceSettings({ theme, onToggleTheme }: { theme: DemoTheme; onToggleTheme: () => void }) {
  const motion = useHubMotion();
  const preferences = usePersonPreferences();
  const notice = preferences.state === "saving" ? "Saving appearance preferences."
    : preferences.state === "loading" ? "Loading appearance preferences."
    : preferences.state === "signed-out" ? "Sign in to save appearance preferences." : "Appearance changes are unavailable.";
  return <BodySection title="Appearance"><FormGroup label="Appearance"><div data-settings-path="appearance.theme" className="settings-compact-row">
    <ResultRow label="Theme" value={<Button variant="secondary" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} disabled={preferences.state !== "ready"} onClick={onToggleTheme}
      icon={theme === "dark" ? <Moon aria-hidden className={dsIcon.md} /> : <Sun aria-hidden className={dsIcon.md} />}>
      {theme === "dark" ? "Dark" : "Light"}
    </Button>} />
  </div><div data-settings-path="appearance.animations" className="settings-compact-row">
    <Switch name="appearance.animations" label="Animations" disabled={preferences.state !== "ready"} checked={motion.enabled} onCheckedChange={motion.change} />
  </div></FormGroup>
    {(preferences.state !== "ready" || motion.problem !== undefined) && <p role="status">{motion.problem ?? notice}</p>}
  </BodySection>;
}
