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
 */
export const IMPORT_SPREADSHEET_DOOR_ID = "dashboard-import-spreadsheet-door";

export type DashboardTakeoverCloseFocusTargetId = typeof IMPORT_SPREADSHEET_DOOR_ID;

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
