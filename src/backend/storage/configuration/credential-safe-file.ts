import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { systemClock } from "../../../rules/time/clock.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners, retainAuthoritySourceClosure } from "../source-closure.js";
import { fsyncPath, privatePathRejects } from "../private-path.js";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, readdirSync, type Stats } from "node:fs";
import { join, parse, relative, resolve } from "node:path";
import { z } from "zod";
import { PositiveIntSchema } from "../../../rules/identity/ids.js";
import { ProcessStartIdentitySchema } from "../sqlite/runtime-process-locks.js";

export const CREDENTIAL_DIRECTORY_MODE = 0o700;
const CREDENTIAL_FILE_MODE = 0o600;
export interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}

export interface CredentialInventory {
  readonly entriesAbsent: boolean;
  readonly protectedPlaintext: boolean;
  readonly stagePlaintext: boolean;
  readonly backupPlaintext: readonly string[];
  readonly unknownFormats: readonly string[];
  readonly inventoryMissing: boolean;
  readonly loginDataUcSdRows: number | "unreadable" | "absent";
  readonly logoutComplete: boolean;
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Verify each component before descendants; retain identities across every operation. */
export function noSymlinkAncestry(path: string, identities: Map<string, DirectoryIdentity>): boolean {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split(/[/\\]+/u).filter((segment) => segment !== "");
  let cursor = root;
  const paths = [root, ...segments.map((segment) => { cursor = join(cursor, segment); return cursor; })];
  for (const component of paths) {
    const status = lstatSync(component, { throwIfNoEntry: false });
    const prior = identities.get(component);
    if (status === undefined) {
      if (prior !== undefined) throw new Error("directory-integrity: credential ancestor disappeared");
      return false;
    }
    if (status.isSymbolicLink()) throw new Error("directory-integrity: credential path ancestry contains a symbolic link");
    if (!status.isDirectory()) throw new Error("directory-integrity: credential path ancestry contains a non-directory");
    if (privatePathRejects(component, status, "ancestor")) {
      throw new Error("directory-integrity: credential ancestor is group/world-writable without sticky protection or has an untrusted owner");
    }
    const observed = { device: status.dev, inode: status.ino };
    if (prior !== undefined && !sameDirectory(prior, observed)) throw new Error("directory-integrity: credential ancestor identity changed");
    identities.set(component, observed);
  }
  return true;
}

export function statDirectory(path: string, label: string, exactMode?: typeof CREDENTIAL_DIRECTORY_MODE): DirectoryIdentity {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    throw new Error(`directory-integrity: ${label} is unavailable`);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`directory-integrity: ${label} is not a private directory`);
  }
  if (privatePathRejects(path, status, "owner")) {
    throw new Error(`directory-integrity: ${label} is owned by another user`);
  }
  if (exactMode !== undefined && privatePathRejects(path, status, "directory-0700")) {
    throw new Error(`directory-integrity: ${label} permissions must be 0700`);
  }
  return { device: status.dev, inode: status.ino };
}

export function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function removeExactPath(
  path: string,
  expected: DirectoryIdentity,
  missingIsSettled: boolean,
  changedMessage: string,
): boolean {
  let status;
  try {
    status = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    throw new Error(changedMessage, { cause: error });
  }
  if (status === undefined) {
    if (missingIsSettled) return false;
    throw new Error(changedMessage);
  }
  if (!status.isFile() || status.isSymbolicLink()
    || status.dev !== expected.device || status.ino !== expected.inode
    || privatePathRejects(path, status, "owner")) {
    throw new Error(changedMessage);
  }
  unlinkSync(path);
  return true;
}

export function ensureChildDirectory(
  parent: string,
  child: string,
  label: string,
  creationMode: number,
  requiredMode?: typeof CREDENTIAL_DIRECTORY_MODE,
): void {
  statDirectory(parent, `${label} parent`);
  try {
    mkdirSync(child, { mode: creationMode });
    fsyncPath(parent);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw new Error(`directory-integrity: ${label} could not be created`, { cause: error });
    }
  }
  statDirectory(child, label, requiredMode);
}

interface PrivateFileOptions {
  readonly label: "protected.json" | "lock" | "ChatGPT" | "Duo credential" | "erasure journal" | "authority database" | "managed data";
  readonly maxBytes: number;
  readonly allowedLinkCounts?: readonly number[];
}

export function readPrivateFile(path: string, options: PrivateFileOptions): { bytes: Buffer; identity: DirectoryIdentity; stat: Stats } | undefined {
  const { label, maxBytes, allowedLinkCounts = [1] } = options;
  const ordinary = label === "authority database" || label === "managed data";
  const lock = label === "lock", record = label === "ChatGPT" || label === "Duo credential" || label === "erasure journal" || ordinary;
  const rule = ordinary ? "group-write" : "file-0600";
  const unavailable = lock ? "directory-integrity: credential lock is unavailable" : `credential store ${label} is unavailable`;
  const invalid = lock ? "directory-integrity: credential lock permissions or identity are invalid" : `directory-integrity: ${label} permissions or identity are invalid`;
  let pathStatus;
  try { pathStatus = lstatSync(path, { throwIfNoEntry: false }); }
  catch (error) { throw new Error(unavailable, { cause: error }); }
  if (pathStatus === undefined) return undefined;
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink() || !allowedLinkCounts.includes(pathStatus.nlink)
    || privatePathRejects(path, pathStatus, lock || record ? rule : "owner")) {
    throw new Error(lock || record ? invalid : "directory-integrity: protected.json must be one private regular file");
  }
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { throw new Error(unavailable, { cause: error }); }
  let descriptorIdentity = pathStatus;
  let result: ReturnType<typeof readPrivateFile>;
  let primary: { error: unknown } | undefined;
  try {
    const before = fstatSync(descriptor); descriptorIdentity = before;
    if (!before.isFile() || !allowedLinkCounts.includes(before.nlink) || privatePathRejects(path, before, rule)
      || (lock && before.size > maxBytes)
      || (record && (before.dev !== pathStatus.dev || before.ino !== pathStatus.ino))) throw new Error(invalid);
    if (before.size > maxBytes) throw new Error(`document-too-large: credential store ${label} exceeds its private bound`);
    const bytes = readFileSync(descriptor), after = fstatSync(descriptor), live = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mode !== after.mode || before.uid !== after.uid || before.nlink !== after.nlink
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || live.dev !== before.dev || live.ino !== before.ino || bytes.byteLength !== before.size
      || (record && (before.mode !== live.mode || before.uid !== live.uid || before.nlink !== live.nlink))) {
      throw new Error(lock ? "directory-integrity: credential lock moved while it was read" : `directory-integrity: ${label} moved while it was read`);
    }
    result = { bytes, stat: after, identity: { device: before.dev, inode: before.ino } };
  } catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor, identity: descriptorIdentity } }); }
  if (primary !== undefined) throw primary.error;
  return result;
}

export function createPrivateLock(path: string, credentialDirectory: string, bytes: Uint8Array, verify: () => boolean): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      CREDENTIAL_FILE_MODE,
    );
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw new Error("credential store lock could not be created", { cause: error });
  }
  if (descriptor === undefined) return false;
  let createdStatus: Stats;
  try { createdStatus = fstatSync(descriptor); }
  catch (error) {
    try { closeSync(descriptor); }
    catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { descriptor: { descriptor } }); }
    throw error;
  }
  const createdIdentity = { device: createdStatus.dev, inode: createdStatus.ino };
  let preparationError: Error | undefined;
  try {
    if (!createdStatus.isFile() || createdStatus.nlink !== 1
      || privatePathRejects(path, createdStatus, "file-0600")) {
      throw new Error("directory-integrity: new credential lock permissions or identity are invalid");
    }
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } catch (error) {
    preparationError = error instanceof Error
      ? new Error("credential store lock could not be made durable", { cause: error })
      : new Error("credential store lock could not be made durable");
  }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(preparationError === undefined ? [error] : [preparationError, error],
    { descriptor: { descriptor, identity: createdStatus } }); }

  const failWithCleanup = (error: Error): never => {
    try {
      removeExactPath(path, createdIdentity, false, "directory-integrity: new credential lock changed during cleanup");
      fsyncPath(credentialDirectory);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "credential lock creation failed and its owned file could not be removed",
        { cause: cleanupError },
      );
    }
    throw error;
  };
  if (preparationError !== undefined) failWithCleanup(preparationError);

  try {
    fsyncPath(credentialDirectory);
    if (!verify()) {
      throw new Error("directory-integrity: credential lock differs after creation");
    }
    const published = lstatSync(path);
    if (published.dev !== createdIdentity.device || published.ino !== createdIdentity.inode) {
      throw new Error("directory-integrity: credential lock identity changed after creation");
    }
  } catch (error) {
    failWithCleanup(error instanceof Error
      ? new Error("credential store lock could not be published exactly", { cause: error })
      : new Error("credential store lock could not be published exactly"));
  }
  return true;
}


const PrivateFileLockSchema = z.strictObject({ nonce: z.uuid() });
function assertPrivateLockBytes(bytes: Buffer): void {
  try { PrivateFileLockSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { throw new Error("directory-integrity: private lock is malformed"); }
}

export function capturePriorPrivateFileLock(directory: string, name: string): (() => void) | undefined {
  const parent = statDirectory(directory, "private lock parent", CREDENTIAL_DIRECTORY_MODE);
  const path = join(directory, name);
  const file = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
  if (file === undefined) return undefined;
  assertPrivateLockBytes(file.bytes);
  return () => {
    if (!sameDirectory(parent, statDirectory(directory, "private lock parent", CREDENTIAL_DIRECTORY_MODE))) throw new Error("directory-integrity: prior private lock parent changed");
    const current = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
    if (current === undefined || !sameDirectory(current.identity, file.identity) || !current.bytes.equals(file.bytes)) throw new Error("directory-integrity: prior private lock changed");
    removeExactPath(path, file.identity, false, "directory-integrity: prior private lock changed");
    fsyncPath(directory);
  };
}

export interface PrivateFileLock {
  assertHeld(): void;
}

export class PrivateFileLockUnavailableError extends Error {
  readonly code = "PRIVATE_FILE_LOCK_UNAVAILABLE";
  constructor() { super("private file lock is unavailable"); this.name = "PrivateFileLockUnavailableError"; }
}

/** Reused checks for one profile operation. Discarded when that operation ends; a nested lock keeps the outer proof. */
export type OperationProof = {
  active: boolean;
  readonly slots: Map<string, unknown>;
  readonly witnesses: Map<string, { assertUnchanged(): void }>;
  readonly locks: Set<PrivateFileLock>;
  readonly release: Array<() => void>;
};
const operationProof = new AsyncLocalStorage<OperationProof>();
export function outermostOperationProof(): OperationProof | undefined {
  const proof = operationProof.getStore();
  return proof?.active === true ? proof : undefined;
}
export function clearOperationProofSlots(): void {
  const proof = outermostOperationProof();
  proof?.slots.clear();
  proof?.witnesses.clear();
}
export function revalidateOperationProof(witnesses = outermostOperationProof()?.witnesses): void {
  const proof = outermostOperationProof();
  if (proof === undefined) return;
  proof.slots.clear();
  for (const lock of proof.locks) lock.assertHeld();
  for (const witness of new Set([...(witnesses?.values() ?? []), ...proof.witnesses.values()])) witness.assertUnchanged();
}
function discardOperationProof(proof: OperationProof): void {
  proof.slots.clear();
  proof.witnesses.clear();
  while (proof.release.length !== 0) {
    const finish = proof.release[0];
    if (finish === undefined) throw new Error("operation-proof-release-missing");
    try { finish(); }
    catch (error) { retainUnprovedSourceOwners(error, { operationProof: proof }); throw error; }
    proof.release.shift();
  }
}
export function withOperationProof<T>(body: () => T): T {
  if (outermostOperationProof() !== undefined) return body();
  const proof: OperationProof = { active: true, slots: new Map(), witnesses: new Map(), locks: new Set(), release: [] };
  let settled = false;
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    proof.active = false;
    if (hasUnprovedSourceClosure(error)) {
      proof.slots.clear();
      proof.witnesses.clear();
      retainUnprovedSourceOwners(error, { operationProof: proof });
      return;
    }
    try { discardOperationProof(proof); }
    catch (cleanup) {
      if (error !== undefined) throw new AggregateError([error, cleanup], "operation and proof cleanup failed", { cause: cleanup });
      throw cleanup;
    }
  };
  try {
    const result = operationProof.run(proof, body);
    if (result instanceof Promise) return result.then((value: Awaited<T>) => { finish(); return value; }, (error: unknown) => { finish(error); throw error; }) as T;
    finish();
    return result;
  } catch (error) {
    finish(error);
    throw error;
  }
}

export function withPrivateFileLock<T>(directory: string, name: string, body: (held: PrivateFileLock) => T): T {
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.length === 0) {
    throw new Error("directory-integrity: private lock name is invalid");
  }
  const ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(directory, ancestry)) throw new Error("directory-integrity: private lock parent is missing");
  const parent = statDirectory(directory, "private lock parent", CREDENTIAL_DIRECTORY_MODE);
  const path = join(directory, name);
  const bytes = Buffer.from(JSON.stringify({ nonce: randomUUID() }));
  const deadline = systemClock.monotonicMs() + 10_000;
  let identity: DirectoryIdentity | undefined;
  let active = true;
  const assertParent = (): void => {
    if (!noSymlinkAncestry(directory, ancestry)
      || !sameDirectory(parent, statDirectory(directory, "private lock parent", CREDENTIAL_DIRECTORY_MODE))) {
      throw new Error("directory-integrity: private lock parent changed");
    }
  };
  const held: PrivateFileLock = Object.freeze({
    assertHeld(): void {
      if (!active) throw new Error("private lock operation has ended");
      assertParent();
      const file = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
      if (file === undefined || identity === undefined || !sameDirectory(identity, file.identity) || !file.bytes.equals(bytes)) {
        throw new Error("directory-integrity: private lock changed");
      }
    },
  });
  for (;;) {
    assertParent();
    if (createPrivateLock(path, directory, bytes, () => {
      assertParent();
      const file = readPrivateFile(path, { label: "lock", maxBytes: 4_096 });
      if (file === undefined || !file.bytes.equals(bytes)) return false;
      identity = file.identity;
      return true;
    })) break;
    if (systemClock.monotonicMs() > deadline) throw new PrivateFileLockUnavailableError();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  let outcome: { kind: "value"; value: T } | { kind: "error"; error: unknown };
  return withOperationProof(() => {
    const proof = outermostOperationProof();
    proof?.locks.add(held);
    try { held.assertHeld(); outcome = { kind: "value", value: body(held) }; }
    catch (error) { outcome = { kind: "error", error }; }
    proof?.locks.delete(held);
    try {
      held.assertHeld();
      if (identity === undefined) throw new Error("private lock identity is unavailable");
      removeExactPath(path, identity, false, "directory-integrity: private lock changed before release");
      fsyncPath(directory);
    } catch (error) {
      if (outcome.kind === "error") throw new AggregateError([outcome.error, error], "operation and private lock release failed", { cause: error });
      throw error;
    } finally { active = false; }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  });
}

export const ChatGptCredentialLockSchema = z.strictObject({ id: z.uuid(), pid: z.number().int().positive(), identity: ProcessStartIdentitySchema });
export const CredentialLockRecordSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.enum(["writer", "reaper"]), pid: PositiveIntSchema, processIdentity: ProcessStartIdentitySchema, acquisitionId: z.uuid() });

export function companionCredentialEntries(directory: string, record: "protected" | "ChatGPT"): ReadonlySet<string> {
  const names = readdirSync(directory), permitted = new Set<string>();
  if (names.includes("duo-webauthn.json")) {
    if (readPrivateFile(join(directory, "duo-webauthn.json"), { label: "Duo credential", maxBytes: 64_000 }) === undefined) throw new Error("directory-integrity: companion credential record disappeared");
    permitted.add("duo-webauthn.json");
  }
  const chat = record === "protected";
  const fileName = chat ? "chatgpt-account.json" : "protected.json";
  if (names.includes(fileName)) {
    if (readPrivateFile(join(directory, fileName), { label: chat ? "ChatGPT" : "protected.json", maxBytes: chat ? 64_000 : Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 }) === undefined) throw new Error("directory-integrity: companion credential record disappeared");
    permitted.add(fileName);
  }
  const locks = chat ? [".chatgpt-account.lock"] : [".protected.lock", ".protected.reaper", ".protected.reaper-claim"];
  let writerId: string | undefined;
  const reapers = new Map<string, { bytes: Buffer; identity: DirectoryIdentity }>();
  for (const name of locks) {
    if (!names.includes(name)) continue;
    const file = readPrivateFile(join(directory, name), { label: "lock", maxBytes: 4_096, allowedLinkCounts: !chat && name !== ".protected.lock" ? [1, 2] : [1] });
    if (file === undefined) throw new Error("directory-integrity: companion credential lock disappeared");
    const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
    if (chat) {
      const owner = ChatGptCredentialLockSchema.safeParse(decoded);
      if (!owner.success) throw new Error("directory-integrity: companion credential lock is malformed");
      writerId = owner.data.id;
    } else {
      const parsed = CredentialLockRecordSchema.safeParse(decoded);
      if (!parsed.success) throw new Error("directory-integrity: companion credential lock is malformed");
      const owner = parsed.data;
      if (owner.kind !== (name === ".protected.lock" ? "writer" : "reaper")) throw new Error("directory-integrity: companion credential lock kind is invalid");
      if (owner.kind === "writer") writerId = owner.acquisitionId;
      else reapers.set(name, file);
    }
    permitted.add(name);
  }
  const reaper = reapers.get(".protected.reaper"), claim = reapers.get(".protected.reaper-claim");
  if (reaper !== undefined && claim !== undefined && (!sameDirectory(reaper.identity, claim.identity) || !reaper.bytes.equals(claim.bytes))) throw new Error("directory-integrity: companion credential reaper claim disagrees with its lock");
  const stages = names.filter(name => name.startsWith(chat ? ".chatgpt-account." : ".protected.") && name.endsWith(".tmp"));
  if (stages.length > 1) throw new Error("directory-integrity: companion credential stages are ambiguous");
  for (const name of stages) {
    const match = (chat ? /^\.chatgpt-account\.([^.]+)\.tmp$/u : /^\.protected\.([^.]+)\.([^.]+)\.tmp$/u).exec(name);
    if (match === null || writerId === undefined || match[1] !== writerId || !z.uuid().safeParse(match[1]).success
      || (!chat && !z.uuid().safeParse(match[2]).success)) throw new Error("directory-integrity: companion credential stage is not owned by its writer");
    if (readPrivateFile(join(directory, name), { label: chat ? "ChatGPT" : "protected.json", maxBytes: chat ? 64_000 : Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 }) === undefined) throw new Error("directory-integrity: companion credential stage disappeared");
    permitted.add(name);
  }
  return permitted;
}

export function unpublishedDraftAbortMembership(root: string) {
  const entries: { path: string; directory: boolean; device: number; inode: number; size: number; mode: number; modified: number; changed: number }[] = [];
  const visit = (path: string): void => {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink !== 1
      || privatePathRejects(path, info, "group-write")) throw new Error("profile-draft-abort-membership-unsafe");
    entries.push({ path: relative(root, path), directory: info.isDirectory(), device: info.dev, inode: info.ino, size: info.size,
      mode: info.mode, modified: info.mtimeMs, changed: info.ctimeMs });
    if (info.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  visit(root); return entries;
}
