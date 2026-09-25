import { createHash } from "node:crypto";
import { expect,test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
assertThemeApplied,
captureParityPair,
installTheme
} from "./helpers/capture.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES,dismissWorkflowWindow,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
import { ANCHORS,SCENES } from "./helpers/reference-settings-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);


/**
 * THE OTHER TWO SETTINGS PANES (D274 item 6, ledger 3 SE40–SE42).
 *
 * `settings` above opens on Storage, which is served by the bootstrap and needs
 * nothing else. These two are the `settings/facts` panes — the resolved config's
 * System hosts table, and the descriptor registry's Workflow capabilities table
 * — and each is a projection of an authority the process already composed, so
 * what they print is what a run would actually do. They are photographed
 * because they are exactly the pages that can go quietly wrong: a hosts table
 * that omits a `not-distinct` verdict, or a capability row that claims a dry
 * run a descriptor does not declare, is a screen that reads correct and is not.
 *
 * One viewport and one theme apiece: these are tables of served facts, the same
 * pixels at every width, and the nav that reaches them is already in `settings`.
 */
test.describe("settings panes", () => {
  const PANES: readonly { variant: string; section: string; heading: string }[] = [
    { variant: "system-hosts", section: "system-hosts", heading: "Entry hosts" },
    { variant: "capabilities", section: "workflow-capabilities", heading: "Where a dry run stops" },
  ];
  for (const pane of PANES) {
    const a11yName = `settings-pane-${pane.variant}.a11y.yml`;
    test(`settings ${pane.variant}`, {
      annotation: [{ type: "required-a11y-evidence", description: a11yName }],
    }, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: pane.section });
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, PARITY_THEMES[0]);

      await expect(page.getByRole("heading", { name: pane.heading, exact: true })).toBeVisible();
      await page.waitForTimeout(120);
      expect(errors, `page errors while rendering the ${pane.variant} pane`).toEqual([]);
      const snapshot = await page.locator("body").ariaSnapshot();
      test.info().annotations.push({
        type: `a11y-attachment-sha256:${a11yName}`,
        description: createHash("sha256").update(snapshot).digest("hex"),
      });
      await test.info().attach(a11yName, { body: snapshot, contentType: "text/yaml" });

      await captureParityPair(page, REFERENCES, {
        stateId: "settings",
        viewport: "1440x900",
        theme: PARITY_THEMES[0].name,
        adapter: "fixture",
        fixtureId: "settings",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: pane.variant,
      });
    });
  }
});
