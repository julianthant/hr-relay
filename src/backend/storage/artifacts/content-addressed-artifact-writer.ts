import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, readFileSync, readSync, lstatSync, unlinkSync, fsyncSync, linkSync, readdirSync } from "node:fs";
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
import type { DiagnosticArtifactWriter, StagedDiagnosticArtifact } from "../../../workflow-kit/artifacts.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import {
  ArtifactPutMetadataSchema,
  ArtifactRefSchema,
} from "../../../models/artifacts/artifacts.js";
import type { ArtifactPutMetadata, ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { ArtifactIdSchema } from "../../../rules/identity/ids.js";

export class ArtifactReadClosureUnprovedError extends Error {
  readonly code = "ARTIFACT_READ_CLOSURE_UNPROVED";
  constructor(cause: unknown) { super(ERROR_CATALOG.ARTIFACT_READ_CLOSURE_UNPROVED.text, { cause }); this.name = "ArtifactReadClosureUnprovedError"; }
}

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

function inspectDeletionFile(admission: RuntimeAdmission, input: ArtifactRef) {
  requireRuntimeAdmission(admission).assertLive();
  const ref = ArtifactRefSchema.parse(input);
  admission.assertArtifactRoot(admission.artifactRoot);
  const path = join(admission.artifactRoot, `${ref.sha256}.artifact`);
  const handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = fstatSync(handle);
    if (!status.isFile()) throw new Error("artifact-deletion-file-not-regular");
    const stored = readFileSync(handle);
    const decoded = decodeStoredArtifact(JSON.parse(stored.toString("utf8")) as unknown, ref.sha256);
    if (decoded.ref.id !== ref.id || decoded.ref.bytes !== ref.bytes || decoded.ref.mediaType !== ref.mediaType) throw new Error("artifact-deletion-reference-mismatch");
    return {path,device:status.dev,inode:status.ino,ref,storedSha256:createHash("sha256").update(stored).digest("hex"),storedBytes:stored.byteLength};
  } finally { closeSync(handle); }
}

export function inspectArtifactDeletionFile(admission: RuntimeAdmission, input: ArtifactRef) {
  const {ref,storedSha256,storedBytes} = inspectDeletionFile(admission,input);
  return {ref,storedSha256: FingerprintSchema.parse(storedSha256),storedBytes};
}

export function removeArtifactDeletionFile(admission: RuntimeAdmission,
  captured: Readonly<{ref:ArtifactRef;storedSha256:string;storedBytes:number}>) {
  requireRuntimeAdmission(admission).assertWritable();
  let observed: ReturnType<typeof inspectDeletionFile>;
  try { observed = inspectDeletionFile(admission,captured.ref); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "already-absent" as const;
    throw error;
  }
  if (observed.storedSha256 !== captured.storedSha256 || observed.storedBytes !== captured.storedBytes) throw new Error("artifact-deletion-captured-bytes-mismatch");
  admission.assertLive();
  const current = lstatSync(observed.path);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== observed.device || current.ino !== observed.inode) throw new Error("artifact-deletion-custody-changed");
  unlinkSync(observed.path);
  const directory = openSync(admission.artifactRoot,constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return "removed" as const;
}

async function readStoredArtifact(path: string, expectedDigest: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let outcome: { readonly kind: "read"; readonly text: string } | { readonly kind: "error"; readonly error: unknown };
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`artifact ${expectedDigest} is not a regular file`);
    outcome = { kind: "read", text: await handle.readFile("utf8") };
  } catch (error) { outcome = { kind: "error", error }; }
  try { await handle.close(); }
  catch (error) { throw new ArtifactReadClosureUnprovedError(outcome.kind === "read" ? error
    : new AggregateError([outcome.error, error], "Artifact read and closure failed")); }
  if (outcome.kind === "error") throw outcome.error;
  const text = outcome.text;
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
    if (!name.startsWith(prefix) || !name.endsWith(".tmp") || name.endsWith(".diagnostic.tmp")) continue;
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

function syncArtifactDirectory(root: string): void {
  const descriptor = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

const MAX_DIAGNOSTIC_ENVELOPE_BYTES = Math.ceil(10 * 1024 * 1024 / 3) * 4 + 4096;

function inspectStoredFile(admission: RuntimeAdmission, path: string, digest: string) {
  admission.assertArtifactRoot(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = fstatSync(descriptor);
    if (!status.isFile()) throw new Error("diagnostic-stage-not-regular");
    if (status.size > MAX_DIAGNOSTIC_ENVELOPE_BYTES) throw new Error("diagnostic-stage-size-exceeded");
    const buffer = Buffer.alloc(status.size + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const read = readSync(descriptor, buffer, length, buffer.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    const stored = buffer.subarray(0, length);
    const after = fstatSync(descriptor), pathStatus = lstatSync(path);
    if (stored.byteLength !== status.size || after.size !== status.size || after.mtimeMs !== status.mtimeMs
      || after.ctimeMs !== status.ctimeMs || !pathStatus.isFile() || pathStatus.isSymbolicLink()
      || pathStatus.dev !== status.dev || pathStatus.ino !== status.ino) throw new Error("diagnostic-stage-custody-changed");
    const decoded = decodeStoredArtifact(JSON.parse(stored.toString("utf8")) as unknown, digest);
    return { path, device: status.dev, inode: status.ino, storedDigest: createHash("sha256").update(stored).digest("hex"), ...decoded };
  } finally { closeSync(descriptor); }
}

const diagnosticStageName = /^([a-f0-9]{64})\.([1-9][0-9]*)\.([a-f0-9-]{36})\.(ordinary|pinned)\.diagnostic\.tmp$/u;
function inspectDiagnosticStage(admission: RuntimeAdmission, path: string) {
  const match = diagnosticStageName.exec(path.slice(path.lastIndexOf("/") + 1));
  if (match === null) throw new Error("diagnostic-stage-name-invalid");
  return { ...inspectStoredFile(admission, path, match[1]), retention: match[4] };
}
function assertDiagnosticStage(admission: RuntimeAdmission, captured: ReturnType<typeof inspectDiagnosticStage>): void {
  admission.assertWritable();
  const current = inspectDiagnosticStage(admission, captured.path);
  if (current.device !== captured.device || current.inode !== captured.inode || current.storedDigest !== captured.storedDigest) {
    throw new Error("diagnostic-stage-custody-changed");
  }
}

export function pendingDiagnosticArtifacts(admission: RuntimeAdmission, ordinaryOnly = false): readonly ArtifactRef[] {
  admission.assertLive();
  admission.assertArtifactRoot(admission.artifactRoot);
  let names: string[];
  try { names = readdirSync(admission.artifactRoot); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  return names.filter(name => name.endsWith(".diagnostic.tmp")).flatMap(name => {
    const stage = inspectDiagnosticStage(admission, join(admission.artifactRoot, name));
    return !ordinaryOnly || stage.retention === "ordinary" ? [stage.ref] : [];
  });
}

export function reclaimDiagnosticStages(admission: RuntimeAdmission, referenced: (ref: ArtifactRef) => boolean): number {
  admission.assertExclusive();
  let names: string[];
  try { names = readdirSync(admission.artifactRoot); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0; throw error; }
  if (admission.readInstallationContext() === undefined) throw new Error("diagnostic-stage-cleanup-installation-required");
  const stages = names.filter(name => name.endsWith(".diagnostic.tmp"))
    .map(name => inspectDiagnosticStage(admission, join(admission.artifactRoot, name)));
  const pinnedDigests = new Set(stages.filter(stage => stage.retention === "pinned").map(stage => stage.ref.sha256));
  const inventory = stages.map(stage => {
    const finalPath = join(admission.artifactRoot, `${stage.ref.sha256}.artifact`);
    let final: ReturnType<typeof inspectStoredFile> | undefined;
    try { final = inspectStoredFile(admission, finalPath, stage.ref.sha256); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const retained = referenced(final?.ref ?? stage.ref);
    const protectedPending = !retained && pinnedDigests.has(stage.ref.sha256);
    if (final !== undefined && !retained && !protectedPending && !stages.some(owner => owner.device === final.device
      && owner.inode === final.inode && owner.storedDigest === final.storedDigest)) {
      throw new Error("diagnostic-stage-shared-publication-unresolved");
    }
    return { stage, final, finalPath, retained, protectedPending };
  });
  for (const { stage } of inventory) assertDiagnosticStage(admission, stage);
  const removedFinals = new Set<string>();
  let removed = 0;
  for (const { stage, final, finalPath, retained, protectedPending } of inventory) {
    if (protectedPending) continue;
    if (final !== undefined && !retained && !removedFinals.has(finalPath)) {
      const current = inspectStoredFile(admission, finalPath, stage.ref.sha256);
      if (current.device !== final.device || current.inode !== final.inode || current.storedDigest !== final.storedDigest) throw new Error("diagnostic-final-custody-changed");
      unlinkSync(finalPath);
      removedFinals.add(finalPath);
    }
    assertDiagnosticStage(admission, stage);
    unlinkSync(stage.path);
    syncArtifactDirectory(admission.artifactRoot);
    removed++;
  }
  return removed;
}

export function createContentAddressedArtifactWriter(
  options: ContentAddressedArtifactWriterOptions,
): DiagnosticArtifactWriter & { readonly ready: Promise<void> } {
  const admission = requireRuntimeAdmission(options.admission);
  admission.assertWritable();
  const inspectRoot = async () => {
    admission.assertArtifactRoot(admission.artifactRoot);
    await rejectSymlink(admission.artifactRoot, "rebuild artifact root");
    admission.assertLive();
    return admission.artifactRoot;
  };
  return Object.freeze({

    get ready(): Promise<void> {
      return inspectRoot().then(() => { admission.assertLive(); });
    },
    async stageDiagnostic(source: Uint8Array, metadataInput: ArtifactPutMetadata, retention: "ordinary" | "pinned"): Promise<StagedDiagnosticArtifact> {
      admission.assertWritable();
      const metadata = ArtifactPutMetadataSchema.parse(metadataInput);
      const retainedClass = z.enum(["ordinary", "pinned"]).parse(retention);
      if (!(source instanceof Uint8Array)) throw new Error("diagnostic-stage-source-not-bytes");
      const bytes = Uint8Array.from(source);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const root = await initializeArtifactRoot(admission);
      const ref = ArtifactRefSchema.parse({ id: randomUUID(), sha256: digest, bytes: bytes.byteLength, mediaType: metadata.mediaType });
      const path = join(root, `${digest}.${process.pid}.${randomUUID()}.${retainedClass}.diagnostic.tmp`);
      const stored = JSON.stringify(StoredArtifactSchema.parse({ ref, payloadBase64: Buffer.from(bytes).toString("base64") }));
      const tempPath = join(root, `${digest}.${process.pid}.${randomUUID()}.tmp`);
      const handle = await open(tempPath, "wx", 0o600);
      const identity = await handle.stat();
      try {
        try { await handle.writeFile(stored, "utf8"); options.injectFault?.("temp-written"); await handle.sync(); options.injectFault?.("temp-synced"); }
        finally { await handle.close(); }
        admission.assertLive();
        await link(tempPath, path);
        await syncDirectory(root);
      } catch (error) {
        try {
          const current = lstatSync(tempPath);
          if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("diagnostic-preparation-custody-changed", { cause: error });
          unlinkSync(tempPath);
          syncArtifactDirectory(root);
        } catch (cleanup) { throw new AggregateError([error, cleanup], "diagnostic-stage-preparation-failed", { cause: cleanup }); }
        throw error;
      }
      const current = lstatSync(tempPath);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("diagnostic-preparation-custody-changed");
      unlinkSync(tempPath);
      syncArtifactDirectory(root);
      const captured = inspectDiagnosticStage(admission, path);
      let published = false;
      let disposed = false;
      return Object.freeze({ ref,
        get published() { return published; },
        publish() {
          if (disposed) throw new Error("diagnostic-stage-disposed");
          assertDiagnosticStage(admission, captured);
          const finalPath = join(root, `${digest}.artifact`);
          let result = ref;
          try { linkSync(path, finalPath); published = true; }
          catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
            const winner = inspectStoredFile(admission, finalPath, digest);
            assertMatchingMediaType(winner, metadata);
            result = winner.ref;
            published = true;
          }
          options.injectFault?.("published");
          syncArtifactDirectory(root);
          options.injectFault?.("directory-synced");
          return result;
        },
        dispose() {
          if (disposed) return;
          assertDiagnosticStage(admission, captured);
          unlinkSync(path);
          syncArtifactDirectory(root);
          disposed = true;
        },
      });
    },
    async put(source: Uint8Array | Readable, metadataInput: ArtifactPutMetadata) {
      admission.assertWritable();
      const metadata = ArtifactPutMetadataSchema.parse(metadataInput);
      admission.assertLive();
      const bytes = await materialize(source, admission);
      admission.assertLive();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const root = await initializeArtifactRoot(admission);
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
      const root = await inspectRoot();
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
