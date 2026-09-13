/** The one restricted-JPEG gallery case; never a replacement for the default PNG corpus. */
import { createHash } from "node:crypto";
import { DiagnosticBundleWireSchema } from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { deriveDiagnosticContentDigest } from "../../../src/domain/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema } from "../../../src/domain/trust/diagnostic.js";
import { BASELINE_JPEG_BASE64 } from "../../fixtures/diagnostic-image-fixtures.js";
import { readImageGeometry } from "../../fixtures/image-geometry.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST } from "./fixture-diagnostic.js";

export function restrictedJpegDiagnosticFixture() {
  const screenshotBytes = new Uint8Array(Buffer.from(BASELINE_JPEG_BASE64, "base64"));
  const artifactId = "00000000-1000-4000-8000-000000000001";
  const mediaType = "image/jpeg";
  // Read geometry from these exact bytes. A MIME/byte mismatch refuses here,
  // before the fixture server can publish a plausible but false attachment.
  const { width, height } = readImageGeometry(artifactId, mediaType, screenshotBytes);
  const attachments = [{
    kind: "screenshot", artifactId, mediaType, width, height, sensitivity: "restricted",
    byteLength: screenshotBytes.byteLength, digest: createHash("sha256").update(screenshotBytes).digest("hex"),
  }];
  const manifest = DiagnosticBundleSchema.parse({
    ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
    attachments,
    contentDigest: deriveDiagnosticContentDigest({
      ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
      capturedAt: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.createdAt,
      attachments,
    }),
  });
  const bundle = DiagnosticBundleWireSchema.parse({
    ...FIXTURE_DIAGNOSTIC_BUNDLE,
    contentDigest: manifest.contentDigest,
    byteSize: screenshotBytes.byteLength,
    contents: manifest.attachments.map((attachment) => ({
      ...attachment, key: "Screenshot", detail: `image/jpeg · ${String(width)} × ${String(height)} px · restricted`,
    })),
  });
  return { bundle, manifest, screenshotBytes };
}
