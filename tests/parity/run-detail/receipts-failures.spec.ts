import { expect,test } from "@playwright/test";
import { gotoAppState } from "../helpers/app-driver.js";
import { assertThemeApplied,captureParityPair,installTheme,type ParityTheme,PARITY_THEMES } from "../helpers/capture.js";
import { FIXTURE_DESCRIPTOR_HASH } from "../helpers/fixture-identity.js";
import { RECEIPTS_FAILURES_SCENES } from "../helpers/run-detail/receipts-failures-scenes.js";
import { SEEDED_APP_VERSION,SEEDED_DAY } from "../helpers/seeded-identity.js";
import { REFERENCES,failOnPageErrors } from "../helpers/reference-harness.js";
import { referenceSceneGroups,registerSeededServer } from "./shared.js";

const seededServers = registerSeededServer();
for (const group of referenceSceneGroups(Object.values(RECEIPTS_FAILURES_SCENES))) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}

test.describe("populated receipt (adapter #2)", () => {
  for (const theme of PARITY_THEMES) {
    test(`run-receipt-populated @ ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme satisfies ParityTheme);
      await gotoAppState(page, seededServers.seeded.baseUrl, {
        day: SEEDED_DAY,
        run: seededServers.seeded.runIds["doneRun"] ?? "",
        section: "receipt",
      });
      // The floating workflow window opens over the queue's left column. The
      // takeover dismissal clicks at y=100, which on THIS layout is the status
      // filter row — it would change the queue's filter and reset the panel's
      // open section. The empty gutter between the queue and the panel is the
      // only inert target at this viewport.
      await page.mouse.click(500, 500);
      await page.waitForTimeout(120);
      await assertThemeApplied(page, theme satisfies ParityTheme);
      await page.waitForTimeout(120);
      expect(errors, "page errors while rendering the populated receipt").toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "run-receipt-populated",
        viewport: "1440x900",
        theme: theme.name,
        adapter: "seeded",
        fixtureId: "seeded-done-run",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: SEEDED_APP_VERSION,
        capturedAt: SEEDED_DAY,
        variant: "default",
      });
    });
  }
});
