/** E29's second identity door: a surface never trusts an injected client blindly. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { acceptDiagnosticBundleReadback } from "../../../src/dashboard/surfaces/trust-model.js";
import { DiagnosticBundleIdSchema } from "../../../src/domain/ids.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE } from "../../parity/helpers/fixture-day.js";

describe("diagnostic bundle trust readback", () => {
  it("keeps the requested identity and a named error when a client seam returns a foreign bundle", () => {
    const requestedBundleId = FIXTURE_DIAGNOSTIC_BUNDLE.bundleId;
    const foreignBundleId = DiagnosticBundleIdSchema.parse("00000000-0999-4000-8000-000000000999");
    const outcome = acceptDiagnosticBundleReadback(requestedBundleId, {
      ...FIXTURE_DIAGNOSTIC_BUNDLE,
      bundleId: foreignBundleId,
    });

    assert.deepEqual(outcome, {
      state: "identity-mismatch",
      bundleId: requestedBundleId,
      message: `DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH: requested diagnostic bundle ${requestedBundleId} returned a different bundle identity`,
    });
    assert.doesNotMatch(outcome.message, new RegExp(foreignBundleId, "u"));
    assert.equal("bundle" in outcome, false, "a foreign bundle never becomes the ready selection");
  });
});
