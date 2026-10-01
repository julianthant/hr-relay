/**
 * The explorer and UI-catalog fixtures (2i-G, D176/D177).
 *
 * Unlike the day, intake and capture fixtures, these two are the REAL
 * projections. That is deliberate and it is what makes the references worth
 * having: doc 02 §Exit criteria asks that the explorer "renders the
 * as-built person-lookup graph accurately", and a hand-written fixture graph
 * would prove only that the surface can render a shape somebody typed. The
 * corpus already binds itself to the real descriptor this way — `fixture-day`'s
 * `CONTRACT_FINGERPRINT` is `personLookupDescriptor.contractFingerprint` — so a
 * change to the graph MOVES these references, which is exactly the drift signal
 * a reference corpus exists to give.
 *
 * The one substitution is the clock: `generatedAt` is pinned to the corpus day,
 * because a wall-clock instant in a rendered surface would differ on every run
 * and turn the whole lane into noise.
 */
import { manualClock } from "../../../src/domain/clock.js";
import {
buildWorkflowExplorer,
type ExplorerQueryDeps,
} from "../../../src/backend/runs/dashboard/queries/explorer.js";
import { buildUiCatalogWire } from "../../../src/backend/runs/dashboard/queries/ui-catalog.js";
import { explorerQueryDeps,uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";
import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";

const FIXTURE_INSTANT = new Date(`${FIXTURE_DAY}T17:04:00.000Z`);

function deps(): ExplorerQueryDeps {
  return explorerQueryDeps(manualClock(FIXTURE_INSTANT), FIXTURE_DESCRIPTOR_HASH);
}

export const FIXTURE_EXPLORER_WIRE = buildWorkflowExplorer(deps());

export const FIXTURE_UI_CATALOG_WIRE = buildUiCatalogWire(uiCatalogQueryDeps());

/** The workflow the explorer reference opens on — Phase 2's exit-criterion graph. */
export const FIXTURE_EXPLORER_WORKFLOW_ID = "person-lookup";

/** The search term the narrowed catalog reference is captured at. */
export const FIXTURE_CATALOG_QUERY = "kuali";
