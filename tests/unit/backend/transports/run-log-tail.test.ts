import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readEventStreamLinesFrom, type EventStreamFile, type EventStreamTailIo } from "../../../../src/backend/storage/events/jsonl-streams.js";

function fakeIo(initial: Readonly<Record<string, string>>) {
  const files = new Map(Object.entries(initial).map(([path, value]) => [path, Buffer.from(value)]));
  const reads: Array<{ path: string; start: number; length: number }> = [];
  const io: EventStreamTailIo = {
    list: () => [...files.keys()].sort().map(path => ({ stream: "notes", workflow: "onboarding",
      date: "2026-10-02", path }) satisfies EventStreamFile),
    size: file => files.get(file.path)!.length,
    read: (file, start, length) => { reads.push({ path: file.path, start, length });
      return files.get(file.path)!.subarray(start, start + length); },
  };
  return { io, files, reads };
}

describe("bounded complete-line JSONL tail", () => {
  it("defers a valid second file when the first consumed the residual byte budget", () => {
    const fake = fakeIo({ a: "first\n", b: "second\n" });
    const first = readEventStreamLinesFrom("unused", "notes", new Map(), undefined,
      { maxBytes: 8, maxLines: 20 }, fake.io);
    assert.deepEqual(first.lines.map(line => line.text), ["first"]);
    assert.equal(first.hasMore, true);
    assert.deepEqual(fake.reads.map(read => read.path), ["a"]);
    const second = readEventStreamLinesFrom("unused", "notes", first.cursors, undefined,
      { maxBytes: 8, maxLines: 20 }, fake.io);
    assert.deepEqual(second.lines.map(line => line.text), ["second"]);
    assert.equal(second.hasMore, false);
    const idle = readEventStreamLinesFrom("unused", "notes", second.cursors, undefined,
      { maxBytes: 8, maxLines: 20 }, fake.io);
    assert.equal(idle.lines.length, 0);
    assert.equal(idle.bytesRead, 0);
  });

  it("retains partial tails and refuses an oversized incomplete line", () => {
    const fake = fakeIo({ a: "one\npartial" });
    const first = readEventStreamLinesFrom("unused", "notes", new Map(), undefined,
      { maxBytes: 16, maxLines: 20 }, fake.io);
    assert.deepEqual(first.lines.map(line => line.text), ["one"]);
    assert.equal(first.cursors.get("a")?.bytesConsumed, 4);
    fake.files.set("a", Buffer.from("one\npartial\n"));
    const second = readEventStreamLinesFrom("unused", "notes", first.cursors, undefined,
      { maxBytes: 16, maxLines: 20 }, fake.io);
    assert.deepEqual(second.lines.map(line => line.text), ["partial"]);
    fake.files.set("a", Buffer.from(`one\npartial\n${"x".repeat(16)}`));
    assert.throws(() => readEventStreamLinesFrom("unused", "notes", second.cursors, undefined,
      { maxBytes: 16, maxLines: 20 }, fake.io), /beyond the bounded tail read/u);
  });

  it("does not let an unchanged partial file starve a later complete file", () => {
    const fake = fakeIo({ a: "xxxxx", b: "123456\n" });
    const first = readEventStreamLinesFrom("unused", "notes", new Map(), undefined,
      { maxBytes: 8, maxLines: 20 }, fake.io);
    assert.deepEqual(first.lines, []);
    assert.equal(first.hasMore, true);
    assert.equal(first.cursors.get("a")?.bytesConsumed, 0);
    const second = readEventStreamLinesFrom("unused", "notes", first.cursors, undefined,
      { maxBytes: 8, maxLines: 20 }, fake.io);
    assert.deepEqual(second.lines.map(line => line.text), ["123456"]);
    assert.equal(second.bytesRead, 7);
    assert.equal(second.hasMore, false);
    fake.files.set("a", Buffer.from("xxxxx\n"));
    const third = readEventStreamLinesFrom("unused", "notes", second.cursors, undefined,
      { maxBytes: 8, maxLines: 20 }, fake.io);
    assert.deepEqual(third.lines.map(line => line.text), ["xxxxx"]);
  });
});
