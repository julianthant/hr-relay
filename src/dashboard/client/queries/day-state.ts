/** Client-side dashboard-day state: strictly APPLYING server payloads, never deriving.
 * A patch replaces or removes exactly one queue surface */
import { z } from "zod";
import type { DashboardDayWire } from "../../../models/dashboard/projection.js";
import { DashboardDayPatchSchema } from "../../../models/dashboard/subscription.js";
import { protocolError } from "../errors.js";

export type DashboardDayPatch = z.infer<typeof DashboardDayPatchSchema>;

export function applyDashboardDayPatch(day: DashboardDayWire, patch: DashboardDayPatch): DashboardDayWire {
  const parsed = DashboardDayPatchSchema.parse(patch);
  const index = day.queueSurfaces.findIndex((surface) => surface.runId === parsed.target.runId);

  if (parsed.operation !== "replace-queue-surface") {
    if (index === -1) {
      throw protocolError(`patch removes run ${parsed.target.runId}, which this snapshot does not hold`);
    }
    return {
      ...day,
      queueSurfaces: day.queueSurfaces.filter((surface) => surface.runId !== parsed.target.runId),
    };
  }

  if (index === -1) {
    throw protocolError(`patch replaces run ${parsed.target.runId}, which this snapshot does not hold`);
  }
  const existing = day.queueSurfaces[index];
  if (parsed.replacement.rowRevision < existing.rowRevision) {
    // Return the held day by reference for stale revisions; unchanged data needs no rerender.
    return day;
  }
  const queueSurfaces = [...day.queueSurfaces];
  queueSurfaces[index] = parsed.replacement;
  return { ...day, queueSurfaces };
}
