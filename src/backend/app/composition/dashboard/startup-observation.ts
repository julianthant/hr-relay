import { channel } from "node:diagnostics_channel";
import { z } from "zod";
import { systemClock } from "../../../../rules/time/clock.js";

export const StartupObservationSchema = z.strictObject({
  phase: z.enum(["timeline-fold", "timeline-observer", "notification-observer"]),
  elapsedMs: z.number().nonnegative(),
  outcome: z.enum(["completed", "superseded", "failed"]),
});
type Observation = z.infer<typeof StartupObservationSchema>;
export const startupObservations = channel("relay.dashboard.startup");

export function startStartupObservation(phase: Observation["phase"]) {
  if (!startupObservations.hasSubscribers) return;
  const started = systemClock.monotonicMs();
  return (outcome: Observation["outcome"]) => startupObservations.publish({ phase, elapsedMs: systemClock.monotonicMs() - started, outcome });
}
