import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, it } from "vitest";
import { privatePathRejects } from "../../../src/backend/storage/private-path.js";
import { requirePrototypePrivateFile, windowsNativePrototype } from "../../support/helpers/windows-native-prototype.js";

const peer = fileURLToPath(new URL("../../support/fixtures/windows-native/peer.mjs", import.meta.url));
const roots: string[] = [];
let native: Awaited<ReturnType<typeof windowsNativePrototype>>;
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "relay-ntfs-prototype-"));
  roots.push(root);
  const path = join(root, "source");
  writeFileSync(path, "retained-source");
  const sid = native.currentSid();
  execFileSync(win32.join("C:\\Windows", "System32", "icacls.exe"), [path, "/inheritance:r", "/grant:r", `*${sid}:(F)`], { stdio: "pipe" });
  requirePrototypePrivateFile(native.observe(path), sid);
  return path;
}
function challenge(action: "read" | "write" | "ads" | "companion" | "replace", path: string): unknown {
  return JSON.parse(execFileSync(process.execPath, [peer, action, path], { encoding: "utf8", timeout: 5000 }));
}

describe.skipIf(process.platform !== "win32")("Windows NTFS prototype — no storage activation", () => {
  beforeAll(async () => { native = await windowsNativePrototype(); });
  afterEach(() => {
    assert.equal(native.retainedResourceCount, 0, "all native resources must have checked closure");
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("binds NTFS identity, owner/DACL and stream facts to a retained handle", () => {
    const path = fixture(), sid = native.currentSid();
    const custody = native.acquire(path);
    try {
      const facts = custody.facts();
      assert.equal(facts.ownerSid, sid);
      assert.equal(facts.protectedDacl, true);
      assert.equal(facts.links, 1);
      assert.equal(facts.fileId.length, 32);
      assert.equal(typeof facts.volume, "bigint");
      assert.deepEqual(facts.streams, [{ name: "::$DATA", size: 15n }]);
      assert.equal(custody.read().toString(), "retained-source");
      assert.deepEqual(challenge("read", path), { ok: false, code: "EBUSY" });
      assert.deepEqual(challenge("write", path), { ok: false, code: "EBUSY" });
      assert.equal(custody.storageAuthorization, "refused-lifetime-fence-unproved");
    } finally { custody.close(); }
    assert.equal(custody.state, "closed");
    assert.throws(() => custody.facts(), /native-custody-not-held/u);
    assert.throws(() => custody.close(), /native-close-state-unproved/u);
    assert.equal(readFileSync(path, "utf8"), "retained-source");
  });

  it("preserves the held object's identity across rename and path replacement", () => {
    const path = fixture(), observed = native.retainObservation(path);
    try {
      const before = observed.facts();
      renameSync(path, `${path}-renamed`);
      writeFileSync(path, "replacement");
      assert.equal(observed.facts().fileId, before.fileId);
      assert.equal(observed.facts().volume, before.volume);
      assert.notEqual(native.observe(path).fileId, before.fileId);
      assert.equal(native.observe(`${path}-renamed`).fileId, before.fileId);
    } finally { observed.close(); }
  });

  it("rejects an external hard link and existing ADS, releasing partial acquisitions", () => {
    const path = fixture();
    const external = mkdtempSync(join(tmpdir(), "relay-ntfs-external-alias-"));
    roots.push(external);
    const alias = join(external, "alias");
    linkSync(path, alias);
    assert.equal(native.observe(path).links, 2);
    assert.throws(() => native.acquire(path), /native-extra-hard-link/u);
    rmSync(alias);
    writeFileSync(`${path}:preexisting`, "stream");
    assert.ok(native.observe(path).streams.some((entry) => entry.name === ":preexisting:$DATA"));
    assert.throws(() => native.acquire(path), /native-named-stream/u);
    assert.equal(readFileSync(path, "utf8"), "retained-source");
  });

  it("rejects a junction and an untrusted DACL principal without following the junction", () => {
    const path = fixture(), root = join(path, ".."), junction = join(root, "junction");
    symlinkSync(root, junction, "junction");
    assert.equal(lstatSync(junction).isSymbolicLink(), true);
    const reparse = native.observeReparse(junction);
    assert.notEqual(reparse.attributes & 0x400, 0);
    assert.equal(reparse.tag, 0xa0000003);
    assert.throws(() => native.acquire(junction), /native-/u);
    execFileSync(win32.join("C:\\Windows", "System32", "icacls.exe"), [path, "/grant", "*S-1-1-0:(R)"], { stdio: "pipe" });
    assert.ok(native.observe(path).dacl.some((ace) => ace.sid === "S-1-1-0"));
    assert.throws(() => native.acquire(path), /native-dacl-principal-refused/u);
  });

  it("refuses an owned process's open file until that process actually closes", async () => {
    const path = fixture();
    const child = spawn(process.execPath, [peer, "hold", path], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const closed = once(child, "close");
    try {
      const received: unknown = await once(child, "message");
      assert.ok(Array.isArray(received));
      const message: unknown = received[0];
      assert.deepEqual(message, { kind: "held" });
      assert.throws(() => native.acquire(path), /native-open-unproved/u);
      child.send({ kind: "close" });
      assert.deepEqual(await closed, [0, null]);
      const custody = native.acquire(path);
      try { assert.equal(custody.read().toString(), "retained-source"); } finally { custody.close(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed; }
    }
  });

  it("exposes the late ADS gap after the final stream check and retains activation refusal", () => {
    const path = fixture(), custody = native.acquire(path);
    try {
      assert.deepEqual(custody.facts().streams.map((stream) => stream.name), ["::$DATA"]);
      assert.deepEqual(challenge("ads", path), { ok: true });
      assert.equal(readFileSync(`${path}:late`, "utf8"), "late-stream");
      assert.ok(custody.facts().streams.some((entry) => entry.name === ":late:$DATA"));
      assert.throws(() => custody.read(), /native-named-stream/u);
      assert.equal(custody.storageAuthorization, "refused-lifetime-fence-unproved");
    } finally { custody.close(); }
    assert.equal(readFileSync(path, "utf8"), "retained-source");
  });

  it("exposes a new namespace member after the final census while the source handle is retained", () => {
    const path = fixture(), root = join(path, ".."), custody = native.acquire(path);
    try {
      const census = readdirSync(root).sort();
      assert.deepEqual(challenge("replace", path), { ok: false, code: "EBUSY" });
      assert.deepEqual(challenge("companion", path), { ok: true });
      assert.notDeepEqual(readdirSync(root).sort(), census);
      assert.equal(custody.read().toString(), "retained-source");
      assert.equal(custody.storageAuthorization, "refused-lifetime-fence-unproved");
    } finally { custody.close(); }
  });

  it("keeps current production privacy refusal and distinguishes owner mismatch", () => {
    const path = fixture(), facts = native.observe(path);
    assert.equal(privatePathRejects(path, lstatSync(path), "file-0600"), true);
    assert.throws(() => requirePrototypePrivateFile(facts, "S-1-5-21-0-0-0-999"), /native-owner-refused/u);
    assert.equal(readFileSync(path, "utf8"), "retained-source");
  });
});
