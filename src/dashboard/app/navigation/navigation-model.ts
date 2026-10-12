import { useCallback, useRef } from "react";
import type { NativeRouteHistory, PopstateRouteHandler, RouteHistoryTarget } from "./route-history-model.js";
import type { AppRouteState } from "./url-state.js";

export type SettingsExitGuard = (proceed: () => void) => void;

export function useDashboardNavigation({ route, onPopstateRef, nativeHistory }: {
  route: AppRouteState;
  onPopstateRef: { current: PopstateRouteHandler | undefined };
  nativeHistory: NativeRouteHistory;
}) {
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

  // Popstate changes the address first; restore dirty Settings before its exit guard.
  onPopstateRef.current = (target: RouteHistoryTarget): void => {
    if (route.settings === undefined || target.route.settings !== undefined) {
      nativeHistory.accept(target);
      return;
    }
    nativeHistory.restore(target, () => leaveSettings(() => nativeHistory.replay(target)));
  };

  return { leaveSettings, onSettingsExitGuardChange };
}
