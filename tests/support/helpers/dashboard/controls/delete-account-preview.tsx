import { useState } from "react";
import { useDemoTheme } from "../../../../../src/dashboard/ds/ui.js";
import { DeleteAccountControl } from "../../../../../src/dashboard/surfaces/settings/general/ui-settings-records-general-paths.js";
import { AppearanceSettings } from "../../../../../src/dashboard/surfaces/settings/general/appearance-settings.js";
import { SettingsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const { theme, toggleTheme } = useDemoTheme();
  const [deleting, setDeleting] = useState(false);
  const state = new URLSearchParams(location.search).get("state");
  return <SettingsSurface section="General"><AppearanceSettings theme={theme} onToggleTheme={toggleTheme} /><DeleteAccountControl presentation={deleting || state === "deleting" ? { state: "deleting", personName: "Alex Morgan" } : state === "unavailable" ? { state: "unavailable" } : { state: "ready", personName: "Alex Morgan", onConfirm: () => setDeleting(true) }} /></SettingsSurface>;
}
