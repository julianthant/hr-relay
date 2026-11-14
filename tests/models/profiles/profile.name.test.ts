import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveProfileNames, isProfileName, profileDetailsPatch, ProfileNameValidationError } from "../../../src/models/profiles/profile.js";

const accepted: readonly (readonly [string, string, { readonly firstName: string; readonly lastName: string; readonly initials: string; readonly timekeeperName: string }])[] = [
  ["Alex", "Rivera", { firstName: "Alex", lastName: "Rivera", initials: "AR", timekeeperName: "Alex Rivera" }],
  ["alex", "rivera", { firstName: "alex", lastName: "rivera", initials: "AR", timekeeperName: "alex rivera" }],
  ["Alex Middle", "Rivera", { firstName: "Alex Middle", lastName: "Rivera", initials: "AMR", timekeeperName: "Alex Middle Rivera" }],
  ["Alex  Middle", "Rivera", { firstName: "Alex  Middle", lastName: "Rivera", initials: "AMR", timekeeperName: "Alex  Middle Rivera" }],
  ["André", "José", { firstName: "André", lastName: "José", initials: "AJ", timekeeperName: "André José" }],
];

const refused: readonly (readonly [string, string])[] = [
  ["", "Rivera"],
  ["Alex", ""],
  [" ", "Rivera"],
  ["Alex", " "],
  [" Alex", "Rivera"],
  ["Alex", "Rivera "],
  ["A".repeat(65), "Rivera"],
  ["Alex", "B".repeat(65)],
  ["4lex", "Rivera"],
  ["Alex", "4ivera"],
  ["Émile", "Rivera"],
  ["A\u0301lex", "Rivera"],
  ["Al\nex", "Rivera"],
  ["Alpha\0Beta", "Gamma"],
  ["Alpha\u2028Beta", "Gamma"],
  ["Alpha\u2029Beta", "Gamma"],
];

describe("profile name check", () => {
  it("accepts a first and last name and derives the same profile name", () => {
    for (const [firstName, lastName, names] of accepted) {
      assert.equal(isProfileName(firstName, lastName), true);
      assert.deepEqual(deriveProfileNames(firstName, lastName), names);
      assert.deepEqual(profileDetailsPatch({ name: { firstName, lastName } }), { patch: { firstName, lastName } });
    }
    const firstName = "A".repeat(64), lastName = "B".repeat(64);
    assert.equal(isProfileName(firstName, lastName), true);
    assert.deepEqual(deriveProfileNames(firstName, lastName), {
      firstName, lastName, initials: "AB", timekeeperName: `${firstName} ${lastName}`,
    });
  });

  it("refuses each invalid shape without catching the validation error", () => {
    for (const [firstName, lastName] of refused) {
      assert.equal(isProfileName(firstName, lastName), false);
      assert.throws(() => deriveProfileNames(firstName, lastName), (error: unknown) => {
        assert.ok(error instanceof ProfileNameValidationError);
        assert.equal(error.message, "profile name refused");
        return true;
      });
      assert.deepEqual(profileDetailsPatch({ name: { firstName, lastName } }), { refused: "PROFILE_DISPLAY_NAME_REFUSED" });
    }
  });

  it("lets one normalization failure escape the name check and the details patch", () => {
    const sentinel = new Error("synthetic-normalization-failure");
    const original = Object.getOwnPropertyDescriptor(String.prototype, "normalize");
    assert.ok(original);
    const firstName = "Alex", lastName = "Rivera";
    try {
      Object.defineProperty(String.prototype, "normalize", { ...original, value() { throw sentinel; } });
      for (const call of [
        () => isProfileName(firstName, lastName),
        () => deriveProfileNames(firstName, lastName),
        () => profileDetailsPatch({ name: { firstName, lastName } }),
      ]) assert.throws(call, (error: unknown) => error === sentinel);
    } finally {
      Object.defineProperty(String.prototype, "normalize", original);
    }
    assert.equal(isProfileName(firstName, lastName), true);
  });
});
