/** The state check loop: every catalogue story, at both desktop sizes, against every state rule.
 * Run one surface alone with `--grep @<surface>`, for example `--grep @queue`. */
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, saveStateFrame, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { usesIndependentDialogReferences } from "../support/helpers/dashboard/smoke/gallery-shards.js";
import { STATE_RULE_NAMES } from "../support/helpers/dashboard/smoke/state-rule-limits.js";
import { STATE_RULES, type StateRuleContext } from "../support/helpers/dashboard/smoke/state-rules.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

const dialogShapes: StateRuleContext["dialogShapes"] = new Map();

function galleryTags(id: string, surface: string): string[] {
  return usesIndependentDialogReferences(id) ? [`@${surface}`, `@gallery-group:${id.split("/").slice(0, 2).join("/")}`] : [`@${surface}`];
}

test.describe.configure({ mode: "parallel" });

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`states at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.describe.configure({ mode: "default" });
    test.use({ viewport });

    for (const { id, surface, story } of CATALOGUE) {
      test(`${id} passes the state rules`, { tag: galleryTags(id, surface) }, async ({ mount, page, diagnostics }) => {
        if (story.clock === true) await page.clock.install();
        await mount(id);
        await story.play?.(page);
        // The story's own ready point: the state it is for is on screen, whatever its requests are still doing.
        await expect(page.locator(story.ready ?? "[data-app-root]").first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await saveStateFrame(page, id, viewport.width);
        const context: StateRuleContext = { page, storyId: id, story, diagnostics, dialogShapes };
        for (const name of STATE_RULE_NAMES) {
          if (story.knownFailures?.[name] !== undefined && (story.knownFailureWidths?.[name] ?? [viewport.width]).includes(viewport.width)) continue;
          await test.step(name, async () => {
            expect.soft(await STATE_RULES[name].check(context), STATE_RULES[name].failure).toEqual([]);
          });
        }
      });
    }

    // Recorded breaks run after every story has passed, so a rule that compares stories has its reference by then.
    for (const { id, surface, story } of CATALOGUE) {
      const known = STATE_RULE_NAMES.flatMap(name => {
        const ticket = story.knownFailures?.[name];
        return ticket === undefined || !(story.knownFailureWidths?.[name] ?? [viewport.width]).includes(viewport.width) ? [] : [{ name, ticket }];
      });

      if (known.length === 0) continue;
      const annotation = [...new Set(known.map(({ ticket }) => ticket))].map(ticket => ({ type: "issue", description: ticket }));
      test(`${id} has its recorded breaks`, { tag: galleryTags(id, surface), annotation }, async ({ mount, page, diagnostics }) => {
        if (story.clock === true) await page.clock.install();
        await mount(id);
        await story.play?.(page);
        await expect(page.locator(story.ready ?? "[data-app-root]").first()).toBeVisible();
        for (const { name, ticket } of known) {
          await test.step(`${name} (${ticket})`, async () => {
            const found = await STATE_RULES[name].check({ page, storyId: id, story, diagnostics, dialogShapes });
            expect.soft(found.length, `${name} no longer finds the recorded break for ${ticket}`).toBeGreaterThan(0);
          });
        }
      });
    }
  });
}
