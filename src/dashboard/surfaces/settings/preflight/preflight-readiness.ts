import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { preflightReadinessResource, type PreflightReadinessIdentity } from "../../../client/queries/preflight-state.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { usePreflightClient } from "./preflight-client.js";

/** Setup and doctor subscribe to the same served report, scoped by exact runtime identity. */
export function usePreflightReadiness(identity: PreflightReadinessIdentity, provisional = false) {
  const client = usePreflightClient();
  const binding = useDashboardCommandBinding();
  const authority = binding?.authority.epoch;
  const serialized = canonicalJsonStringify(identity);
  const resource = useMemo(() => preflightReadinessResource(client, JSON.parse(serialized) as PreflightReadinessIdentity, authority, provisional), [client, serialized, authority, provisional]);
  const current = useRef<typeof resource | undefined>(resource);
  current.current = resource;
  useEffect(() => { current.current = resource; return () => { if (current.current === resource) current.current = undefined; }; }, [resource]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const actions = useMemo(() => ({
    read: () => current.current === resource ? resource.read() : Promise.resolve(),
    rerun: (command: unknown) => current.current === resource ? resource.rerun(command) : Promise.resolve(),
    invalidate: resource.invalidate,
  }), [resource]);
  return { state, ...actions };
}
