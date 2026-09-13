import {
FIXTURE_ARCHIVED_RUN_ID
} from "./fixture-archive.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [
  /*
    The archive model's three operator states (2i-G, D179). `archive-ledger`
    is the sweep-grouped record with the version-bump flow beneath it, and it
    carries a BLOCKER on purpose — a refusal surface photographed only in its
    happy state proves nothing. `archive-run` is the read-only detail, whose
    whole claim is that it renders with no descriptor behind it.
  */
  { id: "archive-ledger", route: { day: FIXTURE_DAY, archive: "" } },

  { id: "archive-run", route: { day: FIXTURE_DAY, archive: FIXTURE_ARCHIVED_RUN_ID } }];
export const ANCHORS: SceneAnchors = {};
