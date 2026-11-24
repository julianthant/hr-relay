import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runAccountsUpgradeProof, type UpgradeProofDependencies } from "../../../scripts/proof/accounts-upgrade-receipt.js";
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
    testPassword: () => "receipt-test-password-sentinel",
  };
  return { dependencies, calls, restored: () => relayPassword === oldPassword && ucpathPassword === oldPassword, recovered: () => recovered };
}

describe("accounts upgrade proof receipt", () => {
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
