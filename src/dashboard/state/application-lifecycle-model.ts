import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationLifecycle } from "../../models/dashboard/application-lifecycle.js";
import type { DashboardClient } from "../client/index.js";
import { observeAsyncResource, LOADING, type AsyncResource } from "./async-resource.js";

function sameResource(a: AsyncResource<ApplicationLifecycle>, b: AsyncResource<ApplicationLifecycle>): boolean {
  if (a.state === "loaded" && b.state === "loaded") return JSON.stringify(a.value) === JSON.stringify(b.value);
  if (a.state === "failed" && b.state === "failed") return a.error.message === b.error.message && a.error.code === b.error.code;
  return false;
}

function changePending(value: ApplicationLifecycle): boolean {
  return value.state !== "ready" || value.pause === "pause-pending" || value.update === "pending";
}

export function useApplicationLifecycle(client: DashboardClient, authority: object) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const request = useMemo(() => ({ client, authority }), [client, authority]);
  const [result, setResult] = useState<{ request: object; value: AsyncResource<ApplicationLifecycle> }>();
  const shown = useRef<{ request: object; value: AsyncResource<ApplicationLifecycle> } | undefined>(undefined);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let close = () => {};
    const poll = () => {
      close = observeAsyncResource(() => client.applicationLifecycle(), value => {
        const previous = shown.current;
        if (!previous || previous.request !== request || !sameResource(previous.value, value)) {
          shown.current = { request, value };
          setResult(shown.current);
        }
        if (value.state === "loaded" && changePending(value.value)) timer = setTimeout(poll, 1000);
      });
    };
    poll();
    return () => { close(); clearTimeout(timer); };
  }, [client, request, revision]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  return { resource: result?.request === request ? result.value : LOADING, refresh };
}
