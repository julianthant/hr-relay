import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parsePrototypeRestartManagerHolders, runPrototypeRestartManagerScenario } from "./windows-native-prototype.js";
import type { PrototypeRestartManagerScenario } from "./windows-native-prototype.js";

function record(pid = 123, birth = (1n << 60n) + 99n): Buffer {
  const bytes = Buffer.alloc(668);
  bytes.writeUInt32LE(pid, 0);
  bytes.writeUInt32LE(Number(birth & 0xffffffffn), 4);
  bytes.writeUInt32LE(Number(birth >> 32n), 8);
  Buffer.from("owned-node\0", "utf16le").copy(bytes, 12);
  bytes.writeUInt32LE(5, 652);
  bytes.writeUInt32LE(1, 656);
  bytes.writeUInt32LE(1, 660);
  bytes.writeInt32LE(1, 664);
  return bytes;
}
function script(overrides: Partial<PrototypeRestartManagerScenario> = {}): PrototypeRestartManagerScenario {
  return { startStatus: 0, registerStatus: 0, endStatus: 0, replies: [
    { status: 234, needed: 1, count: 0, rebootReasons: undefined, bytes: Buffer.alloc(0) },
    { status: 0, needed: 1, count: 1, rebootReasons: 0, bytes: record() },
  ], ...overrides };
}
function unproved(input: PrototypeRestartManagerScenario, pattern: RegExp) {
  const result = runPrototypeRestartManagerScenario(input);
  assert.equal(result.outcome.kind, "unproved");
  if (result.outcome.kind !== "unproved") throw new Error("expected-unproved");
  assert.match(result.outcome.error.message, pattern);
  return result;
}

describe("Restart Manager portable protocol contracts — diagnostic only", () => {
  it("parses SDK stride and two DWORD birth time without aligned uint64 padding", () => {
    const holders = parsePrototypeRestartManagerHolders(Buffer.concat([record(), record(456, 1234n)]), 2);
    assert.equal(holders.length, 2);
    assert.deepEqual(holders[0], { pid: 123, birthFileTime: (1n << 60n) + 99n, name: "owned-node",
      serviceName: "", applicationType: 5, appStatus: 1, terminalSessionId: 1, restartable: true });
    assert.equal(holders[1].pid, 456);
    assert.equal(holders[1].birthFileTime, 1234n);
  });

  it("completes resizing and checked session closure before returning diagnostics", () => {
    const result = runPrototypeRestartManagerScenario(script());
    assert.equal(result.outcome.kind, "complete");
    if (result.outcome.kind !== "complete") throw new Error("expected-complete");
    assert.equal(result.outcome.snapshot.completeness, "complete");
    assert.equal(result.outcome.snapshot.authority, "diagnostic-only");
    assert.equal(result.outcome.snapshot.holders.length, 1);
    assert.deepEqual(result.calls.map(call => call.operation), ["start", "register", "list", "list", "end"]);
    assert.deepEqual(result.calls.filter(call => call.operation === "list").map(call => call.capacity), [0, 1]);
    assert.equal(result.outstandingResourceCount, 0);
  });

  it("keeps a complete empty response diagnostic-only", () => {
    const result = runPrototypeRestartManagerScenario(script({ replies: [
      { status: 0, needed: 0, count: 0, rebootReasons: 0, bytes: Buffer.alloc(0) },
    ] }));
    assert.equal(result.outcome.kind, "complete");
    if (result.outcome.kind !== "complete") throw new Error("expected-complete");
    assert.deepEqual(result.outcome.snapshot, { completeness: "complete", authority: "diagnostic-only", rebootReasons: 0, holders: [] });
    assert.equal(result.outstandingResourceCount, 0);
  });

  it("handles a growing holder population and refuses a nonprogressing or excessive resize", () => {
    const result = runPrototypeRestartManagerScenario(script({ replies: [
      { status: 234, needed: 1, count: 0, rebootReasons: 0, bytes: Buffer.alloc(0) },
      { status: 234, needed: 2, count: 0, rebootReasons: 0, bytes: Buffer.alloc(668) },
      { status: 0, needed: 2, count: 2, rebootReasons: 0, bytes: Buffer.concat([record(), record(456)]) },
    ] }));
    assert.equal(result.outcome.kind, "complete");
    assert.deepEqual(result.calls.filter(call => call.operation === "list").map(call => call.capacity), [0, 1, 2]);
    for (const needed of [0, 1025, NaN, -1, "1"]) {
      const refused = unproved(script({ replies: [{ status: 234, needed, count: 0, rebootReasons: 0, bytes: Buffer.alloc(0) }] }), /native-rm-/u);
      assert.equal(refused.outstandingResourceCount, 0);
    }
    unproved(script({ replies: [
      { status: 234, needed: 1, count: 0, rebootReasons: 0, bytes: Buffer.alloc(0) },
      { status: 234, needed: 1, count: 0, rebootReasons: 0, bytes: Buffer.alloc(668) },
    ] }), /native-rm-resize-unproved/u);
    const replies = Array.from({ length: 8 }, (_, i) => ({ status: 234, needed: 2 ** i,
      count: 0, rebootReasons: 0, bytes: Buffer.alloc(i === 0 ? 0 : 668 * 2 ** (i - 1)) }));
    unproved(script({ replies }), /native-rm-query-bound/u);
  });

  it("never converts API errors or contradictory counts into an empty result", () => {
    const start = unproved(script({ startStatus: 121 }), /native-rm-start-unproved/u);
    assert.deepEqual(start.calls.map(call => call.operation), ["start"]);
    const registered = unproved(script({ registerStatus: 5 }), /native-rm-register-unproved/u);
    assert.deepEqual(registered.calls.map(call => call.operation), ["start", "register", "end"]);
    for (const status of [5, 6, 121, 1223, -1, NaN, "0"]) {
      const result = unproved(script({ replies: [{ status, needed: 0, count: 0, rebootReasons: 0, bytes: Buffer.alloc(0) }] }), /native-rm-/u);
      assert.equal(result.outstandingResourceCount, 0);
    }
    for (const reply of [
      { status: 0, needed: 1, count: 0, rebootReasons: 0, bytes: Buffer.alloc(0) },
      { status: 0, needed: 0, count: 1, rebootReasons: 0, bytes: Buffer.alloc(0) },
      { status: 0, needed: 0, count: 0, rebootReasons: 32, bytes: Buffer.alloc(0) },
    ]) unproved(script({ replies: [reply] }), /native-rm-/u);
  });

  it("rejects malformed, truncated, duplicate and unterminated holder records", () => {
    assert.throws(() => parsePrototypeRestartManagerHolders(record().subarray(0, 667), 1), /native-rm-record-size/u);
    assert.throws(() => parsePrototypeRestartManagerHolders(Buffer.concat([record(), record()]), 2), /native-rm-duplicate-holder/u);
    for (const mutate of [
      (bytes: Buffer) => bytes.writeUInt32LE(0, 0),
      (bytes: Buffer) => bytes.fill(0, 4, 12),
      (bytes: Buffer) => bytes.fill(0x41, 12, 524),
      (bytes: Buffer) => bytes.writeUInt16LE(0xd800, 12),
      (bytes: Buffer) => bytes.writeUInt32LE(6, 652),
      (bytes: Buffer) => bytes.writeUInt32LE(0x100, 656),
    ]) {
      const bytes = record(); mutate(bytes);
      assert.throws(() => parsePrototypeRestartManagerHolders(bytes, 1), /native-rm-/u);
    }
  });

  it("retains an actual failed session and both query and close failures", () => {
    const closed = unproved(script({ endStatus: 121 }), /native-rm-end-unproved/u);
    assert.equal(closed.outstandingResourceCount, 1);
    assert.deepEqual(closed.retainedStates, ["unproved"]);
    assert.equal(closed.calls.filter(call => call.operation === "end").length, 1);
    const combined = unproved(script({ registerStatus: 5, endStatus: 121 }), /native-rm-diagnostic-close-unproved/u);
    assert.equal(combined.outcome.kind, "unproved");
    if (combined.outcome.kind !== "unproved") throw new Error("expected-unproved");
    assert.ok(combined.outcome.error instanceof AggregateError);
    assert.equal(combined.outcome.error.errors.length, 2);
    assert.equal(combined.outstandingResourceCount, 1);
  });
});
