import { seedSyntheticRuntimeConfig } from "../../../fixtures/operator-command-fixtures.js";
import { AuthorityDatabase } from "../../synthetic-storage-admission.js";
import { assertServedBundle } from "./bundle.js";
import { dateNavigationReader,seedDateNavigation } from "./date-navigation-server.js";
import { composeSeededServices } from "./seeded-services.js";
import { createSeededBffSetup } from "../profiles/seeded-bff-setup.js";

export type { SeededServer } from "../profiles/seeded-bff-setup.js";

export const {
  SEEDED_COVERAGE_GAPS,
  startSeededServer
} = createSeededBffSetup( {
  seedRuntimeConfig: (database: AuthorityDatabase) => seedSyntheticRuntimeConfig(database),
  composeFixtureServices: (input) => { const { app, hub } = composeSeededServices(input); return { app, hub, closeRunLogs: () => {} }; },
  assertServedBundle,
  dateNavigationReader,
  seedDateNavigation
});

export { SEEDED_APP_VERSION,SEEDED_AT,SEEDED_DAY,SEEDED_NOW } from "./seeded-identity.js";
