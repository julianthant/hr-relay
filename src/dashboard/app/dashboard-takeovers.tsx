import type { WorkflowSourcePolicy } from "./workflow-sources.js";
import "../surfaces/shared/codex-text.css";
import type { WorkflowCatalogEntry } from "../surfaces/workflows/workflow-catalog-model.js";
import type { ComponentProps,ReactNode } from "react";
import type { AccountPage } from "../surfaces/settings/account/account-settings.js";
import {
type FrontendBootstrapWire
} from "../../models/dashboard/bootstrap.js";
import { ActivityReport, type ActivityReportHook } from "../surfaces/activity/activity.js";
import { WorkflowExplorer } from "../surfaces/explorer/explorer.js";
import { IntakeWorkspace } from "../surfaces/intake/intake.js";
import { AppearanceSettings } from "../surfaces/settings/general/appearance-settings.js";
import type { DemoTheme } from "../ds/ui.js";
import { PanelBoundary } from "../surfaces/shared/panel-boundary.js";
import { SettingsPage } from "../surfaces/settings/settings.js";
import { SheetsV2 } from "../surfaces/spreadsheets/design/sheets-v2.js";
import { DataPage } from "./data-page.js";
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
settingsRoute,
type AppRouteState
} from "./navigation/url-state.js";
export function DashboardTakeovers({client,useActivityReport,today,workflowSources,takeover,route,setRoute,boot,workflowCatalog,activeWorkflowId,
 workflowLabelOf,supportsDryRun,closeTakeoverTo,onSettingsExitGuardChange,onSettingsSaved,onSettingsSaveProblem,theme,onToggleTheme,onOpenRun,deleteAccount,accountPage,children}: {
 useActivityReport?: ActivityReportHook; today: string; workflowSources: WorkflowSourcePolicy;
 client: ComponentProps<typeof WorkflowExplorer>["client"];
 takeover: ReturnType<typeof activeTakeover>; route: AppRouteState; setRoute: RouteSetter;
 boot: FrontendBootstrapWire;
 workflowCatalog: readonly WorkflowCatalogEntry[]; activeWorkflowId: string; workflowLabelOf: (id: string) => string;
 deleteAccount?: ReactNode;
 accountPage?: AccountPage;
 onOpenRun: (runId: string, partitionDay: string) => void;
 supportsDryRun: boolean;
 closeTakeoverTo: (target: DashboardTakeoverCloseFocusTargetId,next: AppRouteState) => void;
 onSettingsSaved?: ComponentProps<typeof SettingsPage>["onSaved"];
 onSettingsSaveProblem?: ComponentProps<typeof SettingsPage>["onSaveProblem"];
 onSettingsExitGuardChange: (guard: SettingsExitGuard | undefined) => void; theme: DemoTheme; onToggleTheme: () => void; children: ReactNode;
}) {
 if (takeover === "activity" || takeover === "explore" || takeover === "spreadsheets") return (
   <DataPage page={takeover}>
     {takeover === "activity" ? <ActivityReport client={client} today={today} useReport={useActivityReport} workflowSources={workflowSources} range={route.activity ?? ""} onRange={next => setRoute(current => ({ ...current, activity: next }))} />
     : takeover === "explore" ? <div className="codex-text"><WorkflowExplorer catalog={workflowCatalog} client={client} /></div>
     : <SheetsV2 onOpenRun={onOpenRun} />}
   </DataPage>
 );
 return (takeover === "settings" || takeover === "archive" ? (
            <PanelBoundary resetKey={route.settings ?? takeover} sentence="Couldn't open Settings." className="m-4">
            <SettingsPage
              appearance={<AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} />}
              deleteAccount={deleteAccount}
              accountPage={accountPage}
              section={route.settings ?? (takeover === "archive" ? "archive" : "")}
              searchTarget={route.settingsTarget}
              actorId={boot.actor.id}
              profileName={boot.actor.label}
              descriptorFingerprint={boot.descriptorHash}
              onSection={(next, settingsTarget) => setRoute({ ...settingsRoute(route, next, settingsTarget), ...(route.settingsFrom === undefined ? {} : { settingsFrom: route.settingsFrom }) })}
              onClose={() => route.settingsFrom === "run" ? setRoute(routeWithoutTakeovers(route)) : closeTakeoverTo(SETTINGS_GEAR_ID, routeWithoutTakeovers(route))}
              backToRun={route.settingsFrom === "run"}
              onExitGuardChange={onSettingsExitGuardChange}
              onSaved={onSettingsSaved}
              onSaveProblem={onSettingsSaveProblem}
            />
            </PanelBoundary>
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
