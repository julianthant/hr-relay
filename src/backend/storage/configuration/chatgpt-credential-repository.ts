import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import { hasUnprovedSourceClosure } from "../source-closure.js";
import { CanonicalCredentialError, createCanonicalCredentials, type CanonicalCredentialRecord } from "./canonical-credential-store.js";

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
  constructor(readonly code: Extract<ErrorCatalogCode, `CHATGPT_CREDENTIAL_${string}`>) {
    super(ERROR_CATALOG[code].text); this.name = "ChatGptCredentialError";
  }
}
function credentialError(error?: unknown): ChatGptCredentialError {
  if (error instanceof ChatGptCredentialError) return error;
  const code = error instanceof CanonicalCredentialError ? error.code : "CREDENTIAL_UNAVAILABLE";
  const mapped = new ChatGptCredentialError(code === "CREDENTIAL_BUSY" ? "CHATGPT_CREDENTIAL_BUSY"
    : code === "CREDENTIAL_CONFLICT" ? "CHATGPT_CREDENTIAL_CONFLICT"
      : code === "CREDENTIAL_UNCERTAIN" ? "CHATGPT_CREDENTIAL_UNCERTAIN" : "CHATGPT_CREDENTIAL_UNAVAILABLE");
  if (hasUnprovedSourceClosure(error)) mapped.cause = error;
  return mapped;
}
function parseRecord(record: CanonicalCredentialRecord | undefined): ChatGptCredentialRecord | undefined {
  if (record === undefined) return undefined;
  const parsed = ChatGptCredentialRecordSchema.safeParse(record.value);
  if (!parsed.success || parsed.data.revision !== record.revision || Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_BYTES) throw credentialError();
  return parsed.data;
}
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
  let owner: ReturnType<typeof createCanonicalCredentials>;
  try {
    const admission = requireRuntimeAdmission(options.admission);
    if (!isAbsolute(options.stateRoot) || resolve(options.stateRoot) !== options.stateRoot || admission.stateRoot !== options.stateRoot) throw credentialError();
    owner = createCanonicalCredentials(admission, { afterReplace(kind) { if (kind === "chatgpt") options.afterRename?.(); } });
  } catch (error) { throw credentialError(error); }
  function read(): ChatGptCredentialRecord | undefined {
    try { return parseRecord(owner.readRecord("chatgpt")); }
    catch (error) { throw credentialError(error); }
  }
  async function withLock<T>(operation: (transaction: ChatGptCredentialTransaction) => Promise<T>): Promise<T> {
    try {
      return await owner.withChatGptOperation(async transaction => operation({
        read() {
          try { return parseRecord(transaction.read()); }
          catch (error) { throw credentialError(error); }
        },
        replace(record, expectedRevision) {
          try {
            const current = parseRecord(transaction.read());
            if ((current?.revision ?? null) !== expectedRevision) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_CONFLICT");
            const parsed = parseRecord({ revision: record.revision, value: record });
            if (parsed === undefined) throw credentialError();
            if (parsed.revision !== (expectedRevision ?? 0) + 1) throw new ChatGptCredentialError("CHATGPT_CREDENTIAL_CONFLICT");
            transaction.replace(parsed, expectedRevision);
          } catch (error) { throw credentialError(error); }
        },
      }));
    } catch (error) {
      if (error instanceof CanonicalCredentialError) throw credentialError(error);
      throw error;
    }
  }
  return Object.freeze({ read, withLock });
}

export function verifyChatGptCredentialStore(options: ChatGptCredentialRepositoryOptions): void {
  options.admission.assertExclusive();
  createChatGptCredentialRepository(options).read();
}
