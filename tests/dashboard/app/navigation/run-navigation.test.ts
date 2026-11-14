import { describe, expect, it, vi } from "vitest";
import { resolveRunNavigation } from "../../../../src/dashboard/app/navigation/run-navigation.js";
import { parseRoute, routeToSearch } from "../../../../src/dashboard/app/navigation/url-state.js";
import { PRODUCT_WORKFLOW_COMPOSITION } from "../../../../src/dashboard/app/workflow-sources.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../../mocks/helpers/workflow-composition.js";
import { FIXTURE_DAY_WIRE } from "../../../mocks/helpers/fixture-queue.js";
import { FIXTURE_RUN_DETAILS } from "../../../mocks/helpers/fixture-detail.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { FIXTURE_IDS } from "../../../support/fixtures/dashboard/fixture-queue.js";
import { CommandIdSchema, FingerprintSchema, RunIdSchema, FailureIdSchema } from "../../../../src/rules/identity/ids.js";
import { LocalDateSchema } from "../../../../src/rules/identity/ids.js";
import { RowRevisionSchema } from "../../../../src/models/dashboard/primitives.js";
import type { NotificationTarget } from "../../../../src/models/notifications/notification-target.js";
import { NotificationTargetSchema } from "../../../../src/models/notifications/notification-target.js";
import { CommandResultSchema, NotificationCommandRequestSchema } from "../../../../src/rules/commands/commands.js";

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
  it("selects served product and explicit mock inbox/search independently of workflows", () => {
    expect(PRODUCT_WORKFLOW_COMPOSITION.inbox).toBe("served");
    expect(PRODUCT_WORKFLOW_COMPOSITION.search).toBe("served");
    expect(PRODUCT_WORKFLOW_COMPOSITION.sources["onbase"]).toBe("mock");
    expect(PRODUCT_WORKFLOW_COMPOSITION.sources["emergency-contact"]).toBe("served");
    const mockComposition = MOCK_WORKFLOW_COMPOSITION([]);
    expect(mockComposition.inbox).toBe("mock");
    expect(mockComposition.search).toBe("mock");
  });
  it("freshly revalidates a historical run against its exact day and run detail", async () => {
    const client = clients();
    const result = await resolveRunNavigation(client, target, origin, () => true);
    expect(client.dashboardDay).toHaveBeenCalledWith(day);
    expect(client.runDetail).toHaveBeenCalledWith(runId);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error(result.message);
    expect(result.workflowId).toBe(row.workflowId);
    expect(result.route).toMatchObject({ day, run: runId, section: "logs", start: false, view: { preview: null } });
    expect(result.route.settings).toBeUndefined();
    expect(result.route.archive).toBeUndefined();
    expect(result.route.view?.records).toBeUndefined();
  });
  it("preserves exact failure focus through history serialization", async () => {
    const result = await resolveRunNavigation(clients(), { ...target, kind: "failure", failureId }, origin, () => true);
    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error(result.message);
    expect(parseRoute(routeToSearch(result.route)).view?.logFailure).toEqual({ runId, failureId });
  });
  it("refuses a storage notice without run reads", async () => {
    const client = clients();
    const result = await resolveRunNavigation(client, { kind: "storage" }, origin, () => true);
    expect(result.state).toBe("refused");
    expect(client.dashboardDay).not.toHaveBeenCalled();
  });
  it("refuses retired archives and every canonical refusal without guessing a run", async () => {
    const client = clients();
    expect((await resolveRunNavigation(client, { kind: "archive", runId, reportDigest: FingerprintSchema.parse("a".repeat(64)) }, origin, () => true)).state).toBe("refused");
    for (const reason of ["wrong-actor", "notification-unavailable", "pinned", "run-unavailable", "failure-unavailable", "archive-unavailable", "target-unavailable"] as const) {
      expect((await resolveRunNavigation(client, { kind: "refused", reason }, origin, () => true)).state).toBe("refused");
    }
    expect(client.runDetail).not.toHaveBeenCalled();
  });
  it("refuses missing runs, wrong day, unregistered workflows, read errors and changed identities", async () => {
    const missing = clients(); missing.dashboardDay.mockResolvedValue({ ...FIXTURE_DAY_WIRE, queueSurfaces: [] });
    expect((await resolveRunNavigation(missing, target, origin, () => true)).state).toBe("refused");
    const wrongDay = clients(); wrongDay.dashboardDay.mockResolvedValue({ ...FIXTURE_DAY_WIRE, day: LocalDateSchema.parse("2026-08-04") });
    expect((await resolveRunNavigation(wrongDay, target, origin, () => true)).state).toBe("refused");
    expect((await resolveRunNavigation(clients(), target, origin, () => false)).state).toBe("refused");
    const failed = clients(); failed.runDetail.mockRejectedValue(new Error("offline"));
    expect((await resolveRunNavigation(failed, target, origin, () => true)).state).toBe("refused");
    for (const changed of [{ ...detail, rowRevision: RowRevisionSchema.parse(detail.rowRevision + 1) }, { ...detail, header: { ...detail.header, attempt: detail.header.attempt + 1 } }]) {
      const client = clients(); client.runDetail.mockResolvedValue(changed);
      expect((await resolveRunNavigation(client, target, origin, () => true)).state).toBe("refused");
    }
  });
  it("refuses missing or different failures instead of focusing a nearby step", async () => {
    expect((await resolveRunNavigation(clients(), { ...target, kind: "failure", failureId: FailureIdSchema.parse(FIXTURE_IDS.doneRun) }, origin, () => true)).state).toBe("refused");
    const absent = clients(); absent.runDetail.mockResolvedValue({ ...detail, availableSections: ["logs"] });
    expect((await resolveRunNavigation(absent, { ...target, kind: "failure", failureId }, origin, () => true)).state).toBe("refused");
  });
  it("refuses command targets without reading a run", async () => {
    const client = clients();
    const commandId = CommandIdSchema.parse("00000000-0000-4000-8000-000000000444");
    const request = NotificationCommandRequestSchema.parse({ commandId, requestedAt: "2026-08-03T17:00:00.000Z", requestedBy: "local-operator", source: "dashboard", family: "notification", type: "notification-read", target: { notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", expectedVersion: 1 } });
    const result = CommandResultSchema.parse({ state: "rejected", commandId, code: "policy-refused", message: "Relay did not do this, so nothing changed." });
    const targets = [
      NotificationTargetSchema.parse({ kind: "recovery", commandId, request }),
      NotificationTargetSchema.parse({ kind: "command-result", commandId, request, result }),
      NotificationTargetSchema.parse({ kind: "bulk-result", bulkCommandId: commandId, type: "pause", requestedCount: 1, results: [], notAttempted: [], days: {} }),
    ];
    for (const commandTarget of targets) expect((await resolveRunNavigation(client, commandTarget, origin, () => true)).state).toBe("refused");
    expect(client.dashboardDay).not.toHaveBeenCalled();
    expect(client.runDetail).not.toHaveBeenCalled();
  });
});
