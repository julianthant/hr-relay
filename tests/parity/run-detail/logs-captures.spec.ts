import { test } from "@playwright/test";
import { LOGS_CAPTURES_SCENES } from "../helpers/run-detail/logs-captures-scenes.js";
import { referenceSceneGroups,registerRunDetailServer } from "./shared.js";

const servers = registerRunDetailServer();

for (const group of referenceSceneGroups(Object.values(LOGS_CAPTURES_SCENES), () => servers.server.baseUrl)) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}
