import { buildSettingsFacts } from "../queries/settings.js";
import { buildSettingsEditor } from "../queries/settings-editor.js";

import type { DashboardApp } from "./api-types.js";
import type { SettingsRouteDeps } from "./settings-types.js";

export function registerSettingsRoutes(app: DashboardApp, deps: SettingsRouteDeps): void {
  /**
   * D274 item 6 — System hosts + Workflow capabilities, read-only.
   *
   * GET-only by construction, and that remains the ruling: DCC3's separate
   * resolver-owned Settings editor does not make host/capability facts mutable.
   * Item 6's rejected option C was coupling these reads to the write family.
   */
  app.get("/api/v1/settings/facts", (c) => c.json(buildSettingsFacts(deps.settings)));

  // DCC3: values, provenance and editability are server-owned; this route has no mutation arm.
  app.get("/api/v1/settings/editable", (c) => c.json(buildSettingsEditor(deps.settingsEditor)));


}
