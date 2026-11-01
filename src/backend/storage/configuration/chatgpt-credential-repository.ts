import { fsyncPath, writePrivateStage, replacePrivateFile } from "../private-path.js";
import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { privateEqual } from "../../../rules/validation/private-equal.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { observeProcessIdentity } from "../sqlite/runtime-process-locks.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";

import { ChatGptCredentialLockSchema as LockSchema, CREDENTIAL_DIRECTORY_MODE, noSymlinkAncestry, statDirectory, ensureChildDirectory, removeExactPath, readPrivateFile, createPrivateLock, companionCredentialEntries, type DirectoryIdentity } from "./credential-safe-file.js";
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

export class ChatGptCredentialError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, `CHATGPT_CREDENTIAL_${string}`>) { super(ERROR_CATALOG[code].text); this.name = "ChatGptCredentialError"; }
}
const unavailable = () => new ChatGptCredentialError("CHATGPT_CREDENTIAL_UNAVAILABLE");
type Lock = z.infer<typeof LockSchema>;

function privateFile(path: string): { bytes: Buffer; stat: Stats } | undefined {
  return readPrivateFile(path, { label: "ChatGPT", maxBytes: MAX_BYTES });
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
  const directory = join(stateRoot, "credentials"), path = join(directory, "chatgpt-account.json"), lockPath = join(directory, ".chatgpt-account.lock");
  const ancestry = new Map<string, DirectoryIdentity>();
  function inspect(create: boolean): boolean {
    admission.assertStateRoot(stateRoot);
    if (!noSymlinkAncestry(stateRoot, ancestry)) return false;
    if (create) ensureChildDirectory(stateRoot, directory, "credential directory", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
    if (!noSymlinkAncestry(directory, ancestry)) return false;
    statDirectory(directory, "credential directory", CREDENTIAL_DIRECTORY_MODE);
    return true;
  }
  function read(): ChatGptCredentialRecord | undefined {
    try {
      admission.assertCredentialRead();
      if (!inspect(false)) { admission.assertCredentialRead(); return undefined; }
      const names = readdirSync(directory).sort();
      const companions = companionCredentialEntries(directory, "ChatGPT");
      if (names.some(name => name !== "chatgpt-account.json" && name !== ".chatgpt-account.lock" && !companions.has(name) && !/^\.chatgpt-account\.[0-9a-f-]{36}\.tmp$/u.test(name))) throw unavailable();
      const stages = names.filter(name => name.startsWith(".chatgpt-account.") && name.endsWith(".tmp"));
      if (stages.length !== 0) {
        const lock = privateFile(lockPath);
        if (lock === undefined) throw unavailable();
        const owner = LockSchema.safeParse(decode(lock.bytes));
        if (!owner.success || stages.length !== 1 || stages[0] !== `.chatgpt-account.${owner.data.id}.tmp`) throw unavailable();
      }
      const first = privateFile(path), second = privateFile(path);
      inspect(false);
      if (!privateEqual(names, readdirSync(directory).sort()) || (first === undefined) !== (second === undefined)
        || first !== undefined && second !== undefined && !first.bytes.equals(second.bytes)) throw unavailable();
      const record = second === undefined ? undefined : parseRecord(second.bytes);
      admission.assertCredentialRead();
      return record;
    } catch (error) { if (error instanceof ChatGptCredentialError) throw error; throw unavailable(); }
  }
  function removeExact(file: string, observed: Stats): void {
    inspect(false);
    removeExactPath(file, { device: observed.dev, inode: observed.ino }, false, "credential file changed before removal");
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
      const temporary = join(directory, `.chatgpt-account.${decoded.data.id}.tmp`), stage = privateFile(temporary);
      if (stage !== undefined) removeExact(temporary, stage.stat);
      removeExact(lockPath, existing.stat); fsyncPath(directory);
    }
    if (!createPrivateLock(lockPath, directory, Buffer.from(JSON.stringify(lock)), () => {
      const current = privateFile(lockPath);
      return current !== undefined && privateEqual(decode(current.bytes), lock);
    })) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_BUSY");
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
        const temporary = join(directory, `.chatgpt-account.${lock.id}.tmp`);
        let renamed = false;
        try {
          writePrivateStage(temporary, bytes);
          assertLock();
          if (!privateEqual(current ?? null, read() ?? null)) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_CONFLICT");
          replacePrivateFile(temporary, path); renamed = true; committed = true;
          options.afterRename?.(); fsyncPath(directory);
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
    try { removeExact(lockPath, assertLock()); fsyncPath(directory); }
    catch { throw new ChatGptCredentialError(committed ? "CHATGPT_CREDENTIAL_UNCERTAIN" : "CHATGPT_CREDENTIAL_UNAVAILABLE"); }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  }
  return Object.freeze({ read, withLock });
}

export function verifyChatGptCredentialStore(options: ChatGptCredentialRepositoryOptions): void {
  options.admission.assertExclusive();
  const directory = join(options.stateRoot, "credentials");
  if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) return;
  if (readdirSync(directory).some(name => name !== "chatgpt-account.json" && name !== "protected.json" && name !== "duo-webauthn.json")) throw unavailable();
  createChatGptCredentialRepository(options).read();
}
