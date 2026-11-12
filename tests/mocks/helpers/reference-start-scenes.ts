import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [
  { id: "start-run", route: { day: FIXTURE_DAY, start: true } }];
export const ANCHORS: SceneAnchors = {};
