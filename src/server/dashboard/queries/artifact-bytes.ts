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

/**
 * The one verified materializer for every diagnostic artifact consumer.
 * It owns streaming, bounded accounting, digest verification and exact-buffer
 * assembly; callers own authority lookup and safe identity/error labels.
 */
export async function materializeVerifiedArtifactBytes(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  const digest = createHash("sha256");
  let byteLength = 0;
  try {
    const stream = await artifacts.open(ref);
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) artifactBytesCorrupt("emitted a non-byte chunk");
      byteLength += chunk.byteLength;
      if (!Number.isSafeInteger(byteLength)) artifactBytesCorrupt("exceeds safe byte accounting");
      if (byteLength > ref.bytes) artifactBytesCorrupt("exceeds the authoritative byte size");
      const owned = Uint8Array.from(chunk);
      chunks.push(owned);
      digest.update(owned);
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

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
