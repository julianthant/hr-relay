import { z } from "zod";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { DiagnosticAttachmentSchema } from "../../../models/trust/diagnostic.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const ArtifactReferenceContainerSchema = z.record(z.string(), z.unknown());

export function containsDeletionArtifactReference(value: unknown, ref: ArtifactRef): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => containsDeletionArtifactReference(item, ref));
  const record = ArtifactReferenceContainerSchema.parse(value);
  if (record.artifactId === ref.id || record.sha256 === ref.sha256 || record.digest === ref.sha256 || record.sourceSha256 === ref.sha256) return true;
  if (typeof record.preparationJson === "string" && containsDeletionArtifactReference(JSON.parse(record.preparationJson), ref)) return true;
  return Object.values(record).some(item => containsDeletionArtifactReference(item, ref));
}

export function artifactReferencesIn(input: unknown): readonly ArtifactRef[] {
  const references = new Map<string, ArtifactRef>();
  const add = (ref: ArtifactRef): void => {
    const prior = references.get(ref.sha256);
    if (prior !== undefined && canonicalJsonStringify(prior) !== canonicalJsonStringify(ref)) throw new Error("artifact-reference-identity-mismatch");
    references.set(ref.sha256, ref);
  };
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const full = ArtifactRefSchema.safeParse(value);
    if (full.success) add(full.data);
    const attachment = DiagnosticAttachmentSchema.safeParse(value);
    if (attachment.success) add(ArtifactRefSchema.parse({ id: attachment.data.artifactId, sha256: attachment.data.digest,
      bytes: attachment.data.byteLength, mediaType: attachment.data.mediaType }));
    if (Array.isArray(value)) { for (const member of value) visit(member); return; }
    const record = ArtifactReferenceContainerSchema.parse(value);
    if (typeof record.preparationJson === "string") visit(JSON.parse(record.preparationJson));
    for (const member of Object.values(record)) visit(member);
  };
  visit(input);
  return [...references.values()];
}
