import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countUcsdLoginRows } from "../storage/sqlite/profile-local-databases.js";

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

type CopyClass = "absent" | "clean" | "holds" | "unknown" | "plaintext" | "unreadable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function holdsUcsd(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const record = value.record;
  if (isRecord(record)) {
    const entries = record.entries;
    if (isRecord(entries) && (entries.ucpathUserId !== undefined || entries.ucpathPassword !== undefined)) return true;
  }
  const history = value.history;
  if (!Array.isArray(history)) return false;
  return history.some((entry: unknown) => {
    if (!isRecord(entry)) return false;
    const request = entry.request;
    if (!isRecord(request)) return false;
    const entries = request.entries;
    if (!isRecord(entries)) return false;
    return ["ucpathUserId", "ucpathPassword"].some((name) => {
      const operation = entries[name];
      return isRecord(operation) && Object.hasOwn(operation, "set");
    });
  });
}

function classifyBytes(bytes: Uint8Array): Exclude<CopyClass, "absent" | "unreadable"> {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return "plaintext"; }
  if (text.trim().length === 0) return "plaintext";
  let decoded: unknown;
  try { decoded = JSON.parse(text); }
  catch { return "plaintext"; }
  if (typeof decoded !== "object" || decoded === null || !("schemaVersion" in decoded)) return "unknown";
  if (decoded.schemaVersion !== 2 && decoded.schemaVersion !== 3) return "unknown";
  return holdsUcsd(decoded) ? "holds" : "clean";
}

function classifyPath(path: string): CopyClass {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info === undefined) return "absent";
  if (info.isSymbolicLink() || !info.isFile()) return "unknown";
  try { return classifyBytes(readFileSync(path)); }
  catch { return "unreadable"; }
}

function countLoginRows(paths: readonly string[]): number | "unreadable" | "absent" {
  if (paths.length === 0) return "absent";
  let rows = 0;
  let sawFile = false;
  for (const path of paths) {
    const count = countUcsdLoginRows(path);
    if (count === "unreadable") return "unreadable";
    if (count === "absent") continue;
    sawFile = true;
    rows += count;
  }
  return sawFile ? rows : "absent";
}

function containsCaptured(bytes: Uint8Array, secrets: readonly Uint8Array[]): boolean {
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return secrets.some((secret) => secret.byteLength > 0 && haystack.includes(secret));
}

export function assessCredentialInventory(input: {
  readonly profileRoot: string;
  readonly entriesAbsent: boolean;
  readonly backupPaths?: readonly string[];
  readonly loginDataPaths?: readonly string[];
  readonly capturedSecrets?: readonly string[];
  readonly capturedSecretsComplete: boolean;
}): CredentialInventory {
  const inventoryMissing = input.backupPaths === undefined || input.loginDataPaths === undefined;
  const captured = (input.capturedSecrets ?? []).map((secret) => Buffer.from(secret, "utf8"));
  const protectedPath = join(input.profileRoot, "credentials", "protected.json");
  const protectedClass = classifyPath(protectedPath);
  let stagePlaintext = false;
  let byteHit = protectedClass !== "absent" && protectedClass !== "unreadable" && captured.length > 0
    && containsCaptured(readFileSync(protectedPath), captured);
  try {
    for (const name of readdirSync(join(input.profileRoot, "credentials"))) {
      if (!name.startsWith(".protected.") || !name.endsWith(".tmp")) continue;
      const path = join(input.profileRoot, "credentials", name);
      const stageClass = classifyPath(path);
      if ((stageClass !== "clean" && stageClass !== "absent") || (stageClass === "clean" && !input.capturedSecretsComplete)) stagePlaintext = true;
      if (captured.length > 0 && stageClass !== "absent" && stageClass !== "unreadable" && containsCaptured(readFileSync(path), captured)) {
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
    const copy = classifyPath(path);
    if (copy === "holds" || copy === "plaintext") backupPlaintext.push(path);
    if (copy === "unknown" || copy === "unreadable" || (copy === "clean" && !input.capturedSecretsComplete)) unknownFormats.push(path);
    if (captured.length > 0 && copy !== "absent" && copy !== "unreadable" && containsCaptured(readFileSync(path), captured)) {
      byteHit = true;
    }
  }
  const loginDataUcSdRows = input.loginDataPaths === undefined ? "absent" : countLoginRows(input.loginDataPaths);
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
