import { channel } from "node:diagnostics_channel";
import { systemClock } from "../../../../rules/time/clock.js";

export const startupObservations = channel<Readonly<{
  phase: "timeline-fold" | "timeline-observer" | "notification-observer";
  elapsedMs: number;
  outcome: "completed" | "superseded" | "failed";
}>>("relay.dashboard.startup");

type Observation = Parameters<typeof startupObservations.publish>[0];

export function startStartupObservation(phase: Observation["phase"]) {
  if (!startupObservations.hasSubscribers) return;
  const started = systemClock.monotonicMs();
  return (outcome: Observation["outcome"]) => startupObservations.publish({ phase, elapsedMs: systemClock.monotonicMs() - started, outcome });
}
