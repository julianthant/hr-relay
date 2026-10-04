import { memo } from "react";
import type { DemoTheme } from "../ds/ui.js";
import type { NavControls } from "./navigation-controls.js";
import { NAVBAR_SAMPLE } from "./navbar/navbar-fixture.js";
import { NavbarView } from "./navbar/navbar-view.js";
import { NotificationBell } from "./notification-bell.js";

function previewRun(): void {}

export const TopBar = memo(function TopBar({ onDashboard, nav, theme, onToggleTheme, settingsOpen, onOpenSettings }: {
  onDashboard: () => void; nav: NavControls;
  theme: DemoTheme; onToggleTheme: () => void; settingsOpen: boolean; onOpenSettings: () => void;
}) {
  return <NavbarView data={NAVBAR_SAMPLE} onDashboard={onDashboard} nav={nav} theme={theme} onToggleTheme={onToggleTheme} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} onResult={previewRun} notifications={<NotificationBell />} />;
});
