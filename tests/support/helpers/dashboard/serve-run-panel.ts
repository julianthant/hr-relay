import type { NotificationWire } from "../../../../src/models/dashboard/projection.js";
import { DashboardClientError, type DashboardClient, type RowStoreWriter } from "../../../../src/dashboard/client/index.js";
import { WireErrorSchema } from "../../../../src/models/dashboard/primitives.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import type { RunPanel } from "../../../../src/models/dashboard/subscription.js";
import { appendLogPage } from "../../../../src/dashboard/surfaces/run-detail/logs-model.js";

type PanelReads = Pick<DashboardClient, "runDetail" | "runSection">;
const PANEL_SECTIONS = ["captures", "identity-gate", "parked-write", "failure", "workbook-writes"];

/** The `run-panel` value the server would stream for the run, built from the same reads a fixture client answers. */
export async function readRunPanel(client: PanelReads, runId: string): Promise<Extract<RunPanel, { state: "available" }>> {
  const signal = new AbortController().signal;
  const detail = await client.runDetail(runId, signal);
  const first = await client.runSection(runId, "logs", undefined, signal);
  if (first.section !== "logs") throw new Error("fixture logs section expected");
  let logs = first.payload;
  while (logs.nextCursor.state === "present") {
    const cursor = logs.nextCursor.value;
    const next = await client.runSection(runId, "logs", cursor, signal);
    if (next.section !== "logs") throw new Error("fixture logs section expected");
    logs = appendLogPage(logs, cursor, next.payload);
  }
  const sections = await Promise.all(detail.availableSections.filter(name => PANEL_SECTIONS.includes(name)
    && (name !== "captures" || detail.captures?.state === "available")).map(name => client.runSection(runId, name, undefined, signal)));
  return { state: "available", detail, logs, sections };
}

/** Streams the run's panel into the store, as the server's `change` row would. */
export async function serveRunPanel(rows: RowStoreWriter, client: PanelReads, runId: string, panel?: RunPanel, rowRevision?: (runId: string) => number | undefined): Promise<void> {
  rows.open(runId);
  rows.apply([{ model: "run-panel", key: runId as never, value: panel ?? await readRunPanel(client, runId) }], rowRevision);
}

/** The `notification-status` row the server sends with every snapshot, for an observer that is ready. */
export function serveReadyNotificationStatus(rows: RowStoreWriter | undefined): void {
  rows?.apply([{ model: "notification-status", key: ActorIdSchema.parse("local-operator"), value: { state: "available", value: { state: "ready", pending: 0 } } }]);
}

export function serveNotificationList(rows: RowStoreWriter | undefined, notices: readonly NotificationWire[]): void {
  rows?.apply([{ model: "notification-list", key: ActorIdSchema.parse("local-operator"), value: { state: "available", value: [...notices] } }]);
}

type DaySubscription = ReturnType<DashboardClient["subscribeDay"]>;

/** The subscription a fake `subscribeDay` returns: streams the open run's panel into `input.rows`, now and on each `select`.
 * A panel the fixture client cannot read is streamed as the refusal the server would send. */
export function streamingRunPanel(input: Parameters<DashboardClient["subscribeDay"]>[0], client: PanelReads): DaySubscription {
  const stream = (run: string | undefined): void => {
    input.rows?.open(run);
    const rows = input.rows;
    if (rows === undefined || run === undefined) return;
    void serveRunPanel(rows, client, run).catch((cause: unknown) => {
      const error = WireErrorSchema.parse({ state: "error", code: "DASHBOARD_READ_FAILED", message: "fixture panel read failed",
        retryable: !(cause instanceof DashboardClientError) || cause.retryable });
      rows.apply([{ model: "run-panel", key: run as never, value: { state: "refused", error } }]);
    });
  };
  serveReadyNotificationStatus(input.rows);
  stream(input.run);
  return { select: stream, close: () => undefined };
}
