import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, it } from "vitest";
import { proveProfileRootsUnused } from "../../../src/backend/storage/maintenance/process-closure.js";
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

  it("reports both owned live holders with independent OS birth times, then observes their closure", async () => {
    const path = fixture();
    const peers = Array.from({ length: 2 }, () => {
      const child = spawn(process.execPath, [peer, "hold", path], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
      const closed = once(child, "close");
      const ready = Promise.race([once(child, "message"), closed.then(() => { throw new Error("native-rm-peer-closed-before-ready"); })]);
      return { child, closed, ready };
    });
    try {
      for (const owned of peers) {
        const received: unknown = await owned.ready;
        assert.ok(Array.isArray(received));
        const message: unknown = received[0];
        assert.deepEqual(message, { kind: "held" });
        assert.equal(owned.child.exitCode, null);
      }
      const ids = peers.map(owned => {
        assert.ok(typeof owned.child.pid === "number" && owned.child.pid > 0);
        return owned.child.pid;
      });
      const birthScript = fileURLToPath(new URL("../../support/fixtures/windows-native/process-birth.ps1", import.meta.url));
      const raw: unknown = JSON.parse(execFileSync(win32.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", birthScript,
          "-OwnedPidsJson", JSON.stringify(ids)], { encoding: "utf8", timeout: 5000 }));
      assert.ok(Array.isArray(raw) && raw.length === ids.length);
      const expected = raw.map((entry: unknown, index: number) => {
        assert.ok(typeof entry === "object" && entry !== null && "pid" in entry && entry.pid === ids[index]
          && "birthFileTime" in entry && typeof entry.birthFileTime === "string" && /^[1-9]\d*$/u.test(entry.birthFileTime));
        return { pid: ids[index], birthFileTime: BigInt(entry.birthFileTime) };
      });
      for (const owned of peers) assert.equal(owned.child.exitCode, null);
      const live = native.diagnoseHolders([path]);
      assert.equal(live.completeness, "complete");
      assert.equal(live.authority, "diagnostic-only");
      for (const identity of expected) {
        const holder = live.holders.find(entry => entry.pid === identity.pid && entry.birthFileTime === identity.birthFileTime);
        assert.ok(holder !== undefined, "native-rm-owned-holder-missing");
        assert.ok(holder.name.length > 0 && holder.name.length <= 255, "native-rm-owned-holder-name-unproved");
      }
      assert.equal(native.retainedResourceCount, 0);
      assert.throws(() => native.acquire(path), /native-open-unproved/u);
      for (const owned of peers) owned.child.send({ kind: "close" });
      for (const owned of peers) assert.deepEqual(await owned.closed, [0, null]);
      const after = native.diagnoseHolders([path]);
      assert.equal(after.completeness, "complete");
      assert.equal(after.authority, "diagnostic-only");
      for (const identity of expected) assert.equal(after.holders.some(entry => entry.pid === identity.pid
        && entry.birthFileTime === identity.birthFileTime), false, "native-rm-closed-owned-holder-still-reported");
      assert.equal(readFileSync(path, "utf8"), "retained-source");
    } finally {
      for (const owned of peers) {
        if (owned.child.connected) owned.child.send({ kind: "close" });
        await owned.closed;
      }
    }
  });

  it("keeps Windows maintenance process closure refused and distinguishes owner mismatch", () => {
    const path = fixture(), facts = native.observe(path);
    assert.throws(() => proveProfileRootsUnused([join(path, "..")]), /profile-process-closure-unproved/u);
    assert.throws(() => requirePrototypePrivateFile(facts, "S-1-5-21-0-0-0-999"), /native-owner-refused/u);
    assert.equal(readFileSync(path, "utf8"), "retained-source");
  });
});
