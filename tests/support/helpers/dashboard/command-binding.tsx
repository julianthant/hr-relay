import type { CommandOutcome } from "../../../../src/dashboard/app/commands/command-executor.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { FrontendBootstrapWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { serverLocalDay } from "../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { useMemo, type ReactNode } from "react";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../../../../src/dashboard/state/client-context.js";
import type { DashboardAuthority } from "../../../../src/dashboard/app/dashboard-app-model.js";
import { FIXTURE_BOOTSTRAP } from "../../fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../fixtures/dashboard/fixture-queue.js";
import { createRowStore, type RowStoreWriter } from "../../../../src/dashboard/client/index.js";

/** `rows` stands for the day stream's row store; a test that drives saves delivers their settings rows there. `stopped` ends that stream. */
export function FixtureCommandBinding({ children, actorId, requestKey = 0, nowIso = FIXTURE_BOOTSTRAP.serverClock.now, feedback, rows, stopped = false }: { children: ReactNode; actorId: string; requestKey?: number; nowIso?: string; feedback?: (outcome: CommandOutcome) => void; rows?: RowStoreWriter; stopped?: boolean }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const scopeActorId = ActorIdSchema.parse(actorId);
  const epoch = useMemo(() => {
    const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, serverClock: { ...FIXTURE_BOOTSTRAP.serverClock, now: nowIso } });
    return Object.freeze({ client, bootstrap });
  }, [client, nowIso]);
  // The day request and command scope outlive the stream's state, as in the app.
  const day = useMemo(() => {
    const today = serverLocalDay(epoch.bootstrap.serverClock);
    const request = Object.freeze({ client, day: today, epoch, revision: requestKey });
    return { today, wire: DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day: today }), request,
      scope: Object.freeze({ actorId: scopeActorId, client, authority: epoch, dayRequest: request }) };
  }, [client, epoch, requestKey, scopeActorId]);
  const binding = useMemo(() => {
    const bootstrap = epoch.bootstrap;
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], now: () => bootstrap.serverClock.now,
      today: day.today, day: day.today,
      dayState: { rows: rows ?? createRowStore(), subscribePublications: () => { throw new Error("fixture publications are not served"); }, request: day.request, day: { state: "loaded" as const, value: day.wire }, connection: stopped ? { state: "stopped" as const } : { state: "connecting" as const }, refresh: () => { throw new Error("fixture day refresh is not served"); } },
      selection: { route: { start: false }, workflowId: "" },
    });
    return Object.freeze({ authority, executor, scope: day.scope, feedback: feedback ?? (() => undefined) });
  }, [executor, epoch, day, feedback, rows, stopped]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}
