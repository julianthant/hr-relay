import { fixtureSettingsDocument } from "./fixture-settings.js";

export function fixtureProviderSettings() {
  return { document: fixtureSettingsDocument(), close() {} };
}
