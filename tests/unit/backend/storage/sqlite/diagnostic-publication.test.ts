import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, mkdtempSync, realpathSync, rmSync, renameSync, readFileSync, writeFileSync, truncateSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RuntimeAdmission, acquireExclusiveRuntimeAdmission, acquireSharedRuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { composeStorageCommand } from "../../../../../src/backend/app/composition/storage-compose.js";
import { upgradeStorage } from "../../../../../src/backend/storage/maintenance/upgrade.js";
import { acquireRuntimeProcessLock } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { AuthorityDatabase as NativeDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { it } from "vitest";
import { foundationFixture, terminalizeFixtureFailure, failure } from "../../../../support/helpers/database-foundation/fixtures.js";
import { syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";
import { createContentAddressedArtifactWriter, pendingDiagnosticArtifacts, reclaimDiagnosticStages } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createDiagnosticCaptureService } from "../../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { DiagnosticBundleSchema, DiagnosticAttachmentSchema, type DiagnosticBundle } from "../../../../../src/models/trust/diagnostic.js";
import { deriveDiagnosticContentDigest } from "../../../../../src/models/trust/diagnostic-capture.js";

function fixture() {
  const f = foundationFixture();
  const admission = syntheticStateRoot(f.root);
  const writer = createContentAddressedArtifactWriter({ admission });
  const service = createDiagnosticCaptureService({ authority: f.db.authority, artifacts: writer, clock: f.clock, ids: { uuid: randomUUID } });
  const request = (text = "{\"safe\":true}") => ({ trigger: "operator-request" as const, requestedBy: "local-operator", runId: f.run.envelope.runId,
    configFingerprint: f.snapshot.fingerprint, descriptorFingerprint: f.run.envelope.contractFingerprint, fields: [],
    attachments: [{ kind: "console-summary" as const, mediaType: "application/json", sensitivity: "redacted" as const, bytes: Buffer.from(text) }] });
  const inventory = () => existsSync(admission.artifactRoot) ? readdirSync(admission.artifactRoot).sort() : [];
  return { ...f, admission, writer, service, request, inventory, dispose: () => { admission.release(); f.dispose(); } };
}

function withAttachments(base: DiagnosticBundle, attachments: DiagnosticBundle["attachments"]) {
  return DiagnosticBundleSchema.parse({ ...base, bundleId: randomUUID(), attachments,
    contentDigest: deriveDiagnosticContentDigest({ runId: base.runId, origin: base.origin, capturedAt: base.createdAt,
      configFingerprint: base.configFingerprint, descriptorFingerprint: base.descriptorFingerprint,
      redaction: base.redaction, attachments }) });
}

it("prepares no final bytes, commits the canonical shared winner and removes only its witness", async () => {
  const f = fixture();
  try {
    const prepared = await f.service.prepare(f.request());
    assert.equal(f.inventory().length, 1); assert.ok(f.inventory()[0]?.endsWith(".diagnostic.tmp"));
    const winner = await f.writer.put(f.request().attachments[0].bytes, { mediaType: "application/json" });
    const stored = f.service.persist(prepared);
    assert.equal(stored.attachments[0]?.artifactId, winner.id);
    assert.deepEqual(f.service.persist(prepared), stored);
    const reopenedService = createDiagnosticCaptureService({ authority: f.db.authority, artifacts: f.writer, clock: f.clock, ids: { uuid: randomUUID } });
    assert.deepEqual(reopenedService.persist(stored), stored);
    assert.deepEqual(f.inventory(), [`${winner.sha256}.artifact`]);
    assert.deepEqual(pendingDiagnosticArtifacts(f.admission), []);
  } finally { f.dispose(); }
});

it("keeps rollback publication budget-accounted, preserves generic reuse, and retries without duplicate metadata", async () => {
  const f = fixture();
  try {
    const prepared = await f.service.prepare(f.request());
    assert.throws(() => f.db.withAuthorityTransaction(() => { f.service.persist(prepared); throw new Error("after-publication"); }), /after-publication/u);
    assert.equal(f.db.authority.diagnosticBundles.get(prepared.bundleId), undefined);
    const pending = pendingDiagnosticArtifacts(f.admission); assert.equal(pending.length, 1);
    assert.equal(existsSync(join(f.admission.artifactRoot, `${pending[0]?.sha256}.artifact`)), true);
    const shared = await f.writer.put(f.request().attachments[0].bytes, { mediaType: "application/json" });
    f.service.discard(prepared);
    assert.equal(f.inventory().length, 2); assert.equal(shared.sha256, pending[0]?.sha256);
    assert.throws(() => f.db.reclaimPendingDiagnostics(), /installation-required/u);
    const stored = f.service.persist(prepared);
    assert.deepEqual(f.service.persist(prepared), stored);
    assert.equal(f.db.authority.diagnosticBundles.listByRun(f.run.envelope.runId).length, 1);
    assert.deepEqual(f.inventory(), [`${shared.sha256}.artifact`]);
  } finally { f.dispose(); }
});

it("uses the real fixed-1GiB repository boundary once per unique digest and publishes nothing on repeated refusals", async () => {
  const f = fixture();
  try {
    const prepared = await f.service.prepare(f.request());
    const unit = 32 * 1024 * 1024;
    for (let index = 0; index < 32; index++) {
      // Strict metadata isolates admission arithmetic; the physical-cap proof uses real captured files.
      const attachment = DiagnosticAttachmentSchema.parse({ kind: "screenshot", artifactId: randomUUID(), digest: String(index + 1).padStart(64, "0"),
        byteLength: index === 31 ? unit - f.request().attachments[0].bytes.byteLength : unit,
        mediaType: "image/png" as const, width: 1, height: 1, sensitivity: "restricted" });
      f.db.authority.diagnosticBundles.insert(withAttachments(prepared, [attachment]));
    }
    const stored = f.service.persist(prepared);
    const before = f.inventory();
    for (let index = 0; index < 3; index++) {
      await assert.rejects(f.service.capture(f.request(`{"different":${index}}`)), /diagnostic-ordinary-cap-exceeded/u);
      assert.deepEqual(f.inventory(), before);
      assert.deepEqual(pendingDiagnosticArtifacts(f.admission), []);
    }
    const shared = await f.service.capture(f.request());
    assert.deepEqual(shared.attachments, stored.attachments);
    assert.deepEqual(f.inventory(), before);
  } finally { f.dispose(); }
});

const sourceUrl = (relative: string) => new URL(relative, import.meta.url).href;
function child(source: string) {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { cwd: fileURLToPath(new URL("../../../../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  process.stdout.on("data", bytes => { stdout += String(bytes); });
  process.stderr.on("data", bytes => { stderr += String(bytes); });
  const exited = new Promise<void>((resolve, reject) => {
    process.once("error", reject);
    process.once("exit", (code, signal) => code === 0 || signal === "SIGKILL" ? resolve() : reject(new Error(`child failed ${code}: ${stderr}`)));
  });
  return { process, exited, stdout: () => stdout };
}

it("admits simultaneous native captures in separate processes without duplicate shared bytes", async () => {
  const f = fixture();
  try {
    const source = `import { AuthorityDatabase } from ${JSON.stringify(sourceUrl("../../../../support/helpers/synthetic-storage-admission.ts"))};
      import { syntheticStateRoot } from ${JSON.stringify(sourceUrl("../../../../support/helpers/synthetic-storage-admission.ts"))};
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(sourceUrl("../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.ts"))};
      import { createDiagnosticCaptureService } from ${JSON.stringify(sourceUrl("../../../../../src/backend/logs/diagnostics/diagnostic-capture.ts"))};
      import { manualClock } from ${JSON.stringify(sourceUrl("../../../../../src/rules/time/clock.ts"))};
      import { randomUUID } from 'node:crypto';
      const db=AuthorityDatabase.open({path:${JSON.stringify(f.path)},busyTimeoutMs:5000,migrationOwner:'concurrent-diagnostic'},manualClock(new Date(${JSON.stringify(f.clock.now().toISOString())})));
      const admission=syntheticStateRoot(${JSON.stringify(f.root)});
      const service=createDiagnosticCaptureService({authority:db.authority,artifacts:createContentAddressedArtifactWriter({admission}),clock:manualClock(new Date(${JSON.stringify(f.clock.now().toISOString())})),ids:{uuid:randomUUID}});
      try {await service.capture({...${JSON.stringify(f.request())},attachments:[{kind:'console-summary',mediaType:'application/json',sensitivity:'redacted',bytes:Buffer.from('shared concurrent bytes')}]});}
      finally {db.close();admission.release();}`;
    const a = child(source), b = child(source);
    await Promise.all([a.exited, b.exited]);
    const rows = f.db.authority.diagnosticBundles.listByRun(f.run.envelope.runId);
    assert.equal(rows.length, 2); assert.deepEqual(rows[0]?.attachments, rows[1]?.attachments);
    assert.equal(f.inventory().length, 1); assert.equal(pendingDiagnosticArtifacts(f.admission).length, 0);
  } finally { f.dispose(); }
});

it.each(["ordinary", "pinned"] as const)("keeps a killed %s publisher witness across restart and requires actual stopped exclusive cleanup", async retention => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diagnostic-crash-")));
  const initial = RuntimeAdmission.acquireInitial(root, (pair, inspection) => ({ kind: "verified-existing", pair,
    authorityGeneration: NativeDatabase.inspectExistingReadOnly(inspection, join(pair.stateRoot, "state.db")).authorityGeneration,
    databaseIdentity: NativeDatabase.sourceDatabaseIdentity(join(pair.stateRoot, "state.db")) }), (pair, admission) => {
    NativeDatabase.open(admission, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "diagnostic-crash" }).close();
  });
  const artifactRoot = initial.artifactRoot;
  const admittedInventory = readdirSync(artifactRoot).sort();
  initial.release();
  let publisher: ReturnType<typeof child> | undefined;
  try {
    publisher = child(`import { acquireSharedRuntimeAdmission } from ${JSON.stringify(sourceUrl("../../../../../src/backend/storage/admission/admission.ts"))};
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(sourceUrl("../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.ts"))};
      const admission=acquireSharedRuntimeAdmission(${JSON.stringify(root)});
      const writer=createContentAddressedArtifactWriter({admission});
      const stage=await writer.stageDiagnostic(Buffer.from('owned crash bytes'),{mediaType:'application/json'},${JSON.stringify(retention)});
      stage.publish(); process.stdout.write('published'); setInterval(()=>{},1000);`);
    await new Promise<void>((resolve, reject) => { publisher?.process.stdout.on("data", () => resolve()); publisher?.process.once("exit", () => reject(new Error("publisher exited before witness"))); });
    assert.throws(() => acquireExclusiveRuntimeAdmission(root), /held|busy|active/u);
    publisher.process.kill("SIGKILL"); await publisher.exited;
    const admission = acquireExclusiveRuntimeAdmission(root);
    try {
      const pending = pendingDiagnosticArtifacts(admission); assert.equal(pending.length, 1);
      assert.equal(readdirSync(artifactRoot).length, admittedInventory.length + 2);
      const before = readdirSync(artifactRoot).sort();
      assert.equal(reclaimDiagnosticStages(admission, () => false), retention === "ordinary" ? 1 : 0);
      assert.deepEqual(readdirSync(artifactRoot).sort(), retention === "ordinary" ? admittedInventory : before);
      assert.equal(pendingDiagnosticArtifacts(admission).length, retention === "ordinary" ? 0 : 1);
    } finally { admission.release(); }
  } finally { publisher?.process.kill("SIGKILL"); if (publisher !== undefined) await publisher.exited; rmSync(root, { recursive: true, force: true }); }
});

it("never deletes an unregistered shared winner during stopped cleanup and preserves its accounted witness", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diagnostic-shared-cleanup-")));
  const admission = RuntimeAdmission.acquireInitial(root, (pair, inspection) => ({ kind: "verified-existing", pair,
    authorityGeneration: NativeDatabase.inspectExistingReadOnly(inspection, join(pair.stateRoot, "state.db")).authorityGeneration,
    databaseIdentity: NativeDatabase.sourceDatabaseIdentity(join(pair.stateRoot, "state.db")) }), (pair, initialization) => {
    NativeDatabase.open(initialization, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "diagnostic-shared" }).close();
  });
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    const bytes = Buffer.from("shared winner bytes");
    const winner = await writer.put(bytes, { mediaType: "application/json" });
    const stage = await writer.stageDiagnostic(bytes, { mediaType: "application/json" }, "ordinary");
    assert.deepEqual(stage.publish(), winner);
    const before = readdirSync(admission.artifactRoot).sort();
    assert.throws(() => reclaimDiagnosticStages(admission, () => false), /shared-publication-unresolved/u);
    assert.deepEqual(readdirSync(admission.artifactRoot).sort(), before);
    assert.deepEqual(pendingDiagnosticArtifacts(admission), [stage.ref]);
    assert.equal(reclaimDiagnosticStages(admission, ref => ref.id === winner.id), 1);
    assert.deepEqual(readdirSync(admission.artifactRoot).sort(), before.filter(name => !name.endsWith(".diagnostic.tmp")));
    assert.equal(existsSync(join(admission.artifactRoot, `${winner.sha256}.artifact`)), true);
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});

it("disposes failed pre-publication writes and refuses replaced stage custody without touching replacement bytes", async () => {
  const f = fixture();
  try {
    const failing = createContentAddressedArtifactWriter({ admission: f.admission,
      injectFault: step => { if (step === "temp-written") throw new Error("stage-write-fault"); } });
    await assert.rejects(failing.stageDiagnostic(Buffer.from("fault bytes"), { mediaType: "application/json" }, "ordinary"), /stage-write-fault/u);
    assert.deepEqual(f.inventory(), []);
    const stage = await f.writer.stageDiagnostic(Buffer.from("owned bytes"), { mediaType: "application/json" }, "ordinary");
    const name = f.inventory()[0]; assert.ok(name);
    const path = join(f.admission.artifactRoot, name), held = `${path}.held`;
    const bytes = readFileSync(path); renameSync(path, held); writeFileSync(path, bytes, { mode: 0o600 });
    assert.throws(() => stage.dispose(), /custody-changed/u);
    assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readFileSync(held), bytes);
    assert.throws(() => stage.publish(), /custody-changed/u);
    assert.equal(f.inventory().filter(entry => entry.endsWith(".artifact")).length, 0);
  } finally { f.dispose(); }
});

it("keeps generic shared bytes while an uncommitted pinned diagnostic publication is in flight", async () => {
  const f = fixture();
  try {
    terminalizeFixtureFailure(f, f.run, failure());
    const ordinary = await f.service.capture(f.request());
    const prepared = await f.service.prepare({ ...f.request(), retention: { kind: "pinned", reason: "write-recovery" } });
    const finalPath = join(f.admission.artifactRoot, `${ordinary.attachments[0]?.digest}.artifact`);
    const bytes = readFileSync(finalPath);
    assert.deepEqual(f.db.sweepOrdinaryDiagnostics("2027-01-01T00:00:00.000Z").purged, [ordinary.bundleId]);
    assert.deepEqual(readFileSync(finalPath), bytes);
    const pinned = f.service.persist(prepared);
    assert.deepEqual(pinned.attachments, ordinary.attachments);
    assert.deepEqual(readFileSync(finalPath), bytes);
    assert.equal(pendingDiagnosticArtifacts(f.admission).length, 0);
  } finally { f.dispose(); }
});

it("bounds sparse diagnostic envelopes before parsing or publication while preserving oversized evidence", async () => {
  const f = fixture();
  try {
    const stage = await f.writer.stageDiagnostic(Buffer.from("bounded bytes"), { mediaType: "application/json" }, "ordinary");
    const name = f.inventory()[0]; assert.ok(name);
    const path = join(f.admission.artifactRoot, name);
    truncateSync(path, 20 * 1024 * 1024);
    assert.throws(() => pendingDiagnosticArtifacts(f.admission), /diagnostic-stage-size-exceeded/u);
    assert.throws(() => stage.publish(), /diagnostic-stage-size-exceeded/u);
    assert.equal(lstatSync(path).size, 20 * 1024 * 1024);
    assert.deepEqual(f.inventory(), [name]);
  } finally { f.dispose(); }
});

it("uses the existing stopped upgrade maintenance door without changing authority or plan bytes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diagnostic-maintenance-")));
  const clock = manualClock(new Date("2026-01-01T12:00:00.000Z"));
  const admission = RuntimeAdmission.acquireInitial(root, (pair, inspection) => ({ kind: "verified-existing", pair,
    authorityGeneration: NativeDatabase.inspectExistingReadOnly(inspection, join(pair.stateRoot, "state.db")).authorityGeneration,
    databaseIdentity: NativeDatabase.sourceDatabaseIdentity(join(pair.stateRoot, "state.db")) }), (pair, initialization) => {
    NativeDatabase.open(initialization, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "diagnostic-maintenance" }, clock).close();
  });
  const stateRoot = admission.stateRoot, artifactRoot = admission.artifactRoot;
  const input = { stateRoot, processLockRoot: join(root, rebuildRuntimeIsolation.processLockRoot), plan: false };
  try {
    const noWork = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade"], clock, root, admission);
    assert.deepEqual(noWork, { output: "storage upgrade: already-upgraded (v1 → v1)\ncredentials: unchanged", exitCode: 0 });
    const writer = createContentAddressedArtifactWriter({ admission });
    const ordinary = await writer.stageDiagnostic(Buffer.from("ordinary pending"), { mediaType: "application/json" }, "ordinary"); ordinary.publish();
    const pinned = await writer.stageDiagnostic(Buffer.from("protected pending"), { mediaType: "application/json" }, "pinned"); pinned.publish();
    const before = readdirSync(artifactRoot).sort();
    const databasePath = join(stateRoot, "state.db"), databaseBytes = readFileSync(databasePath);
    const inspection = NativeDatabase.inspectExistingReadOnly(admission, databasePath);
    const plan = await upgradeStorage(admission, { ...input, plan: true }, clock);
    assert.equal(plan.state, "planned"); assert.equal(plan.diagnostics, undefined);
    assert.deepEqual(readdirSync(artifactRoot).sort(), before); assert.deepEqual(readFileSync(databasePath), databaseBytes);
    const live = acquireRuntimeProcessLock({ processLockRoot: input.processLockRoot, name: "live-smoke", pid: process.pid }, clock);
    try { await assert.rejects(upgradeStorage(admission, input, clock), /runtime-active/u); assert.deepEqual(readdirSync(artifactRoot).sort(), before); }
    finally { live.release(); }
    const report = await upgradeStorage(admission, input, clock);
    assert.deepEqual(report.diagnostics, { reclaimedStages: 1, retainedStages: 1, capacityWarning: true });
    assert.equal(existsSync(join(artifactRoot, `${ordinary.ref.sha256}.artifact`)), false);
    assert.equal(existsSync(join(artifactRoot, `${pinned.ref.sha256}.artifact`)), true);
    assert.deepEqual(pendingDiagnosticArtifacts(admission), [pinned.ref]);
    const cli = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade"], clock, root, admission);
    assert.deepEqual(cli, { output: "storage upgrade: already-upgraded (v1 → v1)\ncredentials: unchanged\ndiagnostic stages: 0 reclaimed, 1 retained; retained evidence remains budget-accounted", exitCode: 0 });
    assert.deepEqual(readFileSync(databasePath), databaseBytes);
    const after = NativeDatabase.inspectExistingReadOnly(admission, databasePath);
    assert.equal(after.authorityGeneration, inspection.authorityGeneration);
    assert.equal(after.authorityContentFingerprint, inspection.authorityContentFingerprint);
    admission.release();
    const shared = acquireSharedRuntimeAdmission(root);
    try { await assert.rejects(upgradeStorage(shared, input, clock), /exclusive offline admission required/u); }
    finally { shared.release(); }
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});

it("admits the maximum diagnostic attachment envelope and leaves an absent artifact root absent during empty cleanup", async () => {
  const f = fixture();
  try {
    assert.equal(reclaimDiagnosticStages(f.admission, () => false), 0);
    assert.equal(existsSync(f.admission.artifactRoot), false);
    const stage = await f.writer.stageDiagnostic(Buffer.alloc(10 * 1024 * 1024, 1), { mediaType: "image/png" }, "ordinary");
    assert.deepEqual(pendingDiagnosticArtifacts(f.admission), [stage.ref]);
    assert.equal(stage.publish().bytes, 10 * 1024 * 1024);
    stage.dispose();
    assert.equal(pendingDiagnosticArtifacts(f.admission).length, 0);
  } finally { f.dispose(); }
});
