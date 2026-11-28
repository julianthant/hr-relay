// A resumed stream replays the retained shared changes above its cursor; otherwise it is answered with a snapshot.
// Row values are read per key in envelope order; each connection's outbox hands out in cursor order.
// Publications are retained at their own cursors and replayed on resume, after `health: live`.
// A snapshot is read on the navigation lane: the connection's outbox holds its place, and every change made after the
// read was asked queues behind it until main frames the lane's day at the baseline cursor its fold names. A snapshot framed
// at a cursor includes the inbox through that cursor on handoff. A live snapshot replaces an inbox update it absorbs.
import { isDeepStrictEqual } from "node:util";
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
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../models/dashboard/projection.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { queueRowBasis, type DashboardDayRead, type QueuePatchBasis, type RunQueueProjection, type RunQueueProjectionChange } from "../../../runs/projections/run-queue-projection.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID, ProjectionCursorSchema, type RunId } from "../../../../rules/identity/ids.js";
import type { NotificationInbox, NotificationPublication } from "../../../runs/notifications/inbox.js";
import type { NotificationObservationStatus } from "../../../runs/notifications/observation.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import type { NotificationTarget } from "../../../../models/notifications/notification-target.js";
import type { NotificationWire } from "../../../../models/dashboard/projection.js";
import type { BackfillGapNotifier } from "../../../runs/notifications/backfill-gap.js";
import { failureStatus } from "../routes/failure-status.js";
import { errorText } from "../../../runs/lifecycle/support.js";
import { DashboardSnapshotOvertakenError } from "../../../runs/commands/refusals.js";
import { systemClock, type Clock } from "../../../../rules/time/clock.js";

const CURSOR_PATTERN = /^pc:([1-9]\d*)$/;
const ROW_READ_DEADLINE_MS = 5_000;
const ROW_RETRY_MS = 5_000;
/** A snapshot read the boundary refuses is asked again this many times in a row; then the connection resubscribes. */
const SNAPSHOT_ATTEMPTS = 3;

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
  /** A day read: synchronous where the projection builds it, a lane reply otherwise. */
  requestDashboardDay: RunQueueProjection["requestDashboardDay"];
  stampDay: RunQueueProjection["stampDay"];
  foldCursor: RunQueueProjection["foldCursor"];
  whenFolded: RunQueueProjection["whenFolded"];
  recordPublishedDay: RunQueueProjection["recordPublishedDay"];
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
  /** The observer status rides the handoff and a change when it moves. */
  readonly notificationStatus?: {
    readonly read: () => NotificationObservationStatus | Promise<NotificationObservationStatus>;
    readonly onChange: (listener: () => void) => () => void;
  };
  readonly notificationList?: {
    readonly read: () => NotificationWire[] | Promise<NotificationWire[]>;
    readonly onChange: (listener: () => void) => () => void;
    readonly notePublication?: (row: NotificationWire) => void;
  };
  /** The document `GET /settings/editable` serves; its row rides the handoff and a change after each ordinary settings commit.
   * A source may answer later, from a lane: its row then waits in the outbox like a run panel, under the same deadline. */
  readonly settings?: {
    readonly read: () => EditableSettingsWire | Promise<EditableSettingsWire>;
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
type SyncRowModel = Exclude<StreamRow, { model: "run-panel" }>["model"];

/** A row read by the query its route serves, now or later. Each connection whose last value of it was unavailable is owed the next good one. */
interface SyncRowSource {
  readonly model: SyncRowModel;
  /** The available row, or a promise of it; a throw or rejection is sent as unavailable. */
  readonly read: () => unknown;
  readonly unavailable: () => StreamRow;
  /** The connections last handed this row as unavailable. */
  readonly owed: Set<Subscriber>;
  /** Each connection's newest read of the row, by dispatch: a good value from an older read is not sent after it. */
  readonly dispatched: Map<Subscriber, number>;
  reads: number;
  /** Cancels the pending re-read, armed while any connection is owed a good value. */
  retry: (() => void) | undefined;
  dispose: (() => void) | undefined;
}
type PublicationEnvelope = Extract<DashboardStreamEnvelope, { type: "notification-publication" }>;
/** A publication before handout; its `day` is the receiving connection's. */
type UnstampedPublication = Omit<PublicationEnvelope, "day">;
/** A change before handout: its `after` is the receiving connection's and its rows are read per connection. */
type UnstampedChange = Omit<ChangeEnvelope, "after" | "rows">;
type StatusCandidate = NonNullable<Extract<RunQueueProjectionChange, { kind: "snapshot" }>["statusCandidate"]>;
/** A day framed at its baseline: main's stamp joined to the lane's body, never parsed here. Shared by every connection on that day. */
interface FramedDay {
  readonly cursor: ProjectionCursor;
  readonly position: number;
  readonly payloadJson: string;
  /** The day as main built it, when it built it itself at this cursor. */
  readonly payload: DashboardDayWire | undefined;
  readonly patchBasis: QueuePatchBasis | undefined;
  readonly statusPatch: UnstampedChange | undefined;
  /** The envelope handed to every connection that has no rows, one object for all of them. */
  bare?: SnapshotEnvelope;
}

/** One snapshot read on the lane, and the connections whose outbox holds a place for it. */
interface SnapshotRequest {
  readonly day: string;
  /** A handoff's failed read fails its connect; a change's is asked again. */
  readonly origin: "handoff" | "change";
  /** Whether its day is recorded as published: a change snapshot, or a handoff whose place a change snapshot found still pending. */
  recordsDay: boolean;
  statusCandidate: (StatusCandidate & { cursor: ProjectionCursor }) | undefined;
  readonly subscribers: Set<Subscriber>;
  readonly controller: AbortController;
  attempts: number;
}

/** A sync row whose source answers later; every connection it was read for waits on it. */
interface SyncRead {
  readonly model: SyncRowModel;
  readonly owners: Set<Subscriber>;
  row?: StreamRow;
  settled: boolean;
}

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

/** `rows` were read when the entry was made; `sync` and `reads` are still being read, sync rows first. */
interface RowsOf {
  readonly rows: readonly StreamRow[];
  readonly sync: readonly SyncRead[];
  readonly reads: readonly RowRead[];
}
type OutboxEntry =
  | { readonly kind: "ready"; readonly envelope: Exclude<DashboardStreamEnvelope, ChangeEnvelope | SnapshotEnvelope> }
  | ({ readonly kind: "change"; readonly change: UnstampedChange } & RowsOf)
  | ({ readonly kind: "snapshot"; readonly frame: FramedDay } & RowsOf)
  /** The connection's place for a snapshot its lane read has not answered yet. */
  | { readonly kind: "pending-snapshot"; readonly request: SnapshotRequest };

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
  handedBasis: QueuePatchBasis | undefined;
  readonly handedSyncRows: Map<SyncRowModel, StreamRow>;
  /** Settles when a handoff's first snapshot is framed or its place is released. */
  framed?: PromiseWithResolvers<void>;
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
  if (entry.kind === "pending-snapshot") return false;
  return entry.kind === "ready" || entry.sync.every(read => read.settled) && entry.reads.every(read => read.settled);
}

function provesStatusPatch(before: QueuePatchBasis, after: QueuePatchBasis, target: RunId): boolean {
  if (before.shared !== after.shared || before.rows.length !== after.rows.length) return false;
  return after.rows.every((row, index) => {
    const held = before.rows[index];
    return held?.runId === row.runId && (row.runId === target
      ? held.status !== row.status && held.rowRevision < row.rowRevision
      : held.fingerprint === row.fingerprint);
  });
}

const FRAMED_TEXT = Symbol("dashboard-stream-framed-text");

/**
 * A snapshot envelope over a framed day. Its JSON is the frame's text, written without parsing the day; `payload`
 * decodes and validates the day only for a reader that asks for it.
 */
function framedSnapshotEnvelope(frame: FramedDay, rows: readonly StreamRow[]): SnapshotEnvelope {
  let payload = frame.payload;
  const envelope = {
    type: "snapshot" as const, topic: "dashboard-day" as const, cursor: frame.cursor, position: frame.position,
    get payload(): DashboardDayWire { return payload ??= DashboardDayWireSchema.parse(JSON.parse(frame.payloadJson)); },
    rows: [...rows],
  };
  const text = `{"type":"snapshot","topic":"dashboard-day","cursor":${JSON.stringify(frame.cursor)},"position":${JSON.stringify(frame.position)},`
    + `"payload":${frame.payloadJson},"rows":${JSON.stringify(envelope.rows)}}`;
  Object.defineProperty(envelope, FRAMED_TEXT, { value: text });
  return Object.freeze(envelope);
}

/** The JSON a framed envelope already carries; undefined for every other envelope. */
export function framedEnvelopeText(envelope: DashboardStreamEnvelope): string | undefined {
  const text: unknown = Object.getOwnPropertyDescriptor(envelope, FRAMED_TEXT)?.value;
  return typeof text === "string" ? text : undefined;
}

/** The refusal its route would have answered; a server failure is read again, a refusal is a value.
 * An error with no text, or one the route's mapper cannot describe, is a failed read. */
function refusedRow(key: RunId, error: unknown): { row: RunPanelRow; retry: boolean } {
  try {
    if (errorText(error) === "") return { row: failedRow(key), retry: true };
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

/** A source's value as its row, now or once it answers. */
function rowOf<Value>(value: Value | Promise<Value>, row: (value: Value) => StreamRow): StreamRow | Promise<StreamRow> {
  return value instanceof Promise ? value.then(row) : row(value);
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
  readonly #syncRows: SyncRowSource[] = [];
  #retained: RetainedEntry[] = [];
  /** Cursors of the newest publication and the newest projection snapshot change; 0 when the generation has none. */
  #lastPublication = 0;
  #lastSnapshotChange = 0;
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
      this.#publish({ wire, listed, target });
      deps.notificationList?.notePublication?.(listed);
    });
    const status = deps.notificationStatus;
    if (status !== undefined) this.#addSyncRow("notification-status", status.onChange,
      () => rowOf(status.read(), value => ({ model: "notification-status", key: LOCAL_OPERATOR_ACTOR_ID, value: { state: "available", value } })),
      () => ({ model: "notification-status", key: LOCAL_OPERATOR_ACTOR_ID, value: { state: "unavailable", error: readFailed() } }));
    const list = deps.notificationList;
    if (list !== undefined) this.#addSyncRow("notification-list", list.onChange,
      () => rowOf(list.read(), value => ({ model: "notification-list", key: LOCAL_OPERATOR_ACTOR_ID, value: { state: "available", value } })),
      () => ({ model: "notification-list", key: LOCAL_OPERATOR_ACTOR_ID, value: { state: "unavailable", error: readFailed() } }));
    const settings = deps.settings;
    if (settings !== undefined) this.#addSyncRow("settings", settings.onChange,
      () => rowOf(settings.read(), value => ({ model: "settings", key: "editable", value: { state: "available", value } })),
      () => ({ model: "settings", key: "editable", value: { state: "unavailable", error: readFailed() } }));
  }

  #addSyncRow(model: SyncRowModel, onChange: (listener: () => void) => () => void, read: () => unknown, unavailable: () => StreamRow): void {
    const source: SyncRowSource = { model, read, unavailable, owed: new Set(), dispatched: new Map(), reads: 0, retry: undefined, dispose: undefined };
    this.#syncRows.push(source);
    source.dispose = onChange(() => this.#publishSyncRow(source));
  }

  /**
   * A publication takes its cursor at once and is retained once. A fresh handoff takes its inbox from the list;
   * a connection already open receives arrivals even while a queue snapshot is being read.
   */
  #publish({ wire, listed, target }: Readonly<{ wire: NotificationPublicationWire; listed: NotificationWire; target: NotificationTarget }>): void {
    const cursor = this.#projection.takeCursor();
    const cursorValue = cursorNumber(cursor);
    if (cursorValue === undefined) throw new Error(`projection produced a malformed cursor: ${cursor}`);
    const unstamped: UnstampedPublication = Object.freeze({
      type: "notification-publication", cursor, descriptorHash: FingerprintSchema.parse(this.#projection.descriptorSetHash()),
      projectionGeneration: ProjectionGenerationSchema.parse(this.#projection.generation()), publication: wire, listed, target,
    });
    this.#lastPublication = cursorValue;
    this.#retain({ cursorNumber: cursorValue, kind: "publication", publication: unstamped });
    for (const subscriber of this.#subscribers) {
      if (subscriber.phase.state === "open" && subscriber.phase.outbox.some(entry => entry.kind === "pending-snapshot" && entry.request.origin === "handoff")) continue;
      this.#push(subscriber, { kind: "ready", envelope: publicationFor(unstamped, subscriber.day) });
    }
  }

  /** Every sync row for these connections: the rows read now, and the reads still answering. */
  #syncRowsFor(recipients: readonly Subscriber[], inboxRecipients = recipients): Pick<RowsOf, "rows" | "sync"> {
    const rows: StreamRow[] = [], sync: SyncRead[] = [];
    for (const source of this.#syncRows) {
      const read = this.#syncRowOf(source, source.model === "notification-list" ? inboxRecipients : recipients);
      if (read === undefined) continue;
      if ("settled" in read) sync.push(read);
      else rows.push(read);
    }
    return { rows, sync };
  }

  /** The row as its route would answer it now, for these connections, or the read that answers it later; a read that throws,
   * rejects or outlives its deadline is sent unavailable. */
  #syncRowOf(source: SyncRowSource, recipients: readonly Subscriber[]): StreamRow | SyncRead | undefined {
    if (recipients.length === 0) return undefined;
    const seq = ++source.reads;
    for (const recipient of recipients) source.dispatched.set(recipient, seq);
    let value: unknown;
    try {
      value = source.read();
    } catch {
      return this.#admitSyncRow(source, recipients, source.unavailable(), seq);
    }
    if (!(value instanceof Promise)) return this.#admitSyncRow(source, recipients, this.#syncRowValue(source, value), seq);
    const read: SyncRead = { model: source.model, owners: new Set(recipients), settled: false };
    const startedAt = this.#clock.monotonicMs();
    const settle = (row: StreamRow): void => {
      if (read.settled) return;
      read.settled = true;
      cancelDeadline();
      const owners = [...read.owners].filter(owner => owner.phase.state === "open" && this.#subscribers.has(owner));
      read.row = this.#admitSyncRow(source, owners, row, seq);
      for (const owner of read.owners) this.#deliver(owner);
    };
    const cancelDeadline = this.#schedule(ROW_READ_DEADLINE_MS, () => { settle(source.unavailable()); });
    value.then(
      (answered: unknown) => { settle(this.#clock.monotonicMs() - startedAt >= ROW_READ_DEADLINE_MS ? source.unavailable() : this.#syncRowValue(source, answered)); },
      () => { settle(source.unavailable()); },
    );
    return read;
  }

  #syncRowValue(source: SyncRowSource, value: unknown): StreamRow {
    const parsed = StreamRowSchema.safeParse(value);
    return parsed.success && parsed.data.model === source.model ? parsed.data : source.unavailable();
  }

  /**
   * A good value is also sent, as a rows-only change, to every other open connection last handed the row as unavailable whose
   * own newest read was dispatched no later than this one. Who is owed is recorded at handout, in the order rows are handed.
   */
  #admitSyncRow(source: SyncRowSource, recipients: readonly Subscriber[], row: StreamRow, seq: number): StreamRow {
    if (row.value.state !== "unavailable") {
      for (const subscriber of source.owed) if (subscriber.phase.state !== "open" || !this.#subscribers.has(subscriber)) source.owed.delete(subscriber);
      const behind = [...source.owed].filter(subscriber => !recipients.includes(subscriber) && (source.dispatched.get(subscriber) ?? 0) <= seq);
      for (const subscriber of behind) source.owed.delete(subscriber);
      if (behind.length > 0) {
        const change = this.#unstamped({ cursor: this.#projection.takeCursor(), position: this.#projection.position() });
        for (const subscriber of behind) this.#push(subscriber, { kind: "change", change, rows: [row], sync: [], reads: [] });
      }
    }
    this.#armSyncRetry(source);
    return row;
  }

  /** Keeps one re-read pending while any connection is owed a good value, and none otherwise. */
  #armSyncRetry(source: SyncRowSource): void {
    if (source.owed.size === 0) {
      source.retry?.();
      source.retry = undefined;
      return;
    }
    if (source.retry !== undefined) return;
    let live = true;
    const cancel = this.#schedule(ROW_RETRY_MS, () => {
      if (!live) return;
      live = false;
      source.retry = undefined;
      this.#publishSyncRow(source);
    });
    source.retry = () => { live = false; cancel(); };
  }

  /** A rows-only change carrying the row, at its own cursor, to every open connection. Never retained. */
  #publishSyncRow(source: SyncRowSource): void {
    const owed = [...this.#subscribers].filter(subscriber => subscriber.phase.state === "open");
    for (const subscriber of source.owed) if (!owed.includes(subscriber)) source.owed.delete(subscriber);
    if (owed.length === 0) {
      this.#armSyncRetry(source);
      return;
    }
    const read = this.#syncRowOf(source, owed);
    const change = this.#unstamped({ cursor: this.#projection.takeCursor(), position: this.#projection.position() });
    const answered = read !== undefined && !("settled" in read) ? [read] : [];
    const pending = read !== undefined && "settled" in read ? [read] : [];
    for (const subscriber of owed) this.#push(subscriber, { kind: "change", change, rows: answered, sync: pending, reads: [] });
  }

  close(): void {
    this.#disposeProjection();
    this.#disposePublications?.();
    for (const source of this.#syncRows) {
      source.dispose?.();
      source.owed.clear();
      this.#armSyncRetry(source);
    }
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

  /** Replaces an open connection's outbox, keeping its waiting consumer. */
  #replaceOutbox(subscriber: Subscriber, outbox: readonly OutboxEntry[]): void {
    const current = subscriber.phase;
    if (current.state !== "open") return;
    subscriber.phase = current.waiter === undefined ? { state: "open", outbox } : { state: "open", outbox, waiter: current.waiter };
  }

  #closeSubscriber(subscriber: Subscriber): void {
    const phase = subscriber.phase;
    subscriber.phase = { state: "closed" };
    subscriber.handedSyncRows.clear();
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

  /**
   * Asks for one day's snapshot for these connections. Each holds one place in its outbox for it; a connection that
   * already holds one keeps that place and its read, which settles only at a baseline that covers this ask.
   */
  #requestSnapshot(day: string, origin: SnapshotRequest["origin"], subscribers: readonly Subscriber[], statusCandidate?: SnapshotRequest["statusCandidate"]): void {
    const request: SnapshotRequest = { day, origin, recordsDay: origin === "change", statusCandidate,
      subscribers: new Set(), controller: new AbortController(), attempts: 0 };
    for (const subscriber of subscribers) {
      const phase = subscriber.phase;
      if (phase.state !== "open") continue;
      const held = phase.outbox.find(entry => entry.kind === "pending-snapshot");
      if (held !== undefined) {
        if (origin === "change") {
          held.request.recordsDay = true;
          held.request.statusCandidate = undefined;
        }
        continue;
      }
      request.subscribers.add(subscriber);
      this.#push(subscriber, { kind: "pending-snapshot", request });
    }
    this.#dispatchSnapshot(request);
  }

  #abandonIfUnwanted(request: SnapshotRequest): void {
    if (request.subscribers.size === 0) request.controller.abort();
  }

  /** One read at this dispatch; a projection that builds the day itself answers in this turn. */
  #dispatchSnapshot(request: SnapshotRequest): void {
    if (request.subscribers.size === 0) return;
    request.attempts += 1;
    let read: DashboardDayRead | Promise<DashboardDayRead>;
    try {
      read = this.#projection.requestDashboardDay(request.day, { signal: request.controller.signal,
        ...(request.origin === "handoff" ? { initialSnapshot: true } : {}) });
    } catch (error) {
      // A day built here fails in the turn that drove the change: its connections resubscribe and the failure reaches that caller.
      if (request.origin === "change") { this.#snapshotGap(request); throw error; }
      this.#snapshotFailed(request, error);
      return;
    }
    if (read instanceof Promise) read.then(answered => { this.#settleSnapshot(request, answered); }, (error: unknown) => { this.#snapshotFailed(request, error); });
    else this.#settleSnapshot(request, read);
  }

  /**
   * Frames a lane day for every connection still holding a place for it, in one turn. Its baseline is the cursor main's
   * fold names for the day's position, or the dispatch cursor if main had already folded it. Changes queued behind the place
   * at or below the baseline are in the day and are dropped; every other entry stays, in cursor order.
   */
  #settleSnapshot(request: SnapshotRequest, read: DashboardDayRead): void {
    if (request.subscribers.size === 0) return;
    // A generation change already reset these connections; a process-facts change makes the day stale.
    if (!read.current()) { this.#retrySnapshot(request); return; }
    const position = read.facts.position;
    if (!read.foldedHere && this.#projection.position() < position) {
      // A wait ends early only when every connection gave up its place, which aborts it.
      this.#projection.whenFolded(position, request.controller.signal).then(() => { this.#settleSnapshot(request, read); },
        (error: unknown) => { if (!request.controller.signal.aborted) this.#snapshotFailed(request, error); });
      return;
    }
    const baseline = this.#baseline(read, request.origin);
    if (baseline === undefined) { this.#retrySnapshot(request); return; }
    const inboxOwners = new Set<Subscriber>();
    for (const subscriber of request.subscribers) {
      if (subscriber.phase.state !== "open") continue;
      const place = subscriber.phase.outbox.findIndex(entry => entry.kind === "pending-snapshot" && entry.request === request);
      const behind = subscriber.phase.outbox.slice(place + 1);
      // A day change above the baseline at or below the day's position may already be in it: the boundary is unproved.
      const unproved = behind.some(entry => entry.kind === "change" && entry.change.day !== undefined
        && (cursorNumber(entry.change.cursor) ?? 0) > baseline && entry.change.position <= position);
      if (unproved) { this.#retrySnapshot(request); return; }
      if (request.origin === "handoff" || behind.some(entry => entry.kind === "change" && (cursorNumber(entry.change.cursor) ?? 0) <= baseline
        && (entry.rows.some(row => row.model === "notification-list") || entry.sync.some(read => read.model === "notification-list")))) {
        inboxOwners.add(subscriber);
      }
    }
    let frame: FramedDay;
    try {
      const cursor = ProjectionCursorSchema.parse(`pc:${String(baseline)}`);
      const built = read.wire !== undefined && read.wire.snapshotCursor === cursor && read.wire.projectionGeneration === read.generation ? read.wire : undefined;
      const { patchBasis } = read.facts;
      const candidate = request.statusCandidate;
      let statusPatch: UnstampedChange | undefined;
      if (candidate?.cursor === cursor && patchBasis !== undefined) {
        const replacement = candidate.replacement;
        const { runId, rowRevision, fingerprint } = queueRowBasis(replacement);
        if (patchBasis.rows.some(row => row.runId === runId && row.fingerprint === fingerprint)) {
          statusPatch = this.#unstamped({ cursor, position, day: { operation: "replace-queue-surface",
            target: { runId, rowRevision }, replacement, counts: patchBasis.counts } });
        }
      }
      frame = { cursor, position, payloadJson: this.#projection.stampDay(request.day, read, baseline), payload: built, patchBasis, statusPatch };
    } catch (error) {
      this.#snapshotFailed(request, error);
      return;
    }
    if (request.recordsDay) this.#projection.recordPublishedDay(request.day, read.facts.surfaces);
    const owners = [...request.subscribers];
    request.subscribers.clear();
    const reads = this.#readsFor(owners);
    const syncRows = this.#syncRowsFor(owners, [...inboxOwners]);
    for (const subscriber of owners) {
      const phase = subscriber.phase;
      if (phase.state !== "open") continue;
      const place = phase.outbox.findIndex(entry => entry.kind === "pending-snapshot" && entry.request === request);
      const behind = phase.outbox.slice(place + 1).filter(entry => {
        if (entry.kind !== "change" || (cursorNumber(entry.change.cursor) ?? 0) > baseline) return true;
        this.#release(subscriber, [entry]);
        return false;
      });
      const includesInbox = inboxOwners.has(subscriber);
      const snapshot: OutboxEntry = { kind: "snapshot", frame,
        rows: includesInbox ? syncRows.rows : syncRows.rows.filter(row => row.model !== "notification-list"),
        sync: includesInbox ? syncRows.sync : syncRows.sync.filter(read => read.model !== "notification-list"),
        reads: this.#readOf(reads, subscriber) };
      this.#replaceOutbox(subscriber, [...phase.outbox.slice(0, place), snapshot, ...behind]);
      subscriber.framed?.resolve();
      this.#deliver(subscriber);
    }
  }

  /**
   * A fresh handoff reads the inbox at a baseline that includes publications it skipped while framing.
   */
  #baseline(read: DashboardDayRead, origin: SnapshotRequest["origin"]): number | undefined {
    if (origin === "handoff" && this.#lastPublication > read.dispatchCursor) return undefined;
    let baseline = read.dispatchCursor;
    if (!read.foldedHere) {
      const fold = this.#projection.foldCursor(read.facts.position);
      if (fold.state !== "at") return undefined;
      baseline = Math.max(fold.cursor, baseline);
    }
    return baseline < this.#lastSnapshotChange ? undefined : baseline;
  }

  /**
   * Asks again, at most SNAPSHOT_ATTEMPTS times in a row. Then a handoff's connect is refused by name, so its client asks
   * again only after its reconnect delay; a connection already streaming resubscribes.
   */
  #retrySnapshot(request: SnapshotRequest): void {
    if (request.attempts < SNAPSHOT_ATTEMPTS) { this.#dispatchSnapshot(request); return; }
    if (request.origin === "handoff") { this.#snapshotFailed(request, new DashboardSnapshotOvertakenError()); return; }
    this.#snapshotGap(request);
  }

  #snapshotFailed(request: SnapshotRequest, error: unknown): void {
    if (request.subscribers.size === 0) return;
    const failure = error instanceof Error ? error : new Error("dashboard-stream-snapshot-failed", { cause: error });
    // A handoff fails its connect; a connection already streaming resubscribes.
    for (const subscriber of request.subscribers) if (subscriber.framed !== undefined) subscriber.framed.reject(failure);
    if (request.origin === "handoff") { request.subscribers.clear(); return; }
    this.#retrySnapshot(request);
  }

  #snapshotGap(request: SnapshotRequest): void {
    const owners = [...request.subscribers].filter(subscriber => subscriber.phase.state === "open");
    request.subscribers.clear();
    if (owners.length === 0) return;
    // The connection resubscribes; its reconnect records the boundary as a gap, as any resume across a snapshot does.
    const reset = DashboardStreamEnvelopeSchema.parse({ type: "reset-required", reason: "cursor-expired", cursor: this.#projection.takeCursor() });
    if (reset.type !== "reset-required") throw new Error("dashboard stream reset parsed as another envelope");
    for (const subscriber of owners) {
      const phase = subscriber.phase;
      if (phase.state !== "open") continue;
      this.#release(subscriber, phase.outbox);
      this.#replaceOutbox(subscriber, []);
      this.#push(subscriber, { kind: "ready", envelope: reset });
      subscriber.framed?.resolve();
    }
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
      this.#lastPublication = 0;
      this.#lastSnapshotChange = 0;
      for (const cancel of this.#retries.values()) cancel();
      this.#retries.clear();
      // Nothing frozen under the old generation is handed out after the reset.
      for (const subscriber of this.#subscribers) {
        const phase = subscriber.phase;
        if (phase.state !== "open") continue;
        this.#release(subscriber, phase.outbox);
        this.#replaceOutbox(subscriber, []);
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
      // Status patches formed at handout are specific to the connection's proven day.
      this.#retain({ cursorNumber: cursor, kind: "snapshot" });
      this.#lastSnapshotChange = cursor;
      // Each day's connections hold one place; what is published while the read answers queues behind it.
      const byDay = new Map<string, Subscriber[]>();
      for (const subscriber of this.#subscribers) {
        if (subscriber.phase.state !== "open") continue;
        const list = byDay.get(subscriber.day);
        if (list === undefined) byDay.set(subscriber.day, [subscriber]);
        else list.push(subscriber);
      }
      for (const [day, subscribers] of byDay) {
        const candidate = change.statusCandidate;
        this.#requestSnapshot(day, "change", subscribers, candidate?.day === day ? { ...candidate, cursor: change.cursor } : undefined);
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
      this.#push(subscriber, { kind: "change", change: shared, rows: [], sync: [], reads: this.#readOf(reads, subscriber) });
    }
  }

  /** A rows-only change at its own cursor for every connection that has one of these runs open. Never retained. */
  #publishRows(runIds: readonly RunId[], position: number): void {
    const owed = [...this.#subscribers].filter(subscriber => subscriber.phase.state === "open"
      && subscriber.run !== undefined && runIds.includes(subscriber.run));
    if (owed.length === 0) return;
    const change = this.#unstamped({ cursor: this.#projection.takeCursor(), position });
    const reads = this.#readsFor(owed);
    for (const subscriber of owed) this.#push(subscriber, { kind: "change", change, rows: [], sync: [], reads: this.#readOf(reads, subscriber) });
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
      if (entry.kind === "pending-snapshot") {
        entry.request.subscribers.delete(subscriber);
        this.#abandonIfUnwanted(entry.request);
        subscriber.framed?.resolve();
        continue;
      }
      for (const read of entry.sync) read.owners.delete(subscriber);
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
    if (entry.kind === "ready") {
      if (entry.envelope.type === "reset-required") {
        subscriber.handedSyncRows.clear();
        subscriber.handedBasis = undefined;
      }
      // The publication can change the browser's list between two whole-list reads.
      if (entry.envelope.type === "notification-publication") subscriber.handedSyncRows.delete("notification-list");
      return entry.envelope;
    }
    if (entry.kind === "pending-snapshot") throw new Error("dashboard stream handed out a snapshot its read has not answered");
    const rows = [...entry.rows, ...entry.sync.map(read => {
      if (read.row === undefined) throw new Error("dashboard stream handed out a sync row before its read answered");
      return read.row;
    }), ...entry.reads.map(read => {
      if (read.row === undefined) throw new Error(`dashboard stream handed out ${read.key} without its row`);
      return read.row;
    })].filter(row => {
      const source = this.#syncRows.find(candidate => candidate.model === row.model);
      if (source === undefined) return true;
      // The outbox may still have held an earlier update when this snapshot was framed.
      const previous = subscriber.handedSyncRows.get(source.model);
      if (entry.kind === "snapshot" && isDeepStrictEqual(previous, row)) return false;
      subscriber.handedSyncRows.set(source.model, row);
      if (row.value.state === "unavailable") source.owed.add(subscriber);
      else source.owed.delete(subscriber);
      this.#armSyncRetry(source);
      return true;
    });
    if (entry.kind === "snapshot") {
      const { cursor, patchBasis, statusPatch } = entry.frame;
      const { handedBasis, handedCursor } = subscriber;
      subscriber.handedCursor = cursor;
      subscriber.handedBasis = patchBasis;
      if (statusPatch?.day !== undefined && patchBasis !== undefined && handedBasis !== undefined
        && (cursorNumber(cursor) ?? 0) > (cursorNumber(handedCursor) ?? 0)
        && provesStatusPatch(handedBasis, patchBasis, statusPatch.day.target.runId)) {
        return { ...statusPatch, after: handedCursor, rows };
      }
      if (rows.length > 0) return framedSnapshotEnvelope(entry.frame, rows);
      entry.frame.bare ??= framedSnapshotEnvelope(entry.frame, []);
      return entry.frame.bare;
    }
    const envelope: ChangeEnvelope = { ...entry.change, after: subscriber.handedCursor, rows };
    subscriber.handedCursor = entry.change.cursor;
    if (envelope.day !== undefined && subscriber.handedBasis !== undefined) {
      const patch = envelope.day;
      const before = subscriber.handedBasis;
      const index = before.rows.findIndex(row => row.runId === patch.target.runId);
      if (patch.operation === "replace-queue-surface" && index !== -1 && before.rows[index].rowRevision <= patch.target.rowRevision) {
        const rows = [...before.rows];
        rows[index] = queueRowBasis(patch.replacement);
        subscriber.handedBasis = { ...before, rows };
      } else subscriber.handedBasis = undefined;
    }
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
          this.#overflow(subscriber, phase, outbox);
          return;
        }
        this.#replaceOutbox(subscriber, outbox);
        this.#deliver(subscriber);
        return;
      }
      default: {
        const unexpected: never = phase;
        throw new Error(`dashboard stream subscriber phase is not a known state: ${JSON.stringify(unexpected)}`);
      }
    }
  }

  /** The reset waits for no read; nothing made before it reaches this connection. */
  #overflow(subscriber: Subscriber, phase: Extract<SubscriberQueue, { state: "open" }>, outbox: readonly OutboxEntry[]): void {
    this.#release(subscriber, outbox);
    subscriber.handedSyncRows.clear();
    subscriber.handedBasis = undefined;
    if (phase.waiter === undefined) {
      subscriber.phase = { state: "reset-pending", reason: "cursor-expired" };
      return;
    }
    subscriber.phase = { state: "open", outbox: [] };
    phase.waiter(this.#resetNow());
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

  /**
   * The handoff boundary. A resume or a degraded handoff is admitted in one turn. A fresh one is registered and asks for its
   * snapshot in one turn; what is published while the lane answers queues behind the snapshot's place.
   */
  async #admit(day: string, run: RunId | undefined, resume: Extract<ResumeDecision, { state: "resumable" }> | undefined): Promise<DashboardStreamConnection> {
    const subscriber: Subscriber = { day, run, phase: { state: "open", outbox: [] }, handedCursor: this.#projection.cursor(),
      handedBasis: undefined, handedSyncRows: new Map() };
    const hello = this.#hello();
    if (this.#projection.health().state === "degraded") {
      subscriber.phase = { state: "open", outbox: [this.#health("degraded")] };
    } else if (resume === undefined) {
      // The connection's own cursor; the day is framed at it or at the baseline its lane read names.
      this.#projection.takeCursor();
      const framed = Promise.withResolvers<void>();
      subscriber.framed = framed;
      // Registered once the read is asked, in the same turn: a day built here holds what was published while it was built,
      // and everything published after a lane read was asked queues behind its place.
      this.#requestSnapshot(day, "handoff", [subscriber]);
      this.#subscribers.add(subscriber);
      this.#push(subscriber, this.#health("live"));
      try {
        await framed.promise;
      } catch (error) {
        this.#closeSubscriber(subscriber);
        this.#subscribers.delete(subscriber);
        throw error;
      }
    } else {
      const reads = (): readonly RowRead[] => run === undefined ? [] : [this.#startRead(run, [subscriber])];
      // The client presented a cursor, so it holds a baseline: it is live before the replay, which may carry publications.
      const handoff: OutboxEntry[] = [this.#health("live")];
      subscriber.handedCursor = resume.presentedCursor;
      for (const entry of resume.replay) {
        if (entry.kind === "change" && entry.day === day) handoff.push({ kind: "change", change: entry.change, rows: [], sync: [], reads: [] });
        if (entry.kind === "publication") handoff.push({ kind: "ready", envelope: publicationFor(entry.publication, day) });
      }
      handoff.push({ kind: "change", change: this.#unstamped({ cursor: this.#projection.takeCursor(), position: this.#projection.position() }),
        ...this.#syncRowsFor([subscriber]), reads: reads() });
      subscriber.phase = { state: "open", outbox: handoff };
    }
    // What is ready now goes out at once; the rest waits in the outbox for its rows.
    const initial: DashboardStreamEnvelope[] = [hello];
    const admitted = subscriber.phase;
    if (admitted.state === "open") {
      let ready = 0;
      for (const entry of admitted.outbox) {
        if (!entryReady(entry)) break;
        initial.push(this.#handOut(subscriber, entry));
        ready += 1;
      }
      subscriber.phase = { state: "open", outbox: admitted.outbox.slice(ready) };
    }

    // A hub closed while the snapshot was read has already closed this connection.
    if (subscriber.phase.state !== "closed") this.#subscribers.add(subscriber);
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
        for (const source of this.#syncRows) {
          source.dispatched.delete(subscriber);
          if (source.owed.delete(subscriber)) this.#armSyncRetry(source);
        }
      },
    });
  }
}

export function createDashboardStreamHub(deps: DashboardStreamHubDeps): DashboardStreamHub {
  return new DashboardStreamHub(deps);
}
