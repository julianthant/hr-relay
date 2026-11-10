import { z } from "zod";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { DiagnosticAttachmentSchema } from "../../../models/trust/diagnostic.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const ArtifactReferenceContainerSchema = z.record(z.string(), z.unknown());

/** Returns a one-walk matcher: the digests of the candidates a value names by artifact id, sha256, digest or sourceSha256 anywhere inside it. */
export function deletionArtifactReferenceMatcher(candidates: Iterable<ArtifactRef>): (value: unknown) => ReadonlySet<string> {
  const byId = new Map<string, string[]>(), byDigest = new Set<string>();
  for (const ref of candidates) { byId.set(ref.id, [...byId.get(ref.id) ?? [], ref.sha256]); byDigest.add(ref.sha256); }
  return value => {
    const found = new Set<string>();
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) { for (const item of node) visit(item); return; }
      const artifactId: unknown = Reflect.get(node, "artifactId");
      if (typeof artifactId === "string") for (const digest of byId.get(artifactId) ?? []) found.add(digest);
      for (const key of ["sha256", "digest", "sourceSha256"]) {
        const digest: unknown = Reflect.get(node, key);
        if (typeof digest === "string" && byDigest.has(digest)) found.add(digest);
      }
      const preparation: unknown = Reflect.get(node, "preparationJson");
      if (typeof preparation === "string") visit(JSON.parse(preparation));
      for (const item of Object.values(node)) visit(item);
    };
    visit(value);
    return found;
  };
}

export function containsDeletionArtifactReference(value: unknown, ref: ArtifactRef): boolean {
  return deletionArtifactReferenceMatcher([ref])(value).size !== 0;
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
