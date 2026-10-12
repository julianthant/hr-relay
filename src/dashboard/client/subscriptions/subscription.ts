/** The resumable dashboard-day subscription (ref frontend-backend-integration ), client side. */
import { z } from "zod";
import type { DashboardDayWire } from "../../../models/dashboard/projection.js";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../../models/dashboard/subscription.js";
import { applyDashboardDayPatch } from "../queries/day-state.js";
import { DashboardClientError, protocolError } from "../errors.js";
import type { DashboardTransport, StreamHandle } from "../transport.js";

export type SubscriptionState =
  | { readonly state: "connecting" }
  | { readonly state: "live" }
  | { readonly state: "reconnecting" }
  | { readonly state: "degraded" }
  | { readonly state: "stopped"; readonly error?: DashboardClientError };

export interface DashboardDaySubscriptionDeps {
  readonly transport: DashboardTransport;
  readonly day: string;
  readonly onDay: (day: DashboardDayWire) => void;
  readonly onState: (state: SubscriptionState) => void;
  /** Injectable reconnect timer; defaults to setTimeout. */
  readonly schedule?: (delayMs: number, run: () => void) => () => void;
  readonly reconnectDelayMs?: number;
}

export interface DashboardDaySubscription {
  close(): void;
}

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;

/** Which stream endings a RECONNECT can answer, and which are terminal.
 * `openStream` rejects with exactly two kinds: `network` when the fetch itself */
function reconnectableStreamFailure(reason: unknown): boolean {
  return reason instanceof DashboardClientError && reason.kind === "network";
}

/** A rejection this client cannot classify is not a network blip. Naming it
 * (and keeping the value as the cause) is what stops an unknown from being */
function streamFailure(reason: unknown): DashboardClientError {
  if (reason instanceof DashboardClientError) return reason;
  return new DashboardClientError({
    kind: "protocol",
    message: `the day stream ended in an unclassified stream rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    cause: reason,
  });
}

export function subscribeDashboardDay(deps: DashboardDaySubscriptionDeps): DashboardDaySubscription {
  const day = z.iso.date().parse(deps.day);
  const schedule = deps.schedule
    ?? ((delayMs: number, run: () => void): (() => void) => {
      const handle = setTimeout(run, delayMs);
      return () => clearTimeout(handle);
    });
  const reconnectDelayMs = deps.reconnectDelayMs ?? 1000;

  let closed = false;
  let streamIdentity = 0;
  let stream: StreamHandle | undefined;
  let cancelTimer: (() => void) | undefined;
  let snapshot: DashboardDayWire | undefined;
  let generation: number | undefined;
  let lastCursorNumber: number | undefined;
  let lastCursorId: string | undefined;

  function stop(error?: DashboardClientError): void {
    if (closed) return;
    closed = true;
    cancelTimer?.();
    stream?.close();
    deps.onState(error === undefined ? { state: "stopped" } : { state: "stopped", error });
  }

  function resnapshot(): void {
    // A fresh snapshot supersedes local state; resume without Last-Event-ID.
    snapshot = undefined;
    lastCursorNumber = undefined;
    lastCursorId = undefined;
    reconnect(false, "connecting");
  }

  function handleEnvelope(envelope: DashboardStreamEnvelope): void {
    if (envelope.type === "hello") {
      if (generation !== undefined && envelope.projectionGeneration !== generation) {
        snapshot = undefined;
        lastCursorNumber = undefined;
        lastCursorId = undefined;
      }
      generation = envelope.projectionGeneration;
      return;
    }
    if (envelope.type === "health") {
      if (envelope.state === "degraded") deps.onState({ state: "degraded" });
      else if (envelope.state === "live") deps.onState({ state: "live" });
      else deps.onState({ state: "reconnecting" });
      return;
    }
    if (envelope.type === "reset-required") {
      resnapshot();
      return;
    }

    const cursorMatch = CURSOR_PATTERN.exec(envelope.cursor);
    if (cursorMatch === null) {
      throw protocolError(`envelope carries malformed cursor ${envelope.cursor}`);
    }
    const cursorNumber = Number(cursorMatch[1]);

    // Accept same-cursor snapshots but reject duplicate patches; only snapshots refresh worker and count rollups.
    if (envelope.type === "snapshot") {
      if (lastCursorNumber !== undefined && cursorNumber < lastCursorNumber) return;
      if (envelope.topic !== "dashboard-day") {
        throw protocolError(`unexpected snapshot topic ${envelope.topic}; this subscription serves dashboard-day`);
      }
      if (envelope.payload.day !== day) throw protocolError("day-request-identity-mismatch");
      snapshot = envelope.payload;
      lastCursorNumber = cursorNumber;
      lastCursorId = envelope.cursor;
      deps.onDay(snapshot);
      return;
    }

    // patch
    if (lastCursorNumber !== undefined && cursorNumber <= lastCursorNumber) return;
    if (envelope.topic !== "dashboard-day") {
      throw protocolError(`unexpected patch topic ${envelope.topic}; this subscription serves dashboard-day`);
    }
    if (snapshot === undefined || lastCursorNumber === undefined) {
      resnapshot();
      return;
    }
    if (cursorNumber > lastCursorNumber + 1) {
      resnapshot();
      return;
    }
    try {
      snapshot = applyDashboardDayPatch(snapshot, envelope.payload);
    } catch (error) {
      if (error instanceof DashboardClientError && error.kind === "protocol") {
        resnapshot();
        return;
      }
      throw error;
    }
    lastCursorNumber = Math.max(lastCursorNumber, cursorNumber);
    lastCursorId = envelope.cursor;
    deps.onDay(snapshot);
  }

  function connect(withResume: boolean): void {
    if (closed) return;
    const lastEventId = withResume ? lastCursorId : undefined;
    const lastProjectionGeneration = lastEventId === undefined ? undefined : generation;
    const identity = ++streamIdentity;
    const handle = deps.transport.openStream(`/events/v1?topics=dashboard-day:${day}`, {
      ...(lastEventId === undefined ? {} : { lastEventId }),
      ...(lastProjectionGeneration === undefined ? {} : { lastProjectionGeneration }),
      onMessage: (message) => {
        if (closed || identity !== streamIdentity) return;
        let envelope: DashboardStreamEnvelope;
        try {
          envelope = DashboardStreamEnvelopeSchema.parse(JSON.parse(message.data));
        } catch (error) {
          stop(protocolError(`malformed stream envelope: ${error instanceof Error ? error.message : String(error)}`));
          return;
        }
        try {
          handleEnvelope(envelope);
        } catch (error) {
          stop(error instanceof DashboardClientError
            ? error
            : protocolError(error instanceof Error ? error.message : String(error)));
        }
      },
    });
    stream = handle;
    // Ignore superseded stream settlements so closing an old handle cannot schedule another reconnect.
    const superseded = (): boolean => closed || stream !== handle;
    handle.done.then(
      // EOF: the server closed a healthy stream. Resuming from the held cursor
      // is exactly what that ending calls for.
      () => {
        if (superseded()) return;
        reconnect(true, "reconnecting");
      },
      (reason: unknown) => {
        if (superseded()) return;
        if (reconnectableStreamFailure(reason)) {
          reconnect(true, "reconnecting");
          return;
        }
        stop(streamFailure(reason));
      },
    );
  }

  function reconnect(withResume: boolean, nextState: "connecting" | "reconnecting"): void {
    if (closed) return;
    ++streamIdentity;
    const previous = stream;
    stream = undefined;
    previous?.close();
    deps.onState({ state: nextState });
    cancelTimer?.();
    cancelTimer = schedule(nextState === "connecting" ? 0 : reconnectDelayMs, () => connect(withResume));
  }

  deps.onState({ state: "connecting" });
  connect(false);
  return Object.freeze({ close: (): void => stop() });
}
