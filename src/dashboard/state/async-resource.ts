/** The one shape every asynchronous read in the dashboard takes.
 * "Loading" and "failed" are DIFFERENT states from "loaded something empty" */
import { DashboardClientError } from "../client/errors.js";

/** A view's last loaded value and the position or version it was served at. Display only: a
 * kept result is never `loaded`, so nothing that decides reads it. */
export interface KeptResult<Value> { readonly value: Value; readonly at: string | number }

export type AsyncResource<Value> =
  | { readonly state: "loading"; readonly kept?: KeptResult<Value> }
  | { readonly state: "loaded"; readonly value: Value }
  | { readonly state: "failed"; readonly error: DashboardClientError };

export const LOADING: AsyncResource<never> = Object.freeze({ state: "loading" });

export function loadingWith<Value>(kept: KeptResult<Value> | undefined): AsyncResource<Value> {
  return kept === undefined ? LOADING : { state: "loading", kept };
}

export function loaded<Value>(value: Value): AsyncResource<Value> {
  return { state: "loaded", value };
}

export function failed<Value>(error: DashboardClientError): AsyncResource<Value> {
  return { state: "failed", error };
}

/** One effect-owned read. Cleanup revokes both settlement callbacks, including
 * an old rejection after a newer request has succeeded. The caller retains */
export function observeResource<Value>(
  read: () => Promise<Value>,
  onValue: (value: Value) => void,
  onError: (error: unknown) => void,
): () => void {
  let live = true;
  // The read starts after the mount settles: a mount cancelled in the same tick
  // (StrictMode's probe mount) sends nothing. A throwing read settles as an error.
  queueMicrotask(() => {
    if (!live) return;
    void Promise.resolve().then(read).then(
      (value) => { if (live) onValue(value); },
      (error: unknown) => { if (live) onError(error); },
    );
  });
  return () => { live = false; };
}

/** Typed client failures are resource values; programming faults still escape. */
export function observeAsyncResource<Value>(
  read: () => Promise<Value>,
  settle: (resource: AsyncResource<Value>) => void,
): () => void {
  return observeResource(read, (value) => settle(loaded(value)), (error) => {
    if (error instanceof DashboardClientError) { settle(failed(error)); return; }
    throw error;
  });
}

const keptStores = new Set<{ readonly drop: (owner: object) => void }>();

/** Another cache of kept results joins sign-out and stream-reset invalidation. */
export function onKeptResultsDropped(drop: (owner: object) => void): void {
  keptStores.add({ drop });
}

/** The last result per view key, held per owner (a client) under one authority (sign-in epoch, actor):
 * a different authority drops everything the owner kept, and past `limit` the least recently used goes first. */
export function createKeptResults<Value>(limit: number) {
  const owners = new WeakMap<object, { authority: readonly unknown[]; entries: Map<string, KeptResult<Value>> }>();
  const entriesFor = (owner: object, authority: readonly unknown[]): Map<string, KeptResult<Value>> => {
    let held = owners.get(owner);
    if (held === undefined || held.authority.length !== authority.length || held.authority.some((part, index) => !Object.is(part, authority[index]))) {
      held = { authority, entries: new Map() };
      owners.set(owner, held);
    }
    return held.entries;
  };
  const store = Object.freeze({
    get(owner: object, authority: readonly unknown[], key: string): KeptResult<Value> | undefined {
      const entries = entriesFor(owner, authority);
      const kept = entries.get(key);
      if (kept === undefined) return undefined;
      entries.delete(key);
      entries.set(key, kept);
      return kept;
    },
    keep(owner: object, authority: readonly unknown[], key: string, kept: KeptResult<Value>): void {
      const entries = entriesFor(owner, authority);
      entries.delete(key);
      entries.set(key, kept);
      for (const oldest of entries.keys()) {
        if (entries.size <= limit) break;
        entries.delete(oldest);
      }
    },
    drop(owner: object): void { owners.delete(owner); },
  });
  keptStores.add(store);
  return store;
}

/** Sign-out and a stream reset: every view kind forgets what this owner kept. */
export function dropKeptResults(owner: object): void {
  for (const store of keptStores) store.drop(owner);
}
