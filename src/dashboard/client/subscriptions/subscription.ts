/**
 * The resumable dashboard-day subscription (ref frontend-backend-integration §3.5), client side.
 *
 * Every envelope schema-parses before entering state — a malformed payload is
 * a visible protocol failure that stops the subscription with an error, never
 * a `console.warn` + ignore. Cursor rules: hello pins the generation; a
 * duplicate or older PATCH is IGNORED before it can have any effect (which is
 * what makes a resume's replay free rather than a full resnapshot), while a
 * snapshot is ignored only from strictly BEHIND the held cursor — one batch
 * stamps its patch and its snapshot with the same cursor, and the snapshot is
 * the half that carries the worker cards, the pools and the counts; a GAP (an
 * envelope more than one cursor ahead) or a patch for an unheld run forces a
 * fresh snapshot by reconnecting WITHOUT `Last-Event-ID`; `reset-required`
 * clears state the same way.
 *
 * How a stream ENDS decides whether there is a next one. EOF and a transport
 * drop (a `network` error) report `reconnecting` and resume WITH
 * `Last-Event-ID`. Every other rejection — an HTTP refusal, a protocol or
 * schema failure, or a value this client cannot classify — is terminal: the
 * subscription stops carrying that error, so the hook can replace the day it
 * can no longer keep current instead of reconnecting forever behind a screen
 * that still looks live.
 */
import { z } from "zod";
import type { DashboardDayWire } from "../../../domain/dashboard/projection.js";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../../domain/dashboard/subscription.js";
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

/**
 * Which stream endings a RECONNECT can answer, and which are terminal.
 *
 * `openStream` rejects with exactly two kinds: `network` when the fetch itself
 * failed or the body errored mid-read — the transport DROP this subscription
 * exists to survive — and `http` when the server refused the stream outright.
 * Everything else that can reach here (a `protocol`/`schema` error, or a value
 * this client did not author at all) is a failure whose cause reopening the
 * same request cannot touch.
 *
 * This is deliberately NOT `error.retryable`. That flag is the SERVER's hint
 * about re-issuing one request, and `httpError` copies it straight off the wire
 * body — so a 503 declaring itself retryable would put this subscription into a
 * reconnect loop that never reports anything, which is the exact failure the
 * §3.5 rule against a silently stale dashboard forbids. The kind is what says
 * whether the connection or the CONTRACT failed.
 */
function reconnectableStreamFailure(reason: unknown): boolean {
  return reason instanceof DashboardClientError && reason.kind === "network";
}

/**
 * A rejection this client cannot classify is not a network blip. Naming it
 * (and keeping the value as the cause) is what stops an unknown from being
 * guessed into a retry loop.
 */
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

    // Idempotence, BEFORE any effect (ref frontend-backend-integration §3.5:
    // "duplicate/current cursors are idempotent") — and the rule is NOT the
    // same on both sides of that sentence, because the two envelope kinds do
    // not compose the same way.
    //
    // A SNAPSHOT is the whole day for its cursor, so applying it is
    // idempotent by construction: it REPLACES state rather than editing it.
    // Only a snapshot from BEHIND the held cursor is stale. And one at the
    // held cursor is not merely harmless, it is required: the projection
    // stamps every change of ONE batch with the same cursor, so a
    // count-neutral member change followed by a count-bearing one is served as
    // `patch pc:N` then `snapshot pc:N`. Only the snapshot carries the worker
    // cards, the pools and the count rollups — dropping it as a duplicate
    // leaves them stale behind a Live dot, with no later envelope that could
    // correct them.
    //
    // A PATCH is an EDIT of held state, so re-applying one is not free: a
    // replayed REMOVAL names a run the day no longer holds,
    // `applyDashboardDayPatch` calls that a protocol failure, and this module
    // answers a protocol failure by throwing the whole day away and
    // resnapshotting. A resume replays from the held cursor, so that envelope
    // arrives again on every correct resume. Hence `<=` here, `<` above.
    //
    // `lastCursorNumber` is undefined only before the first snapshot of a
    // generation — hello clears it when the generation changes, which is what
    // lets a REPLACEMENT generation's lower-numbered cursors through.
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
    // The handlers below belong to THIS handle. `close()` aborts the fetch and
    // the transport RESOLVES an aborted stream's `done`, indistinguishably
    // from a server-side EOF — so a stream this subscription deliberately
    // superseded (a gap resnapshot, a reset, a reconnect) settles one
    // microtask later and would otherwise schedule a SECOND reconnect over the
    // one already pending, flapping `connecting → reconnecting` and turning
    // the fresh snapshot a gap demands into a resume. `reconnect` and `stop`
    // release `stream` before closing it, so a superseded handle's settlement
    // is inert here rather than merely late.
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
