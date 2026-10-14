import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { privateEqual } from "../../rules/validation/private-equal.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../storage/admission/admission.js";
import { observeProcessIdentity, ProcessStartIdentitySchema } from "../storage/sqlite/runtime-process-locks.js";

export const CHATGPT_CREDENTIAL_DIRECTORY = "chatgpt-credentials";
const MAX_BYTES = 64_000;
const text = z.string().min(1).max(16_384);
const ClientIdSchema = z.string().regex(/^oaiapp_[A-Za-z0-9_-]+$/u);
const IdentitySchema = z.strictObject({ subject: text, name: text, email: z.email() });
const SessionSchema = z.strictObject({
  accessToken: text, refreshToken: text.nullable(), idToken: text, expiresAt: IsoInstantSchema,
  earliestRefreshAt: z.number().int().nonnegative().nullable(), scopes: z.array(text).max(32),
  usePlan: z.boolean(), usage: z.enum(["available", "limit-reached", "unavailable"]),
});
export const ChatGptCredentialRecordSchema = z.strictObject({
  schemaVersion: z.literal(1), revision: z.number().int().positive(), hostId: z.string().regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
  clientId: ClientIdSchema.nullable(), registration: IdentitySchema.nullable(), session: SessionSchema.nullable(),
}).refine(record => (record.registration === null || record.clientId !== null) && (record.session === null || record.registration !== null));
export type ChatGptCredentialRecord = z.infer<typeof ChatGptCredentialRecordSchema>;

const messages = {
  CHATGPT_CREDENTIAL_UNAVAILABLE: "ChatGPT credentials could not be read or saved safely.",
  CHATGPT_CREDENTIAL_BUSY: "ChatGPT credentials are in use by another operation.",
  CHATGPT_CREDENTIAL_CONFLICT: "The ChatGPT account changed. Read its current state before trying again.",
  CHATGPT_CREDENTIAL_UNCERTAIN: "The ChatGPT credential change could not be confirmed. Read its current state before trying again.",
} as const;
export class ChatGptCredentialError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = "ChatGptCredentialError"; }
}
const unavailable = () => new ChatGptCredentialError("CHATGPT_CREDENTIAL_UNAVAILABLE");
const LockSchema = z.strictObject({ id: z.uuid(), pid: z.number().int().positive(), identity: ProcessStartIdentitySchema });
type Lock = z.infer<typeof LockSchema>;

function same(left: Stats, right: Stats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function privateFile(path: string): { bytes: Buffer; stat: Stats } | undefined {
  const named = lstatSync(path, { throwIfNoEntry: false });
  if (named === undefined) return undefined;
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || (named.mode & 0o7777) !== 0o600
    || process.getuid === undefined || named.uid !== process.getuid() || named.size > MAX_BYTES) throw unavailable();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!same(named, before) || !before.isFile() || before.nlink !== 1 || (before.mode & 0o7777) !== 0o600
      || before.uid !== process.getuid() || before.size > MAX_BYTES) throw unavailable();
    const bytes = readFileSync(fd), after = fstatSync(fd), live = lstatSync(path);
    if (!same(before, after) || !same(before, live) || before.size !== after.size || before.mode !== after.mode
      || before.uid !== after.uid || before.nlink !== after.nlink || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || before.mode !== live.mode || before.uid !== live.uid
      || before.nlink !== live.nlink || bytes.length !== before.size) throw unavailable();
    return { bytes, stat: after };
  } finally { closeSync(fd); }
}
function decode(bytes: Buffer): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
function parseRecord(bytes: Buffer): ChatGptCredentialRecord {
  try {
    if (bytes.length > MAX_BYTES) throw unavailable();
    const result = ChatGptCredentialRecordSchema.safeParse(decode(bytes));
    if (!result.success) throw unavailable();
    return result.data;
  } catch { throw unavailable(); }
}
export function verifyChatGptCredentialBytes(bytes: Buffer): void { parseRecord(bytes); }
function sync(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }

export interface ChatGptCredentialRepositoryOptions {
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly afterRename?: () => void;
}
export interface ChatGptCredentialTransaction {
  read(): ChatGptCredentialRecord | undefined;
  replace(record: ChatGptCredentialRecord, expectedRevision: number | null): void;
}

export function createChatGptCredentialRepository(options: ChatGptCredentialRepositoryOptions) {
  const admission = requireRuntimeAdmission(options.admission), stateRoot = options.stateRoot;
  if (!isAbsolute(stateRoot) || resolve(stateRoot) !== stateRoot || admission.stateRoot !== stateRoot) throw unavailable();
  const directory = join(stateRoot, CHATGPT_CREDENTIAL_DIRECTORY), path = join(directory, "account.json"), lockPath = join(directory, ".writer");
  const ancestry = new Map<string, Stats>();
  function inspect(create: boolean): boolean {
    admission.assertStateRoot(stateRoot);
    let cursor = parse(directory).root;
    for (const segment of directory.slice(cursor.length).split("/")) {
      cursor = join(cursor, segment);
      let stat = lstatSync(cursor, { throwIfNoEntry: false });
      if (stat === undefined) {
        if (ancestry.has(cursor)) throw unavailable();
        if (cursor !== directory || !create) return false;
        mkdirSync(directory, { mode: 0o700 });
        stat = lstatSync(directory);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid === undefined
        || stat.uid !== process.getuid() && stat.uid !== 0 || (stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0
        || cursor === directory && (stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700)) throw unavailable();
      const prior = ancestry.get(cursor);
      if (prior !== undefined && !same(prior, stat)) throw unavailable();
      ancestry.set(cursor, stat);
    }
    return true;
  }
  function read(): ChatGptCredentialRecord | undefined {
    try {
      if (!inspect(false)) return undefined;
      const names = readdirSync(directory).sort();
      if (names.some(name => name !== "account.json" && name !== ".writer" && !/^\.account\.[0-9a-f-]{36}\.tmp$/u.test(name))) throw unavailable();
      const stages = names.filter(name => name.endsWith(".tmp"));
      if (stages.length !== 0) {
        const lock = privateFile(lockPath);
        if (lock === undefined) throw unavailable();
        const owner = LockSchema.safeParse(decode(lock.bytes));
        if (!owner.success || stages.length !== 1 || stages[0] !== `.account.${owner.data.id}.tmp`) throw unavailable();
      }
      const first = privateFile(path), second = privateFile(path);
      inspect(false);
      if (!privateEqual(names, readdirSync(directory).sort()) || (first === undefined) !== (second === undefined)
        || first !== undefined && second !== undefined && !first.bytes.equals(second.bytes)) throw unavailable();
      if (second === undefined) return undefined;
      return parseRecord(second.bytes);
    } catch (error) { if (error instanceof ChatGptCredentialError) throw error; throw unavailable(); }
  }
  function removeExact(file: string, observed: Stats): void {
    inspect(false);
    if (!same(observed, lstatSync(file))) throw unavailable();
    unlinkSync(file);
  }
  function acquire(): Lock {
    admission.assertWritable(); inspect(true);
    const observed = observeProcessIdentity(process.pid);
    if (observed.state !== "alive") throw unavailable();
    const lock: Lock = { id: randomUUID(), pid: process.pid, identity: observed.identity };
    const existing = privateFile(lockPath);
    if (existing !== undefined) {
      const decoded = LockSchema.safeParse(decode(existing.bytes));
      if (!decoded.success) throw unavailable();
      const owner = observeProcessIdentity(decoded.data.pid);
      if (owner.state === "alive" && privateEqual(owner.identity, decoded.data.identity)) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_BUSY");
      admission.assertExclusive();
      const temporary = join(directory, `.account.${decoded.data.id}.tmp`), stage = privateFile(temporary);
      if (stage !== undefined) removeExact(temporary, stage.stat);
      removeExact(lockPath, existing.stat); sync(directory);
    }
    try { writeFileSync(lockPath, JSON.stringify(lock), { mode: 0o600, flag: "wx" }); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_BUSY");
      throw unavailable();
    }
    sync(lockPath); sync(directory);
    return lock;
  }
  async function withLock<T>(operation: (transaction: ChatGptCredentialTransaction) => Promise<T>): Promise<T> {
    let lock: Lock;
    try { lock = acquire(); } catch (error) { if (error instanceof ChatGptCredentialError) throw error; throw unavailable(); }
    let committed = false;
    const assertLock = () => {
      inspect(false);
      const current = privateFile(lockPath);
      if (current === undefined || !privateEqual(decode(current.bytes), lock)) throw unavailable();
      return current.stat;
    };
    let outcome: { readonly kind: "value"; readonly value: T } | { readonly kind: "error"; readonly error: unknown };
    try {
      outcome = { kind: "value", value: await operation({ read, replace(record, expectedRevision) {
        admission.assertWritable(); assertLock();
        const current = read();
        if ((current?.revision ?? null) !== expectedRevision || record.revision !== (expectedRevision ?? 0) + 1) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_CONFLICT");
        const parsed = ChatGptCredentialRecordSchema.safeParse(record);
        if (!parsed.success) throw unavailable();
        const bytes = Buffer.from(JSON.stringify(parsed.data));
        if (bytes.length > MAX_BYTES) throw unavailable();
        const temporary = join(directory, `.account.${lock.id}.tmp`);
        let renamed = false;
        try {
          writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" }); sync(temporary);
          assertLock();
          if (!privateEqual(current ?? null, read() ?? null)) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_CONFLICT");
          renameSync(temporary, path); renamed = true; committed = true;
          options.afterRename?.(); sync(directory);
          const stored = privateFile(path);
          if (stored === undefined || !stored.bytes.equals(bytes)) throw unavailable();
          inspect(false);
        } catch (error) {
          if (renamed) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_UNCERTAIN");
          if (error instanceof ChatGptCredentialError) throw error;
          throw unavailable();
        } finally {
          const stage = privateFile(temporary);
          if (stage !== undefined) removeExact(temporary, stage.stat);
        }
      } }) };
    } catch (error) { outcome = { kind: "error", error }; }
    try { removeExact(lockPath, assertLock()); sync(directory); }
    catch { throw new ChatGptCredentialError(committed ? "CHATGPT_CREDENTIAL_UNCERTAIN" : "CHATGPT_CREDENTIAL_UNAVAILABLE"); }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  }
  return Object.freeze({ read, withLock });
}

export function verifyChatGptCredentialStore(options: ChatGptCredentialRepositoryOptions): void {
  options.admission.assertExclusive();
  const directory = join(options.stateRoot, CHATGPT_CREDENTIAL_DIRECTORY);
  if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) return;
  if (readdirSync(directory).some(name => name !== "account.json")) throw unavailable();
  createChatGptCredentialRepository(options).read();
}
