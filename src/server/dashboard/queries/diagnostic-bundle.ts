/** D137 diagnostic-bundle readback: exact id, verified authority row, verified artifacts. */
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  DiagnosticBundleWireSchema,
  type DiagnosticBundleWire,
} from "../../../domain/dashboard/diagnostic-bundle.js";
import { ArtifactRefSchema } from "../../../domain/artifacts.js";
import { DiagnosticBundleIdSchema } from "../../../domain/ids.js";
import { deriveDiagnosticContentDigest } from "../../../domain/trust/diagnostic-capture.js";
import {
  DiagnosticBundleSchema,
  type DiagnosticBundle,
} from "../../../domain/trust/diagnostic.js";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../infra/sqlite/storage-records.js";
import { DiagnosticBundleCorruptError, TargetNotFoundError } from "../../failures.js";
import {
  ArtifactBytesCorruptError,
  verifyArtifactBytes,
} from "./artifact-bytes.js";

export interface DiagnosticBundleQueryDeps {
  readonly authority: Pick<AuthorityRepositories["diagnosticBundles"], "get" | "listAttachments">;
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "open">;
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
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
): Promise<void> {
  const attachmentLabel = `attachment ${attachment.artifactId} (${attachment.kind})`;
  try {
    const ref = ArtifactRefSchema.parse({
      id: attachment.artifactId,
      sha256: attachment.digest,
      bytes: attachment.byteLength,
      mediaType: attachment.mediaType,
    });
    await verifyArtifactBytes(artifacts, ref);
  } catch (error: unknown) {
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

export async function readDiagnosticBundle(
  deps: DiagnosticBundleQueryDeps,
  bundleIdInput: unknown,
): Promise<DiagnosticBundleReadback> {
  const bundleId = DiagnosticBundleIdSchema.parse(bundleIdInput);
  let stored: DiagnosticBundle | undefined;
  try {
    stored = deps.authority.get(bundleId);
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the durable authority record could not be read", error);
  }
  if (stored === undefined) throw new TargetNotFoundError(`diagnostic bundle ${bundleId} does not exist`);
  let bundle: DiagnosticBundle;
  try {
    bundle = DiagnosticBundleSchema.parse(stored);
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the durable authority record is invalid", error);
  }
  if (bundle.bundleId !== bundleId) {
    corrupt(bundleId, "durable authority identity mismatch");
  }
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
    });
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the content identity could not be verified", error);
  }
  if (bundle.contentDigest !== expectedDigest) {
    corrupt(bundleId, "the content identity does not match the durable record");
  }
  try {
    verifyAttachmentIndex(bundle, deps.authority.listAttachments(bundleId));
  } catch (error: unknown) {
    normalizeCorruption(bundleId, "the attachment index could not be verified", error);
  }
  await Promise.all(bundle.attachments.map((attachment) => verifyArtifact(bundleId, attachment, deps.artifacts)));

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
