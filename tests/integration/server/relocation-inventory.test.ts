import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { ArchiveDatabase } from "../../../src/infra/sqlite/archive-database.js";
import { GeneratedArtifactSchema } from "../../../src/domain/generated-artifact.js";
import { sealArchiveReport } from "../../../src/domain/archive/report.js";
import { insertGeneratedArtifact } from "../../../src/infra/sqlite/generated-artifacts.js";
import { insertImportedArtifact } from "../../../src/infra/sqlite/imported-artifacts.js";
import { importedArtifact } from "../../../src/domain/intake/imported-artifact.js";
import { IntakeSessionSchema } from "../../../src/domain/intake/session.js";
import { verifyBackupManifestAtPath } from "../../../src/infra/sqlite/backup-service.js";
import { copyRelocationFile, inspectRelocationFiles, prepareRelocationDirectories,
  verifyRelocationFileCopies, verifyRelocationLiveReferences } from "../../../src/server/storage/relocation-inventory.js";

function artifactBytes(bytes: Buffer): Readonly<{ name: string; stored: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { name: `${sha256}.artifact`, stored: JSON.stringify({
    ref: { id: randomUUID(), sha256, bytes: bytes.length, mediaType: "text/plain" },
    payloadBase64: bytes.toString("base64"),
  }) };
}

it("enumerates nested artifacts once and copies private bytes with exact retry", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-inventory-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  const destination = { stateRoot: join(workspace, "destination"), artifactRoot: join(workspace, "destination", "artifacts") };
  const fixedLockRoot = join(source.stateRoot, "locks");
  try {
    for (const path of [source.stateRoot, source.artifactRoot, fixedLockRoot, destination.stateRoot, destination.artifactRoot,
      join(source.stateRoot, "credentials"), join(source.stateRoot, "archive-files"), join(source.stateRoot, "notes")]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    writeFileSync(join(source.stateRoot, "state.db"), "synthetic-db", { mode: 0o600 });
    const secret = Buffer.from("private credential fixture\0\u0001");
    writeFileSync(join(source.stateRoot, "credentials", "protected.json"), secret, { mode: 0o600 });
    const archiveFile = Buffer.from("archive-file");
    const archiveDigest = createHash("sha256").update(archiveFile).digest("hex");
    writeFileSync(join(source.stateRoot, "archive-files", archiveDigest), archiveFile, { mode: 0o600 });
    const artifact = artifactBytes(Buffer.from("evidence"));
    writeFileSync(join(source.artifactRoot, artifact.name), artifact.stored, { mode: 0o600 });
    const sourceAdmission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    const destinationAdmission = RuntimeAdmission.syntheticRoots(destination.stateRoot, destination.artifactRoot);
    try {
      const inventory = inspectRelocationFiles({ admission: sourceAdmission, source, destination, fixedLockRoot });
      assert.deepEqual(inventory.stateEntries.map((entry) => entry.name), ["archive-files", "artifacts", "credentials", "notes", "state.db"]);
      prepareRelocationDirectories({ destinationAdmission, inventory });
      assert.equal(lstatSync(join(destination.stateRoot, "notes")).isDirectory(), true);
      assert.equal(inventory.files.filter((file) => file.role === "artifact").length, 1);
      assert.equal(inventory.files.filter((file) => file.relativePath.includes(artifact.name)).length, 1);
      const archived = inventory.files.find((file) => file.relativePath === `archive-files/${archiveDigest}`);
      assert.ok(archived);
      const operationId = randomUUID();
      assert.throws(() => copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: archived,
        operationId, hooks: { beforePublish: () => { throw new Error("simulated crash before publication"); } } }),
      /simulated crash before publication/u);
      copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: archived, operationId });
      assert.deepEqual(readFileSync(join(destination.stateRoot, "archive-files", archiveDigest)), archiveFile);
      const credential = inventory.files.find((file) => file.relativePath === "credentials/protected.json");
      assert.ok(credential);
      assert.throws(() => copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: credential,
        operationId, hooks: { afterPublish: () => { throw new Error("simulated crash after publication"); } } }),
      /simulated crash after publication/u);
      assert.equal(lstatSync(join(destination.stateRoot, "credentials", "protected.json")).nlink, 2);
      copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: credential, operationId });
      assert.equal(lstatSync(join(destination.stateRoot, "credentials", "protected.json")).nlink, 1);
      copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: credential, operationId });
      assert.deepEqual(readFileSync(join(destination.stateRoot, "credentials", "protected.json")), secret);
      const artifactFile = inventory.files.find((file) => file.role === "artifact");
      assert.ok(artifactFile);
      copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: artifactFile, operationId });
      verifyRelocationFileCopies({ sourceAdmission, destinationAdmission, inventory });
      assert.equal(JSON.stringify(inventory).includes(createHash("sha256").update(secret).digest("hex")), false);
      writeFileSync(join(destination.stateRoot, "credentials", "protected.json"), "changed");
      assert.throws(() => verifyRelocationFileCopies({ sourceAdmission, destinationAdmission, inventory }),
        /copied file bytes changed/u);
      assert.throws(() => copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: credential, operationId }),
        /existing destination bytes disagree/u);
    } finally { sourceAdmission.release(); destinationAdmission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("refuses unknown entries, symlinks, hardlinks, and corrupted artifact bytes", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-inventory-unsafe-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  const destination = { stateRoot: join(workspace, "destination"), artifactRoot: join(workspace, "destination", "artifacts") };
  try {
    for (const path of [source.stateRoot, source.artifactRoot, destination.stateRoot, destination.artifactRoot]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    writeFileSync(join(source.stateRoot, "state.db"), "synthetic-db", { mode: 0o600 });
    const sourceAdmission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    try {
      const scan = () => inspectRelocationFiles({ admission: sourceAdmission, source, destination,
        fixedLockRoot: join(source.stateRoot, "locks") });
      writeFileSync(join(source.stateRoot, "unmanaged.txt"), "unknown");
      assert.throws(scan, /unknown state entry/u);
      rmSync(join(source.stateRoot, "unmanaged.txt"));
      symlinkSync(join(workspace, "missing"), join(source.artifactRoot, "bad.artifact"));
      assert.throws(scan, /unsafe file shape/u);
      rmSync(join(source.artifactRoot, "bad.artifact"));
      writeFileSync(join(source.artifactRoot, ".runtime-owner.json"), "{}", { mode: 0o600 });
      assert.throws(scan, /fixture overlaps installation witness|unvalidated ownership witness/u);
      rmSync(join(source.artifactRoot, ".runtime-owner.json"));
      linkSync(join(source.stateRoot, "state.db"), join(source.stateRoot, "archive.sqlite"));
      assert.throws(scan, /unsafe file shape/u);
      rmSync(join(source.stateRoot, "archive.sqlite"));
      const artifact = artifactBytes(Buffer.from("original"));
      writeFileSync(join(source.artifactRoot, artifact.name), artifact.stored.replace("b3JpZ2luYWw=", "Y2hhbmdlZA=="), { mode: 0o600 });
      assert.throws(scan, /artifact bytes disagree/u);
    } finally { sourceAdmission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("refuses pending credential writes, invalid event records, and malformed backup manifests", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-inventory-formats-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  const destination = { stateRoot: join(workspace, "destination"), artifactRoot: join(workspace, "destination", "artifacts") };
  try {
    for (const path of [source.stateRoot, source.artifactRoot, destination.stateRoot, destination.artifactRoot,
      join(source.stateRoot, "credentials"), join(source.stateRoot, "notes"), join(source.stateRoot, "backups", "authority")]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    writeFileSync(join(source.stateRoot, "state.db"), "synthetic-db", { mode: 0o600 });
    const admission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    try {
      const scan = () => inspectRelocationFiles({ admission, source, destination, fixedLockRoot: join(source.stateRoot, "locks") });
      writeFileSync(join(source.stateRoot, "credentials", ".protected.lock"), "held", { mode: 0o600 });
      assert.throws(scan, /credential write lock is present/u);
      rmSync(join(source.stateRoot, "credentials", ".protected.lock"));
      writeFileSync(join(source.stateRoot, ".lifecycle-restore.json"), "{}", { mode: 0o600 });
      assert.throws(scan, /unknown state entry/u);
      rmSync(join(source.stateRoot, ".lifecycle-restore.json"));
      writeFileSync(join(source.stateRoot, "notes", "workflow-2026-09-26.jsonl"), "{\"bad\":true}\n", { mode: 0o600 });
      assert.throws(scan, /invalid event stream record/u);
      rmSync(join(source.stateRoot, "notes", "workflow-2026-09-26.jsonl"));
      writeFileSync(join(source.stateRoot, "backups", "authority", "bad.manifest.json"), "{}", { mode: 0o600 });
      await assert.rejects(verifyBackupManifestAtPath(admission,
        join(source.stateRoot, "backups", "authority", "bad.manifest.json")));
    } finally { admission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("refuses a generated artifact whose verified SQLite reference has no bytes", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-inventory-reference-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  try {
    mkdirSync(source.artifactRoot, { recursive: true, mode: 0o700 });
    const admission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    try {
      const path = join(source.stateRoot, "state.db");
      const authority = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250,
        migrationOwner: "relocation-inventory-test" });
      authority.close();
      const exportId = randomUUID();
      const ref = { id: randomUUID(), sha256: "a".repeat(64), bytes: 8, mediaType: "text/plain" };
      const record = GeneratedArtifactSchema.parse({ format: 1, fileId: `export:${exportId}`, sinkId: null,
        exportId, exportRequest: null, registration: null, exportEvidenceJson: null,
        exportEvidenceFingerprint: null, mediaType: ref.mediaType, state: "ready", historyCoverage: "complete",
        version: 1, head: null, updates: [], versions: [{ state: "verified", artifact: ref }], prepared: null,
        createdAt: "2026-09-26T12:00:00.000Z" });
      const raw = new DatabaseSync(path);
      try { insertGeneratedArtifact(raw, record); } finally { raw.close(); }
      assert.throws(() => verifyRelocationLiveReferences({ admission, source }), /ENOENT|no such file/u);
    } finally { admission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("refuses a durable intake session whose source artifact is missing", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-intake-reference-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  try {
    mkdirSync(source.artifactRoot, { recursive: true, mode: 0o700 });
    const admission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    try {
      const path = join(source.stateRoot, "state.db");
      AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "relocation-intake-test" }).close();
      const session = IntakeSessionSchema.parse({ intakeSessionId: randomUUID(), actorId: "local-operator",
        workflow: "person-lookup", artifact: { id: randomUUID(), sha256: "b".repeat(64), bytes: 5,
          mediaType: "text/csv" }, sheet: "default", headerRowIndex: null, bindings: [], constants: [],
        corrections: [], exclusions: [], state: "mapping", validation: { state: "none" },
        reservedManifestId: randomUUID(), version: 1, createdAt: "2026-09-26T12:00:00.000Z",
        updatedAt: "2026-09-26T12:00:00.000Z" });
      const raw = new DatabaseSync(path);
      try { insertImportedArtifact(raw, importedArtifact(JSON.stringify(session), null)); } finally { raw.close(); }
      assert.throws(() => verifyRelocationLiveReferences({ admission, source }), /ENOENT|no such file/u);
    } finally { admission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("refuses a published archive reference whose managed file is missing", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-inventory-archive-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  try {
    mkdirSync(source.artifactRoot, { recursive: true, mode: 0o700 });
    const admission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    try {
      const authority = AuthorityDatabase.open(admission, { path: join(source.stateRoot, "state.db"),
        busyTimeoutMs: 250, migrationOwner: "relocation-inventory-test" });
      authority.close();
      const archivePath = join(source.stateRoot, "archive.sqlite");
      const archive = new ArchiveDatabase(admission, archivePath);
      const runId = randomUUID();
      const report = sealArchiveReport({ schemaVersion: 1, runId, transferId: randomUUID(),
        workflow: "fixture", itemId: "subject", attempt: 1, runNumber: 1,
        title: "Fixture", descriptorVersion: "1", outcome: "done",
        completedAt: "2026-09-26T12:00:00.000Z", capturedAt: "2026-09-26T12:00:00.000Z",
        sourceDigest: "b".repeat(64), sources: [], sections: [], files: [{ digest: "c".repeat(64),
          byteLength: 5, mediaType: "text/plain", name: "missing.txt" }] });
      archive.capture(report);
      archive.close();
      const raw = new DatabaseSync(archivePath);
      try { raw.prepare("UPDATE archive_records SET state='verified' WHERE run_id=?").run(runId); }
      finally { raw.close(); }
      assert.throws(() => verifyRelocationLiveReferences({ admission, source }), /archive-file-unavailable/u);
    } finally { admission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
