import type { DashboardDayWire } from "../../models/dashboard/projection.js";

interface Changes {
  seq: number;
  /** The sequence at which each day's run data last changed. */
  readonly days: Map<string, number>;
  readonly fingerprints: Map<string, string>;
  counts: Map<string, number> | undefined;
  readonly listeners: Set<() => void>;
}
const changes = new WeakMap<object, Changes>();
const stateFor = (client: object): Changes => {
  let held = changes.get(client);
  if (held === undefined) { held = { seq: 0, days: new Map(), fingerprints: new Map(), counts: undefined, listeners: new Set() }; changes.set(client, held); }
  return held;
};

/** Records which days' runs moved, from the day frames the dashboard already streams.
 * shortcut: only the streamed day and month signals; assistant counts are not seen, and a report's 15-minute token expiry bounds the rest. */
export function noteRunData(client: object, frame: DashboardDayWire): void {
  const state = stateFor(client);
  const touched = new Set<string>();
  const fingerprint = frame.queueSurfaces.map(row => `${row.runId}:${row.status}:${row.attempt}`).sort().join("|");
  const before = state.fingerprints.get(frame.day);
  if (before !== undefined && before !== fingerprint) touched.add(frame.day);
  state.fingerprints.set(frame.day, fingerprint);
  const counts = new Map<string, number>(frame.monthCounts.map(row => [row.day, row.count]));
  if (state.counts !== undefined) for (const day of new Set([...state.counts.keys(), ...counts.keys()])) if (state.counts.get(day) !== counts.get(day)) touched.add(day);
  state.counts = counts;
  if (touched.size === 0) return;
  state.seq += 1;
  for (const day of touched) state.days.set(day, state.seq);
  for (const listener of [...state.listeners]) listener();
}

/** Moves whenever a day inside `from`..`to` has changed since the page began watching. */
export function runDataVersion(client: object, from: string, to: string): number {
  let version = 0;
  for (const [day, seq] of stateFor(client).days) if (day >= from && day <= to && seq > version) version = seq;
  return version;
}

export function subscribeRunData(client: object, listener: () => void): () => void {
  const { listeners } = stateFor(client);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
