import { useEffect, useMemo, useState } from "react";
import type { FrontendBootstrapWire } from "../../models/dashboard/bootstrap.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export function useBootstrap(): AsyncResource<FrontendBootstrapWire> {
  const client = useDashboardClient();
  const request = useMemo(() => ({ client }), [client]);
  const [result, setResult] = useState<{ request: typeof request; resource: AsyncResource<FrontendBootstrapWire> }>();

  useEffect(() => {
    return observeAsyncResource(() => client.bootstrap(), resource => setResult({ request, resource }));
  }, [client, request]);

  return result?.request === request ? result.resource : LOADING;
}
