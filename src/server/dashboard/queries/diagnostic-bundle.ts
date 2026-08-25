/** D137 diagnostic-bundle readback: exact id, verified authority row, verified artifacts. */
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  DiagnosticBundleWireSchema,
  type DiagnosticBundleWire,
} from "../../../domain/dashboard/diagnostic-bundle.js";
import { ArtifactRefSchema } from "../../../domain/artifacts.js";
import { DiagnosticBundleIdSchema } from "../../../domain/ids.js";
import { deriveDiagnosticContentDigest } from "../../../domain/trust/diagnostic-capture.js";
import {
  DiagnosticAttachmentSchema,
  DiagnosticBundleSchema,
  type DiagnosticBundle,
} from "../../../domain/trust/diagnostic.js";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { DiagnosticBundleCorruptError, TargetNotFoundError } from "../../failures.js";

export interface DiagnosticBundleQueryDeps {
  readonly authority: Pick<AuthorityRepositories["diagnosticBundles"], "get" | "listAttachments">;
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "open">;
}

function corrupt(bundleId: string, message: string): never {
  throw new DiagnosticBundleCorruptError(`diagnostic bundle ${bundleId} is corrupt: ${message}`);
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
  const ref = ArtifactRefSchema.parse({
    id: attachment.artifactId,
    sha256: attachment.digest,
    bytes: attachment.byteLength,
    mediaType: attachment.mediaType,
  });
  const stream = await artifacts.open(ref);
  const digest = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) corrupt(bundleId, `attachment ${attachment.artifactId} emitted a non-byte chunk`);
    byteLength += chunk.byteLength;
    if (!Number.isSafeInteger(byteLength)) corrupt(bundleId, `attachment ${attachment.artifactId} exceeds safe byte accounting`);
    digest.update(chunk);
  }
  if (byteLength !== attachment.byteLength) {
    corrupt(bundleId, `attachment ${attachment.artifactId} read ${String(byteLength)} bytes but record names ${String(attachment.byteLength)}`);
  }
  const actualDigest = digest.digest("hex");
  if (actualDigest !== attachment.digest) {
    corrupt(bundleId, `attachment ${attachment.artifactId} digest ${actualDigest} does not match ${attachment.digest}`);
  }
}

function verifyAttachmentIndex(bundle: DiagnosticBundle, indexed: readonly { attachment: unknown }[]): void {
  if (indexed.length !== bundle.attachments.length) {
    corrupt(bundle.bundleId, `attachment index has ${String(indexed.length)} rows but bundle names ${String(bundle.attachments.length)}`);
  }
  const byArtifactId = new Map(indexed.map((row) => {
    const attachment = DiagnosticAttachmentSchema.parse(row.attachment);
    return [attachment.artifactId, attachment] as const;
  }));
  if (byArtifactId.size !== indexed.length) corrupt(bundle.bundleId, "attachment index repeats an artifact id");
  for (const attachment of bundle.attachments) {
    const indexedAttachment = byArtifactId.get(attachment.artifactId);
    if (indexedAttachment === undefined) corrupt(bundle.bundleId, `attachment index lacks ${attachment.artifactId}`);
    if (canonicalJsonStringify(indexedAttachment) !== canonicalJsonStringify(attachment)) {
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
  const stored = deps.authority.get(bundleId);
  if (stored === undefined) throw new TargetNotFoundError(`diagnostic bundle ${bundleId} does not exist`);
  const bundle = DiagnosticBundleSchema.parse(stored);
  const expectedDigest = deriveDiagnosticContentDigest({
    runId: bundle.runId,
    origin: bundle.origin,
    capturedAt: bundle.createdAt,
    configFingerprint: bundle.configFingerprint,
    descriptorFingerprint: bundle.descriptorFingerprint,
    redaction: bundle.redaction,
    attachments: bundle.attachments,
  });
  if (bundle.contentDigest !== expectedDigest) {
    corrupt(bundleId, `content digest ${bundle.contentDigest} does not match ${expectedDigest}`);
  }
  verifyAttachmentIndex(bundle, deps.authority.listAttachments(bundleId));
  await Promise.all(bundle.attachments.map((attachment) => verifyArtifact(bundleId, attachment, deps.artifacts)));

  let byteSize = 0;
  for (const attachment of bundle.attachments) {
    byteSize += attachment.byteLength;
    if (!Number.isSafeInteger(byteSize)) corrupt(bundleId, "attachment byte size exceeds safe accounting");
  }
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
}
