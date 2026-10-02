/**
 * The Explorer fixture (2i-G, D176/D177) is the REAL descriptor projection.
 * A hand-written fixture graph would prove only that the surface can render a
 * shape somebody typed; the reference instead binds to the as-built graph.
 *
 * The clock is pinned to the corpus day because a wall-clock instant would
 * differ on every run and turn the lane into noise.
 */
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
buildWorkflowExplorer,
type ExplorerQueryDeps,
} from "../../../../src/backend/runs/queries/explorer.js";
import { explorerQueryDeps } from "../explorer-seams.js";
import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";

const FIXTURE_INSTANT = new Date(`${FIXTURE_DAY}T17:04:00.000Z`);

function deps(): ExplorerQueryDeps {
  return explorerQueryDeps(manualClock(FIXTURE_INSTANT), FIXTURE_DESCRIPTOR_HASH);
}

export const FIXTURE_EXPLORER_WIRE = buildWorkflowExplorer(deps());

/** The workflow the explorer reference opens on — Phase 2's exit-criterion graph. */
export const FIXTURE_EXPLORER_WORKFLOW_ID = "person-lookup";
