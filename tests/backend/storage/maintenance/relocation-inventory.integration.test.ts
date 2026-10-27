import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { copyFileSync, chmodSync, linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import {
copyRelocationFile,inspectRelocationFiles,prepareRelocationDirectories,
verifyRelocationFileCopies,verifyRelocationLiveReferences
} from "../../../../src/backend/storage/maintenance/relocation-inventory.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { insertGeneratedArtifact } from "../../../../src/backend/storage/sqlite/generated-artifacts.js";
import { insertImportedArtifact } from "../../../../src/backend/storage/sqlite/imported-artifacts.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { GeneratedArtifactSchema } from "../../../../src/models/artifacts/generated-artifact.js";
import { importedArtifact } from "../../../../src/models/intake/imported-artifact.js";
import { IntakeSessionSchema } from "../../../../src/models/intake/session.js";
import { createChatGptCredentialRepository, type ChatGptCredentialRecord } from "../../../../src/backend/storage/configuration/credential-store.js";

function artifactBytes(bytes: Buffer): Readonly<{ name: string; stored: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { name: `${sha256}.artifact`, stored: JSON.stringify({
    ref: { id: randomUUID(), sha256, bytes: bytes.length, mediaType: "text/plain" },
    payloadBase64: bytes.toString("base64"),
  }) };
}

it("relocates the Duo key with the other credentials and refuses an unsafe one", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-duo-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  const destination = { stateRoot: join(workspace, "destination"), artifactRoot: join(workspace, "destination", "artifacts") };
  for (const path of [source.stateRoot, source.artifactRoot, destination.stateRoot, destination.artifactRoot]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const sourceAdmission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot), destinationAdmission = RuntimeAdmission.syntheticRoots(destination.stateRoot, destination.artifactRoot);
  const profile = await createBoundProfileFixture();
  try {
    const protectedStore = boundProfileCredentials(profile.admission);
    const revision = protectedStore.read().revision;
    assert.equal(protectedStore.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "1".repeat(64), writeId: randomUUID(), expectedRevision: revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: "2026-10-12T12:00:00.000Z", entries: { ucpathPassword: { set: "synthetic-relocation-protected" } } })).state, "applied");
    assert.ok(protectedStore.read().entries.ucpathPassword);
    mkdirSync(join(source.stateRoot, "credentials"), { mode: 0o700 });
    copyFileSync(join(profile.stateRoot, "credentials", "protected.json"), join(source.stateRoot, "credentials", "protected.json"));
    assert.throws(() => profile.admission.assertStorageRelocationSupported(), { code: "PROFILE_STORAGE_RELOCATION_UNSUPPORTED" });
    const duo = join(source.stateRoot, "credentials", "duo-webauthn.json");
    writeFileSync(duo, '{"synthetic":"duo-key"}', { mode: 0o600 });
    const input = { admission: sourceAdmission, source, destination, fixedLockRoot: join(source.stateRoot, "locks") };
    const inventory = inspectRelocationFiles(input), file = inventory.files.find(entry => entry.relativePath === "credentials/duo-webauthn.json"); assert.ok(file);
    assert.equal(JSON.stringify(inventory).includes("duo-key"), false);
    prepareRelocationDirectories({ destinationAdmission, inventory });
    copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file, operationId: randomUUID() });
    assert.equal(lstatSync(join(destination.stateRoot, file.relativePath)).mode & 0o777, 0o600);
    chmodSync(duo, 0o644);
    assert.throws(() => inspectRelocationFiles(input), /unsafe Duo credential/u);
  } finally { sourceAdmission.release(); destinationAdmission.release(); await profile.close(); rmSync(workspace, { recursive: true, force: true }); }
});

it("relocates only a validated private ChatGPT record and refuses unsafe token authority", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-chatgpt-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  const destination = { stateRoot: join(workspace, "destination"), artifactRoot: join(workspace, "destination", "artifacts") };
  for (const path of [source.stateRoot, source.artifactRoot, destination.stateRoot, destination.artifactRoot]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const sourceAdmission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot), destinationAdmission = RuntimeAdmission.syntheticRoots(destination.stateRoot, destination.artifactRoot);
  const profile = await createBoundProfileFixture(), foreign = await createBoundProfileFixture();
  try {
    const record: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: "oaiapp_fixture",
      registration: { subject: "synthetic-subject", name: "Synthetic", email: "synthetic@example.com" },
      session: { accessToken: "synthetic-relocation-access", refreshToken: "synthetic-relocation-refresh", idToken: "synthetic-relocation-id",
        expiresAt: IsoInstantSchema.parse("2026-10-12T12:00:00.000Z"), earliestRefreshAt: null, scopes: [], usePlan: false, usage: "available" } };
    await createChatGptCredentialRepository({ admission: sourceAdmission, stateRoot: source.stateRoot }).withLock(async tx => { tx.replace(record, null); });
    const protectedStore = boundProfileCredentials(profile.admission);
    const revision = protectedStore.read().revision;
    const protectedOutcome = protectedStore.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "1".repeat(64), writeId: randomUUID(), expectedRevision: revision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: "2026-10-12T12:00:00.000Z", entries: { ucpathPassword: { set: "synthetic-relocation-protected" } } }));
    assert.equal(protectedOutcome.state, "applied");
    const protectedBytes = readFileSync(join(profile.stateRoot, "credentials", "protected.json"));
    assert.ok(protectedStore.read().entries.ucpathPassword);
    writeFileSync(join(source.stateRoot, "credentials", "protected.json"), protectedBytes, { mode: 0o600 });
    assert.throws(() => profile.admission.assertStorageRelocationSupported(), { code: "PROFILE_STORAGE_RELOCATION_UNSUPPORTED" });
    const input = { admission: sourceAdmission, source, destination, fixedLockRoot: join(source.stateRoot, "locks") };
    const inventory = inspectRelocationFiles(input), file = inventory.files.find(file => file.relativePath === "credentials/chatgpt-account.json"); assert.ok(file);
    assert.equal(JSON.stringify(inventory).includes("synthetic-relocation"), false);
    prepareRelocationDirectories({ destinationAdmission, inventory });
    copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file, operationId: randomUUID() });
    const protectedFile = inventory.files.find(file => file.relativePath === "credentials/protected.json");
    assert.ok(protectedFile);
    copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: protectedFile, operationId: randomUUID() });
    assert.equal(readFileSync(join(destination.stateRoot, protectedFile.relativePath)).equals(protectedBytes), true);
    assert.equal(lstatSync(join(destination.stateRoot, protectedFile.relativePath)).mode & 0o777, 0o600);
    const foreignPath = join(foreign.stateRoot, "credentials", "protected.json"), originalForeignBytes = readFileSync(foreignPath);
    try {
      writeFileSync(foreignPath, protectedBytes);
      assert.throws(() => boundProfileCredentials(foreign.admission).read());
    } finally { writeFileSync(foreignPath, originalForeignBytes); }
    assert.equal(readFileSync(join(profile.stateRoot, "credentials", "protected.json")).equals(protectedBytes), true);
    verifyRelocationFileCopies({ sourceAdmission, destinationAdmission, inventory });
    assert.deepEqual(createChatGptCredentialRepository({ admission: destinationAdmission, stateRoot: destination.stateRoot }).read(), record);
    assert.equal(lstatSync(join(destination.stateRoot, "credentials")).mode & 0o777, 0o700); assert.equal(lstatSync(join(destination.stateRoot, file.relativePath)).mode & 0o777, 0o600);
    const path = join(source.stateRoot, file.relativePath);
    writeFileSync(path, '{"refreshToken":"synthetic-sensitive"');
    assert.throws(() => inspectRelocationFiles(input), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE", message: "ChatGPT credentials could not be read or saved safely." });
    writeFileSync(path, JSON.stringify(record));
    chmodSync(path, 0o644);
    assert.throws(() => inspectRelocationFiles(input), /unknown or unsafe ChatGPT/u);
    chmodSync(path, 0o600);
    const stage = join(source.stateRoot, "credentials", `.chatgpt-account.${randomUUID()}.tmp`);
    writeFileSync(stage, "synthetic-stage", { mode: 0o600 });
    assert.throws(() => inspectRelocationFiles(input), /unsafe state descendant/u);
    rmSync(stage);
    writeFileSync(join(source.stateRoot, "credentials", ".chatgpt-account.lock"), "synthetic");
    assert.throws(() => inspectRelocationFiles(input), /unsafe state descendant|unknown or unsafe ChatGPT/u);
  } finally { sourceAdmission.release(); destinationAdmission.release(); await foreign.close(); await profile.close(); rmSync(workspace, { recursive: true, force: true }); }
});

it("enumerates nested artifacts once and copies private bytes with exact retry", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-inventory-")));
  const source = { stateRoot: join(workspace, "source"), artifactRoot: join(workspace, "source", "artifacts") };
  const destination = { stateRoot: join(workspace, "destination"), artifactRoot: join(workspace, "destination", "artifacts") };
  const fixedLockRoot = join(source.stateRoot, "locks");
  try {
    for (const path of [source.stateRoot, source.artifactRoot, fixedLockRoot, destination.stateRoot, destination.artifactRoot,
      join(source.stateRoot, "credentials"), join(source.stateRoot, "logs"), join(source.stateRoot, "scratch")]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    writeFileSync(join(source.stateRoot, "state.db"), "synthetic-db", { mode: 0o600 });
    const secret = Buffer.from("private credential fixture\0\u0001");
    writeFileSync(join(source.stateRoot, "credentials", "protected.json"), secret, { mode: 0o600 });
    const emergencyFile = Buffer.from(JSON.stringify({ schemaVersion: 1, eventId: randomUUID(),
      scope: { kind: "client", clientId: "relocation-fixture" }, occurredAt: "2026-09-26T12:00:00.000Z",
      recordedAt: "2026-09-26T12:00:00.000Z", retentionDate: "2026-09-26", source: { kind: "native" },
      payload: { kind: "debug", event: { category: "boot", phase: "failed", correlationId: "relocation",
        build: "fixture", pid: process.pid } } }) + "\n");
    writeFileSync(join(source.stateRoot, "logs", "boot.jsonl"), emergencyFile, { mode: 0o600 });
    const artifact = artifactBytes(Buffer.from("evidence"));
    writeFileSync(join(source.artifactRoot, artifact.name), artifact.stored, { mode: 0o600 });
    const sourceAdmission = RuntimeAdmission.syntheticRoots(source.stateRoot, source.artifactRoot);
    const destinationAdmission = RuntimeAdmission.syntheticRoots(destination.stateRoot, destination.artifactRoot);
    try {
      const inventory = inspectRelocationFiles({ admission: sourceAdmission, source, destination, fixedLockRoot });
      assert.deepEqual(inventory.stateEntries.map((entry) => entry.name), ["artifacts", "credentials", "logs", "scratch", "state.db"]);
      prepareRelocationDirectories({ destinationAdmission, inventory });
      assert.equal(lstatSync(join(destination.stateRoot, "scratch")).isDirectory(), true);
      assert.equal(inventory.files.filter((file) => file.role === "artifact").length, 1);
      assert.equal(inventory.files.filter((file) => file.relativePath.includes(artifact.name)).length, 1);
      const emergency = inventory.files.find((file) => file.relativePath === "logs/boot.jsonl");
      assert.ok(emergency);
      const operationId = randomUUID();
      assert.throws(() => copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: emergency,
        operationId, hooks: { beforePublish: () => { throw new Error("simulated crash before publication"); } } }),
      /simulated crash before publication/u);
      copyRelocationFile({ sourceAdmission, destinationAdmission, inventory, file: emergency, operationId });
      assert.deepEqual(readFileSync(join(destination.stateRoot, "logs", "boot.jsonl")), emergencyFile);
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
      join(source.stateRoot, "credentials"), join(source.stateRoot, "logs"), join(source.stateRoot, "backups", "authority")]) {
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
      writeFileSync(join(source.stateRoot, "logs", "boot.jsonl"), "{\"bad\":true}\n", { mode: 0o600 });
      assert.throws(scan, /schemaVersion|Invalid input|invalid|expected/u);
      rmSync(join(source.stateRoot, "logs", "boot.jsonl"));
      writeFileSync(join(source.stateRoot, "backups", "authority", "bad.manifest.json"), "{}", { mode: 0o600 });
      await assert.rejects(verifyBackupManifestAtPath(admission,
        join(source.stateRoot, "backups", "authority", "bad.manifest.json")));
    } finally { admission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

it("refuses a generated artifact whose verified SQLite reference has no bytes", async () => {
  const profile = await createBoundProfileFixture();
  const source = { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot };
  try {
    mkdirSync(source.artifactRoot, { recursive: true, mode: 0o700 });
    const admission = profile.admission;
    try {
      const path = join(source.stateRoot, "state.db");
      const authority = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250,
        migrationOwner: "relocation-inventory-test" }, undefined, undefined, undefined, undefined, boundProfileCredentials(admission));
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
      assert.throws(() => verifyRelocationLiveReferences({ admission, source, credentials: boundProfileCredentials(admission) }), /ENOENT|no such file/u);
    } finally { admission.assertLive(); }
  } finally { await profile.close(); }
});

it("refuses a durable intake session whose source artifact is missing", async () => {
  const profile = await createBoundProfileFixture();
  const source = { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot };
  try {
    mkdirSync(source.artifactRoot, { recursive: true, mode: 0o700 });
    const admission = profile.admission;
    try {
      const path = join(source.stateRoot, "state.db");
      AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "relocation-intake-test" }, undefined, undefined, undefined, undefined, boundProfileCredentials(admission)).close();
      const session = IntakeSessionSchema.parse({ intakeSessionId: randomUUID(), actorId: "local-operator",
        workflow: "person-lookup", artifact: { id: randomUUID(), sha256: "b".repeat(64), bytes: 5,
          mediaType: "text/csv" }, sheet: "default", headerRowIndex: null, bindings: [], constants: [],
        corrections: [], exclusions: [], state: "mapping", validation: { state: "none" },
        reservedManifestId: randomUUID(), version: 1, createdAt: "2026-09-26T12:00:00.000Z",
        updatedAt: "2026-09-26T12:00:00.000Z" });
      const raw = new DatabaseSync(path);
      try { insertImportedArtifact(raw, importedArtifact(JSON.stringify(session), null)); } finally { raw.close(); }
      assert.throws(() => verifyRelocationLiveReferences({ admission, source, credentials: boundProfileCredentials(admission) }), /ENOENT|no such file/u);
    } finally { admission.assertLive(); }
  } finally { await profile.close(); }
});

