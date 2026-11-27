/** Whole read-model values replace their held rows. A notification publication replaces the notice or group it represents. */
import type { RunPanel, StreamRow } from "../../../models/dashboard/subscription.js";
import type { z } from "zod";
import type { NotificationObservationStatusSchema } from "../../../models/notifications/notifications.js";
import type { EditableSettingsWire } from "../../../models/dashboard/settings-editor.js";
import { upsertListedRow, type NotificationWire } from "../../../models/dashboard/projection.js";

type NotificationObservationStatus = z.infer<typeof NotificationObservationStatusSchema>;

/** The observer status the stream last delivered. A failed read keeps the last good status and marks it unavailable.
 * `stale` holds from a stream's reopening until that stream delivers its own status row. */
export type HeldNotificationStatus = Readonly<{ status?: NotificationObservationStatus; unavailable: boolean; stale?: true }>;
type HeldNotificationList = Readonly<{ rows?: readonly NotificationWire[]; unavailable: boolean; stale?: true }>;

/** The settings document the stream last delivered. A failed read keeps the last good document and marks it unavailable. */
export type HeldSettings = Readonly<{ document?: EditableSettingsWire; unavailable: boolean }>;

export interface RowStore {
  /** The held panel of the open run, or `undefined` before the stream has delivered it. */
  runPanel(runId: string): RunPanel | undefined;
  /** Whether the stream delivered this panel below the revision its own day held for the run: a panel that can never catch up. */
  deliveredBehindRow(panel: RunPanel): boolean;
  /** `undefined` before the stream has delivered the status row. */
  notificationStatus(): HeldNotificationStatus | undefined;
  notificationList(actorId: string): HeldNotificationList | undefined;
  /** `undefined` before the stream has delivered the settings row. */
  settings(): HeldSettings | undefined;
  subscribe(listener: () => void): () => void;
}

export interface RowStoreWriter extends RowStore {
  /** Replaces the held value of each row whose run is open; rows of any other run are dropped.
   * `rowRevision` answers the queue row's revision in the day delivered with them, which marks a panel that arrives below it. */
  apply(rows: readonly StreamRow[], rowRevision?: (runId: string) => number | undefined): void;
  applyNotification(row: NotificationWire): void;
  /** Drops every held row while keeping the name of the open run. */
  reset(): void;
  /** Marks inbox data stale until the new stream delivers its own rows. */
  reopened(): void;
  /** Names the open run; the panel of every other run is dropped. */
  open(runId: string | undefined): void;
}

export function createRowStore(): RowStoreWriter {
  const panels = new Map<string, RunPanel>();
  const behind = new WeakSet<RunPanel>();
  const listeners = new Set<() => void>();
  let openRun: string | undefined;
  let status: HeldNotificationStatus | undefined;
  let inbox: { actorId: string; list: HeldNotificationList } | undefined;
  let settings: HeldSettings | undefined;
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  return {
    runPanel: (runId) => panels.get(runId),
    deliveredBehindRow: (panel) => behind.has(panel),
    notificationStatus: () => status,
    notificationList: actorId => inbox?.actorId === actorId ? inbox.list : undefined,
    settings: () => settings,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    apply: (rows, rowRevision) => {
      let changed = false;
      for (const row of rows) {
        if (row.model === "notification-status") {
          status = row.value.state === "available" ? { status: row.value.value, unavailable: false }
            : { ...(status?.status === undefined ? {} : { status: status.status }), unavailable: true };
          changed = true;
          continue;
        }
        if (row.model === "notification-list") {
          const held = inbox?.actorId === row.key ? inbox.list.rows : undefined;
          inbox = { actorId: row.key, list: row.value.state === "available" ? { rows: row.value.value, unavailable: false }
            : { ...(held === undefined ? {} : { rows: held }), unavailable: true } };
          changed = true;
          continue;
        }
        if (row.model === "settings") {
          const held = settings?.document;
          // A document replaces the held one only when its revision is not below it.
          if (row.value.state === "available" && held !== undefined && row.value.value.revision < held.revision) continue;
          settings = row.value.state === "available" ? { document: row.value.value, unavailable: false }
            : { ...(held === undefined ? {} : { document: held }), unavailable: true };
          changed = true;
          continue;
        }
        if (row.key !== openRun) continue;
        panels.set(row.key, row.value);
        const revision = rowRevision?.(row.key);
        if (row.value.state === "available" && revision !== undefined && row.value.detail.rowRevision < revision) behind.add(row.value);
        changed = true;
      }
      if (changed) notify();
    },
    applyNotification: row => {
      if (inbox?.actorId !== row.actorId || inbox.list.rows === undefined) return;
      const rows = upsertListedRow(inbox.list.rows, row);
      if (rows === inbox.list.rows) return;
      inbox = { actorId: inbox.actorId, list: { ...inbox.list, rows } };
      notify();
    },
    reset: () => {
      if (panels.size === 0 && status === undefined && inbox === undefined && settings === undefined) return;
      panels.clear();
      status = undefined;
      inbox = undefined;
      settings = undefined;
      notify();
    },
    reopened: () => {
      const statusChanged = status !== undefined && status.stale !== true;
      const listChanged = inbox !== undefined && inbox.list.stale !== true;
      if (status !== undefined && statusChanged) status = { ...status, stale: true };
      if (inbox !== undefined && listChanged) inbox = { actorId: inbox.actorId, list: { ...inbox.list, stale: true } };
      if (statusChanged || listChanged) notify();
    },
    open: (runId) => {
      openRun = runId;
      let changed = false;
      for (const key of [...panels.keys()]) {
        if (key === runId) continue;
        panels.delete(key);
        changed = true;
      }
      if (changed) notify();
    },
  };
}

/** How long a settings save's readback waits for the stream's settings row at its revision. */
export const SETTINGS_ROW_WAIT_MS = 10_000;

/** The first held settings document at or above `revision`. Rejects at once on an unavailable row or once `stopped` holds,
 * and after SETTINGS_ROW_WAIT_MS without one; a reset store waits for the snapshot's row.
 * `recheck` collects the check while it waits, so a caller can run it when something other than the store changes. */
export function settingsRowAt(rows: RowStore | undefined, revision: number,
  stopped: () => boolean = () => false, recheck?: Set<() => void>): Promise<EditableSettingsWire> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void): void => { clearTimeout(timer); unsubscribe?.(); recheck?.delete(check); settle(); };
    const check = (): void => {
      const held = rows?.settings();
      if (held?.unavailable === true) finish(() => reject(new Error("settings-row-unavailable")));
      else if (held?.document !== undefined && held.document.revision >= revision) { const document = held.document; finish(() => resolve(document)); }
      else if (rows === undefined || stopped()) finish(() => reject(new Error("settings-row-stream-stopped")));
    };
    const timer = setTimeout(() => finish(() => reject(new Error("settings-row-wait-expired"))), SETTINGS_ROW_WAIT_MS);
    recheck?.add(check);
    const unsubscribe = rows?.subscribe(check);
    check();
  });
}
