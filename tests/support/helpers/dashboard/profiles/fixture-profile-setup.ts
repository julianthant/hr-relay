import type { CommandResult } from "../../../../../src/rules/commands/commands.js";
import type { FrontendBootstrapWire } from "../../../../../src/models/dashboard/bootstrap.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import type { StartPlanWire as StartPlanResponse } from "../../../../../src/models/dashboard/start-plan.js";
import type * as FixtureBootstrapTypes from "../../../fixtures/dashboard/fixture-bootstrap.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../fixtures/dashboard/fixture-queue.js";


export interface FixtureDashboardProfile {
  /** Every bootstrap fact the browser reads before it selects a route. */
  readonly bootstrap: FrontendBootstrapWire;
  /** The corresponding day snapshot, including the same descriptor-set hash. */
  readonly day: DashboardDayWire;
  readonly descriptorHash: string;
  /** An optional exact plan for an interaction-specific fixture profile. */
  readonly startPlan?: StartPlanResponse;
  /** An optional exact command receipt for an interaction-specific profile. */
  readonly commandResult?: CommandResult;
}

export type FixtureBffOptions = Readonly<{
    profile?: FixtureDashboardProfile;
    preflightScenario?: "ready" | "warning";
    dayWire?: DashboardDayWire;
    diagnosticFixture?: "restricted-jpeg";
    runCaptureScenario?: "evidence";
  }>;

export function createFixtureProfileSetup({ FIXTURE_BOOTSTRAP, FIXTURE_DESCRIPTOR_HASH, FIXTURE_DAY_WIRE }: {
  FIXTURE_BOOTSTRAP: typeof FixtureBootstrapTypes.FIXTURE_BOOTSTRAP;
  FIXTURE_DESCRIPTOR_HASH: typeof FixtureIdentityTypes.FIXTURE_DESCRIPTOR_HASH;
  FIXTURE_DAY_WIRE: typeof FixtureQueueTypes.FIXTURE_DAY_WIRE;
}) {
  const DEFAULT_DASHBOARD_PROFILE: FixtureDashboardProfile = Object.freeze({
    bootstrap: FIXTURE_BOOTSTRAP,
    day: FIXTURE_DAY_WIRE,
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
  });

  return { DEFAULT_DASHBOARD_PROFILE };
}
