import { createHash } from "node:crypto";
import {
DiagnosticBundleWireSchema,
type DiagnosticBundleWire,
} from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { deriveDiagnosticContentDigest } from "../../../src/domain/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema,type DiagnosticBundle } from "../../../src/domain/trust/diagnostic.js";
import { syntheticDashboardPngBytes } from "../../fixtures/diagnostic-image-fixtures.js";
import { at,CONFIG_FINGERPRINT,CONTRACT_FINGERPRINT,uuidOf } from "./fixture-identity.js";


const FIXTURE_DIAGNOSTIC_REDACTION = {
  fields: [
    { key: "employeeName", state: "transformed", classification: "sensitive-hr", transform: "digest", value: "a".repeat(64), rawValue: "Synthetic Employee" },
    { key: "ucpathPassword", state: "redacted", classification: "secret", transform: "drop", rawValue: "synthetic-visible-password" },
  ],
  warnings: ["unclassified diagnostic field at index 3: {\"value\":\"synthetic-unclassified\"}"],
} as const;


/**
 * A reviewed, synthetic fixture dashboard image makes the gallery's thumbnail
 * and lightbox visual states observable without importing a production capture.
 */
export const FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES = syntheticDashboardPngBytes();

const FIXTURE_DIAGNOSTIC_SCREENSHOT_DIGEST = createHash("sha256")
  .update(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES)
  .digest("hex");


const FIXTURE_DIAGNOSTIC_ATTACHMENTS = [
  {
    kind: "screenshot",
    artifactId: uuidOf(905),
    mediaType: "image/png",
    byteLength: FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES.byteLength,
    digest: FIXTURE_DIAGNOSTIC_SCREENSHOT_DIGEST,
    sensitivity: "redacted",
    width: 1280,
    height: 720,
  },
  {
    kind: "accessibility-excerpt",
    artifactId: uuidOf(906),
    mediaType: "text/yaml",
    byteLength: 128,
    digest: "2".repeat(64),
    sensitivity: "redacted",
  },
] as const;


const FIXTURE_DIAGNOSTIC_IDENTITY = {
  runId: uuidOf(4),
  origin: { kind: "operator-request", requestedBy: "local-operator" },
  capturedAt: at(35),
  configFingerprint: CONFIG_FINGERPRINT,
  descriptorFingerprint: CONTRACT_FINGERPRINT,
  redaction: FIXTURE_DIAGNOSTIC_REDACTION,
  attachments: FIXTURE_DIAGNOSTIC_ATTACHMENTS,
} as const;


/** E29's deterministic durable D137 row. The manifest route serves this canonical value exactly. */
export const FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST: DiagnosticBundle = DiagnosticBundleSchema.parse({
  bundleId: uuidOf(904),
  runId: FIXTURE_DIAGNOSTIC_IDENTITY.runId,
  origin: FIXTURE_DIAGNOSTIC_IDENTITY.origin,
  createdAt: FIXTURE_DIAGNOSTIC_IDENTITY.capturedAt,
  contentDigest: deriveDiagnosticContentDigest(FIXTURE_DIAGNOSTIC_IDENTITY),
  configFingerprint: FIXTURE_DIAGNOSTIC_IDENTITY.configFingerprint,
  descriptorFingerprint: FIXTURE_DIAGNOSTIC_IDENTITY.descriptorFingerprint,
  redaction: FIXTURE_DIAGNOSTIC_IDENTITY.redaction,
  attachments: FIXTURE_DIAGNOSTIC_IDENTITY.attachments,
  retention: { kind: "pinned", reason: "fix" },
});


/** E29's strict browser projection of the durable row. */
export const FIXTURE_DIAGNOSTIC_BUNDLE: DiagnosticBundleWire = DiagnosticBundleWireSchema.parse({
  bundleId: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.bundleId,
  capturedAt: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.createdAt,
  byteSize: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments.reduce((total, attachment) => total + attachment.byteLength, 0),
  contentDigest: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.contentDigest,
  redaction: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.redaction,
  contents: [
    {
      ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments[0],
      key: "Screenshot",
      detail: `image/png · ${String(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES.byteLength)} bytes · 1280 × 720 px · redacted`,
    },
    {
      ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments[1],
      key: "Accessibility excerpt",
      detail: "text/yaml · 128 bytes · redacted",
    },
  ],
});
