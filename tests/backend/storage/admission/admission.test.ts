import { randomUUID } from "node:crypto";
import { initializeAdmissionFixture, fixtureAdmission, releaseAdmissionFixture } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync,mkdtempSync,readdirSync,symlinkSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { RuntimeAdmission,acquireExclusiveRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { pendingDiagnosticArtifacts,reclaimDiagnosticStages } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase as NativeDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

const sourceUrl = (relative: string) => new URL(relative, import.meta.url).href;
function child(source: string) {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  process.stdout.on("data", bytes => { stdout += String(bytes); });
  process.stderr.on("data", bytes => { stderr += String(bytes); });
  const exited = new Promise<void>((resolve, reject) => {
    process.once("error", reject);
    process.once("exit", (code, signal) => code === 0 || signal === "SIGKILL" ? resolve() : reject(new Error(`child failed ${code}: ${stderr}`)));
  });
  return { process, exited, stdout: () => stdout };
}

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
    publisher = child(`import { acquireSharedRuntimeAdmission } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/admission/admission.ts"))};
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(sourceUrl("../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.ts"))};
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

it("delegates stopped-stage installation context only while its exclusive parent is live", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "orphan-staged-admission-")));
  initializeAdmissionFixture(workspace);
  const shared = fixtureAdmission(workspace);
  assert.throws(() => shared.assertExclusive(), /exclusive offline admission required/u);
  releaseAdmissionFixture(workspace);
  const parent = acquireExclusiveRuntimeAdmission(workspace);
  const staged = parent.stoppedStagedAuthority(join(parent.stateRoot, `.restore-${randomUUID()}.sqlite.tmp`));
  try {
    assert.deepEqual(staged.readInstallationContext(), parent.readInstallationContext());
    assert.equal(staged.readInstallationContext()?.workspace, workspace);
    parent.release();
    assert.throws(() => staged.readInstallationContext(), /missing or released admission/u);
  } finally { staged.release(); parent.release(); rmSync(workspace, { recursive: true, force: true }); }
});


it("admits exact external profile erasure paths and rejects foreign, unsafe and released capabilities", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-erasure-admission-")));
  const id = "11111111-1111-4111-8111-111111111111";
  const profileRoot = join(root, "profiles", id);
  const machine = RuntimeAdmission.syntheticRoots(root, root);
  const profile = RuntimeAdmission.syntheticRoots(profileRoot, join(profileRoot, "artifacts"));
  const journal = join(root, "machine", "erasures", `${id}.json`);
  try {
    machine.assertProfileErasureJournal(profile, journal);
    assert.throws(() => machine.assertProfileErasureJournal(profile, join(root, "wrong.json")));
    assert.throws(() => machine.assertProfileErasureJournal(machine, journal));
    assert.throws(() => machine.assertProfileErasureJournal(profile, join(root, "machine", "erasures") + "/../erasures/" + id + ".json"));
    mkdirSync(join(root, "machine"), { mode: 0o700 });
    mkdirSync(join(root, "inside"), { mode: 0o700 });
    symlinkSync(join(root, "inside"), join(root, "machine", "erasures"));
    assert.throws(() => machine.assertProfileErasureJournal(profile, journal), /unsafe profile erasure path/);
    profile.release(); assert.throws(() => machine.assertProfileErasureJournal(profile, journal), /released/);
    machine.release(); assert.throws(() => machine.assertProfileErasureJournal(profile, journal), /released/);
  } finally { machine.release(); profile.release(); rmSync(root, { recursive: true, force: true }); }
});
