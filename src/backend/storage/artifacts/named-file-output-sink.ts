import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ArtifactCollectionManifestSchema, NamedArtifactOutputSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { ArtifactOutboxStorageRecord } from "../sqlite/storage-records.js";
import { retainAuthoritySourceClosure } from "../source-closure.js";
import { ArtifactSinkConflictError, type ArtifactSink, type ArtifactSinkProjectionRequest } from "./artifact-sink.js";

export type NamedFilePublicationPoint = "staged" | "prepared" | "published" | "directory-synced";

async function optionalStat(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function verifiedBytes(artifacts: ContentAddressedArtifactWriter, artifact: ArtifactRef, request: ArtifactSinkProjectionRequest) {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of await artifacts.open(artifact)) {
    await request.assertCurrent();
    if (!(chunk instanceof Uint8Array)) throw new Error("named-file-output-non-byte-artifact");
    length += chunk.byteLength;
    if (length > artifact.bytes) throw new Error("named-file-output-artifact-size-mismatch");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== artifact.bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("named-file-output-artifact-mismatch");
  return bytes;
}

async function matchesArtifact(path: string, artifact: ArtifactRef): Promise<boolean> {
  const bytes = await readFile(path, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
  return bytes.byteLength === artifact.bytes && createHash("sha256").update(bytes).digest("hex") === artifact.sha256;
}

export function createNamedFileOutputSink(options: Readonly<{
  artifacts: ContentAddressedArtifactWriter;
  documentsDirectory(row: ArtifactOutboxStorageRecord): string;
  fault?: (point: NamedFilePublicationPoint) => void | Promise<void>;
}>): ArtifactSink {
  const destination = async (row: ArtifactOutboxStorageRecord) => {
    if (row.sinkId !== `documents-file-${row.sourceRunId}`) throw new Error("named-file-output-run-mismatch");
    const output = NamedArtifactOutputSchema.parse(row.payload.value), directory = options.documentsDirectory(row);
    if (!isAbsolute(directory) || resolve(directory) !== directory) throw new Error("named-file-output-directory-invalid");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const canonical = await realpath(directory);
    const name = "fileName" in output ? output.fileName : "collection";
    const files = "files" in output ? output.files : [{ relativePath: output.fileName, artifact: output.artifact }];
    return { output, directory: canonical, lockPath: join(canonical, `.${name}.relay-output.lock`),
      files: files.map(file => ({ ...file, path: join(canonical, file.relativePath) })) };
  };
  return Object.freeze({
    sinkId: "documents-file",
    async writerLockPath(row: ArtifactOutboxStorageRecord) { return (await destination(row)).lockPath; },
    async project(request: ArtifactSinkProjectionRequest) {
      await request.assertCurrent();
      const target = await destination(request.row);
      if (request.lockPath !== target.lockPath) throw new Error("named-file-output-directory-changed");
      const conflict = () => new ArtifactSinkConflictError({ sinkId: request.row.sinkId, message: "named-file-output-destination-collision" });
      if (request.head !== undefined) throw conflict();
      const parents = new Set([target.directory]);
      for (const file of target.files) {
        let parent = dirname(file.path);
        while (parent !== target.directory) { parents.add(parent); parent = dirname(parent); }
      }
      const orderedParents = [...parents].sort((a, b) => a.length - b.length);
      const identities = new Map<string, { dev: number; ino: number }>();
      const assertParents = async (create: boolean) => {
        await request.assertCurrent();
        for (const path of orderedParents) {
          let current = await optionalStat(path);
          const previous = identities.get(path);
          if (current === undefined && previous !== undefined) throw new Error("named-file-output-directory-custody-changed");
          if (current === undefined && create) { await mkdir(path, { mode: 0o700 }); current = await lstat(path); }
          if (current === undefined) continue;
          if (!current.isDirectory() || current.isSymbolicLink() || await realpath(path) !== path
            || previous !== undefined && (previous.dev !== current.dev || previous.ino !== current.ino)) throw new Error("named-file-output-directory-custody-changed");
          identities.set(path, { dev: current.dev, ino: current.ino });
        }
        await request.assertCurrent();
      };
      await assertParents(false);
      for (const file of target.files) if (await optionalStat(file.path) !== undefined) throw conflict();
      const manifest = await verifiedBytes(options.artifacts, target.output.artifact, request);
      if ("files" in target.output && !manifest.equals(Buffer.from(canonicalJsonStringify(ArtifactCollectionManifestSchema.parse({ files: target.output.files }))))) {
        throw new Error("named-file-output-collection-manifest-mismatch");
      }
      const staged: Array<typeof target.files[number] & { stage: string; identity: { dev: number; ino: number } }> = [];
      for (const [index, file] of target.files.entries()) {
        const bytes = "fileName" in target.output ? manifest : await verifiedBytes(options.artifacts, file.artifact, request);
        const stage = join(target.directory, `.relay-${request.row.outboxId}-${String(index)}.tmp`);
        await assertParents(false);
        const handle = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        let primary: { error: unknown } | undefined;
        let identity;
        try { identity = await handle.stat(); await handle.writeFile(bytes); await handle.sync(); }
        catch (error) { primary = { error }; }
        try { await handle.close(); }
        catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { directory: { handle, stage } }); }
        if (primary !== undefined) throw primary.error;
        if (identity === undefined) throw new Error("named-file-output-stage-identity-unavailable");
        staged.push({ ...file, stage, identity });
      }
      const assertStage = async (file: typeof staged[number]) => {
        const current = await lstat(file.stage);
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== file.identity.dev || current.ino !== file.identity.ino
          || current.nlink !== 1 || !(await matchesArtifact(file.stage, file.artifact))) throw new Error("named-file-output-staged-bytes-changed");
      };
      await options.fault?.("staged"); await assertParents(false);
      for (const file of staged) await assertStage(file);
      request.prepare(target.output.artifact); await options.fault?.("prepared"); await assertParents(true); request.assertPrepared(target.output.artifact);
      for (const file of staged) {
        await assertParents(false); await assertStage(file); request.assertPrepared(target.output.artifact);
        try { await link(file.stage, file.path); }
        catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") throw conflict();
          throw error;
        }
        await options.fault?.("published"); await assertParents(false);
      }
      for (const path of [...orderedParents].reverse()) {
        const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        let primary: { error: unknown } | undefined;
        try { await directory.sync(); }
        catch (error) { primary = { error }; }
        try { await directory.close(); }
        catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { directory: { directory, path } }); }
        if (primary !== undefined) throw primary.error;
      }
      await options.fault?.("directory-synced"); await assertParents(false);
      for (const file of staged) {
        const published = await lstat(file.path);
        if (!published.isFile() || published.isSymbolicLink() || published.dev !== file.identity.dev || published.ino !== file.identity.ino
          || !(await matchesArtifact(file.path, file.artifact))) throw conflict();
        await unlink(file.stage);
      }
      return { contentSha256: target.output.artifact.sha256, artifact: target.output.artifact };
    },
  });
}
