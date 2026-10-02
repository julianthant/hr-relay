import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { ActorIdSchema, SourceSurfaceIdSchema } from "../../../domain/ids.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { strictlyValidateLocalEnvironment } from "../../../domain/secrets.js";
import { SECRET_FAMILY_SPECS } from "../../../domain/config/provider-family-specs.js";
import { observeProcessIdentity, ProcessStartIdentitySchema } from "../sqlite/runtime-process-locks.js";

const MAX_ENV_BYTES = 64_000;
const MAX_META_BYTES = 32_000;
const HEADER_PREFIX = "# hrauto-provider-keys-v1 ";
const SlotSchema = z.enum(SECRET_FAMILY_SPECS.flatMap(({ envPrefix, maximum }) =>
  Array.from({ length: maximum }, (_, index) => index === 0 ? envPrefix : `${envPrefix}${index + 1}`)));
const OperationSchema = z.union([z.strictObject({ set: z.string().min(1) }), z.strictObject({ clear: z.literal(true) })]);
const MarkSchema = z.enum(["set", "clear"]);
const FingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const UuidSchema = z.uuid();
const ReceiptSchema = z.strictObject({
  revision: z.number().int().min(2), receiptId: UuidSchema, commandId: UuidSchema,
  writeId: UuidSchema, expectedRevision: z.number().int().positive(),
  schemaHash: FingerprintSchema, markedFingerprint: FingerprintSchema,
});
const RequestShellSchema = z.strictObject({
  commandId: UuidSchema, writeId: UuidSchema, expectedRevision: z.number().int().positive(),
  expectedSourceVersionToken: FingerprintSchema, schemaHash: FingerprintSchema,
  requestedAt: z.iso.datetime({ offset: true }), requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema, reason: z.string().min(1).max(500).optional(),
});
const AnchorSchema = z.strictObject({
  revision: z.number().int().min(2), receiptId: UuidSchema, commandId: UuidSchema,
  writeId: UuidSchema, markedFingerprint: FingerprintSchema, receiptHash: FingerprintSchema,
  request: RequestShellSchema, operationMarks: z.partialRecord(SlotSchema, MarkSchema),
  requestHash: FingerprintSchema, bodyHash: FingerprintSchema,
});
export const ProviderKeyWriteRequestSchema = RequestShellSchema.extend({
  operations: z.partialRecord(SlotSchema, OperationSchema).refine(value => Object.keys(value).length > 0),
});
export type ProviderKeyWriteRequest = z.infer<typeof ProviderKeyWriteRequestSchema>;
const PendingSchema = z.strictObject({
  receipt: ReceiptSchema, request: RequestShellSchema,
  operationMarks: z.partialRecord(SlotSchema, MarkSchema),
  priorToken: FingerprintSchema, priorBodyHash: FingerprintSchema,
  stagedName: z.string().regex(/^\.env\.providers\.[0-9a-f-]{36}\.stage$/u),
  stagedBodyHash: FingerprintSchema, requestHash: FingerprintSchema,
});
const MetadataSchema = z.strictObject({
  version: z.literal(1), highWaterMark: z.number().int().positive(),
  settled: AnchorSchema.nullable(), pending: PendingSchema.optional(),
});
const LockSchema = z.strictObject({ pid: z.number().int().positive(), identity: ProcessStartIdentitySchema,
  acquisitionId: UuidSchema });
type Metadata = z.infer<typeof MetadataSchema>;
type Anchor = z.infer<typeof AnchorSchema>;
type Pending = z.infer<typeof PendingSchema>;
export type ProviderKeyPendingIdentity = Readonly<{ commandId: string; writeId: string; receiptId: string }>;

export interface ProviderKeyJournal {
  /** Must attest to both the matching durable marked command and its audit. */
  committed(anchor: Anchor): boolean;
  latestCommitted(inFlight?: Readonly<{ commandId: string; writeId: string }>): Readonly<{ commandId: string; writeId: string; revision: number }> | undefined;
  identityUsed(commandId: string, writeId: string): boolean;
  hasHistory(): boolean;
}

export interface ProviderKeyStoreHooks {
  afterStage?: () => void;
  afterPending?: () => void;
  beforeRename?: () => void;
  afterRename?: () => void;
  afterRead?: () => void;
  beforeSettle?: () => void;
}

export class ProviderKeyStoreUnknownError extends Error {
  constructor(reason: string) { super(`provider-key-store-unknown: ${reason}`); }
}
export class ProviderKeyStoreConflictError extends Error {
  constructor(readonly currentRevision: number, readonly sourceVersionToken: string) {
    super("provider-key-source-conflict");
  }
}

interface ObservedFile {
  readonly bytes: Buffer;
  readonly token: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly slots: Readonly<Record<string, string>>;
  readonly receipt: z.infer<typeof ReceiptSchema> | undefined;
}

function unknown(reason: string): never { throw new ProviderKeyStoreUnknownError(reason); }
function statToken(stat: BigIntStats): string {
  const fields = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs];
  return sha256Hex(fields.map(String).join(":"));
}
function sameStat(a: BigIntStats, b: BigIntStats): boolean {
  return statToken(a) === statToken(b);
}
function checkFile(stat: BigIntStats, label: string, maxBytes: number): void {
  if (!stat.isFile() || (stat.mode & 0o777n) !== 0o600n || stat.uid !== BigInt(process.getuid?.() ?? -1)
    || stat.nlink !== 1n || stat.size > BigInt(maxBytes)) unknown(`${label}-identity`);
}
function readPrivate(path: string, label: string, maxBytes: number): { bytes: Buffer; token: string } {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { return unknown(`${label}-unavailable`); }
  try {
    const before = fstatSync(fd, { bigint: true });
    checkFile(before, label, maxBytes);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    if (!sameStat(before, after) || bytes.length !== Number(after.size)) unknown(`${label}-read-race`);
    let named: BigIntStats;
    try { named = lstatSync(path, { bigint: true }); }
    catch { return unknown(`${label}-path-race`); }
    checkFile(named, label, maxBytes);
    if (!sameStat(after, named)) unknown(`${label}-path-race`);
    return { bytes, token: statToken(after) };
  } finally { closeSync(fd); }
}
function maybeReadPrivate(path: string, label: string, maxBytes: number): { bytes: Buffer; token: string } | undefined {
  try { lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return unknown(`${label}-unavailable`);
  }
  return readPrivate(path, label, maxBytes);
}
function parseFile(bytes: Buffer, token: string): ObservedFile {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return unknown("env-encoding"); }
  const firstEnd = text.indexOf("\n");
  const first = firstEnd < 0 ? text : text.slice(0, firstEnd);
  let receipt: z.infer<typeof ReceiptSchema> | undefined;
  let body = text;
  if (first.startsWith(HEADER_PREFIX)) {
    try {
      receipt = ReceiptSchema.parse(JSON.parse(Buffer.from(first.slice(HEADER_PREFIX.length), "base64url").toString("utf8")));
      if (Buffer.from(canonicalJsonStringify(receipt)).toString("base64url") !== first.slice(HEADER_PREFIX.length)) unknown("env-header");
    }
    catch { return unknown("env-header"); }
    body = firstEnd < 0 ? "" : text.slice(firstEnd + 1);
  } else if (first.startsWith("# hrauto-provider-keys")) unknown("env-header");
  let keys: readonly string[];
  try { keys = strictlyValidateLocalEnvironment(body); }
  catch { return unknown("env-syntax"); }
  if (keys.some(key => !SlotSchema.safeParse(key).success)) unknown("env-key");
  const slots = parseEnv(body);
  if (Object.keys(slots).length !== keys.length || Object.values(slots).some(value => value === undefined)) unknown("env-parse");
  return { bytes, token, body, bodyHash: sha256Hex(body), slots: { ...slots } as Record<string, string>, receipt };
}
function readEnv(path: string): ObservedFile {
  const read = readPrivate(path, "env", MAX_ENV_BYTES);
  return parseFile(read.bytes, read.token);
}
function readMetadata(path: string): Metadata | undefined {
  const read = maybeReadPrivate(path, "metadata", MAX_META_BYTES);
  if (read === undefined) return undefined;
  try { return MetadataSchema.parse(JSON.parse(read.bytes.toString("utf8"))); }
  catch { return unknown("metadata-corrupt"); }
}
function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writePrivate(path: string, bytes: Buffer, replace: boolean): void {
  if (bytes.length > MAX_META_BYTES) unknown("metadata-too-large");
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  const fd = openSync(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
  if (!replace && maybeReadPrivate(path, "metadata", MAX_META_BYTES) !== undefined) unknown("metadata-created-concurrently");
  renameSync(temporary, path);
  fsyncDirectory(dirname(path));
}
function readAnchor(file: ObservedFile, anchor: Anchor): void {
  const header = file.receipt;
  if (header === undefined || header.revision !== anchor.revision || header.receiptId !== anchor.receiptId
    || header.commandId !== anchor.commandId || header.writeId !== anchor.writeId
    || header.markedFingerprint !== anchor.markedFingerprint
    || sha256Hex(canonicalJsonStringify(header)) !== anchor.receiptHash) unknown("settled-header-divergent");
}
function render(receipt: z.infer<typeof ReceiptSchema>, slots: Readonly<Record<string, string>>): Buffer {
  const lines = Object.keys(slots).sort().map(key => {
    const value = slots[key];
    if (value === undefined) unknown("env-slot-missing");
    const quote = ['"', "'", "`"].find(candidate => !value.includes(candidate));
    if (quote === undefined) unknown("env-value-unrepresentable");
    return `${key}=${quote}${value}${quote}`;
  });
  return Buffer.from(`${HEADER_PREFIX}${Buffer.from(canonicalJsonStringify(receipt)).toString("base64url")}\n${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
}
function reconstruct(pending: Pending, file: ObservedFile, markedFingerprint: (request: ProviderKeyWriteRequest) => string): ProviderKeyWriteRequest {
  if (file.bodyHash !== pending.stagedBodyHash || file.receipt?.receiptId !== pending.receipt.receiptId
    || canonicalJsonStringify(file.receipt) !== canonicalJsonStringify(pending.receipt)) unknown("pending-target-divergent");
  const operations: Record<string, z.infer<typeof OperationSchema>> = {};
  for (const [slot, mark] of Object.entries(pending.operationMarks)) {
    const value = file.slots[slot];
    if (mark === "set") {
      if (value === undefined) unknown("pending-set-missing");
      operations[slot] = { set: value };
    } else {
      if (value !== undefined) unknown("pending-clear-present");
      operations[slot] = { clear: true };
    }
  }
  const request = ProviderKeyWriteRequestSchema.parse({ ...pending.request, operations });
  if (sha256Hex(canonicalJsonStringify(request)) !== pending.requestHash
    || markedFingerprint(request) !== pending.receipt.markedFingerprint) unknown("pending-request-divergent");
  return request;
}

export function createProviderKeyStore(input: Readonly<{
  admission: RuntimeAdmission;
  envPath: string; journal: ProviderKeyJournal;
  /** The command family's canonical marked-envelope fingerprint, supplied by command integration. */
  markedFingerprint(request: ProviderKeyWriteRequest): string;
  hooks?: ProviderKeyStoreHooks;
}>) {
  const admission = requireRuntimeAdmission(input.admission);
  if (basename(input.envPath) !== ".env.providers") unknown("env-path");
  const metaPath = `${input.envPath}.meta`;
  const lockPath = `${input.envPath}.lock`;
  const reaperPath = `${input.envPath}.reaper`;
  const directory = dirname(input.envPath);
  const reapStaleLock = (): boolean => {
    const lock = readPrivate(lockPath, "lock", 1024);
    let record: z.infer<typeof LockSchema>;
    try { record = LockSchema.parse(JSON.parse(lock.bytes.toString("utf8"))); }
    catch { return unknown("lock-corrupt"); }
    const observed = observeProcessIdentity(record.pid);
    if (observed.state === "alive" && canonicalJsonStringify(observed.identity) === canonicalJsonStringify(record.identity)) return false;
    const old = lstatSync(lockPath, { bigint: true });
    if (statToken(old) !== lock.token) unknown("lock-reaper-race");
    try { linkSync(lockPath, reaperPath); }
    catch { return unknown("lock-reaper-unavailable"); }
    try {
      const claimed = lstatSync(reaperPath, { bigint: true });
      const named = lstatSync(lockPath, { bigint: true });
      if (claimed.dev !== old.dev || claimed.ino !== old.ino
        || named.dev !== old.dev || named.ino !== old.ino) unknown("lock-reaper-race");
      unlinkSync(lockPath);
      fsyncDirectory(directory);
    } finally {
      unlinkSync(reaperPath);
      fsyncDirectory(directory);
    }
    return true;
  };
  const withLock = <T>(work: () => T): T => {
    admission.assertWritable();
    let fd: number;
    try { fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !reapStaleLock()) return unknown("lock-unavailable");
      try { fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch { return unknown("lock-unavailable"); }
    }
    try {
      const observed = observeProcessIdentity(process.pid);
      if (observed.state !== "alive") unknown("lock-owner-unknown");
      writeFileSync(fd, canonicalJsonStringify(LockSchema.parse({ pid: process.pid,
        identity: observed.identity, acquisitionId: randomUUID() })));
      fsyncSync(fd);
      const lockStat = fstatSync(fd, { bigint: true });
      fsyncDirectory(directory);
      try { return work(); }
      finally {
        closeSync(fd);
        const current = lstatSync(lockPath, { bigint: true });
        if (!sameStat(lockStat, current)) unknown("lock-moved");
        unlinkSync(lockPath);
        fsyncDirectory(directory);
      }
    } catch (error) {
      try { closeSync(fd); } catch { /* already closed */ }
      throw error;
    }
  };
  const observe = (inFlight?: Readonly<{ commandId: string; writeId: string }>) => {
    admission.assertLive();
    const file = readEnv(input.envPath);
    input.hooks?.afterRead?.();
    if (readPrivate(input.envPath, "env", MAX_ENV_BYTES).token !== file.token) unknown("env-read-race");
    const metadata = readMetadata(metaPath);
    const stagedNames = readdirSync(directory).filter(name => /^\.env\.providers\.[0-9a-f-]{36}\.stage$/u.test(name));
    if (metadata?.pending === undefined && stagedNames.length > 0) unknown("orphan-stage");
    if (metadata?.pending !== undefined && (stagedNames.length > 1
      || (stagedNames.length === 1 && stagedNames[0] !== metadata.pending.stagedName))) unknown("foreign-stage");
    if (metadata === undefined) {
      if (file.receipt !== undefined || input.journal.hasHistory()) unknown("managed-history-missing");
      return { state: "virgin" as const, file, revision: 1, metadata: undefined };
    }
    if (metadata.settled !== null) {
      if (!input.journal.committed(metadata.settled)) unknown("settled-journal-missing");
    }
    const latest = input.journal.latestCommitted(inFlight);
    const matches = (identity: Readonly<{ commandId: string; writeId: string; revision: number }> | null): boolean =>
      identity === null ? latest === undefined
        : latest?.commandId === identity.commandId && latest.writeId === identity.writeId && latest.revision === identity.revision;
    if (metadata.pending !== undefined) {
      const pending = metadata.pending;
      if (pending.receipt.revision !== metadata.highWaterMark
        || pending.receipt.revision !== (metadata.settled?.revision ?? 1) + 1
        || pending.receipt.expectedRevision !== (metadata.settled?.revision ?? 1)) unknown("pending-watermark");
      const staged = maybeReadPrivate(join(directory, pending.stagedName), "stage", MAX_ENV_BYTES);
      if (file.receipt?.receiptId === pending.receipt.receiptId) {
        if (staged !== undefined) unknown("pending-stage-remains-after-rename");
        if (!matches(metadata.settled) && !matches(pending.receipt)) unknown("provider-journal-head-divergent");
        const request = reconstruct(pending, file, input.markedFingerprint);
        return { state: "pending-after-rename" as const, file, metadata, request };
      }
      if (!matches(metadata.settled)) unknown("provider-journal-head-divergent");
      if (metadata.settled === null) {
        if (file.receipt !== undefined) unknown("pending-old-header");
      } else readAnchor(file, metadata.settled);
      if (file.token !== pending.priorToken || file.bodyHash !== pending.priorBodyHash || staged === undefined) unknown("pending-old-or-stage-divergent");
      const target = parseFile(staged.bytes, staged.token);
      const request = reconstruct(pending, target, input.markedFingerprint);
      return { state: "pending-before-rename" as const, file, metadata, request };
    }
    if (metadata.settled === null || metadata.highWaterMark !== metadata.settled.revision) unknown("settled-metadata-invalid");
    if (!matches(metadata.settled)) unknown("provider-journal-head-divergent");
    readAnchor(file, metadata.settled);
    return { state: "settled" as const, file, revision: file.receipt!.revision, metadata };
  };
  const stage = (request: ProviderKeyWriteRequest, current: ReturnType<typeof observe>) => {
    if (current.state === "pending-before-rename" || current.state === "pending-after-rename") unknown("pending-requires-retry");
    const latest = current.metadata?.settled;
    if (latest !== undefined && latest !== null
      && (request.commandId === latest.commandId || request.writeId === latest.writeId)) {
      if (request.commandId !== latest.commandId || request.writeId !== latest.writeId
        || current.file.bodyHash !== latest.bodyHash
        || sha256Hex(canonicalJsonStringify(request)) !== latest.requestHash
        || input.markedFingerprint(request) !== latest.markedFingerprint) unknown("latest-replay-divergent");
      return { revision: latest.revision, sourceVersionToken: current.file.token, receiptId: latest.receiptId, slots: current.file.slots };
    }
    if (input.journal.identityUsed(request.commandId, request.writeId)) unknown("identity-reused");
    const revision = current.revision;
    if (request.expectedRevision !== revision || request.expectedSourceVersionToken !== current.file.token) {
      throw new ProviderKeyStoreConflictError(revision, current.file.token);
    }
    const nextRevision = (current.metadata?.highWaterMark ?? 1) + 1;
    const receipt = ReceiptSchema.parse({ revision: nextRevision, receiptId: randomUUID(), commandId: request.commandId,
      writeId: request.writeId, expectedRevision: request.expectedRevision, schemaHash: request.schemaHash,
      markedFingerprint: FingerprintSchema.parse(input.markedFingerprint(request)) });
    const slots: Record<string, string> = { ...current.file.slots };
    const marks: Record<string, "set" | "clear"> = {};
    for (const [slot, operation] of Object.entries(request.operations)) {
      if (operation === undefined) unknown("operation-missing");
      marks[slot] = "set" in operation ? "set" : "clear";
      if ("set" in operation) slots[slot] = operation.set;
      else delete slots[slot];
    }
    const bytes = render(receipt, slots);
    if (bytes.length > MAX_ENV_BYTES) unknown("env-too-large");
    const candidate = parseFile(bytes, "0".repeat(64));
    if (canonicalJsonStringify(candidate.slots) !== canonicalJsonStringify(slots)) unknown("env-value-roundtrip");
    const stageName = `.env.providers.${randomUUID()}.stage`;
    const stagePath = join(directory, stageName);
    writeFileSync(stagePath, bytes, { flag: "wx", mode: 0o600 });
    const fd = openSync(stagePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    fsyncDirectory(directory);
    input.hooks?.afterStage?.();
    const stagedRead = readPrivate(stagePath, "stage", MAX_ENV_BYTES);
    if (!stagedRead.bytes.equals(bytes)) unknown("stage-readback-divergent");
    const target = parseFile(stagedRead.bytes, stagedRead.token);
    const { operations: _operations, ...shell } = request;
    const pending = PendingSchema.parse({ receipt, request: shell, operationMarks: marks,
      priorToken: current.file.token, priorBodyHash: current.file.bodyHash, stagedName: stageName,
      stagedBodyHash: target.bodyHash, requestHash: sha256Hex(canonicalJsonStringify(request)) });
    const metadata = MetadataSchema.parse({ version: 1, highWaterMark: nextRevision,
      settled: current.metadata?.settled ?? null, pending });
    writePrivate(metaPath, Buffer.from(canonicalJsonStringify(metadata)), current.metadata !== undefined);
    input.hooks?.afterPending?.();
    const live = readEnv(input.envPath);
    if (live.token !== current.file.token || live.bodyHash !== current.file.bodyHash) unknown("env-changed-before-rename");
    const stagedBeforeRename = readPrivate(stagePath, "stage", MAX_ENV_BYTES);
    if (!stagedBeforeRename.bytes.equals(bytes)) unknown("stage-changed-before-rename");
    input.hooks?.beforeRename?.();
    renameSync(stagePath, input.envPath);
    input.hooks?.afterRename?.();
    fsyncDirectory(directory);
    const finalFile = readEnv(input.envPath);
    reconstruct(pending, finalFile, input.markedFingerprint);
    return { revision: nextRevision, sourceVersionToken: finalFile.token, receiptId: receipt.receiptId, slots: finalFile.slots };
  };
  const retryUnderLock = (expected: ProviderKeyPendingIdentity) => {
    const current = observe({ commandId: expected.commandId, writeId: expected.writeId });
    if (current.state !== "pending-before-rename" && current.state !== "pending-after-rename") unknown("no-pending-command");
    const receipt = current.metadata.pending!.receipt;
    if (expected.commandId !== receipt.commandId || expected.writeId !== receipt.writeId
      || expected.receiptId !== receipt.receiptId) unknown("pending-identity-divergent");
    const request = current.request;
    if (current.state === "pending-before-rename") {
      const pending = current.metadata.pending!;
      const oldNow = readEnv(input.envPath);
      if (oldNow.token !== pending.priorToken || oldNow.bodyHash !== pending.priorBodyHash) unknown("env-changed-before-rename");
      const stageNow = readEnv(join(directory, pending.stagedName));
      reconstruct(pending, stageNow, input.markedFingerprint);
      input.hooks?.beforeRename?.();
      renameSync(join(directory, pending.stagedName), input.envPath);
      input.hooks?.afterRename?.();
      fsyncDirectory(directory);
    }
    const finalFile = readEnv(input.envPath);
    reconstruct(current.metadata.pending!, finalFile, input.markedFingerprint);
    return { request, revision: current.metadata.pending!.receipt.revision, sourceVersionToken: finalFile.token, slots: finalFile.slots,
      receiptId: current.metadata.pending!.receipt.receiptId };
  };
  return Object.freeze({
    read() {
      const current = observe();
      return current.state === "virgin" || current.state === "settled"
        ? { state: current.state, revision: current.revision, sourceVersionToken: current.file.token, slots: current.file.slots }
        : { state: current.state, revision: current.file.receipt?.revision ?? current.metadata.pending!.receipt.expectedRevision,
          pending: { commandId: current.metadata.pending!.receipt.commandId,
            writeId: current.metadata.pending!.receipt.writeId, receiptId: current.metadata.pending!.receipt.receiptId } };
    },
    /** Local-operator editable projection; never use this as a public receipt. */
    readEditableFile() {
      const current = observe();
      return { state: current.state, revision: current.state === "virgin" || current.state === "settled"
        ? current.revision : current.file.receipt?.revision ?? current.metadata.pending!.receipt.expectedRevision,
        sourceVersionToken: current.file.token, slots: current.file.slots,
        ...(current.state === "pending-before-rename" || current.state === "pending-after-rename"
          ? { pending: { commandId: current.metadata.pending!.receipt.commandId,
            writeId: current.metadata.pending!.receipt.writeId, receiptId: current.metadata.pending!.receipt.receiptId } }
          : {}) };
    },
    /** Server-private read for admitted retry. apply revalidates under the lock before any rename. */
    readPendingRequest(expected: ProviderKeyPendingIdentity): ProviderKeyWriteRequest {
      const current = observe();
      if (current.state !== "pending-before-rename" && current.state !== "pending-after-rename") unknown("no-pending-command");
      const receipt = current.metadata.pending!.receipt;
      if (expected.commandId !== receipt.commandId || expected.writeId !== receipt.writeId
        || expected.receiptId !== receipt.receiptId) unknown("pending-identity-divergent");
      return current.request;
    },
    pendingAcceptedAt(commandId: string, writeId: string): string | undefined {
      const current = observe();
      if (current.state !== "pending-before-rename" && current.state !== "pending-after-rename") return undefined;
      const receipt = current.metadata.pending!.receipt;
      return receipt.commandId === commandId && receipt.writeId === writeId ? current.request.requestedAt : undefined;
    },
    apply(raw: ProviderKeyWriteRequest) {
      const request = ProviderKeyWriteRequestSchema.parse(raw);
      return withLock(() => {
        const current = observe({ commandId: request.commandId, writeId: request.writeId });
        if (current.state === "pending-before-rename" || current.state === "pending-after-rename") {
          if (sha256Hex(canonicalJsonStringify(request)) !== current.metadata.pending!.requestHash) unknown("pending-command-divergent");
          const result = retryUnderLock({ commandId: request.commandId, writeId: request.writeId,
            receiptId: current.metadata.pending!.receipt.receiptId });
          return { revision: result.revision, sourceVersionToken: result.sourceVersionToken, receiptId: result.receiptId, slots: result.slots };
        }
        return stage(request, current);
      });
    },
    retryPending(expected: ProviderKeyPendingIdentity) {
      return withLock(() => retryUnderLock(expected));
    },
    confirmCommitted(commandId: string, writeId: string) {
      return withLock(() => {
        const current = observe();
        if (current.state === "settled" && current.metadata.settled?.commandId === commandId
          && current.metadata.settled.writeId === writeId) {
          return { revision: current.revision, sourceVersionToken: current.file.token };
        }
        if (current.state !== "pending-after-rename") unknown("commit-without-renamed-file");
        const pending = current.metadata.pending!;
        if (pending.receipt.commandId !== commandId || pending.receipt.writeId !== writeId) unknown("commit-identity-divergent");
        const anchor = AnchorSchema.parse({ revision: pending.receipt.revision, receiptId: pending.receipt.receiptId,
          commandId, writeId, markedFingerprint: pending.receipt.markedFingerprint,
          receiptHash: sha256Hex(canonicalJsonStringify(pending.receipt)),
          request: pending.request, operationMarks: pending.operationMarks,
          requestHash: pending.requestHash, bodyHash: pending.stagedBodyHash });
        if (!input.journal.committed(anchor)) unknown("commit-audit-missing");
        input.hooks?.beforeSettle?.();
        writePrivate(metaPath, Buffer.from(canonicalJsonStringify({ version: 1, highWaterMark: anchor.revision,
          settled: anchor })), true);
        return { revision: anchor.revision, sourceVersionToken: current.file.token };
      });
    },
  });
}
