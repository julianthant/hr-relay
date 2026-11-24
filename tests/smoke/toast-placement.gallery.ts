/** Toasts stay top centre and clear of the Sessions panel: expanded by the keyboard, entering and leaving. */
import { expect, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { STATE_RULES } from "../support/helpers/dashboard/smoke/state-rules.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

const id = "sessions/toast/stack";

test("three toasts expanded by keyboard focus stay clear of the Sessions panel", async ({ mount, page, diagnostics }) => {
  const entry = CATALOGUE.find(item => item.id === id);
  if (entry === undefined) throw new Error(`the catalogue has no story ${id}`);
  await mount(id);
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(3);
  await page.locator('[data-slot="toast"]').first().focus();
  await expect(page.locator('[data-slot="toast"][data-expanded]').first()).toBeVisible();
  await page.waitForTimeout(600);
  const context = { page, storyId: id, story: entry.story, diagnostics, dialogShapes: new Map() };
  expect(await STATE_RULES["toast-placement"].check(context)).toEqual([]);
});

test("toasts enter and leave upward and stay above their resting place with motion on", async ({ mount, page }) => {
  await mount("probe/motion/toast");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  // When a toast starts to enter or leave, hold its transitions at points along the way and measure its bottom edge against where it rests.
  const moves = await page.evaluateHandle(() => {
    const recorded: { phase: string; below: number; above: number; overPanel: boolean }[] = [];
    const entered = new WeakSet<HTMLElement>();
    document.addEventListener("transitionrun", event => {
      const toast = event.target;
      const panel = document.querySelector('[aria-label="Session Panel"]');
      if (!(toast instanceof HTMLElement) || !toast.matches('[data-slot="toast"]') || panel === null || event.propertyName !== "transform") return;
      const leaving = toast.hasAttribute("data-ending-style");
      // A toast that is neither new nor leaving is only making room for another.
      if (!leaving && entered.has(toast)) return;
      entered.add(toast);
      const held = toast.getAnimations().map(animation => ({ animation, time: animation.currentTime, duration: Number(animation.effect?.getComputedTiming().duration ?? 0) }));
      const bottoms: number[] = [];
      for (let point = 0; point <= 10; point += 1) {
        for (const { animation, duration } of held) { animation.pause(); animation.currentTime = duration * Math.min(point / 10, 0.999); }
        bottoms.push(toast.getBoundingClientRect().bottom);
      }
      for (const { animation, time } of held) { animation.currentTime = time; animation.play(); }
      const rest = (leaving ? bottoms[0] : bottoms.at(-1)) ?? Number.NaN;
      recorded.push({ phase: leaving ? "exit" : "enter", below: Math.max(...bottoms) - rest, above: rest - Math.min(...bottoms), overPanel: Math.max(...bottoms) > panel.getBoundingClientRect().top });
    });
    return recorded;
  });
  const toasts = page.locator('[data-slot="toast"]');
  // A toast dismissed while it still enters reports its entry as an exit.
  const settled = () => expect.poll(() => toasts.evaluateAll(shown => shown.filter(toast => toast.hasAttribute("data-starting-style") || toast.getAnimations().length > 0).length), { message: "the toasts never came to rest" }).toBe(0);
  for (let count = 1; count <= 3; count += 1) {
    await page.getByRole("button", { name: "Raise toast" }).click();
    await expect(toasts).toHaveCount(count);
    await settled();
  }
  for (const title of ["Result 3", "Result 2", "Result 1"]) {
    const toast = toasts.filter({ hasText: title });
    await toast.press("Enter");
    await expect(toast).toHaveCount(0);
    await settled();
  }
  const seen = await moves.jsonValue();
  for (const phase of ["enter", "exit"]) {
    const ran = seen.filter(move => move.phase === phase);
    expect(ran.length, `${phase} transitions ran`).toBeGreaterThanOrEqual(3);
    expect(ran.filter(move => !(move.above > 20)), `every ${phase} moves in from or out to above`).toEqual([]);
  }
  expect(seen.filter(move => !(move.below <= 1) || move.overPanel), "no toast passes below its resting place or over the Sessions panel").toEqual([]);
});

test("dragging the front toast downward never moves it onto the Sessions panel", async ({ mount, page, diagnostics }) => {
  await page.setViewportSize({ width: 1280, height: 340 });
  const dragged = "sessions/toast/stack-described";
  const entry = CATALOGUE.find(item => item.id === dragged);
  if (entry === undefined) throw new Error(`the catalogue has no story ${dragged}`);
  await mount(dragged);
  await page.waitForTimeout(600);
  const front = page.locator('[data-slot="toast"]').first();
  const box = await front.boundingBox();
  if (box === null) throw new Error("the front toast is not drawn");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + step * 20);
  await page.waitForTimeout(350);
  expect(await STATE_RULES["toast-placement"].check({ page, storyId: dragged, story: entry.story, diagnostics, dialogShapes: new Map() })).toEqual([]);
  await page.mouse.up();
});
