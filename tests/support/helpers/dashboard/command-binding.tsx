import { useMemo, type ReactNode } from "react";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../../../../src/dashboard/state/client-context.js";
import type { DashboardAuthority } from "../../../../src/dashboard/app/dashboard-app-model.js";
import { FIXTURE_BOOTSTRAP } from "../../fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../fixtures/dashboard/fixture-queue.js";

export function FixtureCommandBinding({ children, actorId, requestKey = 0 }: { children: ReactNode; actorId: string; requestKey?: number }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const epoch = useMemo(() => {
    const bootstrap = { ...FIXTURE_BOOTSTRAP, actor: { ...FIXTURE_BOOTSTRAP.actor, id: actorId } };
    return Object.freeze({ client, bootstrap });
  }, [client, actorId]);
  const binding = useMemo(() => {
    const bootstrap = epoch.bootstrap;
    const request = Object.freeze({ client, day: FIXTURE_DAY_WIRE.day, epoch, revision: requestKey });
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], nowIso: bootstrap.serverClock.now,
      today: FIXTURE_DAY_WIRE.day, day: FIXTURE_DAY_WIRE.day,
      dayState: { request, day: { state: "loaded" as const, value: FIXTURE_DAY_WIRE }, connection: { state: "connecting" as const }, refresh: () => { throw new Error("fixture day refresh is not served"); } },
      selection: { route: { start: false }, workflowId: "" },
    });
    return Object.freeze({ authority, executor, scope: Object.freeze({ actorId, client, authority: epoch, dayRequest: request }), feedback: () => undefined });
  }, [actorId, client, executor, epoch, requestKey]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}
