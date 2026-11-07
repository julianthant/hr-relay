import { requireTrustRun } from "../trust/run-reader.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  DiagnosticBundleWireSchema,
  type DiagnosticBundleWire,
} from "../../../models/dashboard/diagnostic-bundle.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { ArtifactIdSchema, DiagnosticBundleIdSchema } from "../../../rules/identity/ids.js";
import { deriveDiagnosticContentDigest } from "../../../models/trust/diagnostic-capture.js";
import {
  DiagnosticBundleSchema,
  type DiagnosticBundle,
} from "../../../models/trust/diagnostic.js";
import {
  VerifiedArtifactOperationalError,
  type ServerVerifiedArtifactReader,
  type VerifiedByteLease,
} from "../../storage/artifacts/server-verified-artifact-reader.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../storage/sqlite/storage-records.js";
import { DiagnosticBundleBytesMissingError, DiagnosticBundleCorruptError, TargetNotFoundError, SectionUnavailableError } from "../commands/refusals.js";
import {
  ArtifactBytesCorruptError,
  createArtifactVerificationPass,
  IndexedArtifactBytesMissingError,
  prepareVerifiedArtifactLease,
  prepareDiagnosticArtifactLease,
  verifyArtifactBytes,
  type ArtifactVerificationPass,
} from "./artifact-bytes.js";

export interface DiagnosticBundleQueryDeps {
  readonly runReader?: Pick<RunRecordService, "read">;
  readonly authority: Pick<AuthorityRepositories["diagnosticBundles"], "get" | "listAttachments">;
  readonly artifactReader: ServerVerifiedArtifactReader;
}

function corrupt(bundleId: string, message: string, cause?: unknown): never {
  throw new DiagnosticBundleCorruptError(
    `diagnostic bundle ${bundleId} is corrupt: ${message}`,
    ...(cause === undefined ? [] : [{ cause }]),
  );
}

function normalizeCorruption(bundleId: string, message: string, error: unknown): never {
  if (error instanceof DiagnosticBundleCorruptError) throw error;
  throw new DiagnosticBundleCorruptError(
    `diagnostic bundle ${bundleId} is corrupt: ${message}`,
    { cause: error },
  );
}

function verifyContentIdentity(bundle: DiagnosticBundle): void {
  const bundleId = bundle.bundleId;
  let expectedDigest: string;
  try {
    expectedDigest = deriveDiagnosticContentDigest({
      runId: bundle.runId,
      origin: bundle.origin,
      capturedAt: bundle.createdAt,
      configFingerprint: bundle.configFingerprint,
      descriptorFingerprint: bundle.descriptorFingerprint,
      redaction: bundle.redaction,
      attachments: bundle.attachments,
      ...(bundle.operation === undefined ? {} : { operation: bundle.operation }),
    });
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the content identity could not be verified", error);
  }
  if (bundle.contentDigest !== expectedDigest) {
    corrupt(bundleId, "the content identity does not match the durable record");
  }
}

function throwOwnedFailure(error: unknown, message: string): never {
  if (error instanceof Error) throw error;
  throw new Error(message, { cause: error });
}

function attachmentKey(kind: DiagnosticBundle["attachments"][number]["kind"]): string {
  switch (kind) {
    case "screenshot": return "Screenshot";
    case "accessibility-excerpt": return "Accessibility excerpt";
    case "network-summary": return "Network summary";
    case "console-summary": return "Console summary";
  }
}

function attachmentDetail(attachment: DiagnosticBundle["attachments"][number]): string {
  const bytes = `${String(attachment.byteLength)} byte${attachment.byteLength === 1 ? "" : "s"}`;
  const dimensions = attachment.kind === "screenshot" ? ` · ${String(attachment.width)} × ${String(attachment.height)} px` : "";
  return `${attachment.mediaType} · ${bytes}${dimensions} · ${attachment.sensitivity}`;
}

async function verifyArtifact(
  bundleId: string,
  attachment: DiagnosticBundle["attachments"][number],
  artifactReader: ServerVerifiedArtifactReader,
  pass: ArtifactVerificationPass,
): Promise<void> {
  const attachmentLabel = `attachment ${attachment.artifactId} (${attachment.kind})`;
  try {
    const ref = ArtifactRefSchema.parse({
      id: attachment.artifactId,
      sha256: attachment.digest,
      bytes: attachment.byteLength,
      mediaType: attachment.mediaType,
    });
    await verifyArtifactBytes(artifactReader, ref, pass);
  } catch (error: unknown) {
    if (pass.isAbort(error)) throw error;
    if (error instanceof VerifiedArtifactOperationalError) throw error;
    if (error instanceof TargetNotFoundError || error instanceof SectionUnavailableError) throw error;
    if (error instanceof IndexedArtifactBytesMissingError) {
      throw new DiagnosticBundleBytesMissingError(
        `diagnostic bundle ${bundleId}: ${attachmentLabel} has no stored bytes`, { cause: error },
      );
    }
    if (error instanceof ArtifactBytesCorruptError) {
      corrupt(bundleId, `${attachmentLabel} ${error.detail}`, error);
    }
    normalizeCorruption(bundleId, `${attachmentLabel} could not be verified`, error);
  }
}

function verifyAttachmentIndex(
  bundle: DiagnosticBundle,
  indexed: ReturnType<AuthorityRepositories["diagnosticBundles"]["listAttachments"]>,
): void {
  if (indexed.length !== bundle.attachments.length) {
    corrupt(bundle.bundleId, `attachment index has ${String(indexed.length)} rows but bundle names ${String(bundle.attachments.length)}`);
  }
  const byArtifactId = new Map(indexed.map((row) => {
    const parsed = DiagnosticAttachmentStorageRecordSchema.parse(row);
    return [parsed.attachment.artifactId, parsed] as const;
  }));
  if (byArtifactId.size !== indexed.length) corrupt(bundle.bundleId, "attachment index repeats an artifact id");
  for (const attachment of bundle.attachments) {
    const indexedRecord = byArtifactId.get(attachment.artifactId);
    if (indexedRecord === undefined) corrupt(bundle.bundleId, `attachment index lacks ${attachment.artifactId}`);
    const expectedRecord = DiagnosticAttachmentStorageRecordSchema.parse({
      bundleId: bundle.bundleId,
      attachment,
      createdAt: bundle.createdAt,
    });
    if (canonicalJsonStringify(indexedRecord) !== canonicalJsonStringify(expectedRecord)) {
      corrupt(bundle.bundleId, `attachment index disagrees with ${attachment.artifactId}`);
    }
  }
}

export interface DiagnosticBundleReadback {
  readonly wire: DiagnosticBundleWire;
  /** Canonical JSON over the durable row, never reconstructed by the browser. */
  readonly manifest: string;
}

/** Bytes read through one already-verified bundle attachment, never a loose artifact id. */
export interface DiagnosticBundleAttachmentReadback {
  readonly ref: ArtifactRef;
  readonly lease: VerifiedByteLease;
}

export async function readDiagnosticBundle(
  deps: DiagnosticBundleQueryDeps,
  bundleIdInput: unknown,
  verificationPass?: ArtifactVerificationPass,
  signal?: AbortSignal,
): Promise<DiagnosticBundleReadback> {
  const pass = verificationPass ?? createArtifactVerificationPass(deps.artifactReader, signal);
  const bundleId = DiagnosticBundleIdSchema.parse(bundleIdInput);
  let stored: DiagnosticBundle | undefined;
  try {
    stored = deps.authority.get(bundleId);
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    normalizeCorruption(bundleId, "the durable authority record could not be read", error);
  }
  if (stored === undefined) throw new TargetNotFoundError(`diagnostic bundle ${bundleId} does not exist`);
  if (stored.availability?.state === "purged") throw new SectionUnavailableError(`Diagnostic capture bytes were purged by retention at ${stored.availability.at}.`);
  let bundle: DiagnosticBundle;
  try {
    bundle = DiagnosticBundleSchema.parse(stored);
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the durable authority record is invalid", error);
  }
  if (bundle.bundleId !== bundleId) {
    corrupt(bundleId, "durable authority identity mismatch");
  }
  requireTrustRun(deps.runReader, bundle.runId);
  verifyContentIdentity(bundle);
  try {
    verifyAttachmentIndex(bundle, deps.authority.listAttachments(bundleId));
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the attachment index could not be verified", error);
  }
  const verificationResults = await Promise.all(bundle.attachments.map(async (attachment): Promise<
    Readonly<{ state: "verified" }> | Readonly<{ state: "failed"; error: unknown }>
  > => {
    try {
      await verifyArtifact(bundleId, attachment, deps.artifactReader, pass);
      return { state: "verified" };
    } catch (error: unknown) {
      return { state: "failed", error };
    }
  }));
  const failures = verificationResults.flatMap((result) => result.state === "failed" ? [result.error] : []);
  if (failures.length === 1) {
    throwOwnedFailure(failures[0], "diagnostic bundle attachment verification failed with a non-Error reason");
  }
  if (failures.length > 1) {
    const primary = failures[0];
    const aggregate = new AggregateError(
      failures,
      "diagnostic bundle attachment verification failures",
      { cause: primary },
    );
    const aborted = failures.find((failure) => pass.isAbort(failure));
    if (aborted !== undefined) {
      throwOwnedFailure(aborted, "diagnostic bundle attachment verification aborted with a non-Error reason");
    }
    if (failures.some((failure) => failure instanceof VerifiedArtifactOperationalError)) {
      throw new VerifiedArtifactOperationalError({ cause: aggregate });
    }
    if (failures.some((failure) => failure instanceof DiagnosticBundleBytesMissingError)) {
      throw new DiagnosticBundleBytesMissingError(
        `diagnostic bundle ${bundleId}: attachment verification found missing bytes among multiple failures`,
        { cause: aggregate },
      );
    }
    throw new DiagnosticBundleCorruptError(
      `diagnostic bundle ${bundleId} is corrupt: multiple attachments failed verification`,
      { cause: aggregate },
    );
  }

  requireTrustRun(deps.runReader, bundle.runId);
  const current = deps.authority.get(bundleId);
  if (current === undefined) throw new TargetNotFoundError(`diagnostic bundle ${bundleId} was removed during verification`);
  if (canonicalJsonStringify(current) !== canonicalJsonStringify(bundle)) corrupt(bundleId, "authority changed during verification");
  let byteSize = 0;
  for (const attachment of bundle.attachments) {
    byteSize += attachment.byteLength;
    if (!Number.isSafeInteger(byteSize)) corrupt(bundleId, "attachment byte size exceeds safe accounting");
  }
  try {
    return Object.freeze({
      wire: DiagnosticBundleWireSchema.parse({
        bundleId: bundle.bundleId,
        capturedAt: bundle.createdAt,
        byteSize,
        contentDigest: bundle.contentDigest,
        redaction: bundle.redaction,
        contents: bundle.attachments.map((attachment) => ({
          kind: attachment.kind,
          key: attachmentKey(attachment.kind),
          detail: attachmentDetail(attachment),
          artifactId: attachment.artifactId,
          mediaType: attachment.mediaType,
          byteLength: attachment.byteLength,
          digest: attachment.digest,
          sensitivity: attachment.sensitivity,
          ...(attachment.kind === "screenshot" ? { width: attachment.width, height: attachment.height } : {}),
        })),
      }),
      manifest: canonicalJsonStringify(bundle),
    });
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the served readback could not be constructed", error);
  }
}

// Verify attachment membership and bytes again across the interval before preparing the response.
export async function readDiagnosticBundleAttachment(
  deps: DiagnosticBundleQueryDeps,
  bundleIdInput: unknown,
  artifactIdInput: unknown,
  signal?: AbortSignal,
): Promise<DiagnosticBundleAttachmentReadback> {
  const bundleId = DiagnosticBundleIdSchema.parse(bundleIdInput);
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  const bundle = await readDiagnosticBundle(deps, bundleId, undefined, signal);
  const content = bundle.wire.contents.find((candidate) => candidate.artifactId === artifactId);
  if (content === undefined) {
    throw new TargetNotFoundError(`diagnostic bundle ${bundleId} does not index attachment ${artifactId}`);
  }
  let ref: ArtifactRef;
  try {
    ref = ArtifactRefSchema.parse({
      id: content.artifactId,
      sha256: content.digest,
      bytes: content.byteLength,
      mediaType: content.mediaType,
    });
  } catch (error: unknown) {
    normalizeCorruption(bundleId, `attachment ${artifactId} could not be bound to its exact bundle index`, error);
  }
  try {
    const lease = await prepareVerifiedArtifactLease(deps.artifactReader, ref, signal);
    try {
      const manifest = DiagnosticBundleSchema.parse(JSON.parse(bundle.manifest));
      requireTrustRun(deps.runReader, manifest.runId);
      const current = deps.authority.get(bundleId);
      if (current === undefined) throw new TargetNotFoundError(`diagnostic bundle ${bundleId} was removed during attachment preparation`);
      if (canonicalJsonStringify(current) !== bundle.manifest) corrupt(bundleId, "authority changed during attachment preparation");
      return Object.freeze({ ref, lease });
    } catch (error) {
      const failures: unknown[] = [error];
      try { await lease.dispose(); } catch (cleanup) { failures.push(cleanup); }
      if (failures.length > 1) {
        throw new AggregateError(failures, "diagnostic attachment admission and lease cleanup failed", { cause: error });
      }
      throw error;
    }
  } catch (error: unknown) {
    if (signal?.aborted === true && error === signal.reason) throw error;
    if (error instanceof VerifiedArtifactOperationalError) throw error;
    if (error instanceof TargetNotFoundError || error instanceof SectionUnavailableError) throw error;
    if (error instanceof IndexedArtifactBytesMissingError) {
      throw new DiagnosticBundleBytesMissingError(
        `diagnostic bundle ${bundleId}: attachment ${artifactId} (${content.kind}) has no stored bytes`, { cause: error },
      );
    }
    if (error instanceof ArtifactBytesCorruptError) {
      corrupt(bundleId, `attachment ${artifactId} ${error.detail}`, error);
    }
    normalizeCorruption(bundleId, `attachment ${artifactId} could not be prepared`, error);
  }
}


/** Generic byte URLs still need a live run membership; shared bytes alone grant nothing. */
export async function prepareLiveDiagnosticArtifactLease(
  deps: DiagnosticBundleQueryDeps & Readonly<{
    authority: DiagnosticBundleQueryDeps["authority"] & Pick<AuthorityRepositories["diagnosticBundles"], "findByArtifact">;
  }>,
  artifactIdInput: unknown,
  signal?: AbortSignal,
): Promise<DiagnosticBundleAttachmentReadback> {
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  const inspectMemberships = () => {
    if (deps.runReader === undefined) throw new Error("TRUST_RUN_READER_NOT_CONFIGURED");
    const indexed = deps.authority.findByArtifact(artifactId);
    const live: typeof indexed[number][] = [];
    let sharedRef: ArtifactRef | undefined;
    for (const input of indexed) {
      const member = DiagnosticAttachmentStorageRecordSchema.parse(input);
      const bundle = deps.authority.get(member.bundleId);
      if (bundle === undefined) corrupt(member.bundleId, "artifact membership names a missing bundle");
      const parsed = DiagnosticBundleSchema.parse(bundle);
      verifyContentIdentity(parsed);
      if (parsed.bundleId !== member.bundleId) corrupt(member.bundleId, "artifact membership names a foreign bundle");
      const attachment = parsed.attachments.find(candidate => candidate.artifactId === artifactId);
      if (attachment === undefined || canonicalJsonStringify(attachment) !== canonicalJsonStringify(member.attachment)
        || member.createdAt !== parsed.createdAt) corrupt(member.bundleId, "artifact membership disagrees with its bundle");
      const ref = ArtifactRefSchema.parse({ id: attachment.artifactId, sha256: attachment.digest,
        bytes: attachment.byteLength, mediaType: attachment.mediaType });
      if (sharedRef !== undefined && canonicalJsonStringify(sharedRef) !== canonicalJsonStringify(ref)) {
        corrupt(member.bundleId, "shared artifact metadata disagrees across live/archive memberships");
      }
      sharedRef = ref;
      const existence = deps.runReader.read(parsed.runId);
      if (existence.state !== "present") {
        throw new TargetNotFoundError(`diagnostic artifact ${artifactId} links to ${existence.state} run ${parsed.runId}`);
      }
      if (existence.run.envelope.runId !== parsed.runId) throw new Error(`TRUST_RUN_IDENTITY_MISMATCH: ${parsed.runId}`);
      if (existence.disposition === "live") live.push(member);
    }
    if (indexed.length > 0 && live.length === 0) {
      throw new SectionUnavailableError(`diagnostic artifact ${artifactId} belongs only to archived runs; use its immutable Archive resource`);
    }
    return live;
  };
  const liveMemberships = () => {
    try { return inspectMemberships(); } catch (error) {
      if (signal?.aborted === true && error === signal.reason) throw error;
      if (error instanceof TargetNotFoundError || error instanceof SectionUnavailableError) throw error;
      normalizeCorruption(artifactId, "attachment authority could not be verified", error);
    }
  };
  const initial = liveMemberships();
  const lease = await prepareDiagnosticArtifactLease({ authority: { findByArtifact: () => initial },
    artifactReader: deps.artifactReader }, artifactId, signal);
  try {
    const current = liveMemberships();
    if (current.length === 0) throw new TargetNotFoundError(`diagnostic artifact ${artifactId} membership was removed during preparation`);
    for (const { attachment } of current) {
      if (attachment.artifactId !== lease.ref.id || attachment.digest !== lease.ref.sha256
        || attachment.byteLength !== lease.ref.bytes || attachment.mediaType !== lease.ref.mediaType) {
        throw new DiagnosticBundleCorruptError(`diagnostic artifact ${artifactId} membership changed during preparation`);
      }
    }
    return lease;
  } catch (error) {
    const failures: unknown[] = [error];
    try { await lease.lease.dispose(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, "generic artifact admission and lease cleanup failed", { cause: error });
    throw error;
  }
}
