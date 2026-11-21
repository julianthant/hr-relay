/** Proves the state rules bite: each planted violation, on real dashboard primitives, is reported by its rule. */
import { expect, GALLERY_OFF_SCHEDULE, GALLERY_SCHEDULE, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { STATE_RULE_NAMES } from "../support/helpers/dashboard/smoke/state-rule-limits.js";
import { STATE_RULES } from "../support/helpers/dashboard/smoke/state-rules.js";
import { RULE_PROBES, type RuleProbe } from "../support/helpers/dashboard/smoke/stories/rule-probe-stories.js";

test.skip(GALLERY_OFF_SCHEDULE, GALLERY_SCHEDULE);

const probes: readonly [string, RuleProbe][] = Object.entries(RULE_PROBES);

for (const [name, { story, finds, clean = [] }] of probes) {
  test(`${name}: ${story.title}`, async ({ mount, page, diagnostics }) => {
    const id = `probe/rule/${name}`;
    await mount(id);
    await expect(page.locator(story.ready ?? "[data-app-root]").first()).toBeVisible();
    const context = { page, storyId: id, story, diagnostics, dialogShapes: new Map() };
    for (const rule of STATE_RULE_NAMES) {
      const expected = finds[rule] ?? [];
      if (expected.length === 0 && !clean.includes(rule)) continue;
      const found = (await STATE_RULES[rule].check(context)).join("\n");
      if (clean.includes(rule)) expect(found, `${rule} reports nothing here`).toBe("");
      for (const pattern of expected) expect(found, `${rule} reports the planted violation`).toMatch(pattern);
    }
    // The planted state was on screen for every rule, not only when the story mounted.
    await expect(page.locator(story.ready ?? "[data-app-root]").first(), "the state held through the checks").toBeVisible();
  });
}
