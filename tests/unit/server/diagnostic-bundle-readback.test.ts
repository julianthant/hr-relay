/** E29: durable D137 bundle readback and its browser-safe strict wire. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { DiagnosticBundleWireSchema } from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { DiagnosticAttachmentSchema, DiagnosticBundleSchema } from "../../../src/domain/trust/diagnostic.js";
import { sequentialIdFactory, RUN_ID } from "../fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../fixtures/phase1f-executor-harness.js";
import { HASH_A, HASH_B, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../src/infra/sqlite/storage-records.js";
import { createDiagnosticCaptureService } from "../../../src/services/trust/diagnostic-capture.js";
import { readDiagnosticBundle } from "../../../src/server/dashboard/queries/diagnostic-bundle.js";
import {
  IndexedArtifactBytesMissingError,
  readDiagnosticArtifactBytes,
} from "../../../src/server/dashboard/queries/artifact-bytes.js";
import { DiagnosticBundleCorruptError, TargetNotFoundError } from "../../../src/server/failures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hrauto-diagnostic-readback-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "diagnostic-readback-test" },
    manualClock(new Date(NOW)),
  );
  const artifacts = createContentAddressedArtifactWriter({ workspaceRoot: root, artifactRoot: ".tracker-rebuild/artifacts" });
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const service = createDiagnosticCaptureService({
    authority: database.authority,
    artifacts,
    clock: manualClock(new Date(NOW)),
    ids: sequentialIdFactory("d"),
  });
  database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
  return { root, database, artifacts, service };
}

describe("E29 diagnostic bundle readback", () => {
  it("round-trips the D137 writer through verified bytes and canonical manifest", async () => {
    const { database, artifacts, service } = fixture();
    const bundle = await service.capture({
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
    const result = await readDiagnosticBundle({ authority: database.authority.diagnosticBundles, artifacts }, bundle.bundleId);

    assert.equal(result.wire.bundleId, bundle.bundleId);
    assert.equal(result.wire.capturedAt, bundle.createdAt);
    assert.equal(result.wire.byteSize, bundle.attachments[0]?.byteLength);
    assert.equal(result.wire.contentDigest, bundle.contentDigest);
    assert.equal(result.wire.contents[0]?.artifactId, bundle.attachments[0]?.artifactId);
    assert.deepEqual(JSON.parse(result.manifest), bundle, "manifest is the stored durable row, not a browser reconstruction");
  });

  it("refuses a missing id and a traversal-shaped id", async () => {
    const { database, artifacts } = fixture();
    const deps = { authority: database.authority.diagnosticBundles, artifacts };

    await assert.rejects(() => readDiagnosticBundle(deps, "00000000-0000-4000-8000-000000000099"), TargetNotFoundError);
    await assert.rejects(() => readDiagnosticBundle(deps, "../../latest"), /uuid|invalid/i);
  });

  it("normalizes repository and durable-schema failures to path-free corruption", async () => {
    const { artifacts, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [],
    });
    const localPath = "/private/operator/.tracker-rebuild/state.sqlite";
    const assertSafeCorruption = async (read: () => Promise<unknown>): Promise<void> => {
      await assert.rejects(read, (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.doesNotMatch(error.message, new RegExp(localPath, "u"));
        assert.doesNotMatch(error.message, /Zod|unrecognized|record_json/iu);
        return true;
      });
    };

    await assertSafeCorruption(() => readDiagnosticBundle({
      artifacts,
      authority: {
        get: () => { throw new Error(`failed reading ${localPath}`); },
        listAttachments: () => [],
      },
    }, bundle.bundleId));
    await assertSafeCorruption(() => readDiagnosticBundle({
      artifacts,
      authority: {
        get: () => DiagnosticBundleSchema.parse({ ...bundle, record_json: localPath }),
        listAttachments: () => [],
      },
    }, bundle.bundleId));
    await assertSafeCorruption(() => readDiagnosticBundle({
      artifacts,
      authority: {
        get: () => bundle,
        listAttachments: () => { throw new Error(`index unavailable at ${localPath}`); },
      },
    }, bundle.bundleId));
  });

  it("rejects a foreign durable bundle identity before serving its wire or manifest", async () => {
    const { artifacts, service } = fixture();
    const bundle = await service.capture({
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
        artifacts,
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
    const { artifacts, service } = fixture();
    const bundle = await service.capture({
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
        artifacts,
        authority: {
          get: () => DiagnosticBundleSchema.parse({ ...bundle, contentDigest: "0".repeat(64) }),
          listAttachments: () => [],
        },
      }, bundle.bundleId),
      DiagnosticBundleCorruptError,
    );
  });

  it("compares the attachment index bundle id, created instant and attachment identity", async () => {
    const { database, artifacts, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    const indexed = database.authority.diagnosticBundles.listAttachments(bundle.bundleId);
    const mutations = [
      DiagnosticAttachmentStorageRecordSchema.parse({
        ...indexed[0],
        bundleId: "00000000-0000-4000-8000-000000000122",
      }),
      DiagnosticAttachmentStorageRecordSchema.parse({
        ...indexed[0],
        createdAt: "2026-08-03T09:36:00.000-07:00",
      }),
      DiagnosticAttachmentStorageRecordSchema.parse({
        ...indexed[0],
        attachment: DiagnosticAttachmentSchema.parse({
          ...bundle.attachments[0],
          artifactId: "00000000-0000-4000-8000-000000000123",
        }),
      }),
    ];

    for (const mutation of mutations) {
      await assert.rejects(
        () => readDiagnosticBundle({
          artifacts,
          authority: {
            get: () => bundle,
            listAttachments: () => [mutation],
          },
        }, bundle.bundleId),
        DiagnosticBundleCorruptError,
      );
    }
  });

  it("normalizes missing and corrupt artifact reads to path-free corruption", async () => {
    const { database, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    const authority = database.authority.diagnosticBundles;
    const localPath = "/private/operator/.tracker-rebuild/artifacts/missing";
    const mutations = [
      { open: async () => { throw new Error(`ENOENT ${localPath}`); } },
      { open: async () => Readable.from([new TextEncoder().encode("[corrupt]")]) },
    ];

    for (const artifacts of mutations) {
      await assert.rejects(
        () => readDiagnosticBundle({ authority, artifacts }, bundle.bundleId),
        (error: unknown) => {
          assert.ok(error instanceof DiagnosticBundleCorruptError);
          assert.doesNotMatch(error.message, new RegExp(localPath, "u"));
          return true;
        },
      );
    }
  });

  it("preserves indexed physical absence as a typed verifier error", async () => {
    const { root, database, artifacts, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(join(root, ".tracker-rebuild", "artifacts", `${attachment.digest}.artifact`));

    await assert.rejects(
      () => readDiagnosticArtifactBytes(
        { authority: database.authority.diagnosticBundles, artifacts },
        attachment.artifactId,
      ),
      (error: unknown) => {
        assert.ok(error instanceof IndexedArtifactBytesMissingError);
        assert.match(error.message, new RegExp(attachment.artifactId, "u"));
        assert.doesNotMatch(error.message, new RegExp(root, "u"));
        return true;
      },
    );
  });

  it("refuses an oversized artifact before copying its crossing chunk or pulling another", async () => {
    const { root, database, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    let crossingChunkCopied = false;
    let continuationPulled = false;
    const crossingChunk = new Uint8Array(attachment.byteLength + 1);
    const crossingChunkValues = crossingChunk.values.bind(crossingChunk);
    Object.defineProperty(crossingChunk, Symbol.iterator, {
      value: () => {
        crossingChunkCopied = true;
        return crossingChunkValues();
      },
    });
    const corruptStream = async function* () {
      yield crossingChunk;
      continuationPulled = true;
      yield new Uint8Array(1024 * 1024);
    };

    await assert.rejects(
      () => readDiagnosticArtifactBytes({
        authority: database.authority.diagnosticBundles,
        artifacts: { open: async () => Readable.from(corruptStream(), { highWaterMark: 0 }) },
      }, attachment.artifactId),
      (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.match(error.message, /exceeds the authoritative byte size/u);
        assert.doesNotMatch(error.message, new RegExp(root, "u"));
        return true;
      },
    );
    assert.equal(crossingChunkCopied, false);
    assert.equal(continuationPulled, false);
  });

  it("refuses a foreign identity returned by diagnostic attachment authority", async () => {
    const { database, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const indexed = database.authority.diagnosticBundles.findByArtifact(attachment.artifactId);
    const indexedRow = indexed[0];
    if (indexedRow === undefined) throw new Error("the diagnostic fixture did not index its attachment");
    const foreignArtifactId = "00000000-0000-4000-8000-000000000123";
    const foreignRow = DiagnosticAttachmentStorageRecordSchema.parse({
      ...indexedRow,
      attachment: {
        ...indexedRow.attachment,
        artifactId: foreignArtifactId,
      },
    });
    let artifactOpened = false;

    await assert.rejects(
      () => readDiagnosticArtifactBytes({
        authority: { findByArtifact: () => [foreignRow] },
        artifacts: {
          open: async () => {
            artifactOpened = true;
            return Readable.from([]);
          },
        },
      }, attachment.artifactId),
      (error: unknown) => {
        assert.ok(error instanceof DiagnosticBundleCorruptError);
        assert.match(error.message, /attachment authority returned a foreign artifact identity/u);
        assert.match(error.message, new RegExp(attachment.artifactId, "u"));
        assert.doesNotMatch(error.message, new RegExp(foreignArtifactId, "u"));
        return true;
      },
    );
    assert.equal(artifactOpened, false);
  });

  it("rejects an attachment index with a mismatched artifact id", async () => {
    const { artifacts, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    await assert.rejects(
      () => readDiagnosticBundle({
        artifacts,
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
  });

  it("keeps the wire recursively strict and rejects impossible content dimensions", () => {
    const wire = {
      bundleId: "00000000-0000-4000-8000-000000000001",
      capturedAt: NOW,
      byteSize: 0,
      contentDigest: "a".repeat(64),
      redaction: { fields: [], warnings: [] },
      contents: [],
    };
    assert.equal(DiagnosticBundleWireSchema.safeParse({ ...wire, unexpected: true }).success, false);
    assert.equal(DiagnosticBundleWireSchema.safeParse({
      ...wire,
      contents: [{
        kind: "accessibility-excerpt",
        key: "Accessibility excerpt",
        detail: "text/yaml · 3 bytes · redacted",
        artifactId: "00000000-0000-4000-8000-000000000002",
        mediaType: "text/yaml",
        byteLength: 3,
        digest: "b".repeat(64),
        sensitivity: "redacted",
        width: 10,
      }],
    }).success, false);
  });
});
