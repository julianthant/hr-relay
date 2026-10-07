import { useMemo, useSyncExternalStore } from "react";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { preflightReadinessResource, type PreflightReadinessIdentity } from "../client/preflight-state.js";
import { usePreflightClient } from "./preflight-client.js";

/** Setup and doctor subscribe to the same served report, scoped by exact runtime identity. */
export function usePreflightReadiness(identity: PreflightReadinessIdentity) {
  const client = usePreflightClient();
  const serialized = canonicalJsonStringify(identity);
  const resource = useMemo(() => preflightReadinessResource(client, JSON.parse(serialized) as PreflightReadinessIdentity), [client, serialized]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  return { state, read: resource.read, rerun: resource.rerun, invalidate: resource.invalidate };
}
