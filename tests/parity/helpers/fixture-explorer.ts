
import { manualClock } from "../../../src/rules/time/clock.js";
import {
buildWorkflowExplorer,
type ExplorerQueryDeps,
} from "../../../src/backend/runs/queries/explorer.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";
import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";

const FIXTURE_INSTANT = new Date(`${FIXTURE_DAY}T17:04:00.000Z`);

function deps(): ExplorerQueryDeps {
  return explorerQueryDeps(manualClock(FIXTURE_INSTANT), FIXTURE_DESCRIPTOR_HASH);
}

export const FIXTURE_EXPLORER_WIRE = buildWorkflowExplorer(deps());



export const FIXTURE_EXPLORER_WORKFLOW_ID = "person-lookup";

/** The search term the narrowed catalog reference is captured at. */
export const FIXTURE_CATALOG_QUERY = "kuali";
