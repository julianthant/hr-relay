/** The client's row store: the whole read-model values the stream carries for the open views.
 * A row replaces the held value for its `(model, key)` and is never patched, so applying an envelope twice leaves it as it was. */
import type { RunPanel, StreamRow } from "../../../models/dashboard/subscription.js";

export interface RowStore {
  /** The held panel of the open run, or `undefined` before the stream has delivered it. */
  runPanel(runId: string): RunPanel | undefined;
  /** Whether the stream delivered this panel below the revision its own day held for the run: a panel that can never catch up. */
  deliveredBehindRow(panel: RunPanel): boolean;
  subscribe(listener: () => void): () => void;
}

export interface RowStoreWriter extends RowStore {
  /** Replaces the held value of each row whose run is open; rows of any other run are dropped.
   * `rowRevision` answers the queue row's revision in the day delivered with them, which marks a panel that arrives below it. */
  apply(rows: readonly StreamRow[], rowRevision?: (runId: string) => number | undefined): void;
  /** Drops every held panel, keeping the open run: the stream they came from ended, so none may answer a decision. */
  reset(): void;
  /** Names the open run; the panel of every other run is dropped. */
  open(runId: string | undefined): void;
}

export function createRowStore(): RowStoreWriter {
  const panels = new Map<string, RunPanel>();
  const behind = new WeakSet<RunPanel>();
  const listeners = new Set<() => void>();
  let openRun: string | undefined;
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  return {
    runPanel: (runId) => panels.get(runId),
    deliveredBehindRow: (panel) => behind.has(panel),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    apply: (rows, rowRevision) => {
      let changed = false;
      for (const row of rows) {
        if (row.model !== "run-panel" || row.key !== openRun) continue;
        panels.set(row.key, row.value);
        const revision = rowRevision?.(row.key);
        if (row.value.state === "available" && revision !== undefined && row.value.detail.rowRevision < revision) behind.add(row.value);
        changed = true;
      }
      if (changed) notify();
    },
    reset: () => {
      if (panels.size === 0) return;
      panels.clear();
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
