// A resumed stream replays the retained shared changes above its cursor; otherwise it is answered with a snapshot.
// Row values are read per key in envelope order; each connection's outbox hands out in cursor order.
// Publications are retained at their own cursors and replayed on resume, after `health: live`.
import { z } from "zod";
import {
  DashboardStreamEnvelopeSchema,
  StreamRowSchema,
  type DashboardStreamEnvelope,
  type NotificationPublicationWire,
  type RunPanel,
  type StreamRow,
} from "../../../../models/dashboard/subscription.js";
import { ProjectionGenerationSchema, WireErrorSchema } from "../../../../models/dashboard/primitives.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import type { RunQueueProjection, RunQueueProjectionChange } from "../../../runs/projections/run-queue-projection.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID, ProjectionCursorSchema, type RunId } from "../../../../rules/identity/ids.js";
import type { NotificationInbox, NotificationPublication } from "../../../runs/notifications/inbox.js";
import type { NotificationObservationStatus } from "../../../runs/notifications/observation.js";
import type { NotificationTarget } from "../../../../models/notifications/notification-target.js";
import type { NotificationWire } from "../../../../models/dashboard/projection.js";
import type { BackfillGapNotifier } from "../../../runs/notifications/backfill-gap.js";
import { failureStatus } from "../routes/failure-status.js";
import { systemClock, type Clock } from "../../../../rules/time/clock.js";

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;
const ROW_READ_DEADLINE_MS = 5_000;
const ROW_RETRY_MS = 5_000;

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
  cursor(): ChangeEnvelope["cursor"];
  /** Advances the projection's sequence for one envelope the hub mints. */
  takeCursor(): ChangeEnvelope["cursor"];
  position(): number;
  descriptorSetHash(): string;
}

/** Reads one run's panel by the queries its routes serve; a refusal throws as the route's would. */
export interface DashboardStreamRunPanels {
  read(runId: RunId, signal: AbortSignal): Promise<Extract<RunPanel, { state: "available" }>>;
}

export interface DashboardStreamHubDeps {
  readonly projection: DashboardStreamProjection;
  readonly notificationPublications?: {
    readonly subscribe: NotificationInbox["onPublication"];
    /** The arrival's wire and its row as `GET /notifications` lists it, read in one snapshot. */
    readonly project: (publication: NotificationPublication) => { readonly publication: NotificationPublicationWire; readonly listed: NotificationWire };
    /** What `GET /notifications/{id}/target` answers for the publication's row; a throw is sent as a refusal. */
    readonly target: (publication: NotificationPublication) => NotificationTarget;
  };
  /** The observer status `GET /notifications/status` serves; its row rides every snapshot and handoff, and a change when it moves. */
  readonly notificationStatus?: {
    readonly read: () => NotificationObservationStatus;
    readonly onChange: (listener: () => void) => () => void;
  };
  readonly backfillGaps: Pick<BackfillGapNotifier, "detected">;
  /** Serves `run:<id>` topics; a hub without it refuses them. */
  readonly runPanels?: DashboardStreamRunPanels;
  /** Retained envelope count for cursor resume. */
  readonly retention?: number;
  /** Per-subscriber pending bound before a loud reset. */
  readonly maxPending?: number;
  /** Runs `task` after `delayMs` and answers its cancel; row read deadlines and retries use it. */
  readonly schedule?: (delayMs: number, task: () => void) => () => void;
  /** Its monotonic time decides a read that settles past its deadline, even before the deadline timer runs. */
  readonly clock?: Pick<Clock, "monotonicMs">;
}

type ProjectionCursor = z.infer<typeof ProjectionCursorSchema>;
type ChangeEnvelope = Extract<DashboardStreamEnvelope, { type: "change" }>;
type SnapshotEnvelope = Extract<DashboardStreamEnvelope, { type: "snapshot" }>;
type RunPanelRow = Extract<StreamRow, { model: "run-panel" }>;
type NotificationStatusRow = Extract<StreamRow, { model: "notification-status" }>;
type PublicationEnvelope = Extract<DashboardStreamEnvelope, { type: "notification-publication" }>;
/** A publication before handout; its `day` is the receiving connection's. */
type UnstampedPublication = Omit<PublicationEnvelope, "day">;
/** A change before handout: its `after` is the receiving connection's and its rows are read per connection. */
type UnstampedChange = Omit<ChangeEnvelope, "after" | "rows">;
/** The day frozen at its cursor, with no rows; one object shared by every connection on that day. */
type FrozenSnapshot = Readonly<SnapshotEnvelope>;

/** One read of one row key for one envelope, shared by every connection owed it. */
interface RowRead {
  readonly key: RunId;
  readonly owners: Set<Subscriber>;
  readonly controller: AbortController;
  /** Set once settled; absent only for a read aborted because nobody was owed it. */
  row?: RunPanelRow;
  settled: boolean;
  /** Settled as a timeout or a thrown read, so the key is read again while still owed. */
  retry: boolean;
}

/** `rows` were read when the entry was made; `reads` are still being read. */
type OutboxEntry =
  | { readonly kind: "ready"; readonly envelope: Exclude<DashboardStreamEnvelope, ChangeEnvelope | SnapshotEnvelope> }
  | { readonly kind: "change"; readonly change: UnstampedChange; readonly rows: readonly StreamRow[]; readonly reads: readonly RowRead[] }
  | { readonly kind: "snapshot"; readonly snapshot: FrozenSnapshot; readonly rows: readonly StreamRow[]; readonly reads: readonly RowRead[] };

/** One subscriber's delivery phase. A waiter exists only while the outbox head is absent or still reading. */
type SubscriberQueue =
  | {
      readonly state: "open";
      readonly outbox: readonly OutboxEntry[];
      readonly waiter?: (envelope: DashboardStreamEnvelope | undefined) => void;
    }
  | { readonly state: "reset-pending"; readonly reason: "cursor-expired" }
  | { readonly state: "closed" };

interface Subscriber {
  readonly day: string;
  readonly run: RunId | undefined;
  phase: SubscriberQueue;
  /** Cursor of the last `change` or `snapshot` handed to this connection; the next change's `after`. */
  handedCursor: ProjectionCursor;
}

// Shared entries only. A handoff envelope is private to one connection and a rows-only change is
// never replayed, so retained cursors have holes. A snapshot marker requires a fresh snapshot on resume.
type RetainedEntry =
  | { readonly cursorNumber: number; readonly kind: "change"; readonly day: string; readonly change: UnstampedChange }
  | { readonly cursorNumber: number; readonly kind: "publication"; readonly publication: UnstampedPublication }
  | { readonly cursorNumber: number; readonly kind: "snapshot" };

type ResumeDecision =
  | { readonly state: "resumable"; readonly presentedCursor: ProjectionCursor; readonly replay: readonly RetainedEntry[] }
  | { readonly state: "gap"; readonly reason: "cursor-expired" | "snapshot-boundary" }
  | { readonly state: "fresh" };

function cursorNumber(cursor: string): number | undefined {
  const match = CURSOR_PATTERN.exec(cursor);
  return match === null ? undefined : Number(match[1]);
}

function defaultSchedule(delayMs: number, task: () => void): () => void {
  const timer = setTimeout(task, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}

function entryReady(entry: OutboxEntry): boolean {
  return entry.kind === "ready" || entry.reads.every(read => read.settled);
}

/** The refusal its route would have answered; a server failure is read again, a refusal is a value.
 * An error the route's mapper cannot describe is a failed read. */
function refusedRow(key: RunId, error: unknown): { row: RunPanelRow; retry: boolean } {
  try {
    const { status, body } = failureStatus(error);
    const wire = WireErrorSchema.parse({ state: "error", code: body.code, message: body.message, retryable: body.retryable });
    return { row: { model: "run-panel", key, value: { state: "refused", error: wire } }, retry: status >= 500 };
  } catch {
    return { row: failedRow(key), retry: true };
  }
}

const readFailed = (): z.infer<typeof WireErrorSchema> => WireErrorSchema.parse({
  state: "error", code: "DASHBOARD_READ_FAILED", message: ERROR_CATALOG.DASHBOARD_READ_FAILED.text, retryable: true,
});

function failedRow(key: RunId): RunPanelRow {
  return { model: "run-panel", key, value: { state: "refused", error: readFailed() } };
}

function publicationFor(publication: UnstampedPublication, day: string): PublicationEnvelope {
  const envelope = DashboardStreamEnvelopeSchema.parse({ ...publication, day });
  if (envelope.type !== "notification-publication") throw new Error("dashboard stream publication parsed as another envelope");
  return envelope;
}

export class DashboardStreamHub {
  readonly #projection: DashboardStreamProjection;
  readonly #retention: number;
  readonly #maxPending: number;
  readonly #backfillGaps: Pick<BackfillGapNotifier, "detected">;
  readonly #runPanels: DashboardStreamRunPanels | undefined;
  readonly #schedule: (delayMs: number, task: () => void) => () => void;
  readonly #clock: Pick<Clock, "monotonicMs">;
  readonly #subscribers = new Set<Subscriber>();
  /** The newest read of each key; the next read of that key starts once it has settled. */
  readonly #keyTails = new Map<RunId, Promise<void>>();
  readonly #retries = new Map<RunId, () => void>();
  readonly #notificationStatus: DashboardStreamHubDeps["notificationStatus"];
  /** Connections whose last status row was unavailable; each is owed the next good one. */
  readonly #statusOwed = new Set<Subscriber>();
  /** Cancels the pending re-read, armed while any connection is owed a good status. */
  #statusRetry: (() => void) | undefined;
  #disposeStatus?: () => void;
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
    this.#runPanels = deps.runPanels;
    this.#schedule = deps.schedule ?? defaultSchedule;
    this.#clock = deps.clock ?? systemClock;
    this.#notificationStatus = deps.notificationStatus;
    this.#disposeProjection = deps.projection.onChange((change) => this.#onProjectionChange(change));
    const publications = deps.notificationPublications;
    this.#disposePublications = publications?.subscribe(publication => {
      if (publication.notification.actorId !== LOCAL_OPERATOR_ACTOR_ID) return;
      const { publication: wire, listed } = publications.project(publication);
      if (wire.sourceId !== publication.sourceId || wire.actorId !== publication.notification.actorId
        || wire.notification.notificationId !== publication.notification.notificationId) throw new Error("NOTIFICATION_PUBLICATION_IDENTITY_MISMATCH");
      let target: NotificationTarget;
      try {
        target = publications.target(publication);
      } catch {
        target = { kind: "refused", reason: "target-unavailable" };
      }
      this.#publish(wire, listed, target);
    });
    this.#disposeStatus = deps.notificationStatus?.onChange(() => this.#publishStatus());
  }

  /** A publication takes its own cursor and is retained, so a resume above an earlier cursor replays it. */
  #publish(wire: NotificationPublicationWire, listed: NotificationWire, target: NotificationTarget): void {
    const cursor = this.#projection.takeCursor();
    const cursorValue = cursorNumber(cursor);
    if (cursorValue === undefined) throw new Error(`projection produced a malformed cursor: ${cursor}`);
    const unstamped: UnstampedPublication = Object.freeze({
      type: "notification-publication", cursor, descriptorHash: FingerprintSchema.parse(this.#projection.descriptorSetHash()),
      projectionGeneration: ProjectionGenerationSchema.parse(this.#projection.generation()), publication: wire, listed, target,
    });
    this.#retain({ cursorNumber: cursorValue, kind: "publication", publication: unstamped });
    for (const subscriber of this.#subscribers) this.#push(subscriber, { kind: "ready", envelope: publicationFor(unstamped, subscriber.day) });
  }

  /** The status row as the route would answer it now, for these connections; a read that throws is sent unavailable.
   * A good read is also sent, as a rows-only change, to every other open connection still owed one. */
  #statusRows(recipients: readonly Subscriber[]): readonly StreamRow[] {
    const source = this.#notificationStatus;
    if (source === undefined || recipients.length === 0) return [];
    let row: NotificationStatusRow;
    try {
      const parsed = StreamRowSchema.parse({ model: "notification-status", key: LOCAL_OPERATOR_ACTOR_ID, value: { state: "available", value: source.read() } });
      if (parsed.model !== "notification-status") throw new Error("notification status parsed as another row");
      row = parsed;
    } catch {
      row = { model: "notification-status", key: LOCAL_OPERATOR_ACTOR_ID, value: { state: "unavailable", error: readFailed() } };
    }
    if (row.value.state === "unavailable") {
      for (const recipient of recipients) this.#statusOwed.add(recipient);
    } else {
      for (const recipient of recipients) this.#statusOwed.delete(recipient);
      const behind = [...this.#statusOwed].filter(subscriber => subscriber.phase.state === "open" && this.#subscribers.has(subscriber));
      this.#statusOwed.clear();
      if (behind.length > 0) {
        const change = this.#unstamped({ cursor: this.#projection.takeCursor(), position: this.#projection.position() });
        for (const subscriber of behind) this.#push(subscriber, { kind: "change", change, rows: [row], reads: [] });
      }
    }
    this.#armStatusRetry();
    return [row];
  }

  /** Keeps one re-read pending while any connection is owed a good status, and none otherwise. */
  #armStatusRetry(): void {
    if (this.#statusOwed.size === 0) {
      this.#statusRetry?.();
      this.#statusRetry = undefined;
      return;
    }
    if (this.#statusRetry !== undefined) return;
    let live = true;
    const cancel = this.#schedule(ROW_RETRY_MS, () => {
      if (!live) return;
      live = false;
      this.#statusRetry = undefined;
      this.#publishStatus();
    });
    this.#statusRetry = () => { live = false; cancel(); };
  }

  /** A rows-only change carrying the status row, at its own cursor, to every open connection. Never retained. */
  #publishStatus(): void {
    const owed = [...this.#subscribers].filter(subscriber => subscriber.phase.state === "open");
    for (const subscriber of this.#statusOwed) if (!owed.includes(subscriber)) this.#statusOwed.delete(subscriber);
    if (owed.length === 0) {
      this.#armStatusRetry();
      return;
    }
    const rows = this.#statusRows(owed);
    const change = this.#unstamped({ cursor: this.#projection.takeCursor(), position: this.#projection.position() });
    for (const subscriber of owed) this.#push(subscriber, { kind: "change", change, rows, reads: [] });
  }

  close(): void {
    this.#disposeProjection();
    this.#disposePublications?.();
    this.#disposeStatus?.();
    this.#statusOwed.clear();
    this.#armStatusRetry();
    this.#sourcesDisposed = true;
    for (const subscriber of this.#subscribers) this.#closeSubscriber(subscriber);
    this.#subscribers.clear();
    for (const cancel of this.#retries.values()) cancel();
    this.#retries.clear();
  }

  get subscriptionsClosed(): boolean {
    return this.#sourcesDisposed && this.#subscribers.size === 0;
  }

  /** Live connections — a diagnostic for tests and the doctor, never a routing input. */
  subscriberCount(): number {
    return this.#subscribers.size;
  }

  #closeSubscriber(subscriber: Subscriber): void {
    const phase = subscriber.phase;
    subscriber.phase = { state: "closed" };
    if (phase.state !== "open") return;
    this.#release(subscriber, phase.outbox);
    phase.waiter?.(undefined);
  }

  #pending(subscriber: Subscriber): number {
    if (subscriber.phase.state === "open") return subscriber.phase.outbox.length;
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

  #health(state: "live" | "degraded"): OutboxEntry {
    const envelope = DashboardStreamEnvelopeSchema.parse({ type: "health", state });
    if (envelope.type !== "health") throw new Error("dashboard stream health parsed as another envelope");
    return { kind: "ready", envelope };
  }

  /** The day frozen at the projection's current cursor, in the turn that took it. Rows are read later. */
  #snapshot(day: string): FrozenSnapshot {
    const payload = this.#projection.buildDashboardDayWire(day);
    const envelope = DashboardStreamEnvelopeSchema.parse({
      type: "snapshot",
      topic: "dashboard-day",
      cursor: payload.snapshotCursor,
      position: this.#projection.position(),
      payload,
      rows: [],
    });
    if (envelope.type !== "snapshot") throw new Error("dashboard stream snapshot parsed as another envelope");
    return Object.freeze(envelope);
  }

  #unstamped(input: Omit<UnstampedChange, "type" | "topic">): UnstampedChange {
    const envelope = DashboardStreamEnvelopeSchema.parse({ type: "change", topic: "dashboard-day", after: input.cursor, ...input, rows: [] });
    if (envelope.type !== "change") throw new Error("dashboard stream change parsed as another envelope");
    const { after: _after, rows: _rows, ...change } = envelope;
    return Object.freeze(change);
  }

  #onProjectionChange(change: RunQueueProjectionChange): void {
    if (change.kind === "generation") {
      const reset = DashboardStreamEnvelopeSchema.parse({
        type: "reset-required",
        reason: "generation-changed",
        cursor: change.cursor,
      });
      if (reset.type !== "reset-required") throw new Error("dashboard stream reset parsed as another envelope");
      this.#retained = [];
      this.#evictedThrough = 0;
      for (const cancel of this.#retries.values()) cancel();
      this.#retries.clear();
      // Nothing frozen under the old generation is handed out after the reset.
      for (const subscriber of this.#subscribers) {
        const phase = subscriber.phase;
        if (phase.state !== "open") continue;
        this.#release(subscriber, phase.outbox);
        subscriber.phase = { state: "open", outbox: [], ...(phase.waiter === undefined ? {} : { waiter: phase.waiter }) };
        this.#push(subscriber, { kind: "ready", envelope: reset });
      }
      return;
    }
    if (change.kind === "runs") {
      this.#publishRows(change.runIds, change.position);
      return;
    }
    const cursor = cursorNumber(change.cursor);
    if (cursor === undefined) throw new Error(`projection produced a malformed cursor: ${change.cursor}`);
    if (change.kind === "snapshot") {
      this.#retain({ cursorNumber: cursor, kind: "snapshot" });
      // Every day is frozen before any read starts, so a failed build leaves no read outside an outbox.
      const byDay = new Map<string, FrozenSnapshot>();
      for (const { day } of this.#subscribers) {
        if (byDay.has(day)) continue;
        const snapshot = this.#snapshot(day);
        if (snapshot.cursor !== change.cursor) {
          throw new Error(`dashboard stream snapshot was built at ${snapshot.cursor}, not at its change cursor ${change.cursor}`);
        }
        byDay.set(day, snapshot);
      }
      const reads = this.#readsFor([...this.#subscribers]);
      const rows = this.#statusRows([...this.#subscribers]);
      for (const subscriber of this.#subscribers) {
        const snapshot = byDay.get(subscriber.day);
        if (snapshot === undefined) throw new Error(`dashboard stream froze no snapshot for ${subscriber.day}`);
        this.#push(subscriber, { kind: "snapshot", snapshot, rows, reads: this.#readOf(reads, subscriber) });
      }
      return;
    }
    const unstamped = this.#unstamped({ cursor: change.cursor, position: change.position, day: change.patch });
    this.#retain({ cursorNumber: cursor, kind: "change", day: change.day, change: unstamped });
    const target = change.patch.target.runId;
    const owed = [...this.#subscribers].filter(subscriber => subscriber.day === change.day || subscriber.run === target);
    const reads = this.#readsFor(owed.filter(subscriber => subscriber.run === target));
    const rowsOnly = owed.some(subscriber => subscriber.day !== change.day)
      ? this.#unstamped({ cursor: change.cursor, position: change.position }) : undefined;
    for (const subscriber of owed) {
      const shared = subscriber.day === change.day ? unstamped : rowsOnly;
      if (shared === undefined) throw new Error("dashboard stream rows-only change was not built for another day's subscriber");
      this.#push(subscriber, { kind: "change", change: shared, rows: [], reads: this.#readOf(reads, subscriber) });
    }
  }

  /** A rows-only change at its own cursor for every connection that has one of these runs open. Never retained. */
  #publishRows(runIds: readonly RunId[], position: number): void {
    const owed = [...this.#subscribers].filter(subscriber => subscriber.phase.state === "open"
      && subscriber.run !== undefined && runIds.includes(subscriber.run));
    if (owed.length === 0) return;
    const change = this.#unstamped({ cursor: this.#projection.takeCursor(), position });
    const reads = this.#readsFor(owed);
    for (const subscriber of owed) this.#push(subscriber, { kind: "change", change, rows: [], reads: this.#readOf(reads, subscriber) });
  }

  /** One read per open run key among these connections, shared by every connection that has it open. */
  #readsFor(subscribers: readonly Subscriber[]): ReadonlyMap<RunId, RowRead> {
    const owners = new Map<RunId, Subscriber[]>();
    for (const subscriber of subscribers) {
      if (subscriber.run === undefined || subscriber.phase.state !== "open") continue;
      const list = owners.get(subscriber.run);
      if (list === undefined) owners.set(subscriber.run, [subscriber]);
      else list.push(subscriber);
    }
    return new Map([...owners].map(([key, list]) => [key, this.#startRead(key, list)]));
  }

  #readOf(reads: ReadonlyMap<RunId, RowRead>, subscriber: Subscriber): readonly RowRead[] {
    const read = subscriber.run === undefined ? undefined : reads.get(subscriber.run);
    return read === undefined ? [] : [read];
  }

  /** Queues a read of `key` behind every earlier read of it; it is cut off at its deadline and aborted when nobody is owed it. */
  #startRead(key: RunId, owners: readonly Subscriber[]): RowRead {
    const runPanels = this.#runPanels;
    if (runPanels === undefined) throw new Error("dashboard stream has no run panel reader for a run topic");
    const read: RowRead = { key, owners: new Set(owners), controller: new AbortController(), settled: false, retry: false };
    let settleOwn: () => void = () => undefined;
    const own = new Promise<void>(resolve => { settleOwn = resolve; });
    const previous = this.#keyTails.get(key);
    // A read that ends before it begins still holds the key's later reads behind its predecessor.
    const tail = previous === undefined ? own : Promise.all([previous, own]).then(() => undefined);
    this.#keyTails.set(key, tail);
    void tail.then(() => { if (this.#keyTails.get(key) === tail) this.#keyTails.delete(key); });
    let cancelDeadline: () => void = () => undefined;
    const finish = (row: RunPanelRow | undefined, retry: boolean): void => {
      if (read.settled) return;
      read.settled = true;
      cancelDeadline();
      settleOwn();
      if (row === undefined) return;
      const parsed = StreamRowSchema.safeParse(row);
      if (parsed.success) {
        if (parsed.data.model !== "run-panel") throw new Error(`run panel ${key} parsed as another row`);
        read.row = parsed.data;
        read.retry = retry;
      } else {
        const refused = refusedRow(key, new Error(`run panel ${key} failed validation: ${parsed.error.message}`));
        read.row = refused.row;
        read.retry = refused.retry;
      }
      this.#afterRead(read);
    };
    read.controller.signal.addEventListener("abort", () => finish(undefined, false), { once: true });
    const timedOut = (): void => {
      // The late result is discarded; the key's next read starts now.
      finish(failedRow(key), true);
      read.controller.abort();
    };
    const begin = (): void => {
      if (read.settled) return;
      const startedAt = this.#clock.monotonicMs();
      cancelDeadline = this.#schedule(ROW_READ_DEADLINE_MS, timedOut);
      // A read that blocks the event loop can settle before its timer runs; the clock decides.
      const late = (): boolean => this.#clock.monotonicMs() - startedAt >= ROW_READ_DEADLINE_MS;
      new Promise<Extract<RunPanel, { state: "available" }>>(resolve => resolve(runPanels.read(key, read.controller.signal))).then(
        value => {
          if (late()) timedOut();
          else finish({ model: "run-panel", key, value }, false);
        },
        (error: unknown) => {
          if (read.settled) return;
          if (late()) {
            timedOut();
            return;
          }
          const refused = refusedRow(key, error);
          finish(refused.row, refused.retry);
        },
      );
    };
    if (previous === undefined) begin();
    else void previous.then(begin);
    return read;
  }

  /** A retry stays owed until a read of the key reaches every connection that has it open. */
  #afterRead(read: RowRead): void {
    const owedElsewhere = [...this.#subscribers].some(subscriber => subscriber.run === read.key
      && subscriber.phase.state === "open" && !read.owners.has(subscriber));
    if (read.retry) this.#scheduleRetry(read.key);
    else if (!owedElsewhere) this.#cancelRetry(read.key);
    for (const owner of read.owners) this.#deliver(owner);
  }

  #cancelRetry(key: RunId): void {
    this.#retries.get(key)?.();
    this.#retries.delete(key);
  }

  #scheduleRetry(key: RunId): void {
    this.#cancelRetry(key);
    let live = true;
    const fire = (): void => {
      if (!live) return;
      live = false;
      this.#retries.delete(key);
      // Its read queues behind the key's reads so far, ahead of any handoff that connects later.
      this.#publishRows([key], this.#projection.position());
    };
    const cancelTimer = this.#schedule(ROW_RETRY_MS, fire);
    this.#retries.set(key, () => { live = false; cancelTimer(); });
  }

  #release(subscriber: Subscriber, entries: readonly OutboxEntry[]): void {
    for (const entry of entries) {
      if (entry.kind === "ready") continue;
      for (const read of entry.reads) {
        read.owners.delete(subscriber);
        if (read.owners.size === 0 && !read.settled) read.controller.abort();
      }
    }
  }

  #retain(entry: RetainedEntry): void {
    this.#retained.push(entry);
    while (this.#retained.length > this.#retention) {
      const evicted = this.#retained.shift();
      if (evicted !== undefined) this.#evictedThrough = evicted.cursorNumber;
    }
  }

  /** Stamps an entry with this connection's `after` and its rows at handout and records what the connection now holds. */
  #handOut(subscriber: Subscriber, entry: OutboxEntry): DashboardStreamEnvelope {
    if (entry.kind === "ready") return entry.envelope;
    const rows = [...entry.rows, ...entry.reads.map(read => {
      if (read.row === undefined) throw new Error(`dashboard stream handed out ${read.key} without its row`);
      return read.row;
    })];
    if (entry.kind === "snapshot") {
      subscriber.handedCursor = entry.snapshot.cursor;
      return rows.length === 0 ? entry.snapshot : { ...entry.snapshot, rows };
    }
    const envelope: ChangeEnvelope = { ...entry.change, after: subscriber.handedCursor, rows };
    subscriber.handedCursor = entry.change.cursor;
    return envelope;
  }

  /** Hands the outbox head to a waiting consumer once its rows are in. */
  #deliver(subscriber: Subscriber): void {
    const phase = subscriber.phase;
    if (phase.state !== "open" || phase.waiter === undefined) return;
    const [head, ...rest] = phase.outbox;
    if (head === undefined || !entryReady(head)) return;
    subscriber.phase = { state: "open", outbox: rest };
    phase.waiter(this.#handOut(subscriber, head));
  }

  #resetNow(): DashboardStreamEnvelope {
    // Mint the reset at handout so its cursor names the boundary the client must resnapshot.
    return DashboardStreamEnvelopeSchema.parse({
      type: "reset-required",
      reason: "cursor-expired",
      cursor: this.#projection.cursor(),
    });
  }

  #push(subscriber: Subscriber, entry: OutboxEntry): void {
    const phase = subscriber.phase;
    switch (phase.state) {
      case "closed":
      case "reset-pending":
        this.#release(subscriber, [entry]);
        return;
      case "open": {
        const outbox = [...phase.outbox, entry];
        if (outbox.length > this.#maxPending) {
          // The reset waits for no read; nothing made before it reaches this connection.
          this.#release(subscriber, outbox);
          if (phase.waiter === undefined) {
            subscriber.phase = { state: "reset-pending", reason: "cursor-expired" };
            return;
          }
          subscriber.phase = { state: "open", outbox: [] };
          phase.waiter(this.#resetNow());
          return;
        }
        subscriber.phase = { state: "open", outbox, ...(phase.waiter === undefined ? {} : { waiter: phase.waiter }) };
        this.#deliver(subscriber);
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
        subscriber.phase = { state: "open", outbox: [] };
        return Promise.resolve(this.#resetNow());
      case "open": {
        if (phase.waiter !== undefined) {
          return Promise.reject(new Error("dashboard stream connection already has an outstanding next(); one consumer, one demand at a time"));
        }
        const [head, ...rest] = phase.outbox;
        if (head !== undefined && entryReady(head)) {
          subscriber.phase = { state: "open", outbox: rest };
          return Promise.resolve(this.#handOut(subscriber, head));
        }
        return new Promise<DashboardStreamEnvelope | undefined>((resolve) => {
          subscriber.phase = { state: "open", outbox: phase.outbox, waiter: resolve };
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
    return { state: "resumable", presentedCursor: ProjectionCursorSchema.parse(input.lastEventId), replay };
  }

  async connect(input: Readonly<{
    day: string;
    /** The open run's `run:<id>` topic; its panel rides the connection's snapshot and changes. */
    run?: RunId;
    lastEventId?: string;
    lastProjectionGeneration?: number;
  }>): Promise<DashboardStreamConnection> {
    const day = z.iso.date().parse(input.day);
    if (input.run !== undefined && this.#runPanels === undefined) throw new Error("dashboard stream does not serve run topics");
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
    return this.#admit(day, input.run, decision.state === "resumable" ? decision : undefined);
  }

  /** The handoff boundary: one turn of the event loop, so nothing is published between its steps. */
  #admit(day: string, run: RunId | undefined, resume: Extract<ResumeDecision, { state: "resumable" }> | undefined): DashboardStreamConnection {
    const subscriber: Subscriber = { day, run, phase: { state: "open", outbox: [] }, handedCursor: this.#projection.cursor() };
    const initial: DashboardStreamEnvelope[] = [this.#hello()];
    const handoff: OutboxEntry[] = [];
    if (this.#projection.health().state === "degraded") {
      handoff.push(this.#health("degraded"));
    } else {
      const reads = (): readonly RowRead[] => run === undefined ? [] : [this.#startRead(run, [subscriber])];
      if (resume === undefined) {
        // The connection's own cursor; the day is frozen at it.
        this.#projection.takeCursor();
        handoff.push({ kind: "snapshot", snapshot: this.#snapshot(day), rows: this.#statusRows([subscriber]), reads: reads() });
        handoff.push(this.#health("live"));
      } else {
        // The client presented a cursor, so it holds a baseline: it is live before the replay, which may carry publications.
        handoff.push(this.#health("live"));
        subscriber.handedCursor = resume.presentedCursor;
        for (const entry of resume.replay) {
          if (entry.kind === "change" && entry.day === day) handoff.push({ kind: "change", change: entry.change, rows: [], reads: [] });
          if (entry.kind === "publication") handoff.push({ kind: "ready", envelope: publicationFor(entry.publication, day) });
        }
        handoff.push({ kind: "change", change: this.#unstamped({ cursor: this.#projection.takeCursor(), position: this.#projection.position() }),
          rows: this.#statusRows([subscriber]), reads: reads() });
      }
    }
    // What is ready now goes out at once; the rest waits in the outbox for its rows.
    let ready = 0;
    for (const entry of handoff) {
      if (!entryReady(entry)) break;
      initial.push(this.#handOut(subscriber, entry));
      ready += 1;
    }
    subscriber.phase = { state: "open", outbox: handoff.slice(ready) };

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
        if (this.#statusOwed.delete(subscriber)) this.#armStatusRetry();
      },
    });
  }
}

export function createDashboardStreamHub(deps: DashboardStreamHubDeps): DashboardStreamHub {
  return new DashboardStreamHub(deps);
}
