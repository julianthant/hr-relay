import { Hono } from "hono";
import type * as FixtureSettingsTypes from "../../../fixtures/dashboard/fixture-settings.js";


export function createFixtureSettingsRoutesSetup({ FIXTURE_EDITABLE_SETTINGS, FIXTURE_SETTINGS_FACTS, FIXTURE_STORAGE_RELOCATION }: {
  FIXTURE_EDITABLE_SETTINGS: typeof FixtureSettingsTypes.FIXTURE_EDITABLE_SETTINGS;
  FIXTURE_SETTINGS_FACTS: typeof FixtureSettingsTypes.FIXTURE_SETTINGS_FACTS;
  FIXTURE_STORAGE_RELOCATION: typeof FixtureSettingsTypes.FIXTURE_STORAGE_RELOCATION;
}) {
  function registerFixtureSettingsRoutes({ app }: { app: Hono }): void {



    app.get("/api/v1/settings/facts", (c) => c.json(FIXTURE_SETTINGS_FACTS as unknown));

    app.get("/api/v1/settings/editable", (c) => c.json(FIXTURE_EDITABLE_SETTINGS as unknown));
    app.get("/api/v1/settings/storage-relocation", (c) => c.json(FIXTURE_STORAGE_RELOCATION));
  }

  return { registerFixtureSettingsRoutes };
}
