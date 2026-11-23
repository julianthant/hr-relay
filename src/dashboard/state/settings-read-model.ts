import { useMemo, useRef } from "react";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { SETTINGS_READ_DEADLINE_MS, readWithDeadline } from "../client/read-deadline.js";
import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { useDashboardCommandBinding } from "./client-context.js";
import { onKeptResultsDropped } from "./async-resource.js";

export class SettingsReadSuperseded extends Error {}

export type RetainedRead<Value> =
  | Readonly<{ state: "idle"; value?: undefined; error?: undefined }>
  | Readonly<{ state: "loading"; value?: Value; error?: undefined }>
  | Readonly<{ state: "loaded"; value: Value; error?: undefined }>
  | Readonly<{ state: "failed"; value?: Value; error: unknown }>;
export function createSettingsRead<Value>() {
  let snapshot: RetainedRead<Value> = { state: "idle" };
  let pending: Promise<Value> | undefined;
  let sequence = 0;
  let stale = 0;
  let last: { read: (signal: AbortSignal) => Promise<Value>; code: ErrorCatalogCode; milliseconds: number; signal?: AbortSignal } | undefined;
  const listeners = new Set<() => void>();
  const supersede = (): void => { sequence += 1; pending = undefined; snapshot = snapshot.value === undefined ? { state: "idle" } : { state: "loaded", value: snapshot.value }; };
  const publish = (next: RetainedRead<Value>): void => { snapshot = next; for (const listener of listeners) listener(); };
  /** An aborted read (its section was left) is superseded at once, so a re-entry starts a fresh read. */
  const startRead = (reader: (signal: AbortSignal) => Promise<Value>, code: ErrorCatalogCode, milliseconds = SETTINGS_READ_DEADLINE_MS, signal?: AbortSignal): Promise<Value> => {
    last = { read: reader, code, milliseconds, ...(signal === undefined ? {} : { signal }) };
    if (pending !== undefined) return pending;
    const started = ++sequence;
    publish({ state: "loading", value: snapshot.value });
    signal?.addEventListener("abort", () => { if (started === sequence) supersede(); }, { once: true });
    const reading = readWithDeadline(reader, code, milliseconds, signal).then(value => {
      if (started !== sequence) throw new SettingsReadSuperseded();
      publish({ state: "loaded", value });
      return value;
    }, (error: unknown) => {
      if (started !== sequence || signal?.aborted === true) throw new SettingsReadSuperseded();
      publish({ state: "failed", value: snapshot.value, error });
      throw error;
    }).finally(() => { if (started === sequence) pending = undefined; });
    pending = reading;
    return reading;
  };
  return {
    snapshot: () => snapshot,
    /** Counts stream resets this read lived through; an owner that shows it reads again when it moves. */
    stale: () => stale,
    /** Nothing shows it and nothing reads it: dropping it loses only a kept copy. */
    idle: () => listeners.size === 0 && pending === undefined,
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    supersede,
    reset() { sequence += 1; pending = undefined; snapshot = { state: "idle" }; },
    accept(value: Value) { sequence += 1; pending = undefined; publish({ state: "loaded", value }); },
    /** A stream reset: what this read holds becomes a kept copy, display only, and its last read runs again. */
    invalidate() {
      sequence += 1; pending = undefined; stale += 1;
      publish({ state: "loading", value: snapshot.value });
      const again = last;
      if (again !== undefined && again.signal?.aborted !== true) void startRead(again.read, again.code, again.milliseconds, again.signal).catch(() => snapshot);
    },
    read(reader: (signal: AbortSignal) => Promise<Value>, code: ErrorCatalogCode, milliseconds?: number, signal?: AbortSignal): Promise<Value> { return startRead(reader, code, milliseconds, signal); },
  };
}
export type SettingsRead<Value> = ReturnType<typeof createSettingsRead<Value>>;
/** How many named reads one client keeps; past it, the least recently used idle read is forgotten. */
export const SETTINGS_READS_LIMIT = 16;
const scopes = new WeakMap<object, { authority: object; coordinate: string; resources: Map<string, SettingsRead<unknown>> }>();
export function settingsReadResource<Value>(client: object, authority: object, coordinate: string, name: string): SettingsRead<Value> {
  let scope = scopes.get(client);
  if (scope === undefined || scope.authority !== authority || scope.coordinate !== coordinate) {
    if (scope !== undefined) for (const resource of scope.resources.values()) resource.reset();
    scope = { authority, coordinate, resources: new Map() };
    scopes.set(client, scope);
  }
  let resource = scope.resources.get(name) as SettingsRead<Value> | undefined;
  if (resource === undefined) resource = createSettingsRead<Value>();
  scope.resources.delete(name);
  scope.resources.set(name, resource);
  for (const [oldest, held] of scope.resources) {
    if (scope.resources.size <= SETTINGS_READS_LIMIT) break;
    if (oldest === name || !held.idle()) continue;
    held.reset();
    scope.resources.delete(oldest);
  }
  return resource;
}
/** Sign-out and a stream reset forget every kept read nothing is showing, and read every shown one again. */
function invalidateSettingsReads(client: object): void {
  const scope = scopes.get(client);
  if (scope === undefined) return;
  for (const [name, resource] of [...scope.resources]) {
    if (!resource.idle()) { resource.invalidate(); continue; }
    resource.reset();
    scope.resources.delete(name);
  }
}
onKeptResultsDropped(invalidateSettingsReads);
export function clearSettingsReads(client: object): void {
  const scope = scopes.get(client);
  if (scope !== undefined) for (const resource of scope.resources.values()) resource.reset();
  scopes.delete(client);
}
export function useSettingsRead<Value>(client: object, name: string, input?: { actorId: string; descriptorFingerprint?: string }): SettingsRead<Value> {
  const binding = useDashboardCommandBinding();
  const authority = binding?.authority.epoch ?? client;
  const coordinate = canonicalJsonStringify([input?.actorId ?? binding?.scope.actorId ?? null,
    input?.descriptorFingerprint ?? binding?.authority.epoch.bootstrap.descriptorHash ?? null]);
  const resource = useMemo(() => settingsReadResource<Value>(client, authority, coordinate, name), [client, authority, coordinate, name]);
  const previous = useRef({ client, resource });
  if (previous.current.resource !== resource) {
    previous.current.resource.reset();
    if (previous.current.client !== client) scopes.delete(previous.current.client);
    previous.current = { client, resource };
  }
  return resource;
}
