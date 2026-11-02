import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { afterEach,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hash } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { assertFixedLayoutEntries,assertFixedLayoutMove,createFixedLayoutDirectory,FixedLayoutActivationSchema,fixedLayoutBindingEntries,fixedLayoutEntries,FixedLayoutIntentSchema,fixedLayoutOutputPaths,fixedLayoutSettingsUpdate,fixedLayoutSourceFence,readFixedLayoutIntent } from "../../../../src/backend/storage/maintenance/fixed-layout.js";
import { authenticateSavedSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { derivePersistedSettingsFingerprint } from "../../../../src/models/config/settings.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fixed-layout-"))); roots.push(root);
  const source = join(root, "source"); mkdirSync(source, { mode: 0o700 });
  mkdirSync(join(source, "empty"), { mode: 0o700 });
  writeFileSync(join(source, "identity.json"), "before\n", { mode: 0o600 });
  writeFileSync(join(source, "retained.bin"), "unchanged\n", { mode: 0o600 });
  return { root, source, target: join(root, "target") };
}
it("retains every file and empty directory identity across the atomic directory move", () => {
  const f = fixture(), before = fixedLayoutEntries(f.source);
  renameSync(f.source, f.target);
  assertFixedLayoutEntries(before, fixedLayoutEntries(f.target));
  assert.equal(readFileSync(join(f.target, "retained.bin"), "utf8"), "unchanged\n");
});
it("accepts only an exact recorded binding rewrite and requires its completion", () => {
  const f = fixture(), before = fixedLayoutEntries(f.source);
  const rewrites = [{ path: "identity.json", before: hash(Buffer.from("before\n")), after: hash(Buffer.from("after\n")) }];
  assertFixedLayoutEntries(before, fixedLayoutEntries(f.source), rewrites);
  assert.throws(() => assertFixedLayoutEntries(before, fixedLayoutEntries(f.source), rewrites, true), /entry-changed/u);
  writeFileSync(join(f.root, "stage"), "after\n", { mode: 0o600 }); renameSync(join(f.root, "stage"), join(f.source, "identity.json"));
  assertFixedLayoutEntries(before, fixedLayoutEntries(f.source), rewrites, true);
  assert.throws(() => assertFixedLayoutEntries(before, fixedLayoutEntries(f.source)), /entry-changed/u);
});
it("refuses missing, extra, changed and duplicate members", () => {
  const f = fixture(), before = fixedLayoutEntries(f.source);
  assert.throws(() => assertFixedLayoutEntries(before, before.slice(1)), /membership-changed/u);
  const first = before[0]; assert.ok(first);
  assert.throws(() => assertFixedLayoutEntries(before, [...before, first]), /membership-changed/u);
  writeFileSync(join(f.source, "extra"), "unknown", { mode: 0o600 });
  assert.throws(() => assertFixedLayoutEntries(before, fixedLayoutEntries(f.source)), /membership-changed/u);
  rmSync(join(f.source, "extra")); writeFileSync(join(f.source, "retained.bin"), "changed\n");
  assert.throws(() => assertFixedLayoutEntries(before, fixedLayoutEntries(f.source)), /entry-changed/u);
});
it("refuses an unbound rewrite and symlinked membership", () => {
  const f = fixture(), before = fixedLayoutEntries(f.source);
  assert.throws(() => assertFixedLayoutEntries(before, before, [{ path: "absent", before: "a".repeat(64), after: "b".repeat(64) }]), /rewrite-unbound/u);
  symlinkSync(join(f.source, "retained.bin"), join(f.source, "link"));
  assert.throws(() => fixedLayoutEntries(f.source), /unsafe/u);
});

it("refuses a symlinked ancestor even for an empty directory and refuses hardlinks", () => {
  const f = fixture();
  symlinkSync(f.source, join(f.root, "alias"));
  assert.throws(() => fixedLayoutEntries(join(f.root, "alias", "empty")), /ancestry contains a symbolic link/u);
  linkSync(join(f.source, "retained.bin"), join(f.source, "duplicate.bin"));
  assert.throws(() => fixedLayoutEntries(f.source), /unsafe/u);
});

function layoutFixture() {
  const f = fixture(), sourceWorkspace = f.source, targetWorkspace = f.target;
  mkdirSync(join(sourceWorkspace, ".tracker", "data", "artifacts"), { recursive: true, mode: 0o700 });
  mkdirSync(join(sourceWorkspace, ".tracker", "control"), { mode: 0o700 });
  mkdirSync(join(targetWorkspace, ".tracker"), { recursive: true, mode: 0o700 });
  const installationId = randomUUID(), operationId = randomUUID();
  const bindings = (["state", "artifact", "installation", "locator"] as const).map(role => {
    const path = role === "state" ? "data/.runtime-owner.json" : role === "artifact" ? "data/artifacts/.runtime-owner.json" : `control/${role}.json`;
    writeFileSync(join(sourceWorkspace, ".tracker", path), JSON.stringify({ role, installationId, workspace: sourceWorkspace }), { mode: 0o600 });
    return { role, content: JSON.stringify({ role, installationId, workspace: targetWorkspace }) };
  });
  const intent = FixedLayoutIntentSchema.parse({ schemaVersion: 1, operationId, installationId, sourceWorkspace, targetWorkspace, phase: "moving",
    bindings, profiles: [], data: fixedLayoutEntries(join(sourceWorkspace, ".tracker", "data")), control: fixedLayoutEntries(join(sourceWorkspace, ".tracker", "control")) });
  const journal = join(targetWorkspace, ".tracker", "fixed-layout.json");
  writeFileSync(journal, JSON.stringify(intent), { mode: 0o600 });
  return { ...f, intent, journal, sourceTracker: join(sourceWorkspace, ".tracker"), targetTracker: join(targetWorkspace, ".tracker") };
}

it("classifies every data/fence/control/binding publication prefix without accepting foreign members", () => {
  const f = layoutFixture();
  assertFixedLayoutMove(f.intent);
  assert.throws(() => assertFixedLayoutMove(f.intent, true), /move-prefix-invalid/u);
  writeFileSync(join(f.targetTracker, "unknown"), "unknown", { mode: 0o600 });
  assert.throws(() => assertFixedLayoutMove(f.intent), /target-membership-unknown/u);
  rmSync(join(f.targetTracker, "unknown"));
  renameSync(join(f.sourceTracker, "data"), join(f.targetTracker, "data"));
  assertFixedLayoutMove(f.intent);
  mkdirSync(join(f.sourceTracker, "data"), { mode: 0o700 });
  assertFixedLayoutMove(f.intent);
  const fence = join(f.sourceTracker, "data", ".runtime-source-fence.json");
  writeFileSync(fence, "foreign", { mode: 0o600 });
  assert.throws(() => assertFixedLayoutMove(f.intent), /source-fence-changed/u);
  writeFileSync(fence, fixedLayoutSourceFence(f.intent));
  assertFixedLayoutMove(f.intent);
  renameSync(join(f.sourceTracker, "control"), join(f.targetTracker, "control"));
  assertFixedLayoutMove(f.intent);
  for (const [index, binding] of fixedLayoutBindingEntries(f.intent).entries()) {
    assert.throws(() => assertFixedLayoutMove(f.intent, true), /entry-changed/u);
    const path = join(f.targetTracker, binding.tree, binding.path);
    if (index === 0) {
      const stage = join(dirname(path), `.fixed-layout-${f.intent.operationId}.stage`);
      writeFileSync(stage, binding.content, { mode: 0o600 }); assertFixedLayoutMove(f.intent);
      writeFileSync(stage, "changed"); assert.throws(() => assertFixedLayoutMove(f.intent), /binding-stage-changed/u);
      writeFileSync(stage, binding.content); renameSync(stage, path);
    } else writeFileSync(path, binding.content);
    assertFixedLayoutMove(f.intent);
  }
  assertFixedLayoutMove(f.intent, true);
  writeFileSync(join(f.sourceTracker, "data", "extra"), "foreign", { mode: 0o600 });
  assert.throws(() => assertFixedLayoutMove(f.intent, true), /source-fence-changed/u);
});

it("recognizes an exact unpublished journal and only the next phase's exact staged bytes", () => {
  const f = layoutFixture(), stage = (phase: string) => join(f.targetTracker, `.fixed-layout-${f.intent.operationId}-${phase}.stage`);
  renameSync(f.journal, stage("moving"));
  assert.deepEqual(readFixedLayoutIntent(f.target), f.intent);
  assertFixedLayoutMove(f.intent);
  renameSync(stage("moving"), f.journal);
  const next = { ...f.intent, phase: "configuring" };
  writeFileSync(stage("configuring"), JSON.stringify(next), { mode: 0o600 });
  assert.deepEqual(readFixedLayoutIntent(f.target), f.intent);
  writeFileSync(stage("configuring"), JSON.stringify({ ...next, installationId: randomUUID() }));
  assert.throws(() => readFixedLayoutIntent(f.target), /journal-stage-changed/u);
  writeFileSync(stage("configuring"), JSON.stringify(next)); renameSync(stage("configuring"), f.journal);
  assert.deepEqual(readFixedLayoutIntent(f.target), next);
  writeFileSync(stage("moving"), JSON.stringify(f.intent), { mode: 0o600 });
  assert.throws(() => readFixedLayoutIntent(f.target), /journal-stage-changed/u);
});

it("records the exact saved default-browser rewrite with its ordinary command and audit, retaining other settings", () => {
  const f = layoutFixture(), profileId = randomUUID();
  const sourceRoot = join(f.source, ".tracker", "data", "profiles", profileId), targetRoot = join(f.target, ".tracker", "data", "profiles", profileId);
  const settings = { actor: { label: "Retained operator" }, paths: { reportsDir: join(f.root, "reports"), browserProfileRoot: join(sourceRoot, "browsers") } };
  const before = resolveConfigWithProvenance(settings, { primaryDisplay: null }, undefined, { stateRoot: sourceRoot, artifactRoot: join(sourceRoot, "artifacts") });
  const downloadsDir = join(f.source, "data", "downloads");
  const after = resolveConfigWithProvenance({ ...settings, paths: { ...settings.paths, downloadsDir, browserProfileRoot: join(targetRoot, "browsers") } }, { primaryDisplay: null }, undefined, { stateRoot: targetRoot, artifactRoot: join(targetRoot, "artifacts") });
  const capturedAt = "2026-11-01T12:00:00.000Z";
  const intent = FixedLayoutActivationSchema.parse({ profileId, sourceRoot, authorityPath: join(targetRoot, "state.db"),
    backupFileName: `authority-g3-1-${randomUUID()}.sqlite`, backupSha256: "a".repeat(64), backupManifestSha256: "b".repeat(64),
    preAuthorityGeneration: 3, preAuthorityContentFingerprint: "c".repeat(64), settingsRevision: 2, settingsFingerprint: derivePersistedSettingsFingerprint(settings),
    priorActive: { generation: 2, settingsRevision: 2, settingsFingerprint: derivePersistedSettingsFingerprint(settings), configSnapshotId: randomUUID(), configFingerprint: before.fingerprint, activatedAt: capturedAt },
    settingsUpdate: { commandId: randomUUID(), auditId: randomUUID(), previousBrowserRoot: settings.paths.browserProfileRoot, outputPaths: { downloadsDir } },
    snapshot: { configSnapshotId: randomUUID(), revision: 3, fingerprint: after.fingerprint, config: after.config, provenance: after.provenance, capturedAt, capturedBy: "local-operator" } });
  const update = fixedLayoutSettingsUpdate(intent, settings);
  assert.deepEqual(update.current.settings, { ...settings, paths: { ...settings.paths, downloadsDir, browserProfileRoot: join(targetRoot, "browsers") } });
  assert.deepEqual(authenticateSavedSettings(update.current, update.request, update.audit).result, update.audit.result);
  assert.deepEqual(update.request.payload.patch, { "paths.browserProfileRoot": { set: join(targetRoot, "browsers") }, "paths.downloadsDir": { set: downloadsDir } });
  assert.throws(() => fixedLayoutSettingsUpdate(intent, { ...settings, paths: { ...settings.paths, downloadsDir: join(f.root, "changed") } }), /output-override-changed/u);
  assert.throws(() => fixedLayoutSettingsUpdate(intent, { ...settings, paths: { ...settings.paths, browserProfileRoot: join(f.root, "foreign") } }), /browser-setting-changed/u);
  assert.equal(FixedLayoutActivationSchema.safeParse({ ...intent, snapshot: { ...intent.snapshot, revision: 4 } }).success, false);
});


it("preserves external output folders and rebinds only folders carried by the data move", () => {
  const f = layoutFixture(), sourceRoot = join(f.source, ".tracker", "data", "profiles", randomUUID()), targetRoot = join(f.target, ".tracker", "data", "profiles", randomUUID());
  const config = resolveConfigWithProvenance({}, { primaryDisplay: null }, undefined, { stateRoot: sourceRoot, artifactRoot: join(sourceRoot, "artifacts") }).config;
  const reportsDir = join(f.root, "selected-reports"), downloadsDir = join(sourceRoot, "files", "chosen-downloads");
  assert.deepEqual(fixedLayoutOutputPaths({ paths: { reportsDir, downloadsDir } }, config.paths, sourceRoot, targetRoot), {
    downloadsDir: join(targetRoot, "files", "chosen-downloads"), onboardingDocsDir: join(targetRoot, "files", "onboarding"),
    i9CheckTrackerPath: join(targetRoot, "files", "reports", "i9-check-tracker.xlsx"),
  });
  const outside = `${sourceRoot}-other`;
  assert.equal(fixedLayoutOutputPaths({}, { ...config.paths, reportsDir: outside }, sourceRoot, targetRoot).reportsDir, outside);
});

it("creates missing fixed workspace parents privately and refuses a linked parent", () => {
  const f = fixture(), workspace = join(f.root, "Library", "Application Support", "Relay");
  createFixedLayoutDirectory(workspace);
  assert.equal(lstatSync(workspace).mode & 0o7777, 0o700);
  symlinkSync(join(f.root, "Library"), join(f.root, "alias"));
  assert.throws(() => createFixedLayoutDirectory(join(f.root, "alias", "Relay")), /symbolic link/u);
});
