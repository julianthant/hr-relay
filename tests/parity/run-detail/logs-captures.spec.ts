import { test } from "@playwright/test";
import { LOGS_CAPTURES_SCENES } from "../helpers/run-detail/logs-captures-scenes.js";
import { referenceSceneGroups } from "./shared.js";

for (const group of referenceSceneGroups(Object.values(LOGS_CAPTURES_SCENES))) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}
