/**
 * THE COARSE-POINTER MEMBER LINE, measured in a real engine.
 *
 * `MEMBER_TOUCH_TARGET` hangs a 44px `::after` overlay on a 24px toggle so a
 * finger can hit it, and the ONLY thing that keeps that overlay from reaching
 * into the member lines above and below is `ds/tokens.css`'s
 * `@media (pointer: coarse) { --ds-h-member-line: 44px }`. Those four lines
 * were deletable with every unit test green while a tap near a line boundary
 * marked the WRONG member checked — the wrong-person error this product exists
 * to prevent, argued for in prose and enforced by nothing.
 *
 * It cannot be pinned by a fold: the pitch is CSS and the hit area is the
 * engine's. So this spec emulates a coarse pointer and MEASURES — the pitch two
 * adjacent member lines actually resolve to, and the region of screen that
 * actually hit-tests to each toggle, scanned pixel by pixel out from its centre
 * rather than assumed from the class list. That distinction earned itself
 * immediately: the overlay reaches its full 44px across, and its own parent
 * clips it to the toggle's 24px of paint vertically (see NOTES).
 *
 * `hasTouch` is what makes Chromium report a coarse primary pointer;
 * `Emulation.setEmulatedMedia` does not carry the `pointer` feature, so the
 * emulation is a CONTEXT option and is asserted before anything is measured.
 *
 * No reference moves: nothing here is photographed. The corpus renders at
 * `pointer: fine`, and the fine-pointer control below is the reason that is
 * still true.
 */
import { expect, test, type Page } from "@playwright/test";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";

/** The floor a finger needs — WCAG 2.5.5 / the token's own reason for existing. */
const TOUCH_FLOOR = 44;

/** The dense desktop pitch the same token holds at `pointer: fine`, and the toggle's own paint. */
const DENSE_PITCH = 28;
const TOGGLE_PAINT = 24;

/**
 * How far above and below the toggle's centre the wrong-member probe sits. The
 * overlay is 44px and centred, so its own edges are at ±22; ±21 is one pixel
 * inside them, which is the point that must belong to this member and to no
 * other. At the fine-pointer 28px pitch it lands in a neighbour's row.
 */
const PROBE_REACH = 21;

const VIEWPORT = { width: 1440, height: 900 } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

/**
 * The emulation is ASSERTED rather than assumed (D187). A context option that
 * silently failed to move the primary pointer would leave every measurement
 * below running against the other layout, where the coarse test passes for the
 * wrong reason and the fine control passes for no reason at all.
 */
async function assertPointer(page: Page, pointer: "coarse" | "fine"): Promise<void> {
  const observed = await page.evaluate(() => ({
    coarse: matchMedia("(pointer: coarse)").matches,
    fine: matchMedia("(pointer: fine)").matches,
  }));
  if (observed.coarse !== (pointer === "coarse") || observed.fine !== (pointer === "fine")) {
    throw new Error(
      `the page did not adopt a ${pointer} pointer (coarse=${String(observed.coarse)}, `
      + `fine=${String(observed.fine)}); every measurement below would be of the wrong layout`,
    );
  }
}

/**
 * The Workflow Panel opens FLOATING, as a z-20 overlay across the queue's left
 * 200px — which is exactly where an indented member line's toggle sits. Hit
 * tests through it would measure the panel rather than the target, so the panel
 * is minimised to its icon first. Nothing else about the day changes.
 */
async function minimiseWorkflowPanel(page: Page): Promise<void> {
  const minimise = page.getByRole("button", { name: "Minimise the Workflow Panel to an icon" });
  await minimise.click();
  await expect(minimise).toHaveCount(0);
}

/** Offsets from the toggle's own centre, in CSS pixels. */
interface HitBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface MemberLine {
  readonly runId: string;
  /**
   * Which WELL the line belongs to. A group's well clips at five lines but
   * renders every member, so two rows from different groups can sit ten pixels
   * apart in page coordinates while being nowhere near each other on screen.
   * A pitch is only a pitch between siblings.
   */
  readonly wellKey: number;
  readonly rowTop: number;
  readonly rowBottom: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  /**
   * `null` when the toggle does not hit-test to itself at its own centre — a
   * member line laid out behind its own clipping well, which most of the day's
   * members are. Such a line has no edges worth probing.
   */
  readonly hit: HitBox | null;
}

/**
 * Every member line's geometry AND the region that actually hit-tests to its
 * toggle, read in ONE page evaluation so the pitch and the hit areas can never
 * be measured against two different layouts.
 *
 * The hit box is SCANNED, one pixel at a time out from the centre, rather than
 * read off the class list: the claim being pinned is about what the ENGINE
 * resolves, and a `::after` can be clipped by an ancestor that no class list
 * mentions.
 */
async function memberLines(page: Page): Promise<readonly MemberLine[]> {
  const lines = await page.evaluate((scan: number) => {
    const wells: Element[] = [];
    const toggles = [...document.querySelectorAll("button[aria-label^='Mark ']")];
    return toggles.flatMap((toggle) => {
      const row = toggle.closest("[data-demo-row-id]");
      const runId = row === null ? null : row.getAttribute("data-demo-row-id");
      const well = row === null ? null : row.parentElement;
      if (row === null || runId === null || well === null) return [];
      if (!wells.includes(well)) wells.push(well);
      const rowBox = row.getBoundingClientRect();
      const toggleBox = toggle.getBoundingClientRect();
      const centerX = toggleBox.left + (toggleBox.width / 2);
      const centerY = toggleBox.top + (toggleBox.height / 2);
      const claims = (x: number, y: number): boolean =>
        document.elementFromPoint(x, y)?.closest("button[aria-label^='Mark ']") === toggle;
      /** The CONTIGUOUS run of offsets out from the centre that this toggle claims. */
      const reach = (step: (offset: number) => boolean): { low: number; high: number } => {
        let low = 0;
        let high = 0;
        while (low > -scan && step(low - 1)) low -= 1;
        while (high < scan && step(high + 1)) high += 1;
        return { low, high };
      };
      let hit: HitBox | null = null;
      if (claims(centerX, centerY)) {
        const horizontal = reach((offset) => claims(centerX + offset, centerY));
        const vertical = reach((offset) => claims(centerX, centerY + offset));
        hit = { left: horizontal.low, right: horizontal.high, top: vertical.low, bottom: vertical.high };
      }
      return [{
        runId,
        wellKey: wells.indexOf(well),
        rowTop: rowBox.top,
        rowBottom: rowBox.bottom,
        height: rowBox.height,
        centerX,
        centerY,
        hit,
      }];
    });
  }, 40);
  if (lines.length < 2) {
    throw new Error(
      "the fixture day must draw at least two member lines carrying a checked-by-you toggle; "
      + `found ${String(lines.length)}`,
    );
  }
  return lines;
}

/** Which member row the engine says owns a point — the wrong-member question, asked directly. */
async function ownerAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(([px, py]: readonly number[]) => {
    const hit = document.elementFromPoint(px ?? 0, py ?? 0);
    const row = hit === null ? null : hit.closest("[data-demo-row-id]");
    return row === null ? null : row.getAttribute("data-demo-row-id");
  }, [x, y]);
}

/** The lines whose toggle the engine resolves at its own centre, refusing an empty measurement. */
function measurable(lines: readonly MemberLine[]): readonly (MemberLine & { hit: HitBox })[] {
  const onScreen = lines.flatMap((line) => (line.hit === null ? [] : [{ ...line, hit: line.hit }]));
  if (onScreen.length < 2) {
    throw new Error(
      `only ${String(onScreen.length)} member toggle(s) hit-tested to themselves, so nothing was measured; `
      + "a spec that measures nothing cannot fail",
    );
  }
  return onScreen;
}

test.describe("a coarse pointer", () => {
  test.use({ hasTouch: true, viewport: VIEWPORT });

  test("gives every member line the 44px pitch and keeps each toggle's reach inside its own row", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    await minimiseWorkflowPanel(page);

    const lines = await memberLines(page);

    // 1 — THE PITCH, which is the whole of `@media (pointer: coarse)`. A line
    // shorter than the floor cannot contain a 44px overlay at all, and two
    // lines stacked tighter than the floor guarantee that two overlays overlap.
    let comparedPitches = 0;
    for (const wellKey of new Set(lines.map((line) => line.wellKey))) {
      const stacked = lines.filter((line) => line.wellKey === wellKey).sort((a, b) => a.rowTop - b.rowTop);
      for (const [index, line] of stacked.entries()) {
        expect(line.height, `member line ${line.runId} is shorter than the touch floor`)
          .toBeGreaterThanOrEqual(TOUCH_FLOOR);
        const next = stacked[index + 1];
        if (next === undefined) continue;
        comparedPitches += 1;
        expect(
          next.rowTop - line.rowTop,
          `member lines ${line.runId} and ${next.runId} stack tighter than the touch floor`,
        ).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      }
    }
    expect(comparedPitches, "no two member lines were stacked in one well, so no pitch was measured")
      .toBeGreaterThan(0);

    const onScreen = measurable(lines);

    // 2 — THE OVERLAY IS LIVE IN BOTH AXES. 44px of reach across a control that
    // paints 24 is `pointer-coarse:after:size-11` and nothing else: ungate it,
    // shrink it, or drop the `relative` that positions it, and this collapses to
    // the paint.
    //
    // The HEIGHT is asserted separately from the width because the two failed
    // separately: `size-11` made the overlay 44px square, and the toggle's own
    // parent — the member line's `truncate` span — clipped it back to the 24px
    // of paint vertically while leaving the width untouched. A spec that
    // measured one axis called that fixed. A finger needs 44px of BOX, so both
    // axes are measured, and the height is the one that regresses invisibly.
    for (const line of onScreen) {
      expect(
        line.hit.right - line.hit.left + 1,
        `${line.runId}'s toggle reaches only its own paint horizontally, so no coarse-pointer overlay is live`,
      ).toBe(TOUCH_FLOOR);
      expect(
        line.hit.bottom - line.hit.top + 1,
        `${line.runId}'s toggle is only ${String(line.hit.bottom - line.hit.top + 1)}px tall to a finger — `
        + "an ancestor is clipping the coarse-pointer overlay back towards the 24px of paint",
      ).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    }

    // 3 — AND IT STAYS HOME. Whatever the overlay reaches must lie inside the
    // member's OWN row, and the points at its own edges must belong to this
    // member and to nobody else. At the fine-pointer 28px pitch both of those
    // probes land in the rows above and below — a tap that checks the wrong
    // person, which is the hazard the pitch exists to remove.
    for (const line of onScreen) {
      expect(line.centerY + line.hit.top, `${line.runId}'s hit area reaches above its own row`)
        .toBeGreaterThanOrEqual(line.rowTop);
      expect(line.centerY + line.hit.bottom, `${line.runId}'s hit area reaches below its own row`)
        .toBeLessThanOrEqual(line.rowBottom);
      for (const offset of [-PROBE_REACH, PROBE_REACH]) {
        expect(
          await ownerAt(page, line.centerX, line.centerY + offset),
          `the point ${String(offset)}px from ${line.runId}'s toggle belongs to another member`,
        ).toBe(line.runId);
      }
    }
  });
});

/**
 * THE CONTROL, and the reason the parity corpus did not have to be re-frozen:
 * a fine pointer gets none of this. Were the overlay ever ungated it would be
 * live here at the dense 28px pitch, reaching 22px out of a 28px row.
 */
test.describe("a fine pointer", () => {
  test.use({ viewport: VIEWPORT });

  test("keeps the dense member line and grows no overlay", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "fine");
    await minimiseWorkflowPanel(page);

    const lines = await memberLines(page);
    for (const line of lines) {
      expect(line.height, "a fine pointer must keep the dense member line, not the touch one")
        .toBeCloseTo(DENSE_PITCH, 0);
    }

    for (const line of measurable(lines)) {
      expect(
        line.hit.right - line.hit.left + 1,
        "an overlay live on a fine pointer would reach 22px out of a 28px row and steal a neighbour's click",
      ).toBe(TOGGLE_PAINT);
      // The height is the axis the coarse fix had to un-clip, so it is also the
      // axis by which that fix could leak past its gate. 24px here is the proof
      // it did not, and the reason the parity corpus still holds.
      expect(
        line.hit.bottom - line.hit.top + 1,
        "the coarse-pointer overlay has escaped its gate and grown the hit area on a mouse",
      ).toBe(TOGGLE_PAINT);
    }
  });
});
