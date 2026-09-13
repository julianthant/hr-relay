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
  const PANES: readonly { variant: string; section: string; table: string }[] = [
    { variant: "system-hosts", section: "system-hosts", table: "System entry hosts" },
    { variant: "capabilities", section: "workflow-capabilities", table: "Dry-run posture by workflow" },
  ];
  for (const pane of PANES) {
    test(`settings ${pane.variant}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: pane.section });
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, PARITY_THEMES[0]);

      /*
        `useSettingsFacts` draws THREE states and only one of them is this
        reference. Waiting on the pane's own SERVED table — a table that exists
        on the `loaded` arm and on neither of the others — is what keeps a
        `loading` skeleton, or the `failed` arm the corpus would have
        photographed before the route existed, from being frozen here as if it
        were the loaded page. Named, not `.first()`: an unnamed wait would be
        satisfied by any table the takeover happened to draw.

        Deliberately NOT `getByRole("heading")`: `PanelHeader` renders its title
        as a styled `<span>`, so no Settings pane has a heading at all. That is
        a real finding and it belongs in a fidelity unit, not in a re-freeze —
        this reference photographs the surface as it ships.
      */
      await expect(page.getByRole("table", { name: pane.table })).toBeVisible();
      await page.waitForTimeout(120);
      expect(errors, `page errors while rendering the ${pane.variant} pane`).toEqual([]);

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
