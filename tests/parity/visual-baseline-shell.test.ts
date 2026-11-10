import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { resolve } from "node:path";
import { installServedSurfaces, routeUrl } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, captureParityPair, installTheme, PARITY_THEMES, type ParityTheme } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH, FIXTURE_NOW } from "./helpers/fixture-identity.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

const REFERENCES = resolve("tests/parity/references");
const evidence = (group: string, theme: ParityTheme, width: number) => `baseline-shell-${group}-${theme.name}-${String(width)}.a11y.yml`;
const annotation = (name: string) => ({ annotation: [{ type: "required-a11y-evidence", description: name }] });
async function prepare(page: Page, theme: ParityTheme, width: number) {
  await page.setViewportSize({ width, height: 720 });
  await installTheme(page, theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date(FIXTURE_NOW) });
  await page.clock.pauseAt(new Date(Date.parse(FIXTURE_NOW) + 1000));
}
async function capture(page: Page, info: TestInfo, theme: ParityTheme, width: number, state: string) {
  await assertThemeApplied(page, theme);
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(100); // the paused clock holds the two-frame enter transition at opacity 0
  const name = `baseline-shell-${state}-${theme.name}-${String(width)}.a11y.yml`;
  info.annotations.push({ type: "required-a11y-evidence", description: name });
  await attachShellA11y(page, info, name);
  await captureParityPair(page, REFERENCES, {
    stateId: `baseline-shell-${state}`, viewport: `${String(width)}x${"720"}`,
    theme: theme.name, adapter: "fixture", fixtureId: "mounted-mock-shell", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
}

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  const label = `${theme.name} ${String(width)}`;
  test(`frozen session populations ${label}`, annotation(evidence("sessions", theme, width)), async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      for (const scenario of ["active", "attention", "idle", "empty", "loading", "unavailable"]) {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&sessionsPreview=${scenario}`);
        await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
        await page.getByRole("button", { name: /^Sessions\b/ }).click();
        const panel = page.getByRole("region", { name: "Session Panel", exact: true });
        if (scenario === "empty") await expect(panel).toContainText("No workers yet");
        else if (scenario === "loading") await expect(panel.getByRole("status", { name: "Loading sessions" })).toBeVisible();
        else if (scenario === "unavailable") await expect(panel.getByRole("alert")).toContainText("Sessions unavailable");
        else await expect(panel.getByRole("article")).toHaveCount(scenario === "active" ? 4 : scenario === "attention" ? 3 : 2);
        if (["active", "empty", "unavailable"].includes(scenario)) await capture(page, info, theme, width, `sessions-${scenario}`);
        if (scenario === "idle") {
          await page.clock.runFor(300_000);
          await expect(panel.getByRole("img", { name: "Checking idle session refresh", exact: true }).first()).toBeVisible();

          await page.clock.runFor(1000);
          await expect(panel.getByRole("img", { name: /^Session refresh in/u }).first()).toBeVisible();

        }
      }
      await attachShellA11y(page, info, evidence("sessions", theme, width));
    } finally { await server.close(); }
  });

  for (const outcome of ["normal", "refused", "uncertain"] as const) {
    test(`frozen session command ${outcome} ${label}`, annotation(evidence(`command-${outcome}`, theme, width)), async ({ page }, info) => {
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
      try {
        await prepare(page, theme, width);
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${outcome === "normal" ? "" : `&workerCommandPreview=${outcome}`}`);
        await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
        await page.getByRole("button", { name: /^Sessions\b/ }).click();
        const worker = page.getByRole("article", { name: "Worker 1 · Separations", exact: true });
        await worker.getByRole("button", { name: "Pause", exact: true }).click();
        await expect(worker).toContainText("Pause requested…");
        await expect(worker.getByRole("button", { name: "Pause", exact: true })).toBeDisabled();

        await page.clock.runFor(600);
        await expect(worker).toContainText(outcome === "normal" ? "Pause confirmed" : outcome === "refused" ? "Worker control was refused" : "Response unavailable");

        if (outcome === "uncertain") {
          await worker.getByRole("button", { name: "Check outcome", exact: true }).click();
          await expect(worker).toContainText("Checking command…");

          await page.clock.runFor(600);
          await expect(worker).toContainText("Pause confirmed");
          await expect(worker.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();

        }
        await page.getByRole("button", { name: "Add workers", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add workers", exact: true });
        await expect(dialog.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveValue("1");
        if (outcome === "normal") {
          await capture(page, info, theme, width, "add-workers");
          await dialog.getByRole("combobox", { name: "Workflow", exact: true }).click();
          await page.clock.runFor(100);
          await expect(page.locator('[data-slot="select-content"][data-open]')).toBeVisible();
          await capture(page, info, theme, width, "add-workers-menu");
          await page.keyboard.press("Escape");
          await dialog.getByRole("spinbutton", { name: "Workers", exact: true }).fill("0");
          await expect(dialog.getByRole("button", { name: "Add workers", exact: true })).toBeDisabled();

          await dialog.getByRole("spinbutton", { name: "Workers", exact: true }).fill("1");
        }
        await dialog.getByRole("button", { name: "Add workers", exact: true }).click();
        const toasts = page.locator('[data-ds-toast-viewport="default"]');
        await expect(toasts.getByText("Adding workers…", { exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: "Session Panel", exact: true })).not.toContainText("Adding workers");

        await page.clock.runFor(600);
        const panel = page.getByRole("region", { name: "Session Panel", exact: true });
        await expect(panel).not.toContainText("Workers added");
        if (outcome === "normal") await expect(toasts.getByText("Workers added", { exact: true })).toBeVisible();
        else await expect(panel).toContainText(outcome === "refused" ? "Worker control was refused" : "Response unavailable");

        if (outcome === "uncertain") {
          await panel.getByRole("button", { name: "Check outcome", exact: true }).click();
          await expect(panel).toContainText("Checking command…");

          await page.clock.runFor(600);
          await expect(toasts.getByText("Workers added", { exact: true })).toBeVisible();
          await expect(panel).not.toContainText("Workers added");
        }
        await attachShellA11y(page, info, evidence(`command-${outcome}`, theme, width));
      } finally { await server.close(); }
    });
  }

  test(`frozen shell search and destination ${label}`, annotation(evidence("search", theme, width)), async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      await page.goto(routeUrl(server.baseUrl, { day: FIXTURE_DAY }));
      await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Search Relay", exact: true });
      await expect(dialog.getByRole("option").first()).toBeVisible();
      await capture(page, info, theme, width, "search-results");
      await dialog.getByRole("combobox", { name: "Search Relay", exact: true }).fill("no-such-run-xyz");
      await expect(dialog).toContainText("No matches");
      await capture(page, info, theme, width, "search-empty");
      await page.goto(`${server.baseUrl}/?day=invalid-day&view=${encodeURIComponent(JSON.stringify({ search: true }))}`);
      await expect(dialog.getByText("Invalid date: invalid-day.", { exact: true })).toBeVisible();
      await expect(dialog.locator(".search-palette-row-tag")).toHaveCount(0);
      await capture(page, info, theme, width, "search-invalid-date-unavailable");
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: "missing-workflow" }))}`);
      await expect(page.getByText("Destination unavailable", { exact: true })).toBeVisible();
      await capture(page, info, theme, width, "destination-unavailable");
      await page.getByRole("button", { name: "Open dashboard", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toBeVisible();

      await attachShellA11y(page, info, evidence("search", theme, width));
    } finally { await server.close(); }
  });

  test(`frozen notifications ${label}`, annotation(evidence("notifications", theme, width)), async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      for (const scenario of ["normal", "empty", "loading", "unavailable", "ping"]) {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=${scenario}&view=${encodeURIComponent(JSON.stringify({ notifications: true }))}`);
        await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
        if (scenario === "ping") {
          await expect(page.locator('[data-slot="toast"]')).toBeVisible();

        }
        await expect(page.getByRole("button", { name: /^Notifications/u })).toHaveAttribute("aria-pressed", "true");
        const panel = page.getByRole("region", { name: "Notifications", exact: true }).and(page.locator(".notification-panel"));
        if (scenario === "empty") await expect(panel).toContainText("Nothing needs attention");
        else if (scenario === "loading") await expect(panel.getByRole("status", { name: "Loading notifications" })).toBeVisible();
        else if (scenario === "unavailable") await expect(panel).toContainText("Notifications unavailable");
        else await expect(panel.getByRole("listitem").first()).toBeVisible();
        if (["normal", "empty", "unavailable"].includes(scenario)) await capture(page, info, theme, width, `notifications-${scenario}`);
        if (scenario === "normal") {
          const first = panel.getByRole("listitem").first();
          await first.hover();
          await first.getByRole("button", { name: /^Mark as (?:read|unread)$/u }).click();
          await panel.getByRole("button", { name: "Notification actions", exact: true }).click();
          await page.clock.runFor(100);
          await page.getByRole("menuitem", { name: "Mark all as read", exact: true }).click();
          await page.clock.runFor(250);
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toHaveCount(0);

          await panel.getByRole("button", { name: "Notification actions", exact: true }).click();
          await page.clock.runFor(100);
          await expect(page.getByRole("menuitem", { name: "Mark all as read", exact: true })).toBeDisabled();
          await page.keyboard.press("Escape");
          await page.clock.runFor(250);
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toHaveCount(0);

        }
      }
      await attachShellA11y(page, info, evidence("notifications", theme, width));
    } finally { await server.close(); }
  });

  test(`frozen analytics reports ${label}`, annotation(evidence("analytics", theme, width)), async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      await installServedSurfaces(page);
      for (const scenario of ["normal", "empty", "incomplete", "loading", "unavailable"]) {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=activity&view=${encodeURIComponent(JSON.stringify({ activityPreview: scenario }))}`);
        const report = page.getByRole("region", { name: "Analytics report", exact: true });
        await expect(report).toBeVisible();
        if (scenario === "loading") { await expect(report.locator('[aria-busy="true"]')).toHaveCount(2); for (const skeleton of await report.locator('[aria-busy="true"]').all()) await expect(skeleton).toBeVisible(); }
        else if (scenario === "unavailable") await expect(report.getByRole("alert")).toContainText("Analytics unavailable");
        else {
          await expect(report.getByRole("table", { name: "Workflow outcomes", exact: true })).toBeVisible();
          if (scenario === "empty") await expect(report).toContainText("No workflow activity in this period");
          if (scenario === "incomplete") await expect(report).toContainText("Unavailable");
        }
        if (["normal", "empty", "unavailable"].includes(scenario)) await capture(page, info, theme, width, `analytics-${scenario}`);
      }
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=activity&activity=invalid`);
      await expect(page.getByRole("region", { name: "Analytics report", exact: true }).getByRole("alert")).toBeVisible();

      await attachShellA11y(page, info, evidence("analytics", theme, width));
    } finally { await server.close(); }
  });

  test(`frozen analytics drilldowns ${label}`, annotation(evidence("analytics-runs", theme, width)), async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      await installServedSurfaces(page);
      const open = async (selection: Record<string, unknown>) => {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=activity&view=${encodeURIComponent(JSON.stringify({ activityBrowse: selection }))}`);
        await expect(page.getByRole("region", { name: "Analytics runs", exact: true })).toBeVisible();
      };
      for (const metric of ["completed", "outstanding", "failed", "timed"]) {
        await open({ metric, page: 0 });
        const runs = page.getByRole("region", { name: "Analytics runs", exact: true });
        await expect(runs.getByRole("table")).toBeVisible();

      }
      await open({ metric: "completed", page: 1 });
      await expect(page.getByRole("region", { name: "Analytics runs", exact: true })).toContainText("21–");

      await open({ metric: "timed", workflow: "sample-separations", page: 0, sort: { column: "duration", direction: "descending" }, query: "Jordan" });
      const runs = page.getByRole("region", { name: "Analytics runs", exact: true });
      await expect(runs.getByRole("table", { name: "Separations run times", exact: true })).toBeVisible();
      await expect(runs.getByRole("combobox", { name: "Run order", exact: true })).toHaveText(/Duration: longest first/u);
      await runs.getByRole("combobox", { name: "Run order", exact: true }).click();
      await page.clock.runFor(100);
          await expect(page.locator('[data-slot="select-content"][data-open]')).toBeVisible();
      await capture(page, info, theme, width, "analytics-order-menu");
      await page.keyboard.press("Escape");
      await runs.getByRole("button", { name: /^Open logs for/u }).first().click();
      await expect(runs.getByRole("region", { name: "Run logs", exact: true })).toBeVisible();

      await open({ metric: "completed", page: 0, query: "no-such-run-xyz" });
      await expect(runs).toContainText("No runs match your search.");

      for (const [_state, selection, message] of [
        ["workflow", { metric: "completed", workflow: "missing", page: 0 }, "This workflow has no runs in the selected period."],
        ["page", { metric: "completed", page: 99 }, "This page is unavailable."],
        ["run", { metric: "completed", page: 0, run: "missing" }, "This run is not part of the selected Analytics result."],
      ] as const) {
        await open(selection);
        await expect(runs.getByRole("alert")).toContainText(message);

      }
      await attachShellA11y(page, info, evidence("analytics-runs", theme, width));
    } finally { await server.close(); }
  });
}
