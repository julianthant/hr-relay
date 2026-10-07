/**
 * Ref dashboard-surfaces §10.4's retention policy, COMPUTED per archived record (D86/D179).
 *
 * The point of these cases is not that the arithmetic is right — it is that
 * each of the four halves of the policy answers with the arm that is TRUE of
 * it. "Nothing purges this" and "no date is scheduled, but a command takes it"
 * are different facts, and a card that rendered them alike would tell an
 * operator their captures are safe forever.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  EVENT_STREAM_RETENTION_DAYS,
  archiveRetention,
  eventStreamPurgeInstant,
} from "../../../../../src/models/archive/retention.js";
import { localDatePart } from "../../../../../src/rules/time/clock.js";

const NOW = "2026-08-14T18:00:00.000Z";
const ENDED = "2026-07-02T21:30:00.000Z";

function retention(overrides: Partial<Parameters<typeof archiveRetention>[0]> = {}) {
  return archiveRetention({
    now: NOW,
    endedAt: { state: "present", value: ENDED },
    pointerCounts: { artifacts: 2, checkpoints: 3, writeIntents: 1, ledgerLines: 0 },
    ...overrides,
  });
}

describe("an archived run's computed retention", () => {
  it("names the archived row and the ledger PERMANENT, with the rule each rests on", () => {
    const block = retention();
    assert.equal(block.row.state, "permanent");
    assert.equal(block.ledger.state, "permanent");
    // The basis is what makes the claim checkable; a bare "never" is not.
    assert.match(block.row.state === "permanent" ? block.row.basis : "", /archived_runs/);
    assert.match(block.ledger.state === "permanent" ? block.ledger.basis : "", /never pruned/);
  });

  it("schedules the event streams 30 days past the run's own last local day", () => {
    const block = retention();
    assert.equal(block.eventStreams.state, "scheduled");
    if (block.eventStreams.state !== "scheduled") return;
    // The sweep removes a partition when its date is strictly BEFORE the
    // cutoff, so the file survives the whole of its 30th day: the eligible
    // instant is the start of local day (end + 31).
    const expected = eventStreamPurgeInstant(localDatePart(new Date(ENDED)), EVENT_STREAM_RETENTION_DAYS);
    assert.equal(block.eventStreams.purgeAt, expected);
    // Measured against LOCAL midnight of the run's last day, because the
    // sweep partitions by local date — comparing against UTC midnight would
    // fold the operator's timezone offset into the answer.
    const ended = new Date(ENDED);
    const localMidnight = new Date(ended.getFullYear(), ended.getMonth(), ended.getDate());
    const days = (Date.parse(expected) - localMidnight.getTime()) / (24 * 60 * 60 * 1000);
    assert.equal(days, EVENT_STREAM_RETENTION_DAYS + 1);
  });

  it("refuses to name an event-stream date for a run that carries no end instant", () => {
    const block = retention({
      endedAt: { state: "absent", reason: "this run was interrupted and never settled" },
    });
    assert.equal(block.eventStreams.state, "unknown");
    // The absence carries the ROW's own reason forward rather than inventing
    // one, and it does NOT substitute `archivedAt`: archiving is a display act
    // and says nothing about when the events were written.
    assert.match(
      block.eventStreams.state === "unknown" ? block.eventStreams.reason : "",
      /interrupted and never settled/,
    );
  });

  it("calls captured bytes ON-REQUEST, never permanent — one command takes them", () => {
    const block = retention();
    assert.equal(block.evidence.state, "on-request");
    assert.match(block.evidence.state === "on-request" ? block.evidence.basis : "", /purge-run/);
  });

  it("says a run that pointed at nothing has nothing a purge could take", () => {
    const block = retention({ pointerCounts: { artifacts: 0, checkpoints: 0, writeIntents: 0, ledgerLines: 0 } });
    assert.equal(block.evidence.state, "permanent");
    assert.deepEqual({ total: block.pointers.total, retained: block.pointers.retained }, { total: 0, retained: 0 });
  });

  it("counts every named pointer and states that the count is DERIVED, not observed", () => {
    const block = retention({ pointerCounts: { artifacts: 2, checkpoints: 3, writeIntents: 1, ledgerLines: 4 } });
    assert.equal(block.pointers.total, 10);
    assert.equal(block.pointers.retained, 10);
    // The one thing this basis may never do is claim the bytes were read back:
    // the archived detail resolves nothing outside the archive tables.
    assert.match(block.pointers.basis, /not observed/);
  });

  it("refuses a calendar date that is not one", () => {
    assert.throws(() => eventStreamPurgeInstant("2026-8-2", 30), /not a local partition date/);
    assert.throws(() => eventStreamPurgeInstant("not-a-day", 30), /not a local partition date/);
  });
});
