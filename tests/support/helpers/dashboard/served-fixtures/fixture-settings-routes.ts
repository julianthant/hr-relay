import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS } from "../../../fixtures/dashboard/fixture-settings.js";
import { createFixtureSettingsRoutesSetup } from "../profiles/fixture-settings-routes-setup.js";

export const {
  registerFixtureSettingsRoutes
} = createFixtureSettingsRoutesSetup( {
  FIXTURE_EDITABLE_SETTINGS,
  FIXTURE_SETTINGS_FACTS
});
