import { useCallback,useEffect,useRef } from "react";
import {
DASHBOARD_MAIN_REGION_ID
} from "../surfaces/settings-model.js";
import {
restoreDashboardTakeoverFocus,
type DashboardTakeoverCloseFocusTargetId
} from "./dashboard-app-model.js";
import {
activeTakeover,
type AppRouteState
} from "./url-state.js";
export function useTakeoverCloseFocus(takeover: ReturnType<typeof activeTakeover>, setRoute: (next: AppRouteState) => void) {
  const pendingTakeoverCloseFocusId = useRef<DashboardTakeoverCloseFocusTargetId | undefined>(undefined);

  /* Intake replaces the toolbar that opened it, so its door
     exists only AFTER the close route commits. Keep its stable id across that
     unmount/remount boundary, then restore focus (or the main-region fallback)
     once React has mounted the queue again. */
  useEffect(() => {
    const targetId = pendingTakeoverCloseFocusId.current;
    if (targetId === undefined) return;
    restoreDashboardTakeoverFocus(document, targetId, DASHBOARD_MAIN_REGION_ID);
    pendingTakeoverCloseFocusId.current = undefined;
  }, [takeover]);

  const closeTakeoverTo = useCallback((
    targetId: DashboardTakeoverCloseFocusTargetId,
    next: AppRouteState,
  ): void => {
    pendingTakeoverCloseFocusId.current = targetId;
    setRoute(next);
  }, [setRoute]);

return closeTakeoverTo;
}
