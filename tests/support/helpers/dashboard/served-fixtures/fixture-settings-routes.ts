import { Hono } from "hono";
import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS,FIXTURE_STORAGE_RELOCATION } from "../../../fixtures/dashboard/fixture-settings.js";
export function registerFixtureSettingsRoutes({ app }: { app: Hono }): void {



  app.get("/api/v1/settings/facts", (c) => c.json(FIXTURE_SETTINGS_FACTS as unknown));

  app.get("/api/v1/settings/editable", (c) => c.json(FIXTURE_EDITABLE_SETTINGS as unknown));
  app.get("/api/v1/settings/storage-relocation", (c) => c.json(FIXTURE_STORAGE_RELOCATION));
}
