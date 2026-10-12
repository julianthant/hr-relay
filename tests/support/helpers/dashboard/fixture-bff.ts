import { assertServedBundle } from "../../../parity/helpers/bundle.js";
import { restrictedJpegDiagnosticFixture } from "../../../parity/helpers/diagnostic-jpeg-fixture.js";
import { registerFixtureActivityRoutes } from "../../../parity/helpers/fixture-activity-routes.js";
import { FIXTURE_COMMAND_RESULTS } from "../../../parity/helpers/fixture-day.js";
import { registerFixtureDetailRoutes } from "../../../parity/helpers/fixture-detail-routes.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "../../../parity/helpers/fixture-diagnostic.js";
import { registerFixtureExplorerRoutes } from "../../../parity/helpers/fixture-explorer-routes.js";
import { registerFixtureIntakeRoutes } from "../../../parity/helpers/fixture-intake-routes.js";
import { DEFAULT_DASHBOARD_PROFILE } from "../../../parity/helpers/fixture-profile.js";
import { registerFixtureQueueRoutes } from "../../../parity/helpers/fixture-queue-routes.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "../../../parity/helpers/fixture-queue.js";
import {
FIXTURE_RUN_CAPTURE_DAY
} from "../../../parity/helpers/fixture-run-captures.js";
import { registerFixtureSettingsRoutes } from "../../../parity/helpers/fixture-settings-routes.js";
import { registerFixtureShellRoutes } from "../../../parity/helpers/fixture-shell-routes.js";
import { registerFixtureStartRoutes } from "../../../parity/helpers/fixture-start-routes.js";
import { registerFixtureStorageRoutes } from "../../../parity/helpers/fixture-storage-routes.js";
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

export type { FixtureBffOptions,FixtureDashboardProfile } from "../../../parity/helpers/fixture-profile.js";
