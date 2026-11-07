import { createClientDayFixtures } from "../../../support/helpers/dashboard/client-day-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { subscribeDashboardDay,type SubscriptionState } from "../../../../src/dashboard/client/subscriptions/subscription.js";
import type { DashboardTransport,SseMessage,StreamHandle } from "../../../../src/dashboard/client/transport.js";
import { NotificationPublicationWireSchema, type NotificationPublicationWire } from "../../../../src/models/dashboard/subscription.js";
import { type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";

const { surfaceOf: surfaceInput, dayOf: dayInput } = createClientDayFixtures(DAY, HASH_D);

function surfaceOf(rowRevision: number): Record<string, unknown> {
  return surfaceInput(RUN_ID, rowRevision, "EID 10873698", "queued");
}

function dayOf(surfaces: readonly Record<string, unknown>[], cursor: string): DashboardDayWire {
  return dayInput(surfaces, cursor);
}

function hello(cursor: string, projectionGeneration = 7): Record<string, unknown> {
  return { type: "hello", wireVersion: 1, descriptorHash: HASH_D, projectionGeneration, cursor };
}

function snapshotEnvelope(cursor: string, surfaces: readonly Record<string, unknown>[], projectionGeneration = 7): Record<string, unknown> {
  return { type: "snapshot", topic: "dashboard-day", cursor, payload: { ...dayOf(surfaces, cursor), projectionGeneration } };
}

function replacePatch(cursor: string, rowRevision: number): Record<string, unknown> {
  return {
    type: "patch",
    topic: "dashboard-day",
    cursor,
    payload: {
      operation: "replace-queue-surface",
      target: { runId: RUN_ID, rowRevision },
      replacement: surfaceOf(rowRevision),
    },
  };
}

function removePatch(cursor: string, rowRevision: number): Record<string, unknown> {
  return {
    type: "patch",
    topic: "dashboard-day",
    cursor,
    payload: {
      operation: "remove-queue-surface",
      target: { runId: RUN_ID, rowRevision },
      reason: "the run was deleted from the queue",
    },
  };
}

/* ── the fake transport: push an envelope, settle `done` ─────────────────── */

interface FakeStream {
  readonly lastEventId: string | undefined;
  readonly lastProjectionGeneration: number | undefined;
  push(envelope: Record<string, unknown>): void;
  /** The server ended the stream cleanly (EOF). */
  eof(): void;
  /** The stream failed; `done` rejects with exactly this value. */
  fail(reason: unknown): void;
}

interface Harness {
  readonly streams: FakeStream[];
  readonly days: DashboardDayWire[];
  readonly states: SubscriptionState[];
  /** Every reconnect delay `subscribeDashboardDay` asked the scheduler for. */
  readonly scheduled: number[];
  /** Runs the pending reconnect callback (there is at most one). */
  runScheduled(): void;
  close(): void;
}

function subscribe(onPublication?: (publication: NotificationPublicationWire) => void): Harness {
  const streams: FakeStream[] = [];
  const days: DashboardDayWire[] = [];
  const states: SubscriptionState[] = [];
  const scheduled: number[] = [];
  let pending: (() => void) | undefined;

  const served = {
    openStream(
      path: string,
      options: Readonly<{
        lastEventId?: string;
        lastProjectionGeneration?: number;
        onMessage: (message: SseMessage) => void;
      }>,
    ): StreamHandle {
      void path;
      let settle: () => void = () => undefined;
      let reject: (reason: unknown) => void = () => undefined;
      const done = new Promise<void>((resolveDone, rejectDone) => {
        settle = resolveDone;
        reject = rejectDone;
      });
      streams.push({
        lastEventId: options.lastEventId,
        lastProjectionGeneration: options.lastProjectionGeneration,
        push: (envelope) => {
          options.onMessage({ data: JSON.stringify(envelope) });
        },
        eof: () => settle(),
        fail: (reason) => reject(reason),
      });
      // The real transport aborts on close, and an aborted stream RESOLVES.
      return Object.freeze({ done, close: (): void => settle() });
    },
  } as unknown as DashboardTransport;

  const transport = new Proxy(served, {
    get(target, property, receiver) {
      if (!(property in target)) {
        throw new Error(`the subscription fixture does not serve DashboardTransport.${String(property)}`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  const subscription = subscribeDashboardDay({
    transport,
    day: DAY,
    ...(onPublication === undefined ? {} : { publications: { actorId: "local-operator", onPublication } }),
    onDay: (day) => days.push(day),
    onState: (state) => states.push(state),
    schedule: (delayMs, run) => {
      scheduled.push(delayMs);
      pending = run;
      return () => {
        pending = undefined;
      };
    },
  });

  return {
    streams,
    days,
    states,
    scheduled,
    runScheduled: () => {
      const next = pending;
      if (next === undefined) throw new Error("no reconnect was scheduled");
      pending = undefined;
      next();
    },
    close: () => subscription.close(),
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A live subscription holding the one-row day at cursor `pc:2`. */
function liveAtCursorTwo(): Harness {
  const h = subscribe();
  h.streams[0].push(hello("pc:1"));
  h.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
  h.streams[0].push(replacePatch("pc:2", 2));
  assert.equal(h.days.length, 2);
  assert.equal(h.days[1].queueSurfaces[0].rowRevision, 2);
  return h;
}

describe("dashboard day subscription — cursor idempotence", () => {
  it("ignores a patch it has already applied instead of applying it twice", () => {
    const h = liveAtCursorTwo();
    h.streams[0].push(replacePatch("pc:2", 2));
    assert.equal(h.days.length, 2);
    assert.equal(h.streams.length, 1);
    h.close();
  });

  it("ignores a duplicate REMOVAL patch rather than resnapshotting on the run it already removed", () => {
    const h = subscribe();
    h.streams[0].push(hello("pc:1"));
    h.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
    h.streams[0].push(removePatch("pc:2", 2));
    assert.equal(h.days.length, 2);
    assert.equal(h.days[1].queueSurfaces.length, 0);


    h.streams[0].push(removePatch("pc:2", 2));
    assert.equal(h.days.length, 2);
    assert.equal(h.streams.length, 1);
    assert.equal(h.scheduled.length, 0);
    h.close();
  });

  it("ignores an OLDER patch", () => {
    const h = liveAtCursorTwo();
    h.streams[0].push(replacePatch("pc:1", 1));
    assert.equal(h.days.length, 2);
    assert.equal(h.days[1].queueSurfaces[0].rowRevision, 2);
    assert.equal(h.streams.length, 1);
    h.close();
  });

  it("applies a snapshot at the HELD cursor, because one projection batch stamps both", () => {

    const h = liveAtCursorTwo();
    h.streams[0].push(snapshotEnvelope("pc:2", [surfaceOf(9)]));
    assert.equal(h.days.length, 3);
    assert.equal(h.days[2].queueSurfaces[0].rowRevision, 9);
    assert.equal(h.streams.length, 1);
    assert.equal(h.scheduled.length, 0);
    h.close();
  });

  it("ignores an OLDER snapshot", () => {
    const h = liveAtCursorTwo();
    h.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(9)]));
    assert.equal(h.days.length, 2);
    assert.equal(h.days[1].queueSurfaces[0].rowRevision, 2);
    h.close();
  });

  it("applies the next cursor", () => {
    const h = liveAtCursorTwo();
    h.streams[0].push(replacePatch("pc:3", 3));
    assert.equal(h.days.length, 3);
    assert.equal(h.days[2].queueSurfaces[0].rowRevision, 3);
    h.close();
  });

  it("still resnapshots on a FORWARD gap", () => {
    const h = liveAtCursorTwo();
    h.streams[0].push(replacePatch("pc:4", 4));
    assert.equal(h.days.length, 2);
    assert.deepEqual(h.scheduled, [0]);
    h.runScheduled();
    assert.equal(h.streams.length, 2);
    assert.equal(h.streams[1].lastEventId, undefined);
    h.close();
  });

  it("schedules exactly ONE reconnect for a gap: a superseded stream's ending is inert", async () => {
    const h = liveAtCursorTwo();
    h.streams[0].push(replacePatch("pc:4", 4));
    assert.deepEqual(h.scheduled, [0]);


    await tick();
    assert.deepEqual(h.scheduled, [0]);
    assert.deepEqual(h.states.map(({ state }) => state), ["connecting", "connecting"]);

    h.runScheduled();
    assert.equal(h.streams.length, 2);
    assert.equal(h.streams[1].lastEventId, undefined);
    h.close();
  });

  it("applies a REPLACEMENT generation's first snapshot even at a lower cursor", () => {
    const h = liveAtCursorTwo();

    h.streams[0].push(hello("pc:1", 8));
    h.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(5)], 8));
    assert.equal(h.days.length, 3);
    assert.equal(h.days[2].queueSurfaces[0].rowRevision, 5);
    h.close();
  });
});

describe("dashboard day subscription — stream failure classification", () => {
  it("reconnects with Last-Event-ID when the server ends the stream (EOF)", async () => {
    const h = liveAtCursorTwo();
    h.streams[0].eof();
    await tick();
    assert.deepEqual(h.states.at(-1), { state: "reconnecting" });
    assert.deepEqual(h.scheduled, [1000]);
    h.runScheduled();
    assert.equal(h.streams.length, 2);
    assert.equal(h.streams[1].lastEventId, "pc:2");
    h.close();
  });

  it("resumes and absorbs the REPLAYED envelope for free — the whole point of the cursor guard", async () => {

    const h = subscribe();
    h.streams[0].push(hello("pc:1"));
    h.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
    h.streams[0].push(removePatch("pc:2", 2));
    assert.equal(h.days.length, 2);
    assert.equal(h.days[1].queueSurfaces.length, 0);

    h.streams[0].eof();
    await tick();
    assert.deepEqual(h.scheduled, [1000]);
    h.runScheduled();
    assert.equal(h.streams.length, 2);
    assert.equal(h.streams[1].lastEventId, "pc:2");
    assert.equal(h.streams[1].lastProjectionGeneration, 7);

    // The resumed stream's handshake, at the held cursor and the SAME
    // generation, then the replay of the removal it resumed from.
    h.streams[1].push(hello("pc:2"));
    h.streams[1].push(removePatch("pc:2", 2));
    assert.equal(h.days.length, 2);
    assert.equal(h.streams.length, 2);
    assert.deepEqual(h.scheduled, [1000]);
    assert.deepEqual(h.states.at(-1), { state: "reconnecting" });


    h.streams[1].push(snapshotEnvelope("pc:3", [surfaceOf(3)]));
    assert.equal(h.days.length, 3);
    assert.equal(h.days[2].queueSurfaces[0].rowRevision, 3);
    h.close();
  });

  it("reconnects when the stream fails with the transport's NETWORK error", async () => {
    const h = liveAtCursorTwo();
    h.streams[0].fail(new DashboardClientError({
      kind: "network",
      message: "stream /events/v1: fetch failed",
      retryable: true,
    }));
    await tick();
    assert.deepEqual(h.states.at(-1), { state: "reconnecting" });
    assert.deepEqual(h.scheduled, [1000]);
    h.runScheduled();
    assert.equal(h.streams.length, 2);
    assert.equal(h.streams[1].lastEventId, "pc:2");
    h.close();
  });

  it("STOPS on an HTTP stream failure, even one the server calls retryable", async () => {
    const h = liveAtCursorTwo();

    const error = new DashboardClientError({
      kind: "http",
      status: 503,
      code: "PROJECTION_DEGRADED",
      message: "the day projection is unavailable",
      retryable: true,
    });
    h.streams[0].fail(error);
    await tick();
    const last = h.states.at(-1);
    assert.equal(last?.state, "stopped");
    if (last?.state !== "stopped") assert.fail("expected stopped");
    assert.equal(last.error, error);
    assert.deepEqual(h.scheduled, []);
    assert.equal(h.streams.length, 1);
  });

  it("STOPS on a PROTOCOL stream failure", async () => {
    const h = liveAtCursorTwo();
    const error = new DashboardClientError({ kind: "protocol", message: "the stream answered a foreign topic" });
    h.streams[0].fail(error);
    await tick();
    const last = h.states.at(-1);
    assert.equal(last?.state, "stopped");
    if (last?.state !== "stopped") assert.fail("expected stopped");
    assert.equal(last.error, error);
    assert.deepEqual(h.scheduled, []);
  });

  it("STOPS on a SCHEMA stream failure", async () => {
    const h = liveAtCursorTwo();
    const error = new DashboardClientError({ kind: "schema", message: "stream body failed its wire schema" });
    h.streams[0].fail(error);
    await tick();
    const last = h.states.at(-1);
    assert.equal(last?.state, "stopped");
    if (last?.state !== "stopped") assert.fail("expected stopped");
    assert.equal(last.error, error);
    assert.deepEqual(h.scheduled, []);
  });

  it("STOPS on an UNCLASSIFIED rejection, naming it rather than retrying it", async () => {
    const h = liveAtCursorTwo();
    const cause = new Error("ReadableStream errored");
    h.streams[0].fail(cause);
    await tick();
    const last = h.states.at(-1);
    assert.equal(last?.state, "stopped");
    if (last?.state !== "stopped") assert.fail("expected stopped");
    assert.equal(last.error?.kind, "protocol");
    assert.match(last.error?.message ?? "", /unclassified stream rejection/);
    assert.match(last.error?.message ?? "", /ReadableStream errored/);
    assert.equal(last.error?.cause, cause);
    assert.deepEqual(h.scheduled, []);
    assert.equal(h.streams.length, 1);
  });
});

it("rejects a wrong-day snapshot and ignores callbacks from superseded handles", async () => {
  const h = liveAtCursorTwo();
  const prior = h.days.length;
  h.streams[0].eof(); await tick(); h.runScheduled();
  h.streams[0].push(snapshotEnvelope("pc:9", [surfaceOf(99)]));
  assert.equal(h.days.length, prior);
  h.streams[1].push(hello("pc:2"));
  h.streams[1].push(snapshotEnvelope("pc:3", [surfaceOf(3)]));
  assert.equal(h.days.length, prior + 1);
  h.streams[1].push({ type: "snapshot", topic: "dashboard-day", cursor: "pc:4",
    payload: { ...dayOf([surfaceOf(4)], "pc:4"), day: "2026-08-02" } });
  assert.equal(h.days.length, prior + 1);
  const state = h.states.at(-1); assert.equal(state?.state, "stopped");
  if (state?.state !== "stopped") assert.fail("expected refusal");
  assert.match(state.error?.message ?? "", /day-request-identity-mismatch/u);
  h.close(); h.streams[1].push(snapshotEnvelope("pc:5", [surfaceOf(5)]));
  assert.equal(h.days.length, prior + 1);
});


describe("dashboard day subscription authority", () => {
  for (const field of ["day", "descriptorHash", "projectionGeneration", "snapshotCursor"] as const) {
    it(`stops a snapshot with mismatched ${field}`, () => {
      const h = subscribe();
      h.streams[0].push(hello("pc:1"));
      const payload = { ...dayOf([], "pc:1"), [field]: field === "day" ? "2026-08-04" : field === "descriptorHash" ? "e".repeat(64) : field === "projectionGeneration" ? 8 : "pc:2" };
      h.streams[0].push({ type: "snapshot", topic: "dashboard-day", cursor: "pc:1", payload });
      assert.equal(h.days.length, 0);
      assert.equal(h.states.at(-1)?.state, "stopped");
      h.close();
    });
  }
  it("requires the replacement stream's hello before publishing a reconnect snapshot", async () => {
    const h = liveAtCursorTwo();
    h.streams[0].eof();
    await tick();
    h.runScheduled();
    h.streams[1].push(snapshotEnvelope("pc:2", [surfaceOf(2)]));
    assert.equal(h.days.length, 2);
    assert.equal(h.states.at(-1)?.state, "stopped");
    h.close();
  });
});


it("rejects a lower-cursor snapshot with stale authority instead of silently discarding it", () => {
  for (const field of ["day", "descriptorHash", "projectionGeneration"] as const) {
    const h = liveAtCursorTwo();
    const payload = { ...dayOf([], "pc:1"), [field]: field === "day" ? "2026-08-04" : field === "descriptorHash" ? "e".repeat(64) : 8 };
    h.streams[0].push({ type: "snapshot", topic: "dashboard-day", cursor: "pc:1", payload });
    assert.equal(h.days.length, 2);
    const state = h.states.at(-1);
    assert.equal(state?.state, "stopped");
    assert.ok(state?.state === "stopped" && state.error?.kind === "protocol");
    h.close();
  }
});

it("resets a high cursor on same-generation descriptor replacement and publishes the lower matching snapshot", async () => {
  const h = liveAtCursorTwo();
  const descriptorHash = "e".repeat(64);
  h.streams[0].eof();
  await tick();
  h.runScheduled();
  assert.equal(h.streams[1].lastEventId, "pc:2");
  assert.equal(h.streams[1].lastProjectionGeneration, 7);
  h.streams[1].push({ ...hello("pc:1"), descriptorHash });
  h.streams[1].push({ type: "snapshot", topic: "dashboard-day", cursor: "pc:1", payload: { ...dayOf([surfaceOf(5)], "pc:1"), descriptorHash } });
  assert.equal(h.days.length, 3);
  assert.equal(h.days[2].descriptorHash, descriptorHash);
  assert.equal(h.days[2].queueSurfaces[0].rowRevision, 5);
  h.streams[1].eof();
  await tick();
  h.runScheduled();
  assert.equal(h.streams[2].lastEventId, "pc:1");
  assert.equal(h.streams[2].lastProjectionGeneration, 7);
  h.close();
});

function publicationEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "notification-publication", day: DAY, descriptorHash: HASH_D, projectionGeneration: 7,
    publication: { sourceId: "a".repeat(64), actorId: "local-operator", durable: "created", notification: {
      kind: "notification", notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", channel: "ping", count: 1,
      publicationId: "b".repeat(64), trigger: "storage", readState: "unread", state: "unread", severity: "warning", title: "Storage health degraded",
      occurredAt: "2026-08-03T17:00:00Z", revision: 1, context: { state: "not-applicable" }, sourceEvent: { state: "available", kind: "storage-degraded" },
    } }, ...overrides };
}
function startPublications(onPublication: (publication: NotificationPublicationWire) => void): Harness {
  const h = subscribe(onPublication);
  h.streams[0].push(hello("pc:1"));
  h.streams[0].push(snapshotEnvelope("pc:1", []));
  h.streams[0].push({ type: "health", state: "live" });
  return h;
}
describe("committed publication transport", () => {
  it("delivers explicit publications once without deriving them from baseline or resnapshots", () => {
    const publications: NotificationPublicationWire[] = [], h = startPublications(value => publications.push(value));
    assert.equal(publications.length, 0);
    h.streams[0].push(publicationEnvelope()); h.streams[0].push(publicationEnvelope());
    assert.equal(publications.length, 1);
    h.streams[0].push(snapshotEnvelope("pc:1", []));
    assert.equal(publications.length, 1);
    h.close();
  });
  it("ignores superseded and closed stream callbacks and does not toast reconnect snapshots", async () => {
    const publications: NotificationPublicationWire[] = [], h = startPublications(value => publications.push(value));
    h.streams[0].eof(); await tick(); h.runScheduled();
    h.streams[0].push(publicationEnvelope());
    assert.equal(publications.length, 0);
    h.streams[1].push(hello("pc:1")); h.streams[1].push(snapshotEnvelope("pc:1", [])); h.streams[1].push({ type: "health", state: "live" });
    assert.equal(publications.length, 0);
    h.streams[1].push(publicationEnvelope());
    assert.equal(publications.length, 1);
    h.streams[0].eof(); await tick(); assert.equal(h.streams.length, 2);
    h.close(); h.streams[1].push(publicationEnvelope()); assert.equal(publications.length, 1);
  });
  it("refuses wrong day, descriptor, generation and actor, and requires the handshake baseline", () => {
    const publication = NotificationPublicationWireSchema.parse(publicationEnvelope().publication);
    for (const overrides of [{ day: "2026-08-02" }, { descriptorHash: "c".repeat(64) }, { projectionGeneration: 8 },
      { publication: { ...publication, actorId: "other-operator" } },
      { publication: { ...publication, actorId: "other-operator", notification: { ...publication.notification, actorId: "other-operator" } } }]) {
      const publications: NotificationPublicationWire[] = [], h = startPublications(value => publications.push(value));
      h.streams[0].push(publicationEnvelope(overrides));
      assert.equal(publications.length, 0);
      assert.equal(h.states.at(-1)?.state, "stopped"); h.close();
    }
    const h = subscribe(() => { throw new Error("baseline publication was delivered"); });
    h.streams[0].push(hello("pc:1")); h.streams[0].push(publicationEnvelope());
    assert.equal(h.states.at(-1)?.state, "stopped"); h.close();
  });
});
