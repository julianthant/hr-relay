import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock, type Clock } from "../../../../../../src/rules/time/clock.js";
import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance, type ResolvedConfig } from "../../../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, settingsRuntimeIdentity, type SettingsFileRecord, type SettingsPatch } from "../../../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, ProtectedSettingsReadbackSchema } from "../../../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../../../src/rules/commands/commands.js";
import { createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { executeSettingsCommand, type CommandAuthority } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { buildSettingsEditor } from "../../../../../../src/backend/runs/queries/settings-editor.js";
import { createSettingsApplicationExecutor } from "../../../../../../src/backend/runs/commands/settings-service.js";
import { activeSettingsConfig, activeSettingsRuntimeIdentity, createCredentialSecretSource, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader, readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { requireSecret } from "../../../../../../src/models/config/secrets.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function readerFor(database: CommandAuthority, input: Parameters<typeof createSettingsRuntimeReader>[0]) {
  const reader = createSettingsRuntimeReader(input);
  return { read: () => database.withAuthorityTransaction(repositories => reader.read(repositories)) };
}
function activate(database: AuthorityDatabase, record: SettingsFileRecord, clock: Clock) {
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock);
  database.withAuthorityTransaction((repositories) => {
    const configSnapshotId = randomUUID();
    repositories.configSnapshots.insert({ configSnapshotId, revision: 1, fingerprint: resolved.fingerprint,
      capturedAt: clock.now().toISOString(), capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
    repositories.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
      configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: clock.now().toISOString() });
  });
  return settingsRuntimeIdentity(record, resolved.fingerprint);
}
function fixture(probe: () => void = () => {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-settings-reader-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
  const databasePath = join(root, "state.db");
  const database = AuthorityDatabase.open({ path: databasePath, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock); cleanups.push(() => database.close());
  const store = createCredentialStore({ stateRoot: root });
  const initial = readSettings(database.authority); const active = activate(database, initial, clock);
  let reads = 0;
  const authority: CommandAuthority = { withAuthorityTransaction: (work) => database.withAuthorityTransaction((repositories) => work({ ...repositories,
    settingsCurrent: { ...repositories.settingsCurrent, get: () => { reads += 1; probe(); return repositories.settingsCurrent.get(); } },
  })) };
  const reader = readerFor(authority, { hostFacts: hostConfigFacts({}), clock, active: activeSettingsRuntimeIdentity });
  const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), store);
  const execute = (command: unknown) => executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID }, settings }, command);
  const apply = () => {
    const patch = { "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } };
    const result = execute({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision: readSettings(database.authority).revision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    assert.equal(result.state, "applied"); return readSettings(database.authority);
  };
  const protectedCommand = (value: string) => ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: store.read().revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: value } } } });
  return { root, database, databasePath, clock, store, initial, active, reader, execute, apply, protectedCommand, reads: () => reads,
    protectedReader: createProtectedSettingsRuntimeReader(store) };
}

describe("SQLite Settings reader snapshot", () => {
  it("resolves the active physical pair without changing the saved ordinary revision", () => {
    const f = fixture();
    const prior = f.database.withAuthorityTransaction(activeSettingsConfig);
    const pair = { stateRoot: join(f.root, "moved-state"), artifactRoot: join(f.root, "moved-artifacts") };
    const resolved = resolveConfigWithProvenance(f.initial.settings, hostConfigFacts({}), f.clock, pair);
    f.database.withAuthorityTransaction((repositories) => {
      const configSnapshotId = randomUUID();
      repositories.configSnapshots.insert({ configSnapshotId, revision: 1, fingerprint: resolved.fingerprint,
        capturedAt: f.clock.now().toISOString(), capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
      repositories.runtimeConfig.activate({ settingsRevision: f.initial.revision, settingsFingerprint: f.initial.settingsFingerprint,
        configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: f.clock.now().toISOString() });
    });
    const reader = readerFor(f.database, { hostFacts: hostConfigFacts({}), clock: f.clock,
      runtimeStoragePair: pair, active: activeSettingsRuntimeIdentity });
    assert.deepEqual(reader.read().runtimeStatus, { state: "current", identity: settingsRuntimeIdentity(f.initial, resolved.fingerprint) });
    assert.equal(readSettings(f.database.authority).revision, f.initial.revision);
    assert.deepEqual(f.database.withAuthorityTransaction(activeSettingsConfig).paths, { ...prior.paths, ...pair });
    assert.notDeepEqual(prior.paths, pair);
  });
  it("builds a current editor with exactly one authoritative read and no file authority", () => {
    const f = fixture();
    for (let count = 0; count < 2; count += 1) {
      const before = f.reads(); const editor = buildSettingsEditor({ settings: f.reader, protectedSettings: f.protectedReader, environment: {}, clock: f.clock });
      assert.equal(f.reads() - before, 1); assert.equal(editor.revision, 1);
      assert.equal(editor.settingsFingerprint, f.initial.settingsFingerprint);
      assert.deepEqual(editor.runtimeStatus, { state: "current", identity: f.active });
      assert.equal(editor.sections.flatMap((section) => section.leaves).length, 60);
    }
    assert.equal(existsSync(join(f.root, "settings")), false);
  });
  it("pairs fresh values and current status without caching a previous read", () => {
    const f = fixture(); f.reader.read(); const record = f.apply();
    const persisted = settingsRuntimeIdentity(record, resolveConfigWithProvenance(record.settings, hostConfigFacts({}), f.clock).fingerprint);
    const expectedStatus = { state: "current", identity: persisted };
    assert.deepEqual(f.reader.read(), { record, runtimeStatus: expectedStatus });
    const editor = buildSettingsEditor({ settings: f.reader, protectedSettings: f.protectedReader, environment: {}, clock: f.clock });
    assert.deepEqual(editor.runtimeStatus, expectedStatus);
    const width = editor.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(width?.effectiveValue, 1980); assert.equal(width?.settingsValue, 1980); assert.equal(width?.source, "settings");
  });
  it("refuses a stale process identity before reading settings after another activation", () => {
    const f = fixture(); const record = f.apply(); const active = activate(f.database, record, f.clock); const before = f.reads();
    const stale = readerFor(f.database, { hostFacts: hostConfigFacts({}), clock: f.clock, active: f.active });
    assert.throws(() => stale.read(), /are not dashboard-active; restart activation is required/u); assert.equal(f.reads(), before);
    const reader = readerFor(f.database, { hostFacts: hostConfigFacts({}), clock: f.clock, active });
    assert.deepEqual(reader.read(), { record, runtimeStatus: { state: "current", identity: active } });
  });
  it("cannot project a corrupt retired file as ordinary authority", () => {
    const f = fixture(); mkdirSync(join(f.root, "settings")); const path = join(f.root, "settings", "settings.json");
    writeFileSync(path, "malformed former authority", { mode: 0o600 }); const before = readFileSync(path);
    assert.equal(f.reader.read().record.revision, 1); const record = f.apply();
    assert.deepEqual(f.reader.read().record, record); assert.deepEqual(readFileSync(path), before);
  });
  it("holds real SQLite writer exclusion during its settings snapshot", () => {
    let probe = () => {}; const f = fixture(() => probe());
    const contender = AuthorityDatabase.open({ path: f.databasePath, busyTimeoutMs: 1, migrationOwner: "contender" }, f.clock); cleanups.push(() => contender.close());
    probe = () => { assert.throws(() => contender.withAuthorityTransaction(() => {}), /database is locked/u); };
    assert.deepEqual(f.reader.read(), { record: f.initial, runtimeStatus: { state: "current", identity: f.active } });
  });
});

describe("independent protected Settings reader", () => {
  it("serves the stored credential value with the authenticated readback", () => {
    const f = fixture(); f.execute(f.protectedCommand("synthetic-protected-readback"));
    const snapshot = f.protectedReader.read(); assert.equal(snapshot.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH);
    ProtectedSettingsReadbackSchema.parse(snapshot.readback); assert.equal(snapshot.readback.revision, 2);
    assert.equal(snapshot.record.entries.ucpathPassword?.value, "synthetic-protected-readback");
    assert.equal(JSON.stringify(snapshot).includes("synthetic-protected-readback"), true);
  });
  it("P21 verifies exact retry and refuses value-divergent reuse", () => {
    const f = fixture(); const command = f.protectedCommand("synthetic-first-value"); f.execute(command);
    assert.equal(f.execute(command).state, "already-applied");
    const divergent = structuredClone(command); divergent.payload.entries.ucpathPassword = { set: "synthetic-different-value" };
    assert.equal(f.execute(divergent).state, "rejected");
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(f.store)), "synthetic-first-value");
  });
  it("D336 replaces P27: independent committed credentials remain available without a SQLite audit", () => {
    const f = fixture(); const command = f.protectedCommand("synthetic-before-audit");
    const result = f.store.apply(ProtectedSettingsApplyInputSchema.parse({ ...command.payload, commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command), expectedRevision: command.target.expectedRevision, updatedAt: command.requestedAt }));
    assert.equal(result.state, "applied"); assert.equal(f.database.authority.commands.get(command.commandId), undefined);
    assert.equal(f.protectedReader.read().readback.revision, 2);
  });
  it("observes each credential at next use without changing ordinary runtime identity", () => {
    const f = fixture(); const before = f.reader.read(); const source = createCredentialSecretSource(f.store);
    assert.throws(() => requireSecret("ucpathPassword", source), /ucpathPassword is missing/u);
    f.execute(f.protectedCommand("synthetic-next-use-one")); assert.equal(requireSecret("ucpathPassword", source), "synthetic-next-use-one");
    f.execute(f.protectedCommand("synthetic-next-use-two")); assert.equal(requireSecret("ucpathPassword", source), "synthetic-next-use-two");
    assert.deepEqual(f.reader.read(), before);
  });
  it("authenticates its own history even when SQLite is unavailable", () => {
    const f = fixture(); f.execute(f.protectedCommand("synthetic-owned-value")); f.database.close();
    assert.equal(f.protectedReader.read().readback.revision, 2);
    const path = join(f.root, "credentials", "protected.json");
    writeFileSync(path, readFileSync(path, "utf8").replace("synthetic-owned-value", "synthetic-altered-value"));
    assert.throws(() => f.protectedReader.read(), /disagrees with its identity history/u);
  });
});


it("S long-lived dashboard reader follows newly saved active settings", () => {
 const f = fixture();
 const reader = readerFor(f.database, { hostFacts: hostConfigFacts({}), clock: f.clock,
  active: activeSettingsRuntimeIdentity });
 const original = reader.read();
 const originalConfig = f.database.withAuthorityTransaction(activeSettingsConfig);
 const record = f.apply();
 assert.equal(reader.read().runtimeStatus.state, "current");
 assert.notDeepEqual(f.database.withAuthorityTransaction(activeSettingsConfig), originalConfig);
 const active = activate(f.database, record, f.clock);
 assert.deepEqual(reader.read(), { record, runtimeStatus: { state: "current", identity: active } });
 assert.notDeepEqual(reader.read(), original);
 assert.equal(f.database.withAuthorityTransaction(activeSettingsConfig).display.screenWidth, 1980);
});


describe("F settings resolver application port", () => {
  it("refuses an incomplete resolver result before changing ordinary or active settings", () => {
    const f = fixture();
    const before = f.database.withAuthorityTransaction(activeSettingsConfig);
    const generation = f.database.getMeta().authorityGeneration;
    const settings = createSettingsApplicationExecutor((value) => {
      const resolved = resolveConfigWithProvenance(value, hostConfigFacts({}), f.clock);
      // Inject a malformed collaborator result without making the collaborator throw.
      Reflect.deleteProperty(resolved, "fingerprint");
      return resolved;
    }, f.store);
    const patch = { "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } };
    const commandId = randomUUID();
    const result = executeSettingsCommand({ authority: f.database, clock: f.clock, ids: { uuid: randomUUID }, settings }, {
      family: "settings", type: "apply-settings", commandId, requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: f.initial.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    });
    assert.equal(result.state, "rejected");
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "cross-field-invalid");
    assert.deepEqual(readSettings(f.database.authority), f.initial);
    assert.deepEqual(f.database.withAuthorityTransaction(activeSettingsConfig), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(commandId), undefined);
  });

  it("returns complete results and restores the established host default after clearing display overrides", () => {
    const f = fixture();
    const establishedHost = hostConfigFacts({ HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" });
    const baseline = resolveConfigWithProvenance({}, establishedHost, f.clock);
    const resolutions: ResolvedConfig[] = [];
    const settings = createSettingsApplicationExecutor((value) => {
      const resolved = resolveConfigWithProvenance(value, establishedHost, f.clock);
      resolutions.push(resolved);
      return resolved;
    }, f.store);
    const execute = (patch: SettingsPatch) => {
      const command = { family: "settings", type: "apply-settings", commandId: randomUUID(),
        requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
        target: { expectedRevision: readSettings(f.database.authority).revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
      const dependencies = { authority: f.database, clock: f.clock, ids: { uuid: randomUUID }, settings };
      assert.equal(executeSettingsCommand(dependencies, command).state, "applied");
      const resolvedCount = resolutions.length;
      const resolved = resolutions.at(-1);
      assert.deepEqual(resolved, resolveConfigWithProvenance(readSettings(f.database.authority).settings, establishedHost, f.clock));
      assert.equal(executeSettingsCommand(dependencies, command).state, "already-applied");
      assert.equal(resolutions.length, resolvedCount, "exact command replay must not resolve again");
      return resolved;
    };
    const overridden = execute({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } });
    assert.ok(overridden);
    const retained = structuredClone(overridden);
    assert.equal(overridden.config.display.screenWidth, 1980);
    assert.equal(overridden.provenance["display.screenWidth"], "settings");
    assert.notEqual(overridden.fingerprint, baseline.fingerprint);
    const cleared = execute({ "display.screenWidth": { clear: true }, "display.screenHeight": { clear: true } });
    assert.deepEqual(cleared, baseline);
    assert.equal(cleared?.config.display.screenWidth, 2560);
    assert.equal(cleared?.config.display.screenHeight, 1440);
    assert.equal(cleared?.provenance["display.screenWidth"], "default");
    assert.equal(cleared?.provenance["display.screenHeight"], "default");
    assert.deepEqual(readSettings(f.database.authority).settings, {}, "host defaults must not become persisted overrides");
    assert.deepEqual(overridden, retained, "later settings must not rewrite a prior resolution");
  });
});
