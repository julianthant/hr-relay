import { Entry } from "@napi-rs/keyring";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, openSync, readdirSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { encodePrivate, privateEqual } from "../../../rules/validation/private-equal.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { fsyncPath, noSymlinkAncestry, readPrivateFile, removeExactPath, writePrivateStage, type DirectoryIdentity } from "./credential-safe-file.js";
import { retainAuthoritySourceClosure } from "../source-closure.js";

const IdentitySchema = z.strictObject({ installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid() });
const LegacyKeySchema = IdentitySchema.extend({ schemaVersion: z.literal(1), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u) });
const KeyMetadataSchema = IdentitySchema.extend({ schemaVersion: z.literal(2), keyDigest: z.string().regex(/^[0-9a-f]{64}$/u), legacyWitness: z.literal(true).optional() });
type KeyMetadata = z.infer<typeof KeyMetadataSchema>;
const MigrationSchema = z.strictObject({ metadata: KeyMetadataSchema, device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() });
type Binding = Pick<KeyMetadata, "installationId" | "profileId">;
export type CredentialKeyMigrationAdmission = (name: string, witness: Readonly<{ keyId: string; binding: Binding; file: DirectoryIdentity & { digest: string } }>) => void;

export interface CredentialSecretStore {
  get(account: string): string | null;
  set(account: string, secret: string): void;
  delete(account: string): void;
}

type KeyCustodyCode = "CREDENTIAL_KEYCHAIN_UNAVAILABLE" | "CREDENTIAL_KEYCHAIN_MISSING" | "CREDENTIAL_KEYCHAIN_MISMATCH" | "CREDENTIAL_KEYCHAIN_UNCERTAIN";
export class CredentialKeyCustodyError extends Error {
  constructor(readonly code: KeyCustodyCode) { super(ERROR_CATALOG[code].text); this.name = "CredentialKeyCustodyError"; }
}
const account = (binding: Binding) => `${binding.installationId}:${binding.profileId}`;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function parseMetadata(bytes: Uint8Array): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
  catch { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH"); }
}
function keyBytes(secret: string): Buffer {
  const bytes = Buffer.from(secret, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== secret) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
  return bytes;
}

export function createCredentialKeyCustody(store: CredentialSecretStore = {
  get: name => new Entry("Relay", name).getPassword(),
  set: (name, secret) => { new Entry("Relay", name).setPassword(secret); },
  delete: name => { new Entry("Relay", name).deletePassword(); },
}) {
  function get(binding: Binding): string | null {
    try { return store.get(account(binding)); }
    catch { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNAVAILABLE"); }
  }
  function read(input: unknown) {
    const metadata = KeyMetadataSchema.safeParse(input);
    if (!metadata.success) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    const key = get(metadata.data);
    if (key === null) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISSING");
    if (digest(keyBytes(key)) !== metadata.data.keyDigest) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    return { schemaVersion: 1 as const, installationId: metadata.data.installationId, profileId: metadata.data.profileId, keyId: metadata.data.keyId, key };
  }
  function create(identity: z.infer<typeof IdentitySchema>): KeyMetadata {
    IdentitySchema.parse(identity);
    if (get(identity) !== null) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    const key = randomBytes(32).toString("base64");
    const metadata = KeyMetadataSchema.parse({ schemaVersion: 2, ...identity, keyDigest: digest(keyBytes(key)) });
    try { store.set(account(identity), key); }
    catch { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN"); }
    if (!privateEqual(read(metadata).key, key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    return metadata;
  }
  function remove(binding: Binding): void {
    if (get(binding) === null) return;
    try { store.delete(account(binding)); }
    catch { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN"); }
    if (get(binding) !== null) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
  }
  function resumeUnpublishedCreation(identity: z.infer<typeof IdentitySchema>): KeyMetadata | undefined {
    IdentitySchema.parse(identity);
    const key = get(identity);
    if (key === null) return undefined;
    const metadata = KeyMetadataSchema.parse({ schemaVersion: 2, ...identity, keyDigest: digest(keyBytes(key)) });
    if (!privateEqual(read(metadata).key, key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    return metadata;
  }
  function fileDigest(bytes: Uint8Array): string {
    const metadata = KeyMetadataSchema.safeParse(parseMetadata(bytes));
    if (!metadata.success) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    const key = read(metadata.data);
    return digest(metadata.data.legacyWitness === true ? encodePrivate(key) : bytes);
  }
  function completeMigration(path: string, journal: string, installationId: string, ancestry: Map<string, DirectoryIdentity>, admit: CredentialKeyMigrationAdmission): void {
    if (!noSymlinkAncestry(dirname(path), ancestry)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    const pending = readPrivateFile(journal, { label: "lock", maxBytes: 4096 });
    if (pending === undefined) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    const parsed = MigrationSchema.safeParse(parseMetadata(pending.bytes));
    if (!parsed.success) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    const intent = parsed.data;
    if (intent.metadata.installationId !== installationId) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    const prior = Buffer.from(encodePrivate(read(intent.metadata))), next = Buffer.from(encodePrivate(intent.metadata));
    admit(basename(path), { keyId: intent.metadata.keyId, binding: { installationId, profileId: intent.metadata.profileId },
      file: { device: intent.device, inode: intent.inode, digest: digest(prior) } });
    const current = readPrivateFile(path, { label: "lock", maxBytes: 4096 });
    if (current === undefined || current.identity.device !== intent.device || current.identity.inode !== intent.inode) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    const bytes = Buffer.from(current.bytes);
    // Retain the inode pinned by existing control and operation witnesses.
    const interrupted = Array.from({ length: next.length + 1 }, (_, prefix) => prefix)
      .some(prefix => bytes.equals(Buffer.concat([next.subarray(0, prefix), prior.subarray(prefix)])));
    if (!bytes.equals(next) && !interrupted) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
    let primary: { error: unknown } | undefined;
    try {
      const info = fstatSync(fd);
      if (info.dev !== intent.device || info.ino !== intent.inode || info.nlink !== 1
        || info.mode !== current.stat.mode || info.uid !== current.stat.uid) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
      let offset = 0;
      while (offset < next.length) {
        const written = writeSync(fd, next, offset, next.length - offset, offset);
        if (written === 0) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
        offset += written;
      }
      fsyncSync(fd); ftruncateSync(fd, next.length); fsyncSync(fd);
    } catch (error) { primary = { error }; }
    try { closeSync(fd); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { descriptor: { descriptor: fd, identity: current.identity } }); }
    if (primary !== undefined) throw primary.error;
    if (!noSymlinkAncestry(dirname(path), ancestry)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    const after = readPrivateFile(path, { label: "lock", maxBytes: 4096 });
    if (after === undefined || after.identity.device !== intent.device || after.identity.inode !== intent.inode
      || !Buffer.from(after.bytes).equals(next)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
    read(intent.metadata);
    removeExactPath(journal, pending.identity, false, "credential-key-migration-intent-changed"); fsyncPath(dirname(journal));
  }
  function migrateDirectory(directory: string, installationId: string, admit: CredentialKeyMigrationAdmission, canMigrate = true): void {
    const ancestry = new Map<string, DirectoryIdentity>();
    if (!noSymlinkAncestry(directory, ancestry)) return;
    for (const name of readdirSync(directory).filter(name => name.startsWith(".keychain-migration."))) {
      if (!canMigrate) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
      const target = name.slice(".keychain-migration.".length);
      if (!/^(?:[0-9a-f-]{36}\.json|\.credential-key\.[0-9a-f-]{36}\.tmp)$/u.test(target)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
      completeMigration(join(directory, target), join(directory, name), installationId, ancestry, admit);
    }
    for (const name of readdirSync(directory)) {
      if (!/^(?:[0-9a-f-]{36}\.json|\.credential-key\.[0-9a-f-]{36}\.tmp)$/u.test(name)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
      const path = join(directory, name), file = readPrivateFile(path, { label: "lock", maxBytes: 4096 });
      if (file === undefined) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
      const input = parseMetadata(file.bytes);
      const metadata = KeyMetadataSchema.safeParse(input);
      if (metadata.success) {
        if (metadata.data.installationId !== installationId) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
        read(metadata.data); continue;
      }
      if (!canMigrate) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
      const legacy = LegacyKeySchema.safeParse(input);
      if (!legacy.success || legacy.data.installationId !== installationId
        || !Buffer.from(file.bytes).equals(Buffer.from(encodePrivate(legacy.data)))) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
      const key = legacy.data;
      keyBytes(key.key);
      if (!name.startsWith(".credential-key.") && name !== `${key.profileId}.json`) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
      admit(name, { keyId: key.keyId, binding: { installationId, profileId: key.profileId }, file: { ...file.identity, digest: digest(file.bytes) } });
      const current = get(key);
      if (current !== null && !privateEqual(current, key.key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
      if (current === null) {
        try { store.set(account(key), key.key); }
        catch { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN"); }
      }
      const next = KeyMetadataSchema.parse({ schemaVersion: 2, installationId: key.installationId, profileId: key.profileId,
        keyId: key.keyId, keyDigest: digest(keyBytes(key.key)), legacyWitness: true });
      if (!privateEqual(read(next).key, key.key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
      const journal = join(directory, `.keychain-migration.${name}`);
      writePrivateStage(journal, encodePrivate({ metadata: next, ...file.identity })); fsyncPath(directory);
      completeMigration(path, journal, installationId, ancestry, admit);
    }
  }
  return Object.freeze({ create, resumeUnpublishedCreation, read, delete: remove, fileDigest, migrateDirectory });
}

export const credentialKeyCustody = createCredentialKeyCustody();
