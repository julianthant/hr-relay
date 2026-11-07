import { FIXTURE_RUN_DETAILS } from "./fixture-detail.js";
import { FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "./fixture-queue.js";
import { createFixtureRunCapturesSetup } from "../../helpers/dashboard/profiles/fixture-run-captures-setup.js";

export const {
  RUN_CAPTURE_FIXTURE_IDS,
  RUN_CAPTURE_FULL_RECEIPT_ID,
  runCaptureFixtureBytes,
  FIXTURE_RUN_CAPTURE_DETAILS,
  FIXTURE_RUN_CAPTURE_SECTIONS,
  FIXTURE_RUN_CAPTURE_RECEIPTS,
  FIXTURE_RUN_CAPTURE_REFS,
  FIXTURE_RUN_CAPTURE_DAY
} = createFixtureRunCapturesSetup( {
  FIXTURE_RUN_DETAILS,
  FIXTURE_DESCRIPTOR_HASH,
  FIXTURE_DAY_WIRE,
  FIXTURE_IDS
});
