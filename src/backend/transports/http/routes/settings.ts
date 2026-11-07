import { buildSettingsEditor } from "../../../runs/queries/settings-editor.js";
import { buildSettingsFacts } from "../../../runs/queries/settings.js";

import { NativePathPickerRequestSchema,NativePathPickerResponseSchema } from "../../../../models/dashboard/native-path-picker.js";
import { InvalidNativePickerHintError } from "../native-path-picker.js";
import type { DashboardApp } from "./api-types.js";
import { wireError } from "./failure-status.js";
import type { SettingsRouteDeps } from "./settings-types.js";

export function registerSettingsRoutes(app: DashboardApp, deps: SettingsRouteDeps): void {
  // Compatibility facts and workflow capabilities are read-only.
  app.get("/api/v1/settings/facts", (c) => c.json(buildSettingsFacts(deps.settings)));

  // values, provenance and editability are server-owned; this route has no mutation arm.
  app.get("/api/v1/settings/editable", (c) => c.json(buildSettingsEditor(deps.settingsEditor)));

  app.post("/api/v1/settings/path-picker", async (c) => {
    const request = NativePathPickerRequestSchema.parse(await c.req.json());
    if (deps.nativePathPicker === undefined) return c.json(NativePathPickerResponseSchema.parse({ state: "unavailable",
      field: request.field, reason: "dialog-failed" }), 503);
    try {
      const response = NativePathPickerResponseSchema.parse(await deps.nativePathPicker.pick(request, c.req.raw.signal));
      return c.json(response, response.state === "unavailable" ? response.reason === "busy" ? 409 : 503 : 200);
    } catch (error) {
      if (error instanceof InvalidNativePickerHintError) return c.json(wireError("NATIVE_PATH_HINT_INVALID", error.message, false), 400);
      throw error;
    }
  });
}
