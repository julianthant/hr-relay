/** D340: desktop control density and hit ownership, measured in the built browser. */
import { expect,test,type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";


/** The dense desktop pitch the same token holds at `pointer: fine`, and the toggle's own paint. */
const DENSE_PITCH = 28;
const TOGGLE_PAINT = 24;

/** The row ⓘ's own paint: `IconButton size="xs"` is `--ds-h-xs`. */
const INFO_PAINT = 20;

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
async function assertDesktopPointer(page: Page): Promise<void> {
  expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
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

/** The member line's OTHER control: the name, which is also the row's selection. */
interface NameButton {
  readonly left: number;
  readonly right: number;
  readonly centerX: number;
  readonly centerY: number;
  /** `null` on the same terms as a toggle's: the line is behind its own well. */
  readonly hit: HitBox | null;
  /**
   * Which control the engine hands the LAST PIXEL of the name to. A 44px overlay
   * centred on the 24px toggle reaches ~10px back along this button, and the gap
   * between them is `--ds-space-tight` — so on an unchecked line a tap on the
   * end of a truncated name toggled the checkbox instead of selecting the row.
   */
  readonly tailOwner: "name" | "toggle" | "other";
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
  readonly name: NameButton;
  /** The distance from the name's right edge to the toggle's painted left edge. */
  readonly nameToToggle: number;
}

/**
 * The top-level row's ⓘ, and the CARD it lives in.
 *
 * The card is `overflow-hidden`, which is what makes its own box the containment
 * boundary: an overlay that overflowed it would be clipped rather than land in
 * the card above. So the card's rectangle is measured beside the trigger's hit
 * area — a 44px target that is 44px only because it hangs into the next row is
 * the same defect in a different axis.
 */
interface InfoTrigger {
  readonly runId: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly cardTop: number;
  readonly cardBottom: number;
  readonly hit: HitBox | null;
}

interface Measured {
  readonly lines: readonly MemberLine[];
  readonly infos: readonly InfoTrigger[];
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
async function measure(page: Page): Promise<Measured> {
  const measured = await page.evaluate((scan: number) => {
    /** Does the engine hand this exact point to this exact control? */
    const claims = (control: Element, x: number, y: number): boolean => {
      const at = document.elementFromPoint(x, y);
      return at !== null && (at === control || at.closest("button") === control);
    };
    /** The CONTIGUOUS run of offsets out from a centre that a control claims. */
    const reach = (step: (offset: number) => boolean): { low: number; high: number } => {
      let low = 0;
      let high = 0;
      while (low > -scan && step(low - 1)) low -= 1;
      while (high < scan && step(high + 1)) high += 1;
      return { low, high };
    };
    const hitBox = (control: Element, centerX: number, centerY: number) => {
      if (!claims(control, centerX, centerY)) return null;
      const horizontal = reach((offset) => claims(control, centerX + offset, centerY));
      const vertical = reach((offset) => claims(control, centerX, centerY + offset));
      return { left: horizontal.low, right: horizontal.high, top: vertical.low, bottom: vertical.high };
    };

    const wells: Element[] = [];
    const lines = [...document.querySelectorAll("button[aria-label^='Mark ']")].flatMap((toggle) => {
      const row = toggle.closest("[data-demo-row-id]");
      const runId = row === null ? null : row.getAttribute("data-demo-row-id");
      const well = row === null ? null : row.parentElement;
      // The member line's OTHER button: the name, which is the row's selection.
      const nameButton = row === null ? null : row.querySelector("button:not([aria-label^='Mark '])");
      if (row === null || runId === null || well === null || nameButton === null) return [];
      if (!wells.includes(well)) wells.push(well);
      const rowBox = row.getBoundingClientRect();
      const toggleBox = toggle.getBoundingClientRect();
      const nameBox = nameButton.getBoundingClientRect();
      const centerX = toggleBox.left + (toggleBox.width / 2);
      const centerY = toggleBox.top + (toggleBox.height / 2);
      const nameCenterX = nameBox.left + (nameBox.width / 2);
      const nameCenterY = nameBox.top + (nameBox.height / 2);
      // The LAST pixel of the name, which is the pixel the toggle's overlay
      // reaches back to. `elementFromPoint` takes the point, not the box.
      const tail = document.elementFromPoint(nameBox.right - 1, nameCenterY);
      const tailButton = tail === null ? null : tail.closest("button");
      const tailOwner: "name" | "toggle" | "other" =
        tailButton === nameButton ? "name" : (tailButton === toggle ? "toggle" : "other");
      return [{
        runId,
        wellKey: wells.indexOf(well),
        rowTop: rowBox.top,
        rowBottom: rowBox.bottom,
        height: rowBox.height,
        centerX,
        centerY,
        hit: hitBox(toggle, centerX, centerY),
        nameToToggle: toggleBox.left - nameBox.right,
        name: {
          left: nameBox.left,
          right: nameBox.right,
          centerX: nameCenterX,
          centerY: nameCenterY,
          hit: hitBox(nameButton, nameCenterX, nameCenterY),
          tailOwner,
        },
      }];
    });

    const infos = [...document.querySelectorAll("button[aria-label^='What is this row?']")].flatMap((trigger) => {
      const card = trigger.closest("[data-demo-row-id]");
      const runId = card === null ? null : card.getAttribute("data-demo-row-id");
      if (card === null || runId === null) return [];
      const cardBox = card.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      const centerX = triggerBox.left + (triggerBox.width / 2);
      const centerY = triggerBox.top + (triggerBox.height / 2);
      return [{
        runId,
        centerX,
        centerY,
        cardTop: cardBox.top,
        cardBottom: cardBox.bottom,
        hit: hitBox(trigger, centerX, centerY),
      }];
    });

    return { lines, infos };
  }, 40);
  if (measured.lines.length < 2) {
    throw new Error(
      "the fixture day must draw at least two member lines carrying a checked-by-you toggle; "
      + `found ${String(measured.lines.length)}`,
    );
  }
  if (measured.infos.length < 1) {
    throw new Error("the fixture day must draw at least one top-level row carrying the ⓘ trigger; found none");
  }
  return measured;
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

/** The ⓘ triggers the engine resolves at their own centre, refusing an empty measurement. */
function measurableInfos(infos: readonly InfoTrigger[]): readonly (InfoTrigger & { hit: HitBox })[] {
  const onScreen = infos.flatMap((info) => (info.hit === null ? [] : [{ ...info, hit: info.hit }]));
  if (onScreen.length < 1) {
    throw new Error(
      "no row ⓘ hit-tested to itself, so nothing was measured; a spec that measures nothing cannot fail",
    );
  }
  return onScreen;
}

/**
 * THE CONTROL, and the reason the parity corpus did not have to be re-frozen:
 * a fine pointer gets none of this. Were the overlay ever ungated it would be
 * live here at the dense 28px pitch, reaching 22px out of a 28px row.
 */
test.describe("desktop member controls", () => {
  test.use({ viewport: VIEWPORT });

  test("keeps the dense member line and grows no overlay", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertDesktopPointer(page);
    await minimiseWorkflowPanel(page);

    const { lines, infos } = await measure(page);
    for (const line of lines) {
      expect(line.height, "desktop member lines retain their dense pitch")
        .toBeCloseTo(DENSE_PITCH, 0);
    }

    // The ⓘ keeps its own paint and nothing more. An ungated overlay here would
    // put 44px of invisible target over a 20px control in a dense row, where the
    // card underneath it is itself the row's select button.
    for (const info of measurableInfos(infos)) {
      expect(
        info.hit.right - info.hit.left + 1,
        "the row information control must retain its own horizontal hit area",
      ).toBe(INFO_PAINT);
      expect(
        info.hit.bottom - info.hit.top + 1,
        "the row information control must retain its own vertical hit area",
      ).toBe(INFO_PAINT);
    }

    for (const line of measurable(lines)) {
      // The name button grows only on a coarse pointer: at the dense 28px pitch
      // a 44px name would overlap the lines above and below it.
      const nameHit = line.name.hit;
      if (nameHit !== null) {
        expect(
          nameHit.bottom - nameHit.top + 1,
          "the name button must remain within its member line",
        ).toBeLessThanOrEqual(DENSE_PITCH);
      }
      expect(
        line.hit.right - line.hit.left + 1,
        "an overlay live on a fine pointer would reach 22px out of a 28px row and steal a neighbour's click",
      ).toBe(TOGGLE_PAINT);
      // The height is the axis the coarse fix had to un-clip, so it is also the
      // axis by which that fix could leak past its gate. 24px here is the proof
      // it did not, and the reason the parity corpus still holds.
      expect(
        line.hit.bottom - line.hit.top + 1,
        "the toggle must retain its own vertical hit area",
      ).toBe(TOGGLE_PAINT);
    }
  });
});
