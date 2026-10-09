// Restore focus after route commit; an open discard dialog still traps focus away from the toolbar door.
import { SETTINGS_GEAR_ID } from "../surfaces/settings/settings-model.js";

export const RUN_START_DOOR_ID = "dashboard-run-start-door";

export type DashboardTakeoverCloseFocusTargetId = typeof RUN_START_DOOR_ID | typeof SETTINGS_GEAR_ID;

// A missing toolbar door may use the persistent main region; missing both is a composition failure.
export function restoreDashboardTakeoverFocus(
  documentRoot: Pick<Document, "activeElement" | "getElementById">,
  preferredTargetId: DashboardTakeoverCloseFocusTargetId,
  mainRegionId: string,
): void {
  const target = documentRoot.getElementById(preferredTargetId)
    ?? documentRoot.getElementById(mainRegionId);
  if (target === null) {
    throw new Error(
      `cannot restore takeover focus: neither ${preferredTargetId} nor ${mainRegionId} is mounted`,
    );
  }
  target.focus();
  if (documentRoot.activeElement !== target) {
    throw new Error(`cannot restore takeover focus: ${target.id} did not accept focus`);
  }
}
