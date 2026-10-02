/**
 * The boot document (ref frontend-backend-integration §3.1): one fetch, and the ONLY source of the
 * shell's vocabulary — actor, clock, storage health, workflows, categories,
 * system instances, feature availability. The client derives navigation from
 * this list; there is no parallel workflow registry in the frontend.
 */
import { useEffect, useState } from "react";
import type { FrontendBootstrapWire } from "../../models/dashboard/bootstrap.js";
import { DashboardClientError } from "../client/index.js";
import { failed, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export function useBootstrap(): AsyncResource<FrontendBootstrapWire> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<FrontendBootstrapWire>>(LOADING);

  useEffect(() => {
    let live = true;
    setResource(LOADING);
    client.bootstrap().then(
      (value) => {
        if (live) setResource(loaded(value));
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          setResource(failed(error));
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  return resource;
}
