/** E29's exact-id route/client/download contract over the deterministic production fixture. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { DiagnosticBundleWireSchema } from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { createFixtureBff } from "../../parity/helpers/fixture-bff.js";
import {
  FIXTURE_DIAGNOSTIC_BUNDLE,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
} from "../../parity/helpers/fixture-day.js";

function fixtureClient() {
  const { app } = createFixtureBff();
  return createDashboardClient({
    baseUrl: "http://fixture.test",
    fetchImpl: (url, init) => Promise.resolve(app.request(url, init)),
  });
}

describe("E29 diagnostic bundle client and fixture route", () => {
  it("GETs one strict bundle by its exact id and gives the browser the manifest route", async () => {
    const client = fixtureClient();
    const bundle = await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId);
    assert.deepEqual(bundle, FIXTURE_DIAGNOSTIC_BUNDLE);
    assert.equal(
      client.diagnosticBundleManifestUrl(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId),
      `http://fixture.test/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}/manifest`,
    );
  });

  it("serves the fixture's actual download response and rejects wrong ids and malformed wire bodies", async () => {
    const { app } = createFixtureBff();
    const manifest = await app.request(
      `http://fixture.test/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}/manifest`,
    );
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get("content-disposition"), `attachment; filename="${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}.json"`);
    const manifestText = await manifest.text();
    assert.equal(manifestText, canonicalJsonStringify(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST));
    assert.deepEqual(JSON.parse(manifestText), FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST);

    const missing = await app.request("http://fixture.test/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000099");
    assert.equal(missing.status, 404);

    const malformedClient = createDashboardClient({
      baseUrl: "http://fixture.test",
      fetchImpl: () => Promise.resolve(Response.json({ bundleId: FIXTURE_DIAGNOSTIC_BUNDLE.bundleId }, { status: 200 })),
    });
    await assert.rejects(() => malformedClient.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE.bundleId), DashboardClientError);
    assert.equal(
      DiagnosticBundleWireSchema.safeParse({ ...FIXTURE_DIAGNOSTIC_BUNDLE, addedByMutation: true }).success,
      false,
      "mutation check: an unexpected wire key cannot reach the dialog",
    );
  });

  it("rejects a strict response whose bundle identity differs from the requested id", async () => {
    const requestedBundleId = FIXTURE_DIAGNOSTIC_BUNDLE.bundleId;
    const foreignBundleId = "00000000-0999-4000-8000-000000000999";
    const client = createDashboardClient({
      baseUrl: "http://fixture.test",
      fetchImpl: () => Promise.resolve(Response.json({
        ...FIXTURE_DIAGNOSTIC_BUNDLE,
        bundleId: foreignBundleId,
      })),
    });

    await assert.rejects(
      () => client.diagnosticBundle(requestedBundleId),
      (error: unknown) => {
        assert.ok(error instanceof DashboardClientError);
        assert.equal(error.kind, "schema");
        assert.equal(error.code, "DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH");
        assert.match(error.message, new RegExp(requestedBundleId, "u"));
        assert.doesNotMatch(error.message, new RegExp(foreignBundleId, "u"));
        return true;
      },
    );
  });
});
