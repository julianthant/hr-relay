
import { expect, type Locator } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/u);
    if (!channels) throw new Error(`palette-color-not-opaque: ${color}`);
    const linear = channels.slice(1).map(value => {
      const channel = Number(value) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
}

async function paintedBackground(node: Locator): Promise<string> {
  return node.evaluate(element => {
    let current: Element | null = element;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)") return color;
      current = current.parentElement;
    }
    throw new Error("palette-opaque-ancestor-missing");
  });
}

async function checkAliases(node: Locator) {
  const mismatches = await node.evaluate(element => {
    const style = getComputedStyle(element);
    const pairs = [
      ["--background", "--ui-canvas"], ["--card", "--ui-panel"], ["--muted", "--ui-table"],
      ["--ds-surface-page", "--ui-canvas"], ["--ds-surface-1", "--ui-panel"],
      ["--ds-surface-2", "--ui-table"], ["--ds-surface-overlay", "--ui-panel"],
      ["--ds-body-surface-page", "--ui-canvas"], ["--ds-body-surface-control", "--ui-table"],
      ["--ds-settings-canvas", "--ui-canvas"], ["--ds-settings-card", "--ui-panel"],
      ["--ds-control-bg", "--ui-table"], ["--ds-fg", "--ui-primary"],
    ];
    return pairs.filter(([alias, source]) => style.getPropertyValue(alias).trim() !== style.getPropertyValue(source).trim());
  });
  expect(mismatches).toEqual([]);
}

async function attachTree(node: Locator, name: string) {
  const tree = await node.ariaSnapshot();
  test.info().annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(tree).digest("hex") });
  await test.info().attach(name, { body: tree, contentType: "text/yaml" });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`one neutral dashboard palette @ ${theme.attribute} ${width}`, { annotation: ["logs", "explorer", "activity", "settings", "dialog"].map(name => ({ type: "required-a11y-evidence", description: `palette-${name}-${theme.attribute}-${width}.a11y.yml` })) }, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const palette = theme.attribute === "dark"
        ? { canvas: "rgb(24, 24, 24)", panel: "rgb(34, 34, 34)", table: "rgb(43, 43, 43)" }
        : { canvas: "rgb(250, 250, 250)", panel: "rgb(255, 255, 255)", table: "rgb(244, 244, 244)" };
      const writes: string[] = [];
      page.on("request", request => { if (request.method() !== "GET") writes.push(request.method() + " " + new URL(request.url()).pathname); });
      for (const [name, path] of [
        ["logs", `/?day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}`],
        ["explorer", "/?explore=fixture-ui-explorer"], ["activity", "/?activity="],
        ["settings", "/?settings="],
      ]) {
        await page.goto(server.baseUrl + path);
        const root = page.locator("[data-app-root]");
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(root).toHaveCSS("background-color", palette.canvas);
        await checkAliases(root);
        await checkAliases(page.locator("body"));
        await expect(page.getByRole("complementary", { name: "Workspace", includeHidden: true })).toHaveCSS("background-color", palette.panel);
        if (name === "logs") {
          const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
          await expect(logs).toBeVisible();
          await checkAliases(logs);
          await expect(logs.getByRole("region", { name: "Run logs", exact: true }).locator("..")).toHaveCSS("background-color", palette.panel);
          await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true })).toHaveCSS("background-color", palette.panel);
          await expect(logs.locator(".bg-ui-table").first()).toHaveCSS("background-color", palette.table);
          await expect(logs.locator("header").first()).toHaveCSS("background-color", palette.table);
        } else if (name === "explorer" || name === "activity") {
          expect(await paintedBackground(page.getByRole("region", { name: name === "explorer" ? "Workflow explorer preview" : "Analytics report", exact: true }))).toBe(palette.canvas);
        } else if (name === "settings") {
          expect(await paintedBackground(page.getByRole("region", { name: "Settings", exact: true }))).toBe(palette.canvas);
        }
        const sessions = page.getByRole("region", { name: "Session Panel", exact: true });
        await page.getByRole("button", { name: "Sessions", exact: true }).click();
        const strip = sessions.locator("[data-session-strip]");
        await expect(strip.locator("..")).toHaveCSS("background-color", palette.canvas);
        await expect(sessions.getByRole("article").first()).toHaveCSS("background-color", palette.panel);
        await expect(sessions.getByRole("listitem").first()).toHaveCSS("background-color", palette.table);
        await checkAliases(sessions);
        await page.mouse.move(0, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        await attachTree(page.locator("body"), `palette-${name}-${theme.attribute}-${width}.a11y.yml`);
      }
      const add = page.getByRole("region", { name: "Session Panel", exact: true }).getByRole("button", { name: "Add workers", exact: true });
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add workers", exact: true });
      await expect(dialog).toHaveCSS("opacity", "1");
      await expect(dialog).toHaveCSS("background-color", palette.panel);
      const input = dialog.getByRole("spinbutton", { name: "Workers", exact: true });
      const inputColors = await input.evaluate(element => {
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor, border: style.borderTopColor };
      });
      expect(contrastRatio(inputColors.foreground, await paintedBackground(input))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(inputColors.border, await paintedBackground(input))).toBeGreaterThanOrEqual(3);
      const buttonColors = await dialog.getByRole("button", { name: "Add workers", exact: true }).evaluate(element => {
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor };
      });
      expect(contrastRatio(buttonColors.foreground, await paintedBackground(dialog.getByRole("button", { name: "Add workers", exact: true })))).toBeGreaterThanOrEqual(4.5);

      await attachTree(page.locator("body"), `palette-dialog-${theme.attribute}-${width}.a11y.yml`);
      expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
