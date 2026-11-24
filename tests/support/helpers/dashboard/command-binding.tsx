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

/** `rows` stands for the day stream's row store; a test that drives saves delivers their settings rows there. */
export function FixtureCommandBinding({ children, actorId, requestKey = 0, nowIso = FIXTURE_BOOTSTRAP.serverClock.now, feedback, rows }: { children: ReactNode; actorId: string; requestKey?: number; nowIso?: string; feedback?: (outcome: CommandOutcome) => void; rows?: RowStoreWriter }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const scopeActorId = ActorIdSchema.parse(actorId);
  const epoch = useMemo(() => {
    const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, serverClock: { ...FIXTURE_BOOTSTRAP.serverClock, now: nowIso } });
    return Object.freeze({ client, bootstrap });
  }, [client, nowIso]);
  const binding = useMemo(() => {
    const bootstrap = epoch.bootstrap;
    const day = serverLocalDay(bootstrap.serverClock);
    const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, day });
    const request = Object.freeze({ client, day, epoch, revision: requestKey });
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], now: () => bootstrap.serverClock.now,
      today: day, day,
      dayState: { rows: rows ?? createRowStore(), subscribePublications: () => { throw new Error("fixture publications are not served"); }, request, day: { state: "loaded" as const, value: dayWire }, connection: { state: "connecting" as const }, refresh: () => { throw new Error("fixture day refresh is not served"); } },
      selection: { route: { start: false }, workflowId: "" },
    });
    return Object.freeze({ authority, executor, scope: Object.freeze({ actorId: scopeActorId, client, authority: epoch, dayRequest: request }), feedback: feedback ?? (() => undefined) });
  }, [client, executor, epoch, requestKey, scopeActorId, feedback, rows]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}
