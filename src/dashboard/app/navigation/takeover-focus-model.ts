import { useCallback,useEffect,useRef } from "react";
import {
DASHBOARD_MAIN_REGION_ID
} from "../../surfaces/settings/settings-model.js";
import {
restoreDashboardTakeoverFocus,
type DashboardTakeoverCloseFocusTargetId
} from "../dashboard-app-model.js";
import {
activeTakeover,
type AppRouteState
} from "./url-state.js";
/** A data page hands focus back to the rail row that opened it. */
const DATA_ROW_OF_TAKEOVER: Partial<Record<ReturnType<typeof activeTakeover>, string>> = {
  spreadsheets: "rail-data-spreadsheets", explore: "rail-data-explorer", activity: "rail-data-activity",
};
export function useTakeoverCloseFocus(takeover: ReturnType<typeof activeTakeover>, setRoute: (next: AppRouteState) => void) {
  const previousTakeover = useRef(takeover);
  const pendingTakeoverCloseFocusId = useRef<DashboardTakeoverCloseFocusTargetId | undefined>(undefined);

  /** Intake replaces the toolbar that opened it, so its
 * door exists only AFTER the close route commits. */
  useEffect(() => {
    const targetId = pendingTakeoverCloseFocusId.current;
    const returnedToQueue = previousTakeover.current !== "none" && takeover === "none";
    const launcherId = DATA_ROW_OF_TAKEOVER[previousTakeover.current];
    previousTakeover.current = takeover;
    if (targetId === undefined) {
      if (returnedToQueue && document.activeElement === document.body) {
        const launcher = launcherId === undefined ? null : document.getElementById(launcherId);
        if (launcher !== null) { launcher.focus(); return; }
        const main = document.getElementById(DASHBOARD_MAIN_REGION_ID);
        if (main === null) throw new Error("dashboard main region is missing on takeover return");
        main.focus();
      }
      return;
    }
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
