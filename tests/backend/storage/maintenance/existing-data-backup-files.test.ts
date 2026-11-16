import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { captureFlatArchiveSource, hash, retainedStorageBackup, SourceRecordSchema, StorageBackupSchema, verifyCopies, writeFlatArchiveCopies } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "flat-archive-files-")));
  const stateRoot = join(workspace, ".tracker", "data"), installationId = randomUUID(), operationId = randomUUID();
  const control = join(workspace, ".tracker", "control");
  const database = join(stateRoot, "state.db"), report = join(workspace, "data", "reports", "report.csv");
  const protectedPath = join(stateRoot, "credentials", "protected.json");
  const browserPath = join(stateRoot, "browsers", "w1", "ucpath", "Default", "Preferences");
  for (const directory of [stateRoot, control, dirname(report), dirname(protectedPath), dirname(browserPath)]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  // This boundary inventories bytes only; these bytes cannot qualify a native database or prove closure.
  writeFileSync(database, Buffer.from([0, 255, 7, 3]), { mode: 0o600 });
  writeFileSync(report, "status\nretained\n", { mode: 0o600 });
  writeFileSync(protectedPath, "opaque protected owner", { mode: 0o600 });
  writeFileSync(browserPath, '{"profile":{"name":"fixture"}}', { mode: 0o600 });
  writeFileSync(join(control, "installation.json"), canonicalJsonStringify({ schemaVersion: 1, installationId, workspace }), { mode: 0o600 });
  const root = join(control, "storage-backups", installationId);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const extraFiles = [
    [join(stateRoot, "credentials", "duo-webauthn.json"), "opaque Duo owner", 0o600],
    [join(stateRoot, "credentials", "chatgpt-account.json"), "opaque ChatGPT owner", 0o600],
    [join(dirname(browserPath), "Cookies"), "opaque browser owner", 0o600],
    [join(dirname(browserPath), "Login Data"), "opaque browser login owner", 0o600],
    [join(stateRoot, ".runtime-owner.json"), "runtime owner", 0o600],
    [join(stateRoot, "locks", "workers.lock"), "runtime lock", 0o600],
    [join(stateRoot, "artifacts", `${"a".repeat(64)}.artifact`), "opaque managed artifact", 0o644],
    [join(workspace, "data", "downloads", "document.pdf"), "opaque download", 0o644],
    [join(workspace, "data", "onboarding", "packet.pdf"), "opaque onboarding document", 0o644],
  ] as const;
  for (const [path, bytes, mode] of extraFiles) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, bytes, { mode });
  }
  const originals = [database, report, protectedPath, browserPath, join(control, "installation.json"), ...extraFiles.map(([path]) => path)];
  const capture = () => captureFlatArchiveSource({ workspace, stateRoot, installationId, operationId });
  return { workspace, stateRoot, installationId, operationId, database, report, protectedPath, browserPath, originals, root, capture,
    close() { rmSync(workspace, { recursive: true }); } };
}

type Source = ReturnType<typeof SourceRecordSchema.parse>;
function copiedFiles(document: Source) {
  return document.members.flatMap(member => member.kind === "file" && member.disposition === "copy"
    ? [{ path: member.path, size: member.size, digest: member.digest, mode: member.mode }] : []);
}
function seal(f: ReturnType<typeof fixture>, document: Source) {
  const bytes = Buffer.from(canonicalJsonStringify(document));
  mkdirSync(f.root, { recursive: true, mode: 0o700 });
  writeFileSync(join(f.root, "source.json"), bytes, { mode: 0o600 });
  const record = StorageBackupSchema.parse({ schemaVersion: 2, kind: "flat-native6-archive", operationId: document.operationId,
    installationId: document.installationId, sourceStateRoot: document.sourceStateRoot, sourceDigest: hash(bytes), files: copiedFiles(document) });
  const backupPath = join(f.root, "backup.json"), receipt = Buffer.from(canonicalJsonStringify(record));
  writeFileSync(backupPath, receipt, { mode: 0o600 });
  return { backupPath, backupDigest: hash(receipt) };
}

it("records raw companion bytes and explicit absence, preserves excluded owners, and privately copies managed files", () => {
  const f = fixture();
  try {
    chmodSync(f.report, 0o644);
    writeFileSync(`${f.database}-wal`, Buffer.from([4, 0, 255]), { mode: 0o600 });
    writeFileSync(`${f.database}-shm`, Buffer.from([5, 0, 254]), { mode: 0o600 });
    const before = [...f.originals, `${f.database}-wal`, `${f.database}-shm`]
      .map(path => ({ path, bytes: readFileSync(path), mode: statSync(path).mode, inode: statSync(path).ino }));
    const source = f.capture();
    assert.equal(source.document.schemaVersion, 2);
    assert.equal(source.document.kind, "flat-native6-archive");
    assert.equal(source.document.operationId, f.operationId);
    const paths = source.document.members.map(member => member.path);
    assert.deepEqual(paths, [...new Set(paths)].sort());
    assert.deepEqual(source.document.members.find(member => member.path === "profile/state.db-journal"), {
      kind: "absent", path: "profile/state.db-journal", disposition: "copy",
    });
    for (const path of ["profile/credentials/protected.json", "profile/credentials/duo-webauthn.json", "profile/credentials/chatgpt-account.json", "profile/browsers/w1/ucpath/Default/Preferences", "profile/browsers/w1/ucpath/Default/Cookies"]) {
      assert.ok(source.document.members.some(member => member.path === path && member.kind === "file" && member.disposition === "auth-state"));
    }
    for (const path of ["profile/.runtime-owner.json", "profile/locks/workers.lock"]) {
      assert.ok(source.document.members.some(member => member.path === path && member.kind === "file" && member.disposition === "runtime-state"));
    }
    const files = copiedFiles(source.document);
    assert.deepEqual(files.map(entry => entry.path), [
      "control/installation.json", `profile/artifacts/${"a".repeat(64)}.artifact`,
      "profile/state.db", "profile/state.db-shm", "profile/state.db-wal",
      "workspace-data/downloads/document.pdf", "workspace-data/onboarding/packet.pdf", "workspace-data/reports/report.csv",
    ]);
    const report = files.find(entry => entry.path === "workspace-data/reports/report.csv");
    assert.equal(report?.mode, 0o644);
    writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
    verifyCopies(f.root, files);
    for (const entry of files) {
      const path = join(f.root, "files", entry.path);
      assert.equal(statSync(path).mode & 0o7777, 0o600);
      for (let directory = dirname(path); directory !== f.root; directory = dirname(directory)) assert.equal(statSync(directory).mode & 0o7777, 0o700);
    }
    for (const entry of before) {
      assert.deepEqual(readFileSync(entry.path), entry.bytes);
      assert.equal(statSync(entry.path).mode, entry.mode);
      assert.equal(statSync(entry.path).ino, entry.inode);
    }
    for (const suffix of ["", "-wal", "-shm"]) assert.deepEqual(readFileSync(join(f.root, "files", "profile", `state.db${suffix}`)), readFileSync(`${f.database}${suffix}`));
    for (const name of ["credentials", "browsers", "locks", ".runtime-owner.json"]) assert.equal(existsSync(join(f.root, "files", "profile", name)), false);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
  } finally { f.close(); }
});

for (const change of ["bytes", "identity", "mode", "membership", "absent-companion", "excluded-bytes", "excluded-membership"] as const) {
  it(`rejects source ${change} drift against the same operation`, () => {
    const f = fixture();
    try {
      const source = f.capture();
      if (change === "bytes") writeFileSync(f.report, "changed");
      if (change === "identity") { const replacement = `${f.report}.new`; writeFileSync(replacement, readFileSync(f.report), { mode: 0o600 }); renameSync(replacement, f.report); }
      if (change === "mode") chmodSync(f.report, 0o644);
      if (change === "membership") writeFileSync(join(dirname(f.report), "new.csv"), "new", { mode: 0o600 });
      if (change === "absent-companion") writeFileSync(`${f.database}-journal`, "new", { mode: 0o600 });
      if (change === "excluded-bytes") writeFileSync(f.protectedPath, "changed protected owner");
      if (change === "excluded-membership") writeFileSync(join(dirname(f.browserPath), "NewAuthFile"), "new auth owner", { mode: 0o600 });
      const bytes = readFileSync(f.database);
      assert.throws(source.assertCurrent);
      assert.throws(() => writeFlatArchiveCopies(f.root, source.document, source.assertCurrent));
      assert.deepEqual(readFileSync(f.database), bytes);
    } finally { f.close(); }
  });
}

for (const change of ["unknown-root", "symlink", "hardlink", "private-mode", "excluded-directory-mode", "unknown-browser-layout", "unknown-credential", "unknown-workspace-container"] as const) {
  it(`rejects unproved source membership or identity: ${change}`, () => {
    const f = fixture();
    try {
      if (change === "unknown-root") writeFileSync(join(f.stateRoot, "unknown"), "unknown", { mode: 0o600 });
      if (change === "symlink") { unlinkSync(f.report); symlinkSync(f.database, f.report); }
      if (change === "hardlink") linkSync(f.protectedPath, join(f.workspace, "credential-alias"));
      if (change === "private-mode") chmodSync(f.protectedPath, 0o644);
      if (change === "excluded-directory-mode") chmodSync(dirname(f.protectedPath), 0o755);
      if (change === "unknown-credential") writeFileSync(join(dirname(f.protectedPath), "unknown.json"), "unknown owner", { mode: 0o600 });
      if (change === "unknown-workspace-container") mkdirSync(join(f.workspace, "data", "unknown"), { mode: 0o700 });
      if (change === "unknown-browser-layout") mkdirSync(join(f.stateRoot, "browsers", "unbounded"), { mode: 0o700 });
      const bytes = readFileSync(f.database);
      if (change === "hardlink") {
        assert.equal(statSync(f.protectedPath).nlink, 2);
        assert.throws(f.capture, /permissions or identity/u);
      } else assert.throws(f.capture);
      assert.deepEqual(readFileSync(f.database), bytes);
      assert.equal(existsSync(join(f.root, "files")), false);
    } finally { f.close(); }
  });
}

it("resumes only an exact copied prefix and preserves already completed copy identity", () => {
  const f = fixture();
  try {
    const source = f.capture(), files = copiedFiles(source.document), first = files[0];
    assert.ok(first);
    const path = join(f.root, "files", first.path);
    const sourcePath = first.path.startsWith("profile/") ? join(f.stateRoot, first.path.slice("profile/".length))
      : first.path.startsWith("control/") ? join(f.workspace, ".tracker", first.path) : join(f.workspace, "data", first.path.slice("workspace-data/".length));
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, readFileSync(sourcePath), { mode: 0o600 });
    const inode = statSync(path).ino;
    writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
    verifyCopies(f.root, files);
    assert.equal(statSync(path).ino, inode);
    writeFileSync(path, "interrupted corrupt copy");
    assert.throws(() => writeFlatArchiveCopies(f.root, source.document, source.assertCurrent));
    assert.equal(readFileSync(path, "utf8"), "interrupted corrupt copy");
  } finally { f.close(); }
});

for (const change of ["missing", "bytes", "size", "mode", "symlink", "hardlink", "extra-file", "extra-empty-directory"] as const) {
  it(`rejects copied ${change} without repairing the archive`, () => {
    const f = fixture();
    try {
      const source = f.capture(), files = copiedFiles(source.document), path = join(f.root, "files", "workspace-data", "reports", "report.csv");
      writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
      if (change === "missing") unlinkSync(path);
      if (change === "bytes") writeFileSync(path, "status\nreplaced\n");
      if (change === "size") writeFileSync(path, "x");
      if (change === "mode") chmodSync(path, 0o644);
      if (change === "symlink") { unlinkSync(path); symlinkSync(f.database, path); }
      if (change === "hardlink") {
        const alias = join(f.workspace, "copy-alias");
        writeFileSync(alias, readFileSync(path), { mode: 0o600 });
        unlinkSync(path); linkSync(alias, path);
      }
      if (change === "extra-file") writeFileSync(join(f.root, "files", "extra"), "extra", { mode: 0o600 });
      if (change === "extra-empty-directory") mkdirSync(join(f.root, "files", "extra"), { mode: 0o700 });
      if (change === "hardlink") {
        assert.equal(statSync(path).nlink, 2);
        assert.deepEqual(readFileSync(path), readFileSync(f.report));
        assert.throws(() => verifyCopies(f.root, files), /membership-unsafe/u);
      } else assert.throws(() => verifyCopies(f.root, files));
      if (change === "missing") assert.equal(existsSync(path), false);
    } finally { f.close(); }
  });
}

it("records recognized empty directories without manufacturing empty copy directories", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.stateRoot, "scratch"), { mode: 0o700 });
    const source = f.capture();
    assert.ok(source.document.members.some(member => member.path === "profile/scratch" && member.kind === "directory"));
    writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
    assert.equal(existsSync(join(f.root, "files", "profile", "scratch")), false);
    verifyCopies(f.root, copiedFiles(source.document));
  } finally { f.close(); }
});

it("refuses destinations inside the source and through aliases before changing original bytes", () => {
  const f = fixture();
  try {
    const source = f.capture(), before = readFileSync(f.database), alias = join(f.workspace, "alias");
    symlinkSync(f.stateRoot, alias);
    for (const root of [join(f.stateRoot, "archive"), join(alias, "archive")]) assert.throws(() => writeFlatArchiveCopies(root, source.document, source.assertCurrent));
    assert.deepEqual(readFileSync(f.database), before);
    assert.equal(existsSync(join(f.stateRoot, "archive")), false);
  } finally { f.close(); }
});

it("verifies a completed archive independently after the original managed source is gone", () => {
  const f = fixture();
  try {
    const source = f.capture();
    writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
    const reference = seal(f, source.document);
    rmSync(f.stateRoot, { recursive: true }); rmSync(join(f.workspace, "data"), { recursive: true });
    assert.deepEqual(retainedStorageBackup(f.workspace, f.installationId, reference), reference);
    assert.equal(existsSync(f.stateRoot), false);
  } finally { f.close(); }
});

for (const change of ["operation", "installation", "root", "source-digest", "file-projection", "source-record", "old-v1"] as const) {
  it(`refuses completed archive ${change} tampering`, () => {
    const f = fixture();
    try {
      const source = f.capture();
      writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
      const reference = seal(f, source.document), path = reference.backupPath;
      const record = StorageBackupSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (change === "operation") writeFileSync(path, JSON.stringify({ ...record, operationId: randomUUID() }));
      if (change === "installation") writeFileSync(path, JSON.stringify({ ...record, installationId: randomUUID() }));
      if (change === "root") writeFileSync(path, JSON.stringify({ ...record, sourceStateRoot: join(f.workspace, "other") }));
      if (change === "source-digest") writeFileSync(path, JSON.stringify({ ...record, sourceDigest: "f".repeat(64) }));
      if (change === "file-projection") writeFileSync(path, JSON.stringify({ ...record, files: record.files.slice(1) }));
      if (change === "source-record") writeFileSync(join(f.root, "source.json"), JSON.stringify({ ...source.document, operationId: randomUUID() }));
      if (change === "old-v1") writeFileSync(path, JSON.stringify({ ...record, schemaVersion: 1 }));
      const changed = readFileSync(path);
      assert.throws(() => retainedStorageBackup(f.workspace, f.installationId));
      assert.deepEqual(readFileSync(path), changed);
    } finally { f.close(); }
  });
}

it("requires a strict source envelope with one sorted safe path and every database companion disposition", () => {
  const f = fixture();
  try {
    const { document } = f.capture();
    for (const members of [document.members.slice().reverse(), [...document.members, document.members[0]],
      document.members.filter(member => member.path !== "profile/state.db-wal"),
      document.members.filter(member => member.path !== "profile/state.db"),
      document.members.map(member => member.path === "profile/state.db" ? { ...member, path: "profile/../state.db" } : member)]) {
      assert.equal(SourceRecordSchema.safeParse({ ...document, members }).success, false);
    }
    for (const extra of [{ inode: 1 }, { device: 1 }, { schemaVersion: 1 }, { sourceStateRoot: "relative" }]) {
      assert.equal(SourceRecordSchema.safeParse({ ...document, ...extra }).success, false);
    }
  } finally { f.close(); }
});

it("archives a present rollback journal and records an absent workspace-data root", () => {
  const f = fixture();
  try {
    const journal = Buffer.from([9, 0, 255, 1]);
    writeFileSync(`${f.database}-journal`, journal, { mode: 0o600 });
    rmSync(join(f.workspace, "data"), { recursive: true });
    const source = f.capture();
    assert.deepEqual(source.document.members.find(member => member.path === "workspace-data"), {
      kind: "absent", path: "workspace-data", disposition: "copy",
    });
    for (const suffix of ["-wal", "-shm"]) assert.deepEqual(source.document.members.find(member => member.path === `profile/state.db${suffix}`), {
      kind: "absent", path: `profile/state.db${suffix}`, disposition: "copy",
    });
    writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
    assert.deepEqual(readFileSync(join(f.root, "files", "profile", "state.db-journal")), journal);
    assert.deepEqual(readFileSync(`${f.database}-journal`), journal);
    assert.equal(existsSync(join(f.root, "files", "workspace-data")), false);
  } finally { f.close(); }
});

for (const change of ["hole", "extra-empty-directory", "extra-file"] as const) {
  it(`refuses an interrupted copy with ${change} without modifying the prefix`, () => {
    const f = fixture();
    try {
      const source = f.capture(), files = copiedFiles(source.document), selected = files[change === "hole" ? 1 : 0];
      assert.ok(selected);
      const path = join(f.root, "files", selected.path);
      const original = selected.path.startsWith("control/") ? join(f.workspace, ".tracker", selected.path)
        : selected.path.startsWith("profile/") ? join(f.stateRoot, selected.path.slice("profile/".length))
          : join(f.workspace, "data", selected.path.slice("workspace-data/".length));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, readFileSync(original), { mode: 0o600 });
      if (change === "extra-empty-directory") mkdirSync(join(f.root, "files", "extra"), { mode: 0o700 });
      if (change === "extra-file") writeFileSync(join(f.root, "files", "extra"), "unexpected", { mode: 0o600 });
      const inode = statSync(path).ino, bytes = readFileSync(path);
      assert.throws(() => writeFlatArchiveCopies(f.root, source.document, source.assertCurrent));
      assert.equal(statSync(path).ino, inode);
      assert.deepEqual(readFileSync(path), bytes);
      assert.equal(existsSync(join(f.root, "backup.json")), false);
    } finally { f.close(); }
  });
}

it("rejects forged copy dispositions and incomplete or unsafe source membership", () => {
  const f = fixture();
  try {
    const { document } = f.capture();
    const invalid = [
      document.members.map(member => member.path === "profile/credentials/protected.json" ? { ...member, disposition: "copy" } : member),
      document.members.map(member => member.path === "profile/browsers/w1/ucpath/Default/Preferences" ? { ...member, disposition: "copy" } : member),
      document.members.map(member => member.path === "profile/locks/workers.lock" ? { ...member, disposition: "copy" } : member),
      document.members.map(member => member.path === "profile/state.db" ? { ...member, disposition: "auth-state" } : member),
      document.members.filter(member => member.path !== "workspace-data/reports"),
      document.members.map(member => member.path === "profile/state.db" ? { ...member, path: "/state.db" } : member),
      document.members.map(member => member.path === "profile/state.db" ? { ...member, path: "profile\\state.db" } : member),
    ];
    for (const members of invalid) {
      assert.equal(SourceRecordSchema.safeParse({ ...document, members }).success, false);
      assert.throws(() => writeFlatArchiveCopies(f.root, { ...document, members } as Source, () => {}));
    }
    assert.equal(existsSync(join(f.root, "files")), false);
    assert.deepEqual(readFileSync(f.database), Buffer.from([0, 255, 7, 3]));
  } finally { f.close(); }
});

it("binds retained verification to the exact reference and refuses unknown archive membership", () => {
  const f = fixture();
  try {
    const source = f.capture();
    writeFlatArchiveCopies(f.root, source.document, source.assertCurrent);
    const reference = seal(f, source.document);
    assert.throws(() => retainedStorageBackup(f.workspace, f.installationId, { ...reference, backupDigest: "f".repeat(64) }));
    assert.throws(() => retainedStorageBackup(f.workspace, f.installationId, { ...reference, backupPath: join(f.root, "other.json") }));
    mkdirSync(join(f.root, "unknown"), { mode: 0o700 });
    assert.throws(() => retainedStorageBackup(f.workspace, f.installationId, reference));
    assert.deepEqual(readFileSync(f.database), Buffer.from([0, 255, 7, 3]));
  } finally { f.close(); }
});
