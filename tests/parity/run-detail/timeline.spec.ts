import { test } from "@playwright/test";
import { TIMELINE_SCENES } from "../helpers/run-detail/timeline-scenes.js";
import { referenceSceneGroups } from "./shared.js";

for (const group of referenceSceneGroups(Object.values(TIMELINE_SCENES))) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}
