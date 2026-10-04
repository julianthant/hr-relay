import { BodySection, FormGroup, Switch, type DemoTheme } from "../ds/ui.js";

export function AppearanceSettings({ theme, onToggleTheme }: { theme: DemoTheme; onToggleTheme: () => void }) {
  return <BodySection title="Appearance"><FormGroup label="Appearance"><div className="settings-compact-row">
    <Switch label="Dark theme" description="Dashboard appearance on this browser." checked={theme === "dark"} onCheckedChange={onToggleTheme} />
  </div></FormGroup></BodySection>;
}
