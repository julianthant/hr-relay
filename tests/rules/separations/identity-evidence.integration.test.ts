import { createSeparationIdentityPacketFixture } from "../../support/helpers/separation-identity-packet-fixture.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MatchIdentityOutputSchema, SeparationsMatchIdentity } from "../../../src/models/workflows/separations/match-identity.js";
import { deriveIdentityEvidenceDigest, protectIdentityEvidencePacket } from "../../../src/rules/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../src/rules/separations/write-plan.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";

const { packetWithPlan } = createSeparationIdentityPacketFixture();


describe("separations — start planning through the existing service", () => {

  it("hides the protected canary document while keeping approval bound to its retained identity", () => {
    const base = MatchIdentityOutputSchema.parse(SeparationsMatchIdentity.example).packet;
    const binding = { kind: "test-data-local" as const, inputPath: "documentNumber" as const,
      name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf(88) };
    const first = protectIdentityEvidencePacket(base, [binding]);
    assert.equal(first.documentNumber, "protected document");
    assert.equal(JSON.stringify(first).includes(base.documentNumber), false);
    assert.equal(deriveIdentityEvidenceDigest(first), deriveIdentityEvidenceDigest(
      protectIdentityEvidencePacket({ ...base, documentNumber: "4999" }, [binding])));
    assert.notEqual(deriveIdentityEvidenceDigest(first), deriveIdentityEvidenceDigest(
      protectIdentityEvidencePacket(base, [{ ...binding, sourceId: uuidOf(89) }])));
  });
});

describe("separations — the identity-gate wire", () => {

  it("moves the evidence digest when a PLANNED VALUE moves, not only when the person does", () => {

    const packet = packetWithPlan();
    const moved = SeparationWritePlanSchema.parse(
      packet.plan.state === "planned"
        ? { ...packet.plan, dates: { ...packet.plan.dates, separationDate: "06/26/2026" } }
        : packet.plan,
    );
    assert.notEqual(
      deriveIdentityEvidenceDigest(packet),
      deriveIdentityEvidenceDigest({ ...packet, plan: moved }),
    );
  });
});
