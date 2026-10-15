import type { WorkflowSource, WorkflowSourcePolicy } from "./workflow-sources.js";
import type { WorkflowCatalogEntry } from "../surfaces/workflows/workflow-catalog-model.js";
import type { ComponentProps,ReactNode } from "react";
import {
type FrontendBootstrapWire
} from "../../models/dashboard/bootstrap.js";
import { ActivityReport } from "../surfaces/activity/activity.js";
import { WorkflowExplorer } from "../surfaces/explorer/explorer.js";
import { IntakeWorkspace } from "../surfaces/intake/intake.js";
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
export function DashboardTakeovers({client,activitySource,today,workflowSources,takeover,route,setRoute,boot,settingsSections,workflowLabels,workflowCatalog,activeWorkflowId,
 workflowLabelOf,supportsDryRun,closeTakeoverTo,onSettingsExitGuardChange,onSettingsSaved,onSettingsSaveProblem,theme,onToggleTheme,children}: {
 activitySource?: WorkflowSource; today: string; workflowSources: WorkflowSourcePolicy;
 client: ComponentProps<typeof WorkflowExplorer>["client"];
 takeover: ReturnType<typeof activeTakeover>; route: AppRouteState; setRoute: RouteSetter;
 boot: FrontendBootstrapWire; settingsSections: ComponentProps<typeof SettingsPage>["sections"];
 workflowCatalog: readonly WorkflowCatalogEntry[]; workflowLabels: ReadonlyMap<string,string>; activeWorkflowId: string; workflowLabelOf: (id: string) => string;
 supportsDryRun: boolean;
 closeTakeoverTo: (target: DashboardTakeoverCloseFocusTargetId,next: AppRouteState) => void;
 onSettingsSaved?: ComponentProps<typeof SettingsPage>["onSaved"];
 onSettingsSaveProblem?: ComponentProps<typeof SettingsPage>["onSaveProblem"];
 onSettingsExitGuardChange: (guard: SettingsExitGuard | undefined) => void; theme: DemoTheme; onToggleTheme: () => void; children: ReactNode;
}) {
 const dataSection = takeover === "settings" ? route.settings
   : takeover === "explore" ? "explorer" : takeover === "archive" || takeover === "activity" ? takeover : undefined;
 const dataContent = dataSection === "activity" ? <ActivityReport client={client} today={today} source={activitySource ?? "served"} workflowSources={workflowSources} range={route.activity ?? ""} onRange={next => setRoute(current => ({ ...current, settings: "activity", activity: next }))} />
 : dataSection === "explorer" ? <WorkflowExplorer catalog={workflowCatalog} client={client} /> : undefined;
 return (takeover === "settings" || takeover === "archive" || dataContent !== undefined ? (
            <SettingsPage
              storage={boot.storage} appearance={<AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} />}
              sections={settingsSections}
              workflowLabels={workflowLabels}
              section={route.settings ?? dataSection ?? ""}
              searchTarget={route.settingsTarget}
              dataContent={dataContent}
              actorId={boot.actor.id}
              descriptorFingerprint={boot.descriptorHash}
              preflight={boot.preflight ?? []}
              onSection={(next, settingsTarget) => setRoute({ ...routeWithoutTakeovers(route), settings: next, settingsTarget,
                ...(next === "activity" ? { activity: "" } : next === "explorer" ? { explore: activeWorkflowId } : {}) })}
              onClose={() => closeTakeoverTo(SETTINGS_GEAR_ID, routeWithoutTakeovers(route))}
              onExitGuardChange={onSettingsExitGuardChange}
              onSaved={onSettingsSaved}
              onSaveProblem={onSettingsSaveProblem}
            />
          ) : takeover === "intake" && route.intake !== undefined ? (
             /** The surface owns the same full-bleed `TakeoverFrame` as every other
 * window-replacing view; no shell gutter may sit between frame and column. */
            <IntakeWorkspace
              workflowLabel={workflowLabelOf(activeWorkflowId)}
              actorId={boot.actor.id}
              supportsDryRun={
                supportsDryRun
              }
              /** Always a real id, NARROWED rather than defaulted.
 * `activeTakeover` selects this arm off `route.intake` itself */
              sessionId={route.intake}
              onClose={() => closeTakeoverTo(
                RUN_START_DOOR_ID,
                routeWithoutTakeovers(route),
              )}
              onEnqueued={() => setRoute(routeWithoutTakeovers(route))}
            />
          ) : children);}
