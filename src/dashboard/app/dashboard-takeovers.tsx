import type { ComponentProps,ReactNode } from "react";
import {
type FrontendBootstrapWire
} from "../../domain/dashboard/bootstrap.js";
import { ActivityReport } from "../surfaces/activity.js";
import { ARCHIVE_INDEX } from "../surfaces/archive-model.js";
import { MockArchiveWorkspace as ArchiveWorkspace } from "../surfaces/archive-mock.js";
import { WorkflowExplorer } from "../surfaces/explorer.js";
import { IntakeWorkspace } from "../surfaces/intake.js";
import { DEFAULT_CATALOG_VIEW } from "../surfaces/row-catalog-model.js";
import { AppearanceSettings } from "../surfaces/appearance-settings.js";
import type { DemoTheme } from "../ds/ui.js";
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
 workflowLabelOf,supportsDryRun,closeTakeoverTo,onSettingsExitGuardChange,theme,onToggleTheme,children}: {
 takeover: ReturnType<typeof activeTakeover>; route: AppRouteState; setRoute: (next: AppRouteState, mode?: "push" | "replace") => void;
 boot: FrontendBootstrapWire; settingsSections: ComponentProps<typeof SettingsPage>["sections"];
 workflowLabels: ReadonlyMap<string,string>; activeWorkflowId: string; workflowLabelOf: (id: string) => string;
 supportsDryRun: boolean;
 closeTakeoverTo: (target: DashboardTakeoverCloseFocusTargetId,next: AppRouteState) => void;
 onSettingsExitGuardChange: (guard: SettingsExitGuard | undefined) => void; theme: DemoTheme; onToggleTheme: () => void; children: ReactNode;
}) {
 const dataSection = takeover === "settings" ? route.settings
   : takeover === "explore" ? "explorer" : takeover === "archive" || takeover === "activity" ? takeover : undefined;
 const dataContent = dataSection === "archive" ? <ArchiveWorkspace
   selection={route.archive ?? ARCHIVE_INDEX} view={route.archiveView ?? "runs"}
   folder={route.archiveDashboard === undefined || route.archiveWorkflow === undefined
     ? null : { dashboardKey: route.archiveDashboard, workflow: route.archiveWorkflow }}
   browse={route.archiveBrowse} browseInvalid={route.archiveBrowseInvalid}
   onBrowse={(browse, mode) => setRoute({ ...route, settings: "archive", archive: route.archive ?? ARCHIVE_INDEX, archiveBrowse: browse, archiveBrowseInvalid: undefined }, mode)}
   onSelection={next => setRoute({ ...route, settings: "archive", archive: next, archiveBrowse: { ...route.archiveBrowse, filters: route.archiveBrowse?.filters ?? {}, section: undefined } })}
   onView={next => setRoute({ ...route, settings: "archive", archive: route.archive ?? ARCHIVE_INDEX, archiveView: next })}
   onFolder={folder => setRoute({ ...route, settings: "archive", archive: ARCHIVE_INDEX,
     archiveDashboard: folder?.dashboardKey, archiveWorkflow: folder?.workflow, archiveBrowse: { filters: {} } })}
 /> : dataSection === "activity" ? <ActivityReport range={route.activity ?? ""} onRange={next => setRoute({ ...route, settings: "activity", activity: next })} />
 : dataSection === "explorer" ? <WorkflowExplorer /> : undefined;
 return (takeover === "settings" || dataContent !== undefined ? (
            <SettingsPage
              storage={boot.storage} appearance={<AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} />}
              sections={settingsSections}
              workflowLabels={workflowLabels}
              section={route.settings ?? dataSection ?? ""}
              dataContent={dataContent}
              catalogQuery={route.catalog ?? ""}
              catalogView={route.catalogView ?? DEFAULT_CATALOG_VIEW}
              onCatalogQuery={(next) => setRoute({ ...route, catalog: next })}
              onCatalogView={(next) => setRoute({ ...route, catalogView: next })}
              actorId={boot.actor.id}
              descriptorFingerprint={boot.descriptorHash}
              preflight={boot.preflight ?? []}
              onSection={next => setRoute({ ...routeWithoutTakeovers(route), settings: next,
                ...(next === "archive" ? { archive: ARCHIVE_INDEX } : next === "activity" ? { activity: "" } : next === "explorer" ? { explore: activeWorkflowId } : {}) })}
              onExitGuardChange={onSettingsExitGuardChange}
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
          ) : children);}
