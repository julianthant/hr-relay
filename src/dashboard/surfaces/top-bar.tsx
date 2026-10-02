import { memo } from "react";
import type { DemoTheme } from "../ds/ui.js";
import type { NavControls } from "./navigation-controls.js";
import { NAVBAR_SAMPLE } from "./navbar/navbar-fixture.js";
import { NavbarView } from "./navbar/navbar-view.js";
import { NotificationBell } from "./notification-bell.js";
import type { ShellView, ShellViewSelection } from "./top-bar-model.js";

function previewRun(): void {}

export const TopBar = memo(function TopBar({ view, onView, nav, theme, onToggleTheme, settingsOpen, onOpenSettings }: {
  view: ShellViewSelection; onView: (view: ShellView) => void; nav: NavControls;
  theme: DemoTheme; onToggleTheme: () => void; settingsOpen: boolean; onOpenSettings: () => void;
}) {
  return <NavbarView data={NAVBAR_SAMPLE} view={view} onView={onView} nav={nav} theme={theme} onToggleTheme={onToggleTheme} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} onResult={previewRun} notifications={<NotificationBell />} />;
});
