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
  readonly bytes: Uint8Array;
}

/**
 * Authority names this artifact, but the content store no longer has its
 * physical object. DCA1 exposes this as a non-retryable 500; later evidence
 * viewers may retain the distinction from malformed bytes without guessing
 * from an error message.
 */
export class IndexedArtifactBytesMissingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IndexedArtifactBytesMissingError";
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

  const chunks: Uint8Array[] = [];
  const digest = createHash("sha256");
  let byteLength = 0;
  try {
    const stream = await deps.artifacts.open(ref);
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) corrupt(artifactId, "stored content emitted a non-byte chunk");
      byteLength += chunk.byteLength;
      if (!Number.isSafeInteger(byteLength)) corrupt(artifactId, "stored content exceeds safe byte accounting");
      if (byteLength > ref.bytes) corrupt(artifactId, "stored content exceeds the authoritative byte size");
      const owned = Uint8Array.from(chunk);
      chunks.push(owned);
      digest.update(owned);
    }
  } catch (error: unknown) {
    if (isPhysicalObjectMissing(error)) {
      throw new IndexedArtifactBytesMissingError(
        `indexed diagnostic artifact ${artifactId} has no stored bytes`,
        { cause: error },
      );
    }
    normalizeCorruption(artifactId, "stored content could not be verified", error);
  }
  if (byteLength !== ref.bytes) corrupt(artifactId, "stored content has a byte-size mismatch");
  if (digest.digest("hex") !== ref.sha256) corrupt(artifactId, "stored content has a digest mismatch");

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return Object.freeze({
    ref,
    bytes,
  });
}
