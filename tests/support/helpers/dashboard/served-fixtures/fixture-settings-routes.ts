import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS,FIXTURE_STORAGE_RELOCATION } from "../../../fixtures/dashboard/fixture-settings.js";
import { createFixtureSettingsRoutesSetup } from "../profiles/fixture-settings-routes-setup.js";

export const {
  registerFixtureSettingsRoutes
} = createFixtureSettingsRoutesSetup( {
  FIXTURE_EDITABLE_SETTINGS,
  FIXTURE_SETTINGS_FACTS,
  FIXTURE_STORAGE_RELOCATION
});
