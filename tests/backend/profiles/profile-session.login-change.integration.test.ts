import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, it, vi } from "vitest";
import { createProfileSessionWorld } from "../../support/helpers/backend/profile-session-world.js";

const worlds: Awaited<ReturnType<typeof createProfileSessionWorld>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const world of worlds.splice(0)) await world.close(); });
async function world() { const created = await createProfileSessionWorld(); worlds.push(created); return created; }
const alexFields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };
const samFields = { firstName: "Sam", lastName: "Ortiz", email: "sam@ucsd.edu", password: "secret-sam", createdAt: "2026-09-06T11:00:00.000Z" };

/**
 * Fail the verifier swap. "before" fails its rename; "stop" also fails every later credential open, as when the process stops there;
 * "flush" lets the rename land and fails the directory flush after it.
 */
function failVerifierSwap(mode: "before" | "stop" | "flush"): void {
  const rename = fs.renameSync, open = fs.openSync, flush = fs.fsyncSync;
  let stopped = false, landed = false;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to).endsWith("profile-verifiers.json")) {
      if (mode === "flush") { rename(from, to); landed = true; return; }
      stopped = mode === "stop";
      throw new Error("injected replacement failure");
    }
    rename(from, to);
  });
  vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
    if (landed) { landed = false; throw new Error("injected flush failure"); }
    flush(descriptor);
  });
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (stopped && String(path).includes("/credentials/")) throw new Error("injected stop");
    return open(path, flags, mode);
  });
  syncBuiltinESMExports();
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
    const samRow = () => (JSON.parse(machine.verifierBytes()) as { profiles: { profileId: string }[] }).profiles.find(row => row.profileId === sam.profileId);
    const samBefore = samRow();
    const alex = await machine.signUp(session, alexFields);

    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "Sam@ucsd.edu", at: "2026-09-06T12:01:00.000Z" })), "PROFILE_USERNAME_TAKEN");
    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "wrong", newUsername: "alex.rivera@ucsd.edu", at: "2026-09-06T12:02:00.000Z" })), "PROFILE_CURRENT_PASSWORD_REFUSED");
    assert.equal(machine.savedLogin(alex.profileId).userId, "alex@ucsd.edu");
    assert.equal(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername: "alex.rivera@ucsd.edu", at: "2026-09-06T12:03:00.000Z" }).state, "changed");
    assert.deepEqual([machine.savedLogin(alex.profileId).userId, machine.savedLogin(alex.profileId).password], ["alex.rivera@ucsd.edu", "secret-one"]);
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
    failVerifierSwap("before");
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
    failVerifierSwap("stop");
    const at = "2026-09-06T12:01:00.000Z";
    assert.throws(() => "newPassword" in change ? session.changePassword(alex.token, { currentPassword: "secret-one", ...change, at })
      : session.changeUsername(alex.token, { currentPassword: "secret-one", ...change, at }), /profile-login-change-unsettled/u);
    restoreFiles();
    assert.deepEqual([machine.savedLogin(alex.profileId).userId, machine.savedLogin(alex.profileId).password], [next.email, next.password], kind);
    assert.equal(refusalCode(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-three", at })), "PROFILE_AUTHORITY_UNAVAILABLE");

    const restarted = machine.open();
    assert.equal(refusalCode(restarted.resumeSignedInProfile({ at: "2026-09-06T12:02:00.000Z" })), "PROFILE_AUTHORITY_UNAVAILABLE");
    assert.equal(refusalCode(restarted.signIn({ ...next, at: "2026-09-06T12:02:00.000Z" })), "PROFILE_SIGN_IN_REFUSED");
    const old = restarted.signIn({ email: "alex@ucsd.edu", password: "secret-one", at: "2026-09-06T12:03:00.000Z" });
    assert.equal(old.state, "active");
    assert.deepEqual([machine.savedLogin(alex.profileId).userId, machine.savedLogin(alex.profileId).password], ["alex@ucsd.edu", "secret-one"]);
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
    failVerifierSwap("flush");
    assert.deepEqual(session.changePassword(alex.token, { currentPassword: "secret-one", newPassword: "secret-two", at: "2026-09-06T12:01:00.000Z" }),
      { state: "changed", durability: "unconfirmed" });
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
  ])("refuses a new username with %s and changes nothing", async (_name, newUsername) => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const verifiers = machine.verifierBytes();
    assert.equal(refusalCode(session.changeUsername(alex.token, { currentPassword: "secret-one", newUsername, at: "2026-09-06T12:01:00.000Z" })), "PROFILE_USERNAME_REFUSED");
    assert.equal(machine.verifierBytes(), verifiers);
    assert.deepEqual(machine.savedLogin(alex.profileId), { userId: "alex@ucsd.edu", password: "secret-one" });
  });
});
