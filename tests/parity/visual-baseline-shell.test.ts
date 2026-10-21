import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import { routeUrl } from "./helpers/app-driver.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, captureParityPair, installTheme, PARITY_THEMES, type ParityTheme } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH, FIXTURE_NOW } from "./helpers/fixture-identity.js";
import { ProtectedSettingsNameSchema } from "../../src/models/config/protected-settings.js";
import { StorageDoctorWireSchema } from "../../src/models/dashboard/storage.js";
import { FIXTURE_STORAGE_DOCTOR } from "./helpers/fixture-storage.js";
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
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      for (const scenario of ["active", "attention", "idle", "empty", "loading", "unavailable"]) {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&sessionsPreview=${scenario}`);
        await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
        await page.getByRole("button", { name: "Sessions", exact: true }).click();
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
      ensureParityBundle();
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
      try {
        await prepare(page, theme, width);
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${outcome === "normal" ? "" : `&workerCommandPreview=${outcome}`}`);
        await page.getByRole("button", { name: "Close assistant", exact: true }).click();
        await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
        await page.getByRole("button", { name: "Sessions", exact: true }).click();
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
        await expect(page.getByText("Adding workers…", { exact: true })).toBeVisible();

        await page.clock.runFor(600);
        const panel = page.getByRole("region", { name: "Session Panel", exact: true });
        await expect(panel).toContainText(outcome === "normal" ? "Workers added" : outcome === "refused" ? "Worker control was refused" : "Response unavailable");

        if (outcome === "uncertain") {
          await panel.getByRole("button", { name: "Check outcome", exact: true }).click();
          await expect(panel).toContainText("Checking command…");

          await page.clock.runFor(600);
          await expect(panel).toContainText("Workers added");
        }
        await attachShellA11y(page, info, evidence(`command-${outcome}`, theme, width));
      } finally { await server.close(); }
    });
  }

  test(`frozen shell search and destination ${label}`, annotation(evidence("search", theme, width)), async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      await page.goto(routeUrl(server.baseUrl, { day: FIXTURE_DAY }));
      await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
      await page.getByRole("button", { name: "Search runs", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Search runs", exact: true });
      await expect(dialog.getByRole("option").first()).toBeVisible();
      await capture(page, info, theme, width, "search-results");
      await dialog.getByRole("combobox", { name: "Search runs", exact: true }).fill("no-such-run-xyz");
      await expect(dialog).toContainText("No runs match your search.");
      await capture(page, info, theme, width, "search-empty");
      await page.goto(`${server.baseUrl}/?day=invalid-day&view=${encodeURIComponent(JSON.stringify({ search: true }))}`);
      await expect(dialog.getByRole("status")).toHaveText("Invalid date: invalid-day.");
      await expect(dialog.getByRole("option")).toHaveCount(0);
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
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
      for (const scenario of ["normal", "empty", "loading", "unavailable", "ping"]) {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=${scenario}&view=${encodeURIComponent(JSON.stringify({ notifications: true }))}`);
        await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
        if (scenario === "ping") {
          await expect(page.getByRole("button", { name: "Open notifications", exact: true })).toBeVisible();

        }
        await expect(page.getByRole("button", { name: /^Notifications/u })).toHaveAttribute("aria-pressed", "true");
        const panel = page.getByRole("region", { name: "Notifications", exact: true }).and(page.locator(".notification-rail"));
        if (scenario === "empty") await expect(panel).toContainText("No notifications");
        else if (scenario === "loading") await expect(panel.getByRole("status", { name: "Loading notifications" })).toBeVisible();
        else if (scenario === "unavailable") await expect(panel).toContainText("Notifications unavailable");
        else await expect(panel.getByRole("list", { name: "Notification updates" }).getByRole("listitem").first()).toBeVisible();
        if (["normal", "empty", "unavailable"].includes(scenario)) await capture(page, info, theme, width, `notifications-${scenario}`);
        if (scenario === "normal") {
          await panel.getByRole("tab", { name: "Unread", exact: true }).click();
          await expect(panel.getByRole("button", { name: /^Mark read:/u }).first()).toBeVisible();

          await panel.getByRole("tab", { name: "All", exact: true }).click();
          await panel.getByRole("button", { name: /^Mark read:/u }).first().click();
          await expect(panel.getByRole("button", { name: /^Mark unread:/u }).first()).toBeVisible();

          await panel.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
          await page.clock.runFor(100);
          await page.getByRole("menuitemradio", { name: "Failed", exact: true }).click();
          await page.clock.runFor(250);
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toBeVisible();
          await expect(panel.getByText("Run failed", { exact: true }).first()).toBeVisible();

          await expect(page.getByRole("menuitemradio", { name: "Needs you", exact: true })).toBeVisible();
          await expect(panel.getByRole("button", { name: "Filter notifications by category", exact: true })).toHaveAttribute("aria-expanded", "true");
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toBeVisible();
          await capture(page, info, theme, width, "notifications-category-menu");
          await page.getByRole("menuitemradio", { name: "Needs you", exact: true }).click();
          await page.keyboard.press("Escape");
          await page.clock.runFor(250);
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toHaveCount(0);
          await expect(panel.getByRole("button", { name: "Filter notifications by category", exact: true })).toHaveAttribute("data-filtered", "true");

          await panel.getByRole("button", { name: "Read all", exact: true }).click();
          await expect(panel.getByRole("button", { name: "Read all", exact: true })).toBeDisabled();

          await panel.getByRole("tab", { name: "Unread", exact: true }).click();
          await expect(panel).toContainText("Nothing needs attention");

          await panel.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
          await page.clock.runFor(100);
          await page.getByRole("menuitemradio", { name: "Failed", exact: true }).click();
          await page.clock.runFor(250);
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toBeVisible();
          await expect(panel).toContainText("No failures");
          await page.keyboard.press("Escape");
          await page.clock.runFor(250);
          await expect(page.locator('[data-slot="dropdown-menu-content"][data-open]')).toHaveCount(0);

          await panel.getByRole("button", { name: "Filter notifications by category", exact: true }).click();
          await page.clock.runFor(100);
          await page.getByRole("menuitemradio", { name: "All updates", exact: true }).click();
          await expect(panel).toContainText("All caught up");

        }
      }
      await attachShellA11y(page, info, evidence("notifications", theme, width));
    } finally { await server.close(); }
  });

  test(`frozen analytics reports ${label}`, annotation(evidence("analytics", theme, width)), async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
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
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await prepare(page, theme, width);
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

  test(`frozen storage doctor lifecycle ${label}`, annotation(evidence("storage", theme, width)), async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    let releaseLatest: (() => void) | undefined;
    let releaseDoctor: (() => void) | undefined;
    try {
      await prepare(page, theme, width);
      let latest: "hold" | "failed" | "loaded" | "never" = "hold";
      let doctor: "hold" | "failed" | "loaded" = "hold";
      let report: unknown = FIXTURE_STORAGE_DOCTOR;
      await page.route("**/api/v1/storage/doctor/latest", async route => {
        if (latest === "hold") await new Promise<void>(resolveLatest => { releaseLatest = resolveLatest; });
        if (latest === "failed") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "storage-read-failed" }) });
        else await route.fulfill({ json: latest === "loaded" ? { state: "completed", report: StorageDoctorWireSchema.parse(report) } : { state: "never-run" } });
      });
      await page.route("**/api/v1/storage/doctor", async route => {
        if (doctor === "hold") await new Promise<void>(resolveDoctor => { releaseDoctor = resolveDoctor; });
        if (doctor === "failed") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "storage-check-failed" }) });
        else await route.fulfill({ json: StorageDoctorWireSchema.parse(report) });
      });
      const open = async () => {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=storage`);
        await expect(page.getByRole("region", { name: "Storage checks", exact: true })).toBeVisible();
      };
      const storage = page.getByRole("region", { name: "Storage checks", exact: true });
      await open();
      await expect(storage.getByRole("button", { name: "Loading last check…", exact: true })).toBeDisabled();

      latest = "never"; releaseLatest?.();
      await expect(storage.getByRole("button", { name: "Run storage checks", exact: true })).toBeEnabled();
      await capture(page, info, theme, width, "storage-never-checked");
      await storage.getByRole("button", { name: "Run storage checks", exact: true }).click();
      await expect(storage.getByRole("button", { name: "Running checks…", exact: true })).toBeDisabled();

      doctor = "failed"; releaseDoctor?.();
      await expect(storage).toContainText("Storage checks could not finish");
      await capture(page, info, theme, width, "storage-first-run-failed");
      latest = "failed"; await open();
      await expect(storage).toContainText("Storage checks could not finish");

      latest = "loaded"; doctor = "loaded"; await open();
      await expect(storage.getByRole("button", { name: "Run checks again", exact: true })).toBeEnabled();
      await expect(storage.getByRole("alert")).toHaveCount(0);
      await capture(page, info, theme, width, "storage-loaded");
      doctor = "hold";
      await storage.getByRole("button", { name: "Run checks again", exact: true }).click();
      await expect(storage.getByRole("button", { name: "Running checks…", exact: true })).toBeDisabled();

      doctor = "failed"; releaseDoctor?.();
      await expect(storage).toContainText("Storage checks could not finish");
      await expect(storage).toContainText("Stored data is readable.");

      doctor = "loaded";
      report = { ...FIXTURE_STORAGE_DOCTOR,
        authority: { state: "degraded", cause: { code: "authority-unavailable", summary: "Saved data is unreadable in this fixture." } },
        recovery: { state: "unavailable", cause: { code: "authority-unavailable", summary: "Recovery evidence is unavailable." }, findings: [] },
        authorityUpgrades: { state: "unavailable", cause: { code: "authority-unavailable", summary: "Upgrade evidence is unavailable." } },
        counts: { state: "unavailable", cause: { code: "authority-unavailable", summary: "Counts are unavailable." } },
      };
      await open();
      await expect(storage).toContainText("Data store unavailable");

      await storage.getByText("Diagnostic details", { exact: true }).first().click();
      await expect(storage.getByRole("region", { name: "Stored data diagnostics", exact: true })).toBeVisible();

      report = { ...FIXTURE_STORAGE_DOCTOR,
        recovery: { state: "interrupted", findings: [{ marker: "authority-restore", state: "interrupted" }] },
        authorityUpgrades: { state: "available", phases: [{ phase: "settled", fromSchemaVersion: 26, toSchemaVersion: 27, recordedAt: FIXTURE_NOW }] },
        protectedSettings: { state: "available", entries: ProtectedSettingsNameSchema.options.map((name, index) => ({ name, present: index % 2 === 0 })) },
      };
      await open();
      await expect(storage).toContainText("Interrupted");
      await expect(storage).toContainText("Present");
      await expect(storage).toContainText("Not set");

      await storage.getByText("Update history", { exact: true }).click();
      await expect(storage.getByText("Update completed", { exact: true })).toBeVisible();

      await attachShellA11y(page, info, evidence("storage", theme, width));
    } finally { releaseLatest?.(); releaseDoctor?.(); await server.close(); }
  });
}
