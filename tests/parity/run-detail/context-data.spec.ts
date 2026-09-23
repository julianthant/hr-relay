import { createHash } from "node:crypto";
import { test } from "@playwright/test";
import { CONTEXT_DATA_SCENES } from "../helpers/run-detail/context-data-scenes.js";
import { referenceSceneGroups,registerRunDetailServer } from "./shared.js";

const servers = registerRunDetailServer();

for (const group of referenceSceneGroups(Object.values(CONTEXT_DATA_SCENES), () => servers.server.baseUrl)) {
  test.describe(group.title, () => {
    for (const scene of group.tests) {
      if (group.title === "graphite-warm @ 1280x720") {
        const evidenceName = "run-detail-context-data-1280x720.a11y.yml";
        test(scene.title, {
          annotation: [{ type: "required-a11y-evidence", description: evidenceName }],
        }, async ({ page }) => {
          await scene.run({ page });
          const snapshot = await page.locator("body").ariaSnapshot();
          test.info().annotations.push({
            type: `a11y-attachment-sha256:${evidenceName}`,
            description: createHash("sha256").update(snapshot).digest("hex"),
          });
          await test.info().attach(evidenceName, { body: snapshot, contentType: "text/yaml" });
        });
      } else {
        test(scene.title, scene.run);
      }
    }
  });
}
