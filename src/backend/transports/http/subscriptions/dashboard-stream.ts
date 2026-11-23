// A resumed stream replays only a retained cursor range; otherwise reset requires a new snapshot.
import { setImmediate as yieldTurn } from "node:timers/promises";
import { z } from "zod";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
  type NotificationPublicationWire,
} from "../../../../models/dashboard/subscription.js";
import type { RunQueueProjection, RunQueueProjectionChange } from "../../../runs/projections/run-queue-projection.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import type { NotificationInbox, NotificationPublication } from "../../../runs/notifications/inbox.js";
import type { BackfillGapNotifier } from "../../../runs/notifications/backfill-gap.js";

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;

export interface DashboardStreamConnection {
  /** Envelopes to deliver immediately, in order, before any live envelope. */
  readonly initial: readonly DashboardStreamEnvelope[];
  // Only one next call may be outstanding; concurrent reads refuse rather than aliasing envelopes.
  next(): Promise<DashboardStreamEnvelope | undefined>;
  /** Envelopes queued and not yet handed out — bounded by the hub's `maxPending`. */
  readonly pending: number;
  close(): void;
}

/** The projection methods the hub reads. A test supplies a script; production passes `RunQueueProjection`. */
interface DashboardStreamProjection {
  onChange(listener: (change: RunQueueProjectionChange) => void): () => void;
  health(): { readonly state: "live" | "degraded" };
  buildDashboardDayWire(day: string): ReturnType<RunQueueProjection["buildDashboardDayWire"]>;
  generation(): number;
  cursor(): string;
  descriptorSetHash(): string;
}

export interface DashboardStreamHubDeps {
  readonly projection: DashboardStreamProjection;
  readonly notificationPublications?: {
    readonly subscribe: NotificationInbox["onPublication"];
    readonly project: (publication: NotificationPublication) => NotificationPublicationWire;
  };
  readonly backfillGaps: Pick<BackfillGapNotifier, "detected">;
  /** Retained envelope count for cursor resume. */
  readonly retention?: number;
  /** Per-subscriber pending bound before a loud reset. */
  readonly maxPending?: number;
}

type PendingEnvelope = DashboardStreamEnvelope | (() => Promise<DashboardStreamEnvelope | undefined>);

/** One subscriber's delivery phase. A waiter exists only on an empty open queue. */
type SubscriberQueue =
  | {
      readonly state: "open";
      readonly queue: readonly PendingEnvelope[];
      readonly waiter?: (envelope: PendingEnvelope | undefined) => void;
    }
  | { readonly state: "reset-pending"; readonly reason: "cursor-expired" }
  | { readonly state: "closed" };

interface Subscriber {
  readonly day: string;
  phase: SubscriberQueue;
}

// A count-bearing snapshot marker invalidates the held payload and requires a fresh snapshot on resume.
type RetainedEntry =
  | { readonly cursorNumber: number; readonly generation: number; readonly kind: "patch"; readonly day: string; readonly envelope: DashboardStreamEnvelope }
  | { readonly cursorNumber: number; readonly generation: number; readonly kind: "snapshot" };

function cursorNumber(cursor: string): number | undefined {
  const match = CURSOR_PATTERN.exec(cursor);
  return match === null ? undefined : Number(match[1]);
}

export class DashboardStreamHub {
  readonly #projection: DashboardStreamProjection;
  readonly #retention: number;
  readonly #maxPending: number;
  readonly #backfillGaps: Pick<BackfillGapNotifier, "detected">;
  readonly #subscribers = new Set<Subscriber>();
  #retained: RetainedEntry[] = [];
  #disposeProjection: () => void;
  #disposePublications?: () => void;
  #sourcesDisposed = false;
  #snapshotTurn = Promise.resolve();

  constructor(deps: DashboardStreamHubDeps) {
    this.#projection = deps.projection;
    this.#retention = z.number().int().positive().parse(deps.retention ?? 256);
    this.#maxPending = z.number().int().positive().parse(deps.maxPending ?? 64);
    this.#backfillGaps = deps.backfillGaps;
    this.#disposeProjection = deps.projection.onChange((change) => this.#onProjectionChange(change));
    const publications = deps.notificationPublications;
    this.#disposePublications = publications?.subscribe(publication => {
      if (publication.notification.actorId !== LOCAL_OPERATOR_ACTOR_ID) return;
      if (this.#subscribers.size === 0) return;
      const wire = publications.project(publication);
      if (wire.sourceId !== publication.sourceId || wire.actorId !== publication.notification.actorId
        || wire.notification.notificationId !== publication.notification.notificationId) throw new Error("NOTIFICATION_PUBLICATION_IDENTITY_MISMATCH");
      for (const subscriber of this.#subscribers) this.#push(subscriber, DashboardStreamEnvelopeSchema.parse({
        type: "notification-publication", day: subscriber.day, descriptorHash: this.#projection.descriptorSetHash(),
        projectionGeneration: this.#projection.generation(), publication: wire,
      }));
    });
  }

  close(): void {
    this.#disposeProjection();
    this.#disposePublications?.();
    this.#sourcesDisposed = true;
    for (const subscriber of this.#subscribers) this.#closeSubscriber(subscriber);
    this.#subscribers.clear();
  }

  get subscriptionsClosed(): boolean {
    return this.#sourcesDisposed && this.#subscribers.size === 0;
  }

  /** Live connections — a diagnostic for tests and the doctor, never a routing input. */
  subscriberCount(): number {
    return this.#subscribers.size;
  }

  #closeSubscriber(subscriber: Subscriber): void {
    const waiter = subscriber.phase.state === "open" ? subscriber.phase.waiter : undefined;
    subscriber.phase = { state: "closed" };
    waiter?.(undefined);
  }

  #pending(subscriber: Subscriber): number {
    if (subscriber.phase.state === "open") return subscriber.phase.queue.length;
    if (subscriber.phase.state === "reset-pending") return 1;
    return 0;
  }

  #hello(input: Readonly<{ generation: number; cursor: string; descriptorHash: string }>): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "hello",
      wireVersion: 1,
      descriptorHash: input.descriptorHash,
      projectionGeneration: input.generation,
      cursor: input.cursor,
    });
  }

  #snapshot(payload: ReturnType<DashboardStreamProjection["buildDashboardDayWire"]>): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "snapshot",
      topic: "dashboard-day",
      cursor: payload.snapshotCursor,
      payload,
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

      this.#retain({ cursorNumber: cursor, generation: this.#projection.generation(), kind: "snapshot" });
      const generation = this.#projection.generation();
      const byDay = new Map<string, PendingEnvelope>();
      for (const subscriber of this.#subscribers) {
        const { day } = subscriber;
        let envelope = byDay.get(day);
        if (envelope === undefined) {
          const build = () => this.#snapshot(this.#projection.buildDashboardDayWire(day));
          if (change.onDemand) {
            let materialized: Promise<DashboardStreamEnvelope | undefined> | undefined;
            envelope = () => {
              if (materialized === undefined) {
                this.#snapshotTurn = this.#snapshotTurn.then(() => yieldTurn());
                materialized = this.#snapshotTurn.then(() => {
                  if (this.#sourcesDisposed) return undefined;
                  if (generation === this.#projection.generation()) return build();
                  return DashboardStreamEnvelopeSchema.parse({ type: "reset-required", reason: "generation-changed", cursor: this.#projection.cursor() });
                });
              }
              return materialized;
            };
          } else envelope = build();
          byDay.set(day, envelope);
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

  #push(subscriber: Subscriber, envelope: PendingEnvelope): void {
    const phase = subscriber.phase;
    switch (phase.state) {
      case "closed":
      case "reset-pending":
        return;
      case "open": {
        const waiter = phase.waiter;
        if (waiter !== undefined) {
          // A consumer is asking right now; the queue is empty by construction.
          subscriber.phase = { state: "open", queue: phase.queue };
          waiter(envelope);
          return;
        }
        const queue = [...phase.queue, envelope];
        if (queue.length > this.#maxPending) {
          subscriber.phase = { state: "reset-pending", reason: "cursor-expired" };
          return;
        }
        subscriber.phase = { state: "open", queue };
        return;
      }
      default: {
        const unexpected: never = phase;
        throw new Error(`dashboard stream subscriber phase is not a known state: ${JSON.stringify(unexpected)}`);
      }
    }
  }

  #read(subscriber: Subscriber): Promise<PendingEnvelope | undefined> {
    const phase = subscriber.phase;
    switch (phase.state) {
      case "closed":
        return Promise.resolve(undefined);
      case "reset-pending":
        // Mint the reset at handout so its cursor names the boundary the client must resnapshot.
        subscriber.phase = { state: "open", queue: [] };
        return Promise.resolve(DashboardStreamEnvelopeSchema.parse({
          type: "reset-required",
          reason: phase.reason,
          cursor: this.#projection.cursor(),
        }));
      case "open": {
        const [queued, ...rest] = phase.queue;
        if (queued !== undefined) {
          subscriber.phase = { state: "open", queue: rest };
          return Promise.resolve(queued);
        }
        return new Promise<PendingEnvelope | undefined>((resolve) => {
          subscriber.phase = { state: "open", queue: [], waiter: resolve };
        });
      }
      default: {
        const unexpected: never = phase;
        return Promise.reject(new Error(`dashboard stream subscriber phase is not a known state: ${JSON.stringify(unexpected)}`));
      }
    }
  }

  async connect(input: Readonly<{
    day: string;
    lastEventId?: string;
    lastProjectionGeneration?: number;
  }>): Promise<DashboardStreamConnection> {
    const day = z.iso.date().parse(input.day);
    const subscriber: Subscriber = { day, phase: { state: "open", queue: [] } };
    const live = this.#projection.health().state === "live";
    const head = {
      generation: this.#projection.generation(),
      cursor: this.#projection.cursor(),
      descriptorHash: this.#projection.descriptorSetHash(),
    };
    let initial: DashboardStreamEnvelope[];
    if (!live) {
      initial = [this.#hello(head)];
    } else {
      const resumeFrom = input.lastEventId === undefined ? undefined : cursorNumber(input.lastEventId);
      const generationMatches = input.lastProjectionGeneration === head.generation;
      const oldest = this.#retained[0];
      const current = cursorNumber(head.cursor);
      const historical = generationMatches && resumeFrom !== undefined && current !== undefined && resumeFrom < current;
      const atHead = generationMatches && resumeFrom !== undefined && resumeFrom === current;
      // Prove that the retained window covers everything after the requested cursor.
      const retainedWindowCovers = historical && oldest !== undefined && resumeFrom >= oldest.cursorNumber - 1
        && this.#retained.every(entry => entry.generation === head.generation);
      const window = atHead ? [] : retainedWindowCovers
        ? this.#retained.filter(entry => entry.cursorNumber > resumeFrom)
        : undefined;

      if (window !== undefined && window.every(entry => entry.kind === "patch")) {
        initial = [this.#hello(head), ...window.filter(entry => entry.day === day).map(entry => entry.envelope)];
      } else {
        if (historical) {
          await this.#backfillGaps.detected({
            kind: "backfill-gap",
            detector: "server-resume",
            reason: window === undefined ? "cursor-expired" : "snapshot-boundary",
            topic: "dashboard-day",
            requestedCursor: input.lastEventId,
            currentCursor: head.cursor,
            projectionGeneration: head.generation,
          });
        }
        const snapshot = this.#projection.buildDashboardDayWire(day);
        initial = [this.#hello({
          generation: snapshot.projectionGeneration,
          cursor: snapshot.snapshotCursor,
          descriptorHash: snapshot.descriptorHash,
        }), this.#snapshot(snapshot)];
      }
    }
    initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: live ? "live" : "degraded" }));

    this.#subscribers.add(subscriber);
    let reading = false;
    const read = async (): Promise<DashboardStreamEnvelope | undefined> => {
      if (reading) throw new Error("dashboard stream connection already has an outstanding next(); one consumer, one demand at a time");
      reading = true;
      try {
        const entry = await this.#read(subscriber);
        if (typeof entry !== "function") return entry;
        const envelope = await entry();
        return this.#subscribers.has(subscriber) ? envelope : undefined;
      } finally { reading = false; }
    };
    const pendingCount = (): number => this.#pending(subscriber);
    return Object.freeze({
      initial: Object.freeze(initial),
      next: read,
      get pending(): number {
        return pendingCount();
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
