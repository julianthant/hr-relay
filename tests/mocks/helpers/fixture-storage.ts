import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { at,uuidOf } from "./fixture-identity.js";
import { createFixtureStorageSetup } from "../../support/helpers/dashboard/profiles/fixture-storage-setup.js";

export const {
  FIXTURE_STORAGE_DEGRADED_BOOTSTRAP,
  FIXTURE_STORAGE_DOCTOR
} = createFixtureStorageSetup( {
  FIXTURE_BOOTSTRAP,
  at,
  uuidOf
});
