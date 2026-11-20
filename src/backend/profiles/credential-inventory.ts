import { z } from "zod";
import { FingerprintSchema } from "../../rules/identity/ids.js";
import { CredentialHistoryEntrySchema } from "../storage/configuration/credential-store.js";
import {
  StoppedProtectedSettingsApplyInputSchema,
  StoppedProtectedStoreRecordSchema,
} from "../storage/configuration/protected-settings-upgrade.js";
import { readPrivateFile } from "../storage/configuration/credential-safe-file.js";
import type { CredentialInventory } from "../storage/configuration/credential-safe-file.js";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { countProfileCredentialLoginRows } from "../storage/sqlite/profile-local-databases.js";
export { countProfileCredentialLoginRows };

export type { CredentialInventory };

type CopyClass = "absent" | "clean" | "holds" | "unknown" | "plaintext" | "unreadable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LegacyCredentialCopySchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({
    schemaVersion: z.literal(2),
    record: StoppedProtectedStoreRecordSchema,
    history: z.array(z.strictObject({
      request: StoppedProtectedSettingsApplyInputSchema,
      setValueIds: CredentialHistoryEntrySchema.shape.setValueIds,
    })),
  }),
  z.strictObject({
    schemaVersion: z.literal(3),
    record: StoppedProtectedStoreRecordSchema,
    history: z.array(CredentialHistoryEntrySchema.extend({
      receipt: CredentialHistoryEntrySchema.shape.receipt.extend({ requestReceipt: FingerprintSchema.optional() }),
    })),
  }),
]);

function classifyLegacyCopy(value: unknown): "clean" | "holds" | "unknown" {
  const copy = LegacyCredentialCopySchema.safeParse(value);
  if (!copy.success) return "unknown";
  const { entries } = copy.data.record;
  if (entries.ucpathUserId !== undefined || entries.ucpathPassword !== undefined) return "holds";
  if (copy.data.schemaVersion === 2 && copy.data.history.some(({ request }) =>
    (request.entries.ucpathUserId !== undefined && "set" in request.entries.ucpathUserId)
    || (request.entries.ucpathPassword !== undefined && "set" in request.entries.ucpathPassword))) return "holds";
  return "clean";
}

function readCredentialInventoryBytes(path: string): Buffer {
  const file = readPrivateFile(path, { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
  if (file === undefined) throw new Error("credential-inventory-copy-missing");
  return file.bytes;
}

function classifyPath(path: string, inspectEncrypted?: (path: string) => Readonly<{ containsUcsd: boolean; containsCaptured: boolean }>): CopyClass {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info === undefined) return "absent";
  if (info.isSymbolicLink() || !info.isFile()) return "unknown";
  try {
    const bytes = readCredentialInventoryBytes(path);
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return "plaintext"; }
    if (isRecord(decoded) && decoded.schemaVersion === 4) {
      if (inspectEncrypted === undefined) return "unknown";
      const inspected = inspectEncrypted(path);
      return inspected.containsUcsd || inspected.containsCaptured ? "holds" : "clean";
    }
    return classifyLegacyCopy(decoded);
  }
  catch { return "unreadable"; }
}

function containsCaptured(bytes: Uint8Array, secrets: readonly Uint8Array[]): boolean {
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return secrets.some((secret) => secret.byteLength > 0 && haystack.includes(secret));
}

export function assessCredentialInventory(input: {
  readonly profileRoot: string;
  readonly inspectEncrypted?: (path: string) => Readonly<{ containsUcsd: boolean; containsCaptured: boolean }>;
  readonly entriesAbsent: boolean;
  readonly backupPaths?: readonly string[];
  readonly loginDataPaths?: readonly string[];
  readonly capturedSecrets?: readonly string[];
  readonly capturedSecretsComplete: boolean;
}): CredentialInventory {
  const inventoryMissing = input.backupPaths === undefined || input.loginDataPaths === undefined;
  const captured = (input.capturedSecrets ?? []).map((secret) => Buffer.from(secret, "utf8"));
  const protectedPath = join(input.profileRoot, "credentials", "protected.json");
  const protectedClass = classifyPath(protectedPath, input.inspectEncrypted);
  let stagePlaintext = false;
  let byteHit = protectedClass !== "absent" && protectedClass !== "unreadable" && captured.length > 0
    && containsCaptured(readCredentialInventoryBytes(protectedPath), captured);
  try {
    for (const name of readdirSync(join(input.profileRoot, "credentials"))) {
      if (!name.startsWith(".protected.") || !name.endsWith(".tmp")) continue;
      const path = join(input.profileRoot, "credentials", name);
      const stageClass = classifyPath(path, input.inspectEncrypted);
      if ((stageClass !== "clean" && stageClass !== "absent") || (stageClass === "clean" && !input.capturedSecretsComplete)) stagePlaintext = true;
      if (captured.length > 0 && stageClass !== "absent" && stageClass !== "unreadable" && containsCaptured(readCredentialInventoryBytes(path), captured)) {
        byteHit = true;
      }
    }
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
  }
  const backupPaths = input.backupPaths ?? [];
  const backupPlaintext: string[] = [];
  const unknownFormats: string[] = [];
  for (const path of backupPaths) {
    const copy = classifyPath(path, input.inspectEncrypted);
    if (copy === "holds" || copy === "plaintext") backupPlaintext.push(path);
    if (copy === "unknown" || copy === "unreadable" || (copy === "clean" && !input.capturedSecretsComplete)) unknownFormats.push(path);
    if (captured.length > 0 && copy !== "absent" && copy !== "unreadable" && containsCaptured(readCredentialInventoryBytes(path), captured)) {
      byteHit = true;
    }
  }
  const loginDataUcSdRows = input.loginDataPaths === undefined ? "absent" : countProfileCredentialLoginRows(input.loginDataPaths);
  const loginClean = loginDataUcSdRows === "absent" || loginDataUcSdRows === 0;
  const protectedClean = protectedClass === "absent" || protectedClass === "clean";
  return {
    entriesAbsent: input.entriesAbsent,
    protectedPlaintext: protectedClass === "holds" || protectedClass === "plaintext",
    stagePlaintext,
    backupPlaintext,
    unknownFormats,
    inventoryMissing,
    loginDataUcSdRows: input.loginDataPaths === undefined ? "absent" : loginDataUcSdRows,
    logoutComplete: !inventoryMissing && input.entriesAbsent && protectedClean && !stagePlaintext
      && backupPlaintext.length === 0 && unknownFormats.length === 0 && loginClean && !byteHit,
  };
}
