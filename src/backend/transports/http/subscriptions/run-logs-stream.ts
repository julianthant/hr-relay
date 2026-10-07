import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { CompositeCursorSchema, CompositeStreamEnvelopeSchema, type CompositeStreamEnvelope } from "../../../../models/dashboard/run-logs-subscription.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../models/dashboard/subscription.js";
import type { ConfirmedActionEvent } from "../../../../models/events/confirmed-action.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { EventStreamFileCursor } from "../../../storage/events/jsonl-streams.js";
import type { RunLogTail } from "../../../logs/run-log-stream.js";
import type { RunQueueProjection, RunQueueProjectionChange } from "../../../runs/projections/run-queue-projection.js";

type Change = Readonly<{ ordinal: number; kind: "day"; change: RunQueueProjectionChange }>
  | Readonly<{ ordinal: number; kind: "log"; event: ConfirmedActionEvent }>;
type Subscriber = {
  day?: string; runId: string; authority: RunRecord; fingerprint: string; queue: CompositeStreamEnvelope[];
  waiter?: (value: CompositeStreamEnvelope | undefined) => void; closed: boolean; resetPending: boolean; initializing: boolean;
  deliveredOrdinal: number; error?: string;
};

function afterDayCut(message: CompositeStreamEnvelope, dayCut: number): boolean {
  if (message.source !== "dashboard-day") return true;
  const envelope: DashboardStreamEnvelope = message.envelope;
  return "cursor" in envelope && Number(envelope.cursor.slice(3)) > dayCut;
}

export interface CompositeConnection {
  readonly initial: readonly CompositeStreamEnvelope[];
  readonly pending: number;
  next(): Promise<CompositeStreamEnvelope | undefined>;
  close(): void;
}

export interface RunLogsStreamDeps {
  readonly projection: Pick<RunQueueProjection, "onChange" | "buildDashboardDayWire" | "cursor" | "generation">;
  readonly readRun: (runId: string) => Readonly<{ disposition: "live" | "archived"; run: RunRecord }> | undefined;
  readonly store: Readonly<{
    tail(cursors: ReadonlyMap<string, EventStreamFileCursor>): RunLogTail;
    snapshot(authority: RunRecord): Readonly<{ events: readonly ConfirmedActionEvent[]; hasEarlier: boolean; parsedLines: number }>;
  }>;
  readonly retention?: number;
  readonly maxPending?: number;
  readonly generation?: () => string;
}

/** Composite cursor is transport order; pc and worker sequence keep their own meanings. */
export class RunLogsStreamHub {
  readonly #deps: RunLogsStreamDeps;
  readonly #retention: number;
  readonly #maxPending: number;
  readonly #subscribers = new Set<Subscriber>();
  readonly #seen = new Map<string, string>();
  readonly #streamSequence = new Map<string, number>();
  readonly #dispose: () => void;
  #generation: string;
  #ordinal = 0;
  #ring: Change[] = [];
  #cursors: ReadonlyMap<string, EventStreamFileCursor> = new Map();
  #closed = false;
  #degraded = false;
  #recovering = false;
  #lastError: string | undefined;
  #dayError: string | undefined;
  #parsedLines = 0;
  #bytesRead = 0;

  constructor(deps: RunLogsStreamDeps) {
    this.#deps = deps;
    this.#retention = z.number().int().positive().parse(deps.retention ?? 512);
    this.#maxPending = z.number().int().positive().parse(deps.maxPending ?? 64);
    this.#generation = z.uuid().parse(deps.generation?.() ?? randomUUID());
    this.#dispose = deps.projection.onChange(change => this.#dayChange(change));
  }

  stats(): Readonly<{ parsedLines: number; bytesRead: number; ordinal: number; subscribers: number; retained: number;
    degraded: boolean; recovering: boolean; lastError?: string; subscriberError?: Readonly<{ runId: string; error: string }> }> {
    const failedSubscriber = [...this.#subscribers].find(subscriber => subscriber.error !== undefined);
    return { parsedLines: this.#parsedLines, ordinal: this.#ordinal, subscribers: this.#subscribers.size,
      retained: this.#ring.length, degraded: this.#degraded, recovering: this.#recovering,
      bytesRead: this.#bytesRead,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      ...(failedSubscriber?.error === undefined ? {} : { subscriberError: { runId: failedSubscriber.runId,
        error: failedSubscriber.error } }) };
  }

  #healthState(): "live" | "recovering" | "degraded" {
    return this.#degraded ? "degraded" : this.#recovering ? "recovering" : "live";
  }

  #publishHealthTransition(previous: "live" | "recovering" | "degraded"): void {
    const state = this.#healthState();
    if (state === previous) return;
    for (const subscriber of this.#subscribers) {
      if (subscriber.initializing || subscriber.resetPending) continue;
      this.#push(subscriber, this.#control(subscriber, "health", { state }));
    }
  }

  #cursor(subscriber: Subscriber, ordinal = this.#ordinal): string {
    return `mc:${this.#generation}:${subscriber.fingerprint}:${String(ordinal)}`;
  }

  #rotateGeneration(): void {
    const proposed = z.uuid().parse(this.#deps.generation?.() ?? randomUUID());
    this.#generation = proposed === this.#generation ? randomUUID() : proposed;
    this.#ordinal = 0;
    this.#ring = [];
  }

  #control(subscriber: Subscriber, type: "hello" | "reset-required" | "health",
    extra: Readonly<{ reason?: "cursor-expired" | "generation-changed" | "topic-changed" | "overflow"; state?: "live" | "recovering" | "degraded" }> = {},
    ordinal = subscriber.deliveredOrdinal): CompositeStreamEnvelope {
    return CompositeStreamEnvelopeSchema.parse({ source: "control", type,
      transportCursor: this.#cursor(subscriber, ordinal), ...extra });
  }

  #closeSubscriber(subscriber: Subscriber): void {
    subscriber.closed = true;
    subscriber.queue = [];
    const waiter = subscriber.waiter;
    delete subscriber.waiter;
    waiter?.(undefined);
    this.#subscribers.delete(subscriber);
  }

  #push(subscriber: Subscriber, envelope: CompositeStreamEnvelope): void {
    if (subscriber.closed || subscriber.resetPending) return;
    if (subscriber.waiter !== undefined) {
      const waiter = subscriber.waiter;
      delete subscriber.waiter;
      if (envelope.source !== "control") subscriber.deliveredOrdinal = Number(
        envelope.transportCursor.slice(envelope.transportCursor.lastIndexOf(":") + 1));
      waiter(envelope);
      return;
    }
    subscriber.queue.push(envelope);
    if (subscriber.queue.length > this.#maxPending) {
      subscriber.queue = [this.#control(subscriber, "reset-required", { reason: "overflow" })];
      subscriber.resetPending = true;
    }
  }

  #resetSubscriber(subscriber: Subscriber, reason: "generation-changed" | "overflow"): void {
    if (subscriber.closed || subscriber.resetPending) return;
    const reset = this.#control(subscriber, "reset-required", { reason },
      reason === "generation-changed" ? 0 : subscriber.deliveredOrdinal);
    if (subscriber.waiter !== undefined) {
      const waiter = subscriber.waiter;
      delete subscriber.waiter;
      waiter(reset);
      this.#closeSubscriber(subscriber);
      return;
    }
    subscriber.queue = [reset];
    subscriber.resetPending = true;
  }

  #retain(change: Omit<Change, "ordinal">): Change {
    const retained = { ...change, ordinal: ++this.#ordinal } as Change;
    this.#ring.push(retained);
    if (this.#ring.length > this.#retention) this.#ring.shift();
    return retained;
  }

  #dayEnvelope(subscriber: Subscriber, change: Extract<Change, { kind: "day" }>): CompositeStreamEnvelope | undefined {
    if (subscriber.day === undefined) return undefined;
    if (change.change.kind === "generation") return this.#control(subscriber, "reset-required", { reason: "generation-changed" });
    const day = subscriber.day;
    const snapshot = change.change.kind === "snapshot"
      ? this.#deps.projection.buildDashboardDayWire(day) : undefined;
    if (snapshot !== undefined && snapshot.snapshotCursor !== change.change.cursor) {
      return this.#control(subscriber, "reset-required", { reason: "generation-changed" });
    }
    const envelope = change.change.kind === "snapshot"
      ? DashboardStreamEnvelopeSchema.parse({ type: "snapshot", topic: "dashboard-day",
        cursor: change.change.cursor, payload: snapshot })
      : change.change.day === day
        ? DashboardStreamEnvelopeSchema.parse({ type: "patch", topic: "dashboard-day",
          cursor: change.change.cursor, payload: change.change.patch }) : undefined;
    return envelope === undefined ? undefined : CompositeStreamEnvelopeSchema.parse({
      source: "dashboard-day", transportCursor: this.#cursor(subscriber, change.ordinal), envelope });
  }

  #logEnvelope(subscriber: Subscriber, change: Extract<Change, { kind: "log" }>): CompositeStreamEnvelope | undefined {
    if (change.event.action.runId !== subscriber.runId) return undefined;
    if (change.event.traceId !== subscriber.authority.envelope.traceId
      || change.event.action.definitionFingerprint !== subscriber.authority.envelope.contractFingerprint
      || change.event.action.attempt > subscriber.authority.envelope.attempt) {
      throw new Error("run-log-live-owner-mismatch");
    }
    return CompositeStreamEnvelopeSchema.parse({ source: "run-logs", type: "delta", runId: subscriber.runId,
      transportCursor: this.#cursor(subscriber, change.ordinal), event: change.event });
  }

  #deliver(change: Change): void {
    for (const subscriber of this.#subscribers) {
      if (subscriber.resetPending) continue;
      try {
        const message = change.kind === "day" ? this.#dayEnvelope(subscriber, change) : this.#logEnvelope(subscriber, change);
        if (message?.source === "control" && message.type === "reset-required") this.#resetSubscriber(subscriber, "generation-changed");
        else if (message !== undefined) this.#push(subscriber, message);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        subscriber.error = detail;
        this.#resetSubscriber(subscriber, "generation-changed");
      }
    }
  }

  #dayChange(change: RunQueueProjectionChange): void {
    if (this.#closed) return;
    try {
      if (change.kind === "generation") {
        this.#rotateGeneration();
        for (const subscriber of this.#subscribers) this.#resetSubscriber(subscriber, "generation-changed");
        return;
      }
      const retained = this.#retain({ kind: "day", change } as Omit<Change, "ordinal">);
      this.#deliver(retained);
    } catch (error) {
      this.#dayError = error instanceof Error ? error.message : String(error);
      this.#degraded = true;
      this.#lastError = this.#dayError;
      this.#rotateGeneration();
      for (const subscriber of this.#subscribers) this.#resetSubscriber(subscriber, "generation-changed");
    }
  }

  /** Polling is source-of-truth recovery; a process-local wakeup only calls this sooner. */
  poll(): void {
    if (this.#closed) return;
    const previousHealth = this.#healthState();
    try {
      for (const subscriber of this.#subscribers) {
        if (subscriber.resetPending) continue;
        try {
          const current = this.#deps.readRun(subscriber.runId);
          if (current === undefined || current.disposition !== "live") {
            this.#resetSubscriber(subscriber, "generation-changed");
          } else if (current.run.envelope.runId !== subscriber.runId
            || current.run.envelope.traceId !== subscriber.authority.envelope.traceId
            || current.run.envelope.contractFingerprint !== subscriber.authority.envelope.contractFingerprint
            || current.run.envelope.attempt < subscriber.authority.envelope.attempt) {
            this.#resetSubscriber(subscriber, "generation-changed");
          } else {
            subscriber.authority = current.run;
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          subscriber.error = detail;
          this.#resetSubscriber(subscriber, "generation-changed");
        }
      }
      const tail = this.#deps.store.tail(this.#cursors);
      this.#parsedLines += tail.parsedLines;
      this.#bytesRead += tail.bytesRead;
      if (tail.pruned) {
        this.#rotateGeneration();
        this.#seen.clear();
        this.#streamSequence.clear();
        for (const subscriber of this.#subscribers) this.#resetSubscriber(subscriber, "generation-changed");
      }
      for (const event of tail.events) {
        if (event.eventId !== `${event.workerStreamId}/${String(event.sequence)}`) throw new Error("run-log-stream-identity-mismatch");
        const body = JSON.stringify(event);
        const previous = this.#seen.get(event.eventId);
        if (previous !== undefined) {
          if (previous !== body) throw new Error("run-log-event-id-conflict");
          continue;
        }
        const lastSequence = this.#streamSequence.get(event.workerStreamId);
        if (lastSequence !== undefined && event.sequence !== lastSequence + 1) {
          throw new Error(event.sequence > lastSequence ? "run-log-worker-sequence-gap" : "run-log-worker-sequence-regressed");
        }
        if (lastSequence === undefined && this.#streamSequence.size >= 4096) throw new Error("run-log-stream-head-bound-exceeded");
        this.#deliver(this.#retain({ kind: "log", event } as Omit<Change, "ordinal">));
        this.#streamSequence.set(event.workerStreamId, event.sequence);
        this.#seen.set(event.eventId, body);
        if (this.#seen.size > 4096) this.#seen.delete(this.#seen.keys().next().value!);
      }
      this.#cursors = tail.cursors;
      this.#recovering = tail.hasMore;
      this.#degraded = this.#dayError !== undefined;
      this.#lastError = this.#dayError;
      this.#publishHealthTransition(previousHealth);
    } catch (error) {
      this.#degraded = true;
      this.#recovering = false;
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#publishHealthTransition(previousHealth);
    }
  }

  connect(input: Readonly<{ day?: string; runId: string; lastEventId?: string }>): CompositeConnection {
    if (this.#closed) throw new Error("run-logs-hub-closed");
    this.poll();
    if (this.#degraded) throw new Error("run-logs-tail-degraded");
    if (this.#recovering) throw new Error("run-logs-tail-recovering");
    const selectedDay = input.day === undefined ? undefined : z.iso.date().parse(input.day);
    const runId = z.uuid().parse(input.runId);
    const existence = this.#deps.readRun(runId);
    if (existence === undefined || existence.disposition !== "live") throw new Error("run-logs-live-run-unavailable");
    const canonical = selectedDay === undefined ? `run-logs:${runId}` : `dashboard-day:${selectedDay},run-logs:${runId}`;
    const subscriber: Subscriber = { ...(selectedDay === undefined ? {} : { day: selectedDay }), runId, authority: existence.run,
      fingerprint: sha256Hex(canonical), queue: [], closed: false, resetPending: false, initializing: true,
      deliveredOrdinal: this.#ordinal };
    this.#subscribers.add(subscriber);
    try {
      const initial: CompositeStreamEnvelope[] = [];
      const requested = input.lastEventId === undefined ? undefined : CompositeCursorSchema.parse(input.lastEventId).split(":");
      const resumeOrdinal = requested === undefined ? undefined : Number(requested[3]);
      const exact = requested !== undefined && requested[1] === this.#generation
        && requested[2] === subscriber.fingerprint && resumeOrdinal !== undefined && resumeOrdinal <= this.#ordinal;
      const oldest = this.#ring[0]?.ordinal ?? this.#ordinal + 1;
      const replayable = exact && resumeOrdinal >= oldest - 1
        && this.#ordinal - resumeOrdinal <= this.#maxPending;
      const window = replayable ? this.#ring.filter(entry => entry.ordinal > resumeOrdinal) : [];
      const snapshotNeeded = !replayable || window.some(entry => entry.kind === "day" && entry.change.kind !== "patch");
      const cut = this.#ordinal;
      let initialWatermark = snapshotNeeded ? cut : resumeOrdinal;
      initial.push(this.#control(subscriber, "hello", {}, initialWatermark));
      if (snapshotNeeded) {
        if (requested !== undefined) initial.push(this.#control(subscriber, "reset-required", { reason:
          requested[2] !== subscriber.fingerprint ? "topic-changed"
            : requested[1] !== this.#generation ? "generation-changed" : "cursor-expired" }, cut));
        let dayCut: number | undefined;
        if (selectedDay !== undefined) {
          const daySnapshot = this.#deps.projection.buildDashboardDayWire(selectedDay);
          dayCut = Number(daySnapshot.snapshotCursor.slice(3));
          initial.push(CompositeStreamEnvelopeSchema.parse({
            source: "dashboard-day", transportCursor: this.#cursor(subscriber, cut),
            envelope: DashboardStreamEnvelopeSchema.parse({ type: "snapshot", topic: "dashboard-day",
              cursor: daySnapshot.snapshotCursor, payload: daySnapshot }),
          }));
        }
        const snapshot = this.#deps.store.snapshot(existence.run);
        this.#parsedLines += snapshot.parsedLines;
        if (Buffer.byteLength(JSON.stringify(snapshot.events), "utf8") > 512 * 1024) {
          throw new Error("run-logs-snapshot-payload-bound-exceeded");
        }
        initial.push(CompositeStreamEnvelopeSchema.parse({ source: "run-logs", type: "snapshot", runId,
          transportCursor: this.#cursor(subscriber, cut), snapshot: { runId,
            events: snapshot.events, hasEarlier: snapshot.hasEarlier } }));
        this.poll();
        if (this.#degraded) throw new Error("run-logs-tail-degraded");
        if (dayCut !== undefined && !subscriber.resetPending) {
          subscriber.queue = subscriber.queue.filter(message => afterDayCut(message, dayCut));
        }
      } else {
        for (const entry of window) {
          const message = entry.kind === "day" ? this.#dayEnvelope(subscriber, entry) : this.#logEnvelope(subscriber, entry);
          if (message !== undefined) initial.push(message);
        }
        initialWatermark = cut;
      }
      initial.push(this.#control(subscriber, "health", { state: this.#degraded ? "degraded"
        : this.#recovering ? "recovering" : "live" }, initialWatermark));
      subscriber.deliveredOrdinal = initialWatermark;
      subscriber.initializing = false;
      if (initial.length > this.#retention + 4) throw new Error("run-logs-initial-envelope-bound");
      return Object.freeze({
        initial: Object.freeze(initial),
        next: (): Promise<CompositeStreamEnvelope | undefined> => {
          if (subscriber.closed) return Promise.resolve(undefined);
          if (subscriber.waiter !== undefined) return Promise.reject(new Error("run-logs-concurrent-next"));
          const queued = subscriber.queue.shift();
          if (queued !== undefined) {
            if (subscriber.resetPending && queued.source === "control" && queued.type === "reset-required") {
              subscriber.resetPending = false;
              const currentReset = this.#control(subscriber, "reset-required", { reason: queued.reason });
              this.#closeSubscriber(subscriber);
              return Promise.resolve(currentReset);
            }
            if (queued.source === "control" && queued.type === "health") {
              if (queued.state === undefined) throw new Error("run-logs-health-state-missing");
              return Promise.resolve(this.#control(subscriber, "health", { state: queued.state }));
            }
            if (queued.source !== "control") subscriber.deliveredOrdinal = Number(queued.transportCursor.slice(queued.transportCursor.lastIndexOf(":") + 1));
            return Promise.resolve(queued);
          }
          return new Promise(resolve => { subscriber.waiter = resolve; });
        },
        get pending() { return subscriber.queue.length; },
        close: (): void => this.#closeSubscriber(subscriber),
      });
    } catch (error) {
      this.#closeSubscriber(subscriber);
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#dispose();
    for (const subscriber of [...this.#subscribers]) this.#closeSubscriber(subscriber);
  }
}
