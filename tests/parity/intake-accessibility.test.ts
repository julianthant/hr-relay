
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { createHash } from "node:crypto";

import { expect,test,type Locator,type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_INTAKE_IDS } from "../support/fixtures/dashboard/fixture-intake.js";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "narrow-1024x768", width: 1024, height: 768 },
] as const;

let server: FixtureServer;

async function openReview(page: Page, viewport: (typeof VIEWPORTS)[number]): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installTheme(page, PARITY_THEMES[0]);
  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    intake: FIXTURE_INTAKE_IDS.validated,
  });
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await page.mouse.click(viewport.width / 2, 100);
  await expect(page.getByRole("table", { name: "Rejected rows" })).toBeVisible();
}

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
  });
});

test.afterAll(async () => {
  await server.close();
});

test("Fix and Exclude mount one labelled editor and focus its named input", {
  annotation:[{type:"required-a11y-evidence",description:"intake-correction-focus.a11y.yml"}],
}, async ({ page }) => {
  await openReview(page, VIEWPORTS[0]);

  await page.getByRole("button", { name: "Fix cell" }).first().click();
  const correction = page.getByRole("region", { name: /^Correct row \d+ · /u });
  const correctedValue = correction.getByRole("textbox", { name: "Corrected value" });
  await expect(correction).toBeVisible();
  await expect(correctedValue).toBeFocused();
  await expect(correctedValue).toHaveAttribute("name", "intake-corrected-value");
  await expect(correctedValue).toHaveAttribute("autocomplete", "off");


  await page.getByRole("button", { name: "Exclude…" }).first().click();
  const exclusion = page.getByRole("region", { name: /^Exclude row \d+$/u });
  const reason = exclusion.getByRole("textbox", { name: "Reason" });
  await expect(correction).toHaveCount(0);
  await expect(exclusion).toBeVisible();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("name", "intake-exclusion-reason");
  await expect(reason).toHaveAttribute("autocomplete", "off");



  await page.getByRole("button", { name: "Fix cell" }).first().click();
  await expect(exclusion).toHaveCount(0);
  await expect(correction).toBeVisible();
  await expect(correctedValue).toBeFocused();
  const snapshot=await page.locator("body").ariaSnapshot();
  test.info().annotations.push({type:"a11y-attachment-sha256:intake-correction-focus.a11y.yml",description:createHash("sha256").update(snapshot).digest("hex")});
  await test.info().attach("intake-correction-focus.a11y.yml",{body:snapshot,contentType:"text/yaml"});
});

test("Exclude remounts its editor and refocuses Reason when the operator switches rows", async ({ page }) => {
  await openReview(page, VIEWPORTS[0]);

  // The fixture has one Fix-eligible row; its editor remount cannot switch between eligible rows.
  const table = page.getByRole("table", { name: "Rejected rows" });
  const rowFor = (sourceRow: number): Locator =>
    table.getByRole("row").filter({ has: page.getByText(String(sourceRow), { exact: true }) });

  await rowFor(1).getByRole("button", { name: "Exclude…" }).click();
  const exclusionOne = page.getByRole("region", { name: "Exclude row 1" });
  const reasonOne = exclusionOne.getByRole("textbox", { name: "Reason" });
  await expect(exclusionOne).toBeVisible();
  await expect(reasonOne).toBeFocused();

  await rowFor(5).getByRole("button", { name: "Exclude…" }).click();
  const exclusionFive = page.getByRole("region", { name: "Exclude row 5" });
  const reasonFive = exclusionFive.getByRole("textbox", { name: "Reason" });
  await expect(exclusionOne).toHaveCount(0);
  await expect(exclusionFive).toBeVisible();
  await expect(reasonFive).toBeFocused();
});

for (const viewport of VIEWPORTS) {
  test(`rejection actions and review label own clear 44px targets @ ${viewport.name}`, async ({ page }) => {
    await openReview(page, viewport);

    const actions = page
      .getByRole("table", { name: "Rejected rows" })
      .getByRole("button");
    await actions.first().scrollIntoViewIfNeeded();
    const actionProof = await actions.evaluateAll((buttons) => {
      const effective = buttons.map((button) => {
        const visual = button.getBoundingClientRect();
        const height = Number.parseFloat(getComputedStyle(button, "::after").height);
        const width = Number.parseFloat(getComputedStyle(button, "::after").width);
        return {
          button,
          visualHeight: visual.height,
          height,
          width,
          left: visual.left,
          right: visual.right,
          top: visual.top + visual.height / 2 - height / 2,
          bottom: visual.top + visual.height / 2 + height / 2,
        };
      });
      return effective.map((target, index) => {
        const centerX = (target.left + target.right) / 2;
        const owns = (y: number): boolean => {
          const hit = document.elementFromPoint(centerX, y);
          return hit === target.button || (hit !== null && target.button.contains(hit));
        };
        const overlaps = effective.filter((candidate, candidateIndex) => (
          candidateIndex !== index
          && target.left < candidate.right
          && target.right > candidate.left
          && target.top < candidate.bottom
          && target.bottom > candidate.top
        )).length;
        return {
          visualHeight: target.visualHeight,
          effectiveHeight: target.height,
          effectiveWidth: target.width,
          ownsTop: owns(target.top + 1),
          ownsBottom: owns(target.bottom - 1),
          overlaps,
        };
      });
    });

    expect(actionProof.length).toBeGreaterThan(0);
    for (const proof of actionProof) {
      expect(proof.visualHeight).toBe(24);
      expect(proof.effectiveHeight).toBeGreaterThanOrEqual(44);
      expect(proof.effectiveWidth).toBeGreaterThanOrEqual(44);
      expect(proof.ownsTop).toBe(true);
      expect(proof.ownsBottom).toBe(true);
      expect(proof.overlaps).toBe(0);
    }

    // Assert the accessible name before reaching into the locator; an unnamed checkbox must fail here.
    const review = page.getByRole("checkbox", { name: /^I have read all \d+ rejected rows$/u });
    await expect(
      review,
      "the rejection acknowledgement must expose its visible label as its accessible name",
    ).toHaveCount(1);
    await review.scrollIntoViewIfNeeded();

    const labelProof = await review.evaluate((checkbox) => {
      const id = checkbox.id;
      const label = document.querySelector(`label[for='${CSS.escape(id)}']`);
      if (!(label instanceof HTMLLabelElement)) throw new Error(`review checkbox ${id} has no label`);
      const rect = label.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.right - 1, rect.top + 1);
      return {
        height: rect.height,
        width: rect.width,
        cornerX: rect.right - 1,
        cornerY: rect.top + 1,
        ownsCorner: hit === label || (hit !== null && label.contains(hit)),
      };
    });
    expect(labelProof.height).toBeGreaterThanOrEqual(44);
    expect(labelProof.width).toBeGreaterThanOrEqual(44);
    expect(labelProof.ownsCorner).toBe(true);

    // Click the label corner to prove the enlarged geometry is a real hit target.
    await expect(review).toHaveAttribute("aria-checked", "false");
    await page.mouse.click(labelProof.cornerX, labelProof.cornerY);
    await expect(review).toHaveAttribute("aria-checked", "true");
  });
}
