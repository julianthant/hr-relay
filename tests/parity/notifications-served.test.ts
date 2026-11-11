import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installServedSurfaces } from "./helpers/app-driver.js";
import { FIXTURE_DAY, FIXTURE_NOW } from "./helpers/fixture-identity.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { zeroMatchSearchPage } from "../support/helpers/dashboard/search-page-fixtures.js";
import { CrossDateSearchPageSchema } from "../../src/models/dashboard/search.js";
import { NotificationTargetSchema } from "../../src/models/notifications/notification-target.js";
import { NotificationWireSchema } from "../../src/models/dashboard/projection.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hoursAgo = (hours: number) => new Date(new Date(FIXTURE_NOW).getTime() - hours * 3_600_000).toISOString();
let actorId = "";
const base = () => ({ channel: "ping", count: 1, publicationId: "a".repeat(64), actorId, revision: 1 });
const notice = (n: number, fields: Record<string, unknown>) => NotificationWireSchema.parse({ kind: "notification", trigger: "failed", readState: "unread", state: "unread", severity: "error", ...base(), notificationId: uuid(n), ...fields });
const command = (n: number, fields: Record<string, unknown>) => NotificationWireSchema.parse({ kind: "command", readState: "unread", state: "unread", priority: true, ...base(), notificationId: uuid(n), ...fields });

const searchPage = () => CrossDateSearchPageSchema.parse({ ...zeroMatchSearchPage(), totalMatches: 1, coverage: { matched: 1, subjectUnavailable: 0, actorUnavailable: 1, candidateLimit: 10000 },
  results: [{ runId: uuid(31), traceId: "pl-120000-0031", workflowId: "person-lookup", partitionDay: FIXTURE_DAY, registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" },
    state: "done", shape: "single", dryRun: true, priority: "bulk", systems: [], runNumber: { state: "absent", reason: "not recorded" }, retryOf: { state: "absent", reason: "first" }, enqueuedAt: `${FIXTURE_DAY}T12:00:00Z`,
    endedAt: { state: "absent", reason: "not recorded" }, match: { field: "workflow", strength: "contains" },
    metadata: { subject: { state: "available", value: "EID 10000001" }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } } }],
  nextCursor: { state: "absent", reason: "end" } });

async function serve(page: Page, theme: "dark" | "light", baseUrl: string) {
  actorId = ((await (await page.request.get(`${baseUrl}/api/v1/bootstrap`)).json()) as { actor: { id: string } }).actor.id;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); Reflect.set(window, "relayParityServedNotifications", true); }, theme);
  const rows = [
    notice(1, { title: "Person Lookup failed", summary: "The lookup could not finish.", context: { state: "available", workflow: "Person Lookup", subject: "EID 10000001" }, occurredAt: hoursAgo(1), sourceEvent: { state: "available", kind: "run-failed" }, link: { kind: "run", runId: uuid(31) } }),
    command(2, { title: "Retry: partial result", summary: "Some items in this batch were not done. Open it to see each one.", severity: "warning", context: { state: "not-applicable" }, occurredAt: hoursAgo(2), sourceEvent: { state: "available", kind: "bulk-incomplete" }, link: { kind: "bulk-result", bulkCommandId: uuid(910) } }),
    notice(3, { title: "Person Lookup finished", trigger: "verified-done", severity: "info", readState: "read", state: "read", context: { state: "available", workflow: "Person Lookup", subject: "EID 10000002" }, occurredAt: hoursAgo(30), sourceEvent: { state: "available", kind: "verified-done" }, link: { kind: "run", runId: uuid(32) } }),
  ];
  await page.route(/\/api\/v1\/notifications$/u, route => route.fulfill({ json: rows }));
  await page.route(/\/api\/v1\/notifications\/status$/u, route => route.fulfill({ json: { state: "ready", pending: 0 } }));
  await page.route(new RegExp(`/api/v1/notifications/${uuid(2)}/target$`, "u"), route => route.fulfill({ json: NotificationTargetSchema.parse({ kind: "bulk-result", bulkCommandId: uuid(910), type: "retry", requestedCount: 4, notAttempted: [uuid(7)], results: [
    { outcome: "applied", runId: uuid(4), commandId: uuid(911), replayed: false, detail: "Retry started." },
    { outcome: "applied", runId: uuid(8), commandId: uuid(912), replayed: false, detail: "Retry started." },
    { outcome: "conflict", runId: uuid(9), commandId: uuid(913), currentVersion: 5, detail: "The run changed before the retry reached it." }] }) }));
  await page.route(/\/api\/v1\/search\?/u, route => route.fulfill({ json: searchPage() }));
  await installServedSurfaces(page);
}

for (const theme of ["dark", "light"] as const) {
  test(`served notifications and search palette ${theme}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await serve(page, theme, server.baseUrl);
      const shot = async (name: string) => { mkdirSync("tests/parity/.output/notifications-served-preview", { recursive: true }); await page.screenshot({ path: `tests/parity/.output/notifications-served-preview/${name}-${theme}.png` }); };
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(page.locator(".notification-panel")).toBeVisible();
      await expect(page.getByText("Priority", { exact: true })).toBeVisible();
      await expect(page.getByText("Yesterday", { exact: true })).toBeVisible();
      await shot("notifications");
      await page.getByRole("button", { name: /Retry: partial result/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot("bulk-retry-result");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("dialog").getByRole("combobox").or(page.getByRole("dialog").getByRole("textbox")).first().fill("lookup");
      await expect(page.getByRole("dialog").getByText("EID 10000001")).toBeVisible();
      await shot("search-palette");
    } finally { await server.close(); }
  });
}
