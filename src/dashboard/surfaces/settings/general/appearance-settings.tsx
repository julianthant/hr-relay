import { BodySection, FormGroup, Switch, type DemoTheme } from "../../../ds/ui.js";
import { useHubMotion } from "../../../ds/theme/motion.js";

export function AppearanceSettings({ theme, onToggleTheme }: { theme: DemoTheme; onToggleTheme: () => void }) {
  const motion = useHubMotion();
  return <BodySection title="Appearance"><FormGroup label="Appearance"><div data-settings-path="appearance.theme" className="settings-compact-row">
    <Switch name="appearance.theme" label="Dark theme" description="Dashboard appearance on this browser." checked={theme === "dark"} onCheckedChange={onToggleTheme} />
  </div><div data-settings-path="appearance.animations" className="settings-compact-row">
    <Switch name="appearance.animations" label="Animations" description="Subtle motion. Your reduced-motion preference takes priority." checked={motion.enabled} onCheckedChange={motion.change} />
    {motion.problem && <p role="status">{motion.problem}</p>}
  </div></FormGroup></BodySection>;
}
