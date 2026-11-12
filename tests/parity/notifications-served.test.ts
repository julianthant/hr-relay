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

const searchRun = (n: number, state: string, subject: string) => ({ runId: uuid(30 + n), traceId: `pl-120000-00${30 + n}`, workflowId: "person-lookup", partitionDay: FIXTURE_DAY, registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" },
  state, shape: "single", dryRun: true, priority: "bulk", systems: [], runNumber: { state: "absent", reason: "not recorded" }, retryOf: { state: "absent", reason: "first" }, enqueuedAt: `${FIXTURE_DAY}T12:00:00Z`,
  endedAt: { state: "absent", reason: "not recorded" }, match: { field: "workflow", strength: "contains" },
  metadata: { subject: { state: "available", value: subject }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } } });
const searchPage = () => CrossDateSearchPageSchema.parse({ ...zeroMatchSearchPage(), totalMatches: 5, coverage: { matched: 5, subjectUnavailable: 0, actorUnavailable: 5, candidateLimit: 10000 },
  results: [searchRun(1, "queued", "EID 10873698"), searchRun(2, "running", "Battistessa, Johnnie"), searchRun(3, "done", "EID 10101010"), searchRun(4, "failed", "EID 10555001"), searchRun(5, "parked-gate", "Morrow, Bea")],
  nextCursor: { state: "absent", reason: "end" } });

async function serve(page: Page, theme: "dark" | "light", baseUrl: string) {
  actorId = ((await (await page.request.get(`${baseUrl}/api/v1/bootstrap`)).json()) as { actor: { id: string } }).actor.id;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); Reflect.set(window, "relayParityServedNotifications", true); }, theme);
  const run = (title: string, workflow: string, subject: string, summary: string, n: number, extra: Record<string, unknown> = {}) => notice(n, { title, summary, context: { state: "available", workflow, subject }, occurredAt: hoursAgo(n), sourceEvent: { state: "available", kind: "run-failed" }, link: { kind: "run", runId: uuid(30 + n) }, ...extra });
  const rows = [
    command(2, { title: "Retry: partial result", summary: "2 applied · 1 conflict · 1 not attempted", severity: "warning", context: { state: "not-applicable" }, occurredAt: hoursAgo(1), sourceEvent: { state: "available", kind: "bulk-incomplete" }, link: { kind: "bulk-result", bulkCommandId: uuid(910) } }),
    run("Run failed", "Person Lookup", "EID 10555001", "Review the failed step in the log.", 3),
    run("Approval waiting", "Person Lookup", "Morrow, Bea", "Waiting on identity review", 4, { trigger: "gate-waiting", severity: "warning", sourceEvent: { state: "available", kind: "gate-opened" } }),
    run("Write parked", "Person Lookup", "EID 10777012", "A write to UCPath is parked pending proof", 5, { trigger: "write-parked", severity: "warning", sourceEvent: { state: "available", kind: "write-parked" } }),
    run("Records ready for approval", "Oath Signature", "single-oath.pdf", "1 of 1 records ready for approval", 6, { trigger: "gate-waiting", severity: "warning", sourceEvent: { state: "available", kind: "gate-opened" } }),
    run("Run completed", "Person Lookup", "EID 10101010", "Completed successfully.", 20, { trigger: "verified-done", severity: "info", readState: "read", state: "read", sourceEvent: { state: "available", kind: "verified-done" } }),
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
      await page.getByRole("button", { name: /^Notifications/ }).click();
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByRole("dialog").getByText("Quick actions")).toBeVisible();
      await expect(page.getByRole("dialog").getByText("Person Lookup · Done")).toBeVisible();
      await shot("search-palette");
    } finally { await server.close(); }
  });
}
