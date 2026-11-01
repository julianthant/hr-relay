import { withOfflineMaintenanceSync, createBoundProfileFixture, readAuthenticatedCredentialFixture, rewriteAuthenticatedCredentialFixture } from "../../../support/helpers/admission-fixture.js";
import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import { default as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join as join_m0 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance, type ResolvedConfig } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand, type CommandAuthority } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { buildSettingsEditor } from "../../../../src/backend/runs/queries/settings-editor.js";
import { activeSettingsConfig, activeSettingsRuntimeIdentity, createCredentialSecretSource, createProtectedSettingsRuntimeReader, createSettingsRuntimeReader, readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, ProtectedSettingsReadbackSchema } from "../../../../src/models/config/protected-settings.js";
import { requireSecret } from "../../../../src/models/config/secrets.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, settingsRuntimeIdentity, type SettingsFileRecord, type SettingsPatch } from "../../../../src/models/config/settings.js";
import { ProtectedSettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { manualClock, type Clock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m0, createCredentialStore as createCredentialStore_m0 } from "../../../support/helpers/synthetic-storage-admission.js";
import { selectActiveRunSettings } from "../../../../src/backend/runs/settings/run-settings.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS } from "../../../../src/models/config/catalog.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { credentialTrap, storageTree, storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";


{

const cleanups: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); };
function readerFor(database: CommandAuthority, input: Parameters<typeof createSettingsRuntimeReader>[0]) {
  const reader = createSettingsRuntimeReader(input);
  return { read: () => database.withAuthorityTransaction(repositories => reader.read(repositories)) };
}
function activate(database: AuthorityDatabase_m0, record: SettingsFileRecord, clock: Clock) {
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock);
  database.withAuthorityTransaction((repositories) => {
    const configSnapshotId = randomUUID();
    const snapshot = { configSnapshotId, revision: 1, fingerprint: resolved.fingerprint,
      capturedAt: clock.now().toISOString(), capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance };
    if (repositories.runtimeConfig.get() === undefined) {
      repositories.runtimeConfig.initialize(snapshot);
      return;
    }
    repositories.configSnapshots.insert(snapshot);
    repositories.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
      configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: clock.now().toISOString() });
  });
  return settingsRuntimeIdentity(record, resolved.fingerprint);
}
async function fixture(probe: () => void = () => {}) {
  const profile = await createBoundProfileFixture(); cleanups.push(async () => await profile.close());
  const root = profile.stateRoot;
  const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
  const databasePath = profile.path;
  const database = AuthorityDatabase_m0.open({ path: databasePath, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock); cleanups.push(() => database.close());
  const store = createCredentialStore_m0({ stateRoot: root });
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
  const protectedCommand = (value: string | null) => ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: store.read().revision }, payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: value === null ? { clear: true } : { set: value } } } });
  return { root, profile, database, databasePath, clock, store, initial, active, reader, execute, apply, protectedCommand, reads: () => reads,
    protectedReader: createProtectedSettingsRuntimeReader(store) };
}

describe("SQLite Settings reader snapshot", () => {
afterEach(_afterEachFixture0);

  it("resolves the active physical pair without changing the saved ordinary revision", async () => {
    const f = await fixture();
    const prior = f.database.withAuthorityTransaction(activeSettingsConfig);
    const pair = { stateRoot: join_m0(f.root, "moved-state"), artifactRoot: join_m0(f.root, "moved-artifacts") };
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
    assert.deepEqual(f.database.withAuthorityTransaction(activeSettingsConfig).paths, { ...prior.paths, ...pair, browserProfileRoot: join_m0(pair.stateRoot, "browsers"), duoCredential: join_m0(pair.stateRoot, "credentials", "duo-webauthn.json"),
      downloadsDir: join_m0(pair.stateRoot, "files", "downloads"), reportsDir: join_m0(pair.stateRoot, "files", "reports"),
      onboardingDocsDir: join_m0(pair.stateRoot, "files", "onboarding"), i9CheckTrackerPath: join_m0(pair.stateRoot, "files", "reports", "i9-check-tracker.xlsx") });
    assert.notDeepEqual(prior.paths, pair);
  });
  it("builds a current editor with exactly one authoritative read and no file authority", async () => {
    const f = await fixture();
    for (let count = 0; count < 2; count += 1) {
      const before = f.reads(); const editor = buildSettingsEditor({ settings: f.reader, protectedSettings: f.protectedReader, environment: {}, clock: f.clock });
      assert.equal(f.reads() - before, 1); assert.equal(editor.revision, 1);
      assert.equal(editor.settingsFingerprint, f.initial.settingsFingerprint);
      assert.deepEqual(editor.runtimeStatus, { state: "current", identity: f.active });
      assert.equal(editor.sections.flatMap((section) => section.leaves).length, 60 - 5 - 2);
    }
    assert.equal(existsSync(join_m0(f.root, "settings")), false);
  });
  it("pairs fresh values and current status without caching a previous read", async () => {
    const f = await fixture(); f.reader.read(); const record = f.apply();
    const persisted = settingsRuntimeIdentity(record, resolveConfigWithProvenance(record.settings, hostConfigFacts({}), f.clock).fingerprint);
    const expectedStatus = { state: "current", identity: persisted };
    assert.deepEqual(f.reader.read(), { record, runtimeStatus: expectedStatus });
    const editor = buildSettingsEditor({ settings: f.reader, protectedSettings: f.protectedReader, environment: {}, clock: f.clock });
    assert.deepEqual(editor.runtimeStatus, expectedStatus);
    const width = editor.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(width?.effectiveValue, 1980); assert.equal(width?.settingsValue, 1980); assert.equal(width?.source, "settings");
  });
  it("refuses a stale process identity before reading settings after another activation", async () => {
    const f = await fixture(); const record = f.apply(); const active = activate(f.database, record, f.clock); const before = f.reads();
    const stale = readerFor(f.database, { hostFacts: hostConfigFacts({}), clock: f.clock, active: f.active });
    assert.throws(() => stale.read(), /are not dashboard-active; restart activation is required/u); assert.equal(f.reads(), before);
    const reader = readerFor(f.database, { hostFacts: hostConfigFacts({}), clock: f.clock, active });
    assert.deepEqual(reader.read(), { record, runtimeStatus: { state: "current", identity: active } });
  });
  it("cannot project a corrupt retired file as ordinary authority", async () => {
    const f = await fixture(); mkdirSync(join_m0(f.root, "settings")); const path = join_m0(f.root, "settings", "settings.json");
    writeFileSync(path, "malformed former authority", { mode: 0o600 }); const before = readFileSync(path);
    assert.equal(f.reader.read().record.revision, 1); const record = f.apply();
    assert.deepEqual(f.reader.read().record, record); assert.deepEqual(readFileSync(path), before);
  });
  it("holds real SQLite writer exclusion during its settings snapshot", async () => {
    let probe = () => {}; const f = await fixture(() => probe());
    const contender = AuthorityDatabase_m0.open({ path: f.databasePath, busyTimeoutMs: 1, migrationOwner: "contender" }, f.clock); cleanups.push(() => contender.close());
    probe = () => { assert.throws(() => contender.withAuthorityTransaction(() => {}), /database is locked/u); };
    assert.deepEqual(f.reader.read(), { record: f.initial, runtimeStatus: { state: "current", identity: f.active } });
  });
});

describe("independent protected Settings reader", () => {
afterEach(_afterEachFixture0);

  it("serves the stored credential value with the authenticated readback", async () => {
    const f = await fixture(); const revision = f.store.read().revision; f.execute(f.protectedCommand("synthetic-protected-readback"));
    const snapshot = f.protectedReader.read(); assert.equal(snapshot.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH);
    ProtectedSettingsReadbackSchema.parse(snapshot.readback); assert.equal(snapshot.readback.revision, revision + 1);
    assert.equal(snapshot.record.entries.ucpathPassword?.value, "synthetic-protected-readback");
    assert.equal(JSON.stringify(snapshot).includes("synthetic-protected-readback"), true);
  });
  it("verifies exact retry and refuses value-divergent reuse", async () => {
    const f = await fixture(); const command = f.protectedCommand("synthetic-first-value"); f.execute(command);
    assert.equal(f.execute(command).state, "already-applied");
    const divergent = structuredClone(command); divergent.payload.entries.ucpathPassword = { set: "synthetic-different-value" };
    assert.equal(f.execute(divergent).state, "rejected");
    assert.equal(requireSecret("ucpathPassword", createCredentialSecretSource(f.store)), "synthetic-first-value");
  });
  it("independent committed credentials remain available without a SQLite audit", async () => {
    const f = await fixture(); const revision = f.store.read().revision; const command = f.protectedCommand("synthetic-before-audit");
    const result = f.store.apply(ProtectedSettingsApplyInputSchema.parse({ ...command.payload, commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command), expectedRevision: command.target.expectedRevision, updatedAt: command.requestedAt }));
    assert.equal(result.state, "applied"); assert.equal(f.database.authority.commands.get(command.commandId), undefined);
    assert.equal(f.protectedReader.read().readback.revision, revision + 1);
  });
  it("observes each credential at next use without changing ordinary runtime identity", async () => {
    const f = await fixture(); const before = f.reader.read(); const source = createCredentialSecretSource(f.store);
    assert.equal(f.execute(f.protectedCommand(null)).state, "applied");
    assert.throws(() => requireSecret("ucpathPassword", source), /ucpathPassword is missing/u);
    f.execute(f.protectedCommand("synthetic-next-use-one")); assert.equal(requireSecret("ucpathPassword", source), "synthetic-next-use-one");
    f.execute(f.protectedCommand("synthetic-next-use-two")); assert.equal(requireSecret("ucpathPassword", source), "synthetic-next-use-two");
    assert.deepEqual(f.reader.read(), before);
  });
  it("authenticates its own history even when SQLite is unavailable", async () => {
    const f = await fixture(); const revision = f.store.read().revision; f.execute(f.protectedCommand("synthetic-owned-value")); f.database.close();
    assert.equal(f.protectedReader.read().readback.revision, revision + 1);
    const path = join_m0(f.root, "credentials", "protected.json");
    const originalBytes = readFileSync(path);
    try {
      const document = z.looseObject({ record: z.looseObject({ entries: z.looseObject({
        ucpathPassword: z.looseObject({ value: z.string(), valueId: z.uuid() }),
      }) }) }).parse(readAuthenticatedCredentialFixture(f.profile.machine.stateRoot, f.profile.admission.profileBinding.profileId));
      const originalValue = document.record.entries.ucpathPassword.value;
      assert.equal(originalValue === "synthetic-owned-value", true);
      const originalValueId = document.record.entries.ucpathPassword.valueId;
      document.record.entries.ucpathPassword.valueId = randomUUID();
      assert.notEqual(document.record.entries.ucpathPassword.valueId, originalValueId);
      assert.equal(document.record.entries.ucpathPassword.value, originalValue);
      rewriteAuthenticatedCredentialFixture(f.profile.machine.stateRoot, f.profile.admission.profileBinding.profileId, () => document);
      assert.throws(() => f.protectedReader.read(), /disagrees with its identity history/u);
    } finally { writeFileSync(path, originalBytes); }
  });
});

it("S long-lived dashboard reader follows newly saved active settings", async () => {
try {

 const f = await fixture();
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

} finally {
await _afterEachFixture0();
}
});

describe("F settings resolver application port", () => {
afterEach(_afterEachFixture0);

  it("refuses an incomplete resolver result before changing ordinary or active settings", async () => {
    const f = await fixture();
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

  it("returns complete results and restores the established host default after clearing display overrides", async () => {
    const f = await fixture();
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
}

{

const { fixture, cleanup } = createSettingsAuthorityTestWorld();


const _afterEachFixture0 = cleanup;

function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}

describe("SQLite settings authority", () => {
afterEach(_afterEachFixture0);

  it("represents empty revision one without a file or current row", async () => {
    const f = await fixture();
    const credentialBaseline = storageTree(join_m0(f.root, "credentials"));
    assert.ok(Object.hasOwn(credentialBaseline, "protected.json"));
    assert.equal(f.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(f.database.authority).settings, {});
    assert.equal(readSettings(f.database.authority).revision, 1);
    assert.equal(existsSync(join_m0(f.root, "settings")), false);
    assert.deepEqual(storageTree(join_m0(f.root, "credentials")), credentialBaseline);
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try { assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='protected_settings_current'").get(), undefined); }
    finally { raw.close(); }
  });
  it("commits values, revision, command, audit and one authority generation together, then replays without writes", async () => {
    const f = await fixture(); const request = ordinary(); const before = f.database.getMeta().authorityGeneration;
    assert.equal(f.execute(request).state, "applied");
    assert.equal(f.database.getMeta().authorityGeneration, before + 1);
    assert.equal(readSettings(f.database.authority).settings.concurrency?.defaultWorkers, 3);
    assert.equal(f.database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "applied");
    assert.equal(f.execute(request).state, "already-applied");
    assert.equal(f.database.getMeta().authorityGeneration, before + 1);
    assert.equal(existsSync(join_m0(f.root, "settings")), false);
  });
});
}

{

const cleanups: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const close of cleanups.splice(0).reverse()) await close(); };
async function fixture() { const f = await settingsFixture(); cleanups.push(f.close); return f; }
function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try { return ["settings_snapshots", "commands", "command_audits", "runs"].map((table) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get()); } finally { db.close(); }
}
it("rolls snapshot, selection, journal, audit and generation back on an injected audit failure", async () => {
try {

  const f = await fixture(); const before = counts(f); const active = f.database.authority.runtimeConfig.get();
  const generation = f.database.getMeta().authorityGeneration; const saved = readSettings(f.database.authority);
  assert.throws(() => f.execute(f.command({ "timeouts.taskMs": { set: 90_000 } }), {
    withAuthorityTransaction: (work) => f.database.withAuthorityTransaction((repositories) => work({ ...repositories,
      commandAudits: { ...repositories.commandAudits, insert: () => { throw new Error("injected audit failure"); } },
    })),
  }), /injected audit failure/u);
  assert.deepEqual(counts(f), before); assert.deepEqual(f.database.authority.runtimeConfig.get(), active);
  assert.deepEqual(readSettings(f.database.authority), saved); assert.equal(f.database.getMeta().authorityGeneration, generation);

} finally {
await _afterEachFixture0();
}
});
it("refuses invalid and revision-conflicting saves with no partial authority", async () => {
try {

  const f = await fixture(); const before = counts(f); const generation = f.database.getMeta().authorityGeneration;
  assert.equal(f.execute(f.command({ "timeouts.taskMs": { set: 90_000 } }, 2)).state, "conflict");
  assert.equal(f.execute(f.command({ "display.screenWidth": { set: 1980 } })).state, "rejected");
  assert.deepEqual(counts(f), before); assert.equal(f.database.getMeta().authorityGeneration, generation);

} finally {
await _afterEachFixture0();
}
});
it("clears overrides to host defaults and survives a real authority reopen with historical references", async () => {
try {

  const f = await fixture(); f.save({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } });
  const run = f.create(); const retained = selectActiveRunSettings(f.database.authority);
  f.save({ "display.screenWidth": { clear: true }, "display.screenHeight": { clear: true } });
  assert.deepEqual(readSettings(f.database.authority).settings, {});
  const current = selectActiveRunSettings(f.database.authority); assert.equal(current.config.display.screenWidth, 2560);
  assert.equal(current.fingerprint, f.snapshot.fingerprint);
  f.closeDatabase(); const reopened = AuthorityDatabase_m0.open({ path: f.path, busyTimeoutMs: 10, migrationOwner: "reopen" }, f.clock);
  try {
    assert.deepEqual(selectActiveRunSettings(reopened.authority), current);
    assert.deepEqual(reopened.authority.configSnapshots.get(retained.configSnapshotId), retained);
    assert.deepEqual(reopened.authority.runs.get(run.envelope.runId), run);
  } finally { reopened.close(); }

} finally {
await _afterEachFixture0();
}
});
}

{

const clock = manualClock(new Date("2026-09-06T12:00:00.000Z"));
const profiles: Awaited<ReturnType<typeof storageRecoveryFixture>>[] = [];
const _afterEachFixture0 = async () => { for (const profile of profiles.splice(0)) await profile.dispose(); };
const HISTORICAL_PROVIDER_MODEL_ENVIRONMENT_KEYS = ["OCR_GEMINI_MODEL", "OCR_GEMINI_MODELS", "OCR_GROQ_MODEL", "OCR_GROQ_MODELS", "OCR_MISTRAL_MODEL", "OCR_MISTRAL_MODELS", "OCR_OPENROUTER_MODEL", "OCR_OPENROUTER_MODELS", "OCR_SAMBANOVA_MODEL", "OCR_SAMBANOVA_MODELS"];
const bindings = {
  HRAUTO_KUALI_TEST_URL: "https://fixture.invalid/kuali", HRAUTO_NEW_KRONOS_TEST_URL: "https://fixture.invalid/new-kronos",
  HRAUTO_CRM_TEST_URL: "https://fixture.invalid/crm", HRAUTO_ONBASE_TEST_URL: "https://fixture.invalid/onbase",
  HRAUTO_UCPATH_TEST_URL: "https://fixture.invalid/ucpath", HRAUTO_I9_TEST_URL: "https://fixture.invalid/i9",
  HRAUTO_OLD_KRONOS_TEST_URL: "https://fixture.invalid/old-kronos", HRAUTO_SERVICENOW_TEST_URL: "https://fixture.invalid/servicenow",
  HRAUTO_SHAREPOINT_TEST_URL: "https://fixture.invalid/sharepoint", HRAUTO_UKG_NAVIGATION_MS: "7000",
  ANNUAL_DATES_END: "06/30/2027", KRONOS_DEFAULT_END_DATE: "06/30/2027", KRONOS_DEFAULT_START_DATE: "07/01/2026",
  HRAUTO_NAVIGATION_RETRIES: "7", HRAUTO_SEPARATION_TERMINATION_WINDOW_DAYS: "7", OCR_SECOND_OPINION_MAX: "7",
  OCR_PAGE_MAX_WAIT_MS: "7000", OCR_TIER1_PATIENCE_MS: "7000", OCR_PAGE_CONCURRENCY: "7", OCR_DISAMBIG_CONCURRENCY: "7",
  OCR_SUGGEST_CONCURRENCY: "7", OCR_BACKOFF_BASE_MS: "7000", OCR_BACKOFF_CAP_MS: "7000", OCR_MAX_VALIDATION_RETRIES: "7",
  HRAUTO_HEALTH_MONITOR_TICK_MS: "7000", HRAUTO_HEALTH_MONITOR_MAX_REFRESH: "7", HRAUTO_HEALTH_MONITOR_MAX_REOPEN: "7",
  HRAUTO_DEFAULT_WORKERS: "7", HRAUTO_DAEMON_IDLE_MS: "7000", HRAUTO_DAEMON_IDLE_REPOLL_MS: "7000",
  DEBUG_SCREENSHOTS: "true", HR_AUTOMATION_DUO_WEBAUTHN: "0", OCR_GEMINI_MODELS: "fixture-model", OCR_GROQ_MODELS: "fixture-model",
  OCR_MISTRAL_MODELS: "fixture-model", OCR_OPENROUTER_MODELS: "fixture-model", OCR_SAMBANOVA_MODELS: "fixture-model",
  OCR_GEMINI_MODEL: "retired-model", OCR_GROQ_MODEL: "retired-model", OCR_MISTRAL_MODEL: "retired-model", OCR_OPENROUTER_MODEL: "retired-model", OCR_SAMBANOVA_MODEL: "retired-model",
  UCPATH_USER_ID: "synthetic-user", UCPATH_PASSWORD: "synthetic-private-password", TIMEKEEPER_NAME: "Synthetic Keeper",
  ONBOARDING_ROSTER_URL: "https://fixture.invalid/private-roster", HRAUTO_ACTIVITY_PERSON_PSEUDONYM_HMAC_KEY: "ab".repeat(32),
  HRAUTO_ACTIVITY_PERSON_PSEUDONYM_KEY_GENERATION: "activity-person-fixture",
};

const RETIRED_TEST_TARGET_ENV = {
  HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: "12345678", HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID: "10123456",
};
async function fixture(body: string) {
  const profile = await storageRecoveryFixture(0); profiles.push(profile);
  const root = profile.root;
  const environmentFile = join_m0(root, ".env"); writeFileSync(environmentFile, body, { mode: 0o600 });
  return { root, environmentFile, profile, input: { stateRoot: root, processLockRoot: profile.input.processLockRoot, environmentFile, plan: false } };
}
describe("expired environment import refuses before access", () => {
afterEach(_afterEachFixture0);

  it("covers every former input while fresh authority and credentials remain independent", async () => {
    assert.deepEqual([...Object.keys(bindings), ...Object.keys(RETIRED_TEST_TARGET_ENV)].sort(), [...MIGRATED_SETTINGS_ENVIRONMENT_KEYS, ...HISTORICAL_PROVIDER_MODEL_ENVIRONMENT_KEYS].sort());
    const retired = { I9_USER_ID: "synthetic-retired-id", I9_PASSWORD: "synthetic-retired-password", TELEGRAM_BOT_TOKEN: "synthetic-retired-token", TELEGRAM_CHAT_ID: "synthetic-retired-chat" };
    const body = Object.entries({ ...bindings, ...retired, GEMINI_API_KEY: "synthetic-provider-never-imported" }).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
    const f = await fixture(body); credentialTrap(f.root); const before = storageTree(f.root);
    const plan = await f.profile.run(true);
    assert.equal(plan.credentials, "unchanged");
    assert.deepEqual(storageTree(f.root), before);
    const applied = await f.profile.run();
    assert.equal(applied.credentials, "unchanged");
    withOfflineMaintenanceSync(f.profile.admission, () => NativeAuthorityDatabase.inspectStoppedUpgrade(f.profile.admission, f.profile.path, f.input.processLockRoot, clock));
    const database = new DatabaseSync(f.profile.path, { readOnly: true });
    try { assert.deepEqual(database.prepare("SELECT * FROM settings").all(), []); } finally { database.close(); }
    assert.equal(readFileSync(f.environmentFile, "utf8"), body);
    for (const value of [...Object.values(retired), bindings.UCPATH_PASSWORD, bindings.UCPATH_USER_ID, "synthetic-provider-never-imported"])
      assert.equal(readFileSync(join_m0(f.root, "state.db")).includes(Buffer.from(value)), false);
    const settled = storageTree(f.root); assert.equal((await f.profile.run()).state, "already-upgraded");
    const after = storageTree(f.root);
    for (const [path, bytes] of Object.entries(settled)) assert.equal(after[path], bytes);
    assert.equal(Object.keys(after).filter(path => !(path in settled)).every(path => path.startsWith("locks/restore-admission-history/")), true);
  });
  it.each(Object.entries(RETIRED_TEST_TARGET_ENV))("does not read or adopt expired test-target key %s", async (key, value) => {
    const body = `${key}=${value}\n`; const f = await fixture(body); credentialTrap(f.root);
    const report = await f.profile.run();
    assert.equal(report.credentials, "unchanged"); assert.equal(JSON.stringify(report).includes(value), false);
    assert.equal(readFileSync(f.environmentFile, "utf8"), body);
    assert.equal(readFileSync(join_m0(f.root,"state.db")).includes(Buffer.from(value)), false);
  });
  it.each(["UNREGISTERED_SETTING=1", "I9_USER_ID_EXTRA=synthetic-private", "TELEGRAM_TOKEN=synthetic-private", "I9_USER_ID=one\nI9_USER_ID=two", "TELEGRAM_BOT_TOKEN=\"unterminated", "HRAUTO_DEFAULT_WORKERS=abc", "HRAUTO_KUALI_TEST_URL=not-a-url"])("does not parse expired environment bytes: %s", async body => {
    const f=await fixture(body);credentialTrap(f.root);const before=storageTree(f.root);
    assert.equal((await f.profile.run(true)).state,"planned");assert.deepEqual(storageTree(f.root),before);
    const result=await f.profile.run();assert.equal(result.credentials,"unchanged");assert.equal(readFileSync(f.environmentFile,"utf8"),body);
  });
});
}
