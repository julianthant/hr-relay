import type { Clock } from "../../rules/time/clock.js";
import type { z } from "zod";
import { ConfirmedActionEventSchema, type ConfirmedActionEvent } from "../../models/events/confirmed-action.js";

export type ConfirmedActionDelivery =
  | Readonly<{ state: "delivered"; event: ConfirmedActionEvent }>
  | Readonly<{ state: "queued"; event: ConfirmedActionEvent }>
  | Readonly<{ state: "refused"; reason: "saturated" | "closed" | "unconnected" }>;
export type ConfirmedActionHealth = Readonly<{
  state: "healthy" | "saturated" | "closed" | "append-failed" | "unconnected" | "proof-unavailable" | "program-error";
  pending: number;
  diagnosticFailure: boolean;
}>;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, "eventId" | "workerId" | "workerStreamId" | "sequence" | "recordedAt"> : never;
export type ConfirmedActionDraft = WithoutEnvelope<z.input<typeof ConfirmedActionEventSchema>>;

export interface ConfirmedActionPublisher {
  publish(event: ConfirmedActionDraft): ConfirmedActionDelivery;
  drain(append: (event: ConfirmedActionEvent) => void): ConfirmedActionHealth;
  close(append?: (event: ConfirmedActionEvent) => void): ConfirmedActionHealth;
  health(): ConfirmedActionHealth;
  reportProofUnavailable(): ConfirmedActionHealth;
  reportProgramError(): ConfirmedActionHealth;
  reportAppendFailure(): ConfirmedActionHealth;
}

/** Worker-lifetime bounded handoff. Queue acceptance is never called durable delivery. */
export function createConfirmedActionPublisher(input: Readonly<{
  workerId: string;
  streamId: string;
  clock: Clock;
  capacity: number;
  append?: (event: ConfirmedActionEvent) => void;
  onHealth?: (health: ConfirmedActionHealth) => void;
}>): ConfirmedActionPublisher {
  if (!Number.isSafeInteger(input.capacity) || input.capacity < 1) throw new Error("confirmed-action-capacity-invalid");
  if (input.streamId.length === 0) throw new Error("confirmed-action-stream-id-missing");
  const pending: ConfirmedActionEvent[] = [];
  let sequence = 0;
  let closed = false;
  let state: ConfirmedActionHealth["state"] = input.append === undefined ? "unconnected" : "healthy";
  let diagnosticFailure = false;
  const health = (): ConfirmedActionHealth => ({ state, pending: pending.length, diagnosticFailure });
  const report = (): void => {
    try { input.onHealth?.(health()); }
    catch { diagnosticFailure = true; }
  };
  return {
    publish(event) {
      const next = sequence + 1;
      const parsed = ConfirmedActionEventSchema.parse({
        ...event,
        workerId: input.workerId,
        workerStreamId: input.streamId,
        sequence: next,
        eventId: `${input.streamId}/${String(next)}`,
        recordedAt: input.clock.now().toISOString(),
      });
      if (input.append === undefined) {
        state = "unconnected";
        report();
        return { state: "refused", reason: "unconnected" };
      }
      if (closed || pending.length >= input.capacity) {
        state = closed ? "closed" : "saturated";
        report();
        return { state: "refused", reason: closed ? "closed" : "saturated" };
      }
      sequence = next;
      pending.push(parsed);
      this.drain(input.append);
      report();
      return pending.includes(parsed) ? { state: "queued", event: parsed } : { state: "delivered", event: parsed };
    },
    drain(append) {
      while (pending.length > 0) {
        try { append(pending[0]); }
        catch { state = "append-failed"; report(); return health(); }
        pending.shift();
      }
      state = closed ? "closed" : "healthy";
      report();
      return health();
    },
    close(append) {
      closed = true;
      if (append !== undefined || input.append !== undefined) this.drain((append ?? input.append)!);
      state = "closed";
      report();
      return health();
    },
    health,
    reportProofUnavailable() { state = "proof-unavailable"; report(); return health(); },
    reportProgramError() { state = "program-error"; report(); return health(); },
    reportAppendFailure() { state = "append-failed"; report(); return health(); },
  };
}
