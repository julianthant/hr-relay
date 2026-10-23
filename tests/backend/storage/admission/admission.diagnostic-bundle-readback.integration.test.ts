import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { readFileSync,rmSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import {
DiagnosticBundleBytesMissingError,
DiagnosticBundleCorruptError,
TargetNotFoundError,
} from "../../../../src/backend/runs/commands/refusals.js";
import {
createArtifactVerificationPass,
IndexedArtifactBytesMissingError,
prepareDiagnosticArtifactLease,
} from "../../../../src/backend/runs/queries/artifact-bytes.js";
import { readDiagnosticBundle } from "../../../../src/backend/runs/queries/diagnostic-bundle.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import {
createServerVerifiedArtifactReader,
VerifiedArtifactOperationalError,
} from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../../src/backend/storage/sqlite/storage-records.js";
import { ArtifactRefSchema,type ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import {
DiagnosticAttachmentSchema,
DiagnosticBundleSchema,
type DiagnosticBundle,
} from "../../../../src/models/trust/diagnostic.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT,HASH_A,HASH_B,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const JSON_BYTES = Uint8Array.from([0x5b, 0x5d]);

interface Fixture {
  readonly root: string;
  readonly artifactRoot: string;
  readonly database: AuthorityDatabase;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly artifactReader: ReturnType<typeof createServerVerifiedArtifactReader>;
  readonly sourceReads: number[];
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

async function fixture(): Promise<Fixture> {
  const profile = createBoundProfileFixture();
  const root = profile.stateRoot;
  let database: AuthorityDatabase;
  try {
    database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: 'entrypoint' },
      manualClock(new Date(NOW)), undefined, undefined, undefined, boundProfileCredentials(profile.admission),
    );
  } catch (primary) {
    try { profile.close(); }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'diagnostic fixture acquisition failed', { cause: primary }); }
    throw primary;
  }
  disposers.push(() => {
    database.close();
    profile.close();
  });
  const artifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
  const sourceReads: number[] = [];
  const artifactReader = createServerVerifiedArtifactReader({
    admission: profile.admission,
    observeIo(kind, bytes) {
      if (kind === "source-read") sourceReads.push(bytes);
    },
  });
  const readiness = await Promise.allSettled([artifacts.ready, artifactReader.ready]);
  const failures = readiness.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
  if (failures.length > 0) throw new AggregateError(failures, 'diagnostic fixture readiness failed', { cause: failures[0] });
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
  return { root, artifactRoot: profile.admission.artifactRoot, database, artifacts, artifactReader, sourceReads };
}

function captureService(value: Fixture, prefix = "d") {
  return createDiagnosticCaptureService({
    authority: value.database.authority,
    artifacts: value.artifacts,
    clock: manualClock(new Date(NOW)),
    ids: sequentialIdFactory(prefix),
  });
}

async function captureConsoleBundle(
  value: Fixture,
  prefix = "d",
  requestedBy = "local-operator",
): Promise<DiagnosticBundle> {
  return captureService(value, prefix).capture({
    trigger: "operator-request",
    runId: RUN_ID,
    requestedBy,
    configFingerprint: HASH_A,
    descriptorFingerprint: HASH_B,
    fields: [],
    attachments: [{
      kind: "console-summary",
      mediaType: "application/json",
      bytes: JSON_BYTES,
      sensitivity: "redacted",
    }],
  });
}

function bundleDeps(value: Fixture) {
  return {
    runReader: createTrustRunReader(value.database),
    authority: value.database.authority.diagnosticBundles,
    artifactReader: value.artifactReader,
  };
}

function artifactRefOf(attachment: DiagnosticBundle["attachments"][number]): ArtifactRef {
  return ArtifactRefSchema.parse({
    id: attachment.artifactId,
    sha256: attachment.digest,
    bytes: attachment.byteLength,
    mediaType: attachment.mediaType,
  });
}

function artifactPath(value: Fixture, ref: ArtifactRef): string {
  return join(value.artifactRoot, `${ref.sha256}.artifact`);
}

type StoredMutation =
  | "valid"
  | "oversized payload"
  | "truncated payload"
  | "content digest"
  | "stored id"
  | "stored digest"
  | "stored size"
  | "stored media type";

function writeStoredEnvelope(value: Fixture, ref: ArtifactRef, mutation: StoredMutation): void {
  const payloadBase64 = mutation === "oversized payload" ? "W10A"
    : mutation === "truncated payload" ? "Ww=="
      : mutation === "content digest" ? "WF0="
        : "W10=";
  writeFileSync(artifactPath(value, ref), JSON.stringify({
    ref: {
      ...ref,
      ...(mutation === "stored id" ? { id: "00000000-0000-4000-8000-000000000099" } : {}),
      ...(mutation === "stored digest" ? { sha256: "0".repeat(64) } : {}),
      ...(mutation === "stored size" ? { bytes: 3 } : {}),
      ...(mutation === "stored media type" ? { mediaType: "text/plain" } : {}),
    },
    payloadBase64,
  }), "utf8");
}

function sourceBytesRead(value: Fixture): number {
  return value.sourceReads.reduce((total, bytes) => total + bytes, 0);
}

function errorTree(error: unknown): readonly unknown[] {
  if (error instanceof AggregateError) {
    return [error, ...error.errors.flatMap((nested) => errorTree(nested))];
  }
  if (error instanceof Error && error.cause !== undefined) {
    return [error, ...errorTree(error.cause)];
  }
  return [error];
}

async function collectBytes(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

describe("diagnostic bundle readback", () => {
  it("round-trips the writer through verified bytes and canonical manifest", async () => {
    const value = await fixture();
    const bundle = await captureService(value).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [
        { key: "screen", classification: "safe-diagnostic", transform: "allow", value: "crm.onboarding" },
        { key: "employeeName", classification: "sensitive-hr", transform: "digest", value: "Jane Q Public" },
      ],
      attachments: [{
        kind: "accessibility-excerpt",
        mediaType: "text/yaml",
        bytes: new TextEncoder().encode("- button: Submit"),
        sensitivity: "redacted",
      }],
    });

    const result = await readDiagnosticBundle(bundleDeps(value), bundle.bundleId);

    assert.equal(result.wire.bundleId, bundle.bundleId);
    assert.equal(result.wire.capturedAt, bundle.createdAt);
    assert.equal(result.wire.byteSize, bundle.attachments[0]?.byteLength);
    assert.equal(result.wire.contentDigest, bundle.contentDigest);
    assert.equal(result.wire.contents[0]?.artifactId, bundle.attachments[0]?.artifactId);
    assert.deepEqual(JSON.parse(result.manifest), bundle, "manifest is the stored durable row, not a browser reconstruction");
    assert.ok(sourceBytesRead(value) > 0, "the query must use the real incremental reader");
  });

  it("refuses a missing id and a traversal-shaped id", async () => {
    const value = await fixture();
    const deps = bundleDeps(value);

    await assert.rejects(() => readDiagnosticBundle(deps, "00000000-0000-4000-8000-000000000099"), TargetNotFoundError);
    await assert.rejects(() => readDiagnosticBundle(deps, "../../../../../latest"), /uuid|invalid/i);
  });

  it("normalizes repository and durable-schema failures to path-free corruption", async () => {
    const value = await fixture();
    const bundle = await captureService(value).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [],
    });
    const localPath = "/private/operator/.tracker/state.sqlite";
    const assertSafeCorruption = async (read: () => Promise<unknown>): Promise<void> => {
      await assert.rejects(read, (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.doesNotMatch(error.message, new RegExp(localPath, "u"));
        assert.doesNotMatch(error.message, /Zod|unrecognized|record_json/iu);
        return true;
      });
    };

    await assertSafeCorruption(() => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
      artifactReader: value.artifactReader,
      authority: {
        get: () => { throw new Error(`failed reading ${localPath}`); },
        listAttachments: () => [],
      },
    }, bundle.bundleId));
    await assertSafeCorruption(() => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
      artifactReader: value.artifactReader,
      authority: {
        get: () => DiagnosticBundleSchema.parse({ ...bundle, record_json: localPath }),
        listAttachments: () => [],
      },
    }, bundle.bundleId));
    await assertSafeCorruption(() => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
      artifactReader: value.artifactReader,
      authority: {
        get: () => bundle,
        listAttachments: () => { throw new Error(`index unavailable at ${localPath}`); },
      },
    }, bundle.bundleId));
  });

  it("rejects a foreign durable bundle identity before serving its wire or manifest", async () => {
    const value = await fixture();
    const bundle = await captureService(value).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [],
    });
    const requestedBundleId = "00000000-0000-4000-8000-000000000904";
    const foreignBundleId = "00000000-0000-4000-8000-000000000999";

    await assert.rejects(
      () => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
        artifactReader: value.artifactReader,
        authority: {
          get: () => DiagnosticBundleSchema.parse({ ...bundle, bundleId: foreignBundleId }),
          listAttachments: () => {
            throw new Error("attachment index must not be read for a foreign authority row");
          },
        },
      }, requestedBundleId),
      (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.match(error.message, new RegExp(requestedBundleId, "u"));
        assert.match(error.message, /durable authority identity mismatch/u);
        assert.doesNotMatch(error.message, new RegExp(foreignBundleId, "u"));
        assert.doesNotMatch(error.message, /attachment index must not be read/u);
        return true;
      },
    );
  });

  it("rejects a bad bundle digest", async () => {
    const value = await fixture();
    const bundle = await captureService(value).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [],
    });

    await assert.rejects(
      () => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
        artifactReader: value.artifactReader,
        authority: {
          get: () => DiagnosticBundleSchema.parse({ ...bundle, contentDigest: "0".repeat(64) }),
          listAttachments: () => [],
        },
      }, bundle.bundleId),
      DiagnosticBundleCorruptError,
    );
  });

  it("compares the attachment index bundle id, created instant and attachment identity before byte I/O", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const indexed = value.database.authority.diagnosticBundles.listAttachments(bundle.bundleId);
    const indexedRow = indexed[0];
    if (indexedRow === undefined) throw new Error("the diagnostic fixture did not index its attachment");
    const mutations = [
      DiagnosticAttachmentStorageRecordSchema.parse({
        ...indexedRow,
        bundleId: "00000000-0000-4000-8000-000000000122",
      }),
      DiagnosticAttachmentStorageRecordSchema.parse({
        ...indexedRow,
        createdAt: "2026-08-03T09:36:00.000-07:00",
      }),
      DiagnosticAttachmentStorageRecordSchema.parse({
        ...indexedRow,
        attachment: DiagnosticAttachmentSchema.parse({
          ...bundle.attachments[0],
          artifactId: "00000000-0000-4000-8000-000000000123",
        }),
      }),
    ];

    for (const mutation of mutations) {
      value.sourceReads.length = 0;
      await assert.rejects(
        () => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
          artifactReader: value.artifactReader,
          authority: {
            get: () => bundle,
            listAttachments: () => [mutation],
          },
        }, bundle.bundleId),
        DiagnosticBundleCorruptError,
      );
      assert.deepEqual(value.sourceReads, []);
    }
  });

  it.each(["missing", "corrupt"] as const)(
    "preserves a %s physical artifact as a typed path-free bundle failure",
    async (mutation) => {
      const value = await fixture();
      const bundle = await captureConsoleBundle(value);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const ref = artifactRefOf(attachment);
      if (mutation === "missing") rmSync(artifactPath(value, ref));
      else writeFileSync(artifactPath(value, ref), JSON.stringify({ changed: true }), "utf8");

      await assert.rejects(
        () => readDiagnosticBundle(bundleDeps(value), bundle.bundleId),
        (error: unknown) => {
          if (mutation === "missing") assert.ok(error instanceof DiagnosticBundleBytesMissingError);
          else assert.ok(error instanceof DiagnosticBundleCorruptError);
          assert.match(error.message, new RegExp(bundle.bundleId, "u"));
          assert.match(error.message, new RegExp(attachment.artifactId, "u"));
          assert.doesNotMatch(error.message, new RegExp(value.root, "u"));
          return true;
        },
      );
    },
  );

  it("keeps a multi-attachment missing/corrupt result in the typed bundle failure family", async () => {
    const value = await fixture();
    const bundle = await captureService(value).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [
        {
          kind: "console-summary",
          mediaType: "application/json",
          bytes: JSON_BYTES,
          sensitivity: "redacted",
        },
        {
          kind: "accessibility-excerpt",
          mediaType: "text/yaml",
          bytes: new TextEncoder().encode("- button: Retry"),
          sensitivity: "redacted",
        },
      ],
    });
    const [missing, corrupt] = bundle.attachments;
    if (missing === undefined || corrupt === undefined) throw new Error("the diagnostic fixture lacks both attachments");
    rmSync(artifactPath(value, artifactRefOf(missing)));
    writeFileSync(artifactPath(value, artifactRefOf(corrupt)), JSON.stringify({ changed: true }), "utf8");

    await assert.rejects(readDiagnosticBundle(bundleDeps(value), bundle.bundleId), (error: unknown) => {
      assert.ok(error instanceof DiagnosticBundleBytesMissingError);
      const tree = errorTree(error);
      assert.ok(tree.some((entry) => entry instanceof DiagnosticBundleBytesMissingError));
      assert.ok(tree.some((entry) => entry instanceof DiagnosticBundleCorruptError
        && !(entry instanceof DiagnosticBundleBytesMissingError)));
      assert.match(error.message, new RegExp(bundle.bundleId, "u"));
      assert.doesNotMatch(error.message, new RegExp(value.root, "u"));
      return true;
    });
  });

  it.each(["operational-and-missing", "two-operational"] as const)(
    "keeps %s multi-attachment failures operational and retains every cause",
    async (failureShape) => {
      const value = await fixture();
      const bundle = await captureService(value).capture({
        trigger: "operator-request",
        runId: RUN_ID,
        requestedBy: "local-operator",
        configFingerprint: HASH_A,
        descriptorFingerprint: HASH_B,
        fields: [],
        attachments: [
          {
            kind: "console-summary",
            mediaType: "application/json",
            bytes: JSON_BYTES,
            sensitivity: "redacted",
          },
          {
            kind: "accessibility-excerpt",
            mediaType: "text/yaml",
            bytes: new TextEncoder().encode("- button: Retry"),
            sensitivity: "redacted",
          },
        ],
      });
      const [first, second] = bundle.attachments;
      if (first === undefined || second === undefined) throw new Error("the diagnostic fixture lacks both attachments");
      const firstFailure = new VerifiedArtifactOperationalError({ cause: new Error("PRIVATE_FIRST_STORAGE_FAILURE") });
      const secondFailure = new VerifiedArtifactOperationalError({ cause: new Error("PRIVATE_SECOND_STORAGE_FAILURE") });
      if (failureShape === "operational-and-missing") rmSync(artifactPath(value, artifactRefOf(second)));
      const reader = Object.freeze({
        async verify(ref: ArtifactRef, signal?: AbortSignal) {
          signal?.throwIfAborted();
          if (ref.id === first.artifactId) throw firstFailure;
          if (failureShape === "two-operational" && ref.id === second.artifactId) throw secondFailure;
          await value.artifactReader.verify(ref, signal);
        },
        prepare: (ref: ArtifactRef, signal?: AbortSignal) => value.artifactReader.prepare(ref, signal),
      });

      await assert.rejects(readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
        authority: value.database.authority.diagnosticBundles,
        artifactReader: reader,
      }, bundle.bundleId), (error: unknown) => {
        assert.ok(error instanceof VerifiedArtifactOperationalError);
        assert.equal(error.message, "verified artifact storage operation failed");
        const tree = errorTree(error);
        assert.ok(tree.includes(firstFailure));
        if (failureShape === "two-operational") assert.ok(tree.includes(secondFailure));
        else assert.ok(tree.some((entry) => entry instanceof DiagnosticBundleBytesMissingError));
        assert.doesNotMatch(error.message, /PRIVATE_/u);
        return true;
      });
    },
  );

  it("reuses one completed exact-ref proof within a request pass and a new pass re-verifies", async () => {
    const value = await fixture();
    const first = await captureConsoleBundle(value, "d", "local-operator");
    const second = await captureConsoleBundle(value, "e", "review-operator");
    const firstAttachment = first.attachments[0];
    const secondAttachment = second.attachments[0];
    if (firstAttachment === undefined || secondAttachment === undefined) {
      throw new Error("the diagnostic fixtures did not write their shared attachment");
    }
    assert.notEqual(first.bundleId, second.bundleId);
    assert.notDeepEqual(first.origin, second.origin);
    assert.notEqual(first.contentDigest, second.contentDigest);
    assert.deepEqual(secondAttachment, firstAttachment);
    const envelopeByteLength = readFileSync(artifactPath(value, artifactRefOf(firstAttachment))).byteLength;
    const pass = createArtifactVerificationPass(value.artifactReader);

    const firstReadback = await readDiagnosticBundle(bundleDeps(value), first.bundleId, pass);
    const secondReadback = await readDiagnosticBundle(bundleDeps(value), second.bundleId, pass);

    assert.equal(firstReadback.wire.bundleId, first.bundleId);
    assert.equal(secondReadback.wire.bundleId, second.bundleId);
    assert.equal(sourceBytesRead(value), envelopeByteLength);
    await readDiagnosticBundle(
      bundleDeps(value),
      first.bundleId,
      createArtifactVerificationPass(value.artifactReader),
    );
    assert.equal(sourceBytesRead(value), envelopeByteLength * 2);
  });

  it("refuses an aborted request before reusing its completed exact-ref proof", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = artifactRefOf(attachment);
    const envelopeByteLength = readFileSync(artifactPath(value, ref)).byteLength;
    const controller = new AbortController();
    const pass = createArtifactVerificationPass(value.artifactReader, controller.signal);

    await pass.verify(ref);
    const reason = new Error("request disconnected after exact-ref verification");
    controller.abort(reason);

    await assert.rejects(pass.verify(ref), (error: unknown) => error === reason);
    assert.equal(sourceBytesRead(value), envelopeByteLength, "an aborted cache hit must refuse without reopening bytes");
  });

  it("preserves the exact request abort through bundle and generic byte queries", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const reason = new Error("request disconnected before diagnostic verification");
    const controller = new AbortController();
    controller.abort(reason);

    await assert.rejects(
      readDiagnosticBundle(bundleDeps(value), bundle.bundleId, undefined, controller.signal),
      (error: unknown) => error === reason,
    );
    await assert.rejects(
      prepareDiagnosticArtifactLease({
        authority: value.database.authority.diagnosticBundles,
        artifactReader: value.artifactReader,
      }, attachment.artifactId, controller.signal),
      (error: unknown) => error === reason,
    );
  });

  it("never shares a completed proof between conflicting exact refs", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = artifactRefOf(attachment);
    const conflicting = ArtifactRefSchema.parse({ ...ref, mediaType: "text/plain" });
    const envelopeByteLength = readFileSync(artifactPath(value, ref)).byteLength;
    const pass = createArtifactVerificationPass(value.artifactReader);

    await pass.verify(ref);
    await assert.rejects(pass.verify(conflicting), /metadata does not match stored content/u);

    assert.equal(sourceBytesRead(value), envelopeByteLength * 2);
  });

  it("does not retain a failed verification as a completed pass proof", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = artifactRefOf(attachment);
    const pass = createArtifactVerificationPass(value.artifactReader);
    writeFileSync(artifactPath(value, ref), JSON.stringify({ changed: true }), "utf8");
    const invalidEnvelopeByteLength = readFileSync(artifactPath(value, ref)).byteLength;

    await assert.rejects(pass.verify(ref), /stored envelope has unknown properties/u);
    writeStoredEnvelope(value, ref, "valid");
    const validEnvelopeByteLength = readFileSync(artifactPath(value, ref)).byteLength;
    await pass.verify(ref);

    assert.equal(sourceBytesRead(value), invalidEnvelopeByteLength + validEnvelopeByteLength);
  });

  it("preserves indexed physical absence as a typed verifier error", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(artifactPath(value, artifactRefOf(attachment)));

    await assert.rejects(
      () => prepareDiagnosticArtifactLease({
        authority: value.database.authority.diagnosticBundles,
        artifactReader: value.artifactReader,
      }, attachment.artifactId),
      (error: unknown) => {
        assert.ok(error instanceof IndexedArtifactBytesMissingError);
        assert.match(error.message, new RegExp(attachment.artifactId, "u"));
        assert.doesNotMatch(error.message, new RegExp(value.root, "u"));
        return true;
      },
    );
  });

  it("returns an exact retained single-use byte lease with no source tails", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const result = await prepareDiagnosticArtifactLease({
      authority: value.database.authority.diagnosticBundles,
      artifactReader: value.artifactReader,
    }, attachment.artifactId);
    try {
      assert.deepEqual(result.ref, artifactRefOf(attachment));
      writeStoredEnvelope(value, result.ref, "oversized payload");
      const body = await result.lease.takeBody();
      await assert.rejects(result.lease.takeBody(), /single-use/u);
      const bytes = await collectBytes(body);
      assert.deepEqual([...bytes], [0x5b, 0x5d]);
      assert.equal(bytes.byteLength, 2);
    } finally {
      await result.lease.dispose();
      await result.lease.dispose();
    }
  });

  it.each([
    "oversized payload",
    "truncated payload",
    "content digest",
    "stored id",
    "stored digest",
    "stored size",
    "stored media type",
  ] as const)("refuses %s before publishing a generic byte lease", async (mutation) => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = artifactRefOf(attachment);
    writeStoredEnvelope(value, ref, mutation);

    await assert.rejects(
      () => prepareDiagnosticArtifactLease({
        authority: value.database.authority.diagnosticBundles,
        artifactReader: value.artifactReader,
      }, attachment.artifactId),
      (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.match(error.message, new RegExp(attachment.artifactId, "u"));
        assert.doesNotMatch(error.message, new RegExp(value.root, "u"));
        return true;
      },
    );
    assert.ok(sourceBytesRead(value) > 0, "the refusal must come from complete lower-reader inspection");
  });

  it("refuses conflicting metadata for one indexed artifact before reader I/O", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const indexed = value.database.authority.diagnosticBundles.findByArtifact(attachment.artifactId);
    const indexedRow = indexed[0];
    if (indexedRow === undefined) throw new Error("the diagnostic fixture did not index its attachment");
    const conflictingRow = DiagnosticAttachmentStorageRecordSchema.parse({
      ...indexedRow,
      bundleId: "00000000-0000-4000-8000-000000000123",
      attachment: {
        kind: "accessibility-excerpt",
        artifactId: attachment.artifactId,
        mediaType: "text/yaml",
        byteLength: attachment.byteLength + 1,
        digest: HASH_A,
        sensitivity: "redacted",
      },
    });

    await assert.rejects(
      () => prepareDiagnosticArtifactLease({
        authority: { findByArtifact: () => [indexedRow, conflictingRow] },
        artifactReader: value.artifactReader,
      }, attachment.artifactId),
      (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.match(error.message, /attachment authority contains conflicting artifact metadata/u);
        assert.match(error.message, new RegExp(attachment.artifactId, "u"));
        return true;
      },
    );
    assert.deepEqual(value.sourceReads, []);
  });

  it("rejects an attachment index with a mismatched artifact id before reader I/O", async () => {
    const value = await fixture();
    const bundle = await captureConsoleBundle(value);

    await assert.rejects(
      () => readDiagnosticBundle({
        runReader: createTrustRunReader(value.database),
        artifactReader: value.artifactReader,
        authority: {
          get: () => bundle,
          listAttachments: () => [{
            bundleId: bundle.bundleId,
            attachment: DiagnosticAttachmentSchema.parse({
              ...bundle.attachments[0],
              artifactId: "00000000-0000-4000-8000-000000000123",
            }),
            createdAt: bundle.createdAt,
          }],
        },
      }, bundle.bundleId),
      DiagnosticBundleCorruptError,
    );
    assert.deepEqual(value.sourceReads, []);
  });
});
