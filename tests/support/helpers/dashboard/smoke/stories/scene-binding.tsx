import { useMemo, type ReactNode } from "react";
import type { DashboardAuthority } from "../../../../../../src/dashboard/app/dashboard-app-model.js";
import { LOADING } from "../../../../../../src/dashboard/state/async-resource.js";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../../../../../../src/dashboard/state/client-context.js";
import { serverLocalDay } from "../../../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import type { FrontendBootstrapWire } from "../../../../../../src/models/dashboard/bootstrap.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { RUN_DIALOG_ACTOR, RUN_DIALOG_BOOTSTRAP } from "../../../../fixtures/dashboard/run-dialog-story-fixtures.js";

const noop = () => undefined;

/** The command binding the app composes, over the saved bootstrap; the dialog reads only the clock, the day and the actor from it. */
export function SceneBinding({ children }: { children: ReactNode }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const binding = useMemo(() => {
    const bootstrap = RUN_DIALOG_BOOTSTRAP as unknown as FrontendBootstrapWire;
    const epoch = Object.freeze({ client, bootstrap });
    const day = serverLocalDay(bootstrap.serverClock);
    const request = Object.freeze({ client, day, epoch, revision: 0 });
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], now: () => bootstrap.serverClock.now, today: day, day,
      dayState: { subscribePublications: () => { throw new Error("the story serves no publications"); }, request, day: LOADING, connection: { state: "connecting" as const },
        refresh: () => { throw new Error("the story serves no day refresh"); } },
      selection: { route: { start: false }, workflowId: "" } });
    return Object.freeze({ authority, executor, scope: Object.freeze({ actorId: ActorIdSchema.parse(RUN_DIALOG_ACTOR), client, authority: epoch, dayRequest: request }), feedback: noop });
  }, [client, executor]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}

