import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import { RebuildArtifactRootSchema } from "../../config/define-runtime-isolation.js";
import {
  ArtifactPutMetadataSchema,
  ArtifactRefSchema,
} from "../../domain/artifacts.js";
import type { ArtifactPutMetadata, ArtifactRef } from "../../domain/artifacts.js";
import { ArtifactIdSchema } from "../../domain/ids.js";

const StoredArtifactSchema = z.strictObject({
  ref: ArtifactRefSchema,
  payloadBase64: z.string(),
});

export type ArtifactWriteFaultStep =
  | "temp-written"
  | "temp-synced"
  | "renamed"
  | "directory-synced";

export interface ContentAddressedArtifactWriterOptions {
  readonly workspaceRoot: string;
  readonly artifactRoot: unknown;
  readonly injectFault?: (step: ArtifactWriteFaultStep) => void;
}

async function materialize(source: Uint8Array | Readable): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return Uint8Array.from(source);
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Uint8Array.from(chunk));
    else throw new Error("artifact source emitted a non-byte chunk");
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

async function rejectSymlink(path: string, label: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link: ${path}`);
    if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function initializeArtifactRoot(workspaceRoot: string, artifactRoot: string): Promise<string> {
  if (!isAbsolute(workspaceRoot)) throw new Error("artifact workspaceRoot must be absolute");
  const workspace = resolve(workspaceRoot);
  if (workspace === sep) throw new Error("artifact workspaceRoot cannot be the filesystem root");
  const trackerRoot = join(workspace, ".tracker-rebuild");
  const root = join(workspace, artifactRoot);
  await rejectSymlink(trackerRoot, "rebuild state root");
  await mkdir(trackerRoot, { recursive: true, mode: 0o700 });
  await rejectSymlink(root, "rebuild artifact root");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const [workspaceReal, rootReal] = await Promise.all([realpath(workspace), realpath(root)]);
  if (!rootReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new Error(`artifact root ${rootReal} escapes workspace ${workspaceReal}`);
  }
  return rootReal;
}

function decodeStoredArtifact(input: unknown, expectedDigest: string): Readonly<{
  ref: ArtifactRef;
  bytes: Uint8Array;
}> {
  const stored = StoredArtifactSchema.parse(input);
  const bytes = Uint8Array.from(Buffer.from(stored.payloadBase64, "base64"));
  if (Buffer.from(bytes).toString("base64") !== stored.payloadBase64) {
    throw new Error(`artifact ${stored.ref.id} has invalid base64 payload`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest || stored.ref.sha256 !== expectedDigest) {
    throw new Error(`artifact ${stored.ref.id} content digest does not match ${expectedDigest}`);
  }
  if (stored.ref.bytes !== bytes.byteLength) {
    throw new Error(`artifact ${stored.ref.id} byte length does not match stored content`);
  }
  return Object.freeze({ ref: Object.freeze(stored.ref), bytes });
}

async function readStoredArtifact(path: string, expectedDigest: string) {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`artifact ${expectedDigest} is not valid JSON`, { cause: error });
  }
  return decodeStoredArtifact(parsed, expectedDigest);
}

async function readIfPresent(path: string, expectedDigest: string) {
  try {
    return { state: "present" as const, value: await readStoredArtifact(path, expectedDigest) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { state: "absent" as const };
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export function createContentAddressedArtifactWriter(
  options: ContentAddressedArtifactWriterOptions,
): ContentAddressedArtifactWriter {
  const artifactRoot = RebuildArtifactRootSchema.parse(options.artifactRoot);
  const rootPromise = initializeArtifactRoot(options.workspaceRoot, artifactRoot);
  return Object.freeze({
    async put(source: Uint8Array | Readable, metadataInput: ArtifactPutMetadata) {
      const metadata = ArtifactPutMetadataSchema.parse(metadataInput);
      const bytes = await materialize(source);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const root = await rootPromise;
      const finalPath = join(root, `${sha256}.artifact`);
      const existing = await readIfPresent(finalPath, sha256);
      if (existing.state === "present") {
        if (existing.value.ref.mediaType !== metadata.mediaType) {
          throw new Error(`artifact ${sha256} already exists with media type ${existing.value.ref.mediaType}`);
        }
        return existing.value.ref;
      }

      const lockPath = join(root, `${sha256}.lock`);
      try {
        await mkdir(lockPath, { mode: 0o700 });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new Error(`artifact ${sha256} is already being written`, { cause: error });
        }
        throw error;
      }

      const tempPath = join(root, `${sha256}.${randomUUID()}.tmp`);
      let renamed = false;
      try {
        const raced = await readIfPresent(finalPath, sha256);
        if (raced.state === "present") {
          if (raced.value.ref.mediaType !== metadata.mediaType) {
            throw new Error(`artifact ${sha256} already exists with media type ${raced.value.ref.mediaType}`);
          }
          return raced.value.ref;
        }
        const ref = ArtifactRefSchema.parse({
          id: ArtifactIdSchema.parse(randomUUID()),
          sha256,
          bytes: bytes.byteLength,
          mediaType: metadata.mediaType,
        });
        const stored = StoredArtifactSchema.parse({
          ref,
          payloadBase64: Buffer.from(bytes).toString("base64"),
        });
        const handle = await open(tempPath, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(stored), "utf8");
          options.injectFault?.("temp-written");
          await handle.sync();
          options.injectFault?.("temp-synced");
        } finally {
          await handle.close();
        }
        await rename(tempPath, finalPath);
        renamed = true;
        options.injectFault?.("renamed");
        await syncDirectory(root);
        options.injectFault?.("directory-synced");
        return Object.freeze(ref);
      } finally {
        if (!renamed) await unlinkIfPresent(tempPath);
        await rmdir(lockPath);
      }
    },
    async open(refInput: ArtifactRef) {
      const ref = ArtifactRefSchema.parse(refInput);
      const root = await rootPromise;
      const stored = await readStoredArtifact(join(root, `${ref.sha256}.artifact`), ref.sha256);
      if (stored.ref.id !== ref.id || stored.ref.bytes !== ref.bytes
        || stored.ref.mediaType !== ref.mediaType) {
        throw new Error(`artifact ${ref.id} metadata does not match stored content`);
      }
      return Readable.from([Uint8Array.from(stored.bytes)]);
    },
  });
}
