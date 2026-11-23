import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { DashboardDayPatchSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import type { RunQueueProjectionChange } from "../../../../../src/backend/runs/projections/run-queue-projection.js";
import { ProjectionCursorSchema } from "../../../../../src/rules/identity/ids.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../../../support/fixtures/dashboard-stream-seams.js";

const DAY = "2026-11-14";
const DESCRIPTOR_HASH = "ab".repeat(32);
const RUN_ID = "00000000-0000-4000-8000-000000000001";

const hubs: DashboardStreamHub[] = [];
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
});

interface ScriptedProjection {
  emitPatch(): void;
}

function scriptedProjection(): ScriptedProjection & {
  onChange(listener: (change: RunQueueProjectionChange) => void): () => void;
  health(): { readonly state: "degraded" };
  buildDashboardDayWire(day: string): never;
  generation(): number;
  cursor(): RunQueueProjectionChange["cursor"];
  takeCursor(): never;
  position(): number;
  descriptorSetHash(): string;
} {
  // Connect reads pc:1 and never builds a day. Each patch advances one step, so the first is pc:2.
  let cursor = 1;
  const listeners = new Set<(change: RunQueueProjectionChange) => void>();
  return {
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    health: () => ({ state: "degraded" }),
    buildDashboardDayWire: () => {
      throw new Error("phase test reaches the day wire only if connect treats the projection as live");
    },
    generation: () => 1,
    cursor: () => ProjectionCursorSchema.parse(`pc:${String(cursor)}`),
    takeCursor: () => {
      throw new Error("phase test takes a handoff cursor only if connect treats the projection as live");
    },
    position: () => 0,
    descriptorSetHash: () => DESCRIPTOR_HASH,
    emitPatch() {
      cursor += 1;
      const change: RunQueueProjectionChange = {
        kind: "patch",
        cursor: ProjectionCursorSchema.parse(`pc:${String(cursor)}`),
        position: 0,
        day: DAY,
        patch: DashboardDayPatchSchema.parse({
          operation: "remove-queue-surface",
          target: { runId: RUN_ID, rowRevision: 1 },
          reason: "removed",
        }),
      };
      for (const listener of [...listeners]) listener(change);
    },
  };
}

function openHub(maxPending: number) {
  const projection = scriptedProjection();
  const hub = createDashboardStreamHub({
    projection,
    maxPending,
    backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER,
  });
  hubs.push(hub);
  return { hub, projection };
}

async function connect(maxPending = 8) {
  const opened = openHub(maxPending);
  const connection = await opened.hub.connect({ day: DAY });
  return { ...opened, connection };
}

function cursorOf(envelope: DashboardStreamEnvelope | undefined): string {
  if (envelope === undefined || !("cursor" in envelope)) assert.fail("expected an envelope that names a cursor");
  return envelope.cursor;
}

describe("dashboard stream subscriber phase", () => {
  it("queues a patch while open and nobody is waiting, then shifts it on next", async () => {
    const { connection, projection } = await connect();
    projection.emitPatch();
    projection.emitPatch();
    assert.equal(connection.pending, 2);
    const first = await connection.next();
    const second = await connection.next();
    assert.equal(cursorOf(first), "pc:2");
    assert.equal(cursorOf(second), "pc:3");
    if (first?.type !== "change" || second?.type !== "change") assert.fail("expected two changes");
    assert.equal(first.after, "pc:1", "the first change follows the cursor the connection was greeted at");
    assert.equal(second.after, "pc:2", "each change follows the one handed before it");
    assert.equal(connection.pending, 0);
  });

  it("hands a patch to the one outstanding next instead of queueing it", async () => {
    const { connection, projection } = await connect();
    const waiting = connection.next();
    projection.emitPatch();
    assert.equal(cursorOf(await waiting), "pc:2");
    assert.equal(connection.pending, 0);
  });

  it("replaces an open queue past maxPending with reset-pending", async () => {
    const { connection, projection } = await connect(2);
    projection.emitPatch();
    projection.emitPatch();
    projection.emitPatch();
    assert.equal(connection.pending, 1);
    const reset = await connection.next();
    assert.equal(reset?.type, "reset-required");
    if (reset?.type !== "reset-required") assert.fail("expected reset-required");
    assert.equal(reset.reason, "cursor-expired");
    assert.equal(reset.cursor, "pc:4");
    assert.equal(connection.pending, 0);
  });

  it("drops a later patch while reset-pending, then mints the reset and accepts the next one", async () => {
    const { connection, projection } = await connect(1);
    projection.emitPatch();
    projection.emitPatch();
    assert.equal(connection.pending, 1);
    projection.emitPatch();
    assert.equal(connection.pending, 1);
    const reset = await connection.next();
    assert.equal(reset?.type, "reset-required");
    if (reset?.type !== "reset-required") assert.fail("expected reset-required");
    assert.equal(reset.reason, "cursor-expired");
    assert.equal(reset.cursor, "pc:4");
    projection.emitPatch();
    assert.equal(cursorOf(await connection.next()), "pc:5");
  });

  it("drops a patch after close and answers later next calls with undefined", async () => {
    const { connection, projection } = await connect();
    const waiting = connection.next();
    connection.close();
    assert.equal(await waiting, undefined);
    projection.emitPatch();
    assert.equal(connection.pending, 0);
    assert.equal(await connection.next(), undefined);
  });

  it("refuses a second next while one waiter is outstanding", async () => {
    const { connection } = await connect();
    const outstanding = connection.next();
    await assert.rejects(connection.next(), /outstanding next\(\)/u);
    connection.close();
    assert.equal(await outstanding, undefined);
  });
});
