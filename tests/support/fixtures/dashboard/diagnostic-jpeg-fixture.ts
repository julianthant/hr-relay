import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST } from "./fixture-diagnostic.js";
import { createDiagnosticJpegFixtureSetup } from "../../helpers/dashboard/profiles/diagnostic-jpeg-fixture-setup.js";

export const {
  restrictedJpegDiagnosticFixture
} = createDiagnosticJpegFixtureSetup( {
  FIXTURE_DIAGNOSTIC_BUNDLE,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST
});
