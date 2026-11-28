import { createFixtureSettingsRoutesSetup } from "../profiles/fixture-settings-routes-setup.js";
import { FIXTURE_EDITABLE_SETTINGS } from "./fixture-settings.js";

export const {
  registerFixtureSettingsRoutes
} = createFixtureSettingsRoutesSetup( {
  FIXTURE_EDITABLE_SETTINGS
});
