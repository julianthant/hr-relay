import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { AuthoritySourceClosureUnprovedError, createBrowserSourceRecovery } from "../../../src/backend/storage/source-closure.js";
import { ProfileVerifierDocumentSchema } from "../../../src/models/profiles/profile.js";
import { createProfileSessionWorld, signUpWithLegacyOperation } from "../../support/helpers/backend/profile-session-world.js";
import { finishProfileOnboarding } from "../../support/helpers/admission-fixture.js";
import { findProfileFixtureAdmission, findProfileFixtureInWorkspace } from "../../support/helpers/synthetic-database-admission.js";

const worlds: Awaited<ReturnType<typeof createProfileSessionWorld>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const world of worlds.splice(0)) await world.close(); });
async function world() { const created = await createProfileSessionWorld(); worlds.push(created); return created; }
const alexFields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };
const samFields = { firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-sam", createdAt: "2026-09-06T11:00:00.000Z" };

function inject(mode: "before" | "flush" | "flush-unread" | "close" | "close-unread" | "entries-flush" | "entries-flush-unowned" | "lock-flush" | "lock-close"): { leaked: number[] } {
  const rename = fs.renameSync, open = fs.openSync, flush = fs.fsyncSync, close = fs.closeSync, unlink = fs.unlinkSync, leaked: number[] = [];
  let failFlush = false, failClose = false, failRead = false, failNextOpen = false;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    const target = String(to);
    if (target.endsWith("profile-verifiers.json") && (mode === "before" || mode === "flush" || mode === "flush-unread" || mode === "close" || mode === "close-unread")) {
      if (mode === "before") throw new Error("injected replacement failure");
      rename(from, to); failFlush = mode === "flush" || mode === "flush-unread"; failClose = mode === "close" || mode === "close-unread"; return;
    }
    rename(from, to);
    if ((mode === "entries-flush" || mode === "entries-flush-unowned") && target.endsWith("/credentials/protected.json")) failFlush = true;
  });
  vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
    if (failFlush) { failFlush = false; failRead = mode === "flush-unread"; failNextOpen = mode === "entries-flush-unowned"; throw new Error("injected flush failure"); }
    flush(descriptor);
  });
  vi.spyOn(fs, "closeSync").mockImplementation(descriptor => {
    if (failClose) { failClose = false; failRead = mode === "close-unread"; leaked.push(descriptor); throw new Error("injected close failure"); }
    close(descriptor);
  });
  vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
    unlink(path);
    if (String(path).endsWith(".profile-ops.lock")) { failFlush = mode === "lock-flush"; failClose = mode === "lock-close"; }
  });
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (failRead && String(path).endsWith("profile-verifiers.json")) { failRead = false; throw new Error("injected readback failure"); }
    if (failNextOpen && String(path).includes("/credentials/")) { failNextOpen = false; throw new Error("injected ownership readback failure"); }
    // Verifier reads go through a descriptor, so the read-back fault is injected at its open.
    if (failRead && String(path).endsWith("profile-verifiers.json")) { failRead = false; throw new Error("injected readback failure"); }
    return open(path, flags, mode);
  });
  syncBuiltinESMExports();
  return { leaked };
}
function unclosedSource(error: unknown): AuthoritySourceClosureUnprovedError | undefined {
  const pending = [error];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (value instanceof AuthoritySourceClosureUnprovedError) return value;
    if (value instanceof AggregateError) pending.push(...(value.errors as unknown[]));
    if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
  }
  return undefined;
}
function restoreFiles(): void { vi.restoreAllMocks(); syncBuiltinESMExports(); }
function refusalCode(result: { state: string; code?: string }) { return result.state === "refused" ? result.code : result.state; }

// Stop after publication but before the first successful upgrade, leaving the old registry row intact.
async function unupgraded(machine: Awaited<ReturnType<typeof world>>, fields = alexFields) {
  const session = machine.open();
  const draft = signUpWithLegacyOperation(machine.machineRoot, session, fields);
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to).endsWith("/profile-publication.json") && fs.readFileSync(from, "utf8").includes('"relayEmail"')) {
      throw new Error("fixture withholds registry upgrade");
    }
    rename(from, to);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(finishProfileOnboarding(session, draft), /fixture withholds registry upgrade/u); }
  finally { restoreFiles(); }
  const registry = createProfileRegistry(machine.machine);
  const [row] = registry.read().profiles;
  assert.ok(row);
  assert.equal(row.relayEmail, undefined);
  assert.equal(registry.read().activeProfileId, null);
  registry.advanceSession(row.profileId);
  return row.profileId;
}

function stoppedLoginWrite(machine: Awaited<ReturnType<typeof world>>, profileId: string, email: string, password: string) {
  const owner = machine.machine.admitProfile(profileId);
  try {
    const store = createCredentialStore({ admission: owner, stateRoot: owner.stateRoot });
    const result = store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(),
      commandFingerprint: createHash("sha256").update("relay-login-change").digest("hex"),
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, expectedRevision: store.read().revision, updatedAt: "2026-09-06T11:00:00.000Z",
      entries: { ucpathUserId: { set: email }, ucpathPassword: { set: password } } }));
    assert.equal(result.state, "applied");
  } finally { owner.release(); }
}

describe("Relay login change", () => {
  it("changes the password only with the current password, and only the new password signs in after a restart", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);

    const protectedBefore = machine.credentialBytes(alex.profileId);
    const wrong = session.changePassword(alex.token, { currentPassword: "not-the-password", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    assert.deepEqual([wrong.state, wrong.state === "refused" && wrong.code], ["refused", "PROFILE_CURRENT_PASSWORD_REFUSED"]);
    assert.equal(machine.savedLogin(alex.profileId).password, "secret-one");

    const changed = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:02:00.000Z" });
    assert.equal(changed.state, "changed");
    assert.deepEqual(machine.credentialBytes(alex.profileId), protectedBefore);

    const restarted = machine.open();
    const old = restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" });
    assert.deepEqual([old.state, old.state === "refused" && old.code], ["refused", "PROFILE_SIGN_IN_REFUSED"]);
    const fresh = restarted.signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:04:00.000Z" });
    assert.equal(fresh.state, "active");
    if (fresh.state === "active") assert.equal(fresh.profileId, alex.profileId);
  });

  it("changes the username to a free one, refuses a taken one, and leaves the other profile on the machine untouched", async () => {
    const machine = await world();
    const session = machine.open();
    const sam = await machine.signUp(session, samFields);
    assert.equal((await machine.logOut(session, sam.token, "2026-09-06T11:30:00.000Z")).state, "signed-out");
    const samLogin = machine.credentialBytes(sam.profileId);
    const samRow = () => ProfileVerifierDocumentSchema.parse(JSON.parse(machine.verifierBytes())).profiles.find(row => row.profileId === sam.profileId);
    const samBefore = samRow();
    const alex = await machine.signUp(session, alexFields);

    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "Sam@ucsd.edu", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_USERNAME_TAKEN");
    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "wrong", newUsername: "alex.rivera@ucsd.edu", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_CURRENT_PASSWORD_REFUSED");
    assert.equal(machine.savedLogin(alex.profileId).userId, "alex@ucsd.edu");
    assert.equal(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "alex.rivera@ucsd.edu", at: "2026-09-06T12:03:00.000Z" }).state, "changed");
    const saved = machine.savedLogin(alex.profileId);
    assert.equal(saved.userId, alexFields.email);
    assert.equal(saved.password, alexFields.password);
    assert.deepEqual(machine.credentialBytes(sam.profileId), samLogin);
    assert.deepEqual(samRow(), samBefore);

    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:04:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    const fresh = restarted.signIn({ email: "alex.rivera@ucsd.edu", password: "secret-one", at: "2026-09-06T12:05:00.000Z" });
    assert.equal(fresh.state, "active");
    if (fresh.state === "active") assert.equal(fresh.profileId, alex.profileId);
  });

  it("refuses a change from a token that is no longer the signed-in session", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const restarted = machine.open();
    assert.equal(restarted.resumeSignedInProfile({ at: "2026-09-06T12:01:00.000Z" }).state, "active");
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SESSION_STALE");
    assert.equal(machine.savedLogin(alex.profileId).password, "secret-one");
  });

  it("keeps the old login when the change fails before its verifier commit", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const verifiers = machine.verifierBytes();
    inject("before");
    assert.throws(() => session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" }), /injected replacement failure/u);
    restoreFiles();
    assert.equal(machine.verifierBytes(), verifiers);
    assert.equal(machine.savedLogin(alex.profileId).password, "secret-one");
    const restarted = machine.open();
    assert.equal(restarted.resumeSignedInProfile({ at: "2026-09-06T12:02:00.000Z" }).state, "active");
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:03:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:04:00.000Z" }).state, "active");
  });

  it.each([
    ["password", " alex@ucsd.edu ", "secret-two"],
    ["username", "alex.rivera@ucsd.edu", "secret-one"],
  ])("repairs a stopped legacy %s change only at a proved old sign-in", async (_kind, email, password) => {
    const machine = await world();
    const prior = { ...alexFields, email: " alex@ucsd.edu " };
    const profileId = await unupgraded(machine, prior);
    stoppedLoginWrite(machine, profileId, email, password);
    machine.saveInSettings(profileId, { sharepointOnboardingRosterUrl: { set: "https://example.test/roster" } });
    const session = machine.open();
    const at = "2026-09-06T12:04:00.000Z";
    assert.equal(refusalCode(session.resumeSignedInProfile({ at })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.equal(refusalCode(session.signIn({ email, password, at })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, undefined);
    const old = session.signIn({ email: prior.email, password: prior.password, at });
    assert.ok(old.state === "active");
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, prior.email);
    assert.deepEqual(machine.savedLogin(profileId), { userId: prior.email, password: prior.password });
    const before = machine.credentialBytes(profileId);
    assert.equal(session.changePassword(old.token, { currentPassword: prior.password, newPassword: "relay-only", at }).state, "changed");
    assert.deepEqual(machine.credentialBytes(profileId), before);
    assert.equal(machine.open().signIn({ email: prior.email, password: "relay-only", at }).state, "active");
    assert.deepEqual(machine.credentialBytes(profileId), before);
  });

  it("refuses an unmarked legacy mismatch without repairing a Settings edit", async () => {
    const machine = await world(), profileId = await unupgraded(machine);
    machine.saveInSettings(profileId, { ucpathPassword: { set: "settings-only" } });
    const session = machine.open(), at = alexFields.createdAt;
    const before = machine.credentialBytes(profileId);
    assert.equal(refusalCode(session.signIn({ ...alexFields, at })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.equal(refusalCode(session.resumeSignedInProfile({ at })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.deepEqual(machine.credentialBytes(profileId), before);
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, undefined);
  });

  it("keeps the legacy selection resumable after a missing UCPath password is restored", async () => {
    const machine = await world(), profileId = await unupgraded(machine);
    const session = machine.open(), at = alexFields.createdAt;
    machine.saveInSettings(profileId, { ucpathPassword: { clear: true } });
    assert.equal(refusalCode(session.resumeSignedInProfile({ at })), "PROFILE_AUTHORITY_UNAVAILABLE");
    const refused = machine.machine.readProfileRegistry();
    assert.equal(refused.activeProfileId, profileId);
    assert.equal(refused.profiles[0]?.relayEmail, undefined);
    machine.saveInSettings(profileId, { ucpathPassword: { set: alexFields.password } });
    const resumed = session.resumeSignedInProfile({ at });
    assert.ok(resumed.state === "active");
    assert.equal(resumed.profileId, profileId);
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, alexFields.email);
  });

  it("leaves account details untouched when the verifier cannot identify one owner", async () => {
    const machine = await world(), session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = machine.machine.readProfileRegistry();
    const path = join(machine.machineRoot, "machine", "profile-verifiers.json");
    const bytes = fs.readFileSync(path);
    const document = ProfileVerifierDocumentSchema.parse(JSON.parse(bytes.toString("utf8")));
    const [row] = document.profiles;
    assert.ok(row);
    fs.writeFileSync(path, JSON.stringify({ ...document, profiles: [row, { ...row, profileId: randomUUID() }] }));
    try { assert.throws(() => session.changeDetails(alex.token, { initials: "AXR" }), /profile email key is not unique/u); }
    finally { fs.writeFileSync(path, bytes); }
    assert.deepEqual(machine.machine.readProfileRegistry(), before);
    const retried = session.changeDetails(alex.token, { initials: "AXR" });
    assert.ok(retried.state === "changed");
    assert.equal(retried.account.initials, "AXR");
    assert.equal(retried.account.username, alexFields.email);
  });

  it("surfaces a credential read failure during legacy resume and keeps the selection resumable", async () => {
    const machine = await world(), profileId = await unupgraded(machine);
    const path = join(machine.machineRoot, "profiles", profileId, "credentials", "protected.json");
    const before = fs.readFileSync(path);
    const restarted = machine.open();
    const generationBefore = machine.machine.readProfileRegistry().sessionGeneration;
    const realOpen = fs.openSync, realRead = fs.readFileSync;
    let descriptor: number | undefined, faultedAfterActivation = false;
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      const opened = realOpen(target, flags, mode);
      if (target === path) descriptor = opened;
      return opened;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((target, options) => {
      if (target === descriptor && !faultedAfterActivation) {
        faultedAfterActivation = machine.machine.readProfileRegistry().sessionGeneration > generationBefore;
        throw new Error("injected credential read failure");
      }
      return realRead(target, options);
    });
    syncBuiltinESMExports();
    const injected = (error: unknown): boolean => error instanceof Error && (error.message === "injected credential read failure" || injected(error.cause));
    try { assert.throws(() => restarted.resumeSignedInProfile({ at: "2026-09-06T12:05:00.000Z" }), injected); }
    finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.equal(faultedAfterActivation, true);
    assert.deepEqual(fs.readFileSync(path), before);
    assert.equal(machine.machine.readProfileRegistry().activeProfileId, profileId);
    assert.equal(restarted.resumeSignedInProfile({ at: "2026-09-06T12:06:00.000Z" }).state, "active");
  });

  it("upgrades a settled legacy selection at resume without changing the protected store or verifier material", async () => {
    const machine = await world(), profileId = await unupgraded(machine);
    const before = machine.credentialBytes(profileId);
    const verifierDocument = () => ProfileVerifierDocumentSchema.parse(JSON.parse(machine.verifierBytes()));
    const beforeVerifiers = verifierDocument();
    const session = machine.open();
    assert.equal(session.resumeSignedInProfile({ at: alexFields.createdAt }).state, "active");
    assert.deepEqual(machine.credentialBytes(profileId), before);
    assert.deepEqual(verifierDocument(), beforeVerifiers);
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, alexFields.email);
  });

  it("updates only the displayed email spelling at a proved sign-in", async () => {
    const machine = await world(), session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const at = alexFields.createdAt, email = " Alex@ucsd.edu";
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, alexFields.email);
    assert.equal(session.signIn({ email, password: alexFields.password, at }, alex.token).state, "active");
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, email);
    assert.equal(machine.savedLogin(alex.profileId).userId, alexFields.email);
  });

  it("reports a change whose verifier swap landed but whose flush failed as changed with unconfirmed durability", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("flush");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    assert.deepEqual([result.state, result.state === "changed" && result.durability], ["changed", "unconfirmed"]);
    restoreFiles();
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:03:00.000Z" }).state, "active");
  });

  it("locks the change after repeated wrong current passwords, sharing the sign-in lockout", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "wrong", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_CURRENT_PASSWORD_REFUSED");
    }
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:30.000Z" })), "PROFILE_CURRENT_PASSWORD_REFUSED");
    assert.equal(machine.savedLogin(alex.profileId).password, "secret-one");
    assert.equal(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:02:01.000Z" }).state, "changed");
    assert.equal(session.changePassword(alex.token, { currentPassword: "wrong", newPassword: "secret-three", at: "2026-09-06T12:02:02.000Z" }).state, "refused");
    assert.equal(session.changePassword(alex.token, { currentPassword: "secret-two", newPassword: "secret-three", at: "2026-09-06T12:02:03.000Z" }).state, "changed");
  });

  it.each([
    ["the same address in another case", "ALEX@ucsd.edu"],
    ["spaces around the address", " alex.rivera@ucsd.edu"],
    ["an address that is not plain", "ａlex.rivera@ucsd.edu"],
    ["an address the sign-in form refuses", "alex.rivera@example.com"],
  ])("refuses a new username with %s and changes nothing", async (_name, newUsername) => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const verifiers = machine.verifierBytes();
    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername, at: "2026-09-06T12:01:00.000Z" })), "PROFILE_USERNAME_REFUSED");
    assert.equal(machine.verifierBytes(), verifiers);
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
  });

  it("reports a landed change whose directory close failed as changed and holds the machine owner until that descriptor is proved closed", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const { leaked } = inject("close");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    restoreFiles();
    assert.deepEqual([result.state, result.state === "changed" && result.durability], ["changed", "unconfirmed"]);
    const failure = result.state === "changed" ? result.failure : undefined;
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    assert.throws(() => machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:02:00.000Z" }), /authority-source-closure-unproved/u);
    const recovery = createBrowserSourceRecovery();
    recovery.retain(failure);
    await recovery.prove(() => { for (const descriptor of leaked) fs.closeSync(descriptor); return Promise.resolve(); });
    assert.equal(leaked.length, 1);
    assert.equal(machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:03:00.000Z" }).state, "active");
  });

  it("holds the unclosed descriptor when the verifier cannot be read back after a failed close, and does not undo the swap", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const verifiers = machine.verifierBytes();
    const { leaked } = inject("close-unread");
    let thrown: unknown;
    try { session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" }); }
    catch (error) { thrown = error; }
    restoreFiles();
    const failure = unclosedSource(thrown);
    assert.ok(failure, "the closure failure reaches the caller");
    assert.equal(leaked.length, 1);
    assert.throws(() => machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:02:00.000Z" }), (error: unknown) => unclosedSource(error) === failure);
    const recovery = createBrowserSourceRecovery();
    recovery.retain(failure);
    await recovery.prove(() => { for (const descriptor of leaked) fs.closeSync(descriptor); return Promise.resolve(); });
    assert.notEqual(machine.verifierBytes(), verifiers);
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
  });

  it("reports an unknown outcome when the verifier cannot be read back after a failed flush, guaranteeing neither login and undoing nothing", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("flush-unread");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    restoreFiles();
    assert.equal(result.state, "unknown");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
    assert.equal(session.changePassword(alex.token, { currentPassword: "secret-two", newPassword: "secret-three", at: "2026-09-06T12:02:00.000Z" }).state, "changed");
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-three", at: "2026-09-06T12:04:00.000Z" }).state, "active");
  });

  it.each([
    ["the username after a completed password change", "password", "ucpathUserId"],
    ["the password after a completed username change", "username", "ucpathPassword"],
  ] as const)("never recreates %s that Settings cleared", async (_name, kind, cleared) => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const at = "2026-09-06T12:01:00.000Z";
    const changed = kind === "password" ? session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at })
      : session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "alex.rivera@ucsd.edu", at });
    assert.equal(changed.state, "changed");
    machine.saveInSettings(alex.profileId, { [cleared]: { clear: true } });
    const login = kind === "password" ? { email: "alex@ucsd.edu", password: "secret-two" } : { email: "alex.rivera@ucsd.edu", password: "secret-one" };
    assert.equal(machine.open().signIn({ ...login, at: "2026-09-06T12:02:00.000Z" }).state, "active");
    const saved = machine.savedLogin(alex.profileId);
    assert.equal(cleared === "ucpathUserId" ? saved.userId : saved.password, undefined);
  });

  it("keeps a committed change and surfaces the failure when only the profile lock's release flush fails", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("lock-flush");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    restoreFiles();
    assert.equal(result.state, "changed");
    assert.match(String(result.state === "changed" && result.failure), /injected flush failure/u);
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:03:00.000Z" }).state, "active");
  });

  it("keeps a committed change and holds the machine owner when the profile lock's directory close fails", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const { leaked } = inject("lock-close");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    restoreFiles();
    assert.equal(result.state, "changed");
    const failure = unclosedSource(result.state === "changed" ? result.failure : undefined);
    assert.ok(failure, "the lock's unclosed descriptor reaches the caller");
    assert.throws(() => machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:02:00.000Z" }), (error: unknown) => unclosedSource(error) === failure);
    const recovery = createBrowserSourceRecovery();
    recovery.retain(failure);
    await recovery.prove(() => { for (const descriptor of leaked) fs.closeSync(descriptor); return Promise.resolve(); });
    assert.equal(machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:03:00.000Z" }).state, "active");
  });

  it.each(["entries-flush", "entries-flush-unowned"] as const)("refuses an unproved legacy restore after %s", async fault => {
    const machine = await world(), profileId = await unupgraded(machine);
    stoppedLoginWrite(machine, profileId, alexFields.email, "secret-two");
    const session = machine.open(), at = alexFields.createdAt;
    inject(fault);
    try { assert.throws(() => session.signIn({ ...alexFields, at }), { name: "RelayLoginRestoreUncertainError" }); }
    finally { restoreFiles(); }
    assert.equal(machine.machine.readProfileRegistry().profiles[0]?.relayEmail, undefined);
    assert.equal(session.signIn({ ...alexFields, at }).state, "active");
    assert.deepEqual(machine.savedLogin(profileId), { userId: alexFields.email, password: alexFields.password });
  });

  it("drops each bound-profile registration before its owner is released", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const root = join(machine.machineRoot, "profiles", alex.profileId);
    const saved = machine.savedLogin(alex.profileId);
    assert.equal(saved.userId, alexFields.email);
    assert.equal(saved.password, alexFields.password);
    assert.equal(findProfileFixtureAdmission(root), undefined);

    const settingsPassword = "settings-only";
    machine.saveInSettings(alex.profileId, { ucpathPassword: { set: settingsPassword } });
    assert.equal(machine.savedLogin(alex.profileId).password, settingsPassword);
    assert.equal(findProfileFixtureAdmission(root), undefined);

    assert.equal((await machine.logOut(session, alex.token, "2026-09-06T12:10:00.000Z")).state, "signed-out");
    assert.equal(findProfileFixtureAdmission(root), undefined);
    assert.equal(findProfileFixtureInWorkspace(machine.machineRoot), undefined);
  });
});
