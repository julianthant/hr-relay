import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileSettings } from "../../../../../src/backend/app/composition/dashboard/settings.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { AuthorityDatabase, CredentialContextRequiredError } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { activeSettingsRuntimeIdentity, readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { CommandAuditRecordSchema, SettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../../src/rules/commands/commands.js";
import { SettingsCurrentRecordSchema } from "../../../../../src/models/config/settings-current.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { composeSelectedProfileStorage } from "../../../../../src/backend/app/composition/storage-compose.js";
import { assertProfileBrowserRoot } from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import { ProfileBrowserRootRefusalError } from "../../../../../src/backend/storage/admission/admission-identity.js";
import { createProfileRegistry } from "../../../../../src/backend/profiles/registry.js";

it("preserves supported authenticated retained saved-but-inactive Settings across context recreation", async () => {
  const f = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const hostFacts = { primaryDisplay: null };
  const runtimeStoragePair = { stateRoot: f.admission.stateRoot, artifactRoot: f.admission.artifactRoot };
  const credentials = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
    erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${f.admission.profileBinding.profileId}.json`) });
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "profile-settings-test" },
    clock, undefined, undefined, undefined, credentials);
  try {
    const initial = database.withAuthorityReadSnapshot(() => readSettings(database.authority));
    const resolved = resolveConfigWithProvenance(initial.settings, hostFacts, clock, runtimeStoragePair);
    database.withAuthorityTransaction(repositories => repositories.runtimeConfig.initialize({
      configSnapshotId: randomUUID(), revision: initial.revision, fingerprint: resolved.fingerprint,
      capturedAt: clock.now().toISOString(), capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance,
    }));
    const reader = composeProfileSettings({ database, clock, hostFacts, runtimeStoragePair, active: activeSettingsRuntimeIdentity });
    assert.equal(reader.read().runtimeStatus.state, "current");
    const patch = { "browser.headless": { set: false } };
    const command = SettingsCommandRequestSchema.parse({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: initial.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    const settings = { browser: { headless: false } }, settingsFingerprint = derivePersistedSettingsFingerprint(settings);
    database.withAuthorityTransaction(repositories => {
      const target = { family: "settings", revision: initial.revision + 1 };
      const audit = CommandAuditRecordSchema.parse({ auditId: randomUUID(), request: command,
        result: { state: "applied", commandId: command.commandId, affectedTargets: [target], restartRequired: true,
          settingsRevision: initial.revision + 1, settingsFingerprint }, completedAt: clock.now().toISOString(),
        versionChanges: [{ target, before: initial.revision, after: initial.revision + 1 }], affectedDependencyIds: [] });
      repositories.commands.assertIdentity(command);
      repositories.commands.insert(command);
      repositories.commandAudits.insert(audit);
      repositories.settingsCurrent.advance(SettingsCurrentRecordSchema.parse({ revision: initial.revision + 1, settings, settingsFingerprint,
        commandId: command.commandId, commandFingerprint: deriveSettingsCommandFingerprint(command), auditId: audit.auditId, committedAt: audit.completedAt }));
    });
    const changed = reader.read();
    assert.equal(changed.record.revision, initial.revision + 1);
    assert.equal(changed.runtimeStatus.state, "restart-required");
    if (changed.runtimeStatus.state === "restart-required") assert.equal(changed.runtimeStatus.active.settingsRevision, initial.revision);
    const active = database.withAuthorityReadSnapshot(() => database.authority.runtimeConfig.get());
    database.close();
    assert.throws(() => reader.read(), /closed/u);
    const reopened = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials, hostFacts, clock });
    try {
      assert.equal(reopened.settings.read().runtimeStatus.state, "restart-required");
      assert.deepEqual(reopened.database.withAuthorityReadSnapshot(() => reopened.database.authority.runtimeConfig.get()), active);
    } finally { await reopened.account.close(); reopened.database.close(); }
    const inspection = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "profile-no-context-test" }, clock);
    try {
      assert.equal(inspection.getMeta().profileId, f.admission.profileBinding.profileId);
      const unownedCommand = { ...command, commandId: randomUUID() };
      assert.throws(() => inspection.withAuthorityTransaction(repositories => repositories.commands.assertIdentity(unownedCommand)), CredentialContextRequiredError);
      assert.equal(inspection.authority.commands.get(unownedCommand.commandId), undefined);
    } finally { inspection.close(); }
  } finally { database.close(); await f.close(); }
});

it("binds browser roots and selected Settings resolution to the genuine ordinary profile child", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const credentials = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
    erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${f.admission.profileBinding.profileId}.json`) });
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials, clock, hostFacts: { primaryDisplay: null } });
  try {
    const contained = join(f.stateRoot, "custom-browser");
    assert.doesNotThrow(() => assertProfileBrowserRoot(f.admission, contained));
    const saved = context.settings.read().record.settings;
    assert.equal(context.resolveSettings({ ...saved, paths: { ...saved.paths, browserProfileRoot: contained } }).config.paths.browserProfileRoot, contained);
    for (const rejected of [f.stateRoot, join(f.machine.stateRoot, "shared-browser"), join(f.stateRoot, "credentials", "browser")]) {
      assert.throws(() => assertProfileBrowserRoot(f.admission, rejected), ProfileBrowserRootRefusalError);
      assert.throws(() => context.resolveSettings({ ...saved, paths: { ...saved.paths, browserProfileRoot: rejected } }), ProfileBrowserRootRefusalError);
    }
    mkdirSync(join(f.stateRoot, "real-browser"), { mode: 0o700 });
    const linked = join(f.stateRoot, "linked-browser"); symlinkSync(join(f.stateRoot, "real-browser"), linked);
    assert.throws(() => assertProfileBrowserRoot(f.admission, linked), ProfileBrowserRootRefusalError);
    createProfileRegistry(f.machine).advanceSession(null);
    assert.throws(() => assertProfileBrowserRoot(f.admission, contained));
    assert.throws(() => context.resolveSettings(saved));
  } finally { await context.account.close(); context.database.close(); await f.close(); }
});
