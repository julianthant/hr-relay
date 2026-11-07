import { uuidOf } from "./fixture-identity.js";
import { createFixtureDaySetup } from "../../helpers/dashboard/profiles/fixture-day-setup.js";

export const {
  FIXTURE_COMMAND_RESULTS
} = createFixtureDaySetup( {
  uuidOf
});

export { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
export { FIXTURE_IDENTITY_GATE,FIXTURE_IDENTITY_GATE_NAME_MISMATCH,FIXTURE_PARKED_WRITE,FIXTURE_RUN_DETAILS,FIXTURE_SECTIONS } from "./fixture-detail.js";
export { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "./fixture-diagnostic.js";
export { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH,FIXTURE_NOW,traceOf,uuidOf } from "./fixture-identity.js";
export { BACKFILL_GAP_DAY_WIRE,FIXTURE_DAY_WIRE,FIXTURE_IDS } from "./fixture-queue.js";
export { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS } from "./fixture-settings.js";
export { FIXTURE_SEPARATIONS_START_PLAN,FIXTURE_START_PICKER_BOOTSTRAP,FIXTURE_START_PICKER_DAY_WIRE,FIXTURE_START_PICKER_DESCRIPTOR_HASH,FIXTURE_START_PLAN } from "./fixture-start.js";
export { FIXTURE_STORAGE_DEGRADED_BOOTSTRAP,FIXTURE_STORAGE_DOCTOR } from "./fixture-storage.js";
