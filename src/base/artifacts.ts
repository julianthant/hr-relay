import type { Readable } from "node:stream";
import type { ArtifactPutMetadata, ArtifactRef } from "../domain/artifacts.js";

export interface ContentAddressedArtifactWriter {
  put(source: Uint8Array | Readable, metadata: ArtifactPutMetadata): Promise<ArtifactRef>;
  open(ref: ArtifactRef): Promise<Readable>;
}
