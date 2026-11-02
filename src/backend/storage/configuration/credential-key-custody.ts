import { Entry } from "@napi-rs/keyring";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { privateEqual } from "../../../rules/validation/private-equal.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { hasUnprovedSourceClosure } from "../source-closure.js";

const IdentitySchema = z.strictObject({ installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid() });
const StoppedLegacyKeySchema = IdentitySchema.extend({ schemaVersion: z.literal(1), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u) });
const KeyMetadataSchema = IdentitySchema.extend({ schemaVersion: z.literal(2), keyDigest: z.string().regex(/^[0-9a-f]{64}$/u) });
type KeyMetadata = z.infer<typeof KeyMetadataSchema>;
type Binding = Pick<KeyMetadata, "installationId" | "profileId">;

export interface CredentialSecretStore {
  get(account: string): string | null;
  set(account: string, secret: string): void;
  delete(account: string): void;
}

type KeyCustodyCode = "CREDENTIAL_KEYCHAIN_UNAVAILABLE" | "CREDENTIAL_KEYCHAIN_MISSING" | "CREDENTIAL_KEYCHAIN_MISMATCH" | "CREDENTIAL_KEYCHAIN_UNCERTAIN";
export class CredentialKeyCustodyError extends Error {
  constructor(readonly code: KeyCustodyCode, options?: ErrorOptions) { super(ERROR_CATALOG[code].text, options); this.name = "CredentialKeyCustodyError"; }
}
const account = (binding: Binding) => `${binding.installationId}:${binding.profileId}`;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
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
    catch (cause) { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNAVAILABLE", hasUnprovedSourceClosure(cause) ? { cause } : undefined); }
  }
  function read(input: unknown) {
    const metadata = KeyMetadataSchema.safeParse(input);
    if (!metadata.success) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    const key = get(metadata.data);
    if (key === null) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISSING");
    if (digest(keyBytes(key)) !== metadata.data.keyDigest) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    return { schemaVersion: 1 as const, installationId: metadata.data.installationId, profileId: metadata.data.profileId, keyId: metadata.data.keyId, key };
  }
  function assertAbsent(identity: z.infer<typeof IdentitySchema>): void {
    IdentitySchema.parse(identity);
    if (get(identity) !== null) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
  }
  function create(identity: z.infer<typeof IdentitySchema>, beforeSet: (metadata: KeyMetadata, key: Buffer) => void): KeyMetadata {
    assertAbsent(identity);
    const key = randomBytes(32).toString("base64");
    const metadata = KeyMetadataSchema.parse({ schemaVersion: 2, ...identity, keyDigest: digest(keyBytes(key)) });
    beforeSet(metadata, keyBytes(key));
    try { store.set(account(identity), key); }
    catch (cause) { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN", hasUnprovedSourceClosure(cause) ? { cause } : undefined); }
    if (!privateEqual(read(metadata).key, key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    return metadata;
  }
  function importStoppedLegacy(input: unknown, beforeSet: (metadata: KeyMetadata, key: Buffer) => void): KeyMetadata {
    const source = StoppedLegacyKeySchema.parse(input), key = keyBytes(source.key), current = get(source);
    if (current !== null && !privateEqual(current, source.key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    const metadata = KeyMetadataSchema.parse({ schemaVersion: 2, installationId: source.installationId,
      profileId: source.profileId, keyId: source.keyId, keyDigest: digest(key) });
    beforeSet(metadata, key);
    if (current === null) {
      try { store.set(account(source), source.key); }
      catch (cause) { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN", hasUnprovedSourceClosure(cause) ? { cause } : undefined); }
    }
    if (!privateEqual(read(metadata).key, source.key)) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    return metadata;
  }
  function remove(input: unknown): void {
    const metadata = KeyMetadataSchema.parse(input), current = get(metadata);
    if (current === null) return;
    if (digest(keyBytes(current)) !== metadata.keyDigest) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_MISMATCH");
    try { store.delete(account(metadata)); }
    catch (cause) { throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN", hasUnprovedSourceClosure(cause) ? { cause } : undefined); }
    if (get(metadata) !== null) throw new CredentialKeyCustodyError("CREDENTIAL_KEYCHAIN_UNCERTAIN");
  }
  function resumeUnpublishedCreation(input: unknown): KeyMetadata {
    const metadata = KeyMetadataSchema.parse(input);
    read(metadata);
    return metadata;
  }
  return Object.freeze({ create, assertAbsent, resumeUnpublishedCreation, importStoppedLegacy, read, delete: remove });
}

export const credentialKeyCustody = createCredentialKeyCustody();
