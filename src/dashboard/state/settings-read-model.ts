import { useMemo, useRef } from "react";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { SETTINGS_READ_DEADLINE_MS, readWithDeadline } from "../client/read-deadline.js";
import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { useDashboardCommandBinding } from "./client-context.js";

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
  const listeners = new Set<() => void>();
  const publish = (next: RetainedRead<Value>): void => { snapshot = next; for (const listener of listeners) listener(); };
  return {
    snapshot: () => snapshot,
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    supersede() { sequence += 1; pending = undefined; snapshot = snapshot.value === undefined ? { state: "idle" } : { state: "loaded", value: snapshot.value }; },
    reset() { sequence += 1; pending = undefined; snapshot = { state: "idle" }; },
    accept(value: Value) { sequence += 1; pending = undefined; publish({ state: "loaded", value }); },
    read(read: () => Promise<Value>, code: ErrorCatalogCode, milliseconds = SETTINGS_READ_DEADLINE_MS): Promise<Value> {
      if (pending !== undefined) return pending;
      const started = ++sequence;
      publish({ state: "loading", value: snapshot.value });
      const reading = readWithDeadline(() => read(), code, milliseconds).then(value => {
        if (started !== sequence) throw new SettingsReadSuperseded();
        publish({ state: "loaded", value });
        return value;
      }, (error: unknown) => {
        if (started !== sequence) throw new SettingsReadSuperseded();
        publish({ state: "failed", value: snapshot.value, error });
        throw error;
      }).finally(() => { if (started === sequence) pending = undefined; });
      pending = reading;
      return reading;
    },
  };
}
export type SettingsRead<Value> = ReturnType<typeof createSettingsRead<Value>>;
const scopes = new WeakMap<object, { authority: object; coordinate: string; resources: Map<string, unknown> }>();
export function settingsReadResource<Value>(client: object, authority: object, coordinate: string, name: string): SettingsRead<Value> {
  let scope = scopes.get(client);
  if (scope === undefined || scope.authority !== authority || scope.coordinate !== coordinate) {
    scope = { authority, coordinate, resources: new Map() };
    scopes.set(client, scope);
  }
  let resource = scope.resources.get(name) as SettingsRead<Value> | undefined;
  if (resource === undefined) { resource = createSettingsRead<Value>(); scope.resources.set(name, resource); }
  return resource;
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
