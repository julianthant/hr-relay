/** The state check loop: every catalogue story, at both desktop sizes, against every state rule.
 * Run one surface alone with `--grep @<surface>`, for example `--grep @queue`. */
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, saveStateFrame, test, writeStateFrameIndex } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { STATE_RULE_NAMES } from "../support/helpers/dashboard/smoke/state-rule-limits.js";
import { STATE_RULES, type StateRuleContext } from "../support/helpers/dashboard/smoke/state-rules.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

const dialogShapes: StateRuleContext["dialogShapes"] = new Map();

test.afterAll(() => {
  writeStateFrameIndex(CATALOGUE, DESKTOP_VIEWPORTS.map(viewport => viewport.width));
});

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`states at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    for (const { id, surface, story } of CATALOGUE) {
      test(`${id} passes the state rules`, { tag: `@${surface}` }, async ({ mount, page, diagnostics }) => {
        await mount(id);
        // The story's own ready point: the state it is for is on screen, whatever its requests are still doing.
        await expect(page.locator(story.ready ?? "[data-app-root]").first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await saveStateFrame(page, id, viewport.width);
        const context: StateRuleContext = { page, storyId: id, story, diagnostics, dialogShapes };
        for (const name of STATE_RULE_NAMES) {
          if (story.knownFailures?.[name] !== undefined) continue;
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
        return ticket === undefined ? [] : [{ name, ticket }];
      });

      for (const { name, ticket } of known) {
        test(`${id} breaks ${name} (${ticket})`, { tag: `@${surface}`, annotation: { type: "issue", description: ticket } }, async ({ mount, page, diagnostics }) => {
          await mount(id);
          await expect(page.locator(story.ready ?? "[data-app-root]").first()).toBeVisible();
          const found = await STATE_RULES[name].check({ page, storyId: id, story, diagnostics, dialogShapes });
          // Only the recorded break may fail from here on; a broken mount or rule has already thrown.
          test.fail(true, `${ticket}: ${STATE_RULES[name].failure}`);
          expect(found, STATE_RULES[name].failure).toEqual([]);
        });
      }
    }
  });
}
