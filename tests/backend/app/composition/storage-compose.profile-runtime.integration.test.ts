import assert from "node:assert/strict";
import * as accounts from "../../../../src/backend/accounts/chatgpt-account-service.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeProfileRuntime, composeSelectedProfileStorage, composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { ChatGptCredentialRecordSchema, createChatGptCredentialRepository, createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("composes actual selected resources without transport and revokes retained ordinary producers while preserving database custody", async () => {
  const f = createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const hostFacts = { primaryDisplay: null };
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("transport is forbidden in selected-context proof"); });
  const credentials = boundProfileCredentials(f.admission);
  const repository = createChatGptCredentialRepository({ admission: f.admission, stateRoot: f.stateRoot });
  let context: ReturnType<typeof composeSelectedProfileStorage> | undefined;
  try {
    await repository.withLock(async transaction => transaction.replace(ChatGptCredentialRecordSchema.parse({ schemaVersion: 1, revision: 1,
      hostId: `urn:uuid:${randomUUID()}`, clientId: "oaiapp_synthetic", registration: { subject: "synthetic", name: "Synthetic Operator", email: "synthetic@example.edu" },
      session: { accessToken: "synthetic-access", refreshToken: null, idToken: "synthetic-id", expiresAt: "2026-10-21T13:00:00.000Z",
        earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
    }), null));
    const input = { machineAdmission: f.machine, admission: f.admission, credentials, hostFacts, clock };
    context = composeSelectedProfileStorage(input);
    assert.equal(context.credentials, credentials);
    assert.equal(context.database.getMeta().profileId, f.admission.profileBinding.profileId);
    assert.equal(context.settings.read().runtimeStatus.state, "current");
    const account = await context.accountAuthority.readAuthority();
    assert.equal(account.availability, "available");
    assert.equal(account.revision, 2);
    assert.equal(context.accountAuthority.revalidateAuthority(account), true);
    assert.equal(context.accountAuthority.revalidateAuthority({ ...account }), false);
    assert.throws(() => composeSelectedProfileStorage({ ...input, credentials: { ...credentials } }));
    const retainedSettings = context.settings, retainedSecrets = context.protectedSecrets, retainedAccount = context.accountAuthority;
    createProfileRegistry(f.machine).advanceSession(null);
    assert.throws(() => context?.assertCurrent());
    assert.throws(() => retainedSettings.read());
    assert.throws(() => retainedSecrets.read());
    await assert.rejects(retainedAccount.readAuthority());
    assert.equal(context.database.getMeta().profileId, f.admission.profileBinding.profileId);
    assert.equal(transport.mock.calls.length, 0);
  } finally {
    if (context !== undefined) { await context.account.close(); context.database.close(); }
    transport.mockRestore();
    f.close();
  }
});

it("issues a genuine tuple through real profile composition, refuses open-context relogin, and awaits synthetic logout scheduling", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "profile-runtime-composed-")));
  const machine = acquireEntrypointAdmission(workspace, "exclusive"), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("composed profile proof forbids transport"); });
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: join(workspace, "process-locks") });
  try {
    const fields = { firstName: "Synthetic", lastName: "Operator", email: "profile@example.edu", password: "synthetic-profile-password", createdAt: clock.now().toISOString() };
    const active = runtime.session.signUp(fields); assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("synthetic signup refused");
    const seed = machine.admitProfile(createProfileRegistry(machine).storageClaim(active.profileId));
    try {
      await createChatGptCredentialRepository({ admission: seed, stateRoot: seed.stateRoot }).withLock(async transaction => transaction.replace(ChatGptCredentialRecordSchema.parse({
        schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: "oaiapp_synthetic",
        registration: { subject: "synthetic", name: "Synthetic Operator", email: "account@example.net" },
        session: { accessToken: "synthetic-access", refreshToken: null, idToken: "synthetic-id", expiresAt: "2026-10-21T13:00:00.000Z",
          earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
      }), null));
    } finally { seed.release(); }
    const captured = await runtime.session.readCurrentAuthority(active.token); assert.equal(captured.state, "available");
    if (captured.state !== "available") throw new Error("composed authority unavailable");
    assert.equal(captured.snapshot.accountRevision, 2);
    const context = runtime.selectedContext(active.token);
    runtime.beginSupervisorConstruction(active.token);
    runtime.bindSupervisor(active.token, { memberEvidence: () => undefined, drainOwnedChildren: async () => undefined });
    const epoch = machine.readProfileRegistry().sessionGeneration;
    const relogin = runtime.session.signIn({ email: fields.email, password: fields.password, at: clock.now().toISOString() });
    assert.equal(relogin.state, "refused");
    assert.equal(machine.readProfileRegistry().sessionGeneration, epoch);
    context.admission.assertLive();
    assert.equal((await runtime.session.revalidateAuthority(active.token, captured.snapshot)).state, "available");
    assert.equal((await runtime.session.revalidateAuthority(active.token, { ...captured.snapshot })).state, "refused");
    const logout = runtime.session.logOut(active.token, { at: clock.now().toISOString() });
    assert.equal(logout.state, "cancelling");
    const operation = runtime.session.logoutOperations()[0]; assert.ok(operation);
    assert.equal((await runtime.session.readCurrentAuthority(active.token)).state, "refused");
    assert.throws(() => context.protectedSecrets.read());
    await runtime.awaitClosurePreparation(active.profileId);
    assert.equal(context.database.getMeta().profileId, active.profileId);
    assert.equal(runtime.session.resumeLogout(operation.operationId).state, "wiped");
    assert.throws(() => context.database.getMeta(), /closed/u);
    assert.throws(() => context.admission.assertLive());
    const next = runtime.session.signIn({ email: fields.email, password: fields.password, at: clock.now().toISOString() });
    assert.equal(next.state, "active");
    if (next.state === "active") assert.ok(next.epoch > epoch);
    assert.equal(transport.mock.calls.length, 0);
  } finally { await runtime.close(); machine.release(); transport.mockRestore(); rmSync(workspace, { recursive: true, force: true }); }
});

for (const dimension of ["account", "settings"] as const) it(`revalidates real composed ${dimension} dimensions${dimension === "settings" ? " and protected changes across an actual account await" : " with local attempt and expiry transitions"}`, async () => {
  const f = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("G4 synthetic composition forbids transport"); });
  const createAccount = accounts.createChatGptAccountService;
  const accountFactory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => ({ ...createAccount(options) }));
  const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: join(f.workspace, "process-locks") });
  try {
    const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("genuine session required");
    const context = runtime.selectedContext(active.token);
    const repository = createChatGptCredentialRepository({ admission: context.admission, stateRoot: context.admission.stateRoot });
    await repository.withLock(async transaction => transaction.replace(ChatGptCredentialRecordSchema.parse({ schemaVersion: 1, revision: 1,
      hostId: `urn:uuid:${randomUUID()}`, clientId: "oaiapp_synthetic", registration: { subject: "fixture", name: "Synthetic", email: "synthetic@example.edu" },
      session: { accessToken: "synthetic-g4-access", refreshToken: null, idToken: "synthetic-g4-id", expiresAt: "2026-10-21T13:00:00.000Z",
        earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
    }), null));
    const capture = async () => {
      const result = await runtime.session.readCurrentAuthority(active.token);
      assert.equal(result.state, "available"); if (result.state !== "available") throw new Error("real composed tuple required");
      return result.snapshot;
    };
    let prior = await capture();
    const assertFresh = async (changed: readonly string[]) => {
      assert.equal((await runtime.session.revalidateAuthority(active.token, prior)).state, "refused");
      const next = await capture();
      const differences = Object.keys(prior).filter(key => Reflect.get(prior, key) !== Reflect.get(next, key)).sort();
      assert.deepEqual(differences, [...changed].sort());
      assert.equal((await runtime.session.revalidateAuthority(active.token, next)).state, "available");
      prior = next;
    };
    if (dimension === "account") {
    await repository.withLock(async transaction => { const current = transaction.read(); assert.ok(current); transaction.replace({ ...current, revision: current.revision + 1 }, current.revision); });
    await assertFresh(["accountRevision"]);
    const attempt = await context.account.signIn({ usePlan: true });
    assert.equal((await runtime.session.readCurrentAuthority(active.token)).state, "refused");
    await assert.rejects(context.account.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await attempt.cancel();
    await assertFresh(["accountAttemptGeneration"]);
    clock.advanceWall(3_600_001);
    assert.equal((await runtime.session.revalidateAuthority(active.token, prior)).state, "refused");
    assert.equal((await runtime.session.readCurrentAuthority(active.token)).state, "refused");
    } else {
    const applyProtected = () => context.credentials.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
      commandFingerprint: "a".repeat(64), expectedRevision: context.credentials.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      updatedAt: clock.now().toISOString(), entries: { timekeeperName: { set: "Synthetic Updated" } } }));
    assert.equal(applyProtected().state, "applied");
    await assertFresh(["protectedSettingsRevision"]);
    const applySettings = () => {
      const patch = { "browser.headless": { set: false } };
      return executeSettingsCommand({ authority: context.database, clock, ids: { uuid: randomUUID },
        settings: createSettingsApplicationExecutor(context.resolveSettings, context.credentials) }, {
        family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
        source: "settings-surface", target: { expectedRevision: context.settings.read().record.revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    };
    assert.equal(applySettings().state, "applied");
    await assertFresh(["savedSettingsRevision", "savedSettingsFingerprint", "activeSettingsRevision", "activeSettingsFingerprint", "activeConfigFingerprint"]);
    const read = context.account.readAuthority.bind(context.account);
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
    const spy = vi.spyOn(context.account, "readAuthority").mockImplementation(async admission => { entered(); await barrier; return read(admission); });
    const inFlight = runtime.session.readCurrentAuthority(active.token); await waiting;
    assert.equal(applyProtected().state, "applied"); release();
    assert.equal((await inFlight).state, "refused"); spy.mockRestore();
    assert.equal((await runtime.session.readCurrentAuthority(active.token)).state, "available");
    }
    assert.equal(transport.mock.calls.length, 0);
  } finally { await runtime.close(); accountFactory.mockRestore(); transport.mockRestore(); f.close(); }
});

it("refuses old tokens and issued captures after a real composition restart before opening ordinary resources", async () => {
  const f = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const input = { admission: f.machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: join(f.workspace, "process-locks") };
  const first = composeProfileRuntime(input);
  let restarted: ReturnType<typeof composeProfileRuntime> | undefined;
  try {
    const active = first.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("genuine session required");
    const retained = first.selectedContext(active.token), epoch = f.machine.readProfileRegistry().sessionGeneration;
    await first.close();
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
    restarted = composeProfileRuntime(input);
    assert.throws(() => restarted?.selectedContext(active.token));
    assert.equal((await restarted.session.readCurrentAuthority(active.token)).state, "refused");
    assert.throws(() => retained.protectedSecrets.read());
    assert.throws(() => retained.settings.read());
    await assert.rejects(retained.accountAuthority.readAuthority());
    const next = restarted.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(next.state, "active"); if (next.state !== "active") throw new Error("genuine reauthentication required");
    assert.ok(next.epoch > active.epoch);
    assert.notEqual(restarted.selectedContext(next.token).admission, retained.admission);
    assert.throws(() => retained.database.getMeta(), /closed/u);
  } finally { await first.close(); await restarted?.close(); f.close(); }
});

it("requires the same actual profile credential owner for canonical offline restore and its observation", async () => {
  const f = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  const profileId = f.admission.profileBinding.profileId;
  const credentials = boundProfileCredentials(f.admission);
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials, clock, hostFacts: { primaryDisplay: null } });
  try {
    const report = await new AuthorityBackupService(f.admission, context.database, { directory: join(f.stateRoot, "backups", "authority") }, clock)
      .request({ trigger: "operator", requiredGeneration: context.database.getMeta().authorityGeneration });
    const manifest = report.manifests.at(-1); assert.ok(manifest);
    await context.account.close(); context.database.close();
    const args = ["restore", "--from", join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`), "--json"];
    await assert.rejects(composeStorageCommand(rebuildRuntimeIsolation, args, clock, f.workspace, f.admission), /profile-restore-credential-owner-required/u);
    const foreign = createBoundProfileFixture();
    try { await assert.rejects(composeStorageCommand(rebuildRuntimeIsolation, args, clock, f.workspace, f.admission, boundProfileCredentials(foreign.admission))); }
    finally { foreign.close(); }
    const restored = await composeStorageCommand(rebuildRuntimeIsolation, args, clock, f.workspace, f.admission, credentials);
    assert.equal(restored.exitCode, 0, restored.output);
    const outcome = JSON.parse(restored.output) as { credentials: { state: string } };
    assert.equal(outcome.credentials.state, "unavailable");
    assert.throws(() => credentials.read());
    const fresh = f.machine.admitProfile(f.machine.issueRegisteredProfileClaim(profileId));
    try {
      const store = createCredentialStore({ admission: fresh, stateRoot: fresh.stateRoot, erasureJournalAdmission: f.machine,
        erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${fresh.profileBinding.profileId}.json`) });
      assert.equal(store.read().entries.ucpathPassword?.value, "disposable-fixture-password");
    } finally { fresh.release(); }
  } finally { await context.account.close(); context.database.close(); f.close(); }
});

it("admits only the exact held stopped projection capability before opening staged authority", async () => {
  const f = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  await context.account.close(); context.database.close();
  const stagedPath = join(f.stateRoot, `.restore-${randomUUID()}.sqlite.tmp`);
  copyFileSync(f.path, stagedPath);
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot), pid: process.pid }, clock);
  let capability: ReturnType<typeof f.admission.stoppedRestoreProjection> | undefined;
  try {
    const before = readFileSync(stagedPath);
    const options = { path: stagedPath, busyTimeoutMs: 250, migrationOwner: "projection-capability-test" };
    assert.throws(() => AuthorityDatabase.openStoppedRestoreProjection(f.admission, options, clock));
    const inspection = f.admission.stoppedStagedAuthority(stagedPath);
    try { assert.throws(() => AuthorityDatabase.openStoppedRestoreProjection(inspection, options, clock)); }
    finally { inspection.release(); }
    assert.throws(() => f.admission.stoppedRestoreProjection(stagedPath, { ...restore }));
    assert.throws(() => f.admission.stoppedRestoreProjection(join(f.stateRoot, `.restore-${randomUUID()}.sqlite.tmp`), restore));
    capability = f.admission.stoppedRestoreProjection(stagedPath, restore);
    assert.throws(() => AuthorityDatabase.openStoppedRestoreProjection(capability!, { ...options, path: f.path }, clock));
    assert.equal(readFileSync(stagedPath).equals(before), true);
    const database = AuthorityDatabase.openStoppedRestoreProjection(capability, options, clock);
    assert.equal(database.getMeta().profileId, f.admission.profileBinding.profileId); database.close();
    restore.release();
    assert.throws(() => AuthorityDatabase.openStoppedRestoreProjection(capability!, options, clock));
  } finally { capability?.release(); restore.release(); f.close(); }
});
