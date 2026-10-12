import { FIXTURE_RUN_DETAILS,FIXTURE_SECTIONS } from "../../../fixtures/dashboard/fixture-detail.js";
import { FIXTURE_DAY,uuidOf } from "../../../fixtures/dashboard/fixture-identity.js";
import {
FIXTURE_RUN_CAPTURE_DETAILS,FIXTURE_RUN_CAPTURE_RECEIPTS,
FIXTURE_RUN_CAPTURE_REFS,
FIXTURE_RUN_CAPTURE_SECTIONS,
runCaptureFixtureBytes
} from "../../../fixtures/dashboard/fixture-run-captures.js";
import { createFixtureDetailRoutesSetup } from "../profiles/fixture-detail-routes-setup.js";

export const {
  registerFixtureDetailRoutes
} = createFixtureDetailRoutesSetup( {
  FIXTURE_RUN_DETAILS,
  FIXTURE_SECTIONS,
  FIXTURE_DAY,
  uuidOf,
  FIXTURE_RUN_CAPTURE_DETAILS,
  FIXTURE_RUN_CAPTURE_RECEIPTS,
  FIXTURE_RUN_CAPTURE_REFS,
  FIXTURE_RUN_CAPTURE_SECTIONS,
  runCaptureFixtureBytes
});
