import { createFixtureSettingsRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-settings-routes-setup.js";
import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS } from "./fixture-settings.js";

export const {
  registerFixtureSettingsRoutes
} = createFixtureSettingsRoutesSetup( {
  FIXTURE_EDITABLE_SETTINGS,
  FIXTURE_SETTINGS_FACTS
});
