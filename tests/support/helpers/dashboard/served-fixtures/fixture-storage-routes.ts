import { FIXTURE_STORAGE_DOCTOR } from "../../../fixtures/dashboard/fixture-storage.js";
import { createFixtureStorageRoutesSetup } from "../profiles/fixture-storage-routes-setup.js";

export const {
  registerFixtureStorageRoutes
} = createFixtureStorageRoutesSetup( {
  FIXTURE_STORAGE_DOCTOR
});
