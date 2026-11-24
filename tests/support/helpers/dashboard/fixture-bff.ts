import { assertServedBundle } from "./mock-world/bundle.js";
import { restrictedJpegDiagnosticFixture } from "./mock-world/diagnostic-jpeg-fixture.js";
import { registerFixtureActivityRoutes } from "./mock-world/fixture-activity-routes.js";
import { FIXTURE_COMMAND_RESULTS } from "./mock-world/fixture-day.js";
import { registerFixtureDetailRoutes } from "./mock-world/fixture-detail-routes.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "./mock-world/fixture-diagnostic.js";
import { registerFixtureExplorerRoutes } from "./mock-world/fixture-explorer-routes.js";
import { registerFixtureIntakeRoutes } from "./mock-world/fixture-intake-routes.js";
import { DEFAULT_DASHBOARD_PROFILE } from "./mock-world/fixture-profile.js";
import { registerFixtureQueueRoutes } from "./mock-world/fixture-queue-routes.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "./mock-world/fixture-queue.js";
import {
FIXTURE_RUN_CAPTURE_DAY
} from "./mock-world/fixture-run-captures.js";
import { registerFixtureSettingsRoutes } from "./mock-world/fixture-settings-routes.js";
import { registerFixtureShellRoutes } from "./mock-world/fixture-shell-routes.js";
import { registerFixtureStartRoutes } from "./mock-world/fixture-start-routes.js";
import { registerFixtureStorageRoutes } from "./mock-world/fixture-storage-routes.js";
import { createFixtureBffSetup } from "./profiles/fixture-bff-setup.js";

export type { FixtureArtifactExchange, FixtureServer } from "./profiles/fixture-bff-setup.js";

export const {
  fixtureHelloEnvelope,
  fixtureSnapshotEnvelope,
  fixtureHealthEnvelope,
  createFixtureBff,
  startFixtureServer
} = createFixtureBffSetup( {
  restrictedJpegDiagnosticFixture,
  FIXTURE_COMMAND_RESULTS,
  FIXTURE_DIAGNOSTIC_BUNDLE,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
  FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES,
  DEFAULT_DASHBOARD_PROFILE,
  FIXTURE_DAY_WIRE,
  FIXTURE_IDS,
  FIXTURE_RUN_CAPTURE_DAY,
  assertServedBundle,
  registerFixtureActivityRoutes,
  registerFixtureDetailRoutes,
  registerFixtureExplorerRoutes,
  registerFixtureIntakeRoutes,
  registerFixtureQueueRoutes,
  registerFixtureSettingsRoutes,
  registerFixtureShellRoutes,
  registerFixtureStartRoutes,
  registerFixtureStorageRoutes
});

export type { FixtureBffOptions,FixtureDashboardProfile } from "./mock-world/fixture-profile.js";
