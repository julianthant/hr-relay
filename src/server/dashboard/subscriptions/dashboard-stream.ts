/**
 * The resumable dashboard subscription hub (doc 13 §3.5) — transport-neutral;
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
 */
import { z } from "zod";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../../domain/dashboard/subscription.js";
import type { RunQueueProjection, RunQueueProjectionChange } from "../projectors/run-queue-projection.js";

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;

export interface DashboardStreamConnection {
  /** Envelopes to deliver immediately, in order, before any live envelope. */
  readonly initial: readonly DashboardStreamEnvelope[];
  /** Registers the live listener; returns the disposer. */
  subscribe(listener: (envelope: DashboardStreamEnvelope) => void): () => void;
  close(): void;
}

export interface DashboardStreamHubDeps {
  readonly projection: RunQueueProjection;
  /** Retained envelope count for cursor resume. */
  readonly retention?: number;
  /** Per-subscriber pending bound before a loud reset. */
  readonly maxPending?: number;
}

interface Subscriber {
  readonly day: string;
  queue: DashboardStreamEnvelope[];
  listener?: (envelope: DashboardStreamEnvelope) => void;
  closed: boolean;
}

interface RetainedEnvelope {
  readonly cursorNumber: number;
  readonly generation: number;
  readonly day?: string;
  readonly envelope: DashboardStreamEnvelope;
}

function cursorNumber(cursor: string): number | undefined {
  const match = CURSOR_PATTERN.exec(cursor);
  return match === null ? undefined : Number(match[1]);
}

export class DashboardStreamHub {
  readonly #projection: RunQueueProjection;
  readonly #retention: number;
  readonly #maxPending: number;
  readonly #subscribers = new Set<Subscriber>();
  #retained: RetainedEnvelope[] = [];
  #disposeProjection: () => void;

  constructor(deps: DashboardStreamHubDeps) {
    this.#projection = deps.projection;
    this.#retention = z.number().int().positive().parse(deps.retention ?? 256);
    this.#maxPending = z.number().int().positive().parse(deps.maxPending ?? 64);
    this.#disposeProjection = deps.projection.onChange((change) => this.#onProjectionChange(change));
  }

  close(): void {
    this.#disposeProjection();
    for (const subscriber of this.#subscribers) subscriber.closed = true;
    this.#subscribers.clear();
  }

  #hello(): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "hello",
      wireVersion: 1,
      descriptorHash: this.#projection.descriptorSetHash(),
      projectionGeneration: this.#projection.generation(),
      cursor: this.#projection.cursor(),
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
    if (change.kind === "snapshot") {
      // Worker-card state changed; each subscriber gets its own day's fresh
      // snapshot — the protocol allows snapshots at any point in the stream.
      for (const subscriber of this.#subscribers) this.#push(subscriber, this.#snapshot(subscriber.day));
      return;
    }
    const envelope = DashboardStreamEnvelopeSchema.parse({
      type: "patch",
      topic: "dashboard-day",
      cursor: change.cursor,
      payload: change.patch,
    });
    const cursor = cursorNumber(change.cursor);
    if (cursor === undefined) throw new Error(`projection produced a malformed cursor: ${change.cursor}`);
    this.#retained.push({ cursorNumber: cursor, generation: this.#projection.generation(), day: change.day, envelope });
    if (this.#retained.length > this.#retention) this.#retained = this.#retained.slice(-this.#retention);
    for (const subscriber of this.#subscribers) {
      if (subscriber.day === change.day) this.#push(subscriber, envelope);
    }
  }

  #push(subscriber: Subscriber, envelope: DashboardStreamEnvelope): void {
    if (subscriber.closed) return;
    if (subscriber.listener !== undefined) {
      subscriber.listener(envelope);
      return;
    }
    subscriber.queue.push(envelope);
    if (subscriber.queue.length > this.#maxPending) {
      subscriber.queue = [DashboardStreamEnvelopeSchema.parse({
        type: "reset-required",
        reason: "cursor-expired",
        cursor: this.#projection.cursor(),
      })];
    }
  }

  connect(input: Readonly<{ day: string; lastEventId?: string }>): DashboardStreamConnection {
    const day = z.iso.date().parse(input.day);
    const subscriber: Subscriber = { day, queue: [], closed: false };
    const initial: DashboardStreamEnvelope[] = [this.#hello()];

    if (this.#projection.health().state === "degraded") {
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "degraded" }));
    } else {
      const resumeFrom = input.lastEventId === undefined ? undefined : cursorNumber(input.lastEventId);
      const generation = this.#projection.generation();
      const resumable = resumeFrom !== undefined
        && this.#retained.some((entry) => entry.generation === generation && entry.cursorNumber <= resumeFrom)
        && this.#retained.every((entry) => entry.generation === generation);
      if (resumable) {
        for (const entry of this.#retained) {
          if (entry.cursorNumber > resumeFrom && (entry.day === undefined || entry.day === day)) {
            initial.push(entry.envelope);
          }
        }
      } else {
        initial.push(this.#snapshot(day));
      }
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "live" }));
    }

    this.#subscribers.add(subscriber);
    return Object.freeze({
      initial: Object.freeze(initial),
      subscribe: (listener: (envelope: DashboardStreamEnvelope) => void): (() => void) => {
        subscriber.listener = listener;
        for (const envelope of subscriber.queue.splice(0)) listener(envelope);
        return () => {
          delete subscriber.listener;
        };
      },
      close: (): void => {
        subscriber.closed = true;
        this.#subscribers.delete(subscriber);
      },
    });
  }
}

export function createDashboardStreamHub(deps: DashboardStreamHubDeps): DashboardStreamHub {
  return new DashboardStreamHub(deps);
}
