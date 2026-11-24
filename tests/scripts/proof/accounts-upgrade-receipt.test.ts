import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { copySnapshots, runAccountsUpgradeProof, writeCopyRecoveryPasswords, type UpgradeProofDependencies } from "../../../scripts/proof/accounts-upgrade-receipt.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import type { PublicProfileState } from "../../../src/models/profiles/public-profile.js";

const profileId = "a52de557-89f5-4471-93bc-9d033951a769";
const otherProfile = "c5632d33-ada5-443c-a2d2-06a5ba6d67e9";
const relayEmail = "receipt-email-sentinel@example.test";
const oldPassword = "receipt-original-password-sentinel";
const build = { candidate: "1".repeat(40), checkout: "2".repeat(40) };
const active = { state: "active", profileId } as const;

function fixture(options: {
  resume?: Pick<Extract<PublicProfileState, { state: "refused" }>, "state" | "code">;
  interrupted?: boolean;
  allowRecovery?: boolean;
  changeOtherVerifier?: boolean;
  leakFromSave?: boolean;
  originalPassword?: string;
} = {}) {
  const originalPassword = options.originalPassword ?? oldPassword;
  let upgraded = false;
  let relayPassword = originalPassword;
  let ucpathPassword = options.interrupted === true ? "interrupted-password-sentinel" : originalPassword;
  let protectedRevision = 1;
  let verifierGeneration = 1;
  let recovered = false;
  const calls: string[] = [];
  const snapshot: UpgradeProofDependencies["snapshot"] = () => ({
    selected: profileId,
    row: { profileId, ...(upgraded ? { relayEmail } : {}) },
    protectedBytes: Buffer.from(JSON.stringify({ ucpathPassword, relayEmail, protectedRevision })),
    verifierBytes: Buffer.from(JSON.stringify({ schemaVersion: 1, profiles: [
      { profileId, emailKey: "a".repeat(64), salt: String(verifierGeneration).repeat(32), passwordVerifier: "b".repeat(64), consecutiveFailures: upgraded ? 0 : 1 },
      { profileId: otherProfile, emailKey: "c".repeat(64), salt: "d".repeat(32), passwordVerifier: (upgraded && options.changeOtherVerifier === true ? "e" : "f").repeat(64), consecutiveFailures: 0 },
    ] })),
  });
  const dependencies: UpgradeProofDependencies = {
    snapshot,
    inspect: () => Promise.resolve({ snapshot: snapshot(profileId), ucpathPassword, ucpathUsername: relayEmail,
      pairProvesVerifier: ucpathPassword === relayPassword, loginWrittenLast: options.interrupted === true }),
    async withSession(run) {
      calls.push("start");
      try {
        await run({
          resume() {
            calls.push("resume");
            if (options.resume !== undefined && !recovered) return Promise.resolve(options.resume);
            upgraded = true;
            return Promise.resolve(active);
          },
          recover() {
            calls.push("recover");
            upgraded = true;
            ucpathPassword = oldPassword;
            recovered = true;
            protectedRevision++;
            return Promise.resolve({ state: active, password: oldPassword });
          },
          changeRelayPassword(current, next) {
            assert.equal(current, relayPassword);
            calls.push(next === oldPassword ? "restore Relay" : "change Relay");
            relayPassword = next;
            verifierGeneration++;
            return Promise.resolve();
          },
          saveUcpathPassword(next) {
            calls.push(next === oldPassword ? "restore UCPath" : "save UCPath");
            if (options.leakFromSave === true) return Promise.reject(new Error(`response echoed ${next} and ${oldPassword}`));
            ucpathPassword = next;
            protectedRevision++;
            return Promise.resolve();
          },
          verifyUcpathPassword(expected) {
            assert.equal(ucpathPassword, expected);
            return Promise.resolve();
          },
        });
      } finally { calls.push("stop"); }
    },
    approveRecovery: () => Promise.resolve(options.allowRecovery ?? false),
    testPasswords: () => ({ relay: "receipt-test-relay-password-sentinel", ucpath: "receipt-test-ucpath-password-sentinel" }),
  };
  return { dependencies, calls, restored: () => relayPassword === oldPassword && ucpathPassword === oldPassword, recovered: () => recovered };
}

describe("accounts upgrade proof receipt", () => {
  it("reads the selected profile from the machine registry when the control witness also exists", () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-upgrade-snapshot-")));
    try {
      const state = join(workspace, rebuildRuntimeIsolation.stateRoot);
      const machine = join(state, "machine");
      const credentials = join(state, "profiles", profileId, "credentials");
      const control = join(workspace, ".tracker", "control");
      for (const directory of [machine, credentials, control]) mkdirSync(directory, { recursive: true, mode: 0o700 });
      const at = "2026-01-01T00:00:00.000Z";
      const row = {
        profileId, relayEmail, firstName: "Proof", lastName: "Operator", initials: "PO", timekeeperName: "Proof Operator",
        timekeeperInitials: "PO", createdAt: at, lastSignedInAt: at, credentialState: "saved", duoState: "ready", lifecycle: "ready",
        registration: { operationId: otherProfile, commandId: otherProfile, writeId: otherProfile, credentialRevision: 1 },
      };
      writeFileSync(join(control, "profile-registry.json"), JSON.stringify({
        schemaVersion: 7, installationId: otherProfile, revision: 1, digest: "a".repeat(64), generation: 1, operations: [],
      }), { mode: 0o600 });
      writeFileSync(join(machine, "profiles.json"), JSON.stringify({
        schemaVersion: 5, installationId: otherProfile, revision: 1, profiles: [row], sessionGeneration: 1, activeProfileId: profileId,
      }), { mode: 0o600 });
      writeFileSync(join(machine, "profile-verifiers.json"), "verifier file", { mode: 0o600 });
      writeFileSync(join(credentials, "protected.json"), "protected file", { mode: 0o600 });

      assert.deepEqual(copySnapshots(workspace)(), {
        selected: profileId, row, protectedBytes: Buffer.from("protected file"), verifierBytes: Buffer.from("verifier file"),
      });
    } finally { rmSync(workspace, { recursive: true }); }
  });

  it("captures the raw copy before admission and refuses a changed protected or verifier file", async () => {
    for (const file of ["protectedBytes", "verifierBytes"] as const) {
      const { dependencies, calls } = fixture();
      const receipt = await runAccountsUpgradeProof(build, {
        ...dependencies,
        snapshot(id) { calls.push("raw snapshot"); return dependencies.snapshot(id); },
        async inspect(id) {
          calls.push("inspect");
          const observed = await dependencies.inspect(id);
          return { ...observed, snapshot: { ...observed.snapshot, [file]: Buffer.from("changed during admission") } };
        },
      });
      assert.deepEqual(calls, ["raw snapshot", "inspect"]);
      assert.equal(receipt.outcome, "failed");
      assert.deepEqual(receipt.codes, ["COPY_AUTHORITY_CHANGED"]);
      assert.ok(receipt.hashes.before);
    }
  });

  it("saves distinct test passwords to a private recovery file without replacing it", () => {
    const directory = mkdtempSync(join(tmpdir(), "relay-upgrade-recovery-"));
    try {
      const path = join(directory, "recovery-passwords.json");
      const passwords = writeCopyRecoveryPasswords(path);
      assert.match(passwords.relay, /^[\w-]{43}$/u);
      assert.match(passwords.ucpath, /^[\w-]{43}$/u);
      assert.notEqual(passwords.relay, passwords.ucpath);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), passwords);
      assert.throws(() => writeCopyRecoveryPasswords(path), { code: "EEXIST" });
    } finally { rmSync(directory, { recursive: true }); }
  });

  it("proves admission and independent password changes and restores both copy passwords", async () => {
    const copy = fixture();
    const receipt = await runAccountsUpgradeProof(build, copy.dependencies);
    assert.equal(receipt.outcome, "passed");
    assert.deepEqual(receipt.checks, {
      sessionIssued: true, protectedUnchangedOnAdmission: true, verifierRowsUnchangedOnAdmission: true,
      registryGainedRelayEmail: true, protectedUnchangedOnRelayChange: true, verifiersUnchangedOnUcpathSave: true,
      passwordsRestored: true,
    });
    assert.deepEqual(copy.calls, ["start", "resume", "change Relay", "restore Relay", "save UCPath", "restore UCPath", "stop"]);
    assert.equal(copy.restored(), true);
    assert.notEqual(receipt.hashes.before?.verifiers, receipt.hashes.admitted?.verifiers);
    assert.equal(receipt.hashes.before?.protected, receipt.hashes.admitted?.protected);
    assert.notEqual(receipt.hashes.before?.registryRow, receipt.hashes.admitted?.registryRow);
    assert.doesNotMatch(JSON.stringify(receipt), /receipt-(?:email|original|test)|a52de557/u);
  });

  it("fails before changing passwords if any verifier row changes outside the failure counters", async () => {
    const copy = fixture({ changeOtherVerifier: true });
    const receipt = await runAccountsUpgradeProof(build, copy.dependencies);
    assert.equal(receipt.outcome, "failed");
    assert.equal(receipt.checks.verifierRowsUnchangedOnAdmission, false);
    assert.deepEqual(copy.calls, ["start", "resume", "stop"]);
  });

  it("requires operator participation for a marked interruption and fails other refusals without sign-in", async () => {
    const resume = { state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" } as const;
    const blocked = fixture({ resume, interrupted: true });
    const waiting = await runAccountsUpgradeProof(build, blocked.dependencies);
    assert.equal(waiting.outcome, "operator-required");
    assert.deepEqual(waiting.codes, ["PROFILE_AUTHORITY_UNAVAILABLE"]);
    assert.deepEqual(blocked.calls, ["start", "resume", "stop"]);

    const copy = fixture({ resume, interrupted: true, allowRecovery: true });
    const recovered = await runAccountsUpgradeProof(build, copy.dependencies);
    assert.equal(recovered.outcome, "passed");
    assert.equal(recovered.interruptedLoginRepaired, true);
    assert.notEqual(recovered.hashes.before?.protected, recovered.hashes.admitted?.protected);
    assert.equal(copy.recovered(), true);
    assert.equal(copy.restored(), true);
    assert.doesNotMatch(JSON.stringify(recovered), /receipt-(?:email|original|test)|interrupted-password-sentinel|a52de557/u);

    const mismatch = fixture({ resume, allowRecovery: true });
    const binding = fixture({ resume: { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" }, interrupted: true, allowRecovery: true });
    for (const refused of [mismatch, binding]) {
      assert.equal((await runAccountsUpgradeProof(build, refused.dependencies)).outcome, "failed");
      assert.deepEqual(refused.calls, ["start", "resume", "stop"]);
    }
  });

  it("reports an unconfirmed save without retrying it or leaking request or response data", async () => {
    const copy = fixture({ leakFromSave: true });
    const receipt = await runAccountsUpgradeProof(build, copy.dependencies);
    assert.equal(receipt.outcome, "failed");
    assert.deepEqual(receipt.codes, ["UCPATH_SAVE_UNCONFIRMED"]);
    assert.equal(copy.calls.filter(call => call === "save UCPath").length, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /receipt-(?:email|original|test)|response echoed/u);
  });

  it("checks that the existing Relay password can be restored before attempting a temporary change", async () => {
    const copy = fixture({ originalPassword: "p".repeat(161) });
    const receipt = await runAccountsUpgradeProof(build, copy.dependencies);
    assert.equal(receipt.outcome, "failed");
    assert.deepEqual(receipt.codes, ["COPY_RESTORE_UNCONFIRMED"]);
    assert.deepEqual(copy.calls, ["start", "resume", "stop"]);
  });
});
