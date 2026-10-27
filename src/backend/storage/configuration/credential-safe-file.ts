import { retainAuthoritySourceClosure } from "../source-closure.js";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, readdirSync, type Stats } from "node:fs";
import { join, parse, resolve } from "node:path";
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

const expectedUid = typeof process.getuid === "function" ? process.getuid() : undefined;

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function fsyncPath(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let primary: { error: unknown } | undefined;
  let descriptorIdentity: ReturnType<typeof fstatSync> | undefined;
  try { descriptorIdentity = fstatSync(descriptor); fsyncSync(descriptor); }
  catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
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
    if (expectedUid === undefined || (status.uid !== expectedUid && status.uid !== 0)) {
      throw new Error("directory-integrity: credential ancestor has an untrusted owner");
    }
    if ((status.mode & 0o022) !== 0 && (status.mode & 0o1000) === 0) {
      throw new Error("directory-integrity: credential ancestor is group/world-writable without sticky protection");
    }
    const observed = { device: status.dev, inode: status.ino };
    if (prior !== undefined && !sameDirectory(prior, observed)) throw new Error("directory-integrity: credential ancestor identity changed");
    identities.set(component, observed);
  }
  return true;
}

export function statDirectory(path: string, label: string, exactMode?: number): DirectoryIdentity {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    throw new Error(`directory-integrity: ${label} is unavailable`);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`directory-integrity: ${label} is not a private directory`);
  }
  if (expectedUid !== undefined && status.uid !== expectedUid) {
    throw new Error(`directory-integrity: ${label} is owned by another user`);
  }
  if (exactMode !== undefined && (status.mode & 0o7777) !== exactMode) {
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
    || (expectedUid !== undefined && status.uid !== expectedUid)) {
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
  requiredMode?: number,
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
  readonly label: "protected.json" | "lock" | "ChatGPT" | "Duo credential" | "erasure journal" | "authority database";
  readonly maxBytes: number;
  readonly allowedLinkCounts?: readonly number[];
}

export function readPrivateFile(path: string, options: PrivateFileOptions): { bytes: Buffer; identity: DirectoryIdentity; stat: Stats } | undefined {
  const { label, maxBytes, allowedLinkCounts = [1] } = options;
  const database = label === "authority database";
  const lock = label === "lock", record = label === "ChatGPT" || label === "Duo credential" || label === "erasure journal" || database;
  const invalidMode = (mode: number): boolean => database ? (mode & 0o022) !== 0 : (mode & 0o7777) !== CREDENTIAL_FILE_MODE;
  const unavailable = lock ? "directory-integrity: credential lock is unavailable" : `credential store ${label} is unavailable`;
  const invalid = lock ? "directory-integrity: credential lock permissions or identity are invalid" : `directory-integrity: ${label} permissions or identity are invalid`;
  let pathStatus;
  try { pathStatus = lstatSync(path, { throwIfNoEntry: false }); }
  catch (error) { throw new Error(unavailable, { cause: error }); }
  if (pathStatus === undefined) return undefined;
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink() || !allowedLinkCounts.includes(pathStatus.nlink)
    || ((lock || record) && invalidMode(pathStatus.mode))
    || (expectedUid !== undefined && pathStatus.uid !== expectedUid)) {
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
    if (!before.isFile() || !allowedLinkCounts.includes(before.nlink) || invalidMode(before.mode)
      || (expectedUid !== undefined && before.uid !== expectedUid)
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

export function writePrivateStage(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes, { mode: CREDENTIAL_FILE_MODE, flag: "wx" });
  fsyncPath(path);
}

export function replacePrivateFile(stage: string, path: string): void { renameSync(stage, path); }

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
      || (createdStatus.mode & 0o777) !== CREDENTIAL_FILE_MODE
      || (expectedUid !== undefined && createdStatus.uid !== expectedUid)) {
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
  } catch (error) {
    failWithCleanup(error instanceof Error
      ? new Error("credential store lock could not be published exactly", { cause: error })
      : new Error("credential store lock could not be published exactly"));
  }
  return true;
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
