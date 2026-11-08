import { chooseSelect } from "./helpers/select-choice.js";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { logDecisionExamples } from "../../src/dashboard/surfaces/run-detail/logs/log-decision-fixture.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";


for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `log-decisions-${theme.attribute}-${width}.a11y.yml`;
  test(`approved log decisions and viewer @ ${theme.attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidence }] }, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], effects: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { const path = new URL(request.url()).pathname; if (request.method() !== "GET" || /\/api\/v1\/runs\/[^/]+(?:\/|$)/u.test(path)) effects.push(`${request.method()} ${path}`); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      const surface = page.getByRole("region", { name: "Selected run logs", exact: true });
      await expect(surface.getByRole("combobox", { name: "Logs sample data" })).toHaveCount(0);
      const chooseScenario = async (id: string) => { await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}&logPreview=${id}`); await page.getByRole("button", { name: "Close assistant", exact: true }).click(); };
      for (const example of logDecisionExamples) {
        await chooseScenario( example.id);
        if (example.entry.kind === "decision") {
          const block = surface.getByRole("group", { name: example.entry.decision.title, exact: true });
          await block.scrollIntoViewIfNeeded();
          await expect(block).toBeVisible();
          await expect(block.locator("time")).toHaveCount(0);
          await expect(block.locator("details")).toHaveCount(0);
          for (const image of await block.locator(".log-capture-viewport img").all()) {
            await image.scrollIntoViewIfNeeded();
            await expect(image).toHaveJSProperty("naturalWidth", 850);
          }
          await expect(block.getByRole("alert")).toHaveCount(0);
        } else await expect(surface).toContainText(example.entry.message);

      }
      await chooseScenario( "parked");
      const parked = surface.getByRole("group", { name: "Did the termination save in UCPath?", exact: true });
      await parked.scrollIntoViewIfNeeded();
      await expect(parked).toContainText("Submit did not confirm. Check Smart HR Transactions in UCPath.");
      const confirm = parked.getByRole("button", { name: "Confirm", exact: true });
      const transaction = parked.getByRole("textbox", { name: /^Transaction number/u });
      await expect(confirm).toBeDisabled();
      await transaction.fill("SIM-042");
      await expect(confirm).toBeDisabled();
      await transaction.fill("T00042871");
      await confirm.click();
      await expect(surface).toContainText("Answered: Saved in UCPath");
      await expect(parked.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);

      await chooseScenario( "review-candidates");
      const pick = surface.getByRole("group", { name: "Which Alex Morgan is this run about?", exact: true });
      await expect(pick.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
      await pick.getByRole("radio", { name: "Morgan, Alex", exact: true }).click();
      await expect(pick.getByRole("radio", { name: "Morgan, Alex", exact: true })).toHaveAttribute("aria-checked", "true");
      await pick.getByRole("textbox", { name: "Enter employee ID", exact: true }).fill("10000077");
      await expect(pick.getByRole("radio", { name: "Morgan, Alex", exact: true })).toHaveAttribute("aria-checked", "false");
      await pick.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(surface).toContainText("Answered: Morgan, Alexis");

      await chooseScenario( "review-fields");
      const date = surface.getByRole("group", { name: "Confirm the last day worked", exact: true });
      const enter = date.getByRole("button", { name: "Enter date", exact: true });
      await expect(enter).toBeDisabled();
      await date.getByRole("button", { name: /^Choose last day worked date/u }).click();
      const calendar = page.getByRole("dialog", { name: "Choose last day worked date", exact: true });
      await expect(calendar).toBeVisible();
      await expect(calendar.getByRole('button', { name: /year selector/u })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(calendar).toBeHidden();
      await expect(enter).toBeVisible();
      for (const [segment, value] of [["month", "9"], ["day", "25"], ["year", "2026"]]) {
        await date.getByRole("spinbutton", { name: new RegExp(`^${segment}, Last day worked`, "u") }).focus();
        await page.keyboard.type(value);
      }
      await enter.click();
      await expect(surface).toContainText("Answered: Enter date");

      await chooseScenario( "failure-prepared");
      const failure = surface.getByRole("group", { name: "File termination", exact: true });
      await failure.scrollIntoViewIfNeeded();
      await expect(failure).toContainText("While trying to enter last day worked");
      await expect(failure).toContainText("Last completed · Employee and employment record confirmed");
      await expect(failure.locator("figure")).toHaveCount(3);
      const stages = surface.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button");
      await expect(stages).toHaveCount(5);
      for (let index = 0; index < 3; index++) await expect(stages.nth(index)).toHaveAttribute("aria-label", /Completed/u);
      await expect(stages.nth(3)).toHaveAttribute("aria-label", /Failed/u);
      await expect(stages.nth(4)).toBeDisabled();
      await expect(surface.getByRole("navigation", { name: "Run timeline", exact: true })).not.toContainText("Upcoming");

      const trigger = failure.getByRole("button", { name: /^Enlarge screenshot captured at/u }).first();
      await trigger.click();
      await expect(page.getByRole("dialog", { name: "UCPath · Failed action", exact: true })).toBeVisible();
      const viewer = page.locator(".log-viewer-dialog");
      await expect(viewer.locator(".log-capture-tab")).toHaveCount(3);
      expect(await viewer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await viewer.getByRole("button", { name: "100%", exact: true }).click();
      await expect(viewer.locator(".log-viewer-image")).toHaveCSS("width", "850px");
      await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect(viewer.locator(".log-zoom")).toHaveText("125%");
      await page.keyboard.press("-");
      await expect(viewer.locator(".log-zoom")).toHaveText("100%");
      await page.keyboard.press("r");
      expect((await viewer.locator(".log-image-stage").boundingBox())!.width).toBe(1050);
      await viewer.getByRole("button", { name: "Whole image", exact: true }).click();
      expect(await viewer.locator(".log-image-viewport").evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect(viewer.locator(".log-viewer-image")).toHaveAttribute("src", "/logs-preview/kuali-request.svg");
      await page.keyboard.press("ArrowLeft");
      await viewer.getByRole("button", { name: "Compare captures", exact: true }).click();
      await expect(viewer.locator(".log-image-viewport")).toHaveCount(2);
      await chooseSelect(viewer.getByRole("combobox", { name: "Comparison capture", exact: true }), "2");
      await expect(viewer.locator(".log-pane-title").nth(1)).toContainText("Kronos");

      await page.mouse.click(8, 300);
      await expect(viewer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await chooseScenario( "separation");
      await surface.getByRole("searchbox", { name: "Search logs" }).fill("Document number");
      await page.route("**/logs-preview/kuali-search.svg", route => route.abort());
      await chooseScenario( "empty");
      await chooseScenario( "separation");
      const screenshot = surface.locator("figure").first();
      await screenshot.scrollIntoViewIfNeeded();
      await expect(screenshot.getByRole("alert")).toHaveText("Screenshot could not be loaded.");
      await page.unroute("**/logs-preview/kuali-search.svg");
      await screenshot.getByRole("button", { name: "Retry screenshot", exact: true }).click();
      await expect(screenshot.locator("img")).toHaveJSProperty("naturalWidth", 850);
      await expect(screenshot.getByRole("alert")).toHaveCount(0);
      const snapshot = await surface.ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(evidence, { body: snapshot, contentType: "text/yaml" });
      expect(errors).toEqual([]);
      expect(effects).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });
}
