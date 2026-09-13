import {
FIXTURE_CATALOG_QUERY,
FIXTURE_EXPLORER_WORKFLOW_ID,
} from "./fixture-explorer.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [
  /*
    The two read-only reference takeovers (2i-G). `explorer-graph` is the
    Phase-2 exit criterion's own picture — the as-built person-lookup graph,
    served from the REAL projection — and `explorer-transaction` is the one
    node kind that can change a live HR system, so it is the state where the
    page's single saturated mark has to earn itself. `catalog-search` shows the
    catalog narrowed, which is both the search in use and the provenance a
    selector must never be read without — inside Settings since D295, which is
    where the catalog lives now.
  */
  { id: "explorer-graph", route: { day: FIXTURE_DAY, explore: FIXTURE_EXPLORER_WORKFLOW_ID } },

  { id: "explorer-transaction", route: { day: FIXTURE_DAY, explore: "separations-kuali-finalization" } },

  {
    id: "catalog-search",
    route: { day: FIXTURE_DAY, settings: "ui-catalog", catalog: FIXTURE_CATALOG_QUERY },
  }];
export const ANCHORS: SceneAnchors = {};
