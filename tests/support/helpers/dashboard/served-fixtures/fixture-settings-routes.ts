import { FIXTURE_EDITABLE_SETTINGS } from "../../../fixtures/dashboard/fixture-settings.js";
import { createFixtureSettingsRoutesSetup } from "../profiles/fixture-settings-routes-setup.js";

export const {
  registerFixtureSettingsRoutes
} = createFixtureSettingsRoutesSetup( {
  FIXTURE_EDITABLE_SETTINGS
});
