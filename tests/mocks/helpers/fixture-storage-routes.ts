import { FIXTURE_STORAGE_DOCTOR } from "./fixture-storage.js";
import { createFixtureStorageRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-storage-routes-setup.js";

export const {
  registerFixtureStorageRoutes
} = createFixtureStorageRoutesSetup( {
  FIXTURE_STORAGE_DOCTOR
});
