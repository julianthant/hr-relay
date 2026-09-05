import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock, type Clock } from "../../../src/domain/clock.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
  settingsRuntimeIdentity,
  type SettingsFileRecord,
} from "../../../src/domain/config/settings.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsReadbackSchema,
  protectedSettingsReadback,
  type ProtectedStoreRecord,
} from "../../../src/domain/config/protected-settings.js";
import { settingsRootPaths } from "../../../src/domain/config/settings-root.js";
import {
  ProtectedSettingsCommandRequestSchema,
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
  markSettingsCommand,
} from "../../../src/domain/commands.js";
import {
  createProtectedSettingsFileAuthority,
  createSettingsFileAuthority,
} from "../../../src/infra/config/settings-file.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { buildSettingsEditor } from "../../../src/server/dashboard/queries/settings-editor.js";
import { createSettingsApplicationExecutor } from "../../../src/server/dashboard/commands/settings-service.js";
import {
  createProtectedSettingsRuntimeReader,
  createSettingsRuntimeReader,
} from "../../../src/server/settings-runtime.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function activate(
  database: AuthorityDatabase,
  record: SettingsFileRecord,
  clock: Clock,
  configSnapshotId: string,
) {
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock);
  database.withAuthorityTransaction((repositories) => {
    repositories.configSnapshots.insert({
      configSnapshotId,
      revision: 1,
      fingerprint: resolved.fingerprint,
      capturedAt: clock.now().toISOString(),
      capturedBy: "local-operator",
      config: resolved.config,
      provenance: resolved.provenance,
    });
    repositories.runtimeConfig.activate({
      settingsRevision: record.revision,
      settingsFingerprint: record.settingsFingerprint,
      configSnapshotId,
      configFingerprint: resolved.fingerprint,
      activatedAt: clock.now().toISOString(),
    });
  });
  return settingsRuntimeIdentity(record, resolved.fingerprint);
}

function fixture(afterLockLinked: () => void = () => undefined) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-reader-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
  const databasePath = join(root, "state.db");
  const database = AuthorityDatabase.open({
    path: databasePath, busyTimeoutMs: 250, migrationOwner: "unit-test",
  }, clock);
  cleanups.push(() => database.close());
  let lockAcquisitions = 0;
  const path = join(root, "settings", "settings.json");
  const file = createSettingsFileAuthority({
    path,
    validateCandidate: (settings) => { resolveConfigWithProvenance(settings, hostConfigFacts({}), clock); },
    hooks: { afterLockLinked: () => { lockAcquisitions += 1; afterLockLinked(); } },
  });
  const initial = file.read();
  const active = activate(database, initial, clock, "11111111-1111-4111-8111-111111111111");
  const reader = createSettingsRuntimeReader({ file, database, environment: {}, clock, active });
  return { database, databasePath, file, path, clock, initial, active, reader, locks: () => lockAcquisitions };
}

function protectedFixture() {
  const ordinary = fixture();
  const paths = settingsRootPaths(dirname(dirname(ordinary.path)));
  const file = createProtectedSettingsFileAuthority({
    path: paths.ordinary,
    assertWriteIdAvailable: () => undefined,
  });
  const initial = file.read();
  const reader = createProtectedSettingsRuntimeReader({ file, database: ordinary.database });
  return { ...ordinary, protectedFile: file, protectedInitial: initial, protectedReader: reader };
}

function persistProtected(
  f: ReturnType<typeof protectedFixture>,
  value: string,
  journal: boolean,
): Readonly<{
  command: ReturnType<typeof ProtectedSettingsCommandRequestSchema.parse>;
  record: ProtectedStoreRecord;
}> {
  const command = ProtectedSettingsCommandRequestSchema.parse({
    commandId: "55555555-5555-4555-8555-555555555555",
    requestedAt: f.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: 1 },
    payload: {
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: "66666666-6666-4666-8666-666666666666",
      entries: { ucpathPassword: { set: value } },
    },
  });
  const commandFingerprint = deriveSettingsCommandFingerprint(command);
  const outcome = f.protectedFile.apply({
    commandId: command.commandId,
    commandFingerprint,
    expectedRevision: command.target.expectedRevision,
    protectedSchemaHash: command.payload.protectedSchemaHash,
    writeId: command.payload.writeId,
    entries: command.payload.entries,
    updatedAt: command.requestedAt,
  });
  if (outcome.state !== "applied") assert.fail(`fixture protected settings apply refused: ${outcome.message}`);
  const readback = protectedSettingsReadback(outcome.record);
  if (journal) f.database.withAuthorityTransaction((repositories) => {
    const marked = markSettingsCommand(command);
    repositories.commands.insert(marked);
    const target = { family: "protected-settings" as const, revision: 2 };
    const auditId = "77777777-7777-4777-8777-777777777777";
    repositories.commandAudits.insert({
      auditId,
      request: marked,
      result: {
        state: "applied",
        commandId: command.commandId,
        affectedTargets: [target],
        restartRequired: false,
        revision: 2,
        entries: readback.entries,
      },
      completedAt: command.requestedAt,
      versionChanges: [{ target, before: 1, after: 2 }],
      affectedDependencyIds: [],
    });
    repositories.protectedSettingsCurrent.advanceInTransaction({
      revision: 2,
      commandId: command.commandId,
      commandFingerprint,
      auditId,
      committedAt: command.requestedAt,
      entries: [{
        name: "ucpathPassword",
        valueId: outcome.record.entries.ucpathPassword?.valueId,
        updatedAt: command.requestedAt,
      }],
    });
  });
  outcome.commit();
  return { command, record: outcome.record };
}

function persistSettings(f: ReturnType<typeof fixture>, journal: boolean): SettingsFileRecord {
  const patch = {
    "display.screenWidth": { set: 1980 },
    "display.screenHeight": { set: 1080 },
  };
  const command = SettingsCommandRequestSchema.parse({
    commandId: "33333333-3333-4333-8333-333333333333",
    requestedAt: f.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  });
  const commandFingerprint = deriveSettingsCommandFingerprint(command);
  const outcome = f.file.apply({
    commandId: command.commandId, commandFingerprint, expectedRevision: 1, ...command.payload,
  });
  if (outcome.state !== "applied") assert.fail(`fixture settings apply refused: ${outcome.message}`);
  if (journal) f.database.withAuthorityTransaction((repositories) => {
    repositories.commands.insert(command);
    const target = { family: "settings" as const, revision: 2 };
    const auditId = "44444444-4444-4444-8444-444444444444";
    repositories.commandAudits.insert({
      auditId, request: command,
      result: {
        state: "applied", commandId: command.commandId, affectedTargets: [target], restartRequired: true,
        settingsRevision: 2, settingsFingerprint: outcome.record.settingsFingerprint,
      },
      completedAt: command.requestedAt,
      versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [],
    });
    repositories.settingsCurrent.advance({
      revision: 2, settingsFingerprint: outcome.record.settingsFingerprint,
      commandId: command.commandId, commandFingerprint, auditId, committedAt: command.requestedAt,
    });
  });
  outcome.commit();
  return outcome.record;
}

describe("verified Settings reader snapshot", () => {
  it("builds a current editor readback with one real Settings lock acquisition", () => {
    const f = fixture();
    for (let read = 0; read < 2; read += 1) {
      const before = f.locks();

      const editor = buildSettingsEditor({ settings: f.reader, environment: {}, clock: f.clock });

      assert.equal(f.locks() - before, 1, "one editor read must acquire the Settings lock exactly once");
      assert.equal(editor.revision, 1);
      assert.equal(editor.settingsFingerprint, f.initial.settingsFingerprint);
      assert.equal(editor.activeConfigFingerprint, f.active.configFingerprint);
      assert.deepEqual(editor.runtimeStatus, { state: "current", identity: f.active });
      assert.equal(editor.sections.flatMap((section) => section.leaves).length, 8);
    }
  });

  it("pairs the new record and restart-required status without caching a prior read", () => {
    const f = fixture();
    assert.deepEqual(f.reader.read(), {
      record: f.initial, runtimeStatus: { state: "current", identity: f.active },
    });
    const record = persistSettings(f, true);
    const persisted = settingsRuntimeIdentity(record, resolveConfigWithProvenance(record.settings, hostConfigFacts({}), f.clock).fingerprint);
    const expectedStatus = { state: "restart-required", active: f.active, persisted };
    const before = f.locks();

    const snapshot = f.reader.read();

    assert.equal(f.locks() - before, 1);
    assert.deepEqual(snapshot, { record, runtimeStatus: expectedStatus });
    const beforeEditor = f.locks();
    const editor = buildSettingsEditor({ settings: f.reader, environment: {}, clock: f.clock });
    assert.equal(f.locks() - beforeEditor, 1);
    assert.equal(editor.revision, 2);
    assert.equal(editor.settingsFingerprint, record.settingsFingerprint);
    assert.equal(editor.activeConfigFingerprint, f.active.configFingerprint);
    assert.deepEqual(editor.runtimeStatus, expectedStatus);
    const width = editor.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(width?.effectiveValue, 1980);
    assert.equal(width?.settingsValue, 1980);
    assert.equal(width?.source, "settings");
  });

  it("refuses a stale THIS-process identity before file access after another activation", () => {
    const f = fixture();
    const record = persistSettings(f, true);
    const active = activate(f.database, record, f.clock, "22222222-2222-4222-8222-222222222222");
    const before = f.locks();
    const bytes = readFileSync(f.path);
    const runtimeBefore = f.database.authority.runtimeConfig.get();

    assert.throws(() => f.reader.read(), /are not dashboard-active; restart activation is required/u);

    assert.equal(f.locks(), before, "stale process identity must refuse before taking a Settings lock");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(f.database.authority.runtimeConfig.get(), runtimeBefore);
    const currentReader = createSettingsRuntimeReader({
      file: f.file, database: f.database, environment: {}, clock: f.clock, active,
    });
    assert.deepEqual(currentReader.read(), { record, runtimeStatus: { state: "current", identity: active } });
    assert.equal(f.locks() - before, 1);
  });

  it("refuses an unjournaled file instead of projecting it as restart-required", () => {
    const f = fixture();
    persistSettings(f, false);
    const before = f.locks();
    const bytes = readFileSync(f.path);
    const meta = f.database.getMeta();

    assert.throws(() => f.reader.read(), /settings revision 2 has no durable command journal/u);

    assert.equal(f.locks() - before, 1);
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(f.database.getMeta(), meta);
    assert.equal(existsSync(join(f.path, "..", "prepare.json")), false);
  });

  it("holds real SQLite writer exclusion while acquiring the Settings file lock", () => {
    let probeWriter: () => void = () => undefined;
    const f = fixture(() => probeWriter());
    const contender = AuthorityDatabase.open({
      path: f.databasePath, busyTimeoutMs: 1, migrationOwner: "unit-test",
    }, f.clock);
    cleanups.push(() => contender.close());
    probeWriter = () => {
      assert.throws(() => contender.withAuthorityTransaction(() => undefined), /database is locked/u);
    };
    const before = f.locks();

    const snapshot = f.reader.read();

    assert.equal(f.locks() - before, 1);
    assert.deepEqual(snapshot, { record: f.initial, runtimeStatus: { state: "current", identity: f.active } });
  });
});

describe("verified protected Settings reader snapshot", () => {
  it("P12 serves only schema identity, revision, and presence/write identity", () => {
    const f = protectedFixture();
    const protectedValue = "never-serve-this-password";
    const { record } = persistProtected(f, protectedValue, true);

    const snapshot = f.protectedReader.read();

    assert.equal(snapshot.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH);
    assert.deepEqual(snapshot.readback, protectedSettingsReadback(record));
    assert.equal(JSON.stringify(snapshot).includes(protectedValue), false);
    assert.equal(snapshot.readback.entries.ucpathPassword.present, true);
    assert.equal(ProtectedSettingsReadbackSchema.safeParse({
      ...snapshot.readback,
      entries: {
        ...snapshot.readback.entries,
        ucpathPassword: { ...snapshot.readback.entries.ucpathPassword, effectiveValue: protectedValue },
      },
    }).success, false);
  });

  it("P21 authenticates marked replay but detects value divergence inside the protected authority", () => {
    const f = protectedFixture();
    const protectedValue = "original-private-value";
    const { command, record } = persistProtected(f, protectedValue, true);
    const executor = createSettingsApplicationExecutor(f.file, f.protectedFile);

    assert.deepEqual(
      f.protectedReader.read().readback,
      protectedSettingsReadback(record),
      "restart authentication compares the durable marked SET envelope, never the raw protected value",
    );

    const exact = f.database.withAuthorityTransaction((repositories) =>
      executor.reconcileReplay(repositories, command));
    assert.deepEqual(exact, protectedSettingsReadback(record));
    assert.equal(
      deriveSettingsCommandFingerprint(command),
      deriveSettingsCommandFingerprint({
        ...command,
        payload: {
          ...command.payload,
          entries: { ucpathPassword: { set: "different-private-value" } },
        },
      }),
    );
    assert.throws(
      () => f.database.withAuthorityTransaction((repositories) => executor.reconcileReplay(
        repositories,
        {
          ...command,
          payload: {
            ...command.payload,
            entries: { ucpathPassword: { set: "different-private-value" } },
          },
        },
      )),
      /command-divergent/u,
    );
  });

  it("P27 refuses an unjournaled protected document by document name", () => {
    const f = protectedFixture();
    persistProtected(f, "private-but-unjournaled", false);

    assert.throws(
      () => f.protectedReader.read(),
      /protected settings revision 2 has no durable command journal for protected\.json/u,
    );
  });
});
