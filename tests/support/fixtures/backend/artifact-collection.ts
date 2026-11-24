import { ARTIFACT_COLLECTION_MEDIA_TYPE, ArtifactCollectionManifestSchema, CollectionArtifactOutputSchema, type CollectionArtifactOutput } from "../../../../src/models/artifacts/artifacts.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import type { ContentAddressedArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";

export async function fixtureArtifactCollection(writer: ContentAddressedArtifactWriter,
  files: CollectionArtifactOutput["files"]): Promise<CollectionArtifactOutput> {
  const manifest = ArtifactCollectionManifestSchema.parse({ files });
  const artifact = await writer.put(new TextEncoder().encode(canonicalJsonStringify(manifest)), { mediaType: ARTIFACT_COLLECTION_MEDIA_TYPE });
  return CollectionArtifactOutputSchema.parse({ ...manifest, artifact });
}
