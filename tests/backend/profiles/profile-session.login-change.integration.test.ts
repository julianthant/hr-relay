import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { AuthoritySourceClosureUnprovedError, createBrowserSourceRecovery } from "../../../src/backend/storage/source-closure.js";
import { ProfileVerifierDocumentSchema } from "../../../src/models/profiles/profile.js";
import { createProfileSessionWorld } from "../../support/helpers/backend/profile-session-world.js";
import { findProfileFixtureAdmission, findProfileFixtureInWorkspace } from "../../support/helpers/synthetic-database-admission.js";

const worlds: Awaited<ReturnType<typeof createProfileSessionWorld>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const world of worlds.splice(0)) await world.close(); });
async function world() { const created = await createProfileSessionWorld(); worlds.push(created); return created; }
const alexFields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };
const samFields = { firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-sam", createdAt: "2026-09-06T11:00:00.000Z" };

/**
 * Inject one failure into a login change. "before" fails the verifier rename; "stop" also fails every later credential open,
 * as when the process stops there; "flush" and "close" let the verifier rename land and fail its directory flush or descriptor
 * close; "entries-flush" lets the saved entries' rename land and fails their directory flush.
 */
function inject(mode: "before" | "stop" | "flush" | "flush-unread" | "close" | "close-unread" | "entries-flush" | "entries-flush-unowned" | "lock-flush" | "lock-close"): { leaked: number[] } {
  const rename = fs.renameSync, open = fs.openSync, flush = fs.fsyncSync, close = fs.closeSync, read = fs.readFileSync, unlink = fs.unlinkSync, leaked: number[] = [];
  let stopped = false, failFlush = false, failClose = false, failRead = false, failNextOpen = false;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    const target = String(to);
    if (target.endsWith("profile-verifiers.json") && (mode === "before" || mode === "stop" || mode === "flush" || mode === "flush-unread" || mode === "close" || mode === "close-unread")) {
      if (mode === "before" || mode === "stop") { stopped = mode === "stop"; throw new Error("injected replacement failure"); }
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
  vi.spyOn(fs, "readFileSync").mockImplementation(((path: fs.PathOrFileDescriptor, options?: unknown) => {
    if (failRead && String(path).endsWith("profile-verifiers.json")) { failRead = false; throw new Error("injected readback failure"); }
    return Reflect.apply(read, fs, options === undefined ? [path] : [path, options]) as unknown;
  }) as typeof fs.readFileSync);
  vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
    unlink(path);
    if (String(path).endsWith(".profile-ops.lock")) { failFlush = mode === "lock-flush"; failClose = mode === "lock-close"; }
  });
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (stopped && String(path).includes("/credentials/")) throw new Error("injected stop");
    if (failNextOpen && String(path).includes("/credentials/")) { failNextOpen = false; throw new Error("injected ownership readback failure"); }
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

describe("Relay login change", () => {
  it("changes the password only with the current password, and only the new password signs in after a restart", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);

    const wrong = session.changePassword(alex.token, { currentPassword: "not-the-password", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    assert.deepEqual([wrong.state, wrong.state === "refused" && wrong.code], ["refused", "PROFILE_CURRENT_PASSWORD_REFUSED"]);
    assert.equal(machine.savedLogin(alex.profileId).password, "secret-one");

    const changed = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:02:00.000Z" });
    assert.equal(changed.state, "changed");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });

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
    assert.equal(saved.userId, "alex.rivera@ucsd.edu");
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
    ["password", { newPassword: "secret-two" }, { email: "alex@ucsd.edu", password: "secret-two" }],
    ["username", { newUsername: "alex.rivera@ucsd.edu" }, { email: "alex.rivera@ucsd.edu", password: "secret-one" }],
  ] as const)("signs in with the old login after a %s change stopped between its two writes", async (kind, change, next) => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("stop");
    const at = "2026-09-06T12:01:00.000Z";
    const result = "newPassword" in change ? session.changePassword(alex.token, { currentPassword: "secret-one", ...change, at })
      : session.changeUsername(alex.token, { currentPassword: "secret-one", ...change, at });
    assert.equal(refusalCode(result), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    assert.deepEqual([machine.savedLogin(alex.profileId).userId, machine.savedLogin(alex.profileId).password], [next.email, next.password], kind);

    const restarted = machine.open();
    assert.equal(refusalCode(restarted.resumeSignedInProfile({ at: "2026-09-06T12:02:00.000Z" })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.equal(refusalCode(restarted.signIn({ ...next, at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    const old = restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" });
    assert.equal(old.state, "active");
    const restored = machine.savedLogin(alex.profileId);
    assert.equal(restored.userId, "alex@ucsd.edu");
    assert.equal(restored.password, alexFields.password);
    assert.equal(machine.open().resumeSignedInProfile({ at: "2026-09-06T12:04:00.000Z" }).state, "active");
  });

  it("still refuses a sign-in whose saved UCPath password was changed in Settings rather than by a login change", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    machine.saveInSettings(alex.profileId, { ucpathPassword: { set: "settings-only" } });
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:31:00.000Z" })), "PROFILE_AUTHORITY_UNAVAILABLE");
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:32:00.000Z" })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.equal(machine.savedLogin(alex.profileId).password, "settings-only");
  });

  it("keeps the saved email spelling when a sign-in after a completed change types it differently", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    assert.equal(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" }).state, "changed");
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: " Alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });
  });

  it("reports a change whose verifier swap landed but whose flush failed as changed with unconfirmed durability", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("flush");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    assert.deepEqual([result.state, result.state === "changed" && result.durability], ["changed", "unconfirmed"]);
    restoreFiles();
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });
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

  it("settles an unsettled change on the same session's next change", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("stop");
    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "alex.rivera@ucsd.edu", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    assert.equal(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:02:00.000Z" }).state, "changed");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });
    assert.equal(machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:03:00.000Z" }).state, "active");
  });

  it("never commits the verifier over saved entries whose write was not proved durable", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const verifiers = machine.verifierBytes();
    inject("entries-flush");
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    assert.equal(machine.verifierBytes(), verifiers);
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-two", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" }).state, "active");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
  });

  it("restores an interrupted password change for a username saved with surrounding spaces at sign-up", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, { ...alexFields, email: " alex@ucsd.edu " });
    inject("stop");
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    const restarted = machine.open();
    assert.equal(restarted.signIn({ email: " alex@ucsd.edu ", password: "secret-one", at: "2026-09-06T12:02:00.000Z" }).state, "active");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: " alex@ucsd.edu ", password: "secret-one" });
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

  it.each(["the same session's next change", "a sign-in with the old login after a restart"])("keeps an unsettled change recoverable through an unrelated Settings save, by %s", async way => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("stop");
    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "alex.rivera@ucsd.edu", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    machine.saveInSettings(alex.profileId, { sharepointOnboardingRosterUrl: { set: "https://example.sharepoint.com/sites/hr/roster.xlsx" } });
    if (way === "the same session's next change") {
      assert.equal(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:02:00.000Z" }).state, "changed");
      assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });
      return;
    }
    const restarted = machine.open();
    assert.equal(refusalCode(restarted.signIn({ email: "alex.rivera@ucsd.edu", password: "secret-one", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" }).state, "active");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
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
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });
  });

  it("reports an unknown outcome when the verifier cannot be read back after a failed flush, guaranteeing neither login and undoing nothing", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("flush-unread");
    const result = session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" });
    restoreFiles();
    assert.equal(result.state, "unknown");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-two" });
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
    assert.equal(refusalCode(machine.open().signIn({ ...login, at: "2026-09-06T12:02:00.000Z" })), "PROFILE_AUTHORITY_UNAVAILABLE");
    const saved = machine.savedLogin(alex.profileId);
    assert.equal(cleared === "ucpathUserId" ? saved.userId : saved.password, undefined);
  });

  it("recovers an interrupted change whose write is dated before the untouched entry", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("stop");
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T11:00:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    assert.equal(machine.open().signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:02:00.000Z" }).state, "active");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
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

  it("keeps same-session recovery when the ownership of an unflushed write cannot be read back", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const verifiers = machine.verifierBytes();
    inject("entries-flush-unowned");
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    assert.equal(machine.verifierBytes(), verifiers);
    assert.equal(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-three", at: "2026-09-06T12:02:00.000Z" }).state, "changed");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-three" });
  });

  it("reports an old-login restore whose write is not proved durable instead of signing in as if settled", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    inject("stop");
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_LOGIN_CHANGE_UNSETTLED");
    restoreFiles();
    const restarted = machine.open();
    inject("entries-flush");
    assert.throws(() => restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:02:00.000Z" }), { name: "RelayLoginRestoreUncertainError" });
    restoreFiles();
    assert.equal(restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" }).state, "active");
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
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
