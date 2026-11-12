import { assertServedBundle } from "../../../mocks/helpers/bundle.js";
import { restrictedJpegDiagnosticFixture } from "../../../mocks/helpers/diagnostic-jpeg-fixture.js";
import { registerFixtureActivityRoutes } from "../../../mocks/helpers/fixture-activity-routes.js";
import { FIXTURE_COMMAND_RESULTS } from "../../../mocks/helpers/fixture-day.js";
import { registerFixtureDetailRoutes } from "../../../mocks/helpers/fixture-detail-routes.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "../../../mocks/helpers/fixture-diagnostic.js";
import { registerFixtureExplorerRoutes } from "../../../mocks/helpers/fixture-explorer-routes.js";
import { registerFixtureIntakeRoutes } from "../../../mocks/helpers/fixture-intake-routes.js";
import { DEFAULT_DASHBOARD_PROFILE } from "../../../mocks/helpers/fixture-profile.js";
import { registerFixtureQueueRoutes } from "../../../mocks/helpers/fixture-queue-routes.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "../../../mocks/helpers/fixture-queue.js";
import {
FIXTURE_RUN_CAPTURE_DAY
} from "../../../mocks/helpers/fixture-run-captures.js";
import { registerFixtureSettingsRoutes } from "../../../mocks/helpers/fixture-settings-routes.js";
import { registerFixtureShellRoutes } from "../../../mocks/helpers/fixture-shell-routes.js";
import { registerFixtureStartRoutes } from "../../../mocks/helpers/fixture-start-routes.js";
import { registerFixtureStorageRoutes } from "../../../mocks/helpers/fixture-storage-routes.js";
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

export type { FixtureBffOptions,FixtureDashboardProfile } from "../../../mocks/helpers/fixture-profile.js";
