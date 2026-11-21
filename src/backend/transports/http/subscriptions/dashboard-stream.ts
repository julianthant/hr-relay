// A resumed stream replays the retained shared changes above its cursor; otherwise it is answered with a snapshot.
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
  /** Advances the projection's sequence for one envelope the hub mints. */
  takeCursor(): string;
  position(): number;
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

type ChangeEnvelope = Extract<DashboardStreamEnvelope, { type: "change" }>;
/** A change before handout: its `after` is the receiving connection's, so it is stamped per subscriber. */
type UnstampedChange = Omit<ChangeEnvelope, "after">;
type Outgoing = Exclude<DashboardStreamEnvelope, ChangeEnvelope> | UnstampedChange;

/** One subscriber's delivery phase. A waiter exists only on an empty open queue. */
type SubscriberQueue =
  | {
      readonly state: "open";
      readonly queue: readonly Outgoing[];
      readonly waiter?: (envelope: DashboardStreamEnvelope | undefined) => void;
    }
  | { readonly state: "reset-pending"; readonly reason: "cursor-expired" }
  | { readonly state: "closed" };

interface Subscriber {
  readonly day: string;
  phase: SubscriberQueue;
  /** Cursor of the last `change` or `snapshot` handed to this connection; the next change's `after`. */
  handedCursor: string;
}

// Shared entries only. A handoff envelope is private to one connection and is never retained,
// so retained cursors have holes. A snapshot marker requires a fresh snapshot on resume.
type RetainedEntry =
  | { readonly cursorNumber: number; readonly kind: "change"; readonly day: string; readonly change: UnstampedChange }
  | { readonly cursorNumber: number; readonly kind: "snapshot" };

type ResumeDecision =
  | { readonly state: "resumable"; readonly presentedCursor: string; readonly replay: readonly RetainedEntry[] }
  | { readonly state: "gap"; readonly reason: "cursor-expired" | "snapshot-boundary" }
  | { readonly state: "fresh" };

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
  /** Cursor of the newest shared entry dropped from the retained window; 0 at the start of a generation. */
  #evictedThrough = 0;
  #disposeProjection: () => void;
  #disposePublications?: () => void;
  #sourcesDisposed = false;

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

  #hello(): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "hello",
      wireVersion: 1,
      descriptorHash: this.#projection.descriptorSetHash(),
      projectionGeneration: this.#projection.generation(),
      cursor: this.#projection.cursor(),
    });
  }

  /** The day frozen at the projection's current cursor, in the turn that took it. */
  #snapshot(day: string): Extract<DashboardStreamEnvelope, { type: "snapshot" }> {
    const payload = this.#projection.buildDashboardDayWire(day);
    const envelope = DashboardStreamEnvelopeSchema.parse({
      type: "snapshot",
      topic: "dashboard-day",
      cursor: payload.snapshotCursor,
      position: this.#projection.position(),
      payload,
    });
    if (envelope.type !== "snapshot") throw new Error("dashboard stream snapshot parsed as another envelope");
    return envelope;
  }

  #onProjectionChange(change: RunQueueProjectionChange): void {
    if (change.kind === "generation") {
      const reset = DashboardStreamEnvelopeSchema.parse({
        type: "reset-required",
        reason: "generation-changed",
        cursor: change.cursor,
      });
      this.#retained = [];
      this.#evictedThrough = 0;
      for (const subscriber of this.#subscribers) this.#push(subscriber, reset);
      return;
    }
    const cursor = cursorNumber(change.cursor);
    if (cursor === undefined) throw new Error(`projection produced a malformed cursor: ${change.cursor}`);
    if (change.kind === "snapshot") {
      this.#retain({ cursorNumber: cursor, kind: "snapshot" });
      const byDay = new Map<string, Extract<DashboardStreamEnvelope, { type: "snapshot" }>>();
      for (const subscriber of this.#subscribers) {
        let envelope = byDay.get(subscriber.day);
        if (envelope === undefined) {
          const built = this.#snapshot(subscriber.day);
          if (built.cursor !== change.cursor) {
            throw new Error(`dashboard stream snapshot was built at ${built.cursor}, not at its change cursor ${change.cursor}`);
          }
          envelope = built;
          byDay.set(subscriber.day, envelope);
        }
        this.#push(subscriber, envelope);
      }
      return;
    }
    const unstamped: UnstampedChange = Object.freeze({
      type: "change",
      topic: "dashboard-day",
      cursor: change.cursor,
      position: change.position,
      day: change.patch,
    });
    this.#retain({ cursorNumber: cursor, kind: "change", day: change.day, change: unstamped });
    for (const subscriber of this.#subscribers) {
      if (subscriber.day === change.day) this.#push(subscriber, unstamped);
    }
  }

  #retain(entry: RetainedEntry): void {
    this.#retained.push(entry);
    while (this.#retained.length > this.#retention) {
      const evicted = this.#retained.shift();
      if (evicted !== undefined) this.#evictedThrough = evicted.cursorNumber;
    }
  }

  /** Stamps a change with this connection's `after` at handout and records what the connection now holds. */
  #handOut(subscriber: Subscriber, outgoing: Outgoing): DashboardStreamEnvelope {
    if (outgoing.type === "change") {
      const envelope = DashboardStreamEnvelopeSchema.parse({ ...outgoing, after: subscriber.handedCursor });
      subscriber.handedCursor = outgoing.cursor;
      return envelope;
    }
    if (outgoing.type === "snapshot") subscriber.handedCursor = outgoing.cursor;
    return outgoing;
  }

  #push(subscriber: Subscriber, envelope: Outgoing): void {
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
          waiter(this.#handOut(subscriber, envelope));
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

  #read(subscriber: Subscriber): Promise<DashboardStreamEnvelope | undefined> {
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
        if (phase.waiter !== undefined) {
          return Promise.reject(new Error("dashboard stream connection already has an outstanding next(); one consumer, one demand at a time"));
        }
        const [queued, ...rest] = phase.queue;
        if (queued !== undefined) {
          subscriber.phase = { state: "open", queue: rest };
          return Promise.resolve(this.#handOut(subscriber, queued));
        }
        return new Promise<DashboardStreamEnvelope | undefined>((resolve) => {
          subscriber.phase = { state: "open", queue: [], waiter: resolve };
        });
      }
      default: {
        const unexpected: never = phase;
        return Promise.reject(new Error(`dashboard stream subscriber phase is not a known state: ${JSON.stringify(unexpected)}`));
      }
    }
  }

  /** Resumable when the generation matches and every shared entry above the presented cursor is still retained. */
  #resumeDecision(input: Readonly<{ lastEventId?: string; lastProjectionGeneration?: number }>): ResumeDecision {
    if (this.#projection.health().state === "degraded") return { state: "fresh" };
    const presented = input.lastEventId === undefined ? undefined : cursorNumber(input.lastEventId);
    const current = cursorNumber(this.#projection.cursor());
    if (current === undefined) throw new Error(`projection produced a malformed cursor: ${this.#projection.cursor()}`);
    if (input.lastEventId === undefined || presented === undefined || presented > current
      || input.lastProjectionGeneration !== this.#projection.generation()) return { state: "fresh" };
    if (presented < this.#evictedThrough) return { state: "gap", reason: "cursor-expired" };
    const replay = this.#retained.filter((entry) => entry.cursorNumber > presented);
    if (replay.some((entry) => entry.kind === "snapshot")) return { state: "gap", reason: "snapshot-boundary" };
    return { state: "resumable", presentedCursor: input.lastEventId, replay };
  }

  async connect(input: Readonly<{
    day: string;
    lastEventId?: string;
    lastProjectionGeneration?: number;
  }>): Promise<DashboardStreamConnection> {
    const day = z.iso.date().parse(input.day);
    const decision = this.#resumeDecision(input);
    // A cursor that is not resumable cannot become resumable while the gap is recorded.
    if (decision.state === "gap") {
      await this.#backfillGaps.detected({
        kind: "backfill-gap",
        detector: "server-resume",
        reason: decision.reason,
        topic: "dashboard-day",
        requestedCursor: input.lastEventId,
        currentCursor: this.#projection.cursor(),
        projectionGeneration: this.#projection.generation(),
      });
    }
    return this.#admit(day, decision.state === "resumable" ? decision : undefined);
  }

  /** The handoff boundary: one turn of the event loop, so nothing is published between its steps. */
  #admit(day: string, resume: Extract<ResumeDecision, { state: "resumable" }> | undefined): DashboardStreamConnection {
    const subscriber: Subscriber = { day, phase: { state: "open", queue: [] }, handedCursor: this.#projection.cursor() };
    const initial: DashboardStreamEnvelope[] = [this.#hello()];
    if (this.#projection.health().state === "degraded") {
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "degraded" }));
    } else {
      const handoff: Outgoing[] = [];
      if (resume === undefined) {
        // The connection's own cursor; the day is frozen at it.
        this.#projection.takeCursor();
        handoff.push(this.#snapshot(day));
      } else {
        subscriber.handedCursor = resume.presentedCursor;
        for (const entry of resume.replay) {
          if (entry.kind === "change" && entry.day === day) handoff.push(entry.change);
        }
        handoff.push({ type: "change", topic: "dashboard-day", cursor: this.#projection.takeCursor(), position: this.#projection.position() });
      }
      for (const outgoing of handoff) initial.push(this.#handOut(subscriber, outgoing));
      initial.push(DashboardStreamEnvelopeSchema.parse({ type: "health", state: "live" }));
    }

    this.#subscribers.add(subscriber);
    const read = (): Promise<DashboardStreamEnvelope | undefined> => this.#read(subscriber);
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
