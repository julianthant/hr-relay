/** One case per client transition in the day-stream design, driven through subscribeDashboardDay. */
import { createClientDayFixtures } from "../../../support/helpers/dashboard/client-day-fixtures.js";
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import * as dayState from "../../../../src/dashboard/client/queries/day-state.js";
import { subscribeDashboardDay, type SubscriptionState } from "../../../../src/dashboard/client/subscriptions/subscription.js";
import type { DashboardTransport, SseMessage, StreamHandle } from "../../../../src/dashboard/client/transport.js";
import type { NotificationPublicationWire } from "../../../../src/models/dashboard/subscription.js";
import { type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const OTHER_RUN = "11111111-1111-4111-8111-111111111111";

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
  return { type: "snapshot", topic: "dashboard-day", position: 0, cursor, payload: { ...dayOf(surfaces, cursor), projectionGeneration } };
}

/** The cursor a change follows when nothing was skipped: the one before its own. */
function cursorBefore(cursor: string): string {
  return `pc:${String(Math.max(1, Number(cursor.slice(3)) - 1))}`;
}

function replacePatch(cursor: string, rowRevision: number): Record<string, unknown> {
  return {
    type: "change",
    topic: "dashboard-day",
    cursor,
    after: cursorBefore(cursor),
    position: 0,
    day: {
      operation: "replace-queue-surface",
      target: { runId: RUN_ID, rowRevision },
      replacement: surfaceOf(rowRevision),
    },
  };
}

function removePatch(cursor: string, runId: string): Record<string, unknown> {
  return {
    type: "change",
    topic: "dashboard-day",
    cursor,
    after: cursorBefore(cursor),
    position: 0,
    day: {
      operation: "remove-queue-surface",
      target: { runId, rowRevision: 1 },
      reason: "the run was deleted from the queue",
    },
  };
}

function publicationEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "notification-publication",
    day: DAY,
    descriptorHash: HASH_D,
    projectionGeneration: 7,
    publication: {
      sourceId: "a".repeat(64),
      actorId: "local-operator",
      durable: "created",
      notification: {
        kind: "notification",
        notificationId: "00000000-0000-4000-8000-000000000111",
        actorId: "local-operator",
        channel: "ping",
        count: 1,
        publicationId: "b".repeat(64),
        trigger: "storage",
        readState: "unread",
        state: "unread",
        severity: "warning",
        title: "Storage health degraded",
        occurredAt: "2026-08-03T17:00:00Z",
        revision: 1,
        context: { state: "not-applicable" },
        sourceEvent: { state: "available", kind: "storage-degraded" },
      },
    },
    ...overrides,
  };
}

interface FakeStream {
  readonly lastEventId: string | undefined;
  readonly lastProjectionGeneration: number | undefined;
  push(envelope: Record<string, unknown>): void;
  deliver(data: string): void;
  eof(): void;
  fail(reason: unknown): void;
}

interface Harness {
  readonly streams: FakeStream[];
  readonly days: DashboardDayWire[];
  readonly states: SubscriptionState[];
  readonly publications: NotificationPublicationWire[];
  readonly scheduled: number[];
  runScheduled(): void;
  close(): void;
}

function subscribe(withPublications = false): Harness {
  const streams: FakeStream[] = [];
  const days: DashboardDayWire[] = [];
  const states: SubscriptionState[] = [];
  const publications: NotificationPublicationWire[] = [];
  const scheduled: number[] = [];
  let pending: (() => void) | undefined;

  const transport: DashboardTransport = {
    requestJson: () => unsupported("requestJson"),
    requestJsonResponse: () => unsupported("requestJsonResponse"),
    requestBinary: () => unsupported("requestBinary"),
    resolveUrl: () => unsupported("resolveUrl"),
    openStream(_path, options): StreamHandle {
      let settle: () => void = () => undefined;
      let reject: (reason: unknown) => void = () => undefined;
      const done = new Promise<void>((resolveDone, rejectDone) => {
        settle = resolveDone;
        reject = rejectDone;
      });
      const deliver = (data: string): void => {
        options.onMessage({ data } satisfies SseMessage);
      };
      streams.push({
        lastEventId: options.lastEventId,
        lastProjectionGeneration: options.lastProjectionGeneration,
        push: (envelope) => deliver(JSON.stringify(envelope)),
        deliver,
        eof: () => settle(),
        fail: (reason) => reject(reason),
      });
      return Object.freeze({ done, close: (): void => settle() });
    },
  };

  const subscription = subscribeDashboardDay({
    transport,
    day: DAY,
    ...(withPublications ? { publications: { actorId: "local-operator", onPublication: (publication) => publications.push(publication) } } : {}),
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
    publications,
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

function unsupported(method: string): never {
  throw new Error(`the subscription fixture does not serve DashboardTransport.${method}`);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function liveAtCursorTwo(): Harness {
  const harness = subscribe();
  harness.streams[0].push(hello("pc:1"));
  harness.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
  harness.streams[0].push(replacePatch("pc:2", 2));
  assert.equal(harness.days.length, 2);
  return harness;
}

function assertStopped(harness: Harness, pattern: RegExp): void {
  const state = harness.states.at(-1);
  assert.equal(state?.state, "stopped");
  if (state?.state !== "stopped") return;
  assert.match(state.error?.message ?? "", pattern);
}

describe("dashboard day subscription phase", () => {
  it("starts waiting to connect and opens the first stream without a timer", () => {
    const harness = subscribe();
    assert.deepEqual(harness.states, [{ state: "connecting" }]);
    assert.equal(harness.streams.length, 1);
    assert.deepEqual(harness.scheduled, []);
    harness.close();
  });

  it("opens a new stream when the waiting timer fires, and ignores the superseded stream's ending", async () => {
    const harness = liveAtCursorTwo();
    harness.streams[0].push(replacePatch("pc:4", 4));
    assert.deepEqual(harness.states.at(-1), { state: "connecting" });
    assert.deepEqual(harness.scheduled, [0]);
    assert.equal(harness.streams.length, 1);
    await tick();
    assert.deepEqual(harness.scheduled, [0]);
    harness.runScheduled();
    assert.equal(harness.streams.length, 2);
    assert.equal(harness.streams[1].lastEventId, undefined);
    assert.equal(harness.streams[1].lastProjectionGeneration, undefined);
    harness.close();
  });

  it("stops on an unparsable envelope before and after hello", () => {
    const open = subscribe();
    open.streams[0].deliver("{");
    assertStopped(open, /malformed stream envelope/);
    open.close();

    const invalid = subscribe();
    invalid.streams[0].push({ type: "nope" });
    assertStopped(invalid, /malformed stream envelope/);
    invalid.close();

    const greeted = liveAtCursorTwo();
    greeted.streams[0].deliver("{");
    assertStopped(greeted, /malformed stream envelope/);
    greeted.close();
  });

  it("stops a greeted snapshot or patch whose cursor the schema rejects, without publishing or reconnecting", () => {
    const snapshot = {
      type: "snapshot",
      topic: "dashboard-day",
      position: 0,
      cursor: "pc:0",
      payload: dayOf([surfaceOf(3)], "pc:1"),
    };
    const patch = { ...replacePatch("pc:2", 2), cursor: "not-a-cursor" };
    for (const envelope of [snapshot, patch]) {
      const harness = subscribe();
      harness.streams[0].push(hello("pc:1"));
      harness.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
      const published = harness.days.length;
      harness.streams[0].push(envelope);
      const state = harness.states.at(-1);
      assert.equal(state?.state, "stopped");
      if (state?.state !== "stopped") continue;
      assert.equal(state.error?.kind, "protocol");
      assert.match(state.error?.message ?? "", /malformed stream envelope/);
      assert.match(state.error?.message ?? "", /projection cursor must be pc:<positive integer>/);
      assert.doesNotMatch(state.error?.message ?? "", /envelope carries malformed cursor/);
      assert.equal(harness.days.length, published);
      assert.deepEqual(harness.scheduled, []);
      assert.equal(harness.streams.length, 1);
      harness.close();
    }
  });

  it("greets an open stream on hello without reporting a new subscription state", () => {
    const harness = subscribe();
    harness.streams[0].push(hello("pc:1"));
    assert.deepEqual(harness.states, [{ state: "connecting" }]);
    harness.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
    assert.equal(harness.days.length, 1);
    assert.equal(harness.days[0].queueSurfaces[0].rowRevision, 1);
    harness.close();
  });

  it("keeps health on a replacement hello and clears the held baseline only when authority differs", () => {
    const same = liveAtCursorTwo();
    same.streams[0].push({ type: "health", state: "live" });
    same.streams[0].push(hello("pc:1", 7));
    same.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(9)]));
    assert.equal(same.days.length, 2);
    assert.deepEqual(same.states.at(-1), { state: "live" });
    assert.equal(same.streams.length, 1);
    same.close();

    const changed = liveAtCursorTwo();
    changed.streams[0].push({ type: "health", state: "degraded" });
    changed.streams[0].push(hello("pc:1", 8));
    changed.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(5)], 8));
    assert.equal(changed.days.length, 3);
    assert.equal(changed.days[2].queueSurfaces[0].rowRevision, 5);
    assert.deepEqual(changed.states.at(-1), { state: "degraded" });
    assert.equal(changed.streams.length, 1);
    changed.close();
  });

  it("refuses health, snapshot, patch, reset, and publication before hello", () => {
    const envelopes = [
      { type: "health", state: "live" },
      snapshotEnvelope("pc:1", [surfaceOf(1)]),
      replacePatch("pc:1", 1),
      { type: "reset-required", reason: "cursor-expired", cursor: "pc:1" },
      publicationEnvelope(),
    ];
    for (const envelope of envelopes) {
      const harness = subscribe();
      harness.streams[0].push(envelope);
      assertStopped(harness, /day-stream-hello-missing/);
      assert.equal(harness.days.length, 0);
      harness.close();
    }
  });

  it("reports live, degraded, and reconnecting health without opening another stream", () => {
    const harness = subscribe();
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push(snapshotEnvelope("pc:1", []));
    for (const state of ["live", "degraded", "reconnecting"] as const) {
      harness.streams[0].push({ type: "health", state });
      assert.deepEqual(harness.states.at(-1), { state });
    }
    assert.equal(harness.streams.length, 1);
    assert.deepEqual(harness.scheduled, []);
    harness.close();
  });

  it("clears the held baseline and reconnects without resume when the server requires a reset", () => {
    const harness = liveAtCursorTwo();
    harness.streams[0].push({ type: "reset-required", reason: "generation-changed", cursor: "pc:2" });
    assert.deepEqual(harness.states.at(-1), { state: "connecting" });
    assert.deepEqual(harness.scheduled, [0]);
    harness.runScheduled();
    assert.equal(harness.streams.length, 2);
    assert.equal(harness.streams[1].lastEventId, undefined);
    assert.equal(harness.streams[1].lastProjectionGeneration, undefined);
    harness.close();
  });

  it("stops a publication whose day, descriptor, or generation differs from the greeting", () => {
    for (const overrides of [{ day: "2026-08-02" }, { descriptorHash: "c".repeat(64) }, { projectionGeneration: 8 }]) {
      const harness = subscribe(true);
      harness.streams[0].push(hello("pc:1"));
      harness.streams[0].push(snapshotEnvelope("pc:1", []));
      harness.streams[0].push({ type: "health", state: "live" });
      harness.streams[0].push(publicationEnvelope(overrides));
      assertStopped(harness, /notification-publication-authority-mismatch/);
      assert.equal(harness.publications.length, 0);
      harness.close();
    }
  });

  it("stops a publication with no held snapshot or while health is not live", () => {
    const noHeld = subscribe(true);
    noHeld.streams[0].push(hello("pc:1"));
    noHeld.streams[0].push(publicationEnvelope());
    assertStopped(noHeld, /notification-publication-baseline-missing/);
    noHeld.close();

    const degraded = subscribe(true);
    degraded.streams[0].push(hello("pc:1"));
    degraded.streams[0].push(snapshotEnvelope("pc:1", []));
    degraded.streams[0].push({ type: "health", state: "degraded" });
    degraded.streams[0].push(publicationEnvelope());
    assertStopped(degraded, /notification-publication-baseline-missing/);
    assert.equal(degraded.publications.length, 0);
    degraded.close();
  });

  it("ignores a publication when the subscription was not given a publication listener", () => {
    const harness = subscribe(false);
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push(snapshotEnvelope("pc:1", []));
    harness.streams[0].push({ type: "health", state: "live" });
    harness.streams[0].push(publicationEnvelope());
    assert.deepEqual(harness.states.at(-1), { state: "live" });
    assert.equal(harness.publications.length, 0);
    assert.equal(harness.streams.length, 1);
    harness.close();
  });

  it("stops a publication for a different actor", () => {
    const harness = subscribe(true);
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push(snapshotEnvelope("pc:1", []));
    harness.streams[0].push({ type: "health", state: "live" });
    const base = publicationEnvelope();
    const publication = base.publication;
    if (typeof publication !== "object" || publication === null || !("notification" in publication)) {
      throw new Error("publication fixture is missing its notification");
    }
    const notification = publication.notification;
    if (typeof notification !== "object" || notification === null) {
      throw new Error("publication fixture notification is not an object");
    }
    harness.streams[0].push(publicationEnvelope({
      publication: { ...publication, actorId: "other-operator", notification: { ...notification, actorId: "other-operator" } },
    }));
    assertStopped(harness, /notification-publication-actor-mismatch/);
    assert.equal(harness.publications.length, 0);
    harness.close();
  });

  it("records a publication once and ignores a repeated source id", () => {
    const harness = subscribe(true);
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push(snapshotEnvelope("pc:1", []));
    harness.streams[0].push({ type: "health", state: "live" });
    harness.streams[0].push(publicationEnvelope());
    harness.streams[0].push(publicationEnvelope());
    assert.equal(harness.publications.length, 1);
    assert.equal(harness.publications[0].sourceId, "a".repeat(64));
    assert.deepEqual(harness.states.at(-1), { state: "live" });
    harness.close();
  });

  it("stops a snapshot whose day differs from the subscription", () => {
    const harness = subscribe();
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push({
      type: "snapshot",
      topic: "dashboard-day",
      position: 0,
      cursor: "pc:1",
      payload: { ...dayOf([surfaceOf(1)], "pc:1"), day: "2026-08-02" },
    });
    assertStopped(harness, /day-request-identity-mismatch/);
    assert.equal(harness.days.length, 0);
    harness.close();
  });

  it("stops a snapshot whose descriptor or generation differs from the greeting", () => {
    for (const field of ["descriptorHash", "projectionGeneration"] as const) {
      const harness = subscribe();
      harness.streams[0].push(hello("pc:1"));
      const payload = {
        ...dayOf([], "pc:1"),
        [field]: field === "descriptorHash" ? "e".repeat(64) : 8,
      };
      harness.streams[0].push({ type: "snapshot", topic: "dashboard-day", position: 0, cursor: "pc:1", payload });
      assertStopped(harness, /day-stream-authority-mismatch/);
      assert.equal(harness.days.length, 0);
      harness.close();
    }
  });

  it("stops a snapshot whose cursor differs from its snapshot cursor", () => {
    const harness = subscribe();
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push({
      type: "snapshot",
      topic: "dashboard-day",
      position: 0,
      cursor: "pc:1",
      payload: dayOf([], "pc:2"),
    });
    assertStopped(harness, /day-stream-cursor-mismatch/);
    assert.equal(harness.days.length, 0);
    harness.close();
  });

  it("ignores a snapshot older than the held cursor", () => {
    const harness = liveAtCursorTwo();
    harness.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(9)]));
    assert.equal(harness.days.length, 2);
    assert.equal(harness.days[1].queueSurfaces[0].rowRevision, 2);
    assert.equal(harness.states.at(-1)?.state, "connecting");
    harness.close();
  });

  it("publishes a snapshot at the held cursor and a first snapshot", () => {
    const harness = subscribe();
    harness.streams[0].push(hello("pc:1"));
    harness.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(1)]));
    assert.equal(harness.days.length, 1);
    harness.streams[0].push(snapshotEnvelope("pc:1", [surfaceOf(4)]));
    assert.equal(harness.days.length, 2);
    assert.equal(harness.days[1].queueSurfaces[0].rowRevision, 4);
    assert.equal(harness.streams.length, 1);
    harness.close();
  });

  it("ignores a patch at or below the held cursor", () => {
    const harness = liveAtCursorTwo();
    harness.streams[0].push(replacePatch("pc:2", 9));
    harness.streams[0].push(replacePatch("pc:1", 1));
    assert.equal(harness.days.length, 2);
    assert.equal(harness.days[1].queueSurfaces[0].rowRevision, 2);
    assert.equal(harness.streams.length, 1);
    harness.close();
  });

  it("reconnects without resume when a patch has no held baseline or skips a cursor", () => {
    const gap = liveAtCursorTwo();
    gap.streams[0].push(replacePatch("pc:4", 4));
    assert.equal(gap.days.length, 2);
    assert.deepEqual(gap.scheduled, [0]);
    gap.runScheduled();
    assert.equal(gap.streams[1].lastEventId, undefined);
    gap.close();

    const noHeld = subscribe();
    noHeld.streams[0].push(hello("pc:1"));
    noHeld.streams[0].push(replacePatch("pc:1", 1));
    assert.equal(noHeld.days.length, 0);
    assert.deepEqual(noHeld.states.at(-1), { state: "connecting" });
    assert.deepEqual(noHeld.scheduled, [0]);
    noHeld.runScheduled();
    assert.equal(noHeld.streams[1].lastEventId, undefined);
    noHeld.close();
  });

  it("reconnects without resume when a patch fails to apply", () => {
    const harness = liveAtCursorTwo();
    harness.streams[0].push(removePatch("pc:3", OTHER_RUN));
    assert.equal(harness.days.length, 2);
    assert.deepEqual(harness.states.at(-1), { state: "connecting" });
    assert.deepEqual(harness.scheduled, [0]);
    harness.runScheduled();
    assert.equal(harness.streams[1].lastEventId, undefined);
    harness.close();
  });

  it("stops when applying a patch throws something other than a protocol error", () => {
    const harness = liveAtCursorTwo();
    const published = harness.days.length;
    const fault = new Error("patch applicator failed");
    const apply = vi.spyOn(dayState, "applyDashboardDayPatch").mockImplementation(() => {
      throw fault;
    });
    try {
      harness.streams[0].push(replacePatch("pc:3", 3));
    } finally {
      apply.mockRestore();
    }
    const state = harness.states.at(-1);
    assert.equal(state?.state, "stopped");
    if (state?.state === "stopped") {
      assert.equal(state.error?.kind, "protocol");
      assert.equal(state.error?.message, fault.message);
    }
    assert.equal(harness.days.length, published);
    assert.deepEqual(harness.scheduled, []);
    assert.equal(harness.streams.length, 1);
    harness.close();
  });

  it("publishes the next patch and advances the held cursor", () => {
    const harness = liveAtCursorTwo();
    harness.streams[0].push(replacePatch("pc:3", 3));
    assert.equal(harness.days.length, 3);
    assert.equal(harness.days[2].queueSurfaces[0].rowRevision, 3);
    assert.equal(harness.streams.length, 1);
    assert.deepEqual(harness.scheduled, []);
    harness.close();
  });

  it("reconnects with the held cursor when the stream ends or the transport reports a network failure", async () => {
    for (const end of ["eof", "network"] as const) {
      const harness = liveAtCursorTwo();
      if (end === "eof") harness.streams[0].eof();
      else {
        harness.streams[0].fail(new DashboardClientError({
          kind: "network",
          message: "stream /events/v1: fetch failed",
          retryable: true,
        }));
      }
      await tick();
      assert.deepEqual(harness.states.at(-1), { state: "reconnecting" });
      assert.deepEqual(harness.scheduled, [1000]);
      harness.runScheduled();
      assert.equal(harness.streams[1].lastEventId, "pc:2");
      assert.equal(harness.streams[1].lastProjectionGeneration, 7);
      harness.close();
    }
  });

  it("stops on a non-network rejection and classifies an unknown rejection", async () => {
    const http = new DashboardClientError({
      kind: "http",
      status: 503,
      code: "PROJECTION_DEGRADED",
      message: "the day projection is unavailable",
      retryable: true,
    });
    const refused = liveAtCursorTwo();
    refused.streams[0].fail(http);
    await tick();
    const stopped = refused.states.at(-1);
    assert.equal(stopped?.state, "stopped");
    if (stopped?.state === "stopped") assert.equal(stopped.error, http);
    assert.deepEqual(refused.scheduled, []);
    refused.close();

    const cause = new Error("ReadableStream errored");
    const unknown = liveAtCursorTwo();
    unknown.streams[0].fail(cause);
    await tick();
    const last = unknown.states.at(-1);
    assert.equal(last?.state, "stopped");
    if (last?.state === "stopped") {
      assert.equal(last.error?.kind, "protocol");
      assert.match(last.error?.message ?? "", /unclassified stream rejection/);
      assert.equal(last.error?.cause, cause);
    }
    assert.deepEqual(unknown.scheduled, []);
    unknown.close();
  });

  it("stops on close from a waiting, open, or greeted stream and cancels a pending reconnect", async () => {
    const waiting = liveAtCursorTwo();
    waiting.streams[0].push(replacePatch("pc:4", 4));
    assert.deepEqual(waiting.scheduled, [0]);
    waiting.close();
    assert.deepEqual(waiting.states.at(-1), { state: "stopped" });
    assert.throws(() => waiting.runScheduled(), /no reconnect was scheduled/);

    const open = subscribe();
    open.close();
    assert.deepEqual(open.states.at(-1), { state: "stopped" });

    const greeted = liveAtCursorTwo();
    greeted.close();
    await tick();
    assert.deepEqual(greeted.states.at(-1), { state: "stopped" });
    assert.deepEqual(greeted.scheduled, []);
  });

  it("ignores later envelopes and stream endings once stopped", async () => {
    const harness = liveAtCursorTwo();
    harness.close();
    const days = harness.days.length;
    harness.streams[0].push(hello("pc:9", 8));
    harness.streams[0].push(snapshotEnvelope("pc:9", [surfaceOf(9)], 8));
    harness.streams[0].eof();
    await tick();
    assert.equal(harness.days.length, days);
    assert.deepEqual(harness.states.at(-1), { state: "stopped" });
    assert.deepEqual(harness.scheduled, []);
    assert.equal(harness.streams.length, 1);
  });
});
