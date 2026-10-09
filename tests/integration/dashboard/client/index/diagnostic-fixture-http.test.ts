import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { DiagnosticBundleSchema } from "../../../../../src/models/trust/diagnostic.js";
import { deriveDiagnosticContentDigest } from "../../../../../src/models/trust/diagnostic-capture.js";
import { readImageGeometry } from "../../../../support/fixtures/image-geometry.js";
import { BASELINE_JPEG_BASE64 } from "../../../../support/fixtures/diagnostic-image-fixtures.js";
import { PARITY_DIST_DIR } from "../fixtures/helpers/bundle.js";
import { createFixtureBff, startFixtureServer, type FixtureServer } from "../fixtures/helpers/fixture-bff.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE, FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST, FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "../../../../support/fixtures/dashboard/fixture-day.js";

const JPEG_ARTIFACT_ID = "00000000-1000-4000-8000-000000000001";
const BUNDLE_PATH = `/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}`;

async function withFixture(diagnosticFixture: "restricted-jpeg" | undefined, check: (server: FixtureServer) => Promise<void>): Promise<void> {
  // API-only unit evidence, never browser or build clearance. No static request
  // is made. The parity spec separately requires the real working-tree stamp.
  const options = {
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "unverified", reason: "diagnostic API-only unit test; no static bundle is requested or rendered" } as const,
    diagnosticFixture,
  };
  const server = await startFixtureServer(options);
  try {
    await check(server);
  } finally {
    await server.close();
  }
}

describe("diagnostic fixture over real HTTP", () => {
  it("refuses an undeclared fixture variant instead of silently serving the default PNG", () => {
    assert.throws(() => Reflect.apply(createFixtureBff, undefined, [{ diagnosticFixture: "not-a-fixture" }]), /unknown diagnostic fixture not-a-fixture/u);
  });

  it("serves the restricted JPEG as one exact wire, durable manifest and byte identity", async () => {
    await withFixture("restricted-jpeg", async (server) => {
      const bytes = Buffer.from(BASELINE_JPEG_BASE64, "base64");
      const expectedAttachment = {
        kind: "screenshot", artifactId: JPEG_ARTIFACT_ID, mediaType: "image/jpeg",
        byteLength: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex"),
        width: 16, height: 12, sensitivity: "restricted",
      };
      const client = createDashboardClient({ baseUrl: server.baseUrl });
      const attachmentUrl = client.diagnosticBundleAttachmentUrl(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId, JPEG_ARTIFACT_ID);
      assert.equal(attachmentUrl, `${server.baseUrl}${BUNDLE_PATH}/attachments/${JPEG_ARTIFACT_ID}`);
      const attachment = await fetch(attachmentUrl);
      assert.equal(attachment.status, 200, "the native download URL must exist on the real fixture server, not only in page.route");
      assert.equal(attachment.headers.get("content-type"), "image/jpeg");
      assert.equal(attachment.headers.get("content-length"), String(bytes.byteLength));
      assert.equal(attachment.headers.get("cache-control"), "no-store");
      const receivedBytes = new Uint8Array(await attachment.arrayBuffer());
      assert.deepEqual(Buffer.from(receivedBytes), bytes);
      const image = readImageGeometry(JPEG_ARTIFACT_ID, "image/jpeg", receivedBytes);
      assert.deepEqual({ width: image.width, height: image.height }, { width: 16, height: 12 });

      const manifestUrl = client.diagnosticBundleManifestUrl(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId);
      assert.equal(manifestUrl, `${server.baseUrl}${BUNDLE_PATH}/manifest`);
      const response = await fetch(manifestUrl);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(response.headers.get("content-disposition"), `attachment; filename="${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}.json"`);
      const text = await response.text();
      const manifest = DiagnosticBundleSchema.parse(JSON.parse(text));
      const expectedDigest = deriveDiagnosticContentDigest({
        ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
        capturedAt: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.createdAt,
        attachments: [expectedAttachment],
      });
      assert.deepEqual(manifest, { ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST, attachments: [expectedAttachment], contentDigest: expectedDigest });
      assert.equal(text, canonicalJsonStringify(manifest));
      assert.deepEqual(await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId), {
        ...FIXTURE_DIAGNOSTIC_BUNDLE, contentDigest: expectedDigest, byteSize: bytes.byteLength,
        contents: [{ ...expectedAttachment, key: "Screenshot", detail: "image/jpeg · 16 × 12 px · restricted" }],
      });
    });
  });

  it("leaves the default PNG, wire and manifest byte-exact and does not leak the JPEG variant", async () => {
    await withFixture(undefined, async (server) => {
      const bundle = await fetch(`${server.baseUrl}${BUNDLE_PATH}`);
      assert.equal(await bundle.text(), JSON.stringify(FIXTURE_DIAGNOSTIC_BUNDLE));
      const manifest = await fetch(`${server.baseUrl}${BUNDLE_PATH}/manifest`);
      assert.equal(await manifest.text(), canonicalJsonStringify(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST));
      const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
      assert.ok(screenshot);
      const png = await fetch(`${server.baseUrl}${BUNDLE_PATH}/attachments/${screenshot.artifactId}`);
      assert.equal(png.status, 200);
      assert.equal(png.headers.get("content-type"), "image/png");
      assert.equal(png.headers.get("content-length"), String(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES.byteLength));
      assert.deepEqual(Buffer.from(await png.arrayBuffer()), Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES));
      assert.equal((await fetch(`${server.baseUrl}${BUNDLE_PATH}/attachments/${JPEG_ARTIFACT_ID}`)).status, 404);
    });
  });

  it.each([undefined, "restricted-jpeg"] as const)("refuses nonmember bundle and artifact URLs for %s", async (variant) => {
    await withFixture(variant, async (server) => {
      const foreign = "/api/v1/diagnostic-bundles/00000000-0999-4000-8000-000000000999";
      const wrongArtifact = variant === undefined ? JPEG_ARTIFACT_ID : FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST.attachments[0]?.artifactId;
      assert.ok(wrongArtifact);
      for (const path of [foreign, `${foreign}/manifest`, `${foreign}/attachments/${JPEG_ARTIFACT_ID}`, `${BUNDLE_PATH}/attachments/${wrongArtifact}`]) {
        const response = await fetch(`${server.baseUrl}${path}`);
        assert.equal(response.status, 404, path);
        assert.match(await response.text(), /"code":"TARGET_NOT_FOUND"/u);
      }
    });
  });
});
