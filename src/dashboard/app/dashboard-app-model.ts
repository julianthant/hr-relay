/**
 * Stable doors a route-backed takeover can return keyboard focus to after
 * closing.
 *
 * One member since D295: `UI_CATALOG_DOOR_ID` retired with the toolbar button
 * it named. The catalog is a Settings section now, and Settings restores focus
 * through `settingsCloseFocusTargetId` (the gear, or the main region) rather
 * than through this pair — it is a persistent door that never unmounts, so it
 * needs no id held across an unmount/remount boundary. The union stays a union
 * because the mechanism below is the general one and intake still uses it.
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
export const RUN_START_DOOR_ID = "dashboard-run-start-door";

export type DashboardTakeoverCloseFocusTargetId = typeof RUN_START_DOOR_ID;

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
