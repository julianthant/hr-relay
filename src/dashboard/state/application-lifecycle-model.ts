import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApplicationLifecycle } from "../../models/dashboard/application-lifecycle.js";
import type { DashboardClient } from "../client/index.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "./async-resource.js";

export function useApplicationLifecycle(client: DashboardClient, authority: object) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const request = useMemo(() => ({ client, authority }), [client, authority]);
  const [result, setResult] = useState<{ request: object; value: AsyncResource<ApplicationLifecycle> }>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = observeAsyncResource(() => client.applicationLifecycle(), value => {
      setResult({ request, value });
      if (value.state === "loaded") timer = setTimeout(refresh, 1000);
    });
    return () => { close(); clearTimeout(timer); };
  }, [client, request, revision, refresh]);
  return { resource: result?.request === request ? result.value : LOADING, refresh };
}
