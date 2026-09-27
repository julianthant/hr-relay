import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../runtime-control/admission.js";
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
  | "published"
  | "directory-synced";

export interface ContentAddressedArtifactWriterOptions {
  readonly admission: RuntimeAdmission;
  readonly injectFault?: (step: ArtifactWriteFaultStep) => void;
}

async function materialize(source: Uint8Array | Readable, admission: RuntimeAdmission): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return Uint8Array.from(source);
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    admission.assertLive();
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

async function initializeArtifactRoot(admission: RuntimeAdmission): Promise<string> {
  admission.assertWritable();
  const root = admission.artifactRoot;
  admission.assertArtifactRoot(root);
  await rejectSymlink(root, "rebuild artifact root");
  admission.assertLive();
  await mkdir(root, { recursive: true, mode: 0o700 });
  admission.assertLive();
  await realpath(root);
  admission.assertLive();
  return root;
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
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let text: string;
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`artifact ${expectedDigest} is not a regular file`);
    text = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
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

function probeRecordedOwner(ownerPid: number): Readonly<{
  state: "dead" | "not-proven-dead";
}> {
  try {
    process.kill(ownerPid, 0);
    return Object.freeze({ state: "not-proven-dead" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return Object.freeze({ state: "dead" });
    }
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return Object.freeze({ state: "not-proven-dead" });
    }
    throw new Error(`cannot determine whether artifact temp owner ${ownerPid} is alive`, { cause: error });
  }
}

async function reclaimDeadOwnerTemps(root: string, sha256: string): Promise<void> {
  const prefix = `${sha256}.`;
  for (const name of await readdir(root)) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
    const ownerText = name.slice(prefix.length, name.indexOf(".", prefix.length));
    if (!/^[1-9][0-9]*$/u.test(ownerText)) continue;
    const ownerPid = Number(ownerText);
    if (!Number.isSafeInteger(ownerPid) || ownerPid === process.pid) continue;
    if (probeRecordedOwner(ownerPid).state === "dead") await unlinkIfPresent(join(root, name));
  }
}

function assertMatchingMediaType(stored: Readonly<{ ref: ArtifactRef }>, metadata: ArtifactPutMetadata): void {
  if (stored.ref.mediaType !== metadata.mediaType) {
    throw new Error(`artifact ${stored.ref.sha256} already exists with media type ${stored.ref.mediaType}`);
  }
}

export function createContentAddressedArtifactWriter(
  options: ContentAddressedArtifactWriterOptions,
): ContentAddressedArtifactWriter & { readonly ready: Promise<void> } {
  const admission = requireRuntimeAdmission(options.admission);
  admission.assertWritable();
  const rootPromise = initializeArtifactRoot(admission);
  return Object.freeze({
    /**
     * Root initialization starts at construction. A composition MUST await this
     * before serving: an un-awaited rejection (a workspace removed under a
     * fast shutdown) is an unhandled rejection, not a legible boot failure.
     * A getter, not a stored chain: a derived promise nobody awaits would
     * itself reject unhandled whenever `put()` already reported the failure.
     */
    get ready(): Promise<void> {
      return rootPromise.then(() => { admission.assertLive(); });
    },
    async put(source: Uint8Array | Readable, metadataInput: ArtifactPutMetadata) {
      admission.assertWritable();
      const metadata = ArtifactPutMetadataSchema.parse(metadataInput);
      admission.assertLive();
      const bytes = await materialize(source, admission);
      admission.assertLive();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const root = await rootPromise;
      admission.assertLive();
      const finalPath = join(root, `${sha256}.artifact`);
      admission.assertArtifactRoot(finalPath);
      await reclaimDeadOwnerTemps(root, sha256);
      admission.assertLive();
      const existing = await readIfPresent(finalPath, sha256);
      admission.assertLive();
      if (existing.state === "present") {
        assertMatchingMediaType(existing.value, metadata);
        await syncDirectory(root);
        admission.assertLive();
        return existing.value.ref;
      }

      const tempPath = join(root, `${sha256}.${process.pid}.${randomUUID()}.tmp`);
      let tempPresent = false;
      try {
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
        tempPresent = true;
        try {
          await handle.writeFile(JSON.stringify(stored), "utf8");
          admission.assertLive();
          options.injectFault?.("temp-written");
          await handle.sync();
          admission.assertLive();
          options.injectFault?.("temp-synced");
        } finally {
          await handle.close();
        }
        let result = Object.freeze(ref);
        try {
          admission.assertLive();
          await link(tempPath, finalPath);
          admission.assertLive();
          options.injectFault?.("published");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          const winner = await readStoredArtifact(finalPath, sha256);
          assertMatchingMediaType(winner, metadata);
          result = winner.ref;
        }
        await unlink(tempPath);
        tempPresent = false;
        await syncDirectory(root);
        admission.assertLive();
        options.injectFault?.("directory-synced");
        return result;
      } finally {
        if (tempPresent) await unlinkIfPresent(tempPath);
      }
    },
    async open(refInput: ArtifactRef) {
      admission.assertLive();
      const ref = ArtifactRefSchema.parse(refInput);
      const root = await rootPromise;
      admission.assertLive();
      const path = join(root, `${ref.sha256}.artifact`);
      admission.assertArtifactRoot(path);
      const stored = await readStoredArtifact(path, ref.sha256);
      admission.assertLive();
      if (stored.ref.id !== ref.id || stored.ref.bytes !== ref.bytes
        || stored.ref.mediaType !== ref.mediaType) {
        throw new Error(`artifact ${ref.id} metadata does not match stored content`);
      }
      return Readable.from((async function* () {
        admission.assertLive();
        yield Uint8Array.from(stored.bytes);
      })());
    },
  });
}
