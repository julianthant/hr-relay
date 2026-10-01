/**
 * The resumable dashboard subscription hub (ref frontend-backend-integration §3.5) — transport-neutral;
 * the SSE route only serializes what this hub hands it.
 *
 * Protocol per connection: `hello` → `snapshot`* → `patch`* | `reset-required`
 * | `health`. Cursors are the projection's monotonic `pc:<n>` and ride as SSE
 * ids; a resume presents `Last-Event-ID`. Resume rules:
 *
 * - cursor found in the retained ring for the CURRENT generation → hello +
 *   replay of everything after it (no snapshot);
 * - anything else (expired, foreign, cross-generation) → hello + one fresh
 *   snapshot, which supersedes whatever the client held;
 * - a projection generation change (guarded rebuild) broadcasts
 *   `reset-required{generation-changed}` to every live subscriber;
 * - a subscriber whose pending queue exceeds the bound has its queue REPLACED
 *   by `reset-required{cursor-expired}` — bounded loudly, never silently
 *   dropping state-bearing envelopes.
 *
 * Delivery is DEMAND-DRIVEN (2026-09-02): a connection hands out envelopes one
 * `next()` at a time and the hub queues everything a consumer has not yet asked
 * for. That is what makes the bound real end to end — the SSE route's Web
 * Stream `pull()` asks only when the Node adapter has drained the socket, so a
 * slow browser backs up HERE, in the one bounded queue, instead of in an
 * unbounded stream buffer the hub cannot see. A push listener would have
 * bypassed the bound the moment it was registered.
 */
import { z } from "zod";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../../../domain/dashboard/subscription.js";
import type { RunQueueProjection, RunQueueProjectionChange } from "../../../../server/dashboard/projectors/run-queue-projection.js";
import type { BackfillGapNotifier } from "../../../../services/notifications/backfill-gap.js";

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;

export interface DashboardStreamConnection {
  /** Envelopes to deliver immediately, in order, before any live envelope. */
  readonly initial: readonly DashboardStreamEnvelope[];
  /**
   * The next live envelope, in publication order; `undefined` once the
   * connection or the hub has closed. At most one `next()` may be outstanding —
   * a second concurrent call is a consumer bug and throws.
   */
  next(): Promise<DashboardStreamEnvelope | undefined>;
  /** Envelopes queued and not yet handed out — bounded by the hub's `maxPending`. */
  readonly pending: number;
  close(): void;
}

export interface DashboardStreamHubDeps {
  readonly projection: RunQueueProjection;
  readonly backfillGaps: Pick<BackfillGapNotifier, "detected">;
  /** Retained envelope count for cursor resume. */
  readonly retention?: number;
  /** Per-subscriber pending bound before a loud reset. */
  readonly maxPending?: number;
}

interface Subscriber {
  readonly day: string;
  queue: DashboardStreamEnvelope[];
  /** The one outstanding `next()`; present only while the queue is empty. */
  waiter?: (envelope: DashboardStreamEnvelope | undefined) => void;
  closed: boolean;
  /** After a loud overflow reset, nothing else queues until the reset is consumed. */
  resetPending: boolean;
}

/**
 * One entry per projection change. Patch entries carry their envelope for
 * replay; snapshot markers carry none — their presence in a resume window
 * means the client's held payload is count-stale and only a fresh snapshot
 * repairs it.
 */
type RetainedEntry =
  | { readonly cursorNumber: number; readonly generation: number; readonly kind: "patch"; readonly day: string; readonly envelope: DashboardStreamEnvelope }
  | { readonly cursorNumber: number; readonly generation: number; readonly kind: "snapshot" };

function cursorNumber(cursor: string): number | undefined {
  const match = CURSOR_PATTERN.exec(cursor);
  return match === null ? undefined : Number(match[1]);
}

export class DashboardStreamHub {
  readonly #projection: RunQueueProjection;
  readonly #retention: number;
  readonly #maxPending: number;
  readonly #backfillGaps: Pick<BackfillGapNotifier, "detected">;
  readonly #subscribers = new Set<Subscriber>();
  #retained: RetainedEntry[] = [];
  #disposeProjection: () => void;

  constructor(deps: DashboardStreamHubDeps) {
    this.#projection = deps.projection;
    this.#retention = z.number().int().positive().parse(deps.retention ?? 256);
    this.#maxPending = z.number().int().positive().parse(deps.maxPending ?? 64);
    this.#backfillGaps = deps.backfillGaps;
    this.#disposeProjection = deps.projection.onChange((change) => this.#onProjectionChange(change));
  }

  close(): void {
    this.#disposeProjection();
    for (const subscriber of this.#subscribers) this.#closeSubscriber(subscriber);
    this.#subscribers.clear();
  }

  /** Live connections — a diagnostic for tests and the doctor, never a routing input. */
  subscriberCount(): number {
    return this.#subscribers.size;
  }

  #closeSubscriber(subscriber: Subscriber): void {
    subscriber.closed = true;
    subscriber.queue = [];
    const waiter = subscriber.waiter;
    delete subscriber.waiter;
    waiter?.(undefined);
  }

  #hello(input?: Readonly<{ generation: number; cursor: string; descriptorHash: string }>): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "hello",
      wireVersion: 1,
      descriptorHash: input?.descriptorHash ?? this.#projection.descriptorSetHash(),
      projectionGeneration: input?.generation ?? this.#projection.generation(),
      cursor: input?.cursor ?? this.#projection.cursor(),
    });
  }

  #snapshot(day: string): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "snapshot",
      topic: "dashboard-day",
      cursor: this.#projection.cursor(),
      payload: this.#projection.buildDashboardDayWire(day),
    });
  }

  #onProjectionChange(change: RunQueueProjectionChange): void {
    if (change.kind === "generation") {
      const reset = DashboardStreamEnvelopeSchema.parse({
        type: "reset-required",
        reason: "generation-changed",
        cursor: change.cursor,
      });
      this.#retained = [];
      for (const subscriber of this.#subscribers) this.#push(subscriber, reset);
      return;
    }
    const cursor = cursorNumber(change.cursor);
    if (cursor === undefined) throw new Error(`projection produced a malformed cursor: ${change.cursor}`);
    if (change.kind === "snapshot") {
      // A count-bearing change; each subscriber gets its own day's fresh
      // snapshot — the protocol allows snapshots at any point in the stream —
      // and the marker is retained so a resume across it re-snapshots too.
      // One immutable envelope per distinct day at this cursor: N subscribers
      // on the same day share it rather than rebuilding the day N times.
      this.#retain({ cursorNumber: cursor, generation: this.#projection.generation(), kind: "snapshot" });
      const byDay = new Map<string, DashboardStreamEnvelope>();
      for (const subscriber of this.#subscribers) {
        let envelope = byDay.get(subscriber.day);
        if (envelope === undefined) {
          envelope = this.#snapshot(subscriber.day);
          byDay.set(subscriber.day, envelope);
        }
        this.#push(subscriber, envelope);
      }
      return;
    }
    const envelope = DashboardStreamEnvelopeSchema.parse({
      type: "patch",
      topic: "dashboard-day",
      cursor: change.cursor,
      payload: change.patch,
    });
    this.#retain({
      cursorNumber: cursor,
      generation: this.#projection.generation(),
      kind: "patch",
      day: change.day,
      envelope,
    });
    for (const subscriber of this.#subscribers) {
      if (subscriber.day === change.day) this.#push(subscriber, envelope);
    }
  }

  #retain(entry: RetainedEntry): void {
    this.#retained.push(entry);
    if (this.#retained.length > this.#retention) this.#retained = this.#retained.slice(-this.#retention);
  }

  #push(subscriber: Subscriber, envelope: DashboardStreamEnvelope): void {
    if (subscriber.closed) return;
    const waiter = subscriber.waiter;
    if (waiter !== undefined) {
      // A consumer is asking right now; the queue is empty by construction.
      delete subscriber.waiter;
      waiter(envelope);
      return;
    }
    if (subscriber.resetPending) return; // the queued reset already supersedes everything after it
    subscriber.queue.push(envelope);
    if (subscriber.queue.length > this.#maxPending) {
      subscriber.queue = [DashboardStreamEnvelopeSchema.parse({
        type: "reset-required",
        reason: "cursor-expired",
        cursor: this.#projection.cursor(),
      })];
      subscriber.resetPending = true;
    }
  }

  async connect(input: Readonly<{
    day: string;
    lastEventId?: string;
    lastProjectionGeneration?: number;
  }>): Promise<DashboardStreamConnection> {
    const day = z.iso.date().parse(input.day);
    const subscriber: Subscriber = { day, queue: [], closed: false, resetPending: false };
    const live = this.#projection.health().state !== "degraded";
    const capturedSnapshot = live ? this.#projection.buildDashboardDayWire(day) : undefined;
    const capturedGeneration = capturedSnapshot?.projectionGeneration ?? this.#projection.generation();
    const capturedCursor = capturedSnapshot?.snapshotCursor ?? this.#projection.cursor();
    const initial: DashboardStreamEnvelope[] = [this.#hello({
      generation: capturedGeneration,
      cursor: capturedCursor,
      descriptorHash: capturedSnapshot?.descriptorHash ?? this.#projection.descriptorSetHash(),
    })];

    if (!live) {
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "degraded" }));
    } else {
      const resumeFrom = input.lastEventId === undefined ? undefined : cursorNumber(input.lastEventId);
      const generation = capturedGeneration;
      const generationMatches = input.lastProjectionGeneration !== undefined
        && input.lastProjectionGeneration === generation;
      const oldest = this.#retained[0];
      // Resumable only when the retained window provably covers everything
      // after the presented cursor, in the current generation.
      const current = cursorNumber(capturedCursor);
      const atHead = generationMatches
        && resumeFrom !== undefined && current !== undefined && resumeFrom === current;
      const retainedWindowCovers = generationMatches
        && resumeFrom !== undefined
        && oldest !== undefined
        && resumeFrom >= oldest.cursorNumber - 1
        && current !== undefined
        && resumeFrom < current
        && this.#retained.every((entry) => entry.generation === generation);
      const resumable = atHead || retainedWindowCovers;
      const window = resumable
        ? this.#retained.filter((entry) => entry.cursorNumber > resumeFrom)
        : undefined;
      if (window !== undefined && window.every((entry) => entry.kind === "patch")) {
        for (const entry of window) {
          if (entry.day === day) initial.push(entry.envelope);
        }
      } else {
        let handshakeRestarted = false;
        const isHistoricalCursor = generationMatches
          && resumeFrom !== undefined
          && current !== undefined
          && resumeFrom < current;
        if (isHistoricalCursor) {
          await this.#backfillGaps.detected({
            kind: "backfill-gap",
            detector: "server-resume",
            reason: window === undefined ? "cursor-expired" : "snapshot-boundary",
            topic: "dashboard-day",
            requestedCursor: input.lastEventId,
            currentCursor: capturedCursor,
            projectionGeneration: generation,
          });
          const refreshed = this.#projection.buildDashboardDayWire(day);
          initial.splice(0, initial.length,
            this.#hello({
              generation: refreshed.projectionGeneration,
              cursor: refreshed.snapshotCursor,
              descriptorHash: refreshed.descriptorHash,
            }),
            DashboardStreamEnvelopeSchema.parse({
              type: "snapshot",
              topic: "dashboard-day",
              cursor: refreshed.snapshotCursor,
              payload: refreshed,
            }));
          handshakeRestarted = true;
        }
        // Not resumable, or a count-bearing snapshot marker sits inside the
        // window: a fresh snapshot supersedes whatever the client held.
        if (!handshakeRestarted) {
          initial.push(DashboardStreamEnvelopeSchema.parse({
            type: "snapshot",
            topic: "dashboard-day",
            cursor: capturedCursor,
            payload: capturedSnapshot,
          }));
        }
      }
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "live" }));
    }

    this.#subscribers.add(subscriber);
    return Object.freeze({
      initial: Object.freeze(initial),
      next: (): Promise<DashboardStreamEnvelope | undefined> => {
        if (subscriber.closed) return Promise.resolve(undefined);
        if (subscriber.waiter !== undefined) {
          return Promise.reject(new Error("dashboard stream connection already has an outstanding next(); one consumer, one demand at a time"));
        }
        const queued = subscriber.queue.shift();
        if (queued !== undefined) {
          if (queued.type === "reset-required" && subscriber.resetPending) {
            // Consuming the loud reset re-opens the queue: the client will
            // resnapshot on a fresh connection, and this one is about to end.
            // The reset is re-minted at hand-out so its cursor names the head
            // the client is being sent to, not the instant the bound tripped.
            subscriber.resetPending = false;
            return Promise.resolve(DashboardStreamEnvelopeSchema.parse({
              type: "reset-required",
              reason: queued.reason,
              cursor: this.#projection.cursor(),
            }));
          }
          return Promise.resolve(queued);
        }
        return new Promise<DashboardStreamEnvelope | undefined>((resolve) => {
          subscriber.waiter = resolve;
        });
      },
      get pending(): number {
        return subscriber.queue.length;
      },
      close: (): void => {
        this.#closeSubscriber(subscriber);
        this.#subscribers.delete(subscriber);
      },
    });
  }
}

export function createDashboardStreamHub(deps: DashboardStreamHubDeps): DashboardStreamHub {
  return new DashboardStreamHub(deps);
}
