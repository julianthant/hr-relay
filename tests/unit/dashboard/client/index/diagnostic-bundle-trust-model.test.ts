/** E29's second identity door: a surface never trusts an injected client blindly. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DashboardClientError } from "../../../../../src/dashboard/client/index.js";
import {
  acceptDiagnosticBundleReadback,
  diagnosticScreenshotBrowserLoadFailure,
  diagnosticScreenshotLabel,
  diagnosticScreenshotLoadFailure,
} from "../../../../../src/dashboard/surfaces/trust-model.js";
import { ArtifactIdSchema, DiagnosticBundleIdSchema, FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE } from "../../../../support/fixtures/dashboard/fixture-day.js";

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

describe("diagnostic screenshot gallery vocabulary", () => {
  it("keeps a screenshot label bounded to the bundle-local ordinal", () => {
    assert.equal(diagnosticScreenshotLabel(1, 3), "Diagnostic screenshot 2 of 3");
  });

  it.each([
    ["TARGET_NOT_FOUND", "Screenshot attachment is unavailable"],
    ["DIAGNOSTIC_BUNDLE_BYTES_MISSING", "Screenshot bytes are missing"],
    ["DIAGNOSTIC_BUNDLE_CORRUPT", "Screenshot attachment is corrupt"],
    ["SECTION_UNAVAILABLE", "Diagnostic attachment authority is unavailable"],
  ] as const)("keeps the %s authority vocabulary without parsing error prose", (code, title) => {
    const failure = diagnosticScreenshotLoadFailure(new DashboardClientError({
      kind: "http",
      code,
      message: "a deliberately non-classifying authority message",
      retryable: false,
    }));

    assert.deepEqual(failure, {
      kind: "authority",
      title,
      message: "a deliberately non-classifying authority message",
    });
  });

  it("keeps an unrecognized or network re-read failure unverified", () => {
    assert.deepEqual(diagnosticScreenshotLoadFailure(new DashboardClientError({
      kind: "network",
      message: "a deliberately non-classifying network message",
      retryable: true,
    })), {
      kind: "unverified",
      title: "Screenshot availability could not be verified",
      message: "The browser could not load this image, and the exact diagnostic bundle could not be re-read.",
    });
  });

  it("names only a successful exact readback as a browser load or decode failure", () => {
    const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    assert.deepEqual(diagnosticScreenshotBrowserLoadFailure(FIXTURE_DIAGNOSTIC_BUNDLE, screenshot, FIXTURE_DIAGNOSTIC_BUNDLE), {
      kind: "browser",
      title: "Screenshot preview could not be loaded",
      message: "The stored attachment verified, but this browser could not load or decode the image.",
    });
  });

  it("refuses a changed bundle digest after an image failure even when the artifact id remains indexed", () => {
    const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    const failure = diagnosticScreenshotBrowserLoadFailure(FIXTURE_DIAGNOSTIC_BUNDLE, screenshot, {
      ...FIXTURE_DIAGNOSTIC_BUNDLE,
      contentDigest: FingerprintSchema.parse("b".repeat(64)),
    });

    assert.equal(failure.kind, "identity-mismatch");
    assert.match(failure.message, /content digest/u);
  });

  it("requires the selected screenshot's full identity on the exact reread, not mere id membership", () => {
    const original = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = original.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    const changes = [
      { artifactId: ArtifactIdSchema.parse("00000000-0998-4000-8000-000000000998") },
      { digest: FingerprintSchema.parse("c".repeat(64)) },
      { mediaType: "image/jpeg" },
      { byteLength: screenshot.byteLength + 1 },
      { width: 99 },
      { height: 88 },
      { sensitivity: "restricted" as const },
      { kind: "accessibility-excerpt" as const },
    ];
    const rereads = [
      { ...original, bundleId: DiagnosticBundleIdSchema.parse("00000000-0999-4000-8000-000000000999") },
      ...changes.map((change) => ({ ...original, contents: [{ ...screenshot, ...change }] })),
      { ...original, contents: [] },
      { ...original, contents: [screenshot, screenshot] },
    ];

    for (const reread of rereads) {
      assert.equal(diagnosticScreenshotBrowserLoadFailure(original, screenshot, reread).kind, "identity-mismatch");
    }
  });
});
