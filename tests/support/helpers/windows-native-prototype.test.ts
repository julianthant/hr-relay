import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parsePrototypeAcl, parsePrototypeSid, parsePrototypeStreams, windowsNativePrototype } from "./windows-native-prototype.js";

describe("Windows prototype portable parsing contracts (not native proof)", () => {
  it("keeps SID authority and subauthorities exact and refuses malformed lengths", () => {
    const sid = Buffer.from([1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]);
    assert.equal(parsePrototypeSid(sid), "S-1-5-18");
    assert.throws(() => parsePrototypeSid(sid.subarray(0, 11)), /native-sid-length/u);
    sid[1] = 16;
    assert.throws(() => parsePrototypeSid(sid), /native-sid-malformed/u);
  });
  it("parses an explicit allow ACE and refuses unsupported/truncated ACEs", () => {
    const acl = Buffer.alloc(28);
    acl[0] = 2; acl.writeUInt16LE(28, 2); acl.writeUInt16LE(1, 4);
    acl.writeUInt16LE(20, 10); acl.writeUInt32LE(0x1f01ff, 12);
    Buffer.from([1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]).copy(acl, 16);
    assert.deepEqual(parsePrototypeAcl(acl), [{ type: 0, flags: 0, mask: 0x1f01ff, sid: "S-1-5-18" }]);
    acl[8] = 5;
    assert.throws(() => parsePrototypeAcl(acl), /native-ace-unsupported/u);
    assert.throws(() => parsePrototypeAcl(acl.subarray(0, 20)), /native-acl-malformed/u);
  });
  it("keeps stream sizes as bigint and refuses missing/malformed stream data", () => {
    const name = Buffer.from("::$DATA", "utf16le"), bytes = Buffer.alloc(24 + name.length);
    bytes.writeUInt32LE(name.length, 4); bytes.writeBigInt64LE(1n << 54n, 8); name.copy(bytes, 24);
    assert.deepEqual(parsePrototypeStreams(bytes), [{ name: "::$DATA", size: 1n << 54n }]);
    bytes.writeUInt32LE(1, 0);
    assert.throws(() => parsePrototypeStreams(bytes), /native-stream-offset/u);
    assert.throws(() => parsePrototypeStreams(Buffer.alloc(0)), /native-stream-truncated/u);
  });
  it.skipIf(process.platform === "win32")("refuses the non-Windows loader before dependency load", async () => {
    await assert.rejects(windowsNativePrototype(), /native-platform-required/u);
  });
});
