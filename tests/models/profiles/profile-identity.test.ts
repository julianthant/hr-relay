import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveProfileNames, ProfileNameValidationError } from "../../../src/models/profiles/profile.js";
import { ProfileIdentitySchema, profileInitials } from "../../../src/models/profiles/profile-identity.js";

describe("derived profile identity", () => {
  it("uses the first letter of every word, including Unicode code points", () => {
    assert.equal(profileInitials("Sample Middle Operator"), "SMO");
    assert.equal(profileInitials("Sample   Middle\tOperator"), "SMO");
    assert.equal(profileInitials("André José"), "AJ");
    assert.equal(profileInitials("Sample 𐐨perator"), "S𐐀");
    assert.throws(() => profileInitials(" \t "));
  });

  it("binds the full display name, session identity and the person's stored timekeeper initials", () => {
    const value = { profileId: "10000000-0000-4000-8000-000000000001", sessionEpoch: 2, displayName: "Sample Middle Operator", initials: "SMO" };
    assert.deepEqual(ProfileIdentitySchema.parse(value), value);
    assert.deepEqual(ProfileIdentitySchema.parse({ ...value, initials: "SO" }), { ...value, initials: "SO" });
    assert.equal(ProfileIdentitySchema.safeParse({ ...value, initials: "" }).success, false);
    assert.equal(ProfileIdentitySchema.safeParse({ ...value, sessionEpoch: 0 }).success, false);
    assert.equal(ProfileIdentitySchema.safeParse({ ...value, credential: "injected" }).success, false);
  });
  it("retains accented and maximum-length full names while refusing embedded controls before publication", () => {
    assert.equal(deriveProfileNames("André", "José").timekeeperName, "André José");
    const first = "A".repeat(64), last = "B".repeat(64);
    assert.deepEqual(deriveProfileNames(first, last), { firstName: first, lastName: last,
      timekeeperName: `${first} ${last}`, initials: "AB", timekeeperInitials: "AB" });
    for (const name of ["Alpha\nBeta", "Alpha\0Beta", "Alpha\u2028Beta", "Alpha\u2029Beta"])
      assert.throws(() => deriveProfileNames(name, "Gamma"), ProfileNameValidationError);
  });

});
