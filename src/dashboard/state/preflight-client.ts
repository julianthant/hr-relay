import { useEffect, useSyncExternalStore } from "react";
import type { PreflightQueries } from "../client/preflight-queries.js";
import { useDashboardClient } from "./client-context.js";
export function usePreflightClient(): PreflightQueries { return useDashboardClient(); }

type ScopeState = Readonly<{ selected: string; workflows: Awaited<ReturnType<PreflightQueries["preflightScopes"]>>; state: "idle" | "loading" | "ready" | "unavailable" }>;
const scopes = new WeakMap<PreflightQueries, ReturnType<typeof createScopes>>();
function createScopes(client: PreflightQueries) {
  let state: ScopeState = { selected: "dashboard", workflows: [], state: "idle" };
  const listeners = new Set<() => void>();
  const publish = (next: ScopeState): void => { state = next; for (const listener of listeners) listener(); };
  return {
    snapshot: () => state,
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async read(this: void) {
      if (state.state === "loading" || state.state === "ready") return;
      publish({ ...state, state: "loading" });
      try { publish({ ...state, workflows: await client.preflightScopes(), state: "ready" }); }
      catch { publish({ ...state, state: "unavailable" }); }
    },
    select(this: void, selected: string) {
      if (selected !== "dashboard" && !state.workflows.some(workflow => workflow.id === selected)) throw new Error("Unknown preflight scope");
      publish({ ...state, selected });
    },
  };
}
/** One selected served scope for Setup and doctor; never a second workflow catalog. */
export function usePreflightScope() {
  const client = usePreflightClient();
  let resource = scopes.get(client);
  if (resource === undefined) { resource = createScopes(client); scopes.set(client, resource); }
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const read = resource.read;
  useEffect(() => { void read(); }, [read]);
  const workflow = state.workflows.find(candidate => candidate.id === state.selected);
  return { ...state, workflow, select: resource.select };
}
