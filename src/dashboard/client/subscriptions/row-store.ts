/** The client's row store: the whole read-model values the stream carries for the open views.
 * A row replaces the held value for its `(model, key)` and is never patched, so applying an envelope twice leaves it as it was. */
import type { RunPanel, StreamRow } from "../../../models/dashboard/subscription.js";
import type { z } from "zod";
import type { NotificationObservationStatusSchema } from "../../../models/notifications/notifications.js";
import type { EditableSettingsWire } from "../../../models/dashboard/settings-editor.js";

type NotificationObservationStatus = z.infer<typeof NotificationObservationStatusSchema>;

/** The observer status the stream last delivered. A failed read keeps the last good status and marks it unavailable. */
export type HeldNotificationStatus = Readonly<{ status?: NotificationObservationStatus; unavailable: boolean }>;

/** The settings document the stream last delivered. A failed read keeps the last good document and marks it unavailable. */
export type HeldSettings = Readonly<{ document?: EditableSettingsWire; unavailable: boolean }>;

export interface RowStore {
  /** The held panel of the open run, or `undefined` before the stream has delivered it. */
  runPanel(runId: string): RunPanel | undefined;
  /** Whether the stream delivered this panel below the revision its own day held for the run: a panel that can never catch up. */
  deliveredBehindRow(panel: RunPanel): boolean;
  /** `undefined` before the stream has delivered the status row. */
  notificationStatus(): HeldNotificationStatus | undefined;
  /** `undefined` before the stream has delivered the settings row. */
  settings(): HeldSettings | undefined;
  subscribe(listener: () => void): () => void;
}

export interface RowStoreWriter extends RowStore {
  /** Replaces the held value of each row whose run is open; rows of any other run are dropped.
   * `rowRevision` answers the queue row's revision in the day delivered with them, which marks a panel that arrives below it. */
  apply(rows: readonly StreamRow[], rowRevision?: (runId: string) => number | undefined): void;
  /** Drops every held panel, the status and the settings, keeping the open run: the stream they came from ended, so none may answer a decision. */
  reset(): void;
  /** Names the open run; the panel of every other run is dropped. */
  open(runId: string | undefined): void;
}

export function createRowStore(): RowStoreWriter {
  const panels = new Map<string, RunPanel>();
  const behind = new WeakSet<RunPanel>();
  const listeners = new Set<() => void>();
  let openRun: string | undefined;
  let status: HeldNotificationStatus | undefined;
  let settings: HeldSettings | undefined;
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  return {
    runPanel: (runId) => panels.get(runId),
    deliveredBehindRow: (panel) => behind.has(panel),
    notificationStatus: () => status,
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
    reset: () => {
      if (panels.size === 0 && status === undefined && settings === undefined) return;
      panels.clear();
      status = undefined;
      settings = undefined;
      notify();
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

/** The first held settings document at or above `revision`. Rejects at once on an unavailable row, on a store that holds no
 * settings row (none carried yet, or reset), or once `stopped` holds, and after SETTINGS_ROW_WAIT_MS without one.
 * `recheck` collects the check while it waits, so a caller can run it when something other than the store changes. */
export function settingsRowAt(rows: RowStore | undefined, revision: number,
  stopped: () => boolean = () => false, recheck?: Set<() => void>): Promise<EditableSettingsWire> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void): void => { clearTimeout(timer); unsubscribe?.(); recheck?.delete(check); settle(); };
    const check = (): void => {
      const held = rows?.settings();
      if (held?.unavailable === true) finish(() => reject(new Error("settings-row-unavailable")));
      else if (held?.document !== undefined && held.document.revision >= revision) { const document = held.document; finish(() => resolve(document)); }
      else if (held === undefined) finish(() => reject(new Error("settings-row-not-held")));
      else if (stopped()) finish(() => reject(new Error("settings-row-stream-stopped")));
    };
    const timer = setTimeout(() => finish(() => reject(new Error("settings-row-wait-expired"))), SETTINGS_ROW_WAIT_MS);
    recheck?.add(check);
    const unsubscribe = rows?.subscribe(check);
    check();
  });
}
