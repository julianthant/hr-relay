/**
 * Stable doors a route-backed takeover can return keyboard focus to after
 * closing.
 *
 * The catalog is a Settings section (D295), so its close returns through the
 * Settings gear. Settings also defers focus until the route commits: while its
 * discard dialog is mounted, the dialog's focus scope rejects the gear even
 * though that door remains mounted. Intake waits for its toolbar to remount.
 *
 * **The intake door MOVED with D296 and this constant moved with it.** It used
 * to name a `Import spreadsheet` button in the queue toolbar; that button is
 * gone, and the only door into the intake workspace is now the Run Modal's
 * spreadsheet method. `Start a run` is the toolbar control that opens that
 * modal, so it is where the operator was standing when the takeover took the
 * screen — which is the whole question this id answers. Returning focus to a
 * control that no longer exists is not a smaller bug than returning it to
 * `body`: `restoreDashboardTakeoverFocus` would silently fall through to the
 * main region and drop the operator out of the toolbar entirely.
 */
import { SETTINGS_GEAR_ID } from "../surfaces/settings/settings-model.js";

export const RUN_START_DOOR_ID = "dashboard-run-start-door";

export type DashboardTakeoverCloseFocusTargetId = typeof RUN_START_DOOR_ID | typeof SETTINGS_GEAR_ID;

/**
 * Restores focus only after the queue route has remounted its toolbar door.
 *
 * Deep links and future shell variants may have no matching door, so the
 * persistent main region is the one valid fallback. Missing both is a broken
 * shell composition, not a successful close that may silently leave focus on
 * `body`.
 */
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
