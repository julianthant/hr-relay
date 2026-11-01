import { FakeKeyringEntry } from "../../support/helpers/credential-keychain-fake.js";
import { credentialKeyCustody } from "../../../src/backend/storage/configuration/credential-key-custody.js";
import { createDuoCredentialStore } from "../../../src/backend/storage/configuration/duo-credential-store.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { readProfilePublicationRegistry, type ProfilePublicationRead } from "../../../src/backend/storage/admission/installation.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { composeProfileCredentialInitializationInventory } from "../../../src/backend/app/composition/profile-credential-inventory.js";
import { createProfileSession } from "../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { CredentialStoreCommitUncertainError, createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { CompleteProtectedSettingsPatchSchema, type CompleteProtectedSettingsPatch, ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";

for (const mode of ["replace-v3", "prove-v2"] as const) for (const interruptedAt of (["intent", "digest-missing", "orphan-stage", "stage-substitution", "stage-extra-copy", "stage-external-lock", "stage-child-release", "stage-parent-release", "stage-source-change", "stage-registry-change", "legacy-value-tamper", "legacy-timestamp-tamper", "legacy-commandFingerprint-tamper", "legacy-expectedRevision-tamper", "legacy-protectedSchemaHash-tamper", "stage-journal", "stage-intent", "key", "key-phase", "document-phase", "key-substitution", "key-malformed", "key-foreign", "anchor", "retained-duo"] as const).filter(boundary => (mode === "prove-v2" || !boundary.startsWith("legacy-")) && (mode === "replace-v3" || boundary !== "retained-duo"))) it(interruptedAt === "retained-duo" ? "refuses retained physical Duo before staging a historical credential conversion" : `converts ${mode} through verified sign-in and resumes exact ${interruptedAt} publication without reviving a peer`, async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z")), hostFacts = { primaryDisplay: null };
  const initial = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts });
  await initial.account.close(); initial.database.close();
  let initializationChild: RuntimeAdmission | undefined;
  const anchorScopes: ProfilePublicationRead[] = [];
  let retainedInventory: Readonly<{ control: Buffer; operations: readonly { name: string; bytes: Buffer }[] }> | undefined;
  const initializationInventory: NonNullable<Parameters<typeof createProfileSession>[0]["initializationInventory"]> = (child, operation, writer, copies) => {
    initializationChild = child;
    if (interruptedAt === "retained-duo") {
      const directory = join(f.machine.stateRoot, "machine", "operations");
      retainedInventory = { control: readFileSync(join(f.workspace, ".tracker", "control", "profile-registry.json")),
        operations: readdirSync(directory).map(name => ({ name, bytes: readFileSync(join(directory, name)) })) };
    }
    const inventory = composeProfileCredentialInitializationInventory({ machine: f.machine, admission: child, clock, hostFacts })(operation, writer, copies);
    return { ...inventory, revalidate(current) {
      const revalidate = inventory.revalidate(current);
      return scope => {
        revalidate(scope);
        if (scope === undefined) return;
        scope.assertOperation(f.machine.stateRoot, operation.operationId);
        assert.equal(readProfilePublicationRegistry(scope).profiles.some(profile => profile.profileId === operation.profileId), true);
        anchorScopes.push(scope);
      };
    } };
  };
  const peer = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, initializationInventory });
  const fields = { email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() };
  const active = peer.signIn(fields); assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("genuine current-format sign-in refused");
  const child = f.machine.admitProfile(active.profileId);
  const duo = createDuoCredentialStore(child, f.machine, clock);
  duo.erase(); assert.equal(duo.read().state, "erased");
  const store = createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: f.machine,
    erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${active.profileId}.json`) });
  const path = join(child.stateRoot, "credentials", "protected.json"), record = store.read();
  const continuityPath = join(f.workspace, ".tracker", "control", "profile-registry.json");
  const continuity = JSON.parse(readFileSync(continuityPath, "utf8")) as { erasures: { profileId: string; credentialKey?: unknown }[];
    duo: { profileId: string; state: string; revision: number }[] };
  const row = continuity.erasures.find(value => value.profileId === active.profileId); assert.ok(row !== undefined);
  delete row.credentialKey;
  if (interruptedAt !== "retained-duo") continuity.duo = continuity.duo.map(entry => entry.profileId === active.profileId ? { profileId: active.profileId, state: "never-initialized", revision: 0 } : entry);
  writeFileSync(continuityPath, JSON.stringify(continuity), { mode: 0o600 });
  if (interruptedAt !== "retained-duo") unlinkSync(join(f.machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`));
  credentialKeyCustody.delete({ installationId: f.machine.locator.installationId, profileId: active.profileId });
  unlinkSync(join(f.machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`));
  assert.ok(record.lastApplied !== undefined);
  const retired = record.lastApplied;
  writeFileSync(path, JSON.stringify({ schemaVersion: 3, record, history: [{
    receipt: { ...retired, updatedAt: fields.at, requestReceipt: "f".repeat(64) },
    marked: Object.fromEntries(Object.keys(record.entries).map(name => [name, { set: "<set>" }])),
    setValueIds: Object.fromEntries(Object.entries(record.entries).map(([name, entry]) => [name, entry.valueId])),
  }] }), { mode: 0o600 });
  if (interruptedAt === "retained-duo") {
    const duoPath = join(f.machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`);
    const duoBytes = readFileSync(duoPath), source = readFileSync(path);
    const keyDirectory = join(f.machine.stateRoot, "machine", "credential-keys"), keyFiles = readdirSync(keyDirectory);
    const operationDirectory = join(f.machine.stateRoot, "machine", "operations");
    const keys = FakeKeyringEntry.snapshot();
    let staged = 0;
    const migrator = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, initializationInventory,
      credentialHooks: { beforeInitialKey: () => { staged++; } } });
    const replacement = CompleteProtectedSettingsPatchSchema.parse({ ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password },
      timekeeperName: { clear: true }, sharepointOnboardingRosterUrl: { clear: true }, activityPersonPseudonym: { clear: true } });
    try {
      assert.throws(() => migrator.signIn({ ...fields, credentialMigration: { kind: "replace-v3", entries: replacement } }),
        error => error instanceof Error && "code" in error && error.code === "CREDENTIAL_INITIALIZATION_RETAINED_DUO_KEY_MISMATCH");
      assert.ok(retainedInventory, "the genuine migration must reach its physical-copy inventory before refusal");
      assert.equal(staged, 0);
      assert.deepEqual(readFileSync(duoPath), duoBytes);
      assert.deepEqual(readFileSync(continuityPath), retainedInventory.control);
      assert.deepEqual(readFileSync(path), source);
      assert.deepEqual(readdirSync(keyDirectory), keyFiles);
      assert.deepEqual(readdirSync(operationDirectory).map(name => ({ name, bytes: readFileSync(join(operationDirectory, name)) })), retainedInventory.operations);
      assert.deepEqual(FakeKeyringEntry.snapshot(), keys);
    } finally { migrator.close(); peer.close(); child.release(); await f.close(); }
    return;
  }
  if (mode === "prove-v2") {
    const registration = f.machine.readProfileRegistry().profiles.find(value => value.profileId === active.profileId)?.registration;
    assert.ok(registration !== undefined);
    const firstRequest = ProtectedSettingsApplyInputSchema.parse({ commandId: registration.commandId, writeId: registration.writeId,
      commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      updatedAt: "2026-10-01T12:00:00.000Z", entries: { ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password }, timekeeperName: { set: "FE" } } });
    const lastRequest = ProtectedSettingsApplyInputSchema.parse({ ...retired, updatedAt: fields.at,
      entries: { ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password }, timekeeperName: { set: "FE" } } });
    writeFileSync(path, JSON.stringify({ schemaVersion: 2, record: interruptedAt === "legacy-value-tamper" || interruptedAt === "legacy-timestamp-tamper" ? { ...record,
      entries: { ...record.entries, ucpathPassword: { ...record.entries.ucpathPassword,
        ...(interruptedAt === "legacy-value-tamper" ? { value: "synthetic-tampered-v2-value" } : { updatedAt: "2026-10-22T12:00:00.000Z" }) } } }
      : interruptedAt.startsWith("legacy-") ? { ...record, lastApplied: { ...retired,
        ...(interruptedAt === "legacy-commandFingerprint-tamper" ? { commandFingerprint: "9".repeat(64) }
          : interruptedAt === "legacy-expectedRevision-tamper" ? { expectedRevision: retired.expectedRevision + 1 } : { protectedSchemaHash: "9".repeat(64) }) } } : record, history: [
      { request: firstRequest, setValueIds: { ucpathUserId: randomUUID(), ucpathPassword: randomUUID(), timekeeperName: randomUUID() } },
      { request: lastRequest, setValueIds: Object.fromEntries(Object.entries(record.entries).map(([name, entry]) => [name, entry.valueId])) },
    ] }), { mode: 0o600 });
  }
  const replacement = CompleteProtectedSettingsPatchSchema.parse({ ucpathUserId: { set: fields.email }, ucpathPassword: { set: fields.password },
    timekeeperName: { clear: true }, sharepointOnboardingRosterUrl: { clear: true }, activityPersonPseudonym: { clear: true } });
  let interrupt = true;
  const crash = () => { if (interrupt) { interrupt = false; throw new Error("synthetic credential publication interruption"); } };
  const migrator = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, initializationInventory,
    credentialHooks: interruptedAt === "stage-registry-change" ? { beforeInitialKey: () => { createProfileRegistry(f.machine).advanceSession(null); } }
      : ["stage-substitution", "stage-extra-copy", "stage-external-lock", "stage-child-release", "stage-parent-release", "stage-source-change"].includes(interruptedAt) ? { afterKeyStageBeforeIntent: () => {
        if (interruptedAt === "stage-external-lock") writeFileSync(join(f.workspace, rebuildRuntimeIsolation.processLockRoot, "unowned.json"), "{}", { mode: 0o600 });
        if (interruptedAt === "stage-extra-copy") writeFileSync(join(f.stateRoot, "unowned.json"), "{}", { mode: 0o600 });
        if (interruptedAt === "stage-child-release") { assert.ok(initializationChild !== undefined); initializationChild.release(); }
        if (interruptedAt === "stage-parent-release") f.machine.release();
        if (interruptedAt === "stage-source-change") writeFileSync(path, "{}", { mode: 0o600 });
        if (interruptedAt === "stage-substitution") {
          const directory = join(f.machine.stateRoot, "machine", "credential-keys"), name = readdirSync(directory).find(name => name.endsWith(".tmp"));
          assert.ok(name !== undefined); const keyPath = join(directory, name);
          const key = JSON.parse(readFileSync(keyPath, "utf8")) as { key: string }; key.key = Buffer.alloc(32, 0x33).toString("base64");
          writeFileSync(keyPath, JSON.stringify(key), { mode: 0o600 });
        }
      } } : interruptedAt === "digest-missing" ? { beforeInitialKey: () => {
      const directory = join(f.machine.stateRoot, "machine", "operations");
      const operation = readdirSync(directory).map(name => SignUpOperationSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8"))))
        .find(value => value.profileId === active.profileId);
      assert.ok(operation?.credentialInitialization !== undefined);
      f.machine.publishProfileOperation({ ...operation, credentialInitialization: { ...operation.credentialInitialization, keyDocumentDigest: "f".repeat(64) } });
      crash();
    } } : interruptedAt === "intent" ? { beforeInitialKey: crash }
      : interruptedAt === "orphan-stage" ? { afterKeyStageBeforeIntent: crash }
      : interruptedAt === "stage-journal" ? { afterKeyStageJournal: crash }
      : interruptedAt === "stage-intent" ? { afterKeyStageIntent: crash }
      : interruptedAt === "anchor" ? { afterCredentialAnchor: crash }
      : interruptedAt === "key-phase" || interruptedAt === "document-phase" ? { afterInitializationPhase: phase => {
        if (phase === (interruptedAt === "key-phase" ? "key-published" : "document-published")) crash();
      } } : { afterInitialKey: crash } });
  const epoch = f.machine.readProfileRegistry().sessionGeneration;
  try {
    const legacyBytes = readFileSync(path);
    for (const name of mode === "replace-v3" ? Object.keys(replacement) : []) {
      const omitted = Object.fromEntries(Object.entries(replacement).filter(([key]) => key !== name));
      const refused = migrator.signIn({ ...fields, credentialMigration: { kind: "replace-v3", entries: omitted as CompleteProtectedSettingsPatch } });
      assert.equal(refused.state, "refused");
      if (refused.state === "refused") assert.equal(refused.code, "PROFILE_CREDENTIAL_CONVERSION_REQUIRED");
      assert.equal(readFileSync(path).equals(legacyBytes), true);
      assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
    }
    if (interruptedAt.startsWith("legacy-")) {
      assert.throws(() => migrator.signIn({ ...fields, credentialMigration: { kind: "prove-v2" } }), interruptedAt === "legacy-expectedRevision-tamper" || interruptedAt === "legacy-protectedSchemaHash-tamper"
        ? /protected.json must bind its exact revision and schema/u : /credential-legacy-replay-disagrees/u);
      assert.equal(readFileSync(path).equals(legacyBytes), true);
      assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
      return;
    }
    assert.throws(() => migrator.signIn({ ...fields, credentialMigration: mode === "replace-v3" ? { kind: "replace-v3", entries: replacement } : { kind: "prove-v2" } }), (interruptedAt === "intent" || interruptedAt === "digest-missing") ? /synthetic credential publication interruption/u : CredentialStoreCommitUncertainError);
    if (["orphan-stage", "stage-substitution", "stage-extra-copy", "stage-external-lock", "stage-child-release", "stage-parent-release", "stage-source-change", "stage-registry-change"].includes(interruptedAt)) {
      if (interruptedAt === "stage-parent-release") assert.throws(() => peer.prepareCurrentStorage(active.token), /released admission/u);
      else {
        const ordinary = peer.prepareCurrentStorage(active.token);
        assert.equal(ordinary.state, "refused");
        if (ordinary.state === "refused") assert.equal(ordinary.code, "PROFILE_AUTHORITY_UNAVAILABLE");
      }
      assert.throws(() => createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, initializationInventory })
        .signIn({ ...fields, credentialMigration: mode === "replace-v3" ? { kind: "replace-v3", entries: replacement } : { kind: "prove-v2" } }));
      if (interruptedAt !== "stage-source-change") assert.equal(readFileSync(path).equals(legacyBytes), true);
      return;
    }
    assert.equal(peer.prepareCurrentStorage(active.token).state, "refused");
    if (interruptedAt === "stage-journal") {
      const owner = initializationChild;
      assert.ok(owner !== undefined);
      owner.assertCredentialErasureHead({ state: "never-erased", epoch: 0 });
      assert.throws(() => owner.assertCredentialErasureHead({ state: "established", epoch: 1,
        journal: { device: 1, inode: 1, digest: "f".repeat(64) }, anchor: { device: 1, inode: 2, digest: "e".repeat(64) } }), /profile-erasure-publication-pending/u);
    }
    assert.throws(() => child.assertProfileRuntime());
    assert.throws(() => AuthorityDatabase.open(child, { path: join(child.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "stale-migration-oracle" }, clock, undefined, undefined, undefined, store));
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch + (interruptedAt === "anchor" ? 1 : 0));
    const restarted = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot, initializationInventory });
    if (interruptedAt === "digest-missing") {
      assert.throws(() => restarted.signIn({ ...fields, credentialMigration: mode === "replace-v3" ? { kind: "replace-v3", entries: replacement } : { kind: "prove-v2" } }), /credential-initialization-intended-key-missing/u);
      assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
      assert.equal(readFileSync(path).equals(legacyBytes), true);
      return;
    }
    if (["key-substitution", "key-malformed", "key-foreign"].includes(interruptedAt)) {
      const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`);
      const key = JSON.parse(readFileSync(keyPath, "utf8")) as { key: string; profileId: string };
      if (interruptedAt === "key-substitution") new FakeKeyringEntry("Relay", `${f.machine.locator.installationId}:${active.profileId}`).setPassword(Buffer.alloc(32, 0x31).toString("base64"));
      if (interruptedAt === "key-foreign") key.profileId = randomUUID();
      writeFileSync(keyPath, interruptedAt === "key-malformed" ? "{}" : JSON.stringify(key), { mode: 0o600 });
      const before = readFileSync(keyPath);
      assert.throws(() => restarted.signIn({ ...fields, credentialMigration: mode === "replace-v3" ? { kind: "replace-v3", entries: replacement } : { kind: "prove-v2" } }));
      assert.equal(readFileSync(keyPath).equals(before), true);
      assert.equal(readFileSync(path).equals(legacyBytes), true);
      return;
    }
    const resumed = restarted.signIn({ ...fields, credentialMigration: mode === "replace-v3" ? { kind: "replace-v3", entries: replacement } : { kind: "prove-v2" } });
    assert.equal(resumed.state, "active");
    const anchorScope = anchorScopes[0]; assert.ok(anchorScope);
    for (const scope of anchorScopes) assert.throws(() => readProfilePublicationRegistry(scope), /profile-publication-read-expired/u);
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch + 2);
    assert.equal(peer.prepareCurrentStorage(active.token).state, "refused");
    const current = f.machine.admitProfile(active.profileId);
    try {
      const converted = createCredentialStore({ admission: current, stateRoot: current.stateRoot, erasureJournalAdmission: f.machine,
        erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${active.profileId}.json`) });
      const observed = converted.read();
      assert.equal(observed.revision, record.revision + 1);
      assert.deepEqual(Object.keys(observed.entries).sort(), mode === "replace-v3" ? ["ucpathPassword", "ucpathUserId"] : ["timekeeperName", "ucpathPassword", "ucpathUserId"]);
      assert.equal(observed.entries.timekeeperName?.value, mode === "replace-v3" ? undefined : "FE");
      assert.equal(observed.entries.ucpathUserId?.value, fields.email); assert.equal(observed.entries.ucpathPassword?.value, fields.password);
      assert.equal(converted.ownsCommandId(retired.commandId), mode === "prove-v2");
      assert.equal(converted.apply(ProtectedSettingsApplyInputSchema.parse({ ...retired, expectedRevision: observed.revision,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: fields.at, entries: {} })).state, "rejected");
      const envelope: unknown = JSON.parse(readFileSync(path, "utf8"));
      assert.ok(typeof envelope === "object" && envelope !== null && "schemaVersion" in envelope);
      assert.equal(envelope.schemaVersion, 4);
    } finally { current.release(); }
  } finally { child.release(); await f.close(); }
});
