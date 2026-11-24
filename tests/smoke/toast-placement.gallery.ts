/** Toasts stay bottom centre and clear of the Sessions panel: expanded by the keyboard, entering, leaving and dragged. */
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

test("toasts entering, leaving and dragged down stay above the open Sessions panel with motion on", async ({ mount, page }) => {
  await mount("probe/motion/toast");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  // Each time a toast starts to move, hold its transitions at ten points along the way and measure how far its box passes the panel's top edge.
  const moves = await page.evaluateHandle(() => {
    const recorded: { phase: string; property: string; past: number }[] = [];
    document.addEventListener("transitionrun", event => {
      const toast = event.target;
      const panel = document.querySelector('[aria-label="Session Panel"]');
      if (!(toast instanceof HTMLElement) || !toast.matches('[data-slot="toast"]') || panel === null) return;
      const held = toast.getAnimations().map(animation => ({ animation, time: animation.currentTime, duration: Number(animation.effect?.getComputedTiming().duration ?? 0) }));
      let past = -Infinity;
      for (let point = 0; point <= 9; point += 1) {
        for (const { animation, duration } of held) { animation.pause(); animation.currentTime = duration * point / 10; }
        past = Math.max(past, toast.getBoundingClientRect().bottom - panel.getBoundingClientRect().top);
      }
      for (const { animation, time } of held) { animation.currentTime = time; animation.play(); }
      recorded.push({ phase: toast.hasAttribute("data-ending-style") ? "exit" : "enter", property: event.propertyName, past });
    });
    return recorded;
  });
  const toasts = page.locator('[data-slot="toast"]');
  for (let count = 1; count <= 3; count += 1) {
    await page.getByRole("button", { name: "Raise toast" }).click();
    await expect(toasts).toHaveCount(count);
  }
  const front = toasts.filter({ hasText: "Result 3" });
  const panel = await page.getByRole("region", { name: "Session Panel" }).boundingBox();
  const box = await front.boundingBox();
  if (panel === null || box === null) throw new Error("the panel or the front toast has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 6 });
  const dragged = await front.boundingBox();
  expect((dragged?.y ?? Infinity) + (dragged?.height ?? 0), "a toast dragged down stays above the panel").toBeLessThanOrEqual(panel.y);
  await page.mouse.up();
  for (const title of ["Result 3", "Result 2", "Result 1"]) {
    const toast = toasts.filter({ hasText: title });
    // The drag's release may already have dismissed the front toast.
    await toast.evaluateAll((shown: HTMLElement[]) => { for (const element of shown) element.click(); });
    await expect(toast).toHaveCount(0);
  }
  const seen = await moves.jsonValue();
  for (const phase of ["enter", "exit"]) expect(seen.filter(move => move.phase === phase && move.property === "opacity").length, `${phase} transitions ran`).toBeGreaterThan(0);
  expect(seen.filter(move => move.past > 0), "no toast passes the panel's top edge on its way in or out").toEqual([]);
});
