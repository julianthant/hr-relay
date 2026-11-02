import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { NamedArtifactOutputSchema } from "../../../models/artifacts/artifacts.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { ArtifactOutboxStorageRecord } from "../sqlite/storage-records.js";
import { retainAuthoritySourceClosure } from "../source-closure.js";
import { ArtifactSinkConflictError, type ArtifactSink, type ArtifactSinkProjectionRequest } from "./artifact-sink.js";

export type NamedFilePublicationPoint = "staged" | "prepared" | "published" | "directory-synced";

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
    return { output, directory: canonical, path: join(canonical, output.fileName) };
  };
  return Object.freeze({
    sinkId: "documents-file",
    async writerLockPath(row: ArtifactOutboxStorageRecord) {
      const target = await destination(row);
      return join(target.directory, `.${target.output.fileName}.relay-output.lock`);
    },
    async project(request: ArtifactSinkProjectionRequest) {
      await request.assertCurrent();
      const target = await destination(request.row);
      if (request.lockPath !== join(target.directory, `.${target.output.fileName}.relay-output.lock`)) throw new Error("named-file-output-directory-changed");
      const conflict = () => new ArtifactSinkConflictError({ sinkId: request.row.sinkId, message: "named-file-output-destination-collision" });
      if (request.head !== undefined || await lstat(target.path).then(() => true, error => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      })) throw conflict();
      const chunks: Buffer[] = []; let length = 0;
      const artifact = target.output.artifact;
      for await (const chunk of await options.artifacts.open(artifact)) {
        await request.assertCurrent();
        if (!(chunk instanceof Uint8Array)) throw new Error("named-file-output-non-byte-artifact");
        length += chunk.byteLength;
        if (length > artifact.bytes) throw new Error("named-file-output-artifact-size-mismatch");
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks), digest = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== artifact.bytes || digest !== artifact.sha256) throw new Error("named-file-output-artifact-mismatch");
      const stage = join(target.directory, `.${target.output.fileName}.relay-${request.row.outboxId}.tmp`);
      await request.assertCurrent();
      const handle = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let primary: { error: unknown } | undefined;
      try { await handle.writeFile(bytes); await handle.sync(); }
      catch (error) { primary = { error }; }
      try { await handle.close(); }
      catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { directory: { handle, stage } }); }
      if (primary !== undefined) throw primary.error;
      await options.fault?.("staged"); await request.assertCurrent();
      if (!(await readFile(stage)).equals(bytes)) throw new Error("named-file-output-staged-bytes-changed");
      request.prepare(artifact); await options.fault?.("prepared"); await request.assertCurrent(); request.assertPrepared(artifact);
      try { await link(stage, target.path); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") throw conflict();
        throw error;
      }
      await options.fault?.("published"); await request.assertCurrent();
      const directory = await open(dirname(target.path), "r");
      try { await directory.sync(); }
      catch (error) {
        try { await directory.close(); }
        catch (close) { throw retainAuthoritySourceClosure([error, close], { directory: { directory, path: target.directory } }); }
        throw error;
      }
      try { await directory.close(); }
      catch (error) { throw retainAuthoritySourceClosure([error], { directory: { directory, path: target.directory } }); }
      await options.fault?.("directory-synced"); await request.assertCurrent();
      const published = await lstat(target.path);
      if (!published.isFile() || published.isSymbolicLink() || !(await readFile(target.path)).equals(bytes)) throw conflict();
      await unlink(stage);
      return { contentSha256: FingerprintSchema.parse(digest), artifact };
    },
  });
}
