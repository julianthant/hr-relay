/** The client's row store: the whole read-model values the stream carries for the open views.
 * A row replaces the held value for its `(model, key)` and is never patched, so applying an envelope twice leaves it as it was. */
import type { RunPanel, StreamRow } from "../../../models/dashboard/subscription.js";

export interface RowStore {
  /** The held panel of the open run, or `undefined` before the stream has delivered it. */
  runPanel(runId: string): RunPanel | undefined;
  subscribe(listener: () => void): () => void;
}

export interface RowStoreWriter extends RowStore {
  /** Replaces the held value of each row whose run is open; rows of any other run are dropped. */
  apply(rows: readonly StreamRow[]): void;
  /** Names the open run; the panel of every other run is dropped. */
  open(runId: string | undefined): void;
}

export function createRowStore(): RowStoreWriter {
  const panels = new Map<string, RunPanel>();
  const listeners = new Set<() => void>();
  let openRun: string | undefined;
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  return {
    runPanel: (runId) => panels.get(runId),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    apply: (rows) => {
      let changed = false;
      for (const row of rows) {
        if (row.model !== "run-panel" || row.key !== openRun) continue;
        panels.set(row.key, row.value);
        changed = true;
      }
      if (changed) notify();
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
