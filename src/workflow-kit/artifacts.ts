import type { Readable } from "node:stream";
import { NamedArtifactOutputSchema, type NamedArtifactOutput } from "../models/artifacts/artifacts.js";
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
export function namedArtifactOutput(artifact: ArtifactRef, fileName: string): NamedArtifactOutput {
  return NamedArtifactOutputSchema.parse({ artifact, fileName });
}
