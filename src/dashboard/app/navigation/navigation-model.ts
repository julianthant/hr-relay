import { useCallback, useLayoutEffect, useRef } from "react";
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

  useLayoutEffect(() => {
    const handlePopstate = (target: RouteHistoryTarget): void => {
      if (route.settings === undefined || target.route.settings !== undefined) {
        nativeHistory.accept(target);
        return;
      }
      // Popstate changes the address first; restore Settings before its exit guard.
      nativeHistory.restore(target, () => leaveSettings(() => nativeHistory.replay(target)));
    };
    onPopstateRef.current = handlePopstate;
    return () => {
      if (onPopstateRef.current === handlePopstate) onPopstateRef.current = undefined;
    };
  }, [leaveSettings, nativeHistory, onPopstateRef, route.settings]);

  return { leaveSettings, onSettingsExitGuardChange };
}
