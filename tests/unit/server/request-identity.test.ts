import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CAPTURE_TOKEN_HEADER } from "../../../src/domain/capture-surface.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/domain/ids.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";

describe("BFF request identity", () => {
  it("derives only the strict configured local operator and ignores caller actor material", () => {
    const checkpoint = createSoloRequestIdentityCheckpoint({
      id: LOCAL_OPERATOR_ACTOR_ID,
      label: "Configured operator",
    });
    const request = new Request(
      "http://127.0.0.1/api/v1/exports/xlsx?requestedBy=other-operator",
      {
        headers: {
          "x-requested-by": "other-operator",
          [CAPTURE_TOKEN_HEADER]: "capture-credential-is-not-actor-authority",
        },
      },
    );

    assert.equal(checkpoint.identify(request), LOCAL_OPERATOR_ACTOR_ID);
  });

  it("refuses a configured actor id or extra identity field outside solo mode", () => {
    assert.throws(
      () => createSoloRequestIdentityCheckpoint({ id: "other-operator", label: "Other" }),
      /local-operator/,
    );
    assert.throws(
      () => createSoloRequestIdentityCheckpoint({
        id: LOCAL_OPERATOR_ACTOR_ID,
        label: "Configured operator",
        credential: "not-a-solo-identity-input",
      }),
      /credential/,
    );
  });
});
