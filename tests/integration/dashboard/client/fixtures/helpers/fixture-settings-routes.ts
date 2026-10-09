import { Hono } from "hono";
import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS,FIXTURE_STORAGE_RELOCATION } from "../../../../../support/fixtures/dashboard/fixture-settings.js";
export function registerFixtureSettingsRoutes({ app }: { app: Hono }): void {


  /**
   * The Settings takeover's two read-only status panes (D274 item 6). The
   * corpus served this route not at all, so `useSettingsFacts` could only ever
   * resolve its `failed` arm here — which is why the Settings page had to be
   * photographed with the sections it renders actually behind it.
   */
  app.get("/api/v1/settings/facts", (c) => c.json(FIXTURE_SETTINGS_FACTS as unknown));

  app.get("/api/v1/settings/editable", (c) => c.json(FIXTURE_EDITABLE_SETTINGS as unknown));
  app.get("/api/v1/settings/storage-relocation", (c) => c.json(FIXTURE_STORAGE_RELOCATION));
}
