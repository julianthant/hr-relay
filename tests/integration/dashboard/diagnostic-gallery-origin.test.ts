import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { diagnosticGalleryOrigin } from "../../parity/helpers/diagnostic-gallery-origin.js";
import { createFixtureBff } from "../../parity/helpers/fixture-bff.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE, FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST, FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "../../parity/helpers/fixture-day.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";

describe("diagnostic gallery fixture origin", () => {
  it("keeps the browser origin stable while binding each run to its own server", () => {
    const first = diagnosticGalleryOrigin("http://127.0.0.1:49123");
    const second = diagnosticGalleryOrigin("http://127.0.0.1:49124");
    assert.equal(first.baseUrl, "http://dca2-gallery.localhost");
    assert.equal(second.baseUrl, first.baseUrl);
    assert.equal(first.forwardUrl("http://dca2-gallery.localhost/?day=2026-08-04&run=fixture"),
      "http://127.0.0.1:49123/?day=2026-08-04&run=fixture");
    assert.equal(second.forwardUrl("http://dca2-gallery.localhost/?day=2026-08-04&run=fixture"),
      "http://127.0.0.1:49124/?day=2026-08-04&run=fixture");
  });

  it.each([
    "/assets/dashboard-a1.js", "/assets/font.woff2", "/events/v1?day=2026-08-04",
    "/api/v1/diagnostic-bundles/bundle/manifest", "/api/v1/diagnostic-bundles/bundle/attachments/artifact",
    "/assets/a%20b.png?key=a%2Fb&key=c+z",
  ])("preserves the exact path and query for %s", (path) => {
    const binding = diagnosticGalleryOrigin("http://127.0.0.1:49123");
    assert.equal(binding.forwardUrl(`http://dca2-gallery.localhost${path}`), `http://127.0.0.1:49123${path}`);
  });

  it.each([
    "https://127.0.0.1:49123", "http://foreign.test:49123", "http://127.0.0.1", "http://127.0.0.1:0",
    "http://127.0.0.1:49123/path", "http://127.0.0.1:49123?query=1", "http://user@127.0.0.1:49123",
  ])("refuses a non-fixture target %s", (target) => {
    assert.throws(() => diagnosticGalleryOrigin(target), /exact ephemeral HTTP loopback fixture-server origin/u);
  });

  it.each([
    "http://foreign.test/api/v1/bootstrap", "https://dca2-gallery.localhost/", "http://dca2-gallery.localhost:49123/",
    "http://user@dca2-gallery.localhost/", "http://dca2-gallery.localhost/#fragment",
  ])("refuses a request outside its exact browser origin %s", (request) => {
    const binding = diagnosticGalleryOrigin("http://127.0.0.1:49123");
    assert.throws(() => binding.forwardUrl(request), /only its own credential-free, fragment-free request URLs/u);
  });

  it("serves exact fixture manifest and image bytes through the nondefault client base", async () => {
    const binding = diagnosticGalleryOrigin("http://127.0.0.1:49123");
    const { app } = createFixtureBff();
    const client = createDashboardClient({
      baseUrl: binding.baseUrl,
      fetchImpl: (url, init) => Promise.resolve(app.request(binding.forwardUrl(url), init)),
    });
    const bundle = await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId);
    assert.deepEqual(bundle, FIXTURE_DIAGNOSTIC_BUNDLE);
    const screenshot = bundle.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    const manifestUrl = client.diagnosticBundleManifestUrl(bundle.bundleId);
    assert.equal(manifestUrl, `http://dca2-gallery.localhost/api/v1/diagnostic-bundles/${bundle.bundleId}/manifest`);
    const manifest = await app.request(binding.forwardUrl(manifestUrl));
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get("content-disposition"), `attachment; filename="${bundle.bundleId}.json"`);
    assert.equal(await manifest.text(), canonicalJsonStringify(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST));
    const attachmentUrl = client.diagnosticBundleAttachmentUrl(bundle.bundleId, screenshot.artifactId);
    assert.equal(attachmentUrl, `http://dca2-gallery.localhost/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${screenshot.artifactId}`);
    const attachment = await app.request(binding.forwardUrl(attachmentUrl));
    assert.equal(attachment.status, 200);
    assert.equal(attachment.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES));
  });
});
