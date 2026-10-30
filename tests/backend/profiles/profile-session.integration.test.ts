import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { PrivateFileLockUnavailableError, withOperationProof } from "../../../src/backend/storage/configuration/credential-safe-file.js";
import { FakeKeyringEntry } from "../../support/helpers/credential-keychain-fake.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { finishProfileOnboarding, readyProfileOnboarding } from "../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { readAuthenticatedCredentialFixture, createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { composeProfileCredentialRepairInventory, composeProfileCredentialInitializationInventory } from "../../../src/backend/app/composition/profile-credential-inventory.js";
import { assessCredentialInventory } from "../../../src/backend/profiles/credential-inventory.js";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { z } from "zod";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";

import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createSyntheticProfileSession as realCreateProfileSession } from "../../support/helpers/admission-fixture.js";
import { ProfileRegistryDocumentSchema, SignUpOperationSchema, type ProfileRegistryDocument } from "../../../src/models/profiles/profile.js";
import { manualClock, systemClock } from "../../../src/rules/time/clock.js";
import { IsoInstantSchema, PositiveIntSchema, FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../src/models/config/settings.js";
import type { SettingsRuntimeSnapshot } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { createChatGptAccountService, type ChatGptAccountAuthority } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { RESTORE_ADMISSION_REQUEST, createChatGptCredentialRepository } from "../../../src/backend/storage/configuration/credential-store.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";

const machineAdmissions = new Map<string, RuntimeAdmission>();
const sessionOwners = new Set<ReturnType<typeof realCreateProfileSession>>();
function createProfileSession(input: Omit<Parameters<typeof realCreateProfileSession>[0], "admission">) {
  const admission = machineAdmissions.get(input.machineRoot);
  if (admission === undefined) throw new Error("profile fixture machine admission missing");
  const session = realCreateProfileSession({ ...input, admission,
    repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine: admission,
      admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(request, writer, copies),
    initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine: admission,
      admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(operation, writer, copies) });
  sessionOwners.add(session);
  return session;
}

const roots: string[] = [];
afterEach(async () => { for (const session of sessionOwners) await session.close(); sessionOwners.clear(); for (const admission of machineAdmissions.values()) admission.release(); machineAdmissions.clear(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function temp(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "hr-profiles-")));
  roots.push(root);
  const lifetime = await runtimeLifetimeLock();
  const admission = acquireEntrypointAdmission(root, "shared", lifetime);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  machineAdmissions.set(admission.stateRoot, admission);
  return admission.stateRoot;
}

describe("profile session", () => {
  it("keeps profile B from reading profile A, blocks logout while work is active, and refuses a stale token", async () => {
    const root = await temp();
    let busy = false;
    const session = createProfileSession({
      machineRoot: root,
      activity: { hasUnquiescedWork: () => busy },
      backupPaths: () => [],
      loginDataPaths: () => [],
    });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    writeFileSync(join(root, "profiles", alex.profileId, "note.txt"), "alex-only\n", { mode: 0o600 });
    busy = true;
    const blocked = session.logOut(alex.token, { at: "2026-09-06T12:06:00.000Z" });
    assert.equal(blocked.state, "cancelling");
    if (blocked.state !== "cancelling" || blocked.operationId === undefined) return;
    assert.equal(readFileSync(join(root, "machine", "operations", `${blocked.operationId}.json`), "utf8").includes("secret-one"), false);
    assert.equal(readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8").includes("secret-one"), false);
    busy = false;
    const wiped = session.resumeLogout(blocked.operationId);
    assert.equal(wiped.state, "wiped");
    const protectedText = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(protectedText.includes("secret-one"), false);
    assert.equal(protectedText.includes("alex@ucsd.edu"), false);
    const retained = readAuthenticatedCredentialFixture(root, alex.profileId) as { record: { entries: { timekeeperName?: { value: string } } } };
    assert.equal(retained.record.entries.timekeeperName?.value, "AR");
    const verifiers = readFileSync(join(root, "machine", "profile-verifiers.json"), "utf8");
    assert.equal(verifiers.includes("secret-one"), false);
    assert.equal(verifiers.includes("alex@ucsd.edu"), false);
    const stale = session.readFile(alex.token, "note.txt");
    assert.equal("state" in stale && stale.state === "refused" && stale.code === "PROFILE_SESSION_STALE", true);
    const returned = session.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:09:00.000Z" });
    assert.equal(returned.state, "active");
    if (returned.state !== "active") return;
    const restored = readFileSync(join(root, "profiles", returned.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(restored.includes("secret-one"), false);
    assert.equal(restored.includes("alex@ucsd.edu"), false);
    assert.equal(restored.includes("\"AR\""), false);
    const currentRecord = readAuthenticatedCredentialFixture(root, returned.profileId) as { record: { entries: { ucpathUserId: { value: string }; ucpathPassword: { value: string }; timekeeperName: { value: string } } } };
    assert.equal(currentRecord.record.entries.ucpathUserId.value, "alex@ucsd.edu");
    assert.equal(currentRecord.record.entries.ucpathPassword.value, "secret-one");
    assert.equal(currentRecord.record.entries.timekeeperName.value, "AR");
    assert.equal(session.logOut(returned.token, { at: "2026-09-06T12:09:00.000Z" }).state, "wiped");
    const sam = await finishProfileOnboarding(session, session.signUp({
      firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-two", createdAt: "2026-09-06T12:08:00.000Z",
    }));
    assert.equal(sam.state, "active");
    if (sam.state !== "active") return;
    assert.throws(() => session.readFile(sam.token, join("..", alex.profileId, "note.txt")));
    assert.equal(session.changePassword().code, "PROFILE_VERIFIER_UNAVAILABLE");
  });

  it("does not claim logout complete while a backup still holds the secret", async () => {
    const root = await temp();
    const session = createProfileSession({
      machineRoot: root,
      activity: { hasUnquiescedWork: () => false },
      backupPaths: (profileId) => [join(root, "backups", `${profileId}.json`)],
      loginDataPaths: () => [],
    });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    mkdirSync(join(root, "backups"), { mode: 0o700 });
    writeFileSync(join(root, "backups", `${alex.profileId}.json`), "secret-one\n", { mode: 0o600 });
    const result = session.logOut(alex.token, { at: "2026-09-06T12:07:00.000Z" });
    assert.equal(result.state, "refused");
    if (result.state === "refused") assert.equal(result.code, "PROFILE_LOGOUT_INVENTORY_BLOCKED");
    assert.equal(readFileSync(join(root, "backups", `${alex.profileId}.json`), "utf8"), "secret-one\n");
    const registry = JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as {
      profiles: { profileId: string; lifecycle: string; credentialState: string }[];
    };
    const row = registry.profiles.find((entry) => entry.profileId === alex.profileId);
    assert.equal(row?.lifecycle, "cancelling");
    assert.notEqual(row?.credentialState, "wiped");
    const restarted = createProfileSession({
      machineRoot: root,
      activity: { hasUnquiescedWork: () => false },
      backupPaths: (profileId) => [join(root, "backups", `${profileId}.json`)],
      loginDataPaths: () => [],
    });
    const signed = restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:10:00.000Z" });
    assert.notEqual(signed.state, "active");
  });

  it("blocks resumed logout when a schema3 clean copy retains captured secret bytes outside UCPath fields", async () => {
    const root = await temp(), backup = join(root, "inventory-copy.json");
    const ports = { activity: { hasUnquiescedWork: () => false }, backupPaths: () => existsSync(backup) ? [backup] : [], loginDataPaths: () => [] };
    const session = createProfileSession({ machineRoot: root, ...ports });
    const password = "disposable-inventory-capture-password";
    const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password, createdAt: "2026-09-06T12:00:00.000Z" }));
    assert.ok(active.state === "active");
    const profile = join(root, "profiles", active.profileId), protectedPath = join(profile, "credentials", "protected.json");
    const restored = readFileSync(protectedPath);
    writeFileSync(backup, restored, { mode: 0o600 });
    const held = session.logOut(active.token, { at: "2026-09-06T12:01:00.000Z" });
    assert.ok(held.state === "refused" && held.operationId !== undefined);
    const operationId = held.operationId;
    const erased = readAuthenticatedCredentialFixture(root, active.profileId) as { history: { receipt: { commandId: string } }[] };
    const copyFixture = await createBoundProfileFixture();
    const copyAdmission = copyFixture.admission;
    try {
      const copyStore = createCredentialStore({ admission: copyAdmission, stateRoot: copyAdmission.stateRoot, erasureJournalAdmission: copyFixture.machine,
        erasureJournalPath: join(copyFixture.machine.stateRoot, "machine", "erasures", `${copyAdmission.profileBinding.profileId}.json`) });
      assert.equal(copyStore.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: "32323232-3232-4232-8232-323232323232", writeId: "34343434-3434-4434-8434-343434343434",
        commandFingerprint: "e".repeat(64), expectedRevision: copyStore.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        updatedAt: "2026-09-06T12:00:00.000Z", entries: { ucpathUserId: { clear: true }, ucpathPassword: { clear: true }, timekeeperName: { set: password } } })).state, "applied");
      writeFileSync(backup, readFileSync(join(copyAdmission.stateRoot, "credentials", "protected.json")), { mode: 0o600 });
    } finally { await copyFixture.close(); }
    const copyBytes = readFileSync(backup);
    const withoutCapture = assessCredentialInventory({ profileRoot: profile, entriesAbsent: true, backupPaths: [backup], loginDataPaths: [], capturedSecrets: [], capturedSecretsComplete: false });
    assert.equal(withoutCapture.logoutComplete, false);
    assert.deepEqual(withoutCapture.backupPlaintext, []);
    assert.deepEqual(withoutCapture.unknownFormats, [backup]);
    writeFileSync(protectedPath, restored, { mode: 0o600 });
    const restarted = createProfileSession({ machineRoot: root, ...ports });
    const blocked = restarted.resumeLogout(operationId);
    assert.ok(blocked.state === "refused");
    assert.equal(blocked.code, "PROFILE_LOGOUT_INVENTORY_BLOCKED");
    const row = machineAdmissions.get(root)?.readProfileRegistry().profiles.find(entry => entry.profileId === active.profileId);
    assert.equal(row?.lifecycle, "cancelling");
    assert.notEqual(row?.credentialState, "wiped");
    assert.deepEqual(readFileSync(backup), copyBytes);
    assert.equal(readFileSync(protectedPath).includes(Buffer.from(password)), false);
    const replayed = readAuthenticatedCredentialFixture(root, active.profileId) as typeof erased;
    assert.deepEqual(replayed.history.map(entry => entry.receipt.commandId), erased.history.map(entry => entry.receipt.commandId));
    const assertStillBlocked = (result: ReturnType<typeof restarted.resumeLogout>) => {
      assert.ok(result.state === "refused");
      assert.equal(result.code, "PROFILE_LOGOUT_INVENTORY_BLOCKED");
      const row = machineAdmissions.get(root)?.readProfileRegistry().profiles.find(entry => entry.profileId === active.profileId);
      assert.equal(row?.lifecycle, "cancelling");
      assert.notEqual(row?.credentialState, "wiped");
      assert.deepEqual(readFileSync(backup), copyBytes);
      const current = readAuthenticatedCredentialFixture(root, active.profileId) as typeof erased;
      assert.deepEqual(current.history.map(entry => entry.receipt.commandId), erased.history.map(entry => entry.receipt.commandId));
      const pending = JSON.parse(readFileSync(join(root, "machine", "operations", `${operationId}.json`), "utf8")) as { commandId: string; writeId: string; expectedRevision: number };
      assert.deepEqual({ commandId: pending.commandId, writeId: pending.writeId, expectedRevision: pending.expectedRevision }, eraseIdentity);
    };
    const pending = JSON.parse(readFileSync(join(root, "machine", "operations", `${operationId}.json`), "utf8")) as { commandId: string; writeId: string; expectedRevision: number };
    const eraseIdentity = { commandId: pending.commandId, writeId: pending.writeId, expectedRevision: pending.expectedRevision };
    assertStillBlocked(restarted.resumeLogout(operationId));
    const again = createProfileSession({ machineRoot: root, ...ports });
    assertStillBlocked(again.resumeLogout(operationId));
    assertStillBlocked(again.resumeLogout(operationId));
    rmSync(backup);
    assert.equal(again.resumeLogout(operationId).state, "wiped");
  });

  it("does not cancel another profile when this one signs in", async () => {
    const root = await temp();
    const cancelled: string[] = [];
    const session = createProfileSession({
      machineRoot: root,
      backupPaths: () => [], loginDataPaths: () => [],
      activity: {
        hasUnquiescedWork: (profileId) => profileId === busyId,
        requestCancellation: (profileId) => { cancelled.push(profileId); },
      },
    });
    let busyId = "";
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    assert.equal(session.logOut(alex.token, { at: "2026-09-06T12:01:00.000Z" }).state, "wiped");
    const sam = await finishProfileOnboarding(session, session.signUp({
      firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-two", createdAt: "2026-09-06T12:01:00.000Z",
    }));
    assert.equal(sam.state, "active");
    if (sam.state !== "active") return;
    assert.equal(session.logOut(sam.token, { at: "2026-09-06T12:01:00.000Z" }).state, "wiped");
    assert.equal(session.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:01:00.000Z" }).state, "active");
    busyId = alex.profileId;
    const signed = session.signIn({ email: "sam@ucsd.edu", password: "secret-two", at: "2026-09-06T12:02:00.000Z" });
    assert.notEqual(signed.state, "active");
    const registry = JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as {
      profiles: { profileId: string; lifecycle: string }[];
    };
    assert.equal(registry.profiles.find((entry) => entry.profileId === alex.profileId)?.lifecycle, "ready");
    assert.equal(cancelled.includes(alex.profileId), false);
    assert.equal(readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8").includes("secret-one"), false);
  });

  it("refuses non-letter initials before creating a profile", async () => {
    const root = await temp();
    const session = createProfileSession({ machineRoot: root });
    const refused = await finishProfileOnboarding(session, session.signUp({
      firstName: "Émile", lastName: "Rivera", email: "emile@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(refused.state, "refused");
    if (refused.state === "refused") assert.equal(refused.code, "PROFILE_NAME_REFUSED");
    assert.equal((JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: unknown[] }).profiles.length, 0);
  });

  it("refuses a decomposed non-ASCII name before creating a profile", async () => {
    const root = await temp();
    const session = createProfileSession({ machineRoot: root });
    for (const firstName of ["E\u0301mile", "ıvan", "ſmith", "\u212Aelvin"]) {
      const refused = await finishProfileOnboarding(session, session.signUp({
        firstName, lastName: "Rivera", email: "emile@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
      }));
      assert.equal(refused.state, "refused");
      if (refused.state === "refused") assert.equal(refused.code, "PROFILE_NAME_REFUSED");
    }
    assert.equal((JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: unknown[] }).profiles.length, 0);
  });

  it("does not erase when no activity port can close work", async () => {
    const root = await temp();
    const session = createProfileSession({ machineRoot: root });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    const result = session.logOut(alex.token, { at: "2026-09-06T12:07:00.000Z" });
    assert.equal(result.state, "cancelling");
    assert.equal(readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8").includes("secret-one"), false);
  });

  it("resumes a logout from the retained operation after restart", async () => {
    const root = await temp();
    let busy = true;
    const activity = { hasUnquiescedWork: () => busy };
    const session = createProfileSession({ machineRoot: root, activity, backupPaths: () => [], loginDataPaths: () => [] });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    const blocked = session.logOut(alex.token, { at: "2026-09-06T12:06:00.000Z" });
    assert.equal(blocked.state, "cancelling");
    if (blocked.state !== "cancelling" || blocked.operationId === undefined) return;
    const restarted = createProfileSession({ machineRoot: root, activity, backupPaths: () => [], loginDataPaths: () => [] });
    assert.notEqual(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:07:00.000Z" }).state, "active");
    assert.equal(restarted.resumeLogout(alex.profileId).state, "refused");
    busy = false;
    const wiped = restarted.resumeLogout(blocked.operationId);
    assert.equal(wiped.state, "wiped");
    assert.equal(readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8").includes("secret-one"), false);
  });

  it("refuses logout completion when the erasure journal resolves inside the profile", async () => {
    const root = await temp();
    const session = createProfileSession({
      machineRoot: root,
      activity: { hasUnquiescedWork: () => false },
      backupPaths: () => [],
      loginDataPaths: () => [],
    });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    const foreign = createProfileSession({ machineRoot: root, backupPaths: () => [], loginDataPaths: () => [] });
    const before = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"));
    const inside = join(root, "profiles", alex.profileId, "journal-link");
    mkdirSync(inside, { mode: 0o700 });
    symlinkSync(inside, join(root, "machine", "erasures"));
    const unknown = session.logOut("unissued-token", { at: "2026-09-06T12:07:00.000Z" });
    assert.equal(unknown.state === "refused" && unknown.code, "PROFILE_SESSION_STALE");
    const foreignResult = foreign.logOut(alex.token, { at: "2026-09-06T12:07:00.000Z" });
    assert.equal(foreignResult.state === "refused" && foreignResult.code, "PROFILE_SESSION_STALE");
    const result = session.logOut(alex.token, { at: "2026-09-06T12:07:00.000Z" });
    assert.equal(result.state, "refused");
    if (result.state === "refused") {
      assert.equal(result.code, "PROFILE_RESTORE_ADMISSION_REQUIRED");
      assert.equal(result.request, RESTORE_ADMISSION_REQUEST);
    }
    assert.deepEqual(readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json")), before);
    machineAdmissions.get(root)?.release();
    assert.throws(() => session.logOut(alex.token, { at: "2026-09-06T12:07:00.000Z" }));
  });

  it("strips a restored profile file with the external erasure journal", async () => {
    const root = await temp();
    const backup = join(root, "held-backup.bin");
    const session = createProfileSession({
      machineRoot: root,
      activity: { hasUnquiescedWork: () => false },
      backupPaths: () => existsSync(backup) ? [backup] : [],
      loginDataPaths: () => [],
    });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    const protectedPath = join(root, "profiles", alex.profileId, "credentials", "protected.json");
    const older = readFileSync(protectedPath);
    writeFileSync(backup, "secret-one", { mode: 0o600 });
    const wiped = session.logOut(alex.token, { at: "2026-09-06T12:07:00.000Z" });
    assert.equal(wiped.state, "refused");
    assert.ok("operationId" in wiped && wiped.operationId !== undefined);
    const operationId = wiped.operationId;
    writeFileSync(protectedPath, older, { mode: 0o600 });
    mkdirSync(join(root, "profiles", alex.profileId, "credential-erasures"), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, "profiles", alex.profileId, "credential-erasures", "journal.json"), "{\"schemaVersion\":1,\"epoch\":0,\"erasedValueIds\":[],\"retiredCommandIds\":[]}\n", { mode: 0o600 });
    rmSync(backup);
    assert.throws(() => session.resumeLogout(operationId), /profile-inventory-unowned-entry/u);
    rmSync(join(root, "profiles", alex.profileId, "credential-erasures"), { recursive: true });
    assert.equal(session.resumeLogout(operationId).state, "wiped");
    assert.equal(readFileSync(protectedPath, "utf8").includes("secret-one"), false);
  });

  it("does not publish a profile when credential apply fails before commit", async () => {
    const root = await temp();
    let renames = 0;
    const session = createProfileSession({
      machineRoot: root,
      credentialHooks: { beforeRename: () => { if (++renames === 2) throw new Error("disk"); } },
    });
    await assert.rejects(async () => await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    })), /disk/);
    assert.equal((JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: unknown[] }).profiles.length, 0);
  });

  it("publishes one sign-up when the credential commit is uncertain", async () => {
    const root = await temp();
    let renames = 0;
    const session = createProfileSession({
      machineRoot: root,
      credentialHooks: { afterRename: () => { if (++renames === 2) throw new Error("uncertain"); } },
    });
    const draft = session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    });
    assert.ok(draft.state === "onboarding");
    const machine = machineAdmissions.get(root); assert.ok(machine);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    const ready = await readyProfileOnboarding(session, draft);
    assert.ok(ready.state === "onboarding" && ready.step === "ready");
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    const alex = await session.completeOnboarding(draft.token, draft.operationId);
    assert.equal(alex.state, "active");
    assert.equal(renames, 2);
    if (alex.state !== "active") return;
    const text = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(text.includes("secret-one"), false);
    const document: unknown = readAuthenticatedCredentialFixture(root, alex.profileId);
    if (typeof document !== "object" || document === null || !("history" in document) || !Array.isArray(document.history)) {
      throw new Error("credential history is missing");
    }
    assert.equal(document.history.length, 1);
  });

  it("does not follow an operation symlink", async () => {
    const root = await temp();
    const session = createProfileSession({ machineRoot: root });
    const operations = join(root, "machine", "operations");
    mkdirSync(operations, { recursive: true, mode: 0o700 });
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{\"password\":\"secret-one\"}\n", { mode: 0o600 });
    symlinkSync(outside, join(operations, "55555555-5555-4555-8555-555555555555.json"));
    assert.throws(() => session.resumeLogout("55555555-5555-4555-8555-555555555555"), /profile registry authority is unavailable/);
    assert.equal(readFileSync(outside, "utf8").includes("secret-one"), true);
  });

  it("holds the profile lock until the current operation finishes", async () => {
    const root = await temp();
    let nested = false;
    const nestedFailures: unknown[] = [];
    const session = createProfileSession({
      machineRoot: root,
      credentialHooks: {
        beforeRename: () => {
          if (nested) return;
          nested = true;
          try { session.signUp({
            firstName: "Sam", lastName: "Rivera", email: "sam@ucsd.edu", password: "secret-two", createdAt: "2026-09-06T12:00:00.000Z",
          }); } catch (error) { nestedFailures.push(error); }
        },
      },
    });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    assert.equal(nestedFailures.length, 1);
    assert.ok(nestedFailures[0] instanceof PrivateFileLockUnavailableError);
    const registry = JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: { firstName: string }[] };
    assert.equal(registry.profiles.length, 1);
    assert.equal(registry.profiles[0]?.firstName, "Alex");
  }, 20_000);

  for (const record of ["malformed", "unknown"] as const) it(`retains a ${record} profile lock without sign-up effects`, async () => {
    const root = await temp();
    const machine = join(root, "machine");
    const session = createProfileSession({ machineRoot: root });
    const path = join(machine, ".profile-ops.lock");
    const bytes = Buffer.from(record === "malformed" ? "{malformed" : JSON.stringify({ nonce: "11111111-1111-4111-8111-111111111111", unknown: true }));
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    const before = fs.readdirSync(root, { recursive: true }).map(name => {
      const path = join(root, String(name)), info = fs.lstatSync(path);
      return { path, inode: info.ino, bytes: info.isFile() ? readFileSync(path) : null };
    });
    const keys = FakeKeyringEntry.snapshot();
    assert.throws(() => session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }), PrivateFileLockUnavailableError);
    assert.deepEqual(readFileSync(path), bytes);
    assert.deepEqual(fs.readdirSync(root, { recursive: true }).map(name => {
      const path = join(root, String(name)), info = fs.lstatSync(path);
      return { path, inode: info.ino, bytes: info.isFile() ? readFileSync(path) : null };
    }), before);
    assert.deepEqual(FakeKeyringEntry.snapshot(), keys);
  });

  it("does not sign in another profile while a logout operation is still open", async () => {
    const root = await temp();
    const session = createProfileSession({ machineRoot: root, activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active"); if (alex.state !== "active") return;
    assert.equal(session.logOut(alex.token, { at: "2026-09-06T12:01:00.000Z" }).state, "wiped");
    const sam = await finishProfileOnboarding(session, session.signUp({
      firstName: "Sam", lastName: "Rivera", email: "sam@ucsd.edu", password: "secret-two", createdAt: "2026-09-06T12:01:00.000Z",
    }));
    assert.equal(alex.state, "active");
    assert.equal(sam.state, "active");
    if (alex.state !== "active" || sam.state !== "active") return;
    const operationId = "77777777-7777-4777-8777-777777777777";
    const machine = machineAdmissions.get(root); assert.ok(machine);
    machine.publishProfileOperation({ schemaVersion: 1, kind: "logout", operationId, profileId: alex.profileId,
      at: IsoInstantSchema.parse("2026-09-06T12:06:00.000Z"), phase: "admitted" });
    const restarted = createProfileSession({ machineRoot: root });
    const blocked = restarted.signIn({ email: "sam@ucsd.edu", password: "secret-two", at: "2026-09-06T12:07:00.000Z" });
    assert.equal(blocked.state, "refused");
    if (blocked.state === "refused") assert.equal(blocked.code, "PROFILE_TRANSITION_BLOCKED");
    const registry = JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: { profileId: string; lifecycle: string }[] };
    assert.equal(registry.profiles.find((row) => row.profileId === alex.profileId)?.lifecycle, "ready");
  });

  it("does not save a different password over an already applied sign-up command", async () => {
    const root = await temp();
    const session = createProfileSession({ machineRoot: root });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    const verifierText = readFileSync(join(root, "machine", "profile-verifiers.json"), "utf8");
    const verifier: unknown = JSON.parse(verifierText);
    const credentialText = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(credentialText.includes("secret-one"), false);
    const credential: unknown = readAuthenticatedCredentialFixture(root, alex.profileId);
    if (typeof verifier !== "object" || verifier === null || !("profiles" in verifier) || !Array.isArray(verifier.profiles)) {
      throw new Error("verifier file is missing");
    }
    const row: unknown = verifier.profiles[0];
    if (typeof row !== "object" || row === null || !("emailKey" in row) || typeof row.emailKey !== "string") {
      throw new Error("verifier email key is missing");
    }
    if (typeof credential !== "object" || credential === null || !("history" in credential) || !Array.isArray(credential.history)) {
      throw new Error("credential history is missing");
    }
    const entry: unknown = credential.history[0];
    if (typeof entry !== "object" || entry === null || !("receipt" in entry) || typeof entry.receipt !== "object" || entry.receipt === null) {
      throw new Error("credential receipt is missing");
    }
    const receipt = entry.receipt;
    if (!("commandId" in receipt) || typeof receipt.commandId !== "string"
      || !("writeId" in receipt) || typeof receipt.writeId !== "string"
      || !("commandFingerprint" in receipt) || typeof receipt.commandFingerprint !== "string"
      || !("expectedRevision" in receipt) || typeof receipt.expectedRevision !== "number") {
      throw new Error("credential receipt is missing");
    }
    const machine = machineAdmissions.get(root); assert.ok(machine);
    const prior = machine.readProfileRegistry(); machine.publishProfileRegistry(prior, { ...prior, activeProfileId: null });
    machine.publishProfileOperation(SignUpOperationSchema.parse({
      schemaVersion: 1,
      kind: "sign-up",
      operationId: "12121212-1212-4121-8121-121212121212",
      profileId: alex.profileId,
      commandId: receipt.commandId,
      writeId: receipt.writeId,
      emailKey: row.emailKey,
      firstName: "Alex",
      lastName: "Rivera",
      createdAt: "2026-09-06T12:00:00.000Z",
      commandFingerprint: receipt.commandFingerprint,
      expectedRevision: receipt.expectedRevision,
      phase: "applying",
    }));
    const restarted = createProfileSession({ machineRoot: root });
    const refused = restarted.signIn({
      email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:00:00.000Z",
    });
    assert.equal(refused.state, "refused");
    if (refused.state === "refused") assert.equal(refused.code, "PROFILE_SIGN_IN_REFUSED");
    const failedVerifier = JSON.parse(readFileSync(join(root, "machine", "profile-verifiers.json"), "utf8")) as { profiles: Record<string, unknown>[] };
    assert.equal(failedVerifier.profiles[0]?.consecutiveFailures, 1);
    assert.deepEqual(failedVerifier, { ...JSON.parse(verifierText), profiles: [{ ...row, consecutiveFailures: 1 }] });
    const restored = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(restored.includes("secret-one"), false);
    assert.equal(restored.includes("secret-two"), false);
    const current = readAuthenticatedCredentialFixture(root, alex.profileId) as { record: { entries: { ucpathPassword: { value: string } } } };
    assert.equal(current.record.entries.ucpathPassword.value, "secret-one");
  });

  it("writes the supplied password again when an old command survives logout", async () => {
    const root = await temp();
    const session = createProfileSession({
      machineRoot: root,
      activity: { hasUnquiescedWork: () => false },
      backupPaths: () => [],
      loginDataPaths: () => [],
    });
    const alex = await finishProfileOnboarding(session, session.signUp({
      firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z",
    }));
    assert.equal(alex.state, "active");
    if (alex.state !== "active") return;
    const wiped = session.logOut(alex.token, { at: "2026-09-06T12:05:00.000Z" });
    assert.equal(wiped.state, "wiped");
    const credentialText = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(credentialText.includes("secret-one"), false);
    const document: unknown = readAuthenticatedCredentialFixture(root, alex.profileId);
    if (typeof document !== "object" || document === null || !("history" in document) || !Array.isArray(document.history)) {
      throw new Error("credential history is missing");
    }
    const entry: unknown = document.history[0];
    if (typeof entry !== "object" || entry === null || !("receipt" in entry) || typeof entry.receipt !== "object" || entry.receipt === null
      || !("commandId" in entry.receipt) || typeof entry.receipt.commandId !== "string") {
      throw new Error("credential receipt is missing");
    }
    const machine = machineAdmissions.get(root); assert.ok(machine);
    machine.publishProfileOperation(SignUpOperationSchema.parse({
      schemaVersion: 1,
      kind: "sign-up",
      operationId: "13131313-1313-4131-8131-131313131313",
      profileId: alex.profileId,
      commandId: entry.receipt.commandId,
      writeId: "14141414-1414-4141-8141-141414141414",
      emailKey: "d".repeat(64),
      firstName: "Alex",
      lastName: "Rivera",
      createdAt: "2026-09-06T12:06:00.000Z",
      commandFingerprint: "e".repeat(64),
      expectedRevision: 1,
      phase: "applying",
    }));
    const again = session.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:07:00.000Z" });
    assert.equal(again.state, "active");
    const restored = readFileSync(join(root, "profiles", alex.profileId, "credentials", "protected.json"), "utf8");
    assert.equal(restored.includes("secret-one"), false);
    const current = readAuthenticatedCredentialFixture(root, alex.profileId) as { record: { entries: { ucpathPassword: { value: string } } } };
    assert.equal(current.record.entries.ucpathPassword.value, "secret-one");
    const registry = JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: { profileId: string; credentialState: string }[] };
    assert.equal(registry.profiles.find((row) => row.profileId === alex.profileId)?.credentialState, "saved");
  });
});


describe("durable profile authority regressions", () => {
  const fields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };
  const at = "2026-09-06T12:07:00.000Z";
  it("advances activation after restart and revokes the independent old instance", async () => {
    const root = await temp();
    const first = createProfileSession({ machineRoot: root });
    const a = await finishProfileOnboarding(first, first.signUp(fields));
    assert.equal(a.state, "active"); if (a.state !== "active") return;
    writeFileSync(join(root, "profiles", a.profileId, "note.txt"), "fixture", { mode: 0o600 });
    const restarted = createProfileSession({ machineRoot: root });
    const b = restarted.signIn({ ...fields, at });
    assert.equal(b.state, "active"); if (b.state !== "active") return;
    assert.ok(b.epoch > a.epoch);
    const stale = first.readFile(a.token, "note.txt");
    assert.equal("state" in stale && stale.state, "refused");
    assert.ok(restarted.readFile(b.token, "note.txt") instanceof Uint8Array);
  });
  it("refuses a second sign-up before publishing credentials or selection", async () => {
    const root = await temp();
    const first = createProfileSession({ machineRoot: root });
    assert.equal((await finishProfileOnboarding(first, first.signUp(fields))).state, "active");
    const second = createProfileSession({ machineRoot: root });
    assert.equal((await finishProfileOnboarding(second, second.signUp({ ...fields, firstName: "Sam", email: "sam@ucsd.edu" }))).state, "refused");
    const registry = JSON.parse(readFileSync(join(root, "machine", "profiles.json"), "utf8")) as { profiles: unknown[] };
    assert.equal(registry.profiles.length, 1);
  });
  it("revokes an independent token before cancellation callback or erasure", async () => {
    const root = await temp();
    const first = createProfileSession({ machineRoot: root });
    const a = await finishProfileOnboarding(first, first.signUp(fields));
    assert.equal(a.state, "active"); if (a.state !== "active") return;
    writeFileSync(join(root, "profiles", a.profileId, "note.txt"), "fixture", { mode: 0o600 });
    let currentToken = "";
    const second = createProfileSession({ machineRoot: root, activity: {
      hasUnquiescedWork: () => true,
      requestCancellation: () => {
        const local = second.readFile(currentToken, "note.txt");
        assert.equal("state" in local && local.state, "refused");
        const stale = first.readFile(a.token, "note.txt");
        assert.equal("state" in stale && stale.state, "refused");
      },
    } });
    const b = second.signIn({ ...fields, at });
    assert.equal(b.state, "active"); if (b.state !== "active") return;
    currentToken = b.token;
    assert.equal(second.logOut(b.token, { at }).state, "cancelling");
    const stale = second.readFile(b.token, "note.txt");
    assert.equal("state" in stale && stale.state, "refused");
  });
});


it("captures and freshly revalidates each independent authority constituent on the same admitted setup", async () => {
  const root = await temp();
  const issuedChildren: RuntimeAdmission[] = [];
  let account: ChatGptAccountAuthority = { revision: 1, attemptGeneration: 0, availability: "available" };
  const record = initialSettingsFileRecord();
  let settings: SettingsRuntimeSnapshot = { record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, "a".repeat(64)) } };
  const session = createProfileSession({ machineRoot: root, activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [],
    account: { readAuthority: async child => { assert.ok(child); issuedChildren.push(child); return { ...account }; }, revalidateAuthority: captured => JSON.stringify(captured) === JSON.stringify(account) },
    settings: { read: () => structuredClone(settings) },
  });
  const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") return;
  let captured = await session.readCurrentAuthority(active.token);
  assert.equal(captured.state, "available"); if (captured.state !== "available") return;
  assert.equal((await session.revalidateAuthority(active.token, captured.snapshot)).state, "available");
  assert.equal((await session.revalidateAuthority(active.token, { ...captured.snapshot })).state, "refused");
  const mutations = [
    () => { account = { ...account, revision: 2 }; },
    () => { account = { ...account, attemptGeneration: 1 }; },
    () => { settings = { ...settings, record: { ...settings.record, revision: PositiveIntSchema.parse(2) } }; },
    () => { settings = { ...settings, record: { ...settings.record, settingsFingerprint: FingerprintSchema.parse("b".repeat(64)) } }; },
    ...["settingsRevision", "settingsFingerprint", "configFingerprint"].map(key => () => {
      assert.equal(settings.runtimeStatus.state, "current"); if (settings.runtimeStatus.state !== "current") return;
      settings = { ...settings, runtimeStatus: { state: "current", identity: { ...settings.runtimeStatus.identity, [key]: key === "settingsRevision" ? 2 : "c".repeat(64) } } };
    }),
    () => {
      const machine = machineAdmissions.get(root); assert.ok(machine);
      const child = machine.admitProfile(createProfileRegistry(machine).storageClaim(active.profileId));
      const store = createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalPath: join(root, "machine", "erasures", `${active.profileId}.json`), erasureJournalAdmission: machine });
      assert.equal(store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: "23232323-2323-4323-8323-232323232323", writeId: "24242424-2424-4424-8424-242424242424", commandFingerprint: "d".repeat(64), expectedRevision: store.read().revision,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: "2026-09-06T12:02:00.000Z", entries: { timekeeperName: { set: "ZZ" } } })).state, "applied");
    },
  ];
  for (const mutate of mutations) {
    const prior: Awaited<ReturnType<typeof session.readCurrentAuthority>> = captured; assert.equal(prior.state, "available"); if (prior.state !== "available") return;
    mutate();
    assert.equal((await session.revalidateAuthority(active.token, prior.snapshot)).state, "refused");
    captured = await session.readCurrentAuthority(active.token);
    assert.equal(captured.state, "available"); if (captured.state !== "available") return;
    assert.equal((await session.revalidateAuthority(active.token, captured.snapshot)).state, "available");
  }
  assert.equal(captured.state, "available"); if (captured.state !== "available") return;
  account = { ...account, availability: "signed-out" };
  assert.equal((await session.revalidateAuthority(active.token, captured.snapshot)).state, "refused");
  assert.equal((await session.readCurrentAuthority(active.token)).state, "refused");
  account = { ...account, availability: "available" };
  const fresh = await session.readCurrentAuthority(active.token); assert.equal(fresh.state, "available");
  const priorChild = issuedChildren.at(-1); assert.ok(priorChild);
  priorChild.assertProfileRuntime();
  const next = session.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:04:00.000Z" });
  assert.equal(next.state, "active"); if (next.state !== "active") return;
  assert.ok(next.epoch > active.epoch);
  assert.throws(() => priorChild.assertProfileRuntime(), /released admission/);
  assert.equal(machineAdmissions.get(root)?.readProfileRegistry().sessionGeneration, next.epoch);
  assert.equal((await session.readCurrentAuthority(active.token)).state, "refused");
  assert.equal((await session.readCurrentAuthority(next.token)).state, "available");
  const currentChild = issuedChildren.at(-1); assert.ok(currentChild);
  assert.notEqual(currentChild, priorChild);
  currentChild.assertProfileRuntime();
  assert.equal(currentChild.profileBinding.profileId, next.profileId);
});

it("rechecks profile revocation and settings changes across account awaits", async () => {
  const root = await temp();
  let settle!: () => void;
  let gate = Promise.resolve();
  const account: ChatGptAccountAuthority = { revision: 1, attemptGeneration: 0, availability: "available" };
  const record = initialSettingsFileRecord();
  let settings: SettingsRuntimeSnapshot = { record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, "a".repeat(64)) } };
  const session = createProfileSession({ machineRoot: root, settings: { read: () => structuredClone(settings) },
    account: { readAuthority: async () => { await gate; return account; }, revalidateAuthority: () => true },
    activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [],
  });
  const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") return;
  assert.equal((await session.readCurrentAuthority(active.token)).state, "available");
  gate = new Promise<void>(resolve => { settle = resolve; });
  const reading = session.readCurrentAuthority(active.token);
  settings = { ...settings, record: { ...record, revision: PositiveIntSchema.parse(2) } };
  settle(); assert.equal((await reading).state, "refused");
  assert.equal((await session.readCurrentAuthority(active.token)).state, "available");
  gate = new Promise<void>(resolve => { settle = resolve; });
  const revoking = session.readCurrentAuthority(active.token);
  assert.equal(session.logOut(active.token, { at: "2026-09-06T12:06:00.000Z" }).state, "wiped");
  settle(); assert.equal((await revoking).state, "refused");
});

it("refuses missing or corrupt established selection and foreign or released admissions", async () => {
  const root = await temp();
  const admission = machineAdmissions.get(root); assert.ok(admission);
  const foreign = await temp(), foreignAdmission = machineAdmissions.get(foreign); assert.ok(foreignAdmission);
  assert.throws(() => realCreateProfileSession({ machineRoot: root, admission: foreignAdmission }));
  const session = createProfileSession({ machineRoot: root });
  const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") return;
  const path = join(root, "machine", "profiles.json");
  const current = readFileSync(path);
  rmSync(path);
  const missing = session.readFile(active.token, "absent");
  assert.equal("state" in missing && missing.state, "refused");
  assert.throws(() => createProfileSession({ machineRoot: root }), /profile registry authority is unavailable/);
  writeFileSync(path, "{}", { mode: 0o600 });
  const corrupt = session.readFile(active.token, "absent");
  assert.equal("state" in corrupt && corrupt.state, "refused");
  writeFileSync(path, current, { mode: 0o600 });
  admission.release();
  assert.throws(() => realCreateProfileSession({ machineRoot: root, admission }), /released admission/);
});


it("allocates distinct durable activation generations under cross-process exclusion", async () => {
  const root = await temp();
  const session = createProfileSession({ machineRoot: root });
  const fields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };
  const first = await finishProfileOnboarding(session, session.signUp(fields)); assert.equal(first.state, "active"); if (first.state !== "active") return;
  const phases = ["admit", "session-create", "activate", "close"] as const;
  const errorNames = ["Error", "TypeError", "RangeError", "AggregateError", "ZodError", "ProfileRegistryAuthorityError",
    "ProfileSessionRefusedError", "CredentialStoreCommitUncertainError", "CredentialKeyCustodyError",
    "PrivateFileLockUnavailableError", "RuntimeLifetimeLockReleasedError", "AuthoritySourceClosureUnprovedError", "unclassified"] as const;
  const reasons = ["profile-registry-publication-busy", "profile-registry-observation-changed", "profile-registry-continuity-mismatch",
    "profile-storage-claim-unavailable", "profile-storage-claim-changed", "unclassified"] as const;
  const codeSchema = z.string().refine(value => value === "unclassified" || Object.hasOwn(ERROR_CATALOG, value));
  const causeSchema = z.strictObject({ name: z.enum(errorNames), code: codeSchema, reason: z.enum(reasons) });
  const diagnosticSchema = z.strictObject({ state: z.literal("diagnostic"), phase: z.enum(phases),
    causes: z.array(causeSchema).min(1).max(6), cleanup: z.array(causeSchema).min(1).max(6).optional() });
  const source = `
    import { createProfileSession } from ${JSON.stringify(new URL("../../../src/backend/profiles/profile-session.ts", import.meta.url).href)};
    import { acquireSharedRuntimeAdmission } from ${JSON.stringify(new URL("../../../src/backend/storage/admission/admission.ts", import.meta.url).href)};
    import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(new URL("../../../src/backend/storage/admission/lifetime-lock.ts", import.meta.url).href)};
    import { resolve } from 'node:path';
    const { createInterface } = await import('node:readline');
    const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    const firstLine = await lines.next();
    const { root, fields } = JSON.parse(firstLine.value);
    const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
    const errorNames = ${JSON.stringify(errorNames)}, codes = ${JSON.stringify(Object.keys(ERROR_CATALOG))}, reasons = ${JSON.stringify(reasons)};
    const describe = error => {
      const causes = [];
      let current = error;
      for (let depth = 0; depth < 6; depth++) {
        causes.push({ name: current instanceof Error && errorNames.includes(current.name) ? current.name : 'unclassified',
          code: current instanceof Error && codes.includes(current.code) ? current.code : 'unclassified',
          reason: current instanceof Error ? reasons.find(value => current.message.includes(value)) ?? 'unclassified' : 'unclassified' });
        if (!(current instanceof Error) || current.cause === undefined) break;
        current = current.cause;
      }
      return causes;
    };
    let admission, session, output, diagnostic, phase = 'admit';
    try {
      admission = acquireSharedRuntimeAdmission(resolve(root, "../.."), lifetime);
      phase = 'session-create';
      session = createProfileSession({ machineRoot: root, admission });
      process.stdout.write('ready\\n');
      const activation = await lines.next();
      if (activation.value !== 'activate') throw new Error('activation-barrier-invalid');
      phase = 'activate';
      const signed = session.signIn({ ...fields, at: '2026-09-06T12:03:00.000Z' });
      output = { state: signed.state, ...(signed.state === 'active' ? { epoch: signed.epoch } : {}) };
    } catch (error) {
      diagnostic = { state: 'diagnostic', phase, causes: describe(error) };
      process.exitCode = 1;
    } finally {
      try { await session?.closeOnboarding(); session?.close(); admission?.release(); await lifetime.close(); process.stdin.destroy(); process.disconnect(); }
      catch (error) {
        if (diagnostic === undefined) diagnostic = { state: 'diagnostic', phase: 'close', causes: describe(error) };
        else diagnostic.cleanup = describe(error);
        process.exitCode = 1;
      }
      process.stdout.write(JSON.stringify(diagnostic ?? output));
    }
  `;
  const controller = machineAdmissions.get(root);
  assert.ok(controller);
  const lifetime = controller.lifetime;
  if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("fixture-root-lifetime-required");
  const activate = () => {
    let readyResolve: (() => void) | undefined, readyReject: ((error: Error) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, String(lifetime.port)], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
    const input = child.stdin;
    assert.ok(input && child.stdout && child.stderr);
    let stdout = "";
    child.stdout.on("data", bytes => {
      stdout += String(bytes);
      if (stdout.startsWith("ready\n")) { stdout = stdout.slice(6); readyResolve?.(); }
    });
    child.stderr.resume();
    const result = new Promise<number>((resolve, reject) => {
      child.once("error", error => { readyReject?.(error); reject(error); });
      child.once("close", code => {
        try {
          if (code !== 0) {
            const diagnostic = diagnosticSchema.parse(JSON.parse(stdout));
            throw new Error(`profile activation diagnostic: ${JSON.stringify(diagnostic)}`);
          }
          assert.equal(code, 0);
          resolve(z.strictObject({ state: z.literal("active"), epoch: z.number().int().positive() }).parse(JSON.parse(stdout)).epoch);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error("profile activation worker failed");
          readyReject?.(failure); reject(failure);
        }
      });
    });
    input.write(`${JSON.stringify({ root, fields })}\n`);
    void (async () => { await lifetime.share(child); })().catch(error => {
      child.kill("SIGKILL"); readyReject?.(error instanceof Error ? error : new Error("fixture lifetime transfer failed", { cause: error }));
    });
    void result.catch(() => undefined);
    return { ready, result, go: () => input.end("activate\n") };
  };
  const firstChild = activate();
  await firstChild.ready;
  const secondChild = activate();
  await secondChild.ready;
  const children = [firstChild, secondChild];
  for (const child of children) child.go();
  const epochs = await Promise.all(children.map(child => child.result));
  assert.deepEqual(epochs.sort((a, b) => a - b), [first.epoch + 1, first.epoch + 2]);
  const stale = session.readFile(first.token, "absent"); assert.equal("state" in stale && stale.state, "refused");
});


it("quarantines a version-one registry and refuses missing established version evidence", async () => {
  const root = await temp();
  mkdirSync(join(root, "machine"), { mode: 0o700, recursive: true });
  const path = join(root, "machine", "profiles.json");
  const session = createProfileSession({ machineRoot: root });
  const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") return;
  const current = readFileSync(path);
  const rows = (JSON.parse(current.toString()) as { profiles: unknown[] }).profiles;
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, profiles: rows }), { mode: 0o600 });
  assert.throws(() => createProfileSession({ machineRoot: root }), /profile registry authority is unavailable/);
  const stale = session.readFile(active.token, "absent"); assert.equal("state" in stale && stale.state, "refused");
  writeFileSync(path, current, { mode: 0o600 });
  rmSync(join(root, "machine", "profile-registry-version.json"));
  assert.throws(() => createProfileSession({ machineRoot: root }), /profile registry authority is unavailable/);
});


it("keeps authority unavailable without account and Settings sources", async () => {
  const session = createProfileSession({ machineRoot: await temp() });
  assert.equal((await session.readCurrentAuthority("unissued")).state, "refused");
  const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") return;
  const source = await session.readCurrentAuthority(active.token);
  assert.equal(source.state, "refused"); if (source.state === "refused") assert.equal(source.code, "PROFILE_AUTHORITY_UNAVAILABLE");
});


it("joins the real token-free account source with the exact admitted profile root without OAuth", async () => {
  const root = await temp();
  const record = initialSettingsFileRecord();
  const settings: SettingsRuntimeSnapshot = { record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, "a".repeat(64)) } };
  const session = createProfileSession({ machineRoot: root, settings: { read: () => settings }, account: {
    readAuthority: admission => account.readAuthority(admission),
    revalidateAuthority: (captured, admission) => account.revalidateAuthority(captured, admission),
  } });
  const active = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(active.state, "active"); if (active.state !== "active") return;
  const stateRoot = join(root, "profiles", active.profileId);
  const machine = machineAdmissions.get(root); assert.ok(machine);
  const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(active.profileId));
  let calls = 0;
  const clock = manualClock(new Date("2026-09-06T12:00:00.000Z"));
  const account = createChatGptAccountService({ admission, stateRoot, clock, fetch: async () => { calls++; throw new Error("unexpected transport"); } });
  try {
    const repository = createChatGptCredentialRepository({ admission, stateRoot });
    await repository.withLock(async transaction => transaction.replace({ schemaVersion: 1, revision: 1,
      hostId: "urn:uuid:11111111-1111-4111-8111-111111111111", clientId: "oaiapp_fixture",
      registration: { subject: "fixture", name: "Fixture", email: "fixture@ucsd.edu" },
      session: { accessToken: "fixture-access", refreshToken: null, idToken: "fixture-id", expiresAt: IsoInstantSchema.parse("2026-09-06T13:00:00.000Z"),
        earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
    }, null));
    const captured = await session.readCurrentAuthority(active.token);
    assert.equal(captured.state, "available"); if (captured.state !== "available") return;
    assert.equal((await session.revalidateAuthority(active.token, captured.snapshot)).state, "available");
    await account.close();
    assert.equal((await session.revalidateAuthority(active.token, captured.snapshot)).state, "refused");
    assert.equal(calls, 0);
  } finally { await account.close(); admission.release(); }
});


it("checks independently changed durable selection, generation and lifecycle before file preparation", async () => {
  const root = await temp();
  const session = createProfileSession({ machineRoot: root });
  const fields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };
  assert.equal((await finishProfileOnboarding(session, session.signUp(fields))).state, "active");
  const mutations: ((document: ProfileRegistryDocument) => ProfileRegistryDocument)[] = [
    document => ({ ...document, activeProfileId: null }),
    document => ({ ...document, sessionGeneration: document.sessionGeneration + 1 }),
    document => ({ ...document, profiles: document.profiles.map(row => ({ ...row, lifecycle: "cancelling" })) }),
  ];
  for (const mutate of mutations) {
    const active = session.signIn({ ...fields, at: "2026-09-06T12:02:00.000Z" });
    assert.equal(active.state, "active"); if (active.state !== "active") return;
    const path = join(root, "machine", "profiles.json"), before = readFileSync(path);
    const protectedPath = join(root, "profiles", active.profileId, "credentials", "protected.json");
    const credentials = readFileSync(protectedPath);
    const machine = machineAdmissions.get(root); assert.ok(machine);
    const prior = ProfileRegistryDocumentSchema.parse(JSON.parse(before.toString()));
    machine.publishProfileRegistry(prior, mutate(prior));
    const stale = session.readFile(active.token, "absent");
    assert.equal("state" in stale && stale.state === "refused" && stale.code, "PROFILE_SESSION_STALE");
    assert.deepEqual(readFileSync(protectedPath), credentials);
    const changed = machine.readProfileRegistry();
    machine.publishProfileRegistry(changed, { ...prior, sessionGeneration: changed.sessionGeneration });
  }
});

async function readIsolationFixture() {
  const root = await temp();
  const session = createProfileSession({ machineRoot: root, activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
  const a = await finishProfileOnboarding(session, session.signUp({ firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" }));
  assert.equal(a.state, "active"); assert.ok(a.state === "active");
  assert.equal(session.logOut(a.token, { at: "2026-09-06T12:01:00.000Z" }).state, "wiped");
  const b = await finishProfileOnboarding(session, session.signUp({ firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-two", createdAt: "2026-09-06T12:02:00.000Z" }));
  assert.equal(b.state, "active"); assert.ok(b.state === "active");
  const sibling = join(root, "profiles", b.profileId), marker = randomBytes(32);
  writeFileSync(join(sibling, "note.bin"), marker, { mode: 0o600 });
  assert.equal(session.logOut(b.token, { at: "2026-09-06T12:03:00.000Z" }).state, "wiped");
  const active = session.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:04:00.000Z" });
  assert.equal(active.state, "active"); assert.ok(active.state === "active");
  const profile = join(root, "profiles", a.profileId), directory = join(profile, "notes"), own = randomBytes(32);
  mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, "note.bin"); writeFileSync(path, own, { mode: 0o600 });
  const positive = session.readFile(active.token, "notes/note.bin");
  assert.equal(positive instanceof Uint8Array && Buffer.from(positive).equals(own), true);
  assert.throws(() => session.readFile(active.token, join("..", b.profileId, "note.bin")));
  assert.equal(readFileSync(join(sibling, "note.bin")).equals(marker), true);
  return { root, session, active, profile, directory, path, sibling, own };
}

it.each(["sibling-directory", "same-profile-directory", "final-file"])("R3 profile read refuses %s symlinks after valid A/B lifecycle", async kind => {
  const f = await readIsolationFixture();
  const link = join(f.profile, "linked");
  symlinkSync(kind === "final-file" ? join(f.sibling, "note.bin") : kind === "sibling-directory" ? f.sibling : f.directory, link);
  assert.throws(() => f.session.readFile(f.active.token, kind === "final-file" ? "linked" : "linked/note.bin"), { message: "profile file read refused" });
});

it.each(["ancestor-before-open", "file-before-open", "ancestor-during-read", "file-during-read", "misbound-open"])("R3 profile read refuses %s before publishing bytes and closes its descriptor", async kind => {
  const f = await readIsolationFixture();
  const realLstat = fs.lstatSync, realOpen = fs.openSync, realRead = fs.readFileSync;
  let changed = false, descriptor: number | undefined;
  const replace = () => {
    changed = true;
    if (kind.startsWith("ancestor")) {
      renameSync(f.directory, `${f.directory}-held`);
      mkdirSync(f.directory, { mode: 0o700 });
    } else renameSync(f.path, `${f.path}-held`);
    writeFileSync(f.path, f.own, { mode: 0o600 });
  };
  vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    const status = realLstat(path, options);
    if (path === f.path && !changed && kind.endsWith("before-open")) replace();
    return status;
  });
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (path === f.path) {
      if (kind === "misbound-open") { changed = true; descriptor = realOpen(join(f.sibling, "note.bin"), flags, mode); }
      else descriptor = realOpen(path, flags, mode);
      return descriptor;
    }
    return realOpen(path, flags, mode);
  });
  vi.spyOn(fs, "readFileSync").mockImplementation((path, options) => {
    if (path === descriptor && !changed && kind.endsWith("during-read")) replace();
    return realRead(path, options);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => f.session.readFile(f.active.token, "notes/note.bin"), { message: "profile file read refused" });
    assert.equal(changed, true);
    const closedDescriptor = descriptor;
    if (closedDescriptor !== undefined) assert.throws(() => fs.fstatSync(closedDescriptor), { code: "EBADF" });
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
  assert.equal(existsSync(join(f.root, "machine", ".profile-ops.lock")), false);
});

it("rechecks a registry proof after another async context publishes", async () => {
  const f = await createBoundProfileFixture();
  try {
    const profileId = f.admission.profileBinding.profileId;
    const registry = createProfileRegistry(f.machine);
    let entered: () => void = () => undefined, resume: () => void = () => undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    const at = "2026-10-30T12:00:00.000Z";
    const reader = withOperationProof(async () => {
      assert.notEqual(registry.read().profiles.find(row => row.profileId === profileId)?.lastSignedInAt, at);
      entered();
      await held;
      assert.equal(registry.read().profiles.find(row => row.profileId === profileId)?.lastSignedInAt, at);
    });
    const writer = (async () => {
      await started;
      try { registry.update(profileId, { lastSignedInAt: at }); }
      finally { resume(); }
    })();
    await Promise.all([reader, writer]);
  } finally { await f.close(); }
});
