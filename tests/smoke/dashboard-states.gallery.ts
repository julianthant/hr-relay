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
      const known = STATE_RULE_NAMES.flatMap(name => {
        const ticket = story.knownFailures?.[name];
        return ticket === undefined ? [] : [{ name, ticket }];
      });

      test(`${id} passes the state rules`, { tag: `@${surface}` }, async ({ mount, page, diagnostics }) => {
        const root = await mount(id);
        await expect(root.locator("[data-app-root]")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        // A request the story starts must settle before the diagnostics rule reads what failed.
        await page.waitForLoadState("networkidle");
        await saveStateFrame(page, id, viewport.width);
        const context: StateRuleContext = { page, storyId: id, story, diagnostics, dialogShapes };
        for (const name of STATE_RULE_NAMES) {
          if (known.some(recorded => recorded.name === name)) continue;
          await test.step(name, async () => {
            expect.soft(await STATE_RULES[name].check(context), STATE_RULES[name].failure).toEqual([]);
          });
        }
      });

      for (const { name, ticket } of known) {
        test(`${id} breaks ${name} (${ticket})`, { tag: `@${surface}`, annotation: { type: "issue", description: ticket } }, async ({ mount, page, diagnostics }) => {
          test.fail(true, `${ticket}: ${STATE_RULES[name].failure}`);
          const root = await mount(id);
          await expect(root.locator("[data-app-root]")).toBeVisible();
          await page.waitForLoadState("networkidle");
          expect(await STATE_RULES[name].check({ page, storyId: id, story, diagnostics, dialogShapes }), STATE_RULES[name].failure).toEqual([]);
        });
      }
    }
  });
}
