import { describe, expect, it, vi } from "vitest";
import { resolveNotificationNavigation } from "../../../../src/dashboard/app/navigation/notification-navigation.js";
import { parseRoute, routeToSearch } from "../../../../src/dashboard/app/navigation/url-state.js";
import { PRODUCT_WORKFLOW_COMPOSITION } from "../../../../src/dashboard/app/workflow-sources.js";
import { PARITY_WORKFLOW_COMPOSITION } from "../../../parity/helpers/workflow-composition.js";
import { FIXTURE_DAY_WIRE } from "../../../parity/helpers/fixture-queue.js";
import { FIXTURE_RUN_DETAILS } from "../../../parity/helpers/fixture-detail.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { FIXTURE_IDS } from "../../../support/fixtures/dashboard/fixture-queue.js";
import { FingerprintSchema, RunIdSchema, FailureIdSchema } from "../../../../src/rules/identity/ids.js";
import { LocalDateSchema } from "../../../../src/rules/identity/ids.js";
import { RowRevisionSchema } from "../../../../src/models/dashboard/primitives.js";
import type { NotificationTarget } from "../../../../src/models/notifications/notifications.js";

const runId = RunIdSchema.parse(FIXTURE_IDS.failedRun);
const row = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === runId)!;
const detail = FIXTURE_RUN_DETAILS[runId];
const failureSection = FIXTURE_FAILURE_SECTIONS[runId].failure;
if (failureSection.section !== "failure" || failureSection.payload.state !== "available") throw new Error("failure fixture missing");
const failureId = failureSection.payload.value.failureId;
const day = FIXTURE_DAY_WIRE.day;
const origin = { start: true, day: "2026-08-04", settings: "general", archive: "", view: { notifications: true, search: true, preview: "ocr", records: "previous" } };
const clients = () => ({ dashboardDay: vi.fn(async () => FIXTURE_DAY_WIRE), runDetail: vi.fn(async () => detail), runSection: vi.fn(async () => failureSection) });
const target: Extract<NotificationTarget, { kind: "run" }> = { kind: "run", runId, day };

describe("notification composition and canonical navigation", () => {
  it("selects served product and explicit mock parity inbox/search independently of workflows", () => {
    expect(PRODUCT_WORKFLOW_COMPOSITION.inbox).toBe("served");
    expect(PRODUCT_WORKFLOW_COMPOSITION.search).toBe("served");
    const parity = PARITY_WORKFLOW_COMPOSITION([]);
    expect(parity.inbox).toBe("mock");
    expect(parity.search).toBe("mock");
  });
  it("freshly revalidates a historical run against its exact day and run detail", async () => {
    const client = clients();
    const result = await resolveNotificationNavigation(client, target, origin, () => true);
    expect(client.dashboardDay).toHaveBeenCalledWith(day);
    expect(client.runDetail).toHaveBeenCalledWith(runId);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error(result.message);
    expect(result.workflowId).toBe(row.workflowId);
    expect(result.route).toMatchObject({ day, run: runId, section: "logs", start: false, view: { preview: null, notifications: false } });
    expect(result.route.settings).toBeUndefined();
    expect(result.route.archive).toBeUndefined();
    expect(result.route.view?.records).toBeUndefined();
  });
  it("preserves exact failure focus through history serialization", async () => {
    const result = await resolveNotificationNavigation(clients(), { ...target, kind: "failure", failureId }, origin, () => true);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error(result.message);
    expect(parseRoute(routeToSearch(result.route)).view?.logFailure).toEqual({ runId, failureId });
  });
  it("opens Settings Storage without run reads", async () => {
    const client = clients();
    const result = await resolveNotificationNavigation(client, { kind: "storage" }, origin, () => true);
    expect(result).toMatchObject({ state: "ready", route: { settings: "storage", start: false } });
    expect(client.dashboardDay).not.toHaveBeenCalled();
  });
  it("refuses retired archives and every canonical refusal without guessing a run", async () => {
    const client = clients();
    expect((await resolveNotificationNavigation(client, { kind: "archive", runId, reportDigest: FingerprintSchema.parse("a".repeat(64)) }, origin, () => true)).state).toBe("refused");
    for (const reason of ["wrong-actor", "notification-unavailable", "pinned", "run-unavailable", "failure-unavailable", "archive-unavailable", "target-unavailable"] as const) {
      expect((await resolveNotificationNavigation(client, { kind: "refused", reason }, origin, () => true)).state).toBe("refused");
    }
    expect(client.runDetail).not.toHaveBeenCalled();
  });
  it("refuses missing runs, wrong day, unregistered workflows, read errors and changed identities", async () => {
    const missing = clients(); missing.dashboardDay.mockResolvedValue({ ...FIXTURE_DAY_WIRE, queueSurfaces: [] });
    expect((await resolveNotificationNavigation(missing, target, origin, () => true)).state).toBe("refused");
    const wrongDay = clients(); wrongDay.dashboardDay.mockResolvedValue({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse("2026-08-04") });
    expect((await resolveNotificationNavigation(wrongDay, target, origin, () => true)).state).toBe("refused");
    expect((await resolveNotificationNavigation(clients(), target, origin, () => false)).state).toBe("refused");
    const failed = clients(); failed.runDetail.mockRejectedValue(new Error("offline"));
    expect((await resolveNotificationNavigation(failed, target, origin, () => true)).state).toBe("refused");
    for (const changed of [{ ...detail, rowRevision: RowRevisionSchema.parse(detail.rowRevision + 1) }, { ...detail, header: { ...detail.header, attempt: detail.header.attempt + 1 } }]) {
      const client = clients(); client.runDetail.mockResolvedValue(changed);
      expect((await resolveNotificationNavigation(client, target, origin, () => true)).state).toBe("refused");
    }
  });
  it("refuses missing or different failures instead of focusing a nearby step", async () => {
    expect((await resolveNotificationNavigation(clients(), { ...target, kind: "failure", failureId: FailureIdSchema.parse(FIXTURE_IDS.doneRun) }, origin, () => true)).state).toBe("refused");
    const absent = clients(); absent.runDetail.mockResolvedValue({ ...detail, availableSections: ["logs"] });
    expect((await resolveNotificationNavigation(absent, { ...target, kind: "failure", failureId }, origin, () => true)).state).toBe("refused");
  });
});
