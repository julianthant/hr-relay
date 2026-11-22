import { useEffect, useMemo, useState } from "react";
import type { FrontendBootstrapWire } from "../../models/dashboard/bootstrap.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";
import { readWithDeadline } from "../client/read-deadline.js";

/** A startup read that has not answered by now fails into its notice instead of holding the loader. */
export const STARTUP_READ_DEADLINE_MS = 20_000;

export function useBootstrap(authority: unknown = true, enabled = true): AsyncResource<FrontendBootstrapWire> {
  const client = useDashboardClient();
  const request = useMemo(() => ({ client, authority, enabled }), [client, authority, enabled]);
  const [result, setResult] = useState<{ request: typeof request; resource: AsyncResource<FrontendBootstrapWire> }>();

  useEffect(() => {
    if (!enabled) return;
    return observeAsyncResource(() => readWithDeadline(() => client.bootstrap(), "DASHBOARD_READ_FAILED", STARTUP_READ_DEADLINE_MS), resource => setResult({ request, resource }));
  }, [client, request, enabled]);

  return result?.request === request ? result.resource : LOADING;
}
