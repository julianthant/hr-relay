import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS,FIXTURE_STORAGE_RELOCATION } from "./fixture-settings.js";
import { createFixtureSettingsRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-settings-routes-setup.js";

export const {
  registerFixtureSettingsRoutes
} = createFixtureSettingsRoutesSetup( {
  FIXTURE_EDITABLE_SETTINGS,
  FIXTURE_SETTINGS_FACTS,
  FIXTURE_STORAGE_RELOCATION
});
