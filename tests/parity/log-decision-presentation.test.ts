import { chooseSelect } from "./helpers/select-choice.js";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { logDecisionExamples } from "../../src/dashboard/surfaces/run-detail/logs/log-decision-fixture.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";


for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `log-decisions-${theme.attribute}-${width}.a11y.yml`;
  test(`approved log decisions and viewer @ ${theme.attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidence }] }, async ({ page }, _info) => {
    ensureParityBundle();
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
          const block = surface.getByRole("article", { name: example.entry.decision.title, exact: true });
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
      await surface.locator(".log-decision").scrollIntoViewIfNeeded();
      const parked = surface.getByRole("article", { name: "File termination", exact: true });
      expect(await parked.locator(".log-caution").evaluate(node => { const r = node.getBoundingClientRect(), parent = node.parentElement!.getBoundingClientRect(); return r.x > parent.x + 25 && r.width < parent.width; })).toBe(true);
      await parked.getByRole("button", { name: "Check result", exact: true }).click();
      let form = page.getByRole("dialog", { name: "Check result", exact: true });
      await expect(form.getByRole("button", { name: "Continue run", exact: true })).toBeDisabled();
      await expect(form.getByRole("textbox")).toHaveCount(0);
      await form.getByRole("radio", { name: "Yes, it was submitted", exact: true }).check();
      await expect(form.getByRole("button", { name: "Continue run", exact: true })).toBeDisabled();
      await form.getByRole("textbox", { name: /^Transaction number/u }).fill("SIM-042");
      await form.getByRole("button", { name: "Continue run", exact: true }).click();
      await expect(parked.getByRole("button", { name: "Check result", exact: true })).toHaveCount(0);
      await expect(parked.locator("figure")).toHaveCount(1);
      const result = surface.getByText("Termination confirmed. Transaction SIM-042 is present. Continued to Finalize Kuali document.", { exact: true });
      await expect(result).toBeFocused();
      expect(await result.evaluate(node => node.closest("article"))).toBeNull();

      await chooseScenario( "review-candidates");
      await surface.getByRole("button", { name: "Choose employee", exact: true }).click();
      form = page.getByRole("dialog", { name: "Choose employee", exact: true });
      await expect(form.getByRole("button", { name: "Continue run", exact: true })).toBeDisabled();
      await form.getByRole("radio", { name: /DEMO-2196/u }).check();
      await form.getByRole("button", { name: "Continue run", exact: true }).click();
      await expect(surface).toContainText("Selected DEMO-2196.");

      await chooseScenario( "review-fields");
      await surface.getByRole("button", { name: "Enter date", exact: true }).click();
      form = page.getByRole("dialog", { name: "Enter date", exact: true });
      await expect(form.getByRole("button", { name: "Continue run", exact: true })).toBeDisabled();
      await form.getByRole("button", { name: /^Choose last day worked date/u }).click();
      const calendar = page.getByRole("dialog", { name: "Choose last day worked date", exact: true });
      await expect(calendar).toBeVisible();
      await expect(calendar.getByRole('button', { name: /year selector/u })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(calendar).toBeHidden();
      await expect(form).toBeVisible();
      for (const [segment, value] of [["month", "9"], ["day", "25"], ["year", "2026"]]) {
        await form.getByRole("spinbutton", { name: `${segment}, Last day worked*`, exact: true }).focus();
        await page.keyboard.type(value);
      }
      await form.getByRole("button", { name: "Continue run", exact: true }).click();
      await expect(surface).toContainText("Last day worked: 2026-09-25.");

      await chooseScenario( "failure-prepared");
      await surface.locator(".log-decision").scrollIntoViewIfNeeded();
      const failure = surface.getByRole("article", { name: "File termination", exact: true });
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
