import { createHash } from "node:crypto";
import { z } from "zod";
import rawProvenance from "../../../../config/ports/legacy-architecture-provenance.json" with { type: "json" };

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/u, "legacy commit must be an exact SHA-1 commit id");
const BlobSchema = z.string().regex(/^[0-9a-f]{40}$/u, "legacy blob must be an exact SHA-1 object id");
const FrozenFileSchema = z.strictObject({
  path: z.string().min(1),
  blob: BlobSchema,
  text: z.string(),
});

const FrozenFilesSchema = z.array(FrozenFileSchema).min(1).superRefine((files, context) => {
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "frozen legacy file paths must be unique" });
  }
});

/**
 * Unlike a Git blob, a path inventory is a generated snapshot: it represents
 * the output of the named legacy collection command, not an object reachable
 * from the legacy commit. Its SHA-256 authenticates the exact UTF-8 bytes.
 */
const FrozenPathSnapshotSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/u, "frozen path snapshot name must be kebab-case"),
  sourceCommand: z.string().min(1),
  contentAddress: z.string().regex(/^sha256:[0-9a-f]{64}$/u, "frozen path snapshot needs a SHA-256 content address"),
  text: z.string(),
});

export const FrozenLegacyArchitectureProvenanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  selector: z.strictObject({
    commit: CommitSchema,
    objectFormat: z.literal("sha1"),
    files: FrozenFilesSchema,
  }),
  runtime: z.strictObject({
    commit: CommitSchema,
    browserSystemFiles: FrozenPathSnapshotSchema,
    visionProvider: FrozenFileSchema,
  }),
  capabilities: z.strictObject({
    commit: CommitSchema,
    discoveredPaths: FrozenPathSnapshotSchema,
    sourcePaths: FrozenPathSnapshotSchema,
    legacyPaths: FrozenPathSnapshotSchema,
  }),
  testDisposition: z.strictObject({
    baselineCommit: CommitSchema,
    baselineFiles: FrozenPathSnapshotSchema,
    currentCommit: CommitSchema,
    currentFiles: FrozenPathSnapshotSchema,
  }),
  canonicalFields: z.strictObject({
    commit: CommitSchema,
    files: FrozenFilesSchema,
  }),
  operationalIsolation: z.strictObject({
    commit: CommitSchema,
    package: FrozenFileSchema.extend({
      path: z.literal("package.json"),
    }),
  }),
});

export type FrozenLegacyFile = z.infer<typeof FrozenFileSchema>;
export type FrozenPathSnapshot = z.infer<typeof FrozenPathSnapshotSchema>;
export type FrozenLegacyArchitectureProvenance = z.infer<typeof FrozenLegacyArchitectureProvenanceSchema>;

function gitBlobSha1(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(`blob ${String(bytes.byteLength)}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function assertFrozenBlob(file: FrozenLegacyFile): void {
  const actual = gitBlobSha1(file.text);
  if (actual !== file.blob) {
    throw new Error(`frozen legacy blob mismatch for ${file.path}: expected ${file.blob}; actual ${actual}`);
  }
}

function pathSnapshotSha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** Authenticate and parse a generated legacy path snapshot before exposing it. */
export function frozenLegacyPaths(snapshot: FrozenPathSnapshot): readonly string[] {
  const actual = pathSnapshotSha256(snapshot.text);
  if (actual !== snapshot.contentAddress) {
    throw new Error(
      `frozen legacy path snapshot content-address mismatch for ${snapshot.name}: expected ${snapshot.contentAddress}; actual ${actual}`,
    );
  }
  if (!snapshot.text.endsWith("\n")) {
    throw new Error(`frozen legacy path snapshot ${snapshot.name} must end with one trailing newline`);
  }
  const paths = snapshot.text.slice(0, -1).split("\n");
  if (paths.length === 0 || paths[0] === "") {
    throw new Error(`frozen legacy path snapshot ${snapshot.name} must not be empty`);
  }
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index] ?? "";
    if (path.length === 0 || path.trim() !== path) {
      throw new Error(`frozen legacy path snapshot ${snapshot.name} has a malformed path entry`);
    }
    const previous = paths[index - 1];
    if (previous !== undefined && previous === path) {
      throw new Error(`frozen legacy path snapshot ${snapshot.name} must not contain duplicate paths`);
    }
    if (previous !== undefined && previous > path) {
      throw new Error(`frozen legacy path snapshot ${snapshot.name} must be sorted`);
    }
  }
  return Object.freeze(paths);
}

function assertFrozenProvenanceIntegrity(provenance: FrozenLegacyArchitectureProvenance): void {
  for (const file of [
    ...provenance.selector.files,
    provenance.runtime.visionProvider,
    ...provenance.canonicalFields.files,
    provenance.operationalIsolation.package,
  ]) {
    assertFrozenBlob(file);
  }
  for (const snapshot of [
    provenance.runtime.browserSystemFiles,
    provenance.capabilities.discoveredPaths,
    provenance.capabilities.sourcePaths,
    provenance.capabilities.legacyPaths,
    provenance.testDisposition.baselineFiles,
    provenance.testDisposition.currentFiles,
  ]) {
    frozenLegacyPaths(snapshot);
  }
}

export function parseFrozenLegacyArchitectureProvenance(input: unknown): FrozenLegacyArchitectureProvenance {
  const provenance = FrozenLegacyArchitectureProvenanceSchema.parse(input);
  assertFrozenProvenanceIntegrity(provenance);
  return provenance;
}

export const FROZEN_LEGACY_ARCHITECTURE_PROVENANCE = parseFrozenLegacyArchitectureProvenance(rawProvenance);

export function frozenLegacyScripts(
  provenance: FrozenLegacyArchitectureProvenance = FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
): Readonly<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(provenance.operationalIsolation.package.text);
  } catch {
    throw new Error("frozen legacy package.json is not valid JSON");
  }
  return z.object({ scripts: z.record(z.string(), z.string()) }).passthrough().parse(parsed).scripts;
}

/**
 * The legacy checkout is a porting input, never a finished-gate dependency.
 * A missing source is a corrupt committed snapshot, not permission to skip it.
 */
export function frozenLegacyFile(files: readonly FrozenLegacyFile[], path: string): FrozenLegacyFile {
  const matches = files.filter((file) => file.path === path);
  if (matches.length !== 1) {
    throw new Error(`frozen legacy provenance requires exactly one ${path}; found ${String(matches.length)}`);
  }
  return matches[0];
}
