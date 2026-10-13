import { serverLocalDay } from "../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { useMemo, type ReactNode } from "react";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../../../../src/dashboard/state/client-context.js";
import type { DashboardAuthority } from "../../../../src/dashboard/app/dashboard-app-model.js";
import { FIXTURE_BOOTSTRAP } from "../../fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../fixtures/dashboard/fixture-queue.js";

export function FixtureCommandBinding({ children, actorId, requestKey = 0, nowIso = FIXTURE_BOOTSTRAP.serverClock.now }: { children: ReactNode; actorId: string; requestKey?: number; nowIso?: string }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const epoch = useMemo(() => {
    const bootstrap = { ...FIXTURE_BOOTSTRAP, serverClock: { ...FIXTURE_BOOTSTRAP.serverClock, now: nowIso }, actor: { ...FIXTURE_BOOTSTRAP.actor, id: actorId } };
    return Object.freeze({ client, bootstrap });
  }, [client, actorId, nowIso]);
  const binding = useMemo(() => {
    const bootstrap = epoch.bootstrap;
    const day = serverLocalDay(bootstrap.serverClock);
    const dayWire = { ...FIXTURE_DAY_WIRE, day };
    const request = Object.freeze({ client, day, epoch, revision: requestKey });
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], nowIso: bootstrap.serverClock.now,
      today: day, day,
      dayState: { request, day: { state: "loaded" as const, value: dayWire }, connection: { state: "connecting" as const }, refresh: () => { throw new Error("fixture day refresh is not served"); } },
      selection: { route: { start: false }, workflowId: "" },
    });
    return Object.freeze({ authority, executor, scope: Object.freeze({ actorId, client, authority: epoch, dayRequest: request }), feedback: () => undefined });
  }, [actorId, client, executor, epoch, requestKey]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}
