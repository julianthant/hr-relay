import { expect, it } from "vitest";
import { I9CheckInput, I9CheckCanonicalInput } from "../../../../src/models/workflows/i9-check/input.js";
import { i9CheckInput } from "../../../support/fixtures/i9-check.js";

it("derives the search mode at ingress and validates the retained decision without re-deriving it", () => {
  const name = I9CheckInput.parse({ ...i9CheckInput, person: { ...i9CheckInput.person, useMatch: true } });
  expect(name.person.useMatch).toBe(false);
  const match = I9CheckInput.parse({ ...i9CheckInput, person: { ...i9CheckInput.person, dob: "2000-01-15", useMatch: false } });
  expect(match.person.useMatch).toBe(true);
  expect(I9CheckCanonicalInput.parse(match)).toEqual(match);
  expect(() => I9CheckCanonicalInput.parse({ ...match, person: { ...match.person, useMatch: false } })).toThrow();
});
