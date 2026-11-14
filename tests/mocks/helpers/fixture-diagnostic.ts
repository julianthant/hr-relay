import { at,CONFIG_FINGERPRINT,CONTRACT_FINGERPRINT,uuidOf } from "./fixture-identity.js";
import { createFixtureDiagnosticSetup } from "../../support/helpers/dashboard/profiles/fixture-diagnostic-setup.js";

export const {
  FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
  FIXTURE_DIAGNOSTIC_BUNDLE
} = createFixtureDiagnosticSetup( {
  at,
  CONFIG_FINGERPRINT,
  CONTRACT_FINGERPRINT,
  uuidOf
});
