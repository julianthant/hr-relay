/**
 * Client-side dashboard-day state: strictly APPLYING server payloads, never
 * deriving. A patch replaces or removes exactly one queue surface; counts are
 * never recomputed here (D81 — the server sends a fresh snapshot whenever a
 * count changes, so a patch is count-neutral by protocol). A patch naming a
 * run the snapshot does not hold is a protocol failure the subscription
 * turns into a resnapshot — never a silent insert.
 *
 * **D4 (Track D, ref frontend-backend-integration §7.4; audit finding P1) — a
 * patch is a SPLICE, and the whole-day re-parse is gone.** This function used
 * to end with `DashboardDayWireSchema.parse({ ...day, queueSurfaces })`, so
 * every single-row SSE patch re-validated the entire day: at the §7.4 fixture's
 * 1,240 rows that is 1,240 rows parsed to change one, on every row change of
 * every bulk run. It cost twice over, because zod's `parse` returns a fresh
 * object graph — so each patch also handed every UNTOUCHED row a brand-new
 * reference, and no `memo` below this fold could ever hold.
 *
 * **Why dropping it is safe, and where the safety now lives.** Three facts, and
 * the splice needs all three:
 *
 *  1. The PATCH is still strictly parsed here, in full. `DashboardDayPatchSchema`
 *     runs the replacement row through `QueueSurfaceWireSchema` and refines the
 *     replacement's `runId`/`rowRevision` against the target's, so a replacement
 *     cannot arrive under an identity other than the one it names. That parse is
 *     O(one row) where the old one was O(the day).
 *  2. The HELD day was parsed whole when its snapshot arrived
 *     (`DashboardStreamEnvelopeSchema` → `DashboardDayWireSchema`, in
 *     `subscription.ts`), and a snapshot or a `reset-required` is the only thing
 *     that replaces it. Every field this function does not touch is therefore
 *     already validated, and is passed through BY REFERENCE.
 *  3. `DashboardDayWireSchema`'s only cross-row invariant over `queueSurfaces`
 *     is `runId` uniqueness. A replacement lands at the index its own `runId`
 *     was found at, and a removal deletes by `runId` — so both preserve
 *     uniqueness by construction rather than by re-checking it.
 *
 * Anything that does not fit those three fails LOUD: an unheld run id is a
 * `protocol` error (which `subscription.ts` turns into a fresh snapshot), and a
 * shape mismatch throws out of the patch parse above — neither is ever a silent
 * drop, a silent insert, or a kept-stale row. `day-state-splice.test.ts` pins
 * the count at zero whole-day parses per patch AND pins reference equality for
 * every row the patch did not name.
 */
import { z } from "zod";
import type { DashboardDayWire } from "../../domain/dashboard/projection.js";
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
    // A stale duplicate from a resume replay; idempotent by revision. Returning
    // the held day BY REFERENCE (not a copy) is deliberate: nothing moved, so
    // nothing downstream should re-render either.
    return day;
  }
  const queueSurfaces = [...day.queueSurfaces];
  queueSurfaces[index] = parsed.replacement;
  return { ...day, queueSurfaces };
}
