import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { deriveProfileNames, LogoutOperationSchema, ProfileAuthoritySnapshotSchema } from "../../../src/models/profiles/profile.js";

describe("profile names", () => {
  it("derives a timekeeper name and refuses padding", () => {
    assert.deepEqual(deriveProfileNames("Alex", "Rivera"), {
      firstName: "Alex", lastName: "Rivera", initials: "AR", timekeeperName: "Alex Rivera",
    });
    assert.deepEqual(deriveProfileNames("alex", "rivera"), {
      firstName: "alex", lastName: "rivera", initials: "AR", timekeeperName: "alex rivera",
    });
    assert.deepEqual(deriveProfileNames("Alex Middle", "Rivera"), {
      firstName: "Alex Middle", lastName: "Rivera", initials: "AMR", timekeeperName: "Alex Middle Rivera",
    });
    assert.throws(() => deriveProfileNames(" Alex", "Rivera"));
  });

});


it("admits only a complete value-free authority tuple with no default or unknown fields", () => {
  const valid = {
    profileId: "11111111-1111-4111-8111-111111111111", profileSessionEpoch: 1,
    accountRevision: 2, accountAttemptGeneration: 0, accountAvailability: "available",
    savedSettingsRevision: 1, savedSettingsFingerprint: "a".repeat(64),
    activeSettingsRevision: 1, activeSettingsFingerprint: "b".repeat(64), activeConfigFingerprint: "c".repeat(64), protectedSettingsRevision: 3,
  };
  assert.deepEqual(ProfileAuthoritySnapshotSchema.parse(valid), valid);
  for (const key of Object.keys(valid)) {
    const absent = { ...valid }; Reflect.deleteProperty(absent, key);
    assert.equal(ProfileAuthoritySnapshotSchema.safeParse(absent).success, false);
  }
  for (const patch of [{ profileId: "" }, { profileSessionEpoch: 0 }, { accountRevision: 0 }, { accountAttemptGeneration: -1 },
    { protectedSettingsRevision: Number.MAX_SAFE_INTEGER + 1 }, { accountAvailability: "signed-out" }, { token: "fixture" }, { root: "/fixture" }]) {
    assert.equal(ProfileAuthoritySnapshotSchema.safeParse({ ...valid, ...patch }).success, false);
  }
});

it("preserves numeric logout journals and exact decimal identities while refusing rounded witnesses", () => {
  const operation = { schemaVersion: 3, kind: "logout", operationId: "11111111-1111-4111-8111-111111111111",
    profileId: "22222222-2222-4222-8222-222222222222", sessionGeneration: 1, at: "2026-11-04T12:00:00.000Z", phase: "admitted" };
  for (const inode of [17, "21110623253370482"]) {
    const journal = { ...operation, source: { database: { device: 4, inode } } };
    assert.deepEqual(LogoutOperationSchema.parse(JSON.parse(JSON.stringify(journal))), journal);
  }
  for (const inode of [Number(21_110_623_253_370_482n), "021110623253370482", "-1"]) {
    assert.equal(LogoutOperationSchema.safeParse({ ...operation, source: { database: { device: 4, inode } } }).success, false);
  }
});
