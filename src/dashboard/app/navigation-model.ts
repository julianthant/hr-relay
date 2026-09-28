import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import type { DashboardDayWire } from "../../domain/dashboard/projection.js";
import { type PanelTab } from "../surfaces/log-panel-model.js";
import { type NavControls } from "../surfaces/navigation-controls.js";
import {
canGoBack,
canGoForward,
currentPlace,
goBack,
goForward,
initNavHistory,
navDestinationLabel,
pushPlace,
type NavHistory,
} from "./nav-history.js";
import type { NativeRouteHistory,PopstateRouteHandler,RouteHistoryTarget } from "./route-history-model.js";
import {
type AppRouteState
} from "./url-state.js";
export type SettingsExitGuard = (proceed: () => void) => void;

export function useDashboardNavigation({ route, setRoute, day, activeWorkflowId, setActiveWorkflowId,
 tab, dayWire, workflowLabelOf, onPopstateRef, nativeHistory }: {
 route: AppRouteState; setRoute: (next: AppRouteState) => void; day: string;
 activeWorkflowId: string; setActiveWorkflowId: (id: string) => void;
 tab: PanelTab | undefined; onTab: (tab: PanelTab | undefined) => void;
 dayWire: DashboardDayWire | undefined; workflowLabelOf: (id: string) => string;
 onPopstateRef: {current: PopstateRouteHandler | undefined}; nativeHistory: NativeRouteHistory;
}) {
  const [navHistory, setNavHistory] = useState<NavHistory>(() =>
    initNavHistory({ day, followToday: route.day === undefined, workflow: activeWorkflowId, runId: route.run ?? null, tab: tab ?? null }),
  );
  const applyingNav = useRef(false);
  const observedInitialPlace = useRef(false);
  const settingsExitGuard = useRef<SettingsExitGuard | undefined>(undefined);
  const onSettingsExitGuardChange = useCallback((guard: SettingsExitGuard | undefined): void => {
    settingsExitGuard.current = guard;
  }, []);
  const leaveSettings = useCallback((proceed: () => void): void => {
    if (route.settings === undefined) {
      proceed();
      return;
    }
    const guard = settingsExitGuard.current;
    if (guard === undefined) throw new Error("Settings exit was requested before its draft guard mounted");
    guard(proceed);
  }, [route.settings]);

  // Browser Back/Forward changes the address before it emits `popstate`. A
  // dirty Settings page first returns to its stable cursor, without replacing
  // the browser's target entry, then lets the same page-owned guard either
  // keep it or atomically replay that target.
  onPopstateRef.current = (target: RouteHistoryTarget): void => {
    if (route.settings === undefined || target.route.settings !== undefined) {
      nativeHistory.accept(target);
      return;
    }
    nativeHistory.restore(target, () => leaveSettings(() => nativeHistory.replay(target)));
  };

  useEffect(() => {
    if (!observedInitialPlace.current) {
      if (dayWire === undefined) return;
      observedInitialPlace.current = true;
      setNavHistory(initNavHistory({ day, followToday: route.day === undefined, workflow: activeWorkflowId, runId: route.run ?? null, tab: tab ?? null }));
      return;
    }
    if (applyingNav.current) {
      applyingNav.current = false;
      return;
    }
    setNavHistory((prev) =>
      pushPlace(prev, { day, followToday: route.day === undefined, workflow: activeWorkflowId, runId: route.run ?? null, tab: tab ?? null }));
  }, [day, activeWorkflowId, route.day, route.run, tab, dayWire]);

  const travel = useCallback(
    (direction: "back" | "forward"): void => {
      const next = direction === "back" ? goBack(navHistory) : goForward(navHistory);
      const place = currentPlace(next);
      if (next === navHistory || place === undefined) return;
      leaveSettings(() => {
        applyingNav.current = true;
        setNavHistory(next);
        setActiveWorkflowId(place.workflow);
        // Preserve the requested section; the selection boundary names a section
        // the restored run cannot offer instead of silently opening another tab.
        // Every takeover clears, exactly as the switcher does: a place is a spot
        // in the QUEUE, and restoring one under an Archive overlay would move the
        // panel behind a screen the operator cannot see it through. The day moves
        // with the run for the same reason the demo's does — a place restored
        // into the wrong partition lands on an empty queue and reads as a broken
        // button.
        setRoute({
          ...route,
          intake: undefined,
          archive: undefined,
          archiveView: undefined,
          archiveDashboard: undefined,
          archiveWorkflow: undefined,
          activity: undefined,
          explore: undefined,
          catalog: undefined,
          catalogView: undefined,
          settings: undefined,
          day: place.followToday === true ? undefined : place.day,
          run: place.runId ?? undefined,
          section: place.tab ?? undefined,
        });
      });
    },
    [navHistory, route, setRoute, leaveSettings, setActiveWorkflowId],
  );

  /** what each control will actually do, named on its face rather than guessed at */
  const nameRun = useCallback(
    (runId: string): string | undefined =>
      dayWire?.queueSurfaces.find((surface) => String(surface.runId) === runId)?.title,
    [dayWire],
  );

  const navBackTo = navDestinationLabel(navHistory, "back", nameRun, workflowLabelOf);
  const navForwardTo = navDestinationLabel(navHistory, "forward", nameRun, workflowLabelOf);
  /** The bar's history controls, as ONE object per change rather than per render (D4). */
  const nav = useMemo(
    (): NavControls => ({
      canBack: canGoBack(navHistory),
      canForward: canGoForward(navHistory),
      ...(navBackTo === undefined ? {} : { backTo: navBackTo }),
      ...(navForwardTo === undefined ? {} : { forwardTo: navForwardTo }),
      onBack: () => travel("back"),
      onForward: () => travel("forward"),
    }),
    [navHistory, navBackTo, navForwardTo, travel],
  );

return { nav, leaveSettings, onSettingsExitGuardChange };
}
