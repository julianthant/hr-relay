import { dashboardEventStreamBody } from "../../../../src/backend/transports/http/subscriptions/sse-response.js";
import type { DashboardStreamConnection } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { createDebugEventWriter, sanitizeDebugText } from "../../../../src/backend/logs/debug-events.js";
import { appendEmergencyFault, importEmergencyFaults, withEmergencyTimelineWriter } from "../../../../src/backend/logs/emergency-faults.js";
import { TimelineEventRecordSchema, type TimelineRepository, type TimelineEventRecord } from "../../../../src/models/events/timeline.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
const AT = new Date("2026-10-10T12:00:00.000Z");
function fixture() {
  const records: TimelineEventRecord[] = [];
  const repository: TimelineRepository = { withReadSnapshot: read => read(),
    append(input) { const record = TimelineEventRecordSchema.parse({ ...(input as object), cursor: records.length + 1 });
      const existing = records.find(row => row.eventId === record.eventId);
      if (existing !== undefined) return { state: "existing", record: existing };
      records.push(record); return { state: "inserted", record }; },
    get: id => records.find(row => row.eventId === id), page: () => records, highWaterMark: () => records.length, pruneBefore: () => 0 };
  return { records, repository };
}
describe("bounded native debug events", () => {
  it.each(["session", "duo", "worker", "http", "sse", "client", "boot"] as const)("writes %s once with source/build/time", category => {
    const { records, repository } = fixture();
    createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" }).emit({ category, phase: "failed", correlationId: "owned", message: "Bearer CANARY token=CANARY https://example.test/path?key=CANARY#CANARY" });
    assert.equal(records.length, 1); assert.equal(records[0].payload.kind, "debug");
    assert.equal(JSON.stringify(records).includes("CANARY"), false);
    assert.equal(records[0].recordedAt, AT.toISOString());
  });
  it("rejects body/header fields and oversized events before append", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    assert.throws(() => writer.emit({ category: "http", phase: "failed", correlationId: "owned", headers: { authorization: "CANARY" } }));
    assert.throws(() => writer.emit({ category: "sse", phase: "failed", correlationId: "owned", message: "a".repeat(8192) }), /size-exceeded/u);
    assert.equal(records.length, 0);
  });
  it("preserves paths and HR text while removing private key/authorization material", () => {
    const safe = sanitizeDebugText("at /local/run.ts:3 employee Ada -----BEGIN PRIVATE KEY-----\nCANARY\n-----END PRIVATE KEY----- Basic CANARY");
    assert.ok(safe.includes("/local/run.ts:3 employee Ada")); assert.ok(!safe.includes("CANARY"));
  });
  it("imports emergency IDs deterministically and keeps unresolved bytes on failed verification", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-emergency-"));
    try {
      const { records, repository } = fixture();
      appendEmergencyFault({ stateRoot: root, build: "test", code: "DATABASE_UNAVAILABLE", error: new Error("token=CANARY"), now: AT });
      const get = repository.get.bind(repository); repository.get = () => undefined;
      assert.throws(() => importEmergencyFaults(root, repository), /verification-failed/u);
      assert.equal(existsSync(join(root, "logs/boot.jsonl")), true);
      repository.get = get;
      assert.equal(importEmergencyFaults(root, repository), 1); assert.equal(records.length, 1);
      assert.equal(existsSync(join(root, "logs/boot.jsonl")), false);
      assert.equal(JSON.stringify(records).includes("CANARY"), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("spools only actual unavailable writer faults and preserves the original failure", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-emergency-"));
    try {
      const { repository } = fixture();
      const unavailable = Object.assign(new Error("token=CANARY"), { code: "ERR_INVALID_STATE" });
      repository.append = () => { throw unavailable; };
      const writer = withEmergencyTimelineWriter(repository, { stateRoot: root, clock: manualClock(AT), build: "test" });
      assert.throws(() => writer.append({}), error => error === unavailable);
      assert.equal(existsSync(join(root, "logs/boot.jsonl")), true);
      const stored = fixture(); assert.equal(importEmergencyFaults(root, stored.repository), 1);
      assert.equal(JSON.stringify(stored.records).includes("CANARY"), false);
      repository.append = () => { throw new Error("timeline-ordinary-cap-exceeded"); };
      const refused = withEmergencyTimelineWriter(repository, { stateRoot: root, clock: manualClock(AT), build: "test" });
      assert.throws(() => refused.append({}), /cap-exceeded/u);
      assert.equal(existsSync(join(root, "logs/boot.jsonl")), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("refuses oversized and malformed emergency files without adopting them", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-emergency-"));
    try {
      mkdirSync(join(root, "logs")); writeFileSync(join(root, "logs/boot.jsonl"), "x".repeat(5 * 1024 * 1024 + 1));
      const { repository, records } = fixture();
      assert.throws(() => importEmergencyFaults(root, repository), /cap-exceeded/u);
      writeFileSync(join(root, "logs/boot.jsonl"), '{"old":true}\n');
      assert.throws(() => importEmergencyFaults(root, repository), /boot-log-invalid/u); assert.equal(records.length, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("SSE lifecycle settlement", () => {
  it("records connect and one actual close across cancellation races", async () => {
    const events: string[] = [];
    let closed = 0;
    const connection: DashboardStreamConnection = { initial: [], pending: 0,
      next: async () => undefined, close: () => { closed++; } };
    const reader = dashboardEventStreamBody(connection, phase => events.push(phase)).getReader();
    await reader.read(); await reader.cancel();
    assert.deepEqual(events, ["started", "settled"]); assert.equal(closed, 1);
  });
  it("records actual stream failure once and preserves the original error", async () => {
    const events: string[] = [];
    const connection: DashboardStreamConnection = { initial: [], pending: 0,
      next: async () => { throw new Error("stream-error"); }, close: () => {} };
    const reader = dashboardEventStreamBody(connection, phase => events.push(phase)).getReader();
    await assert.rejects(reader.read(), /stream-error/u);
    assert.deepEqual(events, ["started", "failed"]);
  });
});
