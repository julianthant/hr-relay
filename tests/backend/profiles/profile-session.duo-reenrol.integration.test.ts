import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { createDuoCredentialStore } from "../../../src/backend/storage/configuration/duo-credential-store.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { DuoReenrolOperationSchema } from "../../../src/models/profiles/profile.js";
import { syntheticOnboardingDuo } from "../../support/helpers/admission-fixture.js";
import { createProfileSessionWorld } from "../../support/helpers/backend/profile-session-world.js";

const worlds: Awaited<ReturnType<typeof createProfileSessionWorld>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const world of worlds.splice(0)) await world.close(); });
async function world() { const created = await createProfileSessionWorld(); worlds.push(created); return created; }
const alexFields = { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" };

type World = Awaited<ReturnType<typeof world>>;
type Session = ReturnType<World["open"]>;
/** A fence that admits every commit, for the session's own proofs; the profile runtime's real fence has its own tests. */
const idleFence = { withIdleProfile: <T>(_profileId: string, body: () => T): T => body() };

/** Proves both methods in the re-enrolment window: the key by operator confirmation, Touch ID by portal acceptance. */
async function proveBothMethods(session: Session, token: string, operationId: string) {
  for (const method of ["key", "touch"] as const) {
    const started = await session.startDuoReenrol(token, operationId, method);
    const attemptId = started.methods[method].attemptId;
    assert.ok(attemptId);
    if (method === "key") session.confirmDuoReenrol(token, operationId, method, attemptId);
  }
  return session.readDuoReenrol(token, operationId);
}

/** The ready Duo set workflows sign with, read through the profile's own Duo store. */
function workflowDuo(machine: World, profileId: string) {
  const owner = machine.machine.admitProfile(profileId);
  try {
    const store = createDuoCredentialStore(owner, systemClock);
    return { identity: store.identity(), ready: store.credentials().map(row => row.credentialId), rows: store.read().credentials };
  } finally { owner.release(); }
}

describe("Duo re-enrolment for an active profile", () => {
  it("opens beside the active session, which stays usable and keeps signing with the old enrolment", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);

    const opened = session.beginDuoReenrol(alex.token);
    assert.deepEqual([opened.state, opened.profileId, opened.step, opened.methods.key.state, opened.methods.touch.state],
      ["duo-reenrol", alex.profileId, "duo", "idle", "idle"]);
    assert.deepEqual(session.readDuoReenrol(alex.token, opened.operationId), opened);
    assert.equal(session.prepareCurrentStorage(alex.token).state, "available");
    assert.equal(session.changeDetails(alex.token, { initials: "AXR" }).state, "changed");
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
  });

  it("stages both proved methods out of use, then commit replaces the ready set and keeps the session signed in", async () => {
    const machine = await world();
    const session = machine.open({ idleFence });
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);

    const ready = await proveBothMethods(session, alex.token, opened.operationId);
    assert.deepEqual([ready.step, ready.methods.key.state, ready.methods.touch.state], ["ready", "complete", "complete"]);
    const staged = workflowDuo(machine, alex.profileId);
    assert.deepEqual([staged.identity, staged.ready], [before.identity, before.ready]);
    assert.equal(staged.rows.filter(row => row.state === "staged").length, 1);

    assert.deepEqual(await session.commitDuoReenrol(alex.token, opened.operationId), { state: "active", token: alex.token, epoch: alex.epoch, profileId: alex.profileId });
    const committed = workflowDuo(machine, alex.profileId);
    assert.notEqual(committed.identity, before.identity);
    assert.deepEqual(committed.ready, staged.rows.filter(row => row.state === "staged").map(row => row.credentialId));
    assert.deepEqual(committed.rows.map(row => row.state), ["ready"]);
    assert.equal(session.prepareCurrentStorage(alex.token).state, "available");
    assert.throws(() => session.readDuoReenrol(alex.token, opened.operationId), { code: "PROFILE_SESSION_STALE" });
    assert.equal(machine.machine.readProfileRegistry().profiles.find(row => row.profileId === alex.profileId)?.duoState, "ready");
  });
});

describe("abandoning a Duo re-enrolment leaves the profile as it was", () => {
  it("before any attempt: cancel removes the operation and no credential file changes", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const files = machine.credentialBytes(alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);

    assert.deepEqual(await session.cancelDuoReenrol(alex.token, opened.operationId), { state: "active", token: alex.token, epoch: alex.epoch, profileId: alex.profileId });
    assert.deepEqual(machine.credentialBytes(alex.profileId), files);
    assert.throws(() => session.readDuoReenrol(alex.token, opened.operationId), { code: "PROFILE_SESSION_STALE" });
    assert.equal(session.prepareCurrentStorage(alex.token).state, "available");
  });

  it("with a pending attempt: cancel closes it, discards its row and keeps the ready set", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    const started = await session.startDuoReenrol(alex.token, opened.operationId, "key");
    assert.equal(started.methods.key.state, "pending");
    assert.equal(workflowDuo(machine, alex.profileId).rows.filter(row => row.state === "pending").length, 1);

    await session.cancelDuoReenrol(alex.token, opened.operationId);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
    assert.equal(session.beginDuoReenrol(alex.token).methods.key.state, "idle");
  });

  it("keeps the draft and its hold when the setup browser's closure is unproved, and refuses a new start", async () => {
    const machine = await createProfileSessionWorld();
    let closure: "closed" | "uncertain" = "closed";
    const session = machine.open({ onboardingDuo: { ...syntheticOnboardingDuo(), async closeBrowser() { return { state: closure }; } } });
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    await session.startDuoReenrol(alex.token, opened.operationId, "key");
    closure = "uncertain";

    await assert.rejects(session.cancelDuoReenrol(alex.token, opened.operationId), { code: "BROWSER_CLOSURE_UNPROVED" });
    assert.equal(session.readDuoReenrol(alex.token, opened.operationId).operationId, opened.operationId);
    await assert.rejects(session.startDuoReenrol(alex.token, opened.operationId, "touch"), { code: "BROWSER_CLOSURE_UNPROVED" });
    assert.deepEqual([workflowDuo(machine, alex.profileId).identity, workflowDuo(machine, alex.profileId).ready], [before.identity, before.ready]);
    assert.deepEqual([session.logOut(alex.token, { at: "2026-09-06T12:30:00.000Z" }).state, session.prepareCurrentStorage(alex.token).state], ["refused", "available"]);
    // The unproved closure is retained custody: shutdown refuses rather than drop the draft's browser.
    await assert.rejects(machine.close());
  });

  it("with both methods proved but not committed: cancel drops the staged rows unused", async () => {
    const machine = await world();
    const session = machine.open({ idleFence });
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    assert.equal((await proveBothMethods(session, alex.token, opened.operationId)).step, "ready");

    await session.cancelDuoReenrol(alex.token, opened.operationId);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
  });

  it("at logout: logout refuses while setup is open; the internal close abandons it, then logout and sign-in keep the old enrolment", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    await session.startDuoReenrol(alex.token, opened.operationId, "key");

    const refused = session.logOut(alex.token, { at: "2026-09-06T12:30:00.000Z" });
    assert.deepEqual([refused.state, "code" in refused && refused.code], ["refused", "PROFILE_DUO_REENROL_OPEN"]);
    assert.equal(session.prepareCurrentStorage(alex.token).state, "available");

    await session.closeDuoReenrol(alex.profileId);
    assert.equal((await machine.logOut(session, alex.token, "2026-09-06T12:31:00.000Z")).state, "signed-out");
    assert.equal(session.signIn({ email: alexFields.email, password: alexFields.password, at: "2026-09-06T12:32:00.000Z" }).state, "active");
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
  });

  it("at delete account: the internal close abandons setup before revocation, and deletion refuses while a re-enrolment exists", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    await session.startDuoReenrol(alex.token, opened.operationId, "key");

    await session.closeDuoReenrol(alex.profileId);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
    const loggedOut = await machine.logOut(session, alex.token, "2026-09-06T12:30:00.000Z");
    assert.ok(loggedOut.state === "signed-out" && "operationId" in loggedOut);

    const leftover = DuoReenrolOperationSchema.parse({ schemaVersion: 1, kind: "duo-reenrol", operationId: randomUUID(), profileId: alex.profileId,
      createdAt: "2026-09-06T12:31:00.000Z", draft: { accountId: randomUUID(), generation: 1, attempts: [] } });
    machine.machine.publishProfileOperation(leftover);
    assert.throws(() => session.deleteLoggedOutAccount(loggedOut.operationId), { code: "PROFILE_DUO_REENROL_OPEN" });
    assert.ok(machine.machine.readProfileRegistry().profiles.some(row => row.profileId === alex.profileId));
  });

  it("at quit: shutdown drains the attempt and keeps the operation; the next boot aborts and discards it", async () => {
    const machine = await world();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    await session.startDuoReenrol(alex.token, opened.operationId, "key");
    const operationFile = join(machine.machineRoot, "machine", "operations", `${opened.operationId}.json`);

    await session.closeOnboarding();
    assert.equal(existsSync(operationFile), true);
    const restarted = machine.open();
    await restarted.recoverOnboarding();
    assert.equal(existsSync(operationFile), false);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
    const resumed = restarted.resumeSignedInProfile({ at: "2026-09-06T12:40:00.000Z" });
    assert.equal(resumed.state, "active");
    if (resumed.state === "active") assert.equal(restarted.beginDuoReenrol(resumed.token).methods.key.state, "idle");
  });

  for (const stage of ["pending", "proved"] as const) it(`on a crash with ${stage === "pending" ? "a pending attempt" : "both methods proved"}: boot aborts the draft and discards its rows`, async () => {
    const machine = await createProfileSessionWorld();
    const session = machine.open({ idleFence });
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    if (stage === "pending") await session.startDuoReenrol(alex.token, opened.operationId, "key");
    else assert.equal((await proveBothMethods(session, alex.token, opened.operationId)).step, "ready");

    const restarted = machine.open();
    await restarted.recoverOnboarding();
    assert.equal(existsSync(join(machine.machineRoot, "machine", "operations", `${opened.operationId}.json`)), false);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
    assert.equal(restarted.resumeSignedInProfile({ at: "2026-09-06T12:40:00.000Z" }).state, "active");
    // The crashed process's owner still holds its attempt lease in memory and cannot drain a draft boot already removed.
    await assert.rejects(machine.close(), { code: "PROFILE_SESSION_STALE" });
  });
});

describe("a re-enrolment draft whose profile is not resumed at boot", () => {
  it("is closed at boot and can be cancelled after the next sign-in, leaving the old enrolment", async () => {
    const machine = await createProfileSessionWorld();
    const session = machine.open();
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    await session.startDuoReenrol(alex.token, opened.operationId, "key");
    // A boot that held this person for an unrelated reason deselected them before recovery.
    createProfileRegistry(machine.machine).advanceSession(null);

    const restarted = machine.open();
    await restarted.recoverOnboarding();
    assert.equal(existsSync(join(machine.machineRoot, "machine", "operations", `${opened.operationId}.json`)), true);
    const signedIn = restarted.signIn({ email: alexFields.email, password: alexFields.password, at: "2026-09-06T12:40:00.000Z" });
    assert.ok(signedIn.state === "active");
    const resumed = restarted.beginDuoReenrol(signedIn.token);
    assert.equal(resumed.operationId, opened.operationId);
    await restarted.cancelDuoReenrol(signedIn.token, opened.operationId);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
    await assert.rejects(machine.close(), { code: "PROFILE_SESSION_STALE" });
  });
});

type Fence = { withIdleProfile<T>(profileId: string, body: () => T): T };
/** An open re-enrolment with both methods proved, ready to commit through the given fence. */
async function readyToCommit(machine: World, fence: Fence) {
  const session = machine.open({ idleFence: fence });
  const alex = await machine.signUp(session, alexFields);
  const before = workflowDuo(machine, alex.profileId);
  const opened = session.beginDuoReenrol(alex.token);
  const ready = await proveBothMethods(session, alex.token, opened.operationId);
  assert.equal(ready.step, "ready");
  const staged = workflowDuo(machine, alex.profileId).rows.filter(row => row.state === "staged").map(row => row.credentialId);
  const operationFile = join(machine.machineRoot, "machine", "operations", `${opened.operationId}.json`);
  return { session, alex, before, operationId: opened.operationId, staged, operationFile,
    headFile: join(machine.machineRoot, "machine", "credential-keys", `${alex.profileId}.json`),
    recordFile: join(machine.machineRoot, "machine", "duo-credentials", `${alex.profileId}.json`) };
}
/** Fails the next `times` renames into target whose staged bytes contain `marker`, before or after the file is replaced. */
function failRename(target: string, when: "before" | "after", times = 1, marker?: string) {
  const rename = fs.renameSync;
  let left = times;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (left > 0 && String(destination) === target && (marker === undefined || fs.readFileSync(source, "utf8").includes(marker))) {
      left--;
      if (when === "after") rename(source, destination);
      throw new Error(`synthetic failure ${when} replacing ${target}`);
    }
    return rename(source, destination);
  });
  syncBuiltinESMExports();
}
/** Fails the next unlink of target, before or after the file is removed. */
function failUnlink(target: string, when: "before" | "after") {
  const unlink = fs.unlinkSync;
  let left = 1;
  vi.spyOn(fs, "unlinkSync").mockImplementation(path => {
    if (left > 0 && String(path) === target) {
      left--;
      if (when === "after") unlink(path);
      throw new Error(`synthetic failure ${when} removing ${target}`);
    }
    return unlink(path);
  });
  syncBuiltinESMExports();
}
function healRename() { vi.restoreAllMocks(); syncBuiltinESMExports(); }
/** What boot's stopped credential cleanup does before any session: remove re-enrolment stages, which are never authority. */
function removeReenrolStages(machine: World) {
  for (const directory of ["credential-keys", "duo-credentials"].map(name => join(machine.machineRoot, "machine", name))) {
    for (const name of fs.readdirSync(directory)) if (name.includes(".reenrol-")) fs.rmSync(join(directory, name));
  }
}
function assertHeld(session: Session, token: string) {
  const storage = session.prepareCurrentStorage(token);
  assert.deepEqual([storage.state, "code" in storage && storage.code], ["refused", "PROFILE_SESSION_STALE"]);
  assert.equal(session.changeDetails(token, { initials: "HLD" }).state, "refused");
}

describe("committing a Duo re-enrolment", () => {
  it("refuses before any effect while the fence finds work, leaving the draft committable", async () => {
    const machine = await world();
    let busy = true;
    const w = await readyToCommit(machine, { withIdleProfile(profileId, body) {
      if (busy) throw Object.assign(new Error("busy"), { code: "PROFILE_DUO_REENROL_BUSY" });
      return body();
    } });
    busy = true;
    // The fake fence's refusal stands in for the runtime's; its own tests prove each hold kind.
    await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId));
    assert.deepEqual(workflowDuo(machine, w.alex.profileId).ready, w.before.ready);
    assert.equal(w.session.prepareCurrentStorage(w.alex.token).state, "available");
    assert.equal(w.session.readDuoReenrol(w.alex.token, w.operationId).step, "ready");
    busy = false;
    await w.session.commitDuoReenrol(w.alex.token, w.operationId);
    assert.deepEqual(workflowDuo(machine, w.alex.profileId).ready, w.staged);
  });

  it("refuses a draft whose account holds a row the proved attempts did not store, then cancels cleanly", async () => {
    const machine = await world();
    const session = machine.open({ idleFence });
    const alex = await machine.signUp(session, alexFields);
    const before = workflowDuo(machine, alex.profileId);
    const opened = session.beginDuoReenrol(alex.token);
    const first = await session.startDuoReenrol(alex.token, opened.operationId, "key");
    const firstAttempt = first.methods.key.attemptId; assert.ok(firstAttempt);
    await session.cancelDuoReenrolAttempt(alex.token, opened.operationId, "key", firstAttempt);
    assert.equal((await proveBothMethods(session, alex.token, opened.operationId)).step, "ready");

    await assert.rejects(session.commitDuoReenrol(alex.token, opened.operationId), { code: "PROFILE_DUO_REENROL_REFUSED" });
    assert.deepEqual(workflowDuo(machine, alex.profileId).ready, before.ready);
    assert.equal(session.prepareCurrentStorage(alex.token).state, "available");
    await session.cancelDuoReenrol(alex.token, opened.operationId);
    assert.deepEqual(workflowDuo(machine, alex.profileId), before);
  });

  type Ready = Awaited<ReturnType<typeof readyToCommit>>;
  const reconciled = [
    ["the head publication before its replace", (w: Ready) => failRename(w.headFile, "before")],
    ["the head publication after its replace", (w: Ready) => failRename(w.headFile, "after")],
    ["the record publication before its replace", (w: Ready) => failRename(w.recordFile, "before")],
    ["the record publication after its replace", (w: Ready) => failRename(w.recordFile, "after")],
    ["the intent publication after it is written", (w: Ready) => failRename(w.operationFile, "after", 1, '"commit"')],
    ["the operation deletion after it unlinks", (w: Ready) => failUnlink(w.operationFile, "after")],
  ] as const;
  for (const [point, inject] of reconciled) it(`reconciles a failure at ${point} in-process and reports it uncertain, never success`, async () => {
    const machine = await world();
    const w = await readyToCommit(machine, idleFence);
    inject(w);
    await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
    healRename();
    assert.equal(w.session.duoReenrolCommitHeld(w.alex.profileId), false);
    assert.equal(w.session.prepareCurrentStorage(w.alex.token).state, "available");
    assert.equal(existsSync(w.operationFile), false);
    assert.deepEqual(workflowDuo(machine, w.alex.profileId).ready, w.staged);
  });

  // The installation journals each operation publication; one that fails before its file changes stays unsettled until restart,
  // so the registry cannot be read, the reconciliation cannot classify the operation, and the hold stays.
  const held = [
    ["the intent publication before it is written", (w: Ready) => failRename(w.operationFile, "before", 1, '"commit"')],
    ["the operation deletion before it unlinks", (w: Ready) => failUnlink(w.operationFile, "before")],
  ] as const;
  for (const [point, inject] of held) it(`keeps the hold after a failure at ${point}, and every guarded entry refuses`, async () => {
    const machine = await world();
    const w = await readyToCommit(machine, idleFence);
    inject(w);
    await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
    healRename();
    assert.equal(w.session.duoReenrolCommitHeld(w.alex.profileId), true);
    assert.equal(w.session.prepareCurrentStorage(w.alex.token).state, "refused");
    await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_AUTHORITY_UNAVAILABLE" });
    await assert.rejects(w.session.cancelDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_AUTHORITY_UNAVAILABLE" });
    await assert.rejects(w.session.closeDuoReenrol(w.alex.profileId), { code: "PROFILE_AUTHORITY_UNAVAILABLE" });
  });

  it("changes nothing when the fence's transaction fails at COMMIT or rollback, and leaves the draft committable", async () => {
    for (const fault of ["commit", "rollback", "none"] as const) {
      const machine = await world();
      let current: typeof fault = fault;
      const w = await readyToCommit(machine, { withIdleProfile(_profileId, body) {
        if (current === "commit") { body(); throw new Error("synthetic COMMIT failure"); }
        if (current === "rollback") throw new AggregateError([new Error("synthetic busy"), new Error("synthetic ROLLBACK failure")], "rollback failed");
        return body();
      } });
      if (fault !== "none") {
        await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId), /synthetic COMMIT failure|rollback failed/u);
        assert.equal(w.session.duoReenrolCommitHeld(w.alex.profileId), false);
        assert.equal(w.session.prepareCurrentStorage(w.alex.token).state, "available");
        assert.deepEqual(workflowDuo(machine, w.alex.profileId).ready, w.before.ready);
        assert.equal(w.session.readDuoReenrol(w.alex.token, w.operationId).step, "ready");
        current = "none";
      }
      await w.session.commitDuoReenrol(w.alex.token, w.operationId);
      assert.deepEqual(workflowDuo(machine, w.alex.profileId).ready, w.staged);
    }
  });

  it("keeps the hold when reconciliation cannot finish: every route refuses, commit, cancel and close refuse, and a restart stays stale", async () => {
    const machine = await world();
    const w = await readyToCommit(machine, idleFence);
    failRename(w.recordFile, "before", 2);
    await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
    healRename();
    assert.equal(w.session.duoReenrolCommitHeld(w.alex.profileId), true);
    assertHeld(w.session, w.alex.token);
    await assert.rejects(w.session.commitDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_SESSION_STALE" });
    await assert.rejects(w.session.cancelDuoReenrol(w.alex.token, w.operationId), { code: "PROFILE_SESSION_STALE" });
    await assert.rejects(w.session.closeDuoReenrol(w.alex.profileId), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
    assert.equal(w.session.logOut(w.alex.token, { at: "2026-09-06T12:50:00.000Z" }).state, "refused");

    // A restart cannot reopen work before reconciliation: the durable intent keeps every new session stale.
    removeReenrolStages(machine);
    const restarted = machine.open();
    const resumed = restarted.resumeSignedInProfile({ at: "2026-09-06T12:51:00.000Z" });
    assert.equal(resumed.state, "active");
    if (resumed.state === "active") assertHeld(restarted, resumed.token);
    // Boot's stopped-custody reconciliation is proven through the real startup in storage-compose.duo-reenrol.
    assert.throws(() => restarted.reconcileDuoReenrolCommits());
  });

  it("never lets a workflow see a staged row before commit", async () => {
    const machine = await world();
    const w = await readyToCommit(machine, idleFence);
    const owner = machine.machine.admitProfile(w.alex.profileId);
    try {
      const store = createDuoCredentialStore(owner, systemClock);
      assert.deepEqual(store.credentials().map(row => row.credentialId), w.before.ready);
      assert.equal(store.identity(), w.before.identity);
      assert.equal(store.platformCredentials().some(row => w.staged.includes(row.credentialId)), false);
      for (const credentialId of w.staged) {
        await assert.rejects(store.sign({ credentialId, requestId: randomUUID(), rpId: "duosecurity.com", origin: "https://fixture.duosecurity.com", challenge: "AAAAAAAA" }), /duo-ready-credential-required/u);
      }
    } finally { owner.release(); }
  });
});
