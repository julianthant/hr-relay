import { StatusBadge } from "../../../../../src/dashboard/surfaces/shared/status/status.js";
import { dsStatusOf } from "../../../../../src/dashboard/surfaces/shared/status/status-model.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrontendBootstrapWire } from "../../../../../src/models/dashboard/bootstrap.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../../../src/dashboard/app/dashboard-app-model.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../../../src/dashboard/state/client-context.js";
import { RunReview } from "../../../../../src/dashboard/surfaces/run-detail/review/review.js";
import { Banner } from "../../../../../src/dashboard/ds/ui.js";
import { serverLocalDay } from "../../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const [client] = useState(() => createDashboardClient({ baseUrl: location.origin }));
  const [data, setData] = useState<{ bootstrap: FrontendBootstrapWire; day: DashboardDayWire }>();
  const [error, setError] = useState(false);
  const active = useRef(true);
  const scopeRef = useRef<CommandExecutionScope>(undefined);
  const [executor] = useState(() => new CommandExecutor(() => scopeRef.current));
  useEffect(() => {
    active.current = true;
    void (async () => {
      try {
        const bootstrap = await client.bootstrap(), day = await client.dashboardDay(serverLocalDay(bootstrap.serverClock));
        if (active.current) setData({ bootstrap, day });
      } catch { if (active.current) setError(true); }
    })();
    return () => { active.current = false; scopeRef.current = undefined; };
  }, [client]);
  const refresh = useCallback(() => {
    if (data === undefined) return;
    void client.dashboardDay(data.day.day).then(day => {
      if (active.current) setData(current => current === undefined ? undefined : { ...current, day });
    }, () => { if (active.current) setError(true); });
  }, [client, data]);
  const bootstrap = data?.bootstrap, day = data?.day;
  const epoch = useMemo(() => bootstrap === undefined ? undefined : { client, bootstrap }, [client, bootstrap]);
  const request = useMemo(() => day === undefined ? undefined : { client, day: day.day, epoch, revision: day.projectionGeneration }, [client, day, epoch]);
  const scope = useMemo(() => epoch === undefined || request === undefined ? undefined : { actorId: epoch.bootstrap.actor.id, client, authority: epoch, dayRequest: request }, [client, epoch, request]);
  scopeRef.current = scope;
  const binding = useMemo<DashboardCommandBinding | undefined>(() => data === undefined || epoch === undefined || request === undefined || scope === undefined ? undefined : {
    executor, scope, feedback: () => undefined, authority: { epoch, catalog: [], nowIso: data.bootstrap.serverClock.now, today: data.day.day, day: data.day.day,
      dayState: { request, day: { state: "loaded", value: data.day }, connection: { state: "connecting" }, refresh, subscribePublications: () => () => undefined },
      selection: { route: { start: false }, workflowId: "ocr" } },
  }, [data, epoch, request, scope, executor, refresh]);
  if (error) return <Banner tone="danger" title="Review unavailable">The fixture data could not be read.</Banner>;
  if (data === undefined || binding === undefined) return <p role="status">Loading review…</p>;
  const row = data.day.queueSurfaces.find(row => row.workflowId === "ocr");
  if (row === undefined) return <Banner tone="danger" title="Review unavailable">The fixture has no OCR run.</Banner>;
  return <DashboardClientProvider client={client}><DashboardCommandBindingProvider binding={binding}>
    <LogsSurface title={row.title} status={<StatusBadge status={dsStatusOf(row.status)} presentation="queue" />} steps={[]}
      content={<RunReview selection={{ row, workflowLabel: "OCR" }} />} />
  </DashboardCommandBindingProvider></DashboardClientProvider>;
}
