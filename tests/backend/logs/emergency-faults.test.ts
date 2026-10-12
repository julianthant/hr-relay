import assert from "node:assert/strict";
import { existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it } from "vitest";
import { appendEmergencyFault,importEmergencyFaults,withEmergencyTimelineWriter } from "../../../src/backend/logs/emergency-faults.js";
import { TimelineEventRecordSchema,type TimelineEventRecord,type TimelineRepository } from "../../../src/models/events/timeline.js";
import { manualClock } from "../../../src/rules/time/clock.js";
const AT = new Date("2026-10-10T12:00:00.000Z");
function fixture() {
  const records: TimelineEventRecord[] = [];
  const repository: TimelineRepository = { withReadSnapshot: read => read(),
    append(input) { const record = TimelineEventRecordSchema.parse({ ...(input as object), cursor: records.length + 1 });
      const existing = records.find(row => row.eventId === record.eventId);
      if (existing !== undefined) return { state: "existing", record: existing };
      records.push(record); return { state: "inserted", record }; },
    get: id => records.find(row => row.eventId === id), page: () => records, highWaterMark: () => records.length, pruneBefore: () => 0, confirmedActionHeads: () => [] };
  return { records, repository };
}
describe("bounded native debug events", () => {
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
