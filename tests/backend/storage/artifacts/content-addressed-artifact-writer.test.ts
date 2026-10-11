import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { createHash as createHash_m0 } from "node:crypto";
import { existsSync as existsSync_m0,existsSync as existsSync_m1,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,readdirSync as readdirSync_m1,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1,symlinkSync as symlinkSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { it as it_m0,it as it_m1 } from "vitest";
import { RuntimeAdmission as RuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m0,createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m1,pendingDiagnosticArtifacts as pendingDiagnosticArtifacts_m1,reclaimDiagnosticStages as reclaimDiagnosticStages_m1 } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase as NativeDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { ArtifactRefSchema as ArtifactRefSchema_m0 } from "../../../../src/models/artifacts/artifacts.js";


{


it_m0("creates artifact folders only at put and leaves ready and failed open without disk effects", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "artifact-lazy-")));
  const artifactRoot = join_m0(root, "artifacts");
  const admission = RuntimeAdmission_m0.syntheticRoots(join_m0(root, "state"), artifactRoot);
  try {
    const bytes = Buffer.from("current safe artifact");
    const writer = createContentAddressedArtifactWriter_m0({ admission });
    assert_m0.equal(existsSync_m0(artifactRoot), false);
    await writer.ready;
    assert_m0.equal(existsSync_m0(artifactRoot), false);
    await assert_m0.rejects(writer.open(ArtifactRefSchema_m0.parse({ id: "00000000-0000-4000-8000-000000000001",
      sha256: createHash_m0("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength,
      mediaType: "application/octet-stream" })), { code: "ENOENT" });
    assert_m0.equal(existsSync_m0(artifactRoot), false);
    const ref = await writer.put(bytes, { mediaType: "application/octet-stream" });
    assert_m0.equal(existsSync_m0(artifactRoot), true);
    const stream = await writer.open(ref);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) { assert_m0.ok(chunk instanceof Uint8Array); chunks.push(Buffer.from(chunk)); }
    assert_m0.deepEqual(Buffer.concat(chunks), bytes);
    assert_m0.deepEqual(await writer.put(bytes, { mediaType: "application/octet-stream" }), ref);
  } finally { admission.release(); rmSync_m0(root, { recursive: true, force: true }); }
});

it_m0("refuses a root replaced by a symlink before ready or put", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "artifact-lazy-safety-")));
  const artifactRoot = join_m0(root, "artifacts");
  const admission = RuntimeAdmission_m0.syntheticRoots(join_m0(root, "state"), artifactRoot);
  try {
    const writer = createContentAddressedArtifactWriter_m0({ admission });
    symlinkSync_m0(root, artifactRoot);
    await assert_m0.rejects(writer.ready, /unsafe synthetic fixture ancestor|symbolic link/u);
    await assert_m0.rejects(writer.put(Buffer.from("safe"), { mediaType: "application/octet-stream" }), /unsafe synthetic fixture ancestor|symbolic link/u);
    assert_m0.equal(existsSync_m0(join_m0(root, `${createHash_m0("sha256").update("safe").digest("hex")}.artifact`)), false);
  } finally { admission.release(); rmSync_m0(root, { recursive: true, force: true }); }
});
}

{


it_m1("never deletes an unregistered shared winner during stopped cleanup and preserves its accounted witness", async () => {
  const root = realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(), "diagnostic-shared-cleanup-")));
  const admission = RuntimeAdmission_m1.acquireInitial(root, (pair, inspection) => ({ kind: "verified-existing", pair,
    authorityGeneration: NativeDatabase_m1.inspectExistingReadOnly(inspection, join_m1(pair.stateRoot, "state.db")).authorityGeneration,
    databaseIdentity: NativeDatabase_m1.sourceDatabaseIdentity(join_m1(pair.stateRoot, "state.db")) }), (pair, initialization) => {
    NativeDatabase_m1.open(initialization, { path: join_m1(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "diagnostic-shared" }).close();
  });
  try {
    const writer = createContentAddressedArtifactWriter_m1({ admission });
    const bytes = Buffer.from("shared winner bytes");
    const winner = await writer.put(bytes, { mediaType: "application/json" });
    const stage = await writer.stageDiagnostic(bytes, { mediaType: "application/json" }, "ordinary");
    assert_m1.deepEqual(stage.publish(), winner);
    const before = readdirSync_m1(admission.artifactRoot).sort();
    assert_m1.throws(() => reclaimDiagnosticStages_m1(admission, () => false), /shared-publication-unresolved/u);
    assert_m1.deepEqual(readdirSync_m1(admission.artifactRoot).sort(), before);
    assert_m1.deepEqual(pendingDiagnosticArtifacts_m1(admission), [stage.ref]);
    assert_m1.equal(reclaimDiagnosticStages_m1(admission, ref => ref.id === winner.id), 1);
    assert_m1.deepEqual(readdirSync_m1(admission.artifactRoot).sort(), before.filter(name => !name.endsWith(".diagnostic.tmp")));
    assert_m1.equal(existsSync_m1(join_m1(admission.artifactRoot, `${winner.sha256}.artifact`)), true);
  } finally { admission.release(); rmSync_m1(root, { recursive: true, force: true }); }
});
}
