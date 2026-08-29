import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

describe("activity person pseudonym domain", () => {
  it("derives the reviewed generation-bound HMAC evidence for one canonical subject", () => {
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });

    const evidence = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });

    assert.deepEqual(evidence, {
      runId: RUN_ID,
      workflowId: "separations",
      keyGeneration: "activity-person-g1",
      pseudonym: "010d6acdd7e42d681de6849d727d0afca66a6a0f8ce82b8df48fd768b3f9d8f2",
      derivation: "hmac-sha-256/activity-person/v1",
    });
  });
});
