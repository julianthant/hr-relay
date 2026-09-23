import { test } from "@playwright/test";
import { TIMELINE_SCENES } from "../helpers/run-detail/timeline-scenes.js";
import { referenceSceneGroups,registerRunDetailServer } from "./shared.js";

const servers = registerRunDetailServer();

for (const group of referenceSceneGroups(Object.values(TIMELINE_SCENES), () => servers.server.baseUrl)) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}
