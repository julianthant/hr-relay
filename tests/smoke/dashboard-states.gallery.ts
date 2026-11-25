/** The state check loop: every catalogue story, at both desktop sizes, against every state rule.
 * Run one surface alone with `--grep @<surface>`, for example `--grep @queue`. */
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, saveStateFrame, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { usesIndependentDialogReferences } from "../support/helpers/dashboard/smoke/gallery-shards.js";
import { STATE_RULE_NAMES, type StateRuleName } from "../support/helpers/dashboard/smoke/state-rule-limits.js";
import { STATE_RULES, type StateRuleContext } from "../support/helpers/dashboard/smoke/state-rules.js";
import { storyOf } from "../support/helpers/dashboard/smoke/story-catalogue.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

const dialogShapes: StateRuleContext["dialogShapes"] = new Map();

function galleryTags(id: string, surface: string): string[] {
  return usesIndependentDialogReferences(id) ? [`@${surface}`, `@gallery-group:${id.split("/").slice(0, 2).join("/")}`] : [`@${surface}`];
}

async function checkRule(name: StateRuleName, context: StateRuleContext, ticket?: string): Promise<void> {
  const tabStops: string[] = [];
  const found = await STATE_RULES[name].check({ ...context, recordTabStop: element => { tabStops.push(element); } });
  const failed = ticket === undefined ? found.length > 0 : found.length === 0;
  const trace = failed && tabStops.length > 0
    ? `\ndocument.activeElement after each Tab:\n${tabStops.map((element, index) => `${String(index + 1)}. ${element}`).join("\n")}`
    : "";
  if (ticket === undefined) expect.soft(found, STATE_RULES[name].failure + trace).toEqual([]);
  else expect.soft(found.length, `${name} no longer finds the recorded break for ${ticket}${trace}`).toBeGreaterThan(0);
}

test.describe.configure({ mode: "parallel" });

const cancellingStory = "sign-in/action/cancelling";
test("the keyboard walk reaches controls before the restored sign-up focus", { tag: galleryTags(cancellingStory, "sign-in") }, async ({ mount, page, diagnostics }) => {
  const storyId = cancellingStory;
  const story = storyOf(CATALOGUE, storyId);
  const context: StateRuleContext = { page, storyId, story, diagnostics, dialogShapes };
  await mount(storyId);
  await story.play?.(page);
  await expect(page.getByRole("button", { name: "Cancelling…" })).toBeVisible();
  // Reproduce the closing dialog restoring focus after the story's reset.
  await page.getByRole("heading", { name: "Set up Duo", exact: true }).focus();

  await checkRule("named-and-focusable", context);

  await page.getByRole("button", { name: "Your details", exact: true }).evaluate(button => { button.tabIndex = -1; });
  await page.evaluate(() => {
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Skipped group");
    group.tabIndex = -1;
    group.textContent = "Skipped group";
    document.body.append(group);
  });
  expect(await STATE_RULES["named-and-focusable"].check(context)).toEqual([
    '"Your details" cannot be reached with the keyboard',
    '"Skipped group" cannot be reached with the keyboard',
  ]);
});

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
          await test.step(name, () => checkRule(name, context));
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
        const context: StateRuleContext = { page, storyId: id, story, diagnostics, dialogShapes };
        for (const { name, ticket } of known) {
          await test.step(`${name} (${ticket})`, () => checkRule(name, context, ticket));
        }
      });
    }
  });
}
