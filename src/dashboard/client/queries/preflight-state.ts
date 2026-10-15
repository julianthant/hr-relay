import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { PreflightRerunCommandRequestSchema, type PreflightReadinessWire, type PreflightSelection } from "../../../models/preflight/preflight-contract.js";
import type { PreflightQueries } from "./preflight-queries.js";

type Report = Extract<PreflightReadinessWire, { state: "present" }>["report"];
export type PreflightReadinessState = PreflightReadinessWire | Readonly<{ state: "idle" }>
  | Readonly<{ state: "running"; lastCompleted?: Report; previous?: PreflightReadinessWire }>;
export type PreflightReadinessIdentity = Readonly<{
  configFingerprint: string; descriptorFingerprint: string; selection?: PreflightSelection;
  /** Settings/protected revision and runtime status invalidate still-pending observations. */
  settingsRevision?: string;
  actorId?: string;
  selectedScope?: string;
}>;
export function createPreflightReadinessResource(client: PreflightQueries, identity: PreflightReadinessIdentity) {
  let state: PreflightReadinessState = { state: "idle" };
  let lastCompleted: Report | undefined;
  let epoch = 0;
  const listeners = new Set<() => void>();
  const publish = (next: PreflightReadinessState): void => { state = next; for (const listener of listeners) listener(); };
  const observe = async (read: (isCurrent: () => boolean) => Promise<PreflightReadinessWire>): Promise<void> => {
    const started = ++epoch;
    const previous = state.state === "running" ? state.previous : state.state === "idle" ? undefined : state;
    publish({ state: "running", ...(lastCompleted === undefined ? {} : { lastCompleted }), ...(previous === undefined ? {} : { previous }) });
    try {
      const result = await read(() => started === epoch);
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
    snapshot: (): PreflightReadinessState => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate() { epoch += 1; publish({ state: "unavailable", reason: "Runtime state changed; re-check readiness.", ...(lastCompleted === undefined ? {} : { lastCompleted }) }); },
    read: () => observe(() => client.readPreflight(identity.selection)),
    rerun: (request: unknown) => observe(async isCurrent => {
      const command = PreflightRerunCommandRequestSchema.parse(request);
      if (command.target.expectedConfigFingerprint !== identity.configFingerprint
        || command.target.expectedDescriptorFingerprint !== identity.descriptorFingerprint
        || canonicalJsonStringify(command.target.selection ?? null) !== canonicalJsonStringify(identity.selection ?? null)
        || identity.actorId !== undefined && command.requestedBy !== identity.actorId) throw new Error(formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_RESULT_IDENTITY_MISMATCH", {})).text);
      await client.rerunPreflight(command);
      if (!isCurrent()) return { state: "unavailable", reason: "Runtime state changed; re-check readiness." };
      // Replay preserves the historical command result; only readback certifies current freshness.
      return client.readPreflight(identity.selection);
    }),
  });
}
export type PreflightReadinessResource = ReturnType<typeof createPreflightReadinessResource>;
const resources = new WeakMap<PreflightQueries, { authority: object; coordinate: string; key: string; resource: PreflightReadinessResource }>();
export function preflightReadinessResource(client: PreflightQueries, identity: PreflightReadinessIdentity, authority: object = client, provisional = false): PreflightReadinessResource {
  const coordinate = canonicalJsonStringify([identity.actorId ?? null, identity.selectedScope ?? identity.selection ?? null]);
  const current = resources.get(client);
  if (current !== undefined && (current.authority !== authority || current.coordinate !== coordinate)) resources.delete(client);
  if (provisional) return createPreflightReadinessResource(client, identity);
  const key = canonicalJsonStringify(identity);
  if (current?.authority === authority && current.coordinate === coordinate && current.key === key) return current.resource;
  const resource = createPreflightReadinessResource(client, identity);
  resources.set(client, { authority, coordinate, key, resource });
  return resource;
}
export function invalidatePreflightReadiness(client: PreflightQueries): void {
  resources.get(client)?.resource.invalidate();
}
