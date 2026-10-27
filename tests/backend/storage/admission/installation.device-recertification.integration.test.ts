import assert from "node:assert/strict";
import nativeFs, { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { it, vi } from "vitest";
import { z } from "zod";
import { ProfileOnboardingCompletionSchema, ProfileRegistryDocumentSchema } from "../../../../src/models/profiles/profile.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { observeProcessIdentity } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createHistoricalIncompleteProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";

const Continuity = z.object({ device: z.number(), inode: z.number(), digest: z.string(), installationId: z.string(),
  erasures: z.array(z.object({ credentialKey: z.object({ keyId: z.string(), file: z.object({ device: z.number(), inode: z.number(), digest: z.string() }).passthrough() }).passthrough() }).passthrough()) }).passthrough();
const acknowledgement = "recertify-current-files-with-unproved-historical-volume-binding" as const;
const prepare = (workspace: string) => RuntimeAdmission.prepareStoppedDeviceContinuityRecertification(workspace);
type Fixture = Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>;
function drift(f: Fixture) {
  const current = Continuity.parse(JSON.parse(readFileSync(f.controlPath, "utf8"))), prior = structuredClone(current);
  const key = prior.erasures[0]?.credentialKey;
  assert.ok(key); prior.device += 4; key.file.device += 4;
  writeFileSync(f.controlPath, JSON.stringify(prior), { mode: 0o600 });
  return current;
}
function preserved(f: Fixture) {
  return [f.registryPath, f.verifierPath, f.keyPath, f.protectedPath, f.databasePath].map(path => {
    const info = statSync(path);
    return { bytes: readFileSync(path), device: info.dev, inode: info.ino, mode: info.mode };
  });
}
function paths(f: Fixture) {
  return { intent: join(f.workspace, ".tracker/control/device-recertification.json"), receipt: join(f.workspace, ".tracker/control/device-recertification-receipt.json") };
}
it("recertifies only two explicitly authorized device witnesses, preserving the incomplete profile and ordinary validation", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    const current = drift(f), before = preserved(f);
    assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"), /profile-registry-continuity-mismatch/);
    const held = await prepare(f.workspace);
    try {
      assert.equal(held.capture.historicalVolumeBinding, "unproved");
      held.recertify({ captureDigest: held.capture.digest, acknowledgement });
      held.recertify({ captureDigest: held.capture.digest, acknowledgement });
    } finally { held.release(); }
    assert.deepEqual(Continuity.parse(JSON.parse(readFileSync(f.controlPath, "utf8"))), current);
    assert.deepEqual(preserved(f), before);
    assert.equal(existsSync(paths(f).intent), false); assert.equal(existsSync(paths(f).receipt), true);
    const replay = await prepare(f.workspace);
    try { replay.recertify({ captureDigest: replay.capture.digest, acknowledgement }); }
    finally { replay.release(); }
    const machine = acquireEntrypointAdmission(f.workspace, "exclusive");
    try {
      const registry = machine.readProfileRegistry();
      assert.equal(registry.profiles.length, 1); assert.equal(registry.activeProfileId, f.profileId);
      assert.equal(registry.profiles[0]?.registration.onboardingCompletion, undefined);
    } finally { machine.release(); }
    const invalid = Continuity.parse(JSON.parse(readFileSync(f.controlPath, "utf8"))); invalid.device += 4;
    writeFileSync(f.controlPath, JSON.stringify(invalid));
    assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"), /profile-registry-continuity-mismatch/);
  } finally { await f.close(); }
});

it("requires the exact capture acknowledgement and preserves stable capture digests across stopped preparation", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    drift(f); const before = readFileSync(f.controlPath), first = await prepare(f.workspace), digest = first.capture.digest;
    first.release(); const held = await prepare(f.workspace);
    try {
      assert.equal(held.capture.digest, digest);
      assert.throws(() => held.recertify({ captureDigest: "0".repeat(64), acknowledgement }), /authorization-mismatch/);
      assert.throws(() => Reflect.apply(held.recertify.bind(held), held, [{ captureDigest: digest }]), /acknowledgement/);
      assert.equal(readFileSync(f.controlPath).equals(before), true); assert.equal(existsSync(paths(f).intent), false);
    } finally { held.release(); }
  } finally { await f.close(); }
});

for (const field of ["registry-inode", "registry-digest", "installation-uuid", "key-inode", "key-digest", "key-id", "one-device-only"] as const) {
  it(`refuses ${field} before issuing recertification`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      const current = drift(f), value = Continuity.parse(JSON.parse(readFileSync(f.controlPath, "utf8"))), key = value.erasures[0]?.credentialKey;
      assert.ok(key);
      if (field === "registry-inode") value.inode += 1;
      if (field === "registry-digest") value.digest = "0".repeat(64);
      if (field === "installation-uuid") value.installationId = randomUUID();
      if (field === "key-inode") key.file.inode += 1;
      if (field === "key-digest") key.file.digest = "0".repeat(64);
      if (field === "key-id") key.keyId = randomUUID();
      if (field === "one-device-only") key.file.device = current.device;
      writeFileSync(f.controlPath, JSON.stringify(value)); const before = readFileSync(f.controlPath);
      await assert.rejects(prepare(f.workspace));
      assert.equal(readFileSync(f.controlPath).equals(before), true); assert.equal(existsSync(paths(f).intent), false);
    } finally { await f.close(); }
  });
}

for (const change of ["replacement-key", "protected-bytes", "extra-artifact", "artifact-root-replacement", "credential-mode", "publication", "relocation", "restore"] as const) {
  it(`revalidates ${change} after authorization capture and before any effect`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      drift(f); const held = await prepare(f.workspace), before = readFileSync(f.controlPath);
      try {
        if (change === "replacement-key") { copyFileSync(f.keyPath, `${f.keyPath}.replacement`); renameSync(`${f.keyPath}.replacement`, f.keyPath); }
        if (change === "protected-bytes") writeFileSync(f.protectedPath, "{}");
        if (change === "credential-mode") chmodSync(join(f.profileRoot, "credentials"), 0o755);
        if (change === "artifact-root-replacement") {
          const root = join(f.stateRoot, "artifacts"); renameSync(root, `${root}.prior`); mkdirSync(root, { mode: 0o700 });
          copyFileSync(join(`${root}.prior`, ".runtime-owner.json"), join(root, ".runtime-owner.json"));
        }
        if (change === "extra-artifact") writeFileSync(join(f.profileRoot, "artifacts", "unowned"), "fixture", { mode: 0o600 });
        if (change === "publication") writeFileSync(join(f.workspace, ".tracker/control/profile-publication.json"), "{}", { mode: 0o600 });
        if (change === "relocation" || change === "restore") writeFileSync(join(f.workspace, ".tracker/control/journal.json"), JSON.stringify({ phase: change === "restore" ? "restoring" : "preparing" }), { mode: 0o600 });
        assert.throws(() => held.recertify({ captureDigest: held.capture.digest, acknowledgement }));
        assert.equal(readFileSync(f.controlPath).equals(before), true); assert.equal(existsSync(paths(f).intent), false);
      } finally { held.release(); }
    } finally { await f.close(); }
  });
}

for (const boundary of ["intent", "control", "receipt", "settlement"] as const) {
  it(`resumes the exact durable ${boundary} prefix without repeating source mutations`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      const current = drift(f), before = preserved(f), held = await prepare(f.workspace), digest = held.capture.digest;
      const { intent, receipt } = paths(f), rename = nativeFs.renameSync, unlink = nativeFs.unlinkSync;
      let fired = false;
      const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((from, to) => {
        rename(from, to);
        if (!fired && String(to) === (boundary === "intent" ? intent : boundary === "control" ? f.controlPath : boundary === "receipt" ? receipt : "")) {
          fired = true; throw new Error("fixture recertification interruption");
        }
      });
      const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
        if (!fired && boundary === "settlement" && String(path) === intent) { fired = true; throw new Error("fixture recertification interruption"); }
        unlink(path);
      });
      syncBuiltinESMExports();
      try { assert.throws(() => held.recertify({ captureDigest: digest, acknowledgement }), /fixture recertification interruption/); }
      finally { renameSpy.mockRestore(); unlinkSpy.mockRestore(); syncBuiltinESMExports(); held.release(); }
      assert.equal(fired, true);
      assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"), /device-recertification-pending/);
      const resumed = await prepare(f.workspace);
      try { assert.equal(resumed.capture.digest, digest); resumed.recertify({ captureDigest: digest, acknowledgement }); }
      finally { resumed.release(); }
      assert.deepEqual(Continuity.parse(JSON.parse(readFileSync(f.controlPath, "utf8"))), current);
      assert.deepEqual(preserved(f), before); assert.equal(existsSync(intent), false);
    } finally { await f.close(); }
  });
}

for (const custody of ["preboot-gone", "sameboot-gone", "live", "reused-pid", "uncertain-child", "unreleased-worker"] as const) {
  it(`handles ${custody} server custody without fabricating a release`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      drift(f);
      const directory = join(f.processLockRoot, "server-claims"); mkdirSync(directory, { mode: 0o700 });
      const self = observeProcessIdentity(process.pid); assert.equal(self.state, "alive"); if (self.state !== "alive") throw new Error("fixture self process required");
      const old = custody !== "sameboot-gone", now = new Date().toISOString();
      const record = { schemaVersion: 2, name: "server", pid: custody === "live" || custody === "reused-pid" ? process.pid : 2_000_000_000,
        processIdentity: custody === "live" ? self.identity : { platform: "darwin", startToken: old ? "1" : String(Math.floor(Date.now() / 1000)) },
        acquisitionId: randomUUID(), generation: 1, acquiredAt: old ? "2000-01-01T00:00:00.000Z" : now, releasedAt: null };
      const path = join(directory, "1.claim.json"); writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
      if (custody === "uncertain-child") writeFileSync(join(directory, ".unpublished-child.tmp"), "{}", { mode: 0o600 });
      if (custody === "unreleased-worker") {
        const workerId = "recertification-worker", acquisitionId = randomUUID(), workers = join(f.processLockRoot, "workers");
        mkdirSync(workers, { recursive: true, mode: 0o700 });
        writeFileSync(join(workers, `${acquisitionId}.lock.json`), JSON.stringify({ schemaVersion: 3, name: "workers", workerId,
          pid: 2_000_000_000, processIdentity: { platform: "darwin", startToken: "1" }, acquisitionId,
          acquiredAt: "2000-01-01T00:00:00.000Z", releasedAt: null }), { mode: 0o600 });
      }
      const before = readFileSync(path);
      if (custody === "preboot-gone") {
        const held = await prepare(f.workspace);
        try { held.recertify({ captureDigest: held.capture.digest, acknowledgement }); }
        finally { held.release(); }
        assert.equal(readFileSync(path).equals(before), true);
        assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace), /process-custody-unproved/);
      } else await assert.rejects(prepare(f.workspace), /custody-unproved/);
      assert.equal(readFileSync(path).equals(before), true);
    } finally { await f.close(); }
  });
}

for (const shape of ["finished", "duo", "second-profile", "operation", "erasure-history"] as const) {
  it(`refuses the unsupported ${shape} shape before publishing any repair`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      drift(f);
      const registry = ProfileRegistryDocumentSchema.parse(JSON.parse(readFileSync(f.registryPath, "utf8"))), row = registry.profiles[0]; assert.ok(row);
      if (shape === "finished") row.registration.onboardingCompletion = ProfileOnboardingCompletionSchema.parse({ generation: 1, finishId: randomUUID(), finishedAt: new Date().toISOString(),
        key: { receiptDigest: "a".repeat(64), confirmation: "operator" }, touch: { receiptDigest: "b".repeat(64), softwareInterceptionDisabled: true, operatorConfirmedAt: new Date().toISOString() } });
      if (shape === "duo") row.duoState = "ready";
      if (shape === "second-profile") registry.profiles.push({ ...row, profileId: randomUUID() });
      if (shape === "operation") writeFileSync(join(f.machineRoot, "operations", `${randomUUID()}.json`), "{}", { mode: 0o600 });
      if (shape === "erasure-history") { mkdirSync(join(f.machineRoot, "erasures"), { recursive: true, mode: 0o700 }); writeFileSync(join(f.machineRoot, "erasures", `${f.profileId}.json`), "{}", { mode: 0o600 }); }
      writeFileSync(f.registryPath, JSON.stringify(registry));
      const before = readFileSync(f.controlPath);
      await assert.rejects(prepare(f.workspace));
      assert.equal(readFileSync(f.controlPath).equals(before), true); assert.equal(existsSync(paths(f).intent), false);
    } finally { await f.close(); }
  });
}

it("retains an unowned pre-intent stage and refuses to guess a recovery", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    drift(f); const before = readFileSync(f.controlPath);
    writeFileSync(join(f.workspace, `.tracker/control/.device-recertification.${randomUUID()}.stage`), "{}", { mode: 0o600 });
    await assert.rejects(prepare(f.workspace), /stage-unowned/);
    assert.equal(readFileSync(f.controlPath).equals(before), true); assert.equal(existsSync(paths(f).intent), false);
  } finally { await f.close(); }
});

it("rejects a substituted staged document before changing the original continuity", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    drift(f); const held = await prepare(f.workspace), digest = held.capture.digest, { intent } = paths(f), rename = nativeFs.renameSync;
    const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((from, to) => { rename(from, to); if (String(to) === intent) throw new Error("fixture durable intent"); });
    syncBuiltinESMExports();
    try { assert.throws(() => held.recertify({ captureDigest: digest, acknowledgement }), /fixture durable intent/); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); held.release(); }
    const control = join(f.workspace, ".tracker/control"), stageName = readdirSync(control).find(name => name.startsWith(".device-recertification.")); assert.ok(stageName);
    const stage = join(control, stageName), altered = Continuity.extend({ generation: z.number() }).parse(JSON.parse(readFileSync(stage, "utf8")));
    altered.generation += 1; writeFileSync(stage, JSON.stringify(altered));
    const journal = z.object({ stage: z.object({ device: z.number(), inode: z.number(), digest: z.string() }) }).passthrough().parse(JSON.parse(readFileSync(intent, "utf8")));
    journal.stage.digest = createHash("sha256").update(readFileSync(stage)).digest("hex"); writeFileSync(intent, JSON.stringify(journal));
    const before = readFileSync(f.controlPath), resumed = await prepare(f.workspace);
    try { assert.throws(() => resumed.recertify({ captureDigest: digest, acknowledgement })); }
    finally { resumed.release(); }
    assert.equal(readFileSync(f.controlPath).equals(before), true, "a substituted stage must never replace continuity");
  } finally { await f.close(); }
});

for (const descendant of [
  { directory: "operations", name: "unowned.tmp", kind: "file" },
  { directory: "erasures", name: "unowned", kind: "file" },
  { directory: "credential-keys", name: ".retained", kind: "file" },
  { directory: "operations", name: ".unfinished", kind: "directory" },
] as const) for (const timing of ["before", "after"] as const) {
  it(`refuses unknown ${descendant.directory}/${descendant.name} ${timing} capture without changing continuity`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    let held: Awaited<ReturnType<typeof prepare>> | undefined;
    try {
      drift(f); const before = readFileSync(f.controlPath);
      if (timing === "after") held = await prepare(f.workspace);
      const directory = join(f.machineRoot, descendant.directory), path = join(directory, descendant.name);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (descendant.kind === "directory") mkdirSync(path, { mode: 0o700 });
      else writeFileSync(path, "unowned fixture custody", { mode: 0o600 });
      if (held === undefined) await assert.rejects(prepare(f.workspace), /device-recertification-membership-refused/);
      else assert.throws(() => held?.recertify({ captureDigest: held.capture.digest, acknowledgement }), /device-recertification-membership-refused/);
      assert.equal(readFileSync(f.controlPath).equals(before), true); assert.equal(existsSync(paths(f).intent), false);
    } finally { held?.release(); await f.close(); }
  });
}
