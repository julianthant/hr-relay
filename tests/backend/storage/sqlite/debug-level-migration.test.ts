import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { upgradeDebugLevelRow } from "../../../../src/backend/storage/sqlite/debug-level-migration.js";
import { TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";

describe("stopped debug level conversion", () => {
  it.each([ ["failed", "error"], ["reset", "warn"], ["expired", "warn"], ["acquired", "info"] ])("converts %s to %s without changing identity", (phase, level) => {
    const document = { schemaVersion: 1, eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cursor: 1,
      scope: { kind: "transport", connectionId: "local" }, occurredAt: "2026-11-03T00:00:00.000Z", recordedAt: "2026-11-03T00:00:00.000Z", retentionDate: "2026-11-02",
      source: { kind: "native" }, payload: { kind: "debug", event: { phase, category: "http", correlationId: "retained", build: "test", pid: 1, pinned: false } } };
    assert.equal(TimelineEventRecordSchema.safeParse(document).success, false);
    const row = { kind: "debug", id: document.eventId, payload_json: JSON.stringify(document) };
    const converted = upgradeDebugLevelRow(row);
    assert.deepEqual(TimelineEventRecordSchema.parse(JSON.parse(String(converted.payload_json))),
      { ...document, payload: { kind: "debug", event: { ...document.payload.event, level } } });
    assert.equal(row.payload_json, JSON.stringify(document));
    assert.equal(converted.id, row.id);
  });
  it("refuses corrupt old records and leaves other kinds to their own schema", () => {
    assert.throws(() => upgradeDebugLevelRow({ kind: "debug", payload_json: '{"payload":{"kind":"debug","event":{"phase":"invented"}}}' }));
    assert.deepEqual(upgradeDebugLevelRow({ kind: "span", payload_json: "untouched" }), { kind: "span", payload_json: "untouched" });
  });
});
