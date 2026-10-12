import type { Clock } from "../../../src/rules/time/clock.js";
import { dateNavigationReader, seedDateNavigation } from "./date-navigation-server.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { seedInitialSettingsRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { assertServedBundle } from "./bundle.js";
import { composeSeededServices } from "./seeded-services.js";
import { createSeededBffSetup } from "../../support/helpers/dashboard/profiles/seeded-bff-setup.js";

export type { SeededServer } from "../../support/helpers/dashboard/profiles/seeded-bff-setup.js";

export const {
  SEEDED_COVERAGE_GAPS,
  startSeededServer
} = createSeededBffSetup( {
  seedRuntimeConfig: (database: AuthorityDatabase, clock: Clock) => seedInitialSettingsRuntimeConfig(database, clock),
  composeFixtureServices: (input) => { const { app, hub, runLogsHub } = composeSeededServices(input); return { app, hub, closeRunLogs: () => runLogsHub.close() }; },
  assertServedBundle,
  dateNavigationReader,
  seedDateNavigation
});

export { SEEDED_APP_VERSION,SEEDED_AT,SEEDED_DAY,SEEDED_NOW } from "../../support/helpers/dashboard/served-fixtures/seeded-identity.js";
