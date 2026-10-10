import {
FIXTURE_ARCHIVED_RUN_ID
} from "./fixture-archive.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [

  { id: "archive-ledger", route: { day: FIXTURE_DAY, archive: "" } },

  { id: "archive-run", route: { day: FIXTURE_DAY, archive: FIXTURE_ARCHIVED_RUN_ID } }];
export const ANCHORS: SceneAnchors = {};
