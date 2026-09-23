import { test } from "@playwright/test";
import { CONTEXT_DATA_SCENES } from "../helpers/run-detail/context-data-scenes.js";
import { referenceSceneGroups,registerRunDetailServer } from "./shared.js";

const servers = registerRunDetailServer();

for (const group of referenceSceneGroups(Object.values(CONTEXT_DATA_SCENES), () => servers.server.baseUrl)) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}
