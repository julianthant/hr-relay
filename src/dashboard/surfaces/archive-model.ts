/**
 * The archive route's index sentinel: `?archive=` with no run id is the ledger
 * itself, and any other value is the archived run it names.
 *
 * It sits in a plain module rather than in `archive.tsx` because a module that
 * exports a component may export nothing else if React Fast Refresh is to
 * treat it as a refresh boundary — one non-component export makes every edit
 * to the archive surface invalidate upward into `dashboard-app.tsx` and remount
 * the app instead of hot-swapping the component.
 */
export const ARCHIVE_INDEX = "";

import type { ArchiveEntryWire } from "../../domain/dashboard/archive.js";

/**
 * Whether this archived run touched a TEST instance of any system. The fact is
 * the frozen row's own `resolvedInstances`, copied onto the index entry when
 * the archive projects — never inferred from a workflow id or a title.
 */
export function archivedRunTouchedTest(entry: ArchiveEntryWire): boolean {
  return entry.resolvedInstances.some((resolved) => resolved.instance === "test");
}
