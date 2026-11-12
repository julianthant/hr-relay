import { FIXTURE_RUN_DETAILS,FIXTURE_SECTIONS } from "./fixture-detail.js";
import {
FIXTURE_RUN_CAPTURE_DETAILS,FIXTURE_RUN_CAPTURE_RECEIPTS,
FIXTURE_RUN_CAPTURE_REFS,
FIXTURE_RUN_CAPTURE_SECTIONS,
runCaptureFixtureBytes
} from "./fixture-run-captures.js";
import { FIXTURE_DAY, uuidOf } from "./fixture-identity.js";
import { createFixtureDetailRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-detail-routes-setup.js";

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
