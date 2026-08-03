/**
 * The resumable dashboard-day subscription (doc 13 §3.5), client side.
 *
 * Every envelope schema-parses before entering state — a malformed payload is
 * a visible protocol failure that stops the subscription with an error, never
 * a `console.warn` + ignore. Cursor rules: hello pins the generation; a
 * duplicate cursor is idempotent; a GAP (an envelope more than one cursor
 * ahead) or a patch for an unheld run forces a fresh snapshot by reconnecting
 * WITHOUT `Last-Event-ID`; `reset-required` clears state the same way. A
 * transport drop reports `reconnecting` and resumes WITH `Last-Event-ID`.
 */
import { z } from "zod";
import type { DashboardDayWire } from "../../domain/dashboard/projection.js";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../domain/dashboard/subscription.js";
import { applyDashboardDayPatch } from "./day-state.js";
import { DashboardClientError, protocolError } from "./errors.js";
import type { DashboardTransport, StreamHandle } from "./transport.js";

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

export function subscribeDashboardDay(deps: DashboardDaySubscriptionDeps): DashboardDaySubscription {
  const day = z.iso.date().parse(deps.day);
  const schedule = deps.schedule
    ?? ((delayMs: number, run: () => void): (() => void) => {
      const handle = setTimeout(run, delayMs);
      return () => clearTimeout(handle);
    });
  const reconnectDelayMs = deps.reconnectDelayMs ?? 1000;

  let closed = false;
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

    if (envelope.type === "snapshot") {
      if (envelope.topic !== "dashboard-day") {
        throw protocolError(`unexpected snapshot topic ${envelope.topic}; this subscription serves dashboard-day`);
      }
      snapshot = envelope.payload;
      lastCursorNumber = cursorNumber;
      lastCursorId = envelope.cursor;
      deps.onDay(snapshot);
      return;
    }

    // patch
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
    stream = deps.transport.openStream(`/events/v1?topics=dashboard-day:${day}`, {
      ...(lastEventId === undefined ? {} : { lastEventId }),
      onMessage: (message) => {
        if (closed) return;
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
    stream.done.then(
      () => reconnect(true, "reconnecting"),
      () => reconnect(true, "reconnecting"),
    );
  }

  function reconnect(withResume: boolean, nextState: "connecting" | "reconnecting"): void {
    if (closed) return;
    stream?.close();
    deps.onState({ state: nextState });
    cancelTimer?.();
    cancelTimer = schedule(nextState === "connecting" ? 0 : reconnectDelayMs, () => connect(withResume));
  }

  deps.onState({ state: "connecting" });
  connect(false);
  return Object.freeze({ close: (): void => stop() });
}
