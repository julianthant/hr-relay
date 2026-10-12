import { createSeparationIdentityPacketFixture } from "../../support/helpers/separation-identity-packet-fixture.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { IdentityApprovalResultSchema, verifyIdentityApproval } from "../../../src/rules/separations/identity-approval.js";
import { deriveIdentityEvidenceDigest } from "../../../src/rules/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../src/rules/separations/write-plan.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";

const { packetWithPlan } = createSeparationIdentityPacketFixture();


describe("separations — the identity-gate wire", () => {

  it("binds approval to retained value identity and keeps protected bytes and invalid digests private", () => {
    const packet = packetWithPlan();
    assert.equal(JSON.stringify(packet).includes("Julian Zaw"), false);
    assert.equal(packet.plan.state, "planned");
    if (packet.plan.state !== "planned") throw new Error("fixture must carry a plan");
    const plannedPacket = packet.plan;
    const bind = (valueId: string) => ({ ...packet, plan: SeparationWritePlanSchema.parse({
      ...plannedPacket,
      document: { ...plannedPacket.document, timekeeperName: {
        kind: "protected-store", name: "timekeeperName", inputPath: "timekeeperName", valueId,
      } },
    }) });
    const first = bind(uuidOf(40));
    const rotated = bind(uuidOf(41));
    const digest = deriveIdentityEvidenceDigest(first);
    assert.notEqual(digest, deriveIdentityEvidenceDigest(rotated));
    const result = IdentityApprovalResultSchema.parse({ decision: "approved", eid: first.emplId,
      chosenFrom: "checked", evidenceDigest: digest });
    assert.equal(verifyIdentityApproval(first, result).state, "approved");
    assert.equal(verifyIdentityApproval(rotated, result).state, "refused");
    const invalidDigest = FingerprintSchema.parse("e".repeat(64));
    const refusal = verifyIdentityApproval(first, result, invalidDigest);
    assert.equal(refusal.state, "refused");
    assert.equal(JSON.stringify(refusal).includes(invalidDigest.slice(0, 12)), false);
  });
});
