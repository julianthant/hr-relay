import { createHash } from "node:crypto";
import { expect,test } from "@playwright/test";
import { gotoAppState } from "../helpers/app-driver.js";
import { assertThemeApplied,captureParityPair,installTheme,type ParityTheme,PARITY_THEMES } from "../helpers/capture.js";
import { FIXTURE_DESCRIPTOR_HASH } from "../helpers/fixture-identity.js";
import { FIXTURE_IDS } from "../helpers/fixture-queue.js";
import { RECEIPTS_FAILURES_SCENES } from "../helpers/run-detail/receipts-failures-scenes.js";
import { SEEDED_APP_VERSION,SEEDED_DAY } from "../helpers/seeded-identity.js";
import { REFERENCES,failOnPageErrors } from "../helpers/reference-harness.js";
import { referenceSceneGroups,registerRunDetailServer,registerSeededServer } from "./shared.js";

const servers = registerRunDetailServer();
const seededServers = registerSeededServer();
for (const group of referenceSceneGroups(Object.values(RECEIPTS_FAILURES_SCENES), () => servers.server.baseUrl)) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}

for (const theme of PARITY_THEMES) {
  const evidenceName = `run-detail-failure-advice-${theme.name}.a11y.yml`;
  test(`failure advice and diagnostic identity — ${theme.name}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidenceName }],
  }, async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, theme satisfies ParityTheme);
    await gotoAppState(page, servers.server.baseUrl, {
      day: SEEDED_DAY,
      run: FIXTURE_IDS.failedRun,
      section: "logs",
    });
    await page.mouse.click(500, 500);
    await page.waitForTimeout(120);
    await assertThemeApplied(page, theme satisfies ParityTheme);
    await page.getByRole("button", { name: "Show the diagnostic record" }).click();

    const body = await page.locator("body").ariaSnapshot();
    expect(body).toContain("What is safe to retry");
    expect(body).toContain("Confirm which EID is correct at the source before re-running");
    expect(body).toContain("Diagnostic bundle");
    expect(errors, "page errors while reading failure advice").toEqual([]);
    test.info().annotations.push({
      type: `a11y-attachment-sha256:${evidenceName}`,
      description: createHash("sha256").update(body).digest("hex"),
    });
    await test.info().attach(evidenceName, { body, contentType: "text/yaml" });
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
