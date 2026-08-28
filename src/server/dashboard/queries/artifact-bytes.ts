/** DCA1: exact diagnostic-index authority followed by whole-byte verification. */
import { createHash } from "node:crypto";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../domain/artifacts.js";
import { ArtifactIdSchema } from "../../../domain/ids.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../infra/sqlite/storage-records.js";
import { DiagnosticBundleCorruptError, TargetNotFoundError } from "../../failures.js";

export interface ArtifactBytesQueryDeps {
  readonly authority: Pick<AuthorityRepositories["diagnosticBundles"], "findByArtifact">;
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "open">;
}

export interface VerifiedArtifactBytes {
  readonly ref: ArtifactRef;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * The caller has an authoritative ref, but the content store no longer has
 * its physical object. DCA1 exposes this as a non-retryable 500; later
 * evidence viewers may retain the distinction from malformed bytes without
 * guessing from an error message.
 */
export class IndexedArtifactBytesMissingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IndexedArtifactBytesMissingError";
  }
}

/** Safe verifier detail; the caller owns the artifact/bundle identity label. */
export class ArtifactBytesCorruptError extends Error {
  readonly detail: string;

  constructor(detail: string, options?: ErrorOptions) {
    super(detail, options);
    this.name = "ArtifactBytesCorruptError";
    this.detail = detail;
  }
}

function corrupt(artifactId: string, message: string, cause?: unknown): never {
  throw new DiagnosticBundleCorruptError(
    `diagnostic artifact ${artifactId} is corrupt: ${message}`,
    ...(cause === undefined ? [] : [{ cause }]),
  );
}

function normalizeCorruption(artifactId: string, message: string, error: unknown): never {
  if (error instanceof DiagnosticBundleCorruptError) throw error;
  corrupt(artifactId, message, error);
}

function isPhysicalObjectMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function artifactBytesCorrupt(detail: string, cause?: unknown): never {
  throw new ArtifactBytesCorruptError(
    detail,
    ...(cause === undefined ? [] : [{ cause }]),
  );
}

async function consumeVerifiedArtifactBytes(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
  mode: "verify",
): Promise<void>;
async function consumeVerifiedArtifactBytes(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
  mode: "materialize",
): Promise<Uint8Array<ArrayBuffer>>;
async function consumeVerifiedArtifactBytes(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
  mode: "verify" | "materialize",
): Promise<void | Uint8Array<ArrayBuffer>> {
  const digest = createHash("sha256");
  let byteLength = 0;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = mode === "materialize" ? new Uint8Array(ref.bytes) : undefined;
    const stream = await artifacts.open(ref);
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) artifactBytesCorrupt("emitted a non-byte chunk");
      const nextByteLength = byteLength + chunk.byteLength;
      if (!Number.isSafeInteger(nextByteLength)) artifactBytesCorrupt("exceeds safe byte accounting");
      if (nextByteLength > ref.bytes) artifactBytesCorrupt("exceeds the authoritative byte size");
      bytes?.set(chunk, byteLength);
      digest.update(chunk);
      byteLength = nextByteLength;
    }
  } catch (error: unknown) {
    if (error instanceof ArtifactBytesCorruptError || error instanceof IndexedArtifactBytesMissingError) {
      throw error;
    }
    if (isPhysicalObjectMissing(error)) {
      throw new IndexedArtifactBytesMissingError("has no stored bytes", { cause: error });
    }
    artifactBytesCorrupt("could not be verified", error);
  }
  if (byteLength !== ref.bytes) artifactBytesCorrupt("has a byte-size mismatch");
  if (digest.digest("hex") !== ref.sha256) artifactBytesCorrupt("has a digest mismatch");
  return bytes;
}

/**
 * Streams and verifies an authoritative artifact without retaining its chunks
 * or allocating an assembled copy. Callers own safe identity/error labels.
 */
export async function verifyArtifactBytes(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
): Promise<void> {
  await consumeVerifiedArtifactBytes(artifacts, ref, "verify");
}

/**
 * Streams an authoritative artifact into one exact standalone buffer while
 * sharing the verify-only path's bounds, digest and physical-missing logic.
 */
export async function materializeVerifiedArtifactBytes(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
): Promise<Uint8Array<ArrayBuffer>> {
  return consumeVerifiedArtifactBytes(artifacts, ref, "materialize");
}

function resolveAuthorityRef(
  artifactId: string,
  indexedInput: ReturnType<AuthorityRepositories["diagnosticBundles"]["findByArtifact"]>,
): ArtifactRef {
  let ref: ArtifactRef | undefined;
  for (const rowInput of indexedInput) {
    const row = DiagnosticAttachmentStorageRecordSchema.parse(rowInput);
    if (row.attachment.artifactId !== artifactId) {
      corrupt(artifactId, "attachment authority returned a foreign artifact identity");
    }
    const candidate = ArtifactRefSchema.parse({
      id: row.attachment.artifactId,
      sha256: row.attachment.digest,
      bytes: row.attachment.byteLength,
      mediaType: row.attachment.mediaType,
    });
    if (ref !== undefined && (
      ref.id !== candidate.id
      || ref.sha256 !== candidate.sha256
      || ref.bytes !== candidate.bytes
      || ref.mediaType !== candidate.mediaType
    )) {
      corrupt(artifactId, "attachment authority contains conflicting artifact metadata");
    }
    ref = candidate;
  }
  if (ref === undefined) {
    throw new TargetNotFoundError(`diagnostic artifact ${artifactId} does not exist`);
  }
  return ref;
}

export async function readDiagnosticArtifactBytes(
  deps: ArtifactBytesQueryDeps,
  artifactIdInput: unknown,
): Promise<VerifiedArtifactBytes> {
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  let ref: ArtifactRef;
  try {
    ref = resolveAuthorityRef(artifactId, deps.authority.findByArtifact(artifactId));
  } catch (error: unknown) {
    if (error instanceof TargetNotFoundError) throw error;
    normalizeCorruption(artifactId, "attachment authority could not be verified", error);
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await materializeVerifiedArtifactBytes(deps.artifacts, ref);
  } catch (error: unknown) {
    if (error instanceof IndexedArtifactBytesMissingError) {
      throw new IndexedArtifactBytesMissingError(
        `indexed diagnostic artifact ${artifactId} has no stored bytes`,
        { cause: error },
      );
    }
    if (error instanceof ArtifactBytesCorruptError) {
      corrupt(artifactId, `stored content ${error.detail}`, error);
    }
    normalizeCorruption(artifactId, "stored content could not be verified", error);
  }

  return Object.freeze({
    ref,
    bytes,
  });
}
