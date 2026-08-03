/**
 * Client-side dashboard-day state: strictly APPLYING server payloads, never
 * deriving. A patch replaces or removes exactly one queue surface; counts are
 * never recomputed here (D81 — the server sends a fresh snapshot whenever a
 * count changes, so a patch is count-neutral by protocol). A patch naming a
 * run the snapshot does not hold is a protocol failure the subscription
 * turns into a resnapshot — never a silent insert.
 */
import { z } from "zod";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../domain/dashboard/projection.js";
import { DashboardDayPatchSchema } from "../../domain/dashboard/subscription.js";
import { protocolError } from "./errors.js";

export type DashboardDayPatch = z.infer<typeof DashboardDayPatchSchema>;

export function applyDashboardDayPatch(day: DashboardDayWire, patch: DashboardDayPatch): DashboardDayWire {
  const parsed = DashboardDayPatchSchema.parse(patch);
  const index = day.queueSurfaces.findIndex((surface) => surface.runId === parsed.target.runId);

  if (parsed.operation !== "replace-queue-surface") {
    if (index === -1) {
      throw protocolError(`patch removes run ${parsed.target.runId}, which this snapshot does not hold`);
    }
    return DashboardDayWireSchema.parse({
      ...day,
      queueSurfaces: day.queueSurfaces.filter((surface) => surface.runId !== parsed.target.runId),
    });
  }

  if (index === -1) {
    throw protocolError(`patch replaces run ${parsed.target.runId}, which this snapshot does not hold`);
  }
  const existing = day.queueSurfaces[index];
  if (parsed.replacement.rowRevision < existing.rowRevision) {
    // A stale duplicate from a resume replay; idempotent by revision.
    return day;
  }
  const queueSurfaces = [...day.queueSurfaces];
  queueSurfaces[index] = parsed.replacement;
  return DashboardDayWireSchema.parse({ ...day, queueSurfaces });
}
