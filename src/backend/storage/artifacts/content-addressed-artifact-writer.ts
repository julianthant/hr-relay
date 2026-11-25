import { fileModified, fileChanged, asyncFileStatus, descriptorStatus, fileStatus, asyncDescriptorStatus, privateFileNumber } from "../file-identity.js";
import type { OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { systemClock } from "../../../rules/time/clock.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, readSync, unlinkSync, fsyncSync, linkSync, readdirSync } from "node:fs";
import {
  link,
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
import { noSymlinkAncestry, removeExactPath, type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { fsyncPath, privatePathRejects } from "../private-path.js";
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
    admission.assertReadable();
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Uint8Array.from(chunk));
    else throw new Error("artifact source emitted a non-byte chunk");
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

async function rejectSymlink(path: string, label: string): Promise<void> {
  try {
    const stat = await asyncFileStatus(path);
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
  admission.assertReadable();
  await mkdir(root, { recursive: true, mode: 0o700 });
  admission.assertReadable();
  await realpath(root);
  admission.assertReadable();
  return root;
}

export function decodeStoredArtifact(input: unknown, expectedDigest: string): Readonly<{
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

const STORED_REF_KEY = Buffer.from("{\"ref\":"), STORED_PAYLOAD_KEY = Buffer.from(",\"payloadBase64\":\""), STORED_PAYLOAD_END = Buffer.from("\"}");
// A multiple of 4 so every payload chunk but the last decodes as whole Base64 groups.
const BASE64_PADDING = 0x3d, DELETION_PROOF_CHUNK_BYTES = 1024 * 1024, DELETION_PROOF_SETTLED_NS = 2_000_000_000n, JSON_WHITESPACE = [0x20, 0x09, 0x0a, 0x0d];
type DeletionProofIdentity = Readonly<{ device: bigint; inode: bigint; size: bigint; modified: bigint; changed: bigint }>;
// shortcut: one entry per proved artifact path until it is removed, so it grows with the store; bound it if stores reach hundreds of thousands of files.
const deletionProofs = new Map<string, Readonly<{ identity: DeletionProofIdentity; stored: ArtifactRef; storedSha256: string; storedBytes: number }>>();

function deletionProofIdentity(handle: number): DeletionProofIdentity {
  const status = fstatSync(handle, { bigint: true });
  return { device: status.dev, inode: status.ino, size: status.size, modified: status.mtimeNs, changed: status.ctimeNs };
}
const sameDeletionProofIdentity = (left: DeletionProofIdentity, right: DeletionProofIdentity) => left.device === right.device
  && left.inode === right.inode && left.size === right.size && left.modified === right.modified && left.changed === right.changed;

// Writer-framed files stream once: one hash of the file and a canonical Base64 decode hashed against the ref, with only the ref parsed.
// Anything else JSON.parse accepted, and every rejection, takes the whole-file decode so the envelope grammar and its verdicts stay unchanged.
function proveStoredArtifact(handle: number, size: number, digest: string) {
  return streamWriterFramedArtifact(handle, size, digest) ?? decodeWholeStoredArtifact(handle, size, digest);
}

function streamWriterFramedArtifact(handle: number, size: number, digest: string) {
  const chunk = Buffer.allocUnsafe(Math.min(Math.max(size, 1), DELETION_PROOF_CHUNK_BYTES));
  const header = Buffer.from(chunk.subarray(0, readSync(handle, chunk, 0, chunk.byteLength, 0)));
  const window = Math.min(size, chunk.byteLength), tail = chunk.subarray(0, readSync(handle, chunk, 0, window, size - window));
  let end = tail.byteLength;
  while (end > 0 && JSON_WHITESPACE.includes(tail[end - 1] ?? 0)) end--;
  const payloadEnd = size - (tail.byteLength - end) - STORED_PAYLOAD_END.byteLength, payloadStart = header.indexOf(STORED_PAYLOAD_KEY);
  if (payloadStart < STORED_REF_KEY.byteLength || !header.subarray(0, STORED_REF_KEY.byteLength).equals(STORED_REF_KEY)
    || end < STORED_PAYLOAD_END.byteLength || !tail.subarray(end - STORED_PAYLOAD_END.byteLength, end).equals(STORED_PAYLOAD_END)) return undefined;
  let stored: ArtifactRef;
  try { stored = ArtifactRefSchema.parse(JSON.parse(header.subarray(STORED_REF_KEY.byteLength, payloadStart).toString("utf8")) as unknown); }
  catch { return undefined; }
  const payloadFrom = payloadStart + STORED_PAYLOAD_KEY.byteLength;
  if (stored.sha256 !== digest || payloadEnd - payloadFrom !== Math.ceil(stored.bytes / 3) * 4) return undefined;
  const storedHash = createHash("sha256").update(header.subarray(0, payloadFrom)), payloadHash = createHash("sha256");
  let position = payloadFrom, decodedBytes = 0;
  for (let read = readSync(handle, chunk, 0, chunk.byteLength, position); read > 0; read = readSync(handle, chunk, 0, chunk.byteLength, position)) {
    const bytes = chunk.subarray(0, read);
    storedHash.update(bytes);
    if (position < payloadEnd) {
      const encoded = bytes.subarray(0, Math.min(read, payloadEnd - position));
      // Padding is canonical only in the payload's last group, so an earlier chunk holding "=" is not canonical Base64.
      if (position + encoded.byteLength < payloadEnd && encoded.includes(BASE64_PADDING)) return undefined;
      const text = encoded.toString("latin1"), decoded = Buffer.from(text, "base64");
      if (decoded.toString("base64") !== text) return undefined;
      payloadHash.update(decoded);
      decodedBytes += decoded.byteLength;
    }
    position += read;
  }
  if (position !== size || decodedBytes !== stored.bytes || payloadHash.digest("hex") !== digest) return undefined;
  return { stored, storedSha256: storedHash.digest("hex"), storedBytes: size };
}

function decodeWholeStoredArtifact(handle: number, size: number, digest: string) {
  const bytes = Buffer.allocUnsafe(size);
  let length = 0;
  while (length < size) {
    const read = readSync(handle, bytes, length, size - length, length);
    if (read === 0) break;
    length += read;
  }
  if (length !== size) throw new Error("artifact-deletion-custody-changed");
  const decoded = decodeStoredArtifact(JSON.parse(bytes.toString("utf8")) as unknown, digest);
  return { stored: decoded.ref, storedSha256: createHash("sha256").update(bytes).digest("hex"), storedBytes: size };
}

function inspectDeletionFile(admission: RuntimeAdmission, input: ArtifactRef) {
  requireRuntimeAdmission(admission).assertLive();
  const ref = ArtifactRefSchema.parse(input);
  admission.assertArtifactRoot(admission.artifactRoot);
  const path = join(admission.artifactRoot, `${ref.sha256}.artifact`);
  const handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = descriptorStatus(handle);
    if (!status.isFile()) throw new Error("artifact-deletion-file-not-regular");
    // One clear proves each artifact at preflight, execution and removal; an unchanged file identity reuses the first full proof.
    const identity = deletionProofIdentity(handle), cached = deletionProofs.get(path);
    let proof = cached !== undefined && sameDeletionProofIdentity(cached.identity, identity) ? cached : undefined;
    if (proof === undefined) {
      deletionProofs.delete(path);
      const proved = proveStoredArtifact(handle, privateFileNumber(status.size), ref.sha256);
      if (!sameDeletionProofIdentity(identity, deletionProofIdentity(handle))) throw new Error("artifact-deletion-custody-changed");
      proof = { identity, ...proved };
      // Coarse filesystem clocks can stamp a same-size rewrite with the old times, so only settled files are reused.
      if (BigInt(systemClock.nowMs()) * 1_000_000n - identity.changed > DELETION_PROOF_SETTLED_NS) deletionProofs.set(path, proof);
    }
    const { stored, storedSha256, storedBytes } = proof;
    if (stored.id !== ref.id || stored.bytes !== ref.bytes || stored.mediaType !== ref.mediaType) throw new Error("artifact-deletion-reference-mismatch");
    return {path,device:status.dev,inode:status.ino,ref,storedSha256,storedBytes};
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
  admission.assertReadable();
  const current = fileStatus(observed.path);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== observed.device || current.ino !== observed.inode) throw new Error("artifact-deletion-custody-changed");
  unlinkSync(observed.path);
  deletionProofs.delete(observed.path);
  const directory = openSync(admission.artifactRoot,constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return "removed" as const;
}

async function readStoredArtifact(admission: RuntimeAdmission, path: string, expectedDigest: string) {
  admission.assertReadable();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let outcome: { readonly kind: "read"; readonly text: string } | { readonly kind: "error"; readonly error: unknown };
  try {
    admission.assertReadable();
    if (!(await asyncDescriptorStatus(handle)).isFile()) throw new Error(`artifact ${expectedDigest} is not a regular file`);
    admission.assertReadable();
    outcome = { kind: "read", text: await handle.readFile("utf8") };
  } catch (error) { outcome = { kind: "error", error }; }
  try { await handle.close(); }
  catch (error) { throw new ArtifactReadClosureUnprovedError(outcome.kind === "read" ? error
    : new AggregateError([outcome.error, error], "Artifact read and closure failed")); }
  if (outcome.kind === "error") throw outcome.error;
  admission.assertReadable();
  const text = outcome.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`artifact ${expectedDigest} is not valid JSON`, { cause: error });
  }
  return decodeStoredArtifact(parsed, expectedDigest);
}

async function readIfPresent(admission: RuntimeAdmission, path: string, expectedDigest: string) {
  try {
    return { state: "present" as const, value: await readStoredArtifact(admission, path, expectedDigest) };
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

async function reclaimDeadOwnerTemps(admission: RuntimeAdmission, root: string, sha256: string): Promise<void> {
  admission.assertWritable();
  for (const name of await readdir(root)) {
    admission.assertWritable();
    if (name.startsWith(`${sha256}.`) && deadArtifactTemp(name) !== undefined) await unlinkIfPresent(join(root, name));
  }
}

function deadArtifactTemp(name: string) {
  const match = /^([a-f0-9]{64})\.([1-9][0-9]{0,9})\.([a-f0-9-]{36})\.tmp$/u.exec(name);
  if (match === null || !z.uuidv4().safeParse(match[3]).success) return undefined;
  const pid = Number(match[2]);
  if (pid > 0x7fff_ffff || pid === process.pid || probeRecordedOwner(pid).state !== "dead") return undefined;
  return { digest: match[1], pid };
}

export function reclaimStartupArtifactStages(machine: RuntimeAdmission, profileId: string, operation: OfflineMaintenanceOperation): number {
  const root = join(machine.stateRoot, "profiles", z.uuid().parse(profileId), "artifacts");
  const assertHeld = () => { machine.assertOfflineMaintenance(operation); machine.assertStateRoot(root); };
  assertHeld();
  const ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(root, ancestry)) return 0;
  const names = readdirSync(root);
  let removed = 0;
  for (const name of names) {
    const owner = deadArtifactTemp(name);
    if (owner === undefined) continue;
    const path = join(root, name), status = fileStatus(path);
    if (!status.isFile() || privatePathRejects(path, status, "file-0600")) continue;
    const links = privateFileNumber(status.nlink);
    if (links !== 1) {
      const diagnosticPrefix = `${owner.digest}.${owner.pid}.`;
      const hasPublishedLink = (entry: string) => {
        const candidate = fileStatus(join(root, entry), true);
        return candidate?.isFile() === true && candidate.dev === status.dev && candidate.ino === status.ino;
      };
      if (links !== 2 || !hasPublishedLink(`${owner.digest}.artifact`) && !names.some(entry =>
        entry.startsWith(diagnosticPrefix) && diagnosticStageName.test(entry) && hasPublishedLink(entry))) continue;
    }
    assertHeld();
    noSymlinkAncestry(root, ancestry);
    removeExactPath(path, { device: status.dev, inode: status.ino }, false, "artifact-stage-custody-changed");
    removed++;
  }
  if (removed > 0) fsyncPath(root);
  return removed;
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
  return inspectOwnedStoredFile(path, digest);
}

function inspectOwnedStoredFile(path: string, digest: string) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = descriptorStatus(descriptor);
    if (!status.isFile()) throw new Error("diagnostic-stage-not-regular");
    if (status.size > MAX_DIAGNOSTIC_ENVELOPE_BYTES) throw new Error("diagnostic-stage-size-exceeded");
    const buffer = Buffer.alloc(privateFileNumber(status.size) + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const read = readSync(descriptor, buffer, length, buffer.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    const stored = buffer.subarray(0, length);
    const after = descriptorStatus(descriptor), pathStatus = fileStatus(path);
    if (stored.byteLength !== privateFileNumber(status.size) || after.size !== status.size || fileModified(after) !== fileModified(status)
      || fileChanged(after) !== fileChanged(status) || !pathStatus.isFile() || pathStatus.isSymbolicLink()
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
  admission.assertReadable();
  const current = inspectDiagnosticStage(admission, captured.path);
  if (current.device !== captured.device || current.inode !== captured.inode || current.storedDigest !== captured.storedDigest) {
    throw new Error("diagnostic-stage-custody-changed");
  }
}

export function pendingDiagnosticArtifacts(admission: RuntimeAdmission, ordinaryOnly = false): readonly ArtifactRef[] {
  admission.assertReadable();
  admission.assertArtifactRoot(admission.artifactRoot);
  let names: string[];
  try { names = readdirSync(admission.artifactRoot); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  return names.filter(name => name.endsWith(".diagnostic.tmp")).flatMap(name => {
    let stage: ReturnType<typeof inspectDiagnosticStage>;
    // Captures dispose stages outside the authority lock, after their bundle commits or fails, so a stage gone mid-inventory is no longer pending.
    try { stage = inspectDiagnosticStage(admission, join(admission.artifactRoot, name)); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
    return !ordinaryOnly || stage.retention === "ordinary" ? [stage.ref] : [];
  });
}

export function reclaimDiagnosticStages(admission: RuntimeAdmission, referenced: (ref: ArtifactRef) => boolean, operation?: OfflineMaintenanceOperation): number {
  const assertOwner = () => {
    admission.assertExclusive();
    if (operation === undefined) admission.assertWritable();
    else admission.assertOfflineMaintenance(operation);
  };
  assertOwner();
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
      assertOwner();
      unlinkSync(finalPath);
      removedFinals.add(finalPath);
    }
    assertDiagnosticStage(admission, stage);
    assertOwner();
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
    admission.assertReadable();
    return admission.artifactRoot;
  };
  return Object.freeze({

    get ready(): Promise<void> {
      return inspectRoot().then(() => { admission.assertReadable(); });
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
      admission.assertWritable();
      const handle = await open(tempPath, "wx", 0o600);
      let identity: Awaited<ReturnType<typeof asyncDescriptorStatus>> | undefined;
      let linked = false;
      try {
        try {
          identity = await asyncDescriptorStatus(handle);
          admission.assertWritable();
          await handle.writeFile(stored, "utf8");
          admission.assertWritable();
          options.injectFault?.("temp-written");
          admission.assertWritable();
          await handle.sync();
          admission.assertWritable();
          options.injectFault?.("temp-synced");
        } finally { await handle.close(); }
        admission.assertWritable();
        await link(tempPath, path);
        linked = true;
        admission.assertWritable();
        await syncDirectory(root);
        admission.assertWritable();
      } catch (error) {
        try {
          const current = fileStatus(tempPath);
          if (!current.isFile() || current.isSymbolicLink() || identity === undefined || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("diagnostic-preparation-custody-changed", { cause: error });
          if (linked) {
            const stage = fileStatus(path);
            if (!stage.isFile() || stage.isSymbolicLink() || stage.dev !== identity.dev || stage.ino !== identity.ino) throw new Error("diagnostic-preparation-custody-changed", { cause: error });
            unlinkSync(path);
          }
          unlinkSync(tempPath);
          syncArtifactDirectory(root);
        } catch (cleanup) { throw new AggregateError([error, cleanup], "diagnostic-stage-preparation-failed", { cause: cleanup }); }
        throw error;
      }
      const current = fileStatus(tempPath);
      if (!current.isFile() || current.isSymbolicLink() || identity === undefined || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("diagnostic-preparation-custody-changed");
      unlinkSync(tempPath);
      syncArtifactDirectory(root);
      admission.assertWritable();
      const captured = inspectDiagnosticStage(admission, path);
      let published = false;
      let disposed = false;
      return Object.freeze({ ref,
        get published() { return published; },
        publish() {
          if (disposed) throw new Error("diagnostic-stage-disposed");
          admission.assertWritable();
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
          admission.assertLive();
          const current = inspectOwnedStoredFile(path, digest);
          if (current.device !== captured.device || current.inode !== captured.inode || current.storedDigest !== captured.storedDigest) throw new Error("diagnostic-stage-custody-changed");
          unlinkSync(path);
          syncArtifactDirectory(root);
          disposed = true;
        },
      });
    },
    async put(source: Uint8Array | Readable, metadataInput: ArtifactPutMetadata) {
      admission.assertWritable();
      const metadata = ArtifactPutMetadataSchema.parse(metadataInput);
      admission.assertReadable();
      const bytes = await materialize(source, admission);
      admission.assertReadable();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const root = await initializeArtifactRoot(admission);
      admission.assertReadable();
      const finalPath = join(root, `${sha256}.artifact`);
      admission.assertArtifactRoot(finalPath);
      await reclaimDeadOwnerTemps(admission, root, sha256);
      admission.assertReadable();
      const existing = await readIfPresent(admission, finalPath, sha256);
      admission.assertReadable();
      if (existing.state === "present") {
        assertMatchingMediaType(existing.value, metadata);
        await syncDirectory(root);
        admission.assertReadable();
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
        admission.assertWritable();
        const handle = await open(tempPath, "wx", 0o600);
        tempPresent = true;
        try {
          admission.assertWritable();
          await handle.writeFile(JSON.stringify(stored), "utf8");
          admission.assertReadable();
          options.injectFault?.("temp-written");
          admission.assertWritable();
          await handle.sync();
          admission.assertReadable();
          options.injectFault?.("temp-synced");
        } finally {
          await handle.close();
        }
        let result = Object.freeze(ref);
        try {
          admission.assertReadable();
          await link(tempPath, finalPath);
          admission.assertReadable();
          options.injectFault?.("published");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          const winner = await readStoredArtifact(admission, finalPath, sha256);
          admission.assertReadable();
          assertMatchingMediaType(winner, metadata);
          result = winner.ref;
        }
        await unlink(tempPath);
        tempPresent = false;
        await syncDirectory(root);
        admission.assertReadable();
        options.injectFault?.("directory-synced");
        return result;
      } finally {
        if (tempPresent) await unlinkIfPresent(tempPath);
      }
    },
    async open(refInput: ArtifactRef) {
      admission.assertReadable();
      const ref = ArtifactRefSchema.parse(refInput);
      const root = await inspectRoot();
      admission.assertReadable();
      const path = join(root, `${ref.sha256}.artifact`);
      admission.assertArtifactRoot(path);
      const stored = await readStoredArtifact(admission, path, ref.sha256);
      admission.assertReadable();
      if (stored.ref.id !== ref.id || stored.ref.bytes !== ref.bytes
        || stored.ref.mediaType !== ref.mediaType) {
        throw new Error(`artifact ${ref.id} metadata does not match stored content`);
      }
      return Readable.from((async function* () {
        admission.assertReadable();
        yield Uint8Array.from(stored.bytes);
      })());
    },
  });
}
