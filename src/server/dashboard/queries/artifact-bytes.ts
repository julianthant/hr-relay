/** DCA1/D291: exact diagnostic-index authority followed by bounded whole-byte verification. */
import { ArtifactRefSchema, type ArtifactRef } from "../../../domain/artifacts.js";
import { ArtifactIdSchema } from "../../../domain/ids.js";
import type {
  ServerVerifiedArtifactReader,
  VerifiedByteLease,
} from "../../../infra/artifacts/server-verified-artifact-reader.js";
import {
  VerifiedArtifactOperationalError,
  VerifiedArtifactSourceMissingError,
} from "../../../infra/artifacts/server-verified-artifact-reader.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../infra/sqlite/storage-records.js";
import { DiagnosticBundleCorruptError, TargetNotFoundError } from "../../failures.js";

export interface ArtifactBytesQueryDeps {
  readonly authority: Pick<AuthorityRepositories["diagnosticBundles"], "findByArtifact">;
  readonly artifactReader: ServerVerifiedArtifactReader;
}

export interface VerifiedArtifactLease {
  readonly ref: ArtifactRef;
  readonly lease: VerifiedByteLease;
}

export interface ArtifactVerificationPass {
  verify(ref: ArtifactRef): Promise<void>;
  isAbort(error: unknown): boolean;
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
  return error instanceof VerifiedArtifactSourceMissingError;
}

function artifactBytesCorrupt(detail: string, cause?: unknown): never {
  throw new ArtifactBytesCorruptError(
    detail,
    ...(cause === undefined ? [] : [{ cause }]),
  );
}

function exactRefKey(ref: ArtifactRef): string {
  return `${ref.id}\n${ref.sha256}\n${String(ref.bytes)}\n${ref.mediaType}`;
}

/** One request/pass may reuse only a completed proof for the same exact immutable ref. */
export function createArtifactVerificationPass(
  artifactReader: ServerVerifiedArtifactReader,
  signal?: AbortSignal,
): ArtifactVerificationPass {
  const completed = new Set<string>();
  return Object.freeze({
    async verify(refInput: ArtifactRef): Promise<void> {
      const ref = ArtifactRefSchema.parse(refInput);
      const key = exactRefKey(ref);
      signal?.throwIfAborted();
      if (completed.has(key)) return;
      await artifactReader.verify(ref, signal);
      signal?.throwIfAborted();
      completed.add(key);
    },
    isAbort(error: unknown): boolean {
      return signal?.aborted === true && error === signal.reason;
    },
  });
}

export async function verifyArtifactBytes(
  artifactReader: ServerVerifiedArtifactReader,
  ref: ArtifactRef,
  pass: ArtifactVerificationPass = createArtifactVerificationPass(artifactReader),
): Promise<void> {
  try {
    await pass.verify(ref);
  } catch (error: unknown) {
    if (pass.isAbort(error)) throw error;
    if (error instanceof ArtifactBytesCorruptError
      || error instanceof IndexedArtifactBytesMissingError
      || error instanceof VerifiedArtifactOperationalError) throw error;
    if (isPhysicalObjectMissing(error)) {
      throw new IndexedArtifactBytesMissingError("has no stored bytes", { cause: error });
    }
    artifactBytesCorrupt("could not be verified", error);
  }
}

/** A selected response always performs a fresh prepare pass; prior pass proofs never satisfy it. */
export async function prepareVerifiedArtifactLease(
  artifactReader: ServerVerifiedArtifactReader,
  ref: ArtifactRef,
  signal?: AbortSignal,
): Promise<VerifiedByteLease> {
  try {
    return await artifactReader.prepare(ref, signal);
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    if (error instanceof ArtifactBytesCorruptError
      || error instanceof IndexedArtifactBytesMissingError
      || error instanceof VerifiedArtifactOperationalError) throw error;
    if (isPhysicalObjectMissing(error)) {
      throw new IndexedArtifactBytesMissingError("has no stored bytes", { cause: error });
    }
    artifactBytesCorrupt("could not be verified", error);
  }
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

export async function prepareDiagnosticArtifactLease(
  deps: ArtifactBytesQueryDeps,
  artifactIdInput: unknown,
  signal?: AbortSignal,
): Promise<VerifiedArtifactLease> {
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  let ref: ArtifactRef;
  try {
    ref = resolveAuthorityRef(artifactId, deps.authority.findByArtifact(artifactId));
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    if (error instanceof TargetNotFoundError) throw error;
    normalizeCorruption(artifactId, "attachment authority could not be verified", error);
  }

  let lease: VerifiedByteLease;
  try {
    lease = await prepareVerifiedArtifactLease(deps.artifactReader, ref, signal);
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    if (error instanceof VerifiedArtifactOperationalError) throw error;
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
    lease,
  });
}
