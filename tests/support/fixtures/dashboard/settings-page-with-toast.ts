import { createElement } from "react";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings.js";

export function SettingsPageWithToast(props: Parameters<typeof SettingsPage>[0]) {
  return createElement(ToastProvider, null, createElement(SettingsPage, props));
}
