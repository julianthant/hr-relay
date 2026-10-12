import { restrictedJpegDiagnosticFixture } from "../../../fixtures/dashboard/diagnostic-jpeg-fixture.js";
import { FIXTURE_COMMAND_RESULTS } from "../../../fixtures/dashboard/fixture-day.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "../../../fixtures/dashboard/fixture-diagnostic.js";
import { DEFAULT_DASHBOARD_PROFILE } from "../../../fixtures/dashboard/fixture-profile.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "../../../fixtures/dashboard/fixture-queue.js";
import {
FIXTURE_RUN_CAPTURE_DAY
} from "../../../fixtures/dashboard/fixture-run-captures.js";
import { assertServedBundle } from "./bundle.js";
import { registerFixtureActivityRoutes } from "./fixture-activity-routes.js";
import { registerFixtureDetailRoutes } from "./fixture-detail-routes.js";
import { registerFixtureExplorerRoutes } from "./fixture-explorer-routes.js";
import { registerFixtureIntakeRoutes } from "./fixture-intake-routes.js";
import { registerFixtureQueueRoutes } from "./fixture-queue-routes.js";
import { registerFixtureSettingsRoutes } from "./fixture-settings-routes.js";
import { registerFixtureShellRoutes } from "./fixture-shell-routes.js";
import { registerFixtureStartRoutes } from "./fixture-start-routes.js";
import { registerFixtureStorageRoutes } from "./fixture-storage-routes.js";
import { createFixtureBffSetup } from "../profiles/fixture-bff-setup.js";

export type { FixtureArtifactExchange, FixtureServer } from "../profiles/fixture-bff-setup.js";

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

export type { FixtureBffOptions,FixtureDashboardProfile } from "../../../fixtures/dashboard/fixture-profile.js";
