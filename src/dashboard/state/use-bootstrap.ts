import { useEffect, useState } from "react";
import type { FrontendBootstrapWire } from "../../models/dashboard/bootstrap.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export function useBootstrap(): AsyncResource<FrontendBootstrapWire> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<FrontendBootstrapWire>>(LOADING);

  useEffect(() => {
    setResource(LOADING);
    return observeAsyncResource(() => client.bootstrap(), setResource);
  }, [client]);

  return resource;
}
