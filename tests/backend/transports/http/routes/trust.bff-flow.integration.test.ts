
import assert from "node:assert/strict";
import { readFileSync,rmSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll,afterEach,describe,it } from "vitest";
import { createClonedProfileFixtures } from "../../../../support/helpers/admission-fixture.js";
import { createDiagnosticCaptureService } from "../../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../../../src/backend/storage/sqlite/storage-records.js";
import { startDashboardHttpServer } from "../../../../../src/backend/transports/http/http-server.js";
import type { ArtifactRef } from "../../../../../src/models/artifacts/artifacts.js";
import { DiagnosticBundleSchema } from "../../../../../src/models/trust/diagnostic.js";
import { fixtureDescriptor } from "../../../../support/fixtures/descriptor-fixtures.js";
import { RUN_ID,sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it.each([
    { profile: "generic", method: "HEAD", range: undefined, status: 200 },
    { profile: "bundle", method: "HEAD", range: undefined, status: 200 },
    { profile: "generic", method: "GET", range: "bytes=0-0", status: 416 },
    { profile: "bundle", method: "GET", range: "bytes=0-0", status: 416 },
  ] as const)(
    "serves the real $profile $method/$status verified-byte profile over node:http",
    async ({ profile, method, range, status }) => {
      let disposals = 0;
      const transferErrors: Error[] = [];
      const h = await harness({
        observeArtifactLeaseClosed: () => {
          disposals += 1;
        },
      });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;
      const server = await startDashboardHttpServer({
        app: h.app,
        port: 0,
        onTransferError: (error) => transferErrors.push(error),
      });
      try {
        const response = await loopbackResponse(server, path, {
          method,
          ...(range === undefined ? {} : { headers: { range } }),
        });

        assert.equal(response.status, status);
        assert.equal(response.body.byteLength, 0);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(
          response.headers["content-disposition"],
          undefined,
          `${profile} must not inherit Archive's attachment-only disposition`,
        );
        if (status === 200) {
          assert.equal(response.headers["content-type"], attachment.mediaType);
          assert.equal(response.headers["content-length"], String(attachment.byteLength));
          assert.equal(response.headers["content-range"], undefined);
        } else {
          assert.equal(response.headers["content-range"], `bytes */${String(attachment.byteLength)}`);
          assert.equal(response.headers["content-type"], undefined);
          assert.equal(response.headers["content-length"], undefined);
        }
        assert.equal(disposals, 1);
        assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
        assert.deepEqual(transferErrors, []);
      } finally {
        await server.close();
      }
    },
  );

  it("cancels the actual generic verified-byte route lease when its socket disconnects", async () => {
    const leaseClosed = Promise.withResolvers<void>();
    const transferErrors: Error[] = [];
    const h = await harness({ observeArtifactLeaseClosed: leaseClosed.resolve });
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const bundle = await createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("f"),
    }).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_B,
      descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [],
      attachments: [{
        kind: "screenshot",
        mediaType: "image/png",
        width: 1024, height: 512,
        bytes,
        sensitivity: "redacted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const server = await startDashboardHttpServer({
      app: h.app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = request({
          hostname: "127.0.0.1",
          port: server.port,
          method: "GET",
          path: `/artifacts/v1/${attachment.artifactId}`,
        }, (response) => {
          response.once("error", () => undefined);
          response.pause();
          response.destroy();
          resolve();
        });
        client.once("error", reject);
        client.end();
      });

      await leaseClosed.promise;
      assert.ok(h.artifactSourceReads.length > 1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(transferErrors.length <= 1, "one disconnected transfer may report at most one local error");
      for (const error of transferErrors) assert.match(error.message, /closed|disconnected/u);
    } finally {
      await server.close();
    }
  });

  it("aborts the actual generic route's preparation before headers when its socket disconnects", async () => {
    const routedSignal = Promise.withResolvers<AbortSignal>();
    const signalAborted = Promise.withResolvers<AbortSignal>();
    const transferErrors: Error[] = [];
    const h = await harness({
      diagnosticBundles: (real) => ({
        ...real,
        artifactReader: Object.freeze({
          verify: (ref: ArtifactRef, signal?: AbortSignal) => real.artifactReader.verify(ref, signal),
          async prepare(ref: ArtifactRef, signal?: AbortSignal) {
            if (signal === undefined) {
              const error = new Error("the real generic route omitted its request signal");
              routedSignal.reject(error);
              throw error;
            }
            routedSignal.resolve(signal);
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
              signalAborted.resolve(signal);
              resolve();
            }, { once: true }));
            signal.throwIfAborted();
            return real.artifactReader.prepare(ref, signal);
          },
        }),
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const server = await startDashboardHttpServer({
      app: h.app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    let serverClosed = false;
    try {
      const clientClosed = Promise.withResolvers<void>();
      const client = request({
        hostname: "127.0.0.1",
        port: server.port,
        method: "GET",
        path: `/artifacts/v1/${attachment.artifactId}`,
      });
      client.once("error", () => undefined);
      client.once("close", clientClosed.resolve);
      client.end();
      const signal = await routedSignal.promise;
      assert.equal(signal.aborted, false);
      client.destroy();

      const observedSignal = await signalAborted.promise;
      await clientClosed.promise;
      assert.equal(observedSignal, signal);
      assert.equal(signal.aborted, true);
      assert.match(String(signal.reason), /disconnected before response handoff/u);
      await server.close();
      serverClosed = true;
      assert.deepEqual(
        transferErrors,
        [],
        "an expected pre-handoff client abort must not be mislabeled as a response-transfer failure",
      );
    } finally {
      if (!serverClosed) await server.close();
    }
  });

  it("serves an authorized diagnostic attachment as an exact no-store resource", async () => {
    const h = await harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), attachment.mediaType);
    assert.equal(response.headers.get("content-length"), String(attachment.byteLength));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode("[]"));
  });

  it.each(["generic", "bundle"] as const)(
    "verifies and disposes the selected %s lease before returning an exact HEAD response",
    async (profile) => {
      let disposals = 0;
      const h = await harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: observeArtifactLeaseDisposal(real.artifactReader, () => {
          disposals += 1;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path, { method: "HEAD" });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), attachment.mediaType);
      assert.equal(response.headers.get("content-length"), String(attachment.byteLength));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(disposals, 1);
      assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
    },
  );

  it.each(["generic", "bundle"] as const)(
    "verifies and disposes the selected %s lease before refusing Range",
    async (profile) => {
      let disposals = 0;
      const h = await harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: observeArtifactLeaseDisposal(real.artifactReader, () => {
          disposals += 1;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path, { headers: { range: "bytes=0-0" } });

      assert.equal(response.status, 416);
      assert.equal(response.headers.get("content-range"), `bytes */${String(attachment.byteLength)}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(disposals, 1);
      assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
    },
  );

  it("serves an attachment only through the exact verified bundle that indexes it", async () => {
    const readerOperations: { operation: "verify" | "prepare"; ref: ArtifactRef }[] = [];
    const h = await harness({ diagnosticBundles: (real) => ({
      ...real,
      artifactReader: beforeArtifactReaderOperation(real.artifactReader, (operation, ref) => {
        readerOperations.push({ operation, ref });
      }),
    }) });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const envelopeByteLength = readFileSync(
      join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`),
    ).byteLength;

    const response = await h.app.request(
      `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), attachment.mediaType);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode("[]"));
    assert.deepEqual(readerOperations, [
      {
        operation: "verify",
        ref: {
          id: attachment.artifactId,
          sha256: attachment.digest,
          bytes: attachment.byteLength,
          mediaType: attachment.mediaType,
        },
      },
      {
        operation: "prepare",
        ref: {
          id: attachment.artifactId,
          sha256: attachment.digest,
          bytes: attachment.byteLength,
          mediaType: attachment.mediaType,
        },
      },
    ], "selected success performs one artifact verification and one fresh exact-ref preparation");
    assert.deepEqual(
      h.artifactSourceReads,
      [envelopeByteLength, envelopeByteLength],
      "selected preparation performs a fresh source read after artifact verification",
    );

    const foreign = await h.app.request(
      `/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000099/attachments/${attachment.artifactId}`,
    );
    assert.equal(foreign.status, 404, "an indexed artifact must not detach from its requested bundle identity");
  });

  it("serves the stored screenshot bytes and its captured dimensions through one exact bundle", async () => {
    const h = await harness();
    await captureDiagnosticBundle(h);
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG9sAAAAASUVORK5CYII=";
    const bundle = await createDiagnosticCaptureService({
      authority: h.database.authority, artifacts: h.artifacts, clock: h.clock, ids: sequentialIdFactory("e"),
    }).capture({
      trigger: "operator-request", runId: RUN_ID, requestedBy: "local-operator",
      configFingerprint: HASH_B, descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [], attachments: [{
        kind: "screenshot", mediaType: "image/png", bytes: Buffer.from(pngBase64, "base64"),
        width: 1, height: 1, sensitivity: "restricted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its screenshot");
    const path = `/api/v1/diagnostic-bundles/${bundle.bundleId}`;
    const metadata = await h.app.request(path);
    const wire = await json(metadata);
    assert.deepEqual(wire.contents, [{
      kind: "screenshot", key: "Screenshot", detail: "image/png · 68 bytes · 1 × 1 px · restricted",
      artifactId: attachment.artifactId, mediaType: "image/png", byteLength: 68,
      digest: attachment.digest, width: 1, height: 1, sensitivity: "restricted",
    }]);
    const response = await h.app.request(`${path}/attachments/${attachment.artifactId}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-length"), "68");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("base64"), pngBase64);
  });

  it("marks diagnostic metadata and refused resource responses no-store and nosniff", async () => {
    const h = await harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const base = `/api/v1/diagnostic-bundles/${bundle.bundleId}`;

    for (const [path, status] of [
      [base, 200],
      [`${base}/manifest`, 200],
      [`${base}/attachments/${attachment.artifactId}`, 200],
      [`${base}/attachments/00000000-0000-4000-8000-000000000099`, 404],
    ] as const) {
      const response = await h.app.request(path);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
      await response.body?.cancel();
    }
  });

  it("refuses an existing attachment owned only by another existing bundle", async () => {
    const h = await harness();
    const first = await captureDiagnosticBundle(h);
    const second = await createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("e"),
    }).capture({
      trigger: "operator-request", runId: RUN_ID, requestedBy: "local-operator",
      configFingerprint: HASH_B, descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [], attachments: [{
        kind: "console-summary", mediaType: "application/json",
        bytes: new TextEncoder().encode('["other bundle"]'), sensitivity: "redacted",
      }],
    });
    const attachment = first.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const secondBundleResponse = await h.app.request(`/api/v1/diagnostic-bundles/${second.bundleId}`);
    assert.equal(secondBundleResponse.status, 200);
    await secondBundleResponse.body?.cancel();
    const genericResponse = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    assert.equal(genericResponse.status, 200);
    await genericResponse.body?.cancel();

    const response = await h.app.request(
      `/api/v1/diagnostic-bundles/${second.bundleId}/attachments/${attachment.artifactId}`,
      { headers: { range: "bytes=0-0" } },
    );
    assert.equal(response.status, 404);
    assert.equal((await json(response)).code, "TARGET_NOT_FOUND");
    assert.equal(response.headers.get("content-range"), null);
  });

  it("does not infer purge history from absent diagnostic authority", async () => {
    const h = await harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    h.database.authority.diagnosticBundles.purge(bundle.bundleId, "2027-01-01T00:00:00.000Z");

    for (const bundleId of [bundle.bundleId, "00000000-0000-4000-8000-000000000099"]) {
      for (const suffix of ["", "/manifest", `/attachments/${attachment.artifactId}`]) {
        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundleId}${suffix}`);
        assert.equal(response.status, 404);
        const body = await json(response);
        assert.equal(body.code, "TARGET_NOT_FOUND");
        assert.equal(body.retryable, false);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("content-disposition"), null);
      }
    }
    assert.equal(readFileSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`), "utf8").length > 0, true,
      "physical bytes remain, but no longer authorize an attachment response");
  });

  it.each(["bundle identity", "bundle digest", "index identity", "index digest", "index size", "index media type", "missing index", "duplicate index"] as const)(
    "refuses exact attachment readback for corrupt %s before opening bytes", async (mutation) => {
      let opened = false;
      const h = await harness({ diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          get: (id) => {
            const stored = real.authority.get(id);
            if (stored === undefined) return undefined;
            return DiagnosticBundleSchema.parse({ ...stored,
              ...(mutation === "bundle identity" ? { bundleId: "00000000-0000-4000-8000-000000000099" } : {}),
              ...(mutation === "bundle digest" ? { contentDigest: "0".repeat(64) } : {}),
            });
          },
          listAttachments: (id) => {
            const rows = real.authority.listAttachments(id);
            if (mutation === "missing index") return [];
            if (mutation === "duplicate index") return [...rows, ...rows];
            return rows.map((row) => DiagnosticAttachmentStorageRecordSchema.parse({
              ...row,
              ...(mutation === "index identity" ? { bundleId: "00000000-0000-4000-8000-000000000099" } : {}),
              attachment: { ...row.attachment,
                ...(mutation === "index digest" ? { digest: "0".repeat(64) } : {}),
                ...(mutation === "index size" ? { byteLength: 3 } : {}),
                ...(mutation === "index media type" ? { kind: "accessibility-excerpt", mediaType: "text/yaml" } : {}),
              },
            }));
          },
        },
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, () => {
          opened = true;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

      const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`);
      assert.equal(response.status, 500);
      assert.equal((await json(response)).code, "DIAGNOSTIC_BUNDLE_CORRUPT");
      assert.equal(response.headers.get("content-length"), null);
      assert.equal(opened, false, "authority must bind before storage is opened");
    },
  );

  for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
    it.each(["digest", "oversized", "truncated", "read failure"] as const)(
      `refuses %s during ${phase} without a partial byte response`, async (mutation) => {
        let reads = 0;
        const operations: ("verify" | "prepare")[] = [];
        const h: Harness = await harness({ diagnosticBundles: (real) => ({
          ...real,
          artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
            operations.push(operation);
            reads += 1;
            if (reads !== failOnRead) return;
            if (mutation === "read failure") throw new Error("PRIVATE_STORAGE_PATH");
            writeStoredArtifactEnvelope(h, ref, mutation);
          }),
        }) });
        const bundle = await captureDiagnosticBundle(h);
        const attachment = bundle.attachments[0];
        if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
          { headers: { range: "bytes=0-0" } });
        assert.equal(response.status, 500);
        const body = await json(response);
        assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
        assert.equal(body.retryable, false);
        assert.equal(reads, failOnRead);
        assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"]);
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE_STORAGE_PATH/u);
        assert.equal(response.headers.get("content-range"), null);
        assert.equal(response.headers.get("content-length"), null);
        assert.equal(response.headers.get("cache-control"), "no-store");
      },
    );
  }

  it("refuses a verified attachment Range without returning partial bytes", async () => {
    const h = await harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
      { headers: { range: "bytes=0-0" } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */2");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
    it.each(["identity", "digest", "size", "media type"] as const)(
      `refuses a stored attachment whose physical %s changes during ${phase}`, async (mutation) => {
        let reads = 0;
        const operations: ("verify" | "prepare")[] = [];
        const h: Harness = await harness({ diagnosticBundles: (real) => ({
          ...real,
          artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
            operations.push(operation);
            reads += 1;
            if (reads === failOnRead) {
              writeStoredArtifactEnvelope(h, ref, mutation === "digest" ? "metadata digest" : mutation);
            }
          }),
        }) });
        const bundle = await captureDiagnosticBundle(h);
        const attachment = bundle.attachments[0];
        if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`);
        assert.equal(response.status, 500);
        const body = await json(response);
        assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
        assert.equal(body.retryable, false);
        assert.equal(reads, failOnRead);
        assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"]);
        assert.doesNotMatch(JSON.stringify(body), new RegExp(h.stateRoot, "u"));
        assert.equal(response.headers.get("content-length"), null);
      },
    );
  }

  it.each([
    ["bad bundle", "..%2F..%2Flatest", "00000000-0000-4000-8000-000000000001"],
    ["bad attachment", "00000000-0000-4000-8000-000000000001", "..%2F..%2Flatest"],
  ])("rejects %s before diagnostic authority lookup", async (_case, bundleId, artifactId) => {
    let authorityRead = false;
    const h = await harness({ diagnosticBundles: (real) => ({ ...real, authority: { ...real.authority,
      get: (id) => { authorityRead = true; return real.authority.get(id); },
    } }) });
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundleId}/attachments/${artifactId}`);
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
    assert.equal(authorityRead, false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("refuses an uncomposed bundle attachment capability by kind", async () => {
    const h = await harness({ omitDiagnosticBundles: true });
    const response = await h.app.request("/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000001/attachments/00000000-0000-4000-8000-000000000002");
    assert.equal(response.status, 409);
    assert.equal((await json(response)).code, "SECTION_UNAVAILABLE");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("distinguishes physical missing bytes during diagnostic readback and fresh selected preparation", async () => {
    for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
      let reads = 0;
      const operations: ("verify" | "prepare")[] = [];
      const h: Harness = await harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
          operations.push(operation);
          reads += 1;
          if (reads === failOnRead) {
            rmSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`));
          }
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

      const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
        { headers: { range: "bytes=0-0" } });
      assert.equal(response.status, 500);
      const body = await json(response);
      assert.equal(body.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
      assert.equal(body.retryable, false);
      assert.equal(reads, failOnRead);
      assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"], phase);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(h.stateRoot, "u"));
      assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
      assert.match(String(body.message), new RegExp(attachment.artifactId, "u"));
      assert.equal(response.headers.get("content-length"), null);
      assert.equal(response.headers.get("content-range"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("treats a stored object without diagnostic attachment authority as foreign", async () => {
    const h = await harness();
    const storedOnly = await h.artifacts.put(
      new TextEncoder().encode("storage is not authorization"),
      { mediaType: "text/plain" },
    );

    const response = await h.app.request(`/artifacts/v1/${storedOnly.id}`, {
      headers: { range: "bytes=0-0" },
    });
    const body = await json(response);

    assert.equal(response.status, 404);
    assert.equal(body.code, "TARGET_NOT_FOUND");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(JSON.stringify(body), /storage is not authorization/u);
  });

  it("reports diagnostic artifact readback unavailable when no authority is composed", async () => {
    const h = await harness({ omitDiagnosticBundles: true });

    const response = await h.app.request("/artifacts/v1/00000000-0000-4000-8000-000000000099");
    const body = await json(response);

    assert.equal(response.status, 409);
    assert.equal(body.code, "SECTION_UNAVAILABLE");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("content-length"), null);
  });

  it.each([
    ["non-UUID", "not-an-artifact-id"],
    ["traversal-shaped", "..%2F..%2Flatest"],
  ] as const)("rejects a %s artifact id before authority lookup", async (_case, artifactId) => {
    const h = await harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: () => {
            throw new Error("artifact authority must not see an invalid id");
          },
        },
      }),
    });

    const response = await h.app.request(`/artifacts/v1/${artifactId}`);
    const body = await json(response);

    assert.equal(response.status, 400);
    assert.equal(body.code, "SCHEMA_INVALID");
    assert.doesNotMatch(String(body.message), /artifact authority must not see/u);
  });


});

import { HASH_B,beforeArtifactReaderOperation,captureDiagnosticBundle,disposeHttpRouteHarness,harness as createHarness,json,loopbackResponse,observeArtifactLeaseDisposal,writeStoredArtifactEnvelope,type Harness } from "../../../../support/helpers/backend/http-route-harness.js";
const profiles = createClonedProfileFixtures();
afterEach(disposeHttpRouteHarness);
afterAll(() => profiles.close());
function harness(options?: Parameters<typeof createHarness>[0]) {
  return createHarness({ ...options, profileFixture: profiles.create });
}
