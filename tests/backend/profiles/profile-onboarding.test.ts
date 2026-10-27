import assert from "node:assert/strict";
import { it } from "vitest";
import { duoAccountMatches } from "../../../src/backend/profiles/profile-onboarding.js";
import { ProfileOnboardingStateSchema } from "../../../src/models/profiles/public-profile.js";

it("binds Duo account names only to the verified UCSD email or its exact username", () => {
  for (const observed of ["fixture@ucsd.edu", "fixture", " Fixture@UCSD.EDU "]) assert.equal(duoAccountMatches("fixture@ucsd.edu", observed), true);
  for (const observed of ["other", "fixture-other", "fixture@other.edu", "fixture@ucsd.edu.other", "Fixture Operator", ""]) {
    assert.equal(duoAccountMatches("fixture@ucsd.edu", observed), false);
  }
  assert.equal(duoAccountMatches("fixture@other.edu", "fixture"), false);
  assert.equal(duoAccountMatches("fixture@other.edu", "fixture@other.edu"), false);
});

it("requires distinct served completion facts for both methods before Ready", () => {
  const complete = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const ready = { state: "onboarding", operationId: "2d3b9a81-ec67-4e68-af2e-ad378a97dc00", profileId: "b5a72f23-c2e8-4252-9227-f4de440cedd9",
    step: "ready", methods: { key: complete, touch: complete } };
  assert.equal(ProfileOnboardingStateSchema.safeParse(ready).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, key: { ...complete, portalAccepted: false } } }).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, ceremonyObserved: false } } }).success, false);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, operatorConfirmed: false, exactCredentialRequestObserved: true } } }).success, false);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, key: { ...complete, operatorConfirmed: false, exactCredentialRequestObserved: true } } }).success, true);
  assert.equal(ProfileOnboardingStateSchema.safeParse({ ...ready, methods: { ...ready.methods, touch: { ...complete, state: "pending" } } }).success, false);
});
