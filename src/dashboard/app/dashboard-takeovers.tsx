import type { WorkflowCatalogEntry } from "../surfaces/workflows/workflow-catalog-model.js";
import type { ComponentProps,ReactNode } from "react";
import {
type FrontendBootstrapWire
} from "../../domain/dashboard/bootstrap.js";
import { ActivityReport } from "../surfaces/activity/activity.js";
import { ARCHIVE_INDEX } from "../surfaces/archive/archive-model.js";
import { MockArchiveWorkspace as ArchiveWorkspace } from "../surfaces/archive/archive-mock.js";
import type { MockArchiveRun } from "../surfaces/archive/archive-mock-model.js";
import { WorkflowExplorer } from "../surfaces/explorer/explorer.js";
import { IntakeWorkspace } from "../surfaces/intake/intake.js";
import { DEFAULT_CATALOG_VIEW } from "../surfaces/settings/catalog/row-catalog-model.js";
import { AppearanceSettings } from "../surfaces/settings/general/appearance-settings.js";
import type { DemoTheme } from "../ds/ui.js";
import { SettingsPage } from "../surfaces/settings/settings.js";
import {
RUN_START_DOOR_ID,
type DashboardTakeoverCloseFocusTargetId
} from "./dashboard-app-model.js";
import { SETTINGS_GEAR_ID } from "../surfaces/settings/settings-model.js";
import type { SettingsExitGuard } from "./navigation/navigation-model.js";
import type { RouteSetter } from "./navigation/view-route-model.js";
import {
activeTakeover,
routeWithoutTakeovers,
type AppRouteState
} from "./navigation/url-state.js";
export function DashboardTakeovers({takeover,route,setRoute,boot,settingsSections,workflowLabels,workflowCatalog,activeWorkflowId,
 workflowLabelOf,supportsDryRun,closeTakeoverTo,onSettingsExitGuardChange,theme,onToggleTheme,archiveReports,children}: {
 takeover: ReturnType<typeof activeTakeover>; route: AppRouteState; setRoute: RouteSetter;
 boot: FrontendBootstrapWire; settingsSections: ComponentProps<typeof SettingsPage>["sections"];
 workflowCatalog: readonly WorkflowCatalogEntry[]; workflowLabels: ReadonlyMap<string,string>; activeWorkflowId: string; workflowLabelOf: (id: string) => string;
 supportsDryRun: boolean;
 archiveReports?: readonly MockArchiveRun[];
 closeTakeoverTo: (target: DashboardTakeoverCloseFocusTargetId,next: AppRouteState) => void;
 onSettingsExitGuardChange: (guard: SettingsExitGuard | undefined) => void; theme: DemoTheme; onToggleTheme: () => void; children: ReactNode;
}) {
 const dataSection = takeover === "settings" ? route.settings
   : takeover === "explore" ? "explorer" : takeover === "archive" || takeover === "activity" ? takeover : undefined;
 const dataContent = dataSection === "archive" ? <ArchiveWorkspace
   catalog={workflowCatalog}
   additionalReports={archiveReports}
   selection={route.archive ?? ARCHIVE_INDEX} view={route.archiveView ?? "runs"}
   folder={route.archiveDashboard === undefined || route.archiveWorkflow === undefined
     ? null : { dashboardKey: route.archiveDashboard, workflow: route.archiveWorkflow }}
   browse={route.archiveBrowse} browseInvalid={route.archiveBrowseInvalid}
   onBrowse={(browse, mode) => setRoute({ ...route, settings: "archive", archive: route.archive ?? ARCHIVE_INDEX, archiveBrowse: browse, archiveBrowseInvalid: undefined }, mode)}
   onOpenReport={id => setRoute({ ...route, settings: "archive", archive: id,
     archiveDashboard: undefined, archiveWorkflow: undefined,
     archiveBrowse: { filters: route.archiveBrowse?.filters ?? {} } })}
   onSelection={next => setRoute({ ...route, settings: "archive", archive: next, archiveBrowse: { ...route.archiveBrowse, filters: route.archiveBrowse?.filters ?? {}, section: undefined } })}
   onView={next => setRoute({ ...route, settings: "archive", archive: route.archive ?? ARCHIVE_INDEX, archiveView: next })}
   onFolder={folder => setRoute({ ...route, settings: "archive", archive: ARCHIVE_INDEX,
     archiveDashboard: folder?.dashboardKey, archiveWorkflow: folder?.workflow, archiveBrowse: { filters: {} } })}
 /> : dataSection === "activity" ? <ActivityReport range={route.activity ?? ""} onRange={next => setRoute(current => ({ ...current, settings: "activity", activity: next }))} />
 : dataSection === "explorer" ? <WorkflowExplorer catalog={workflowCatalog} /> : undefined;
 return (takeover === "settings" || dataContent !== undefined ? (
            <SettingsPage
              storage={boot.storage} appearance={<AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} />}
              sections={settingsSections}
              workflowLabels={workflowLabels}
              section={route.settings ?? dataSection ?? ""}
              searchTarget={route.settingsTarget}
              dataContent={dataContent}
              catalogQuery={route.catalog ?? ""}
              catalogView={route.catalogView ?? DEFAULT_CATALOG_VIEW}
              onCatalogQuery={(next) => setRoute({ ...route, catalog: next })}
              onCatalogView={(next) => setRoute({ ...route, catalogView: next })}
              actorId={boot.actor.id}
              descriptorFingerprint={boot.descriptorHash}
              preflight={boot.preflight ?? []}
              onSection={(next, settingsTarget) => setRoute({ ...routeWithoutTakeovers(route), settings: next, settingsTarget,
                ...(next === "archive" ? { archive: ARCHIVE_INDEX } : next === "activity" ? { activity: "" } : next === "explorer" ? { explore: activeWorkflowId } : {}) })}
              onClose={() => closeTakeoverTo(SETTINGS_GEAR_ID, routeWithoutTakeovers(route))}
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
