import { buildSettingsFacts } from "../queries/settings.js";
import { buildSettingsEditor } from "../queries/settings-editor.js";

import type { DashboardApp } from "./api-types.js";
import type { SettingsRouteDeps } from "./settings-types.js";
import { StorageRelocationPlanViewSchema } from "../../../domain/commands.js";

export function registerSettingsRoutes(app: DashboardApp, deps: SettingsRouteDeps): void {
  /**
   * GET-only compatibility facts and Workflow capabilities. The System hosts
   * Settings page is retired; this wire remains read-only for existing consumers.
   */
  app.get("/api/v1/settings/facts", (c) => c.json(buildSettingsFacts(deps.settings)));

  // DCC3: values, provenance and editability are server-owned; this route has no mutation arm.
  app.get("/api/v1/settings/editable", (c) => c.json(buildSettingsEditor(deps.settingsEditor)));

  app.get("/api/v1/settings/storage-relocation", (c) => {
    if (deps.storageRelocationPlans === undefined) return c.json({ state: "error", code: "STORAGE_RELOCATION_UNAVAILABLE", message: "Storage relocation plan reader is unavailable", retryable: false }, 503);
    return c.json(StorageRelocationPlanViewSchema.parse(deps.storageRelocationPlans.read()));
  });


}
