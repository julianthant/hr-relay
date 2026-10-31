import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,truncateSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createContentAddressedArtifactWriter,pendingDiagnosticArtifacts,reclaimDiagnosticStages } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { deriveDiagnosticContentDigest } from "../../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticAttachmentSchema,DiagnosticBundleSchema,type DiagnosticBundle } from "../../../../src/models/trust/diagnostic.js";
import { failure,foundationFixture,terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";
import { syntheticStateRoot } from "../../../support/helpers/synthetic-storage-admission.js";

async function fixture(options: { sharedMachine?: true } = {}) {
  const f = await foundationFixture(options);
  const admission = syntheticStateRoot(f.root);
  const writer = createContentAddressedArtifactWriter({ admission });
  const service = createDiagnosticCaptureService({ authority: f.db.authority, artifacts: writer, clock: f.clock, ids: { uuid: randomUUID } });
  const request = (text = "{\"safe\":true}") => ({ trigger: "operator-request" as const, requestedBy: "local-operator", runId: f.run.envelope.runId,
    configFingerprint: f.snapshot.fingerprint, descriptorFingerprint: f.run.envelope.contractFingerprint, fields: [],
    attachments: [{ kind: "console-summary" as const, mediaType: "application/json", sensitivity: "redacted" as const, bytes: Buffer.from(text) }] });
  const inventory = () => existsSync(admission.artifactRoot) ? readdirSync(admission.artifactRoot).sort() : [];
  return { ...f, admission, writer, service, request, inventory, dispose: () => f.dispose() };
}

function withAttachments(base: DiagnosticBundle, attachments: DiagnosticBundle["attachments"]) {
  return DiagnosticBundleSchema.parse({ ...base, bundleId: randomUUID(), attachments,
    contentDigest: deriveDiagnosticContentDigest({ runId: base.runId, origin: base.origin, capturedAt: base.createdAt,
      configFingerprint: base.configFingerprint, descriptorFingerprint: base.descriptorFingerprint,
      redaction: base.redaction, attachments }) });
}

it("prepares no final bytes, commits the canonical shared winner and removes only its witness", async () => {
  const f = await fixture();
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
  } finally { await f.dispose(); }
});

it("keeps rollback publication budget-accounted, preserves generic reuse, and retries without duplicate metadata", async () => {
  const f = await fixture();
  try {
    const prepared = await f.service.prepare(f.request());
    assert.throws(() => f.db.withAuthorityTransaction(() => { f.service.persist(prepared); throw new Error("after-publication"); }), /after-publication/u);
    assert.equal(f.db.authority.diagnosticBundles.get(prepared.bundleId), undefined);
    const pending = pendingDiagnosticArtifacts(f.admission); assert.equal(pending.length, 1);
    assert.equal(existsSync(join(f.admission.artifactRoot, `${pending[0]?.sha256}.artifact`)), true);
    const shared = await f.writer.put(f.request().attachments[0].bytes, { mediaType: "application/json" });
    f.service.discard(prepared);
    assert.equal(f.inventory().length, 2); assert.equal(shared.sha256, pending[0]?.sha256);
    assert.equal(existsSync(join(f.admission.artifactRoot, `${shared.sha256}.artifact`)), true);
    const stored = f.service.persist(prepared);
    assert.deepEqual(f.service.persist(prepared), stored);
    assert.equal(f.db.authority.diagnosticBundles.listByRun(f.run.envelope.runId).length, 1);
    assert.deepEqual(f.inventory(), [`${shared.sha256}.artifact`]);
  } finally { await f.dispose(); }
});

it("uses the real fixed-1GiB repository boundary once per unique digest and publishes nothing on repeated refusals", async () => {
  const f = await fixture();
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
  } finally { await f.dispose(); }
});

const sourceUrl = (relative: string) => new URL(relative, import.meta.url).href;
function child(source: string) {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe", "ipc"] });
  assert.ok(process.stdout);
  assert.ok(process.stderr);
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
  const f = await fixture({ sharedMachine: true });
  try {
    const clock = JSON.stringify(f.clock.now().toISOString());
    const source = `import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/admission/lifetime-lock.ts"))};
      import { acquireSharedRuntimeAdmission } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/admission/admission.ts"))};
      import { createProfileRegistry } from ${JSON.stringify(sourceUrl("../../../../src/backend/profiles/registry.ts"))};
      import { createCredentialStore } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/configuration/credential-store.ts"))};
      import { AuthorityDatabase } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/sqlite/authority-database.ts"))};
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.ts"))};
      import { createDiagnosticCaptureService } from ${JSON.stringify(sourceUrl("../../../../src/backend/logs/diagnostics/diagnostic-capture.ts"))};
      import { manualClock } from ${JSON.stringify(sourceUrl("../../../../src/rules/time/clock.ts"))};
      import { join } from 'node:path';
      import { randomUUID } from 'node:crypto';
      const lifetime=await WorkerRuntimeLifetimeLock.receive(${f.profile.lifetime.port},()=>process.exit(1));
      const machine=acquireSharedRuntimeAdmission(${JSON.stringify(f.profile.workspace)},lifetime);
      const admission=machine.admitProfile(createProfileRegistry(machine).storageClaim(${JSON.stringify(f.profile.admission.profileBinding.profileId)}));
      const credentials=createCredentialStore({admission,stateRoot:admission.stateRoot,erasureJournalAdmission:machine,erasureJournalPath:join(machine.stateRoot,'machine','erasures',admission.profileBinding.profileId+'.json')});
      const clock=manualClock(new Date(${clock}));
      const db=AuthorityDatabase.open(admission,{path:${JSON.stringify(f.path)},busyTimeoutMs:5000,migrationOwner:'concurrent-diagnostic'},clock,undefined,undefined,undefined,credentials);
      const service=createDiagnosticCaptureService({authority:db.authority,artifacts:createContentAddressedArtifactWriter({admission}),clock,ids:{uuid:randomUUID}});
      try {await service.capture({...${JSON.stringify(f.request())},attachments:[{kind:'console-summary',mediaType:'application/json',sensitivity:'redacted',bytes:Buffer.from('shared concurrent bytes')}]});}
      finally {db.close();admission.release();machine.release();await lifetime.close();process.disconnect();}`;
    const a = child(source), b = child(source);
    await Promise.all([f.profile.lifetime.share(a.process), f.profile.lifetime.share(b.process)]);
    await Promise.all([a.exited, b.exited]);
    const rows = f.db.authority.diagnosticBundles.listByRun(f.run.envelope.runId);
    assert.equal(rows.length, 2); assert.deepEqual(rows[0]?.attachments, rows[1]?.attachments);
    assert.equal(f.inventory().length, 1); assert.equal(pendingDiagnosticArtifacts(f.admission).length, 0);
  } finally { await f.dispose(); }
});

it("disposes failed pre-publication writes and refuses replaced stage custody without touching replacement bytes", async () => {
  const f = await fixture();
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
  } finally { await f.dispose(); }
});

it("keeps generic shared bytes while an uncommitted pinned diagnostic publication is in flight", async () => {
  const f = await fixture();
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
  } finally { await f.dispose(); }
});

it("bounds sparse diagnostic envelopes before parsing or publication while preserving oversized evidence", async () => {
  const f = await fixture();
  try {
    const stage = await f.writer.stageDiagnostic(Buffer.from("bounded bytes"), { mediaType: "application/json" }, "ordinary");
    const name = f.inventory()[0]; assert.ok(name);
    const path = join(f.admission.artifactRoot, name);
    truncateSync(path, 20 * 1024 * 1024);
    assert.throws(() => pendingDiagnosticArtifacts(f.admission), /diagnostic-stage-size-exceeded/u);
    assert.throws(() => stage.publish(), /diagnostic-stage-size-exceeded/u);
    assert.equal(lstatSync(path).size, 20 * 1024 * 1024);
    assert.deepEqual(f.inventory(), [name]);
  } finally { await f.dispose(); }
});

it("refuses diagnostic stage cleanup without an installation", () => {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-cleanup-"));
  try {
    const artifacts = join(root, "artifacts");
    mkdirSync(artifacts, { mode: 0o700 });
    const admission = RuntimeAdmission.syntheticRoots(root, artifacts);
    assert.throws(() => reclaimDiagnosticStages(admission, () => false), /diagnostic-stage-cleanup-installation-required/u);
    rmSync(artifacts, { recursive: true });
    assert.equal(reclaimDiagnosticStages(admission, () => false), 0);
    assert.equal(existsSync(artifacts), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("admits the maximum diagnostic attachment envelope", async () => {
  const f = await fixture();
  try {
    if (existsSync(f.admission.artifactRoot) && readdirSync(f.admission.artifactRoot).length === 0) rmSync(f.admission.artifactRoot, { recursive: true });
    assert.equal(reclaimDiagnosticStages(f.admission, () => false), 0);
    assert.equal(existsSync(f.admission.artifactRoot), false);
    mkdirSync(f.admission.artifactRoot, { recursive: true, mode: 0o700 });
    const stage = await f.writer.stageDiagnostic(Buffer.alloc(10 * 1024 * 1024, 1), { mediaType: "image/png" }, "ordinary");
    assert.deepEqual(pendingDiagnosticArtifacts(f.admission), [stage.ref]);
    assert.equal(stage.publish().bytes, 10 * 1024 * 1024);
    stage.dispose();
    assert.equal(pendingDiagnosticArtifacts(f.admission).length, 0);
  } finally { await f.dispose(); }
});
