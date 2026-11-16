import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { SeparationsMatchIdentity } from "../../../src/models/workflows/separations/match-identity.js";
import { verifyIdentityApproval } from "../../../src/rules/separations/identity-approval.js";
import { IdentityEvidencePacketSchema,deriveIdentityEvidenceDigest } from "../../../src/rules/separations/identity-evidence.js";

describe("supplied EID verification", () => {
  it("continues on exact supplied/read-back EID without inventing human approval", () => {
    const packet = IdentityEvidencePacketSchema.parse(SeparationsMatchIdentity.example.packet);
    const result = verifyIdentityApproval(packet, undefined, deriveIdentityEvidenceDigest(packet));
    assert.equal(result.state, "verified");
    if (result.state !== "verified") return;
    assert.equal(result.subject.authority, "machine-verification");
    assert.equal(result.subject.emplId, "10873698");
    assert.equal("chosenFrom" in result.subject, false);
    assert.equal("approvalShape" in result.subject, false);
  });

  it("does not let a supplied-EID packet consume an operator result", () => {
    const packet = IdentityEvidencePacketSchema.parse(SeparationsMatchIdentity.example.packet);
    const result = verifyIdentityApproval(packet, {
      decision: "approved",
      eid: packet.emplId,
      chosenFrom: "checked",
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
    });
    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    assert.equal(result.code, "identity-supplied-eid-unproved");
  });
});

describe("identity authority refusals", () => {
  const packet = IdentityEvidencePacketSchema.parse(SeparationsMatchIdentity.example.packet);

  it("admits a canonical harness EID only after the same read-back binding", () => {
    const canonical = IdentityEvidencePacketSchema.parse({
      ...packet,
      emplIdSource: "canonical-eid",
      documentEidText: "blank (the harness supplied the EID)",
    });
    const result = verifyIdentityApproval(canonical, undefined);
    assert.equal(result.state, "verified");
    if (result.state !== "verified") return;
    assert.equal(result.subject.source, "canonical-eid");
    assert.equal(result.subject.authority, "machine-verification");
  });

  it("requires a real operator result for a name-resolved EID even when its text matches", () => {
    const nameResolved = IdentityEvidencePacketSchema.parse({
      ...packet,
      emplIdSource: "name-resolved",
      documentEidText: packet.emplId,
    });
    const result = verifyIdentityApproval(nameResolved, undefined);
    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    assert.equal(result.code, "identity-approval-required");
  });

  it("refuses a mismatched supplied EID and a moved packet digest", () => {
    const mismatch = IdentityEvidencePacketSchema.parse({ ...packet, documentEidText: "10401814" });
    const mismatched = verifyIdentityApproval(mismatch, undefined);
    assert.equal(mismatched.state, "refused");
    if (mismatched.state === "refused") assert.equal(mismatched.code, "identity-supplied-eid-unproved");

    const moved = verifyIdentityApproval(packet, undefined, "f".repeat(64) as never);
    assert.equal(moved.state, "refused");
    if (moved.state === "refused") assert.equal(moved.code, "identity-approval-evidence-moved");
  });

  it("keeps name discrepancy visible without overruling exact supplied EID proof", () => {
    const discrepancy = IdentityEvidencePacketSchema.parse({ ...packet, nameTier: "different" });
    const result = verifyIdentityApproval(discrepancy, undefined);
    assert.equal(result.state, "verified");
    if (result.state !== "verified") return;
    assert.equal(result.subject.nameTier, "different");
  });

  it("rejects a malformed packet at the strict boundary", () => {
    const { comparisons: _missing, ...malformed } = packet;
    assert.throws(() => verifyIdentityApproval(malformed as never, undefined));
  });
});

it("never machine-verifies an operator-entered EID, even when the document agrees", () => {
  const packet = IdentityEvidencePacketSchema.parse({ ...SeparationsMatchIdentity.example.packet, emplIdSource: "operator-entered" });
  const evidenceDigest = deriveIdentityEvidenceDigest(packet);
  assert.deepEqual(verifyIdentityApproval(packet, undefined), { state: "refused", code: "identity-approval-required", reason: "a name-resolved or operator-entered EID requires an operator identity decision" });
  const result = verifyIdentityApproval(packet, { decision: "approved", eid: packet.emplId, chosenFrom: "checked", evidenceDigest });
  assert.equal(result.state, "approved");
  if (result.state === "approved") assert.equal(result.subject.authority, "operator-approval");
  assert.equal(verifyIdentityApproval(packet, { decision: "approved", eid: packet.emplId, chosenFrom: "checked", evidenceDigest: FingerprintSchema.parse("a".repeat(64)) }).state, "refused");
});
