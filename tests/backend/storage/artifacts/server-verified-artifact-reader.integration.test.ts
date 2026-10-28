import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir,mkdtemp,readFile,readdir,realpath,rm,symlink,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import type {
VerifiedArtifactIoKind,
} from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { ArtifactRefSchema,type ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";

const ARTIFACT_ROOT = ".tracker/data/artifacts";
const SMALL_BYTES = Uint8Array.from([0x00, 0x10, 0x7f, 0x80, 0xff]);

it("uses disjoint admitted roots and refuses storage after release", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hrauto-disjoint-artifact-roots-"));
  const stateRoot = join(workspace, "state");
  const artifactRoot = join(workspace, "payloads");
  const admission = RuntimeAdmission.syntheticRoots(stateRoot, artifactRoot);
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    const ref = await writer.put(SMALL_BYTES, { mediaType: "application/octet-stream" });
    const reader = createServerVerifiedArtifactReader({ admission });
    const lease = await reader.prepare(ref);
    assert.deepEqual(await readdir(artifactRoot), [`${ref.sha256}.artifact`]);
    assert.deepEqual(await readdir(join(stateRoot, "scratch")), []);
    admission.release();
    await assert.rejects(writer.put(SMALL_BYTES, { mediaType: "application/octet-stream" }), /released admission/);
    await assert.rejects(writer.open(ref), /released admission/);
    await assert.rejects(reader.verify(ref), /released admission/);
    await assert.rejects(lease.takeBody(), /released admission/);
  } finally {
    admission.release();
    await rm(workspace, { recursive: true, force: true });
  }
});

it("closes snapshot and source when admission is released during snapshotting", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-snapshot-revoke-"));
  const admission = RuntimeAdmission.syntheticRoots(join(workspace, "state"), join(workspace, "artifacts"));
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    const ref = await writer.put(SMALL_BYTES, { mediaType: "application/octet-stream" });
    const closed: string[] = [];
    let leaseClosed = 0;
    let revoked = false;
    const reader = createServerVerifiedArtifactReader({
      admission,
      observeIo(kind) {
        if (kind === "snapshot-write" && !revoked) {
          revoked = true;
          admission.release();
        }
      },
      observeHandleClosed(kind) { closed.push(kind); },
      observeLeaseClosed() { leaseClosed += 1; },
    });
    await reader.ready;
    await assert.rejects(reader.prepare(ref), /released admission/u);
    assert.equal(revoked, true);
    assert.deepEqual(closed, ["source", "snapshot"]);
    assert.equal(leaseClosed, 0);
    assert.deepEqual(await readdir(join(workspace, "state", "scratch")), []);
  } finally {
    admission.release();
    await rm(workspace, { recursive: true, force: true });
  }
});

it("refuses writable artifact services during current existing-authority inspection", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "hrauto-artifact-adoption-")));
  const lifetime = await runtimeLifetimeLock();
  const stateRoot = join(workspace, ".tracker/data");
  try {
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(stateRoot, "state.db"), "existing authority evidence");
    assert.throws(() => RuntimeAdmission.acquireInitial(workspace, lifetime, (_pair, inspection) => {
      assert.throws(() => createContentAddressedArtifactWriter({ admission: inspection }), /read-only/u);
      assert.throws(() => createServerVerifiedArtifactReader({ admission: inspection }), /read-only/u);
      throw new Error("inspection-tested");
    }, () => { throw new Error("fresh initializer must not run for existing authority"); }), /inspection-tested/u);
    assert.deepEqual(await readdir(stateRoot), ["state.db"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

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

async function collectNodeBytes(body: AsyncIterable<Uint8Array | string>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Uint8Array.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function withWrittenArtifact(
  bytes: Uint8Array,
  run: (fixture: Readonly<{ workspace: string; ref: ArtifactRef }>) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "hrauto-server-artifact-reader-"));
  try {
    const writer = createContentAddressedArtifactWriter({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });
    const ref = await writer.put(bytes, { mediaType: "application/octet-stream" });
    await run(Object.freeze({ workspace, ref }));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function writeStoredEnvelope(workspace: string, ref: ArtifactRef, envelope: string): Promise<void> {
  await writeFile(join(workspace, ARTIFACT_ROOT, `${ref.sha256}.artifact`), envelope, "utf8");
}

function validEnvelope(ref: ArtifactRef, payloadBase64: string): string {
  return JSON.stringify({ ref, payloadBase64 });
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

interface RejectionCase {
  readonly label: string;
  readonly source?: Uint8Array;
  readonly envelope: (ref: ArtifactRef, payloadBase64: string) => string;
  readonly error: RegExp;
}

const REJECTION_CASES: readonly RejectionCase[] = [
  {
    label: "an unknown final envelope property",
    envelope: (ref, payloadBase64) => JSON.stringify({ ref, payloadBase64, unexpected: true }),
    error: /stored envelope has unknown properties/u,
  },
  {
    label: "malformed JSON",
    envelope: () => '{"ref":',
    error: /stored artifact JSON/u,
  },
  {
    label: "a trailing object comma",
    envelope: (ref, payloadBase64) => `{"ref":${JSON.stringify(ref)},"payloadBase64":${JSON.stringify(payloadBase64)},}`,
    error: /stored artifact JSON expected a string/u,
  },
  {
    label: "a mismatched nested unknown value",
    envelope: (ref, payloadBase64) => `{"ref":${JSON.stringify(ref)},"unknown":[{"x":[}],"payloadBase64":${JSON.stringify(payloadBase64)}}`,
    error: /stored artifact JSON/u,
  },
  {
    label: "a noncanonical base64 length",
    envelope: (ref, payloadBase64) => validEnvelope(ref, payloadBase64.slice(0, -1)),
    error: /non-canonical base64 length/u,
  },
  {
    label: "noncanonical base64 padding bits",
    source: Uint8Array.of(0x00),
    envelope: (ref) => validEnvelope(ref, "AB=="),
    error: /invalid base64 padding/u,
  },
  {
    label: "a stored reference id mismatch",
    envelope: (ref, payloadBase64) => validEnvelope(ArtifactRefSchema.parse({
      ...ref,
      id: "00000000-0000-4000-8000-000000000001",
    }), payloadBase64),
    error: /metadata does not match stored content/u,
  },
  {
    label: "a stored reference digest mismatch",
    envelope: (ref, payloadBase64) => validEnvelope(
      ArtifactRefSchema.parse({ ...ref, sha256: "0".repeat(64) }),
      payloadBase64,
    ),
    error: /metadata does not match stored content/u,
  },
  {
    label: "a stored reference byte-count mismatch",
    envelope: (ref, payloadBase64) => validEnvelope({ ...ref, bytes: ref.bytes + 1 }, payloadBase64),
    error: /metadata does not match stored content/u,
  },
  {
    label: "a stored reference media-type mismatch",
    envelope: (ref, payloadBase64) => validEnvelope({ ...ref, mediaType: "text/plain" }, payloadBase64),
    error: /metadata does not match stored content/u,
  },
  {
    label: "a truncated payload",
    envelope: (ref) => validEnvelope(ref, "ABB/gA=="),
    error: /byte length does not match stored content/u,
  },
  {
    label: "an oversized payload",
    envelope: (ref) => validEnvelope(ref, "ABB/gP8B"),
    error: /exceeds its authoritative byte size/u,
  },
];

async function expectVerifyAndPrepareToReject(
  workspace: string,
  ref: ArtifactRef,
  error: RegExp,
): Promise<void> {
  for (const operation of ["verify", "prepare"] as const) {
    const closed: Array<Readonly<{ kind: string; fd: number }>> = [];
    const reader = createServerVerifiedArtifactReader({
      admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
      observeHandleClosed(kind, handle) {
        closed.push(Object.freeze({ kind, fd: handle.fd }));
      },
    });
    await assert.rejects(reader[operation](ref), error);
    assert.deepEqual(
      closed.map(({ kind }) => kind).toSorted(),
      (operation === "verify" ? ["snapshot", "source"] : ["prepared", "snapshot", "source"]),
      `${operation} must close every transient handle on malformed input`,
    );
    assert.ok(closed.every(({ fd }) => fd === -1), `${operation} must report only closed handles`);
    assert.deepEqual(
      await readdir(join(workspace, ".tracker/data", "scratch")),
      [],
      `${operation} must leave no named scratch residue`,
    );
  }
}

describe("server verified artifact reader", () => {
  it("prepare retains one disposable exact-byte body after the source envelope changes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-server-artifact-reader-"));
    try {
      const writer = createContentAddressedArtifactWriter({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });
      const ref = await writer.put(
        Uint8Array.from([0x00, 0x10, 0x7f, 0x80, 0xff]),
        { mediaType: "application/octet-stream" },
      );
      let closed = 0;
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        observeLeaseClosed: () => {
          closed += 1;
        },
      });
      const lease = await reader.prepare(ref);
      try {
        assert.deepEqual(lease.ref, ref);
        await writeFile(
          join(workspace, ARTIFACT_ROOT, `${ref.sha256}.artifact`),
          '{"replaced":"after prepare"}\n',
          "utf8",
        );

        const body = await lease.takeBody();
        await assert.rejects(async () => lease.takeBody());
        assert.deepEqual(await collectBytes(body), Buffer.from("00107f80ff", "hex"));
        assert.equal(closed, 1, "EOF must close the retained handle before explicit disposal");
      } finally {
        await lease.dispose();
        await lease.dispose();
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("verify and prepare accept the existing JSON language with final duplicate members", async () => {
    await withWrittenArtifact(Uint8Array.from([0x41, 0x42, 0x43, 0xfb, 0xef]), async ({ workspace, ref }) => {
      await writeStoredEnvelope(workspace, ref, `\n\t{
        "ref": { "id": false },
        "payloadBase64": null,
        "\\u0070ayloadBase64": "QU\\u004aD\\u002b\\u002b8\\u003d",
        "\\u0072ef": {
          "media\\u0054ype": "${ref.mediaType}",
          "bytes": 5e${"0".repeat(256)},
          "sha\\u003256": "${ref.sha256}",
          "id": "${ref.id}"
        }
      }\r\n`);
      let closed = 0;
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        observeLeaseClosed: () => {
          closed += 1;
        },
      });

      const publicWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
      });
      assert.deepEqual(await collectNodeBytes(await publicWriter.open(ref)), Buffer.from("414243fbef", "hex"));

      await reader.verify(ref);
      const lease = await reader.prepare(ref);
      try {
        assert.deepEqual(await collectBytes(await lease.takeBody()), Buffer.from("414243fbef", "hex"));
        assert.equal(closed, 1);
      } finally {
        await lease.dispose();
      }
    });
  });

  it("accepts zero with an arbitrarily large JSON exponent without producing a non-finite value", async () => {
    await withWrittenArtifact(new Uint8Array(), async ({ workspace, ref }) => {
      await writeStoredEnvelope(
        workspace,
        ref,
        `{"payloadBase64":"","ref":{"id":"${ref.id}","sha256":"${ref.sha256}","bytes":0e9999,"mediaType":"${ref.mediaType}"}}`,
      );
      const reader = createServerVerifiedArtifactReader({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });
      const publicWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
      });

      assert.deepEqual(await collectNodeBytes(await publicWriter.open(ref)), Buffer.alloc(0));
      await reader.verify(ref);
      const lease = await reader.prepare(ref);
      try {
        assert.deepEqual(await collectBytes(await lease.takeBody()), Buffer.alloc(0));
      } finally {
        await lease.dispose();
      }
    });
  });

  it("accepts a schema-valid media type without imposing a private parser length cap", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-server-artifact-reader-"));
    try {
      const mediaType = `application/${"x".repeat(4_096)}`;
      const writer = createContentAddressedArtifactWriter({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });
      const ref = await writer.put(SMALL_BYTES, { mediaType });
      const reader = createServerVerifiedArtifactReader({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });

      assert.deepEqual(await collectNodeBytes(await writer.open(ref)), Buffer.from(SMALL_BYTES));
      await reader.verify(ref);
      const lease = await reader.prepare(ref);
      try {
        assert.deepEqual(await collectBytes(await lease.takeBody()), Buffer.from(SMALL_BYTES));
      } finally {
        await lease.dispose();
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.each(REJECTION_CASES)("strictly rejects $label", async ({ source = SMALL_BYTES, envelope, error }) => {
    await withWrittenArtifact(source, async ({ workspace, ref }) => {
      const payloadBase64 = Buffer.from(source).toString("base64");
      await writeStoredEnvelope(workspace, ref, envelope(ref, payloadBase64));
      const publicWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
      });

      await assert.rejects(publicWriter.open(ref));
      await expectVerifyAndPrepareToReject(workspace, ref, error);
    });
  });

  it("keeps the observed retained-buffer bound independent of stored payload size", async () => {
    const peaks: number[] = [];
    for (const size of [1, 131_089, 524_305]) {
      const source = Buffer.alloc(size, size & 0xff);
      await withWrittenArtifact(source, async ({ workspace, ref }) => {
        const retained: number[] = [];
        const reader = createServerVerifiedArtifactReader({
          admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
          observeRetainedBytes(_phase, bytes) {
            retained.push(bytes);
          },
        });

        const lease = await reader.prepare(ref);
        try {
          assert.equal((await collectBytes(await lease.takeBody())).byteLength, size);
        } finally {
          await lease.dispose();
        }
        peaks.push(Math.max(...retained));
      });
    }
    assert.deepEqual(peaks, [4 * 64 * 1024, 4 * 64 * 1024, 4 * 64 * 1024]);

    const source = await readFile(
      new URL("../../../../src/backend/storage/artifacts/server-verified-artifact-reader.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\breadFile(?:Sync)?\s*\(|Buffer\.concat\s*\(|Readable\.from\s*\(/u);
    assert.deepEqual(
      source.split("\n")
        .map((line) => line.trim())
        .filter((line) => /(?:Buffer\.(?:alloc|allocUnsafe)|new Uint8Array|Uint8Array\.from)\s*\(/u.test(line)),
      [
        "const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);",
        "#buffer = Buffer.alloc(0);",
        "const next = Buffer.allocUnsafe(remaining);",
        "readonly #page = Buffer.allocUnsafe(IO_CHUNK_BYTES);",
        "const decoded = Buffer.allocUnsafe(sourceChunk.byteLength);",
        "const quartet = Buffer.allocUnsafe(4);",
        "const outputBuffer = Buffer.allocUnsafe(IO_CHUNK_BYTES - 1);",
        "const buffer = Buffer.allocUnsafe(Math.min(IO_CHUNK_BYTES, ref.bytes - offset));",
        "const extra = Buffer.allocUnsafe(1);",
        "const buffer = Buffer.allocUnsafe(Math.min(IO_CHUNK_BYTES, ref.bytes - offset));",
        "controller.enqueue(Uint8Array.from(buffer.subarray(0, bytesRead)));",
      ],
      "every reader-owned byte allocation/copy constructor must stay in the reviewed bounded set",
    );
  });

  it("bounds every observed lower I/O operation while preserving a multi-chunk body", async () => {
    const source = Buffer.alloc(131_089);
    for (let index = 0; index < source.byteLength; index += 1) source[index] = (index * 31 + 17) & 0xff;
    await withWrittenArtifact(source, async ({ workspace, ref }) => {
      const observations: Array<Readonly<{ kind: VerifiedArtifactIoKind; bytes: number }>> = [];
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        observeIo(kind, bytes) {
          observations.push(Object.freeze({ kind, bytes }));
        },
      });

      const lease = await reader.prepare(ref);
      try {
        const received = await collectBytes(await lease.takeBody());
        assert.equal(received.byteLength, 131_089);
        assert.equal(
          createHash("sha256").update(received).digest("hex"),
          "c5ddd1a78b6abd1e47dcac9a2be53a7e4996384bcf782f84b4a8472f795530ec",
        );
        assert.deepEqual(
          [...new Set(observations.map(({ kind }) => kind))].sort(),
          ["prepared-read", "prepared-write", "snapshot-write", "source-read"],
        );
        assert.ok(observations.every(({ bytes }) => bytes > 0 && bytes <= 64 * 1024));
        assert.ok(observations.filter(({ kind }) => kind === "source-read").length > 2);
        assert.deepEqual(
          observations.filter(({ kind }) => kind === "prepared-write").map(({ bytes }) => bytes),
          [65_535, 65_535, 19],
        );
      } finally {
        await lease.dispose();
      }
    });
  });

  it("refuses a symlinked source without reading its target", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      const storedPath = join(workspace, ARTIFACT_ROOT, `${ref.sha256}.artifact`);
      const targetPath = join(workspace, "foreign-target.txt");
      await rm(storedPath);
      await writeFile(targetPath, "PRIVATE_TARGET_BYTES", "utf8");
      await symlink(targetPath, storedPath);
      const reader = createServerVerifiedArtifactReader({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });

      for (const operation of [() => reader.verify(ref), () => reader.prepare(ref)]) {
        await assert.rejects(operation, (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, "VerifiedArtifactOperationalError");
          assert.equal(error.message, "verified artifact storage operation failed");
          assert.doesNotMatch(error.message, /PRIVATE_TARGET_BYTES|foreign-target/u);
          return true;
        });
      }
    });
  });

  it("rejects deeply nested unknown JSON with file-backed parser state", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      const depth = 65_600;
      const payloadBase64 = Buffer.from(SMALL_BYTES).toString("base64");
      await writeStoredEnvelope(
        workspace,
        ref,
        `{"ref":${JSON.stringify(ref)},"unknown":${"[".repeat(depth)}null${"]".repeat(depth)},"payloadBase64":${JSON.stringify(payloadBase64)}}`,
      );
      await expectVerifyAndPrepareToReject(workspace, ref, /stored envelope has unknown properties/u);
    });
  });

  it("refuses verify and prepare before lower I/O when their signal is already aborted", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      const observations: Array<Readonly<{ kind: VerifiedArtifactIoKind; bytes: number }>> = [];
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        observeIo(kind, bytes) {
          observations.push(Object.freeze({ kind, bytes }));
        },
      });
      const reason = new Error("reader request aborted before work");
      const controller = new AbortController();
      controller.abort(reason);

      await assert.rejects(reader.verify(ref, controller.signal), (error: unknown) => error === reason);
      await assert.rejects(reader.prepare(ref, controller.signal), (error: unknown) => error === reason);
      assert.deepEqual(observations, []);
    });
  });

  it("closes prepared state when the request aborts during the final verification pass", async () => {
    await withWrittenArtifact(Buffer.alloc(131_089, 0x5c), async ({ workspace, ref }) => {
      const controller = new AbortController();
      const reason = new Error("request aborted during prepared-byte verification");
      const closed: Array<Readonly<{ kind: string; fd: number }>> = [];
      const preparedReads: number[] = [];
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        observeIo(kind, bytes) {
          if (kind === "prepared-read") {
            preparedReads.push(bytes);
            controller.abort(reason);
          }
        },
        observeHandleClosed(kind, handle) {
          closed.push(Object.freeze({ kind, fd: handle.fd }));
        },
      });

      await assert.rejects(reader.prepare(ref, controller.signal), (error: unknown) => error === reason);
      assert.deepEqual(preparedReads, [64 * 1024], "the next chunk must refuse after the first read observes abort");
      assert.deepEqual(closed.map(({ kind }) => kind).toSorted(), ["prepared", "snapshot", "source"]);
      assert.ok(closed.every(({ fd }) => fd === -1));
      assert.deepEqual(await readdir(join(workspace, ".tracker/data", "scratch")), []);
    });
  });

  it("cancelling a taken body ends delivery and leaves disposal idempotent", async () => {
    const source = Buffer.alloc(65_541, 0x5a);
    await withWrittenArtifact(source, async ({ workspace, ref }) => {
      let closed = 0;
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        observeLeaseClosed: () => {
          closed += 1;
        },
      });
      const lease = await reader.prepare(ref);
      const body = (await lease.takeBody()).getReader();
      const first = await body.read();
      assert.equal(first.done, false);
      assert.deepEqual(Buffer.from(first.value), Buffer.alloc(65_536, 0x5a));

      await body.cancel("caller disconnected");
      assert.deepEqual(await body.read(), { value: undefined, done: true });
      assert.equal(closed, 1, "cancel must close the retained handle before explicit disposal");
      await lease.dispose();
      await lease.dispose();
    });
  });

  it.each([
    "scratch-unlink",
    "source-read",
    "snapshot-write",
    "snapshot-sync",
    "prepared-write",
    "prepared-sync",
    "prepared-read",
  ] as const)("owns a %s failure without a named scratch residue", async (faultPoint) => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      let injected = false;
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        injectFault(point) {
          if (!injected && point === faultPoint) {
            injected = true;
            throw new Error(`PRIVATE_${point}_FAILURE`);
          }
        },
      });

      await assert.rejects(reader.prepare(ref), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "VerifiedArtifactOperationalError");
        assert.equal(error.message, "verified artifact storage operation failed");
        assert.doesNotMatch(error.message, /PRIVATE_/u);
        return true;
      });
      assert.equal(injected, true);
      assert.deepEqual(
        await readdir(join(workspace, ".tracker/data", "scratch")),
        [],
      );
    });
  });

  it.each([
    ["source-close", ["source", "snapshot"]],
    ["snapshot-close", ["source", "snapshot", "prepared"]],
  ] as const)("closes every opened transient handle when %s reports failure", async (faultPoint, expectedClosed) => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      let injected = false;
      const closed: Array<Readonly<{ kind: string; fd: number }>> = [];
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        injectFault(point) {
          if (!injected && point === faultPoint) {
            injected = true;
            throw new Error(`PRIVATE_${point}_FAILURE`);
          }
        },
        observeHandleClosed(kind, handle) {
          closed.push(Object.freeze({ kind, fd: handle.fd }));
        },
      });

      await assert.rejects(reader.prepare(ref), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "VerifiedArtifactOperationalError");
        assert.doesNotMatch(error.message, /PRIVATE_/u);
        return true;
      });
      assert.equal(injected, true);
      assert.deepEqual(closed.map(({ kind }) => kind).toSorted(), [...expectedClosed].toSorted());
      assert.ok(closed.every(({ fd }) => fd === -1), "every observed transient handle must already be closed");
      assert.deepEqual(await readdir(join(workspace, ".tracker/data", "scratch")), []);
    });
  });

  it("retains preparation failure before a failing prepared-handle close", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      const primary = new Error("PRIVATE_PREPARED_SYNC_FAILURE");
      const cleanup = new Error("PRIVATE_PREPARED_CLOSE_FAILURE");
      const closed: Array<Readonly<{ kind: string; fd: number }>> = [];
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        injectFault(point) {
          if (point === "prepared-sync") throw primary;
          if (point === "prepared-close") throw cleanup;
        },
        observeHandleClosed(kind, handle) {
          closed.push(Object.freeze({ kind, fd: handle.fd }));
        },
      });

      await assert.rejects(reader.prepare(ref), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "VerifiedArtifactOperationalError");
        const tree = errorTree(error);
        assert.ok(tree.includes(primary));
        assert.ok(tree.includes(cleanup));
        const aggregate = tree.find((entry) => entry instanceof AggregateError);
        assert.ok(aggregate instanceof AggregateError);
        assert.ok(errorTree(aggregate.cause).includes(primary));
        assert.ok(errorTree(aggregate.errors[0]).includes(primary));
        assert.ok(errorTree(aggregate.errors[1]).includes(cleanup));
        return true;
      });
      assert.deepEqual(closed.map(({ kind }) => kind).toSorted(), ["prepared", "snapshot", "source"]);
      assert.ok(closed.every(({ fd }) => fd === -1), "compound failure must not retain an open handle");
      assert.deepEqual(await readdir(join(workspace, ".tracker/data", "scratch")), []);
    });
  });

  it("owns a late retained-body read failure and closes before explicit disposal", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      let closed = 0;
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        injectFault(point) {
          if (point === "lease-read") throw new Error("PRIVATE_LEASE_READ_FAILURE");
        },
        observeLeaseClosed: () => {
          closed += 1;
        },
      });
      const lease = await reader.prepare(ref);
      const body = (await lease.takeBody()).getReader();

      await assert.rejects(body.read(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "VerifiedArtifactOperationalError");
        assert.equal(error.message, "verified artifact storage operation failed");
        assert.doesNotMatch(error.message, /PRIVATE_/u);
        return true;
      });
      assert.equal(closed, 1);
      await lease.dispose();
      assert.equal(closed, 1);
    });
  });

  it("closes the retained handle even when close reports failure", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      let closed = 0;
      const reader = createServerVerifiedArtifactReader({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)),
        injectFault(point) {
          if (point === "lease-close") throw new Error("PRIVATE_LEASE_CLOSE_FAILURE");
        },
        observeLeaseClosed: () => {
          closed += 1;
        },
      });
      const lease = await reader.prepare(ref);

      await assert.rejects(lease.dispose(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "VerifiedArtifactOperationalError");
        assert.equal(error.message, "verified artifact storage operation failed");
        return true;
      });
      assert.equal(closed, 1);
      await assert.rejects(lease.dispose(), /verified artifact storage operation failed/u);
      assert.equal(closed, 1);
    });
  });

  it("a fresh call re-verifies a source changed after an earlier success", async () => {
    await withWrittenArtifact(SMALL_BYTES, async ({ workspace, ref }) => {
      const reader = createServerVerifiedArtifactReader({ admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ARTIFACT_ROOT)) });
      await reader.verify(ref);
      await writeStoredEnvelope(workspace, ref, '{"changed":"after verified call"}\n');

      await assert.rejects(reader.verify(ref), /stored envelope has unknown properties/u);
    });
  });
});
