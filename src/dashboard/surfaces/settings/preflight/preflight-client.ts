import { readWithDeadline } from "../../../client/read-deadline.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../../../models/dashboard/bootstrap.js";
import { useViewState } from "../../../app/navigation/view-route-model.js";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PreflightQueries } from "../../../client/queries/preflight-queries.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
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
      try { publish({ ...state, workflows: await readWithDeadline(() => client.preflightScopes(), "PREFLIGHT_SCOPE_UNAVAILABLE"), state: "ready" }); }
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
  const binding = useDashboardCommandBinding();
  const bootstrap = binding?.authority.epoch.bootstrap;
  const workflows = useMemo(() => bootstrap === undefined ? undefined : WorkflowBootstrapPrimitiveSchema.array().parse(bootstrap.workflows), [bootstrap]);
  let resource = scopes.get(client);
  if (resource === undefined) { resource = createScopes(client); scopes.set(client, resource); }
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const read = resource.read;
  useEffect(() => { if (binding === undefined) void read(); }, [read, binding]);
  const [selected, setSelected] = useViewState("preflightScope", state.selected);
  const available = workflows === undefined ? state : { ...state, state: "ready" as const, workflows };
  const workflow = available.workflows.find(candidate => candidate.id === selected);
  const unknown = available.state === "ready" && selected !== "dashboard" && workflow === undefined;
  return { ...available, state: unknown ? "unavailable" as const : available.state, selected, workflow, select: (next: string) => { if (binding === undefined) resource.select(next);
    else if (next !== "dashboard" && !available.workflows.some(candidate => candidate.id === next)) throw new Error("Unknown preflight scope");
    setSelected(next); } };
}
