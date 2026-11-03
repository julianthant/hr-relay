import type { Readable } from "node:stream";
import { ARTIFACT_COLLECTION_MEDIA_TYPE, ArtifactCollectionManifestSchema, CollectionArtifactOutputSchema,
  NamedFileArtifactOutputSchema, type CollectionArtifactOutput, type NamedFileArtifactOutput } from "../models/artifacts/artifacts.js";
import { canonicalJsonStringify } from "../rules/validation/canonical-json.js";
import type { ArtifactPutMetadata, ArtifactRef } from "../models/artifacts/artifacts.js";

export interface ContentAddressedArtifactWriter {
  put(source: Uint8Array | Readable, metadata: ArtifactPutMetadata): Promise<ArtifactRef>;
  open(ref: ArtifactRef): Promise<Readable>;
}

export interface StagedDiagnosticArtifact {
  readonly ref: ArtifactRef;
  publish(): ArtifactRef;
  dispose(): void;
  readonly published: boolean;
}

export interface DiagnosticArtifactWriter extends ContentAddressedArtifactWriter {
  stageDiagnostic(source: Uint8Array, metadata: ArtifactPutMetadata,
    retention: "ordinary" | "pinned"): Promise<StagedDiagnosticArtifact>;
}

/** The blocking documents-file projection publishes this task output before its step completes. */
export function namedArtifactOutput(artifact: ArtifactRef, fileName: string): NamedFileArtifactOutput {
  return NamedFileArtifactOutputSchema.parse({ artifact, fileName });
}

export async function collectionArtifactOutput(writer: ContentAddressedArtifactWriter,
  files: CollectionArtifactOutput["files"]): Promise<CollectionArtifactOutput> {
  const manifest = ArtifactCollectionManifestSchema.parse({ files });
  const artifact = await writer.put(new TextEncoder().encode(canonicalJsonStringify(manifest)), { mediaType: ARTIFACT_COLLECTION_MEDIA_TYPE });
  return CollectionArtifactOutputSchema.parse({ ...manifest, artifact });
}
