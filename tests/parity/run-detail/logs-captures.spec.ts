import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LOGS_CAPTURES_SCENES } from "../helpers/run-detail/logs-captures-scenes.js";
import { referenceSceneGroups, registerRunDetailServer } from "./shared.js";

const servers = registerRunDetailServer();

for (const group of referenceSceneGroups(Object.values(LOGS_CAPTURES_SCENES), () => servers.server.baseUrl)) {
  const [themeName, viewportName] = group.title.split(" @ ");
  if (themeName === undefined || viewportName === undefined) throw new Error(`invalid run-detail parity group ${group.title}`);
  test.describe(group.title, () => {
    for (const scene of group.tests) {
      const a11yName = `logs-captures--${themeName}--${viewportName}.a11y.yml`;
      test(scene.title, {
        annotation: [{ type: "required-a11y-evidence", description: a11yName }],
      }, async ({ page }, info) => {
        await scene.run({ page });
        const snapshot = await page.locator("body").ariaSnapshot();
        expect(snapshot).toContain('- region "Run detail":');
        info.annotations.push({
          type: `a11y-attachment-sha256:${a11yName}`,
          description: createHash("sha256").update(snapshot).digest("hex"),
        });
        await info.attach(a11yName, { body: snapshot, contentType: "text/yaml" });
      });
    }
  });
}
