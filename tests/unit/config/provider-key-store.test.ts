import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { chmodSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, it, vi } from "vitest";
import { SourceSurfaceIdSchema } from "../../../src/domain/ids.js";
import { createProviderKeyStore, ProviderKeyStoreUnknownError, type ProviderKeyJournal, type ProviderKeyWriteRequest } from "../../../src/infra/config/provider-key-store.js";
import { observeProcessIdentity } from "../../../src/infra/sqlite/runtime-process-locks.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const markedFingerprint = () => "b".repeat(64);
function latest(committed: Set<string>) {
  const newest = [...committed].map(row => {
    const [commandId, writeId, revision] = row.split(":");
    return { commandId, writeId, revision: Number(revision) };
  }).sort((a, b) => b.revision - a.revision)[0];
  return newest;
}
function pendingIdentity(envPath: string) {
  const metadata = JSON.parse(readFileSync(`${envPath}.meta`, "utf8")) as { pending: { receipt: { commandId: string; writeId: string; receiptId: string } } };
  const { commandId, writeId, receiptId } = metadata.pending.receipt;
  return { commandId, writeId, receiptId };
}

function fixture(hooks?: Parameters<typeof createProviderKeyStore>[0]["hooks"]) {
  const root = mkdtempSync(join(tmpdir(), "hr-provider-store-"));
  roots.push(root);
  const envPath = join(root, ".env.providers");
  writeFileSync(envPath, "GEMINI_API_KEY='old'\nGEMINI_API_KEY3='sparse'\n", { mode: 0o600 });
  const committed = new Set<string>();
  const used = new Set<string>();
  const journal: ProviderKeyJournal = {
    committed: anchor => committed.has(`${anchor.commandId}:${anchor.writeId}:${anchor.revision}`),
    latestCommitted: () => latest(committed),
    identityUsed: (commandId, writeId) => used.has(commandId) || used.has(writeId),
    hasHistory: () => committed.size > 0,
  };
  const store = () => createProviderKeyStore({ envPath, journal, markedFingerprint, hooks });
  const request = (operations: ProviderKeyWriteRequest["operations"], identity = 1): ProviderKeyWriteRequest => ({
    commandId: `${String(identity).repeat(8)}-1111-4111-8111-111111111111`,
    writeId: `${String(identity).repeat(8)}-2222-4222-8222-222222222222`,
    expectedRevision: 1, expectedSourceVersionToken: store().read().sourceVersionToken!,
    schemaHash: "a".repeat(64), requestedAt: "2026-09-26T12:00:00.000Z",
    requestedBy: "local-operator", source: SourceSurfaceIdSchema.parse("settings-surface"), operations,
  });
  const settle = (commandId: string, writeId: string, revision: number) => {
    committed.add(`${commandId}:${writeId}:${revision}`);
    used.add(commandId); used.add(writeId);
    store().confirmCommitted(commandId, writeId);
  };
  return { root, envPath, committed, used, store, request, settle };
}

function refusal(work: () => unknown, fragment: string) {
  assert.throws(work, error => error instanceof ProviderKeyStoreUnknownError && error.message.includes(fragment));
}

describe("private provider key store", () => {
  it("keeps sparse slots, supports set and clear, and settles only after durable audit", () => {
    const f = fixture();
    const request = f.request({ GROQ_API_KEY8: { set: "new-private" }, GEMINI_API_KEY: { clear: true } });
    const result = f.store().apply(request);
    assert.equal(result.revision, 2);
    assert.equal(f.store().read().state, "pending-after-rename");
    assert.equal(JSON.stringify(f.store().read()).includes("new-private"), false);
    const retry = f.store().retryPending(pendingIdentity(f.envPath));
    assert.deepEqual(retry.request, request);
    refusal(() => f.store().confirmCommitted(request.commandId, request.writeId), "commit-audit-missing");
    f.settle(request.commandId, request.writeId, 2);
    assert.equal(f.store().apply(request).revision, 2);
    refusal(() => f.store().apply({ ...request, operations: { GROQ_API_KEY8: { set: "other" }, GEMINI_API_KEY: { clear: true } } }), "latest-replay-divergent");
    const saved = f.store().read();
    assert.equal(saved.state, "settled");
    assert.deepEqual(saved.slots, { GEMINI_API_KEY3: "sparse", GROQ_API_KEY8: "new-private" });
    const metadata = readFileSync(`${f.envPath}.meta`, "utf8");
    assert.equal(metadata.includes("new-private"), false);
    assert.equal(metadata.includes("sparse"), false);
  });

  it("recovers the exact staged request before rename in a fresh store", () => {
    const f = fixture({ afterPending: () => { throw new Error("crash-before-rename"); } });
    const request = f.request({ GROQ_API_KEY2: { set: "stage-only" } });
    assert.throws(() => f.store().apply(request), /crash-before-rename/u);
    const fresh = createProviderKeyStore({ envPath: f.envPath, markedFingerprint, journal: {
      committed: anchor => f.committed.has(`${anchor.commandId}:${anchor.writeId}:${anchor.revision}`),
      latestCommitted: () => latest(f.committed),
      identityUsed: () => false, hasHistory: () => f.committed.size > 0,
    } });
    assert.equal(fresh.read().state, "pending-before-rename");
    assert.deepEqual(fresh.retryPending(pendingIdentity(f.envPath)).request, request);
    assert.equal(fresh.read().state, "pending-after-rename");
  });

  it("recovers after rename and refuses altered private body or comment", () => {
    const f = fixture({ afterRename: () => { throw new Error("crash-after-rename"); } });
    const request = f.request({ MISTRAL_API_KEY: { set: "pending-secret" } });
    assert.throws(() => f.store().apply(request), /crash-after-rename/u);
    const fresh = createProviderKeyStore({ envPath: f.envPath, markedFingerprint, journal: {
      committed: () => false, identityUsed: () => false, hasHistory: () => false,
      latestCommitted: () => undefined,
    } });
    assert.deepEqual(fresh.retryPending(pendingIdentity(f.envPath)).request, request);
    writeFileSync(f.envPath, readFileSync(f.envPath, "utf8") + "# edit\n", { mode: 0o600 });
    refusal(() => fresh.retryPending(pendingIdentity(f.envPath)), "pending-target-divergent");
  });

  it("rejects stale or divergent source tokens and replays latest before CAS", () => {
    const f = fixture();
    const request = f.request({ SAMBANOVA_API_KEY4: { set: "value" } });
    f.store().apply(request);
    assert.equal(f.store().apply(request).revision, 2);
    assert.deepEqual(f.store().retryPending(pendingIdentity(f.envPath)).request, request);
    refusal(() => f.store().apply({ ...request, operations: { SAMBANOVA_API_KEY4: { set: "different" } } }), "pending-command-divergent");
    f.settle(request.commandId, request.writeId, 2);
    refusal(() => f.store().apply({ ...request, commandId: "33333333-1111-4111-8111-111111111111", writeId: "33333333-2222-4222-8222-222222222222" }), "source-conflict");
    refusal(() => f.store().apply({ ...request, expectedRevision: 2, expectedSourceVersionToken: f.store().read().sourceVersionToken!, writeId: "44444444-2222-4222-8222-222222222222" }), "latest-replay-divergent");
  });

  it("detects same-length inode replacement and restored mtime through the source token", () => {
    const f = fixture();
    const first = f.store().read().sourceVersionToken;
    const original = readFileSync(f.envPath);
    const replacement = join(f.root, "replacement");
    writeFileSync(replacement, original, { mode: 0o600 });
    const old = new Date("2026-01-01T00:00:00Z");
    utimesSync(f.envPath, old, old);
    utimesSync(replacement, old, old);
    renameSync(replacement, f.envPath);
    assert.notEqual(f.store().read().sourceVersionToken, first);
  });

  it("detects same-inode same-size edits despite restored mtime", () => {
    const f = fixture();
    const fixed = new Date("2026-01-01T00:00:00Z");
    utimesSync(f.envPath, fixed, fixed);
    const before = statSync(f.envPath, { bigint: true });
    const token = f.store().read().sourceVersionToken;
    const bytes = readFileSync(f.envPath, "utf8");
    writeFileSync(f.envPath, bytes.replace("old", "new"), { mode: 0o600 });
    utimesSync(f.envPath, fixed, fixed);
    const after = statSync(f.envPath, { bigint: true });
    assert.equal(after.ino, before.ino);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.notEqual(f.store().read().sourceVersionToken, token);
  });

  it("refuses symlink, bad mode, missing header and a rewound settled journal", () => {
    const f = fixture();
    chmodSync(f.envPath, 0o644);
    refusal(() => f.store().read(), "env-identity");
    chmodSync(f.envPath, 0o600);
    const link = join(f.root, "link");
    renameSync(f.envPath, link);
    symlinkSync(link, f.envPath);
    refusal(() => f.store().read(), "env-unavailable");
    rmSync(f.envPath);
    renameSync(link, f.envPath);
    const request = f.request({ GROQ_API_KEY: { set: "secret" } });
    f.store().apply(request);
    f.settle(request.commandId, request.writeId, 2);
    f.committed.clear();
    refusal(() => f.store().read(), "settled-journal-missing");
    f.committed.add(`${request.commandId}:${request.writeId}:2`);
    writeFileSync(f.envPath, "GEMINI_API_KEY='old'\n", { mode: 0o600 });
    refusal(() => f.store().read(), "settled-header-divergent");
  });

  it("refuses a wrong-owner descriptor in a synthetic temp file", () => {
    const f = fixture();
    const actual = fs.fstatSync;
    vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number, options: { bigint: true }) => {
      const stat = actual(fd, options);
      const prototype = Object.getPrototypeOf(stat) as unknown as object;
      return Object.assign(Object.create(prototype) as object, stat, { uid: stat.uid + 1n });
    }) as typeof fs.fstatSync);
    syncBuiltinESMExports();
    refusal(() => f.store().read(), "env-identity");
  });

  it("refuses staged corruption, competing lock, and read race", () => {
    const f = fixture({ afterPending: () => { throw new Error("stop"); } });
    const request = f.request({ OPEN_ROUTER_API_KEY2: { set: "secret" } });
    assert.throws(() => f.store().apply(request), /stop/u);
    const stageName = readdirSync(f.root).find(name => name.endsWith(".stage"));
    assert.ok(stageName);
    writeFileSync(join(f.root, stageName), "GEMINI_API_KEY='wrong'\n", { mode: 0o600 });
    refusal(() => f.store().retryPending(pendingIdentity(f.envPath)), "pending-target-divergent");
    const g = fixture();
    writeFileSync(`${g.envPath}.lock`, "other", { mode: 0o600 });
    refusal(() => g.store().apply(g.request({ GROQ_API_KEY: { set: "secret" } })), "lock-corrupt");
    rmSync(`${g.envPath}.lock`);
    const live = observeProcessIdentity(process.pid);
    assert.equal(live.state, "alive");
    writeFileSync(`${g.envPath}.lock`, JSON.stringify({ pid: process.pid,
      identity: live.identity, acquisitionId: "88888888-8888-4888-8888-888888888888" }), { mode: 0o600 });
    refusal(() => g.store().apply(g.request({ GROQ_API_KEY: { set: "secret" } })), "lock-unavailable");
    rmSync(`${g.envPath}.lock`);
    writeFileSync(`${g.envPath}.lock`, JSON.stringify({ pid: process.pid,
      identity: { platform: process.platform, startToken: "stale-identity" },
      acquisitionId: "99999999-9999-4999-8999-999999999999" }), { mode: 0o600 });
    assert.equal(g.store().apply(g.request({ GROQ_API_KEY: { set: "secret" } })).revision, 2);
    const h = fixture({ afterRead: () => { writeFileSync(h.envPath, "GEMINI_API_KEY='new'\n", { mode: 0o600 }); } });
    refusal(() => h.store().read(), "env-read-race");
  });

  it("accepts a fresh token after settled manual edits but refuses a missing sidecar", () => {
    const f = fixture();
    const first = f.request({ GROQ_API_KEY: { set: "one" } });
    f.store().apply(first);
    f.settle(first.commandId, first.writeId, 2);
    const prior = f.store().read().sourceVersionToken;
    writeFileSync(f.envPath, readFileSync(f.envPath, "utf8") + "# manual note\n", { mode: 0o600 });
    const edited = f.store().read();
    assert.equal(edited.state, "settled");
    assert.notEqual(edited.sourceVersionToken, prior);
    const second = { ...f.request({ GEMINI_API_KEY7: { set: "two" } }, 2),
      expectedRevision: 2, expectedSourceVersionToken: edited.sourceVersionToken };
    assert.equal(f.store().apply(second).revision, 3);
    rmSync(`${f.envPath}.meta`);
    refusal(() => f.store().read(), "managed-history-missing");
  });

  it("refuses a prior settled journal rewind during pending recovery", () => {
    const f = fixture();
    const first = f.request({ GROQ_API_KEY: { set: "one" } });
    f.store().apply(first);
    f.settle(first.commandId, first.writeId, 2);
    const token = f.store().read().sourceVersionToken!;
    const crashStore = createProviderKeyStore({ envPath: f.envPath, markedFingerprint, journal: {
      committed: anchor => f.committed.has(`${anchor.commandId}:${anchor.writeId}:${anchor.revision}`),
      latestCommitted: () => latest(f.committed),
      identityUsed: () => false, hasHistory: () => f.committed.size > 0,
    }, hooks: { afterPending: () => { throw new Error("stop-after-pending"); } } });
    const second = { ...f.request({ MISTRAL_API_KEY2: { set: "two" } }, 2),
      expectedRevision: 2, expectedSourceVersionToken: token };
    assert.throws(() => crashStore.apply(second), /stop-after-pending/u);
    f.committed.clear();
    refusal(() => f.store().retryPending(pendingIdentity(f.envPath)), "settled-journal-missing");
    refusal(() => f.store().apply(second), "settled-journal-missing");
  });

  it("refuses corrupt sidecar and altered pending key value", () => {
    const f = fixture({ afterRename: () => { throw new Error("stop-after-rename"); } });
    const request = f.request({ GROQ_API_KEY2: { set: "alpha" } });
    assert.throws(() => f.store().apply(request), /stop-after-rename/u);
    const text = readFileSync(f.envPath, "utf8");
    writeFileSync(f.envPath, text.replace("alpha", "omega"), { mode: 0o600 });
    refusal(() => f.store().retryPending(pendingIdentity(f.envPath)), "pending-target-divergent");
    writeFileSync(`${f.envPath}.meta`, "{}", { mode: 0o600 });
    refusal(() => f.store().read(), "metadata-corrupt");
  });

  it("rejects a stale recovery identity and a two-file rollback behind the durable head", () => {
    const f = fixture();
    const first = f.request({ GROQ_API_KEY: { set: "one" } });
    f.store().apply(first);
    f.settle(first.commandId, first.writeId, 2);
    const oldEnv = readFileSync(f.envPath);
    const oldMeta = readFileSync(`${f.envPath}.meta`);
    const second = { ...f.request({ GROQ_API_KEY2: { set: "two" } }, 2),
      expectedRevision: 2, expectedSourceVersionToken: f.store().read().sourceVersionToken! };
    f.store().apply(second);
    refusal(() => f.store().retryPending({ ...pendingIdentity(f.envPath), receiptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), "pending-identity-divergent");
    refusal(() => f.store().readPendingRequest({ ...pendingIdentity(f.envPath), receiptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), "pending-identity-divergent");
    f.settle(second.commandId, second.writeId, 3);
    refusal(() => f.store().apply({ ...first, expectedRevision: 3,
      expectedSourceVersionToken: f.store().read().sourceVersionToken! }), "identity-reused");
    writeFileSync(f.envPath, oldEnv, { mode: 0o600 });
    writeFileSync(`${f.envPath}.meta`, oldMeta, { mode: 0o600 });
    refusal(() => f.store().read(), "provider-journal-head-divergent");
  });

  it.each(["afterPending", "afterRename"] as const)("recovers a genuine child exit at %s", phase => {
    const f = fixture();
    const request = f.request({ OPEN_ROUTER_API_KEY5: { set: "synthetic-private" } });
    const script = join(f.root, "exit-child.mjs");
    const moduleUrl = pathToFileURL(join(process.cwd(), "src/infra/config/provider-key-store.ts")).href;
    writeFileSync(script, `import { createProviderKeyStore } from ${JSON.stringify(moduleUrl)};
const [envPath, phase, json] = process.argv.slice(2);
const store = createProviderKeyStore({ envPath, markedFingerprint: () => "${"b".repeat(64)}",
  journal: { committed: () => false, latestCommitted: () => undefined, identityUsed: () => false, hasHistory: () => false },
  hooks: { [phase]: () => process.exit(83) } });
store.apply(JSON.parse(json));
`);
    const child = spawnSync(process.execPath, ["--import", "tsx", script, f.envPath, phase, JSON.stringify(request)],
      { encoding: "utf8" });
    assert.equal(child.status, 83, child.stderr);
    assert.equal(readdirSync(f.root).includes(".env.providers.lock"), true);
    const beforeRead = readFileSync(f.envPath);
    const recovered = f.store().readPendingRequest(pendingIdentity(f.envPath));
    assert.deepEqual(recovered, request);
    assert.deepEqual(readFileSync(f.envPath), beforeRead);
    assert.equal(f.store().apply(recovered).revision, 2);
    assert.equal(f.store().read().state, "pending-after-rename");
  });
});
