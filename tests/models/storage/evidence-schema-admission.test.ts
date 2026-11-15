import assert from "node:assert/strict";
import { it } from "vitest";
import { EvidenceSchemaConversionSchema } from "../../../src/models/storage/evidence-schema-admission.js";

const binding = { installationId: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222" };
const retirement = (id: string) => ({ owner: { kind: "run-input", id }, workflowId: "separations", sourceSchemaHash: "a".repeat(64), sourceDigest: "b".repeat(64) });

it("records a retired input generation as its own conversion beside the profile name domain", () => {
  const retired = EvidenceSchemaConversionSchema.parse({ id: "retired-input-generation", ...binding,
    retirements: [retirement("33333333-3333-4333-8333-333333333333")] });
  assert.equal(retired.id, "retired-input-generation");
  const named = EvidenceSchemaConversionSchema.parse({ id: "profile-name-domain", ...binding, admissions: [{ owner: { kind: "run-input", id: "33333333-3333-4333-8333-333333333333" },
    sourceSchemaHash: "a".repeat(64), currentSchemaHash: "c".repeat(64), sourceDigest: "b".repeat(64) }] });
  assert.equal(named.id, "profile-name-domain");
});

it("refuses a retirement list that is empty, repeats an owner, names another owner kind or carries admissions", () => {
  const owner = "33333333-3333-4333-8333-333333333333";
  for (const conversion of [
    { id: "retired-input-generation", ...binding, retirements: [] },
    { id: "retired-input-generation", ...binding, retirements: [retirement(owner), retirement(owner)] },
    { id: "retired-input-generation", ...binding, retirements: [{ ...retirement(owner), owner: { kind: "run-result", id: owner } }] },
    { id: "retired-input-generation", ...binding, retirements: [retirement(owner)], admissions: [] },
    { id: "some-other-conversion", ...binding, retirements: [retirement(owner)] },
  ]) assert.equal(EvidenceSchemaConversionSchema.safeParse(conversion).success, false, JSON.stringify(conversion));
});
