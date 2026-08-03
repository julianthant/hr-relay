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
  readonly #subscribers = new Set<Subscriber>();
  #retained: RetainedEntry[] = [];
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
    const cursor = cursorNumber(change.cursor);
    if (cursor === undefined) throw new Error(`projection produced a malformed cursor: ${change.cursor}`);
    if (change.kind === "snapshot") {
      // A count-bearing change; each subscriber gets its own day's fresh
      // snapshot — the protocol allows snapshots at any point in the stream —
      // and the marker is retained so a resume across it re-snapshots too.
      this.#retain({ cursorNumber: cursor, generation: this.#projection.generation(), kind: "snapshot" });
      for (const subscriber of this.#subscribers) this.#push(subscriber, this.#snapshot(subscriber.day));
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
    if (subscriber.listener !== undefined) {
      subscriber.listener(envelope);
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

  connect(input: Readonly<{ day: string; lastEventId?: string }>): DashboardStreamConnection {
    const day = z.iso.date().parse(input.day);
    const subscriber: Subscriber = { day, queue: [], closed: false, resetPending: false };
    const initial: DashboardStreamEnvelope[] = [this.#hello()];

    if (this.#projection.health().state === "degraded") {
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "degraded" }));
    } else {
      const resumeFrom = input.lastEventId === undefined ? undefined : cursorNumber(input.lastEventId);
      const generation = this.#projection.generation();
      const oldest = this.#retained[0];
      // Resumable only when the retained window provably covers everything
      // after the presented cursor, in the current generation.
      const current = cursorNumber(this.#projection.cursor());
      const resumable = resumeFrom !== undefined
        && oldest !== undefined
        && resumeFrom >= oldest.cursorNumber - 1
        && current !== undefined
        && resumeFrom <= current // a cursor from the future is foreign, not resumable
        && this.#retained.every((entry) => entry.generation === generation);
      const window = resumable
        ? this.#retained.filter((entry) => entry.cursorNumber > resumeFrom)
        : undefined;
      if (window !== undefined && window.every((entry) => entry.kind === "patch")) {
        for (const entry of window) {
          if (entry.day === day) initial.push(entry.envelope);
        }
      } else {
        // Not resumable, or a count-bearing snapshot marker sits inside the
        // window: a fresh snapshot supersedes whatever the client held.
        initial.push(this.#snapshot(day));
      }
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "live" }));
    }

    this.#subscribers.add(subscriber);
    return Object.freeze({
      initial: Object.freeze(initial),
      subscribe: (listener: (envelope: DashboardStreamEnvelope) => void): (() => void) => {
        subscriber.listener = listener;
        subscriber.resetPending = false;
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
