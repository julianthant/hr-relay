import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { PreflightReadinessWire, PreflightSelection } from "../../../models/preflight/preflight-contract.js";
import type { PreflightQueries } from "./preflight-queries.js";

type Report = Extract<PreflightReadinessWire, { state: "present" }>["report"];
type State = PreflightReadinessWire | Readonly<{ state: "idle" }> | Readonly<{ state: "running"; lastCompleted?: Report }>;
export type PreflightReadinessIdentity = Readonly<{
  configFingerprint: string; descriptorFingerprint: string; selection?: PreflightSelection;
  /** Settings/protected revision and runtime status invalidate still-pending observations. */
  settingsRevision?: string;
}>;
export function createPreflightReadinessResource(client: PreflightQueries, identity: PreflightReadinessIdentity) {
  let state: State = { state: "idle" };
  let lastCompleted: Report | undefined;
  let epoch = 0;
  const listeners = new Set<() => void>();
  const publish = (next: State): void => { state = next; for (const listener of listeners) listener(); };
  const observe = async (read: () => Promise<PreflightReadinessWire>): Promise<void> => {
    const started = ++epoch;
    publish({ state: "running", ...(lastCompleted === undefined ? {} : { lastCompleted }) });
    try {
      const result = await read();
      if (started !== epoch) return;
      if (result.state === "present" && (result.report.configFingerprint !== identity.configFingerprint || result.report.descriptorFingerprint !== identity.descriptorFingerprint)) {
        publish({ state: "unavailable", reason: "Preflight identity changed; refresh settings and re-check readiness.", ...(lastCompleted === undefined ? {} : { lastCompleted }) });
      } else {
        lastCompleted = result.state === "present" ? result.report : result.lastCompleted ?? lastCompleted;
        publish(result.state === "unavailable" ? { ...result, ...(lastCompleted === undefined ? {} : { lastCompleted }) } : result);
      }
    } catch (error) {
      if (started === epoch) publish({ state: "unavailable", reason: error instanceof Error ? error.message : "Preflight could not be read.", ...(lastCompleted === undefined ? {} : { lastCompleted }) });
    }
  };
  return Object.freeze({
    snapshot: (): State => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate() { epoch += 1; publish({ state: "unavailable", reason: "Runtime state changed; re-check readiness.", ...(lastCompleted === undefined ? {} : { lastCompleted }) }); },
    read: () => observe(() => client.readPreflight(identity.selection)),
    rerun: (request: unknown) => observe(async () => {
      await client.rerunPreflight(request);
      // Replay preserves the historical command result; only readback certifies current freshness.
      return client.readPreflight(identity.selection);
    }),
  });
}
export type PreflightReadinessResource = ReturnType<typeof createPreflightReadinessResource>;
const resources = new WeakMap<PreflightQueries, Map<string, PreflightReadinessResource>>();
export function preflightReadinessResource(client: PreflightQueries, identity: PreflightReadinessIdentity): PreflightReadinessResource {
  let owned = resources.get(client);
  if (owned === undefined) { owned = new Map(); resources.set(client, owned); }
  const key = canonicalJsonStringify(identity);
  let resource = owned.get(key);
  if (resource === undefined) { resource = createPreflightReadinessResource(client, identity); owned.set(key, resource); }
  return resource;
}
export function invalidatePreflightReadiness(client: PreflightQueries): void {
  for (const resource of resources.get(client)?.values() ?? []) resource.invalidate();
}
