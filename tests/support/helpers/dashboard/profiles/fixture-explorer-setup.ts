import { explorerQueryDeps } from "../../../fixtures/explorer-seams.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { buildWorkflowExplorer, type ExplorerQueryDeps } from "../../../../../src/backend/runs/queries/explorer.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";


export function createFixtureExplorerSetup({ FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH }: {
FIXTURE_DAY: typeof FixtureIdentityTypes.FIXTURE_DAY;
FIXTURE_DESCRIPTOR_HASH: typeof FixtureIdentityTypes.FIXTURE_DESCRIPTOR_HASH;
}) {
  const FIXTURE_INSTANT = new Date(`${FIXTURE_DAY}T17:04:00.000Z`);

  function deps(): ExplorerQueryDeps {
    return explorerQueryDeps(manualClock(FIXTURE_INSTANT), FIXTURE_DESCRIPTOR_HASH);
  }

  const FIXTURE_EXPLORER_WIRE = buildWorkflowExplorer(deps());

  const FIXTURE_EXPLORER_WORKFLOW_ID = "person-lookup";

  return { FIXTURE_EXPLORER_WIRE, FIXTURE_EXPLORER_WORKFLOW_ID };
}
