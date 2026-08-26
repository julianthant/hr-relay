/**
 * Intake's rejection editors are interaction states, not parity references.
 * Prove their focus and target contracts through the built bundle without
 * writing into the final single re-freeze's reference corpus.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";
import { FIXTURE_INTAKE_IDS } from "./helpers/fixture-intake.js";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "narrow-1024x768", width: 1024, height: 768 },
] as const;

let server: FixtureServer;

async function openReview(page: Page, viewport: (typeof VIEWPORTS)[number]): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    intake: FIXTURE_INTAKE_IDS.validated,
  });
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

test("Fix and Exclude mount one labelled editor and focus its named input", async ({ page }) => {
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

  // Fix's onClick must close a still-open Exclude editor on the same row
  // (intake.tsx:869's `setExclusion(null)`) — otherwise both editors could
  // render for one row at once.
  await page.getByRole("button", { name: "Fix cell" }).first().click();
  await expect(exclusion).toHaveCount(0);
  await expect(correction).toBeVisible();
  await expect(correctedValue).toBeFocused();
});

test("Exclude remounts its editor and refocuses Reason when the operator switches rows", async ({ page }) => {
  await openReview(page, VIEWPORTS[0]);

  // Fixture note: exactly one rejected row here is Fix-eligible
  // (cell-coercion/field-schema), so the correction editor's own remount
  // (intake.tsx:899's `key`) cannot be exercised by a direct switch between
  // two open correction editors — there is nowhere to switch TO. The
  // exclusion editor (intake.tsx:939) offers two rows (both
  // duplicate-identity) that switch directly, non-null to non-null, which is
  // exactly the case a missing `key` fails to remount: React would reuse the
  // same input DOM node across rows and `autoFocus` would not refire.
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

    // Assert the NAME before reaching through the locator. A checkbox with no
    // accessible name is precisely the defect this spec exists to catch, and
    // `locator.evaluate` on a locator that never matches can only ever report
    // the test timeout — which says nothing about what is wrong. `toHaveCount`
    // fails at the expect deadline, naming the missing name.
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

    // Geometry alone is not a hit target. The enlarged label is only worth
    // anything if pressing its FAR CORNER — the part that is target and
    // nothing else — actually acknowledges the rejections.
    await expect(review).toHaveAttribute("aria-checked", "false");
    await page.mouse.click(labelProof.cornerX, labelProof.cornerY);
    await expect(review).toHaveAttribute("aria-checked", "true");
  });
}
