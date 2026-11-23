/** The resumable dashboard-day subscription (ref frontend-backend-integration ), client side.
 * One phase value owns the stream, the timer, and the greeting. A waiting
 * subscription cannot also be greeted, and a stopped one holds neither. */
import { z } from "zod";
import type { DashboardDayWire } from "../../../models/dashboard/projection.js";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
  type NotificationPublicationWire,
} from "../../../models/dashboard/subscription.js";
import { RunIdSchema } from "../../../rules/identity/ids.js";
import { applyDashboardDayPatch } from "../queries/day-state.js";
import type { RowStoreWriter } from "./row-store.js";
import { DashboardClientError, protocolError } from "../errors.js";
import type { DashboardTransport, StreamHandle } from "../transport.js";

export type SubscriptionState =
  | { readonly state: "connecting" }
  | { readonly state: "live" }
  | { readonly state: "reconnecting" }
  | { readonly state: "degraded" }
  | { readonly state: "stopped"; readonly error?: DashboardClientError };

/** Waiting holds the reconnect timer. Open has a stream and no hello yet.
 * Greeted has a stream and a health. Stopped has neither a stream nor a timer. */
type StreamPhase =
  | { readonly phase: "waiting"; readonly shown: "connecting" | "reconnecting"; readonly resume: boolean; readonly cancel: () => void }
  | { readonly phase: "open"; readonly identity: number; readonly stream: StreamHandle }
  | { readonly phase: "greeted"; readonly identity: number; readonly stream: StreamHandle;
      readonly health: "pending" | "live" | "reconnecting" | "degraded" }
  | { readonly phase: "stopped" };

/** The greeting, plus the snapshot the subscription can resume from.
 * A held snapshot always carries its cursor. */
type Baseline = Readonly<{
  authority?: { generation: number; descriptorHash: string };
  held?: { snapshot: DashboardDayWire; cursorNumber: number; cursorId: string };
}>;

type EnvelopeOf<Type extends DashboardStreamEnvelope["type"]> = Extract<DashboardStreamEnvelope, { type: Type }>;

export interface DashboardDaySubscriptionDeps {
  readonly transport: DashboardTransport;
  readonly day: string;
  readonly onDay: (day: DashboardDayWire) => void;
  readonly onState: (state: SubscriptionState) => void;
  /** The run whose panel rides the stream; `select` changes it. */
  readonly run?: string;
  /** Where the stream's rows are held. */
  readonly rows?: RowStoreWriter;
  readonly publications?: Readonly<{ actorId: string; onPublication: (publication: NotificationPublicationWire) => void }>;
  /** Injectable reconnect timer; defaults to setTimeout. */
  readonly schedule?: (delayMs: number, run: () => void) => () => void;
  readonly reconnectDelayMs?: number;
}

export interface DashboardDaySubscription {
  /** Names the run whose panel the stream carries, or none. The stream reopens once, resuming from the held cursor. */
  select(run: string | undefined): void;
  close(): void;
}

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;

/** Which stream endings a RECONNECT can answer, and which are terminal.
 * `openStream` rejects with exactly two kinds: `network` when the fetch itself fails. */
function reconnectableStreamFailure(reason: unknown): boolean {
  return reason instanceof DashboardClientError && reason.kind === "network";
}

/** A rejection this client cannot classify is not a network blip. Naming it
 * (and keeping the value as the cause) is what stops an unknown from being retried. */
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

  const initialCancel = (): void => undefined;
  let phase: StreamPhase = { phase: "waiting", shown: "connecting", resume: false, cancel: initialCancel };
  let baseline: Baseline = {};
  let nextIdentity = 0;
  const published = new Set<string>();
  const runOf = (value: string | undefined): string | undefined => {
    const parsed = value === undefined ? undefined : RunIdSchema.safeParse(value);
    return parsed?.success === true ? parsed.data : undefined;
  };
  let run = runOf(deps.run);
  deps.rows?.open(run);

  /** The only writer of `phase`, and the only caller of `onState`. */
  function enter(next: StreamPhase, shown?: SubscriptionState): void {
    if (phase.phase === "stopped") return;
    const previous = phase;
    phase = next;
    if (previous.phase === "waiting" && (next.phase !== "waiting" || next.cancel !== previous.cancel)) previous.cancel();
    if ((previous.phase === "open" || previous.phase === "greeted")
        && (next.phase !== "open" && next.phase !== "greeted" || next.stream !== previous.stream)) {
      previous.stream.close();
    }
    if (shown !== undefined && phase === next) deps.onState(shown);
  }

  function stop(error?: DashboardClientError): void {
    enter({ phase: "stopped" }, error === undefined ? { state: "stopped" } : { state: "stopped", error });
  }

  function currentStream(identity: number, stream: StreamHandle): boolean {
    return (phase.phase === "open" || phase.phase === "greeted")
      && phase.identity === identity
      && phase.stream === stream;
  }

  function clearHeld(): void {
    baseline = baseline.authority === undefined ? {} : { authority: baseline.authority };
  }

  /** Arm the timer after the waiting phase is entered, so closing the old
   * stream cannot schedule a second reconnect. The cancel function exists
   * only once the scheduler returns, and storing it does not report state again. */
  function enterWaiting(shown: "connecting" | "reconnecting", resume: boolean): void {
    if (phase.phase === "stopped") return;
    let cancel: () => void = () => undefined;
    enter({ phase: "waiting", shown, resume, cancel }, { state: shown });
    if (phase.phase !== "waiting") return;
    const delay = shown === "connecting" ? 0 : reconnectDelayMs;
    cancel = schedule(delay, () => {
      if (phase.phase !== "waiting" || phase.cancel !== cancel) return;
      openStream(resume);
    });
    if (phase.phase !== "waiting") return;
    enter({ phase: "waiting", shown, resume, cancel });
  }

  function openStream(resume: boolean): void {
    if (phase.phase === "stopped") return;
    const lastEventId = resume ? baseline.held?.cursorId : undefined;
    const generation = baseline.authority?.generation;
    const lastProjectionGeneration = lastEventId === undefined || generation === undefined ? undefined : generation;
    const identity = ++nextIdentity;
    const stream = deps.transport.openStream(`/events/v1?topics=dashboard-day:${day}${run === undefined ? "" : `,run:${run}`}`, {
      ...(lastEventId === undefined ? {} : { lastEventId }),
      ...(lastProjectionGeneration === undefined ? {} : { lastProjectionGeneration }),
      onMessage: (message) => {
        if (!currentStream(identity, stream)) return;
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
    enter({ phase: "open", identity, stream });
    stream.done.then(
      () => {
        if (!currentStream(identity, stream)) return;
        enterWaiting("reconnecting", true);
      },
      (reason: unknown) => {
        if (!currentStream(identity, stream)) return;
        if (reconnectableStreamFailure(reason)) {
          enterWaiting("reconnecting", true);
          return;
        }
        stop(streamFailure(reason));
      },
    );
  }

  function requireGreeted(): Extract<StreamPhase, { phase: "greeted" }> | undefined {
    if (phase.phase === "stopped") return undefined;
    if (phase.phase !== "greeted") {
      stop(protocolError("day-stream-hello-missing"));
      return undefined;
    }
    return phase;
  }

  function cursorNumber(cursor: string): number | undefined {
    const match = CURSOR_PATTERN.exec(cursor);
    if (match === null) {
      stop(protocolError(`envelope carries malformed cursor ${cursor}`));
      return undefined;
    }
    return Number(match[1]);
  }

  function applyHello(envelope: EnvelopeOf<"hello">): void {
    if (phase.phase !== "open" && phase.phase !== "greeted") return;
    const current = phase;
    const previous = baseline.authority;
    const differs = previous !== undefined && (
      envelope.projectionGeneration !== previous.generation || envelope.descriptorHash !== previous.descriptorHash
    );
    const held = differs ? undefined : baseline.held;
    baseline = {
      authority: { generation: envelope.projectionGeneration, descriptorHash: envelope.descriptorHash },
      ...(held === undefined ? {} : { held }),
    };
    enter({
      phase: "greeted",
      identity: current.identity,
      stream: current.stream,
      health: current.phase === "greeted" ? current.health : "pending",
    });
  }

  function applyHealth(envelope: EnvelopeOf<"health">): void {
    const greeted = requireGreeted();
    if (greeted === undefined) return;
    enter(
      { phase: "greeted", identity: greeted.identity, stream: greeted.stream, health: envelope.state },
      { state: envelope.state },
    );
  }

  function applyPublication(envelope: EnvelopeOf<"notification-publication">): void {
    const greeted = requireGreeted();
    if (greeted === undefined) return;
    const authority = baseline.authority;
    if (authority === undefined
        || envelope.day !== day
        || envelope.descriptorHash !== authority.descriptorHash
        || envelope.projectionGeneration !== authority.generation) {
      stop(protocolError("notification-publication-authority-mismatch"));
      return;
    }
    if (baseline.held === undefined || greeted.health !== "live") {
      stop(protocolError("notification-publication-baseline-missing"));
      return;
    }
    if (deps.publications === undefined) return;
    if (envelope.publication.actorId !== deps.publications.actorId) {
      stop(protocolError("notification-publication-actor-mismatch"));
      return;
    }
    if (published.has(envelope.publication.sourceId)) return;
    published.add(envelope.publication.sourceId);
    deps.publications.onPublication(envelope.publication);
  }

  function applySnapshot(envelope: EnvelopeOf<"snapshot">): void {
    if (requireGreeted() === undefined) return;
    const cursor = cursorNumber(envelope.cursor);
    if (cursor === undefined || phase.phase !== "greeted") return;
    const authority = baseline.authority;
    if (envelope.payload.day !== day) {
      stop(protocolError("day-request-identity-mismatch"));
      return;
    }
    if (authority === undefined
        || envelope.payload.descriptorHash !== authority.descriptorHash
        || envelope.payload.projectionGeneration !== authority.generation) {
      stop(protocolError("day-stream-authority-mismatch"));
      return;
    }
    if (envelope.payload.snapshotCursor !== envelope.cursor) {
      stop(protocolError("day-stream-cursor-mismatch"));
      return;
    }
    // Same-cursor snapshots refresh the held day; only an older cursor is stale.
    if (baseline.held !== undefined && cursor < baseline.held.cursorNumber) return;
    baseline = {
      authority,
      held: { snapshot: envelope.payload, cursorNumber: cursor, cursorId: envelope.cursor },
    };
    // Rows land before the day, so a view never holds a day row newer than the panel that came with it.
    deps.rows?.apply(envelope.rows);
    deps.onDay(envelope.payload);
  }

  function applyChange(envelope: EnvelopeOf<"change">): void {
    if (requireGreeted() === undefined) return;
    const cursor = cursorNumber(envelope.cursor);
    if (cursor === undefined || phase.phase !== "greeted") return;
    const after = cursorNumber(envelope.after);
    if (after === undefined || phase.phase !== "greeted") return;
    const held = baseline.held;
    // A cursor already applied, including a duplicate removal, is not applied again.
    if (held !== undefined && cursor <= held.cursorNumber) return;
    // The server stamps `after` per connection, so cursors this connection was never sent are not a gap.
    if (held === undefined || after > held.cursorNumber) {
      clearHeld();
      enterWaiting("connecting", false);
      return;
    }
    let next = held.snapshot;
    if (envelope.day !== undefined) {
      try {
        next = applyDashboardDayPatch(held.snapshot, envelope.day);
      } catch (error) {
        if (error instanceof DashboardClientError && error.kind === "protocol") {
          clearHeld();
          enterWaiting("connecting", false);
          return;
        }
        throw error;
      }
    }
    const authority = baseline.authority;
    baseline = {
      ...(authority === undefined ? {} : { authority }),
      held: { snapshot: next, cursorNumber: cursor, cursorId: envelope.cursor },
    };
    deps.rows?.apply(envelope.rows);
    if (envelope.day !== undefined) deps.onDay(next);
  }

  function handleEnvelope(envelope: DashboardStreamEnvelope): void {
    switch (envelope.type) {
      case "hello":
        applyHello(envelope);
        return;
      case "health":
        applyHealth(envelope);
        return;
      case "reset-required":
        if (requireGreeted() === undefined) return;
        clearHeld();
        enterWaiting("connecting", false);
        return;
      case "notification-publication":
        applyPublication(envelope);
        return;
      case "snapshot":
        applySnapshot(envelope);
        return;
      case "change":
        applyChange(envelope);
        return;
      default: {
        const unexpected: never = envelope;
        throw protocolError(`unhandled stream envelope ${JSON.stringify(unexpected)}`);
      }
    }
  }

  enter(phase, { state: "connecting" });
  openStream(false);
  function select(value: string | undefined): void {
    const next = runOf(value);
    if (next === run || phase.phase === "stopped") return;
    run = next;
    deps.rows?.open(run);
    // A waiting subscription opens with the new topics; an open one reopens at once, resuming from the held cursor.
    if (phase.phase !== "waiting") openStream(true);
  }

  return Object.freeze({ select, close: (): void => stop() });
}
