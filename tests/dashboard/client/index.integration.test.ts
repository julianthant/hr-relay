
import { Hono as Hono_m3 } from "hono";
import { default as assert_m0,default as assert_m1,default as assert_m2,default as assert_m3,default as assert_m4,default as assert_m5 } from "node:assert/strict";
import { createHash as createHash_m1 } from "node:crypto";
import { afterAll as afterAll_m4,afterEach as afterEach_m3,beforeAll as beforeAll_m4,describe as describe_m0,describe as describe_m1,describe as describe_m2,describe as describe_m3,describe as describe_m4,describe as describe_m5,it as it_m0,it as it_m1,it as it_m2,it as it_m3,it as it_m4,it as it_m5 } from "vitest";
import { z as z_m5 } from "zod";
import { composeDataQueries as composeDataQueries_m3 } from "../../../src/backend/app/composition/dashboard/data.js";
import { readRerunValues as readRerunValues_m3 } from "../../../src/backend/runs/start/rerun-values.js";
import type { DashboardApp as DashboardApp_m3 } from "../../../src/backend/transports/http/routes/api-types.js";
import { registerDataRoutes as registerDataRoutes_m3 } from "../../../src/backend/transports/http/routes/data.js";
import { failureStatus as failureStatus_m3 } from "../../../src/backend/transports/http/routes/failure-status.js";
import { registerQueueRoutes as registerQueueRoutes_m3 } from "../../../src/backend/transports/http/routes/queue.js";
import { createDashboardClient as createDashboardClient_m0,createDashboardClient as createDashboardClient_m1,createDashboardClient as createDashboardClient_m2,createDashboardClient as createDashboardClient_m3,createDashboardClient as createDashboardClient_m4,createDashboardClient as createDashboardClient_m5,DashboardClientError as DashboardClientError_m0,StartPlanRefusalError as StartPlanRefusalError_m3 } from "../../../src/dashboard/client/index.js";
import { appendLogPage as appendLogPage_m5 } from "../../../src/dashboard/surfaces/run-detail/logs-model.js";
import { createRunLaunchService as createRunLaunchService_m3 } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { DiagnosticBundleWireSchema as DiagnosticBundleWireSchema_m0 } from "../../../src/models/dashboard/diagnostic-bundle.js";
import { OperationSourceResponseSchema as OperationSourceResponseSchema_m4 } from "../../../src/models/dashboard/operation-structure.js";
import { RunDetailSectionResponseSchema as RunDetailSectionResponseSchema_m4,RunDetailSectionResponseSchema as RunDetailSectionResponseSchema_m5 } from "../../../src/models/dashboard/run-detail.js";
import { deriveDiagnosticContentDigest as deriveDiagnosticContentDigest_m1 } from "../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema as DiagnosticBundleSchema_m1 } from "../../../src/models/trust/diagnostic.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0,canonicalJsonStringify as canonicalJsonStringify_m1,canonicalJsonStringify as canonicalJsonStringify_m2 } from "../../../src/rules/validation/canonical-json.js";
import {
FIXTURE_DIAGNOSTIC_BUNDLE as FIXTURE_DIAGNOSTIC_BUNDLE_m0,
FIXTURE_DIAGNOSTIC_BUNDLE as FIXTURE_DIAGNOSTIC_BUNDLE_m1,
FIXTURE_DIAGNOSTIC_BUNDLE as FIXTURE_DIAGNOSTIC_BUNDLE_m2,
FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST as FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m0,
FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST as FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m1,
FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST as FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m2,
FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES as FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES_m1,
FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES as FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES_m2
} from "../../support/fixtures/dashboard/fixture-day.js";
import { startOperationAuthorityServer as startOperationAuthorityServer_m4,startOperationAuthorityServer as startOperationAuthorityServer_m5 } from "../../support/fixtures/dashboard/fixture-operation-authority.js";
import { BASELINE_JPEG_BASE64 as BASELINE_JPEG_BASE64_m1 } from "../../support/fixtures/diagnostic-image-fixtures.js";
import { readImageGeometry as readImageGeometry_m1 } from "../../support/fixtures/image-geometry.js";
import { fictionalSeparationDocument as fictionalSeparationDocument_m5,reconcileFictionalSeparation as reconcileFictionalSeparation_m5 } from "../../support/fixtures/plan1-separation-operation.js";
import { mappedTransactionHarness as mappedTransactionHarness_m3,rerunValuesDeps as rerunValuesDeps_m3,rerunValuesHarness as rerunValuesHarness_m3 } from "../../support/fixtures/rerun-values-fixtures.js";
import { absentProbeEvidence as absentProbeEvidence_m3 } from "../../support/fixtures/write-sequencer-fixtures.js";
import { makeWorld as makeWorld_m3 } from "../../support/helpers/backend/dashboard-harness.js";
import { PARITY_DIST_DIR as PARITY_DIST_DIR_m1 } from "../../support/helpers/dashboard/served-fixtures/bundle.js";
import { diagnosticGalleryOrigin as diagnosticGalleryOrigin_m2 } from "../../support/helpers/dashboard/served-fixtures/diagnostic-gallery-origin.js";
import { createFixtureBff as createFixtureBff_m0,createFixtureBff as createFixtureBff_m1,createFixtureBff as createFixtureBff_m2,startFixtureServer as startFixtureServer_m1,type FixtureServer as FixtureServer_m1 } from "../../support/helpers/dashboard/served-fixtures/fixture-bff.js";


{


function fixtureClient() {
  const { app } = createFixtureBff_m0();
  return createDashboardClient_m0({
    baseUrl: "http://fixture.test",
    fetchImpl: (url, init) => Promise.resolve(app.request(url, init)),
  });
}

describe_m0("diagnostic bundle client and fixture route", () => {
  it_m0("forwards an optional diagnostic read signal without adding one to ordinary reads", async () => {
    const supplied = new AbortController();
    const observed: (AbortSignal | null | undefined)[] = [];
    const client = createDashboardClient_m0({
      baseUrl: "http://fixture.test",
      fetchImpl: (_url, init) => {
        observed.push(init?.signal);
        return Promise.resolve(Response.json(FIXTURE_DIAGNOSTIC_BUNDLE_m0));
      },
    });
    assert_m0.deepEqual(await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId), FIXTURE_DIAGNOSTIC_BUNDLE_m0);
    assert_m0.deepEqual(await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId, supplied.signal), FIXTURE_DIAGNOSTIC_BUNDLE_m0);
    assert_m0.deepEqual(observed, [undefined, supplied.signal]);
  });

  it_m0.each(["http://127.0.0.1:3938", "https://dashboard.example/owned-base/"])(
    "keeps manifest and attachment links owned by transport base %s", (baseUrl) => {
      const client = createDashboardClient_m0({ baseUrl });
      const bundleId = "00000000-0000-4000-8000-000000000001";
      const artifactId = "00000000-0000-4000-8000-000000000002";
      const base = baseUrl.replace(/\/$/u, "");
      assert_m0.equal(client.diagnosticBundleManifestUrl(bundleId), `${base}/api/v1/diagnostic-bundles/${bundleId}/manifest`);
      assert_m0.equal(client.diagnosticBundleAttachmentUrl(bundleId, artifactId),
        `${base}/api/v1/diagnostic-bundles/${bundleId}/attachments/${artifactId}`);
    },
  );

  it_m0.each(["", "../../../../latest", "https://foreign.example/id", "00000000-0000-4000-8000-000000000001?redirect=elsewhere"])(
    "refuses unsafe resource identity %s before returning any URL", (invalid) => {
      const client = fixtureClient();
      const valid = "00000000-0000-4000-8000-000000000001";
      assert_m0.throws(() => client.diagnosticBundleManifestUrl(invalid));
      assert_m0.throws(() => client.diagnosticBundleAttachmentUrl(invalid, valid));
      assert_m0.throws(() => client.diagnosticBundleAttachmentUrl(valid, invalid));
    },
  );

  it_m0.each([
    [404, "TARGET_NOT_FOUND"],
    [500, "DIAGNOSTIC_BUNDLE_CORRUPT"],
    [500, "DIAGNOSTIC_BUNDLE_BYTES_MISSING"],
  ] as const)("preserves HTTP %s %s without parsing error prose", async (status, code) => {
    const client = createDashboardClient_m0({
      baseUrl: "http://fixture.test",
      fetchImpl: () => Promise.resolve(Response.json({
        state: "error", code, message: "identical non-classifying message", retryable: false,
      }, { status })),
    });
    await assert_m0.rejects(() => client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId), (error: unknown) => {
      assert_m0.ok(error instanceof DashboardClientError_m0);
      assert_m0.equal(error.kind, "http");
      assert_m0.equal(error.status, status);
      assert_m0.equal(error.code, code);
      assert_m0.equal(error.retryable, false);
      return true;
    });
  });

  it_m0("GETs one strict bundle by its exact id and gives the browser the manifest route", async () => {
    const client = fixtureClient();
    const bundle = await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId);
    assert_m0.deepEqual(bundle, FIXTURE_DIAGNOSTIC_BUNDLE_m0);
    assert_m0.equal(
      client.diagnosticBundleManifestUrl(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId),
      `http://fixture.test/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId}/manifest`,
    );
    const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE_m0.contents.find((content) => content.kind === "screenshot");
    if (screenshot === undefined) throw new Error("the fixture diagnostic bundle must carry a screenshot");
    assert_m0.equal(
      client.diagnosticBundleAttachmentUrl(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId, screenshot.artifactId),
      `http://fixture.test/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId}/attachments/${screenshot.artifactId}`,
    );
  });

  it_m0("serves the fixture's actual download response and rejects wrong ids and malformed wire bodies", async () => {
    const { app } = createFixtureBff_m0();
    const manifest = await app.request(
      `http://fixture.test/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId}/manifest`,
    );
    assert_m0.equal(manifest.status, 200);
    assert_m0.equal(manifest.headers.get("content-disposition"), `attachment; filename="${FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId}.json"`);
    const manifestText = await manifest.text();
    assert_m0.equal(manifestText, canonicalJsonStringify_m0(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m0));
    assert_m0.deepEqual(JSON.parse(manifestText), FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m0);

    const missing = await app.request("http://fixture.test/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000099");
    assert_m0.equal(missing.status, 404);

    const malformedClient = createDashboardClient_m0({
      baseUrl: "http://fixture.test",
      fetchImpl: () => Promise.resolve(Response.json({ bundleId: FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId }, { status: 200 })),
    });
    await assert_m0.rejects(() => malformedClient.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId), DashboardClientError_m0);
    assert_m0.equal(
      DiagnosticBundleWireSchema_m0.safeParse({ ...FIXTURE_DIAGNOSTIC_BUNDLE_m0, addedByMutation: true }).success,
      false,
      "mutation check: an unexpected wire key cannot reach the dialog",
    );
  });

  it_m0("rejects a strict response whose bundle identity differs from the requested id", async () => {
    const requestedBundleId = FIXTURE_DIAGNOSTIC_BUNDLE_m0.bundleId;
    const foreignBundleId = "00000000-0999-4000-8000-000000000999";
    const client = createDashboardClient_m0({
      baseUrl: "http://fixture.test",
      fetchImpl: () => Promise.resolve(Response.json({
        ...FIXTURE_DIAGNOSTIC_BUNDLE_m0,
        bundleId: foreignBundleId,
      })),
    });

    await assert_m0.rejects(
      () => client.diagnosticBundle(requestedBundleId),
      (error: unknown) => {
        assert_m0.ok(error instanceof DashboardClientError_m0);
        assert_m0.equal(error.kind, "schema");
        assert_m0.equal(error.code, "DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH");
        assert_m0.match(error.message, new RegExp(requestedBundleId, "u"));
        assert_m0.doesNotMatch(error.message, new RegExp(foreignBundleId, "u"));
        return true;
      },
    );
  });
});
}

{


const JPEG_ARTIFACT_ID = "00000000-1000-4000-8000-000000000001";
const BUNDLE_PATH = `/api/v1/diagnostic-bundles/${FIXTURE_DIAGNOSTIC_BUNDLE_m1.bundleId}`;

async function withFixture(diagnosticFixture: "restricted-jpeg" | undefined, check: (server: FixtureServer_m1) => Promise<void>): Promise<void> {
  // API-only unit evidence, never browser or build clearance. No static request
  // is made. The parity spec separately requires the real working-tree stamp.
  const options = {
    distDir: PARITY_DIST_DIR_m1,
    bundle: { proof: "unverified", reason: "diagnostic API-only unit test; no static bundle is requested or rendered" } as const,
    diagnosticFixture,
  };
  const server = await startFixtureServer_m1(options);
  try {
    await check(server);
  } finally {
    await server.close();
  }
}

describe_m1("diagnostic fixture over real HTTP", () => {
  it_m1("refuses an undeclared fixture variant instead of silently serving the default PNG", () => {
    assert_m1.throws(() => Reflect.apply(createFixtureBff_m1, undefined, [{ diagnosticFixture: "not-a-fixture" }]), /unknown diagnostic fixture not-a-fixture/u);
  });

  it_m1("serves the restricted JPEG as one exact wire, durable manifest and byte identity", async () => {
    await withFixture("restricted-jpeg", async (server) => {
      const bytes = Buffer.from(BASELINE_JPEG_BASE64_m1, "base64");
      const expectedAttachment = {
        kind: "screenshot", artifactId: JPEG_ARTIFACT_ID, mediaType: "image/jpeg",
        byteLength: bytes.byteLength, digest: createHash_m1("sha256").update(bytes).digest("hex"),
        width: 16, height: 12, sensitivity: "restricted",
      };
      const client = createDashboardClient_m1({ baseUrl: server.baseUrl });
      const attachmentUrl = client.diagnosticBundleAttachmentUrl(FIXTURE_DIAGNOSTIC_BUNDLE_m1.bundleId, JPEG_ARTIFACT_ID);
      assert_m1.equal(attachmentUrl, `${server.baseUrl}${BUNDLE_PATH}/attachments/${JPEG_ARTIFACT_ID}`);
      const attachment = await fetch(attachmentUrl);
      assert_m1.equal(attachment.status, 200, "the native download URL must exist on the real fixture server, not only in page.route");
      assert_m1.equal(attachment.headers.get("content-type"), "image/jpeg");
      assert_m1.equal(attachment.headers.get("content-length"), String(bytes.byteLength));
      assert_m1.equal(attachment.headers.get("cache-control"), "no-store");
      const receivedBytes = new Uint8Array(await attachment.arrayBuffer());
      assert_m1.deepEqual(Buffer.from(receivedBytes), bytes);
      const image = readImageGeometry_m1(JPEG_ARTIFACT_ID, "image/jpeg", receivedBytes);
      assert_m1.deepEqual({ width: image.width, height: image.height }, { width: 16, height: 12 });

      const manifestUrl = client.diagnosticBundleManifestUrl(FIXTURE_DIAGNOSTIC_BUNDLE_m1.bundleId);
      assert_m1.equal(manifestUrl, `${server.baseUrl}${BUNDLE_PATH}/manifest`);
      const response = await fetch(manifestUrl);
      assert_m1.equal(response.status, 200);
      assert_m1.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert_m1.equal(response.headers.get("content-disposition"), `attachment; filename="${FIXTURE_DIAGNOSTIC_BUNDLE_m1.bundleId}.json"`);
      const text = await response.text();
      const manifest = DiagnosticBundleSchema_m1.parse(JSON.parse(text));
      const expectedDigest = deriveDiagnosticContentDigest_m1({
        ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m1,
        capturedAt: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m1.createdAt,
        attachments: [expectedAttachment],
      });
      assert_m1.deepEqual(manifest, { ...FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m1, attachments: [expectedAttachment], contentDigest: expectedDigest });
      assert_m1.equal(text, canonicalJsonStringify_m1(manifest));
      assert_m1.deepEqual(await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m1.bundleId), {
        ...FIXTURE_DIAGNOSTIC_BUNDLE_m1, contentDigest: expectedDigest, byteSize: bytes.byteLength,
        contents: [{ ...expectedAttachment, key: "Screenshot", detail: "image/jpeg · 16 × 12 px · restricted" }],
      });
    });
  });

  it_m1("leaves the default PNG, wire and manifest byte-exact and does not leak the JPEG variant", async () => {
    await withFixture(undefined, async (server) => {
      const bundle = await fetch(`${server.baseUrl}${BUNDLE_PATH}`);
      assert_m1.equal(await bundle.text(), JSON.stringify(FIXTURE_DIAGNOSTIC_BUNDLE_m1));
      const manifest = await fetch(`${server.baseUrl}${BUNDLE_PATH}/manifest`);
      assert_m1.equal(await manifest.text(), canonicalJsonStringify_m1(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m1));
      const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE_m1.contents.find((content) => content.kind === "screenshot");
      assert_m1.ok(screenshot);
      const png = await fetch(`${server.baseUrl}${BUNDLE_PATH}/attachments/${screenshot.artifactId}`);
      assert_m1.equal(png.status, 200);
      assert_m1.equal(png.headers.get("content-type"), "image/png");
      assert_m1.equal(png.headers.get("content-length"), String(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES_m1.byteLength));
      assert_m1.deepEqual(Buffer.from(await png.arrayBuffer()), Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES_m1));
      assert_m1.equal((await fetch(`${server.baseUrl}${BUNDLE_PATH}/attachments/${JPEG_ARTIFACT_ID}`)).status, 404);
    });
  });

  it_m1.each([undefined, "restricted-jpeg"] as const)("refuses nonmember bundle and artifact URLs for %s", async (variant) => {
    await withFixture(variant, async (server) => {
      const foreign = "/api/v1/diagnostic-bundles/00000000-0999-4000-8000-000000000999";
      const wrongArtifact = variant === undefined ? JPEG_ARTIFACT_ID : FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m1.attachments[0]?.artifactId;
      assert_m1.ok(wrongArtifact);
      for (const path of [foreign, `${foreign}/manifest`, `${foreign}/attachments/${JPEG_ARTIFACT_ID}`, `${BUNDLE_PATH}/attachments/${wrongArtifact}`]) {
        const response = await fetch(`${server.baseUrl}${path}`);
        assert_m1.equal(response.status, 404, path);
        assert_m1.match(await response.text(), /"code":"TARGET_NOT_FOUND"/u);
      }
    });
  });
});
}

{


describe_m2("diagnostic gallery fixture origin", () => {
  it_m2("keeps the browser origin stable while binding each run to its own server", () => {
    const first = diagnosticGalleryOrigin_m2("http://127.0.0.1:49123");
    const second = diagnosticGalleryOrigin_m2("http://127.0.0.1:49124");
    assert_m2.equal(first.baseUrl, "http://dca2-gallery.localhost");
    assert_m2.equal(second.baseUrl, first.baseUrl);
    assert_m2.equal(first.forwardUrl("http://dca2-gallery.localhost/?day=2026-08-04&run=fixture"),
      "http://127.0.0.1:49123/?day=2026-08-04&run=fixture");
    assert_m2.equal(second.forwardUrl("http://dca2-gallery.localhost/?day=2026-08-04&run=fixture"),
      "http://127.0.0.1:49124/?day=2026-08-04&run=fixture");
  });

  it_m2.each([
    "/assets/dashboard-a1.js", "/assets/font.woff2", "/events/v1?day=2026-08-04",
    "/api/v1/diagnostic-bundles/bundle/manifest", "/api/v1/diagnostic-bundles/bundle/attachments/artifact",
    "/assets/a%20b.png?key=a%2Fb&key=c+z",
  ])("preserves the exact path and query for %s", (path) => {
    const binding = diagnosticGalleryOrigin_m2("http://127.0.0.1:49123");
    assert_m2.equal(binding.forwardUrl(`http://dca2-gallery.localhost${path}`), `http://127.0.0.1:49123${path}`);
  });

  it_m2.each([
    "https://127.0.0.1:49123", "http://foreign.test:49123", "http://127.0.0.1", "http://127.0.0.1:0",
    "http://127.0.0.1:49123/path", "http://127.0.0.1:49123?query=1", "http://user@127.0.0.1:49123",
  ])("refuses a non-fixture target %s", (target) => {
    assert_m2.throws(() => diagnosticGalleryOrigin_m2(target), /exact ephemeral HTTP loopback fixture-server origin/u);
  });

  it_m2.each([
    "http://foreign.test/api/v1/bootstrap", "https://dca2-gallery.localhost/", "http://dca2-gallery.localhost:49123/",
    "http://user@dca2-gallery.localhost/", "http://dca2-gallery.localhost/#fragment",
  ])("refuses a request outside its exact browser origin %s", (request) => {
    const binding = diagnosticGalleryOrigin_m2("http://127.0.0.1:49123");
    assert_m2.throws(() => binding.forwardUrl(request), /only its own credential-free, fragment-free request URLs/u);
  });

  it_m2("serves exact fixture manifest and image bytes through the nondefault client base", async () => {
    const binding = diagnosticGalleryOrigin_m2("http://127.0.0.1:49123");
    const { app } = createFixtureBff_m2();
    const client = createDashboardClient_m2({
      baseUrl: binding.baseUrl,
      fetchImpl: (url, init) => Promise.resolve(app.request(binding.forwardUrl(url), init)),
    });
    const bundle = await client.diagnosticBundle(FIXTURE_DIAGNOSTIC_BUNDLE_m2.bundleId);
    assert_m2.deepEqual(bundle, FIXTURE_DIAGNOSTIC_BUNDLE_m2);
    const screenshot = bundle.contents.find((content) => content.kind === "screenshot");
    assert_m2.ok(screenshot);
    const manifestUrl = client.diagnosticBundleManifestUrl(bundle.bundleId);
    assert_m2.equal(manifestUrl, `http://dca2-gallery.localhost/api/v1/diagnostic-bundles/${bundle.bundleId}/manifest`);
    const manifest = await app.request(binding.forwardUrl(manifestUrl));
    assert_m2.equal(manifest.status, 200);
    assert_m2.equal(manifest.headers.get("content-disposition"), `attachment; filename="${bundle.bundleId}.json"`);
    assert_m2.equal(await manifest.text(), canonicalJsonStringify_m2(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST_m2));
    const attachmentUrl = client.diagnosticBundleAttachmentUrl(bundle.bundleId, screenshot.artifactId);
    assert_m2.equal(attachmentUrl, `http://dca2-gallery.localhost/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${screenshot.artifactId}`);
    const attachment = await app.request(binding.forwardUrl(attachmentUrl));
    assert_m2.equal(attachment.status, 200);
    assert_m2.equal(attachment.headers.get("content-type"), "image/png");
    assert_m2.deepEqual(Buffer.from(await attachment.arrayBuffer()), Buffer.from(FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES_m2));
  });
});
}

{


const disposers: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const dispose of disposers.splice(0)) await dispose(); };
async function consumer(transaction = false) {
  const h = transaction ? await mappedTransactionHarness_m3() : await rerunValuesHarness_m3();
  const w = await makeWorld_m3(); disposers.push(h.dispose, async () => await w.dispose());
  const app: DashboardApp_m3 = new Hono_m3();
  app.onError((error, c) => { const failure = failureStatus_m3(error); return c.json(failure.body, failure.status); });
  const data = composeDataQueries_m3({ stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => h.descriptor }, runReader: h.lifecycle, timeline: h.database.authority.timelineEvents, canonical: { ...rerunValuesDeps_m3(h), reader: h.lifecycle } });
  registerDataRoutes_m3(app, () => data);
  registerQueueRoutes_m3(app, { queue: { day: () => { throw new Error("unrequested queue read"); } }, startPlans: h.planner });
  app.post("/api/v1/commands", async (c) => c.json(h.kernel.execute(await c.req.json())));
  let dropNextResponse = false;
  const client = createDashboardClient_m3({ baseUrl: "http://localhost", fetchImpl: async (url, init) => {
    const response = await app.request(url, init);
    if (dropNextResponse && new URL(url).pathname === "/api/v1/commands") { dropNextResponse = false; throw new Error("lost response after commit"); }
    return response;
  } });
  const launch = createRunLaunchService_m3(client, "local-operator", { uuid: () => h.ids.uuid(), now: () => h.clock.now().toISOString() });
  return { h, client, launch, dropResponse: () => { dropNextResponse = true; } };
}
async function completeSource(h: Awaited<ReturnType<typeof consumer>>["h"], transaction = false) {
  const run = h.start(h.proposal());
  if (transaction) h.world.probeResults.push(absentProbeEvidence_m3(h.clock.now().toISOString()));
  assert_m3.equal((await h.execute(run)).state, "done"); return h.fresh(run);
}

describe_m3("independent Run/Rerun consumer of the released launch service", () => {
afterEach_m3(_afterEachFixture0);

  it_m3("reads exact source values, prefills, previews, submits once and replays a lost response through real services", async () => {
    const { h, client, launch, dropResponse } = await consumer(); const source = await completeSource(h);
    const before = h.queueRoots.length;
    const response = await launch.openRerun({ runId: source.envelope.runId, expectedVersion: source.version });
    assert_m3.ok(response.state === "available");
    const draft = launch.prefill(response.snapshot, { selectedValueIndexes: [0], selectedStepKeys: response.snapshot.steps.map((s) => s.key),
      dryRun: false, browserMode: "headless", captureBrowserScreenshots: false });
    assert_m3.deepEqual(draft.submissions, [{ eid: "10812345" }]);
    const plan = await launch.preview(draft);
    assert_m3.equal(h.queueRoots.length, before, "read/prefill/preview never enqueue");
    const command = launch.prepareFinal(plan); dropResponse();
    await assert_m3.rejects(client.executeCommand(command), /lost response/);
    assert_m3.equal(h.queueRoots.length, before + 1);
    const replay = await client.executeCommand(command); assert_m3.equal(replay.state, "already-applied");
    assert_m3.equal(h.queueRoots.length, before + 1);
    await assert_m3.rejects(client.executeCommand({ ...command, requestedBy: "someone-else" }), /divergent|reused/);
    assert_m3.deepEqual(await launch.openRerun({ runId: source.envelope.runId, expectedVersion: source.version - 1 }), { state: "refused", code: "source-stale" });
    assert_m3.throws(() => launch.prefill(response.snapshot, { selectedValueIndexes: [99], selectedStepKeys: ["reading"], dryRun: true, browserMode: "headless", captureBrowserScreenshots: false }), /VALUE_UNAVAILABLE/);
    assert_m3.equal(h.lifecycle.delete({ commandId: h.ids.uuid(), runId: source.envelope.runId, expectedVersion: source.version }).state, "deleted");
    assert_m3.deepEqual(await launch.openRerun({ runId: source.envelope.runId, expectedVersion: source.version }), { state: "refused", code: "target-deleted" });
  });
  it_m3("warning acknowledgement calls the real planner, with no queue effect before final confirmation", async () => {
    const { h, client, launch } = await consumer(true); const source = await completeSource(h, true);
    const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
    const draft = { workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: true, browserMode: "headless", captureBrowserScreenshots: false,
      selectedStepKeys, rerunSource: { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys } };
    const before = h.queueRoots.length;
    const warning = await launch.preview(draft); assert_m3.ok(warning.rerun); assert_m3.equal(warning.rerun.warnings.length, 1);
    const acknowledged = await launch.acknowledge(draft, warning);
    assert_m3.equal(acknowledged.rerun?.acknowledgment, warning.rerun.warningDigest);
    assert_m3.equal(h.queueRoots.length, before);
    assert_m3.throws(() => launch.acknowledge({ ...draft, rerunSource: { ...draft.rerunSource, expectedVersion: source.version + 1 } }, warning), /ACK_SOURCE_MISMATCH/);
    assert_m3.equal((await client.executeCommand(launch.prepareFinal(acknowledged))).state, "applied");
    assert_m3.equal(h.queueRoots.length, before + 1);
  });
  it_m3("refuses an unresolved write source through both source read and planning, without another run", async () => {
    const { h, launch } = await consumer(true); const source = await completeSource(h, true);
    const warning = h.proposal(source); assert_m3.ok(warning.rerun);
    const repeat = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(repeat); const unresolved = h.fresh(repeat);
    assert_m3.equal(unresolved.lifecycle.state, "parked-write");
    const count = h.queueRoots.length;
    assert_m3.deepEqual(await launch.openRerun({ runId: unresolved.envelope.runId, expectedVersion: unresolved.version }), { state: "refused", code: "source-ineligible" });
    const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
    await assert_m3.rejects(launch.preview({ browserMode: "headless", captureBrowserScreenshots: false, workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: true, selectedStepKeys,
      rerunSource: { runId: unresolved.envelope.runId, expectedVersion: unresolved.version, intent: "rerun", selectedStepKeys } }), (error: unknown) => error instanceof StartPlanRefusalError_m3 && error.refusalCode === "invalid-state" && /uncertain writes/.test(error.message));
    assert_m3.equal(h.queueRoots.length, count);
  });
  it_m3("rejects malformed or substituted prefill evidence", async () => {
    const { h } = await consumer(); const source = await completeSource(h);
    const request = { runId: source.envelope.runId, expectedVersion: source.version };
    const result = readRerunValues_m3(rerunValuesDeps_m3(h), request); assert_m3.ok(result.state === "available");
    for (const body of [ { ...result, snapshot: { ...result.snapshot, source: { ...result.snapshot.source, version: source.version + 1 } } },
      { ...result, snapshot: { ...result.snapshot, values: [{ state: "available", value: "invented" }] } } ]) {
      const client = createDashboardClient_m3({ baseUrl: "http://localhost", fetchImpl: async () => Response.json(body) });
      await assert_m3.rejects(client.rerunValues(request), /IDENTITY_MISMATCH|wire schema/);
    }
  });
});
}

{


let server: Awaited<ReturnType<typeof startOperationAuthorityServer_m4>>;
const _beforeAllFixture0 = async () => { server = await startOperationAuthorityServer_m4(); };
const _afterAllFixture1 = async () => { if (server !== undefined) await server.close(); };

async function logs() {
  const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
  assert_m4.equal(response.status, 200);
  const section = RunDetailSectionResponseSchema_m4.parse(await response.json());
  assert_m4.equal(section.section, "logs");
  if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("operation-app-fixture-missing-frozen-logs");
  return section.payload.operationStructure;
}

describe_m4("executable operation app authority", () => {
beforeAll_m4(_beforeAllFixture0);
afterAll_m4(_afterAllFixture1);

  it_m4("serves real frozen executor lifecycle and values through the Logs route", async () => {
    const structure = await logs();
    assert_m4.equal(structure.runId, server.runId);
    const confirmed = structure.observations.filter((observation) => observation.occurrence.state === "confirmed");
    assert_m4.equal(confirmed.length, 4);
    for (const observation of confirmed) {
      const proof = observation.occurrence.confirmation;
      assert_m4.ok(proof !== undefined);
      assert_m4.ok(structure.observations.some((verification) => verification.occurrence.logicalActionId === proof.verificationActionId && verification.occurrence.occurrence === proof.verificationOccurrence && verification.occurrence.state === "completed" && verification.at === proof.verifiedAt));
    }
    assert_m4.ok(structure.observations.some((observation) => observation.occurrence.state === "started"));
    assert_m4.ok(structure.observations.some((observation) => observation.occurrence.state === "not-run"));
    assert_m4.ok(structure.observations.some((observation) => observation.occurrence.value?.state === "observed" && typeof observation.occurrence.value.value === "string" && observation.occurrence.value.value.includes("Fixture operator")));
  });
  it_m4("authorizes the exact nested-child source under the current parent and refuses a foreign edge", async () => {
    const structure = await logs();
    const value = structure.observations.find((observation) => observation.occurrence.value?.producer.kind === "transformation")?.occurrence.value;
    assert_m4.ok(value?.producer.kind === "transformation");
    const identity = value.producer.inputs?.[0]?.identities[0];
    assert_m4.ok(identity);
    assert_m4.notEqual(identity.runId, server.runId);
    const url = (input: unknown) => `${server.baseUrl}/api/v1/runs/${server.runId}/operation-source?request=${encodeURIComponent(JSON.stringify({ identity: input }))}`;
    const client = createDashboardClient_m4({ baseUrl: server.baseUrl });
    assert_m4.equal((await client.operationSource(server.runId, { identity })).state, "found");
    const response = await fetch(url(identity));
    assert_m4.equal(response.status, 200);
    const source = OperationSourceResponseSchema_m4.parse(await response.json());
    assert_m4.equal(source.state, "found");
    if (source.state === "found") {
      assert_m4.equal(source.structure.runId, identity.runId);
      const forged = createDashboardClient_m4({ baseUrl: server.baseUrl, fetchImpl: async () => new Response(JSON.stringify({ ...source,
        structure: { ...source.structure, observations: source.structure.observations.map((observation) => ({ ...observation, occurrence: { ...observation.occurrence, occurrence: observation.occurrence.occurrence + 100 } })) } }), { headers: { "content-type": "application/json" } }) });
      await assert_m4.rejects(forged.operationSource(server.runId, { identity }), /OPERATION_SOURCE_IDENTITY_MISMATCH/u);
    }
    const denied = await fetch(url({ ...identity, childInvocation: { ...identity.childInvocation, edgeId: "foreign-edge" } }));
    assert_m4.notEqual(denied.status, 200);
    assert_m4.match(await denied.text(), /child-identity-mismatch/u);
  });
});
}

{


describe_m5("fictional separation run through production authority", () => {
  it_m5("retains complete computed and staged comments while withholding unregistered browser observations", async () => {
    const server = await startOperationAuthorityServer_m5("separation");
    try {
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
      assert_m5.equal(response.status, 200);
      const section = RunDetailSectionResponseSchema_m5.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("separation-frozen-logs-missing");
      let page = section.payload;
      const client = createDashboardClient_m5({ baseUrl: server.baseUrl });
      const cursors = new Set<string>();
      for (let count = 0; page.nextCursor.state === "present"; count += 1) {
        assert_m5.ok(count < 128, "bounded complete log traversal");
        const cursor = page.nextCursor.value;
        assert_m5.ok(!cursors.has(cursor), "log cursor must advance"); cursors.add(cursor);
        const next = await client.runSection(server.runId, "logs", cursor);
        assert_m5.equal(next.section, "logs");
        if (next.section !== "logs") throw new Error("separation-pagination-section-mismatch");
        page = appendLogPage_m5(page, cursor, next.payload);
      }
      assert_m5.ok(page.operationStructure?.state === "observed");
      const structure = page.operationStructure;
      const confirmed = structure.observations.filter((item) => item.occurrence.state === "confirmed");
      assert_m5.equal(confirmed.length, 37);
      assert_m5.deepEqual(confirmed.filter((item) => item.action === "computed" && !item.occurrence.logicalActionId.includes("comments")).map((item) => item.occurrence.value?.value), ["09/25/2026", "09/25/2026", "09/26/2026"]);
      const comments = confirmed.filter((item) => item.occurrence.logicalActionId === "fill-comments" || item.occurrence.logicalActionId === "fill-managercomments");
      assert_m5.equal(comments.length, 3);
      const exactComments = reconcileFictionalSeparation_m5(fictionalSeparationDocument_m5).comments;
      const computedComments = confirmed.filter((item) => item.action === "computed"
        && ["compute-comments", "compute-managercomments"].includes(item.occurrence.logicalActionId));
      assert_m5.equal(computedComments.length, 2);
      assert_m5.deepEqual(computedComments.map((item) => item.occurrence.value?.state === "observed" ? item.occurrence.value.value : item.occurrence.value?.state), [exactComments, exactComments]);
      assert_m5.deepEqual(comments.map((item) => item.occurrence.value?.state), ["withheld", "withheld", "withheld"]);
      for (const item of comments) assert_m5.equal("value" in (item.occurrence.value ?? {}), false);
      const run = server.database.authority.runs.get(server.runId);
      assert_m5.ok(run);
      const staged = z_m5.object({ fictional: z_m5.object({ comments: z_m5.string(), managerComments: z_m5.string() }) });
      for (const node of ["ucpath", "kuali"]) {
        const checkpoint = server.database.authority.runCheckpoints.latest(run.envelope.workflow, run.envelope.itemId, node);
        assert_m5.ok(checkpoint);
        const output = staged.parse(checkpoint.output.value);
        assert_m5.equal(output.fictional.comments, exactComments);
        assert_m5.equal(output.fictional.managerComments, exactComments);
      }
      assert_m5.ok(structure.definition.invocations.some((invocation) => invocation.operation.actions.some((action) => action.kind === "resume-page")));
      const lifecycle = server.database.authority.runs.get(server.runId)?.lifecycle;
      assert_m5.ok(lifecycle?.state === "terminal" && lifecycle.outcome === "done");
    } finally { await server.close(); }
  });
});
}
