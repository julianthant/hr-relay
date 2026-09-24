import type { ComponentProps,ReactNode } from "react";
import {
type FrontendBootstrapWire
} from "../../domain/dashboard/bootstrap.js";
import { ActivityReport } from "../surfaces/activity.js";
import { ARCHIVE_INDEX } from "../surfaces/archive-model.js";
import { SavedArchiveWorkspace as ArchiveWorkspace } from "../surfaces/archive-report.js";
import { WorkflowExplorer } from "../surfaces/explorer.js";
import { IntakeWorkspace } from "../surfaces/intake.js";
import { DEFAULT_CATALOG_VIEW } from "../surfaces/row-catalog-model.js";
import {
SETTINGS_GEAR_ID,
} from "../surfaces/settings-model.js";
import { SettingsPage } from "../surfaces/settings.js";
import {
RUN_START_DOOR_ID,
type DashboardTakeoverCloseFocusTargetId
} from "./dashboard-app-model.js";
import type { SettingsExitGuard } from "./navigation-model.js";
import {
activeTakeover,
routeWithoutTakeovers,
type AppRouteState
} from "./url-state.js";
export function DashboardTakeovers({takeover,route,setRoute,boot,settingsSections,workflowLabels,activeWorkflowId,
 workflowLabelOf,supportsDryRun,today,queueRows,closeTakeoverTo,onSettingsExitGuardChange,children}: {
 takeover: ReturnType<typeof activeTakeover>; route: AppRouteState; setRoute: (next: AppRouteState) => void;
 boot: FrontendBootstrapWire; settingsSections: ComponentProps<typeof SettingsPage>["sections"];
 workflowLabels: ReadonlyMap<string,string>; activeWorkflowId: string; workflowLabelOf: (id: string) => string;
 supportsDryRun: boolean; today: string; queueRows: ComponentProps<typeof ActivityReport>["queueRows"];
 closeTakeoverTo: (target: DashboardTakeoverCloseFocusTargetId,next: AppRouteState) => void;
 onSettingsExitGuardChange: (guard: SettingsExitGuard | undefined) => void; children: ReactNode;
}) {return (takeover === "settings" ? (
            /*
              Settings REPLACES the queue (D272 item 1 / D274 item 5). It was a
              dialog, which gave the one page an operator opens most often no
              place in history and no back path — and the demo's own container
              is a page for exactly that reason.

              NO WRAPPER (UF-SET-1/4/5). All four demo-covered takeovers mount
              their own `TakeoverFrame`, whose JSDoc owns the why — geometry,
              arrival and focus, decided once. The demo's switch
              (`1ec1d870 RebuildDemo.tsx:656-678`) hands its pages straight to
              the shell column with nothing between them and it.
            */
            <SettingsPage
              storage={boot.storage}
              sections={settingsSections}
              workflowLabels={workflowLabels}
              section={route.settings ?? ""}
              catalogQuery={route.catalog ?? ""}
              catalogView={route.catalogView ?? DEFAULT_CATALOG_VIEW}
              onCatalogQuery={(next) => setRoute({ ...route, catalog: next })}
              onCatalogView={(next) => setRoute({ ...route, catalogView: next })}
              actorId={boot.actor.id}
              descriptorFingerprint={boot.descriptorHash}
              preflight={boot.preflight ?? []}
              onSection={(next) => setRoute({ ...route, settings: next })}
              onExitGuardChange={onSettingsExitGuardChange}
              onClose={() => {
                // The discard dialog must leave before focus can return to
                // the persistent gear; the coordinator restores it after commit.
                closeTakeoverTo(SETTINGS_GEAR_ID, routeWithoutTakeovers(route));
              }}
            />
          ) : takeover === "intake" && route.intake !== undefined ? (
            /* UF-FU-1: the surface owns the same full-bleed `TakeoverFrame`
               as every other window-replacing view. No shell gutter may sit
               between that frame and this column. */
            <IntakeWorkspace
              workflowLabel={workflowLabelOf(activeWorkflowId)}
              actorId={boot.actor.id}
              supportsDryRun={
                supportsDryRun
              }
              /* D298 — always a real id, NARROWED rather than defaulted.
                 `activeTakeover` selects this arm off `route.intake` itself,
                 so the redundant check above is the type's proof and not a
                 fallback: the sentinel that stood for "opened, no session
                 yet" retired with the upload page, because the Run Modal now
                 uploads BEFORE it routes here. */
              sessionId={route.intake}
              onClose={() => closeTakeoverTo(
                RUN_START_DOOR_ID,
                routeWithoutTakeovers(route),
              )}
              onEnqueued={() => setRoute(routeWithoutTakeovers(route))}
            />
          ) : takeover === "archive" ? (
            /*
              The Archive replaces the queue whole. It is the opposite view of
              the same world — what has LEFT the live surfaces — so showing it
              beside a live queue would invite exactly the comparison D80 says
              is not available: an archived run and a current one ran different
              code.

              NO WRAPPER — see the Settings arm above (UF-AR-3).
            */
            <ArchiveWorkspace
              selection={route.archive ?? ARCHIVE_INDEX}
              view={route.archiveView ?? "runs"}
              actorId={boot.actor.id}
              onSelection={(next) => setRoute({ ...route, archive: next })}
              onView={(next) => setRoute({ ...route, archiveView: next })}
            />
          ) : takeover === "activity" ? (
            /*
              No `onClose`: the report carries no back button (the demo's own
              rule — the product switcher above it holds the Activity entry
              that got you here, so a second door would be a duplicate). It
              does carry the actor and the app version, because a report
              leaves the operator's screen and its footer says who made it.

              NO WRAPPER — see the Settings arm above (UF-AC-2).
            */
            <ActivityReport
              range={route.activity ?? ""}
              today={today}
              actorId={boot.actor.id}
              appVersion={boot.appVersion}
              /*
                The report's Who column resolves a sampled run id against the
                rows the shell ALREADY holds — no second fetch, so the report
                and the queue cannot name the same run two ways. These are
                the day's rows and the report spans a range, so a sampled run
                from another day is simply not here and names itself by id.
              */
              queueRows={queueRows}
              onRange={(next) => setRoute({ ...route, activity: next })}
            />
          ) : takeover === "explore" ? (
            /*
              The explorer takes over for the same reason intake does: it is a
              different task, and a half-visible queue behind a reference view
              is the modal this deliberately is not. It carries no session, so
              closing it simply drops the key.

              NO WRAPPER — see the Settings arm above (UF-EX-2).
            */
            <WorkflowExplorer
              workflowId={route.explore ?? activeWorkflowId}
              onWorkflow={(next) => setRoute({ ...route, explore: next })}
              onVersionRegistry={() => setRoute({
                ...route,
                intake: undefined,
                archive: ARCHIVE_INDEX,
                archiveView: "versions",
                activity: undefined,
                explore: undefined,
                catalog: undefined,
                catalogView: undefined,
              })}
            />
          ) : children);}
