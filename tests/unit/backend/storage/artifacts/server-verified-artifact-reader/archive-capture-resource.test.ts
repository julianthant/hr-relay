import { inMemoryRunReaderFake } from "../../../../../support/helpers/canonical-run-reader.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
/** Archived evidence reads bytes only through its frozen tile. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, it, vi } from "vitest";
import {
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  archivedRunContentDigest,
  type ArchivedRunRecord,
  type ArchivedRunContent,
} from "../../../../../../src/models/archive/model.js";
import { ArchivedCaptureResourceWireSchema } from "../../../../../../src/models/dashboard/archive.js";
import { ArchivedCaptureTileSchema, type ArchivedCaptureTile } from "../../../../../../src/models/archive/sections.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../../../../src/models/artifacts/artifacts.js";
import {
  VerifiedArtifactSourceMissingError,
  type ServerVerifiedArtifactReader,
  type VerifiedByteLease,
} from "../../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import {
  buildArchivedCaptureResource,
  prepareArchivedCaptureLease,
} from "../../../../../../src/backend/runs/queries/archive.js";
import type { AuthorityRepositories } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { ARCHIVED_RUN_WITH_SECTIONS } from "../../../../../support/fixtures/archive-fixtures.js";

const ARTIFACT_ID = "00000000-0000-4000-8000-000000000917";
const BUNDLE_ID = "00000000-0000-4000-8000-000000000918";
const BYTES = new TextEncoder().encode("archived capture bytes");

function seal(content: ArchivedRunContent): ArchivedRunRecord {
  return ArchivedRunRecordSchema.parse({ ...content, contentDigest: archivedRunContentDigest(content) });
}

function archivedRecordWithCapture(change?: (tile: ArchivedCaptureTile) => readonly unknown[]): ArchivedRunRecord {
  const { contentDigest: _digest, ...stored } = ARCHIVED_RUN_WITH_SECTIONS;
  const content = ArchivedRunContentSchema.parse({
    ...stored,
    sections: {
      ...stored.sections!,
      captures: {
        state: "present",
        value: [{
          artifactId: ARTIFACT_ID,
          bundleId: BUNDLE_ID,
          kind: "screenshot",
          mediaType: "image/png",
          byteLength: BYTES.byteLength,
          digest: createHash("sha256").update(BYTES).digest("hex"),
          sensitivity: "redacted",
          capturedAt: "2026-08-20T09:11:00.000Z",
          origin: "operator-request",
          dimensions: { width: 200, height: 100 },
          step: { state: "present", nodeId: "ucpath-person" },
          system: { state: "present", value: "ucpath" },
          // Already elapsed: this is a policy fact, never a purge observation.
          retention: { kind: "ordinary", purgeAfter: "2020-01-01T00:00:00.000Z" },
        }],
      },
    },
  });
  assert.ok(content.sections?.captures.state === "present");
  const tile = content.sections.captures.value[0];
  assert.ok(tile);
  if (change !== undefined) content.sections.captures.value = change(tile).map((value) => ArchivedCaptureTileSchema.parse(value));
  return seal(content);
}

async function readFixtureBytes(
  open: (ref: ArtifactRef) => Promise<Readable>,
  ref: ArtifactRef,
): Promise<Uint8Array> {
  let stream: Readable;
  try {
    stream = await open(ref);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new VerifiedArtifactSourceMissingError({ cause: error });
    }
    throw error;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("fixture artifact reader received a non-byte chunk");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== ref.bytes) throw new Error("fixture artifact reader observed a byte-size mismatch");
  if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256) {
    throw new Error("fixture artifact reader observed a digest mismatch");
  }
  return bytes;
}

function fixtureLease(ref: ArtifactRef, bytes: Uint8Array): VerifiedByteLease {
  let taken = false;
  let disposed = false;
  return Object.freeze({
    ref: Object.freeze(ref),
    async takeBody() {
      if (taken || disposed) throw new Error("fixture lease is not available");
      taken = true;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from(bytes));
          controller.close();
        },
      });
    },
    async dispose() {
      disposed = true;
    },
  });
}

function deps(record: ArchivedRunRecord | undefined, open: (ref: ArtifactRef) => Promise<Readable>, canonicalId: string = ARCHIVED_RUN_WITH_SECTIONS.runId) {
  const artifactReader: ServerVerifiedArtifactReader = Object.freeze({
    async verify(ref: ArtifactRef) {
      await readFixtureBytes(open, ref);
    },
    async prepare(ref: ArtifactRef) {
      return fixtureLease(ref, await readFixtureBytes(open, ref));
    },
  });
  const run = RunRecordSchema.parse({ ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, runId: canonicalId },
    lifecycle: { state: "terminal", outcome: "done", endedAt: ARCHIVED_RUN_WITH_SECTIONS.archivedAt },
    version: 2, claimGeneration: 1,
    completion: { schemaVersion: 1, kind: "done", expectedVersion: 1, claim: { workerId: "archive-fixture", claimGeneration: 1 }, authorizedAt: ARCHIVED_RUN_WITH_SECTIONS.archivedAt, resultDigest: "a".repeat(64) },
  });
  return {
    reader: inMemoryRunReaderFake({ records: new Map(record === undefined ? [] : [[run.envelope.runId, run]]),
      archived: new Set([run.envelope.runId]), deleted: new Map(), generation: 1,
    }),
    authority: {
      withAuthorityTransaction: <Result>(work: (repositories: AuthorityRepositories) => Result): Result => work({
        archivedRuns: { get: () => record },
        get runs() { throw new Error("archive resources must not consult current runs"); },
        get diagnosticBundles() { throw new Error("archive resources must not consult the current index"); },
      } as unknown as AuthorityRepositories),
    },
    artifactReader,
  };
}

describe("archived capture resource", () => {
  it("prepares an opaque single-use lease from the exact frozen tile", async () => {
    const record = archivedRecordWithCapture();
    const ref = ArtifactRefSchema.parse({
      id: ARTIFACT_ID,
      sha256: createHash("sha256").update(BYTES).digest("hex"),
      bytes: BYTES.byteLength,
      mediaType: "image/png",
    });
    const lease: VerifiedByteLease = Object.freeze({
      ref: Object.freeze(ref),
      takeBody: async () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(BYTES);
          controller.close();
        },
      }),
      dispose: async () => undefined,
    });
    const prepare = vi.fn(async (actualRef: ArtifactRef) => {
      assert.deepEqual(actualRef, ref);
      return lease;
    });
    const artifactReader: ServerVerifiedArtifactReader = Object.freeze({
      verify: async () => undefined,
      prepare,
    });
    const dependencies = { ...deps(record, async () => Readable.from([BYTES])), artifactReader };

    const result = await prepareArchivedCaptureLease(dependencies, record.runId, ARTIFACT_ID);

    assert.equal("lease" in result, true);
    if (!("lease" in result)) throw new Error("archived capture read did not return a verified-byte lease");
    assert.equal(result.lease, lease);
    assert.equal(prepare.mock.calls.length, 1);
  });

  it("verifies only the exact frozen tile before declaring retained bytes available", async () => {
    const record = archivedRecordWithCapture();
    let observedRef: unknown;
    const result = await buildArchivedCaptureResource(deps(record, async (ref) => {
      observedRef = ref;
      return Readable.from([BYTES]);
    }), record.runId, ARTIFACT_ID);

    assert.deepEqual(observedRef, {
      id: ARTIFACT_ID,
      sha256: createHash("sha256").update(BYTES).digest("hex"),
      bytes: BYTES.byteLength,
      mediaType: "image/png",
    });
    assert.deepEqual(result, {
      runId: record.runId,
      artifactId: ARTIFACT_ID,
      resource: {
        state: "available",
        downloadUrl: `/artifacts/v1/archive/${record.runId}/${ARTIFACT_ID}`,
      },
    });
  });

  it("reports physical absence without inventing a policy-derived purge", async () => {
    const record = archivedRecordWithCapture();
    const result = await buildArchivedCaptureResource(deps(record, async () => {
      const error = Object.assign(new Error("gone"), { code: "ENOENT" });
      throw error;
    }), record.runId, ARTIFACT_ID);

    assert.deepEqual(result.resource, {
      state: "missing",
      reason: "The archived capture's stored bytes are no longer present.",
    });
  });

  it("keeps digest corruption distinct from physical absence", async () => {
    const record = archivedRecordWithCapture();
    const result = await buildArchivedCaptureResource(deps(record, async () => Readable.from([
      new TextEncoder().encode("Archived capture bytes"),
    ])), record.runId, ARTIFACT_ID);

    assert.deepEqual(result.resource, {
      state: "error",
      message: "The archived capture bytes could not be verified.",
    });
  });

  it("refuses a capture that is not named by this archived run's frozen tile", async () => {
    const record = archivedRecordWithCapture();
    const open = vi.fn(async () => Readable.from([BYTES]));
    await assert.rejects(
      () => prepareArchivedCaptureLease(deps(record, open), record.runId,
        "00000000-0000-4000-8000-000000000919"),
      /has no frozen capture/u,
    );
    assert.equal(open.mock.calls.length, 0);
  });

  for (const read of [buildArchivedCaptureResource, prepareArchivedCaptureLease]) {
    describe(read.name, () => {
      it("refuses a foreign archive returned by the repository before opening bytes", async () => {
        const record = archivedRecordWithCapture();
        const open = vi.fn(async () => Readable.from([BYTES]));
        await assert.rejects(() => read(deps(record, open, BUNDLE_ID), BUNDLE_ID, ARTIFACT_ID), /foreign archived run identity/u);
        assert.equal(open.mock.calls.length, 0);
      });

      it("refuses changed frozen content under the original archive digest", async () => {
        const record = archivedRecordWithCapture();
        const open = vi.fn(async () => Readable.from([BYTES]));
        const tampered = ArchivedRunRecordSchema.parse({ ...record, contentDigest: "0".repeat(64) });
        await assert.rejects(() => read(deps(tampered, open), record.runId, ARTIFACT_ID), /content digest mismatch/u);
        assert.equal(open.mock.calls.length, 0);
      });

      for (const field of ["digest", "byteLength", "mediaType"] as const) {
        it(`refuses duplicate artifact ids with conflicting ${field}`, async () => {
          const record = archivedRecordWithCapture((tile) => [tile, {
            ...tile,
            bundleId: ARTIFACT_ID,
            [field]: { digest: "0".repeat(64), byteLength: 999, mediaType: "image/jpeg" }[field],
          }]);
          const open = vi.fn(async () => Readable.from([BYTES]));
          await assert.rejects(() => read(deps(record, open), record.runId, ARTIFACT_ID), /conflicting frozen capture metadata/u);
          assert.equal(open.mock.calls.length, 0);
        });
      }

      it("admits repeated bundle tiles only when their complete byte reference agrees", async () => {
        const record = archivedRecordWithCapture((tile) => [tile, { ...tile, bundleId: ARTIFACT_ID }]);
        const result = await read(deps(record, async () => Readable.from([BYTES])), record.runId, ARTIFACT_ID);
        if ("lease" in result) {
          assert.deepEqual(
            new Uint8Array(await new Response(await result.lease.takeBody()).arrayBuffer()),
            BYTES,
          );
        }
        else assert.equal(result.resource.state, "available");
      });

      for (const [runId, artifactId] of [["../../../latest", ARTIFACT_ID], [BUNDLE_ID, "../../../latest"], [undefined, ARTIFACT_ID], [BUNDLE_ID, null]]) {
        it(`rejects malformed exact-id input ${String(runId)}/${String(artifactId)} before authority`, async () => {
          const dependencies = deps(archivedRecordWithCapture(), async () => Readable.from([BYTES]));
          const transaction = vi.spyOn(dependencies.authority, "withAuthorityTransaction");
          await assert.rejects(() => read(dependencies, runId, artifactId), /uuid|invalid/i);
          assert.equal(transaction.mock.calls.length, 0);
        });
      }

      it("names absent archives without opening arbitrary stored objects", async () => {
        const open = vi.fn(async () => Readable.from([BYTES]));
        await assert.rejects(() => read(deps(undefined, open), BUNDLE_ID, ARTIFACT_ID), /archived run .* is absent/u);
        assert.equal(open.mock.calls.length, 0);
      });

      it("preserves a missing frozen-capture section as absence", async () => {
        const { contentDigest: _digest, ...content } = archivedRecordWithCapture();
        assert.ok(content.sections);
        content.sections.captures = { state: "absent", reason: "No captures were recorded." };
        const record = seal(content);
        const open = vi.fn(async () => Readable.from([BYTES]));
        await assert.rejects(() => read(deps(record, open), record.runId, ARTIFACT_ID), /no frozen capture metadata/u);
        assert.equal(open.mock.calls.length, 0);
      });
    });
  }

  it("verifies availability without copying the stream into an assembled buffer", async () => {
    const record = archivedRecordWithCapture();
    const set = vi.spyOn(Uint8Array.prototype, "set");
    try {
      const result = await buildArchivedCaptureResource(deps(record, async () => Readable.from([BYTES])), record.runId, ARTIFACT_ID);
      assert.equal(result.resource.state, "available");
      assert.equal(set.mock.calls.filter(([source]) => source === BYTES).length, 0);
    } finally {
      set.mockRestore();
    }
  });

  it("returns exact bytes only through its single-use lease", async () => {
    const record = archivedRecordWithCapture();
    const result = await prepareArchivedCaptureLease(deps(record, async () => Readable.from([BYTES.subarray(0, 4), BYTES.subarray(4)])), record.runId, ARTIFACT_ID);
    const body = await result.lease.takeBody();
    assert.deepEqual(new Uint8Array(await new Response(body).arrayBuffer()), BYTES);
    await assert.rejects(() => result.lease.takeBody(), /single-use|not available/u);
  });

  for (const downloadUrl of ["https://foreign.example/capture", `/artifacts/v1/archive/${BUNDLE_ID}/${ARTIFACT_ID}`, `/artifacts/v1/archive/${ARCHIVED_RUN_WITH_SECTIONS.runId}/${BUNDLE_ID}`]) {
    it(`refuses a foreign available-resource URL ${downloadUrl}`, () => {
      assert.equal(ArchivedCaptureResourceWireSchema.safeParse({
        runId: ARCHIVED_RUN_WITH_SECTIONS.runId, artifactId: ARTIFACT_ID,
        resource: { state: "available", downloadUrl },
      }).success, false);
    });
  }
});
