import type { ArtifactRef } from "../../../models/artifacts/artifacts.js";
import type { Fingerprint } from "../../../rules/identity/ids.js";
import type { ArtifactOutboxStorageRecord, ArtifactSinkHeadRecord } from "../sqlite/storage-records.js";

export class ArtifactSinkConflictError extends Error {
  readonly sinkId: string;
  readonly recordedSha256: string | undefined;
  readonly actualSha256: string | undefined;
  readonly preservedPendingPath: string | undefined;

  constructor(input: Readonly<{
    sinkId: string;
    message: string;
    recordedSha256?: string;
    actualSha256?: string;
    preservedPendingPath?: string;
  }>) {
    super(input.message);
    this.name = "ArtifactSinkConflictError";
    this.sinkId = input.sinkId;
    this.recordedSha256 = input.recordedSha256;
    this.actualSha256 = input.actualSha256;
    this.preservedPendingPath = input.preservedPendingPath;
  }
}

export interface ArtifactSinkProjectionRequest {
  readonly row: ArtifactOutboxStorageRecord;
  readonly head: ArtifactSinkHeadRecord | undefined;
  readonly previousArtifact: ArtifactRef | undefined;
  readonly prepare: (artifact: ArtifactRef) => void;
  readonly assertPrepared: (artifact: ArtifactRef) => void;
  readonly assertCurrent: () => Promise<void>;
  readonly lockPath: string;
}

export interface ArtifactSink {
  readonly sinkId: string;
  writerLockPath(row: ArtifactOutboxStorageRecord): Promise<string>;
  /** Publishes the row and returns its verified content hash. */
  project(request: ArtifactSinkProjectionRequest): Promise<Readonly<{ contentSha256: Fingerprint; artifact: ArtifactRef }>>;
}
