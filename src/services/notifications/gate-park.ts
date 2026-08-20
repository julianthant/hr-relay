/**
 * Ref dashboard-surfaces §2.6's "open operator gate" trigger, produced (D262).
 *
 * §2.6 has routed the open operator gate onto the `gate-waiting` trigger since
 * D79b, `NotificationTriggerEventSchema` has carried the `gate-opened` arm
 * since D138, and the bell has rendered its rows since 2i-B — and nothing ever
 * published one. So the ONE moment in this whole product where a human must act
 * or the run waits forever produced no alert at all, while D222's backup watch
 * was the inbox's only producer. This watch is the second, and it is the one the
 * inbox was built for.
 *
 * **The seam is a transition-watcher over authority, not the park itself.** The
 * park is written by the WORKER (`src/core/run-executor.ts`, the §4 gate arm), a
 * separate OS process with no operator attached, no desktop channel, and — by
 * D82's argument — no business making a projection a precondition of settling a
 * run: a run must park even when the inbox cannot be written. What makes the
 * watcher sound rather than merely convenient is that a park is a STANDING
 * authority fact: `parked-gate` does not go away until a human resolves it, so
 * the set of runs waiting on a person is derivable from authority at any later
 * instant, by any process. That is a strictly stronger recovery story than
 * publishing inside the park's own transaction would be — atomicity covers only
 * parks that happen after this code ships, while re-derivation also covers a run
 * that was already parked, one parked while the dashboard was down, and one
 * parked while the inbox transaction was failing.
 *
 * Three rules bound it, two of them D222's exactly:
 *
 *  1. **A TRANSITION publishes, a standing park does not.** The D134 fold marks
 *     a row unread again on every publish because a repeat is news again, so
 *     re-publishing the same standing park on every tick would make the row
 *     unreadable-forever — §2.6's spam by another route. The notifier remembers
 *     the parks it has REPORTED and publishes only the ones it has not.
 *  2. **A failed publish forgets nothing.** The memory advances only after the
 *     durable row commits, so a publish that throws leaves that park pending and
 *     the next observation retries it. Publishes already committed in the same
 *     pass keep their memory — they are durable facts, not part of the failure.
 *  3. **A resolved gate publishes nothing and rewrites nothing.** The trigger
 *     union has no "resolved" arm and inventing one is a new decision (D222's
 *     own argument); beyond that, a resolution is an act the operator just
 *     performed, so telling them about it is precisely the spam §2.6 forbids.
 *     The row is not marked read either: read state is the operator's own axis
 *     (D138 keeps it independent of even snooze), and a watcher that cleared it
 *     would erase the record that a human was ever asked — including for a gate
 *     resolved from a surface this operator never saw. What the notifier DOES do
 *     is FORGET the park, so a later re-park at the same gate is a transition
 *     again rather than a silent fold nobody would see move.
 *
 * The notifier holds no authority handle and does no I/O of its own: the
 * composition observes the parked set and hands it over, exactly as D222's watch
 * is handed a backup state. That keeps the transition rule testable without a
 * database, which is the half that actually needs pinning.
 */
import { z } from "zod";
import { GateIdSchema, RunIdSchema, WorkflowIdSchema } from "../../domain/ids.js";
import type { NotificationInbox, NotificationPublishReport } from "./inbox.js";

/**
 * One run waiting on a person. Ids and a closed gate key — nothing from the
 * gate's evidence packet travels, because §2.6's trigger union is ids, closed
 * codes and counts with no free-text field (D138), and the packet is exactly the
 * HR data that rule exists to keep out of a notification. The alert names WHERE
 * to look; the surface it links to is where the operator sees WHAT.
 */
export const GateParkObservationSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  gateId: GateIdSchema,
});
export type GateParkObservation = z.infer<typeof GateParkObservationSchema>;

export const GateParkObservationSetSchema = z.array(GateParkObservationSchema);

export type GateParkObservationReport = Readonly<{
  /** Parks whose durable row this observation wrote. */
  published: readonly Readonly<{ park: GateParkObservation; report: NotificationPublishReport }>[];
  /** Parks this notifier had already reported — deliberately re-published as nothing. */
  standing: readonly GateParkObservation[];
  /** Parks it had reported that are no longer parked; a re-park would publish again. */
  released: readonly GateParkObservation[];
}>;

export interface GateParkNotifier {
  /** Takes `unknown` and parses: the observation set is the boundary. */
  observed(parks: unknown): Promise<GateParkObservationReport>;
}

/** `(runId, gateId)` — the same identity `deriveNotificationDedupeFingerprint` folds a `gate-opened` on. */
function memoryKey(park: GateParkObservation): string {
  return `${park.runId}\u0000${park.gateId}`;
}

export function createGateParkNotifier(
  dependencies: Readonly<{ inbox: Pick<NotificationInbox, "publish"> }>,
): GateParkNotifier {
  /**
   * The parks this notifier has successfully REPORTED. In-process on purpose,
   * and empty at boot: across a restart a still-parked run re-publishes once and
   * the D134 fold turns that into a count bump on the ONE row that already says
   * it — an honest "still waiting for you after the restart", never a duplicate
   * row. That re-publish is also the recovery path for every window this seam
   * cannot make atomic.
   */
  const reported = new Map<string, GateParkObservation>();

  return Object.freeze({
    async observed(input: unknown): Promise<GateParkObservationReport> {
      const parks = GateParkObservationSetSchema.parse(input);
      const published: { park: GateParkObservation; report: NotificationPublishReport }[] = [];
      const standing: GateParkObservation[] = [];
      const seen = new Set<string>();

      for (const park of parks) {
        const key = memoryKey(park);
        seen.add(key);
        if (reported.has(key)) {
          standing.push(park);
          continue;
        }
        const report = await dependencies.inbox.publish({
          kind: "gate-opened",
          runId: park.runId,
          workflowId: park.workflowId,
          gateId: park.gateId,
        });
        // AFTER the durable row commits (rule 2). A throw above leaves this key
        // absent, so the next observation retries this exact park.
        reported.set(key, park);
        published.push({ park, report });
      }

      const released: GateParkObservation[] = [];
      for (const [key, park] of reported) {
        if (seen.has(key)) continue;
        reported.delete(key);
        released.push(park);
      }

      return Object.freeze({
        published: Object.freeze(published),
        standing: Object.freeze(standing),
        released: Object.freeze(released),
      });
    },
  });
}
