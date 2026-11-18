import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import type { CommandResult } from "../../../../../src/rules/commands/commands.js";
import type { FrontendBootstrapWire } from "../../../../../src/models/dashboard/bootstrap.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import type { StartPlanWire as StartPlanResponse } from "../../../../../src/models/dashboard/start-plan.js";
import type * as FixtureBootstrapTypes from "../../../fixtures/dashboard/fixture-bootstrap.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../fixtures/dashboard/fixture-queue.js";


/** The signed-in, Duo-ready session every fixture BFF serves at `/api/v1/profile/state`. */
export const FIXTURE_ACTIVE_PROFILE_STATE = PublicProfileStateSchema.parse({
  state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready",
  account: { name: "Smoke Test", initials: "ST", timekeeper: "Smoke Test", timekeeperInitials: "ST", lastSignedInAt: "2026-11-10T08:30:00-08:00" },
});

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
    runHistory?: "ready" | "active" | "empty";
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
