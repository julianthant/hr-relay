import type { CommandResult } from "../../../../src/rules/commands/commands.js";
import type { FrontendBootstrapWire } from "../../../../src/models/dashboard/bootstrap.js";
import type { DashboardDayWire } from "../../../../src/models/dashboard/projection.js";
import type { SavedArchiveReportWire, SavedRuntimeVersionIndexWire } from "../../../../src/models/dashboard/archive.js";
import type { StartPlanWire as StartPlanResponse } from "../../../../src/models/dashboard/start-plan.js";
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./fixture-queue.js";


/* ── SSE envelopes ───────────────────────────────────────────────────────── */

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


export const DEFAULT_DASHBOARD_PROFILE: FixtureDashboardProfile = Object.freeze({
  bootstrap: FIXTURE_BOOTSTRAP,
  day: FIXTURE_DAY_WIRE,
  descriptorHash: FIXTURE_DESCRIPTOR_HASH,
});


export type FixtureBffOptions = Readonly<{
    profile?: FixtureDashboardProfile;
    dayWire?: DashboardDayWire;
    archiveScenario?: "evidence";
    archiveComparison?: Readonly<{ reports: readonly SavedArchiveReportWire[]; versions: SavedRuntimeVersionIndexWire }>;
    savedArchiveFileResponse?: (runId: string, digest: string) => Response | Promise<Response>;
    diagnosticFixture?: "restricted-jpeg";
    runCaptureScenario?: "evidence";
  }>;
