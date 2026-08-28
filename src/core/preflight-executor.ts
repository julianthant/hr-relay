import type { Clock } from "../domain/clock.js";
import {
  PreflightObservationSchema,
  type PreflightRunner,
} from "../domain/preflight.js";
import { PREFLIGHT_CHECKS } from "../domain/runtime-dependencies.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";

type RunnerRace = Readonly<
  | { state: "completed"; value: unknown }
  | { state: "threw"; error: unknown }
  | { state: "interrupted"; reason: "caller-abort" | "timeout"; error: unknown }
>;

function abortError(check: string, reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error(`preflight runner ${check} was aborted by its caller`, { cause: reason });
}

/** Owns one detector's registered monotonic deadline and abort channel. */
export async function executePreflightRunner(
  runner: PreflightRunner,
  signal: AbortSignal,
  clock: Clock,
  scheduler: MonotonicDeadlineScheduler,
) {
  const check = PREFLIGHT_CHECKS.find(({ id }) => id === runner.check);
  if (check === undefined) throw new Error(`preflight runner names unknown check ${runner.check}`);
  if (check.runner !== runner.kind) {
    throw new Error(`preflight runner ${runner.check} kind ${runner.kind} does not match ${check.runner}`);
  }

  const deadlineMonotonicMs = clock.monotonicMs() + check.timeoutMs;
  const controller = new AbortController();
  let interrupted = false;
  let publishInterruption: ((outcome: RunnerRace) => void) | undefined;
  const interruption = new Promise<RunnerRace>((resolve) => {
    publishInterruption = resolve;
  });
  const interrupt = (reason: "caller-abort" | "timeout", error: unknown): void => {
    if (interrupted) return;
    interrupted = true;
    const publish = publishInterruption;
    if (publish === undefined) throw new Error(`preflight runner ${runner.check} interruption channel was not initialized`);
    publish({ state: "interrupted", reason, error });
    controller.abort(error);
  };
  const onCallerAbort = (): void => {
    interrupt("caller-abort", signal.reason);
  };
  signal.addEventListener("abort", onCallerAbort, { once: true });
  if (signal.aborted) onCallerAbort();
  const deadlineError = new Error(`preflight runner ${check.id} exceeded its registered ${String(check.timeoutMs)}ms deadline`);
  const deadline = scheduler.schedule(deadlineMonotonicMs, () => {
    interrupt("timeout", deadlineError);
  });

  try {
    const invocation = Promise.resolve().then(() => runner.run({
      signal: controller.signal,
      timeoutMs: check.timeoutMs,
      deadlineMonotonicMs,
      redaction: check.redaction,
    }));
    // Both arms are retained even when the interruption wins, so a late
    // detector rejection is observed and cannot become an unhandled promise.
    const invocationOutcome = invocation.then<RunnerRace, RunnerRace>(
      (value) => ({ state: "completed", value }),
      (error: unknown) => ({ state: "threw", error }),
    );
    const raced = await Promise.race([invocationOutcome, interruption]);
    if (raced.state === "interrupted") {
      if (raced.reason === "caller-abort") throw abortError(check.id, raced.error);
      return PreflightObservationSchema.parse({
        check: check.id,
        state: "unhealthy",
        summary: `${check.id} timed out after ${String(check.timeoutMs)}ms`,
        impact: `${check.id} did not settle before its registered deadline`,
      });
    }
    if (raced.state === "threw") throw raced.error;
    const observation = PreflightObservationSchema.parse(raced.value);
    if (observation.check !== check.id) {
      throw new Error(`preflight runner ${runner.check} returned observation for ${observation.check}`);
    }
    return observation;
  } finally {
    deadline.cancel();
    signal.removeEventListener("abort", onCallerAbort);
  }
}
