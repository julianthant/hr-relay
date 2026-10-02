import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { backupHasArchiveTransferCustody } from "../compat/backup-inspection.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { NORMAL_AUTHORITY_SCHEMA_VERSION, UPGRADE_FLOOR_SCHEMA_VERSION } from "./migrations.js";
import { verifyLifecyclePair } from "./lifecycle-storage.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { StorageRecoveryInspectionSchema, type RestoreCandidate } from "./recovery-contracts.js";

const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
// Read-only shapes match the existing writers; no new persisted format is introduced.
const MARKERS = [
  { marker: "lifecycle-restore", schema: z.strictObject({ schemaVersion: z.literal(1), manifestDigest: Digest }) },
  { marker: "archive-conversion", schema: z.strictObject({ schemaVersion: z.literal(1), sourceIdentity: Digest,
    backupSha256: Digest, recordedAt: z.string().datetime() }) },
  { marker: "archive-restore", schema: z.strictObject({ sourceIdentity: Digest, backupSha256: Digest }) },
] as const;

function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function noFollowBytes(path: string): Buffer {
  requireDatabaseSourcePath(path);
  const before = lstatSync(path);
  if (!before.isFile() || before.size > 1024 * 1024) throw new Error("recovery-evidence-unavailable");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("recovery-evidence-changed");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd), named = lstatSync(path);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || named.dev !== before.dev || named.ino !== before.ino) {
      throw new Error("recovery-evidence-changed");
    }
    return bytes;
  } finally { closeSync(fd); }
}

/** Private identity receipt lets the doctor detect marker changes across awaited backup reads. */
export function inspectStorageRecovery(stateRoot: string, sourceIdentity: string) {
  const findings: { marker: typeof MARKERS[number]["marker"]; state: "interrupted" | "unavailable" }[] = [];
  const identities: string[] = [];
  try {
    requireDatabaseSourcePath(join(stateRoot, "state.db"));
    if (!lstatSync(stateRoot).isDirectory()) throw new Error("recovery-root-unavailable");
  } catch {
    return { identity: "root-unavailable", report: StorageRecoveryInspectionSchema.parse({ state: "unavailable", findings,
      cause: { code: "authority-unavailable", summary: "Recovery markers could not be inspected safely." } }) };
  }
  for (const { marker, schema } of MARKERS) {
    const path = join(stateRoot, `.${marker}.json`);
    try { lstatSync(path); }
    catch (error) {
      if (absent(error)) { identities.push(`${marker}:absent`); continue; }
      findings.push({ marker, state: "unavailable" }); identities.push(`${marker}:unavailable`); continue;
    }
    try {
      const bytes = noFollowBytes(path);
      identities.push(`${marker}:${createHash("sha256").update(bytes).digest("hex")}`);
      const record = schema.parse(JSON.parse(bytes.toString("utf8")));
      if ("sourceIdentity" in record && record.sourceIdentity !== sourceIdentity) throw new Error("recovery-identity-mismatch");
      findings.push({ marker, state: "interrupted" });
    } catch {
      findings.push({ marker, state: "unavailable" });
      identities.push(`${marker}:unavailable`);
    }
  }
  const report = findings.some(row => row.state === "unavailable")
    ? { state: "unavailable", findings, cause: { code: "authority-unavailable",
      summary: "Recovery evidence is unreadable, invalid or has an unexpected identity. Preserve it before recovery." } }
    : findings.length > 0 ? { state: "interrupted", findings } : { state: "clear" };
  return { identity: identities.join("|"), report: StorageRecoveryInspectionSchema.parse(report) };
}

/** Authenticate the exact existing pair, including pending/published file custody. */
export async function inspectDoctorPairWithOrigin(admission: RuntimeAdmission,path: string,
  classifyOrigin: (sourceIdentity: string) => "current" | "previous-location") {
  // The verifier already refuses leaf aliases. Check parent paths before it reads retained files.
  const envelope = z.object({ fileDirectory: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    liveManifest: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    archiveFile: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u) }).parse(JSON.parse(noFollowBytes(path).toString("utf8")));
  requireDatabaseSourcePath(join(dirname(path), envelope.fileDirectory, "probe"));
  for (const name of [envelope.liveManifest, envelope.archiveFile]) requireDatabaseSourcePath(join(dirname(path), name));
  const verified = await verifyLifecyclePair(admission,path);
  const origin = classifyOrigin(verified.pair.sourceDatabaseIdentity);
  return { verified: verified.live, origin };
}

export async function inspectDoctorPair(admission: RuntimeAdmission,path: string, sourceIdentity: string) {
  const inspected = await inspectDoctorPairWithOrigin(admission,path, (identity) => {
    if (identity !== sourceIdentity) throw new Error("lifecycle-restore-identity-mismatch");
    return "current";
  });
  return inspected.verified;
}

type Eligibility = Extract<RestoreCandidate, {state: "verified-compatible"}>["restoreEligibility"];
export function inspectRestoreEligibility(admission: RuntimeAdmission,input: { schemaVersion: number; paired: boolean; backupPath: string; backupSha256:string;
  stateRoot: string; authorityAvailable: boolean }): Eligibility {
  if (input.schemaVersion < UPGRADE_FLOOR_SCHEMA_VERSION) return { state: "unsupported",
    reason: `Below recovery floor ${String(UPGRADE_FLOOR_SCHEMA_VERSION)}. Restore and upgrade with the original compatible release, or start a fresh root.` };
  if (input.schemaVersion < NORMAL_AUTHORITY_SCHEMA_VERSION) return { state: "requires-upgrade" };
  if (input.paired) return { state: "eligible" };
  try {
    const archivePath = join(input.stateRoot, "archive.sqlite");
    requireDatabaseSourcePath(archivePath);
    let archivePresent = true;
    try { lstatSync(archivePath); } catch (error) { if (absent(error)) archivePresent = false; else throw error; }
    const copyAdmission=admission.verifiedReadOnlyCopy(input.backupPath,input.backupSha256,"authority");
    let backupHasCustody:boolean;
    try { backupHasCustody=backupHasArchiveTransferCustody(copyAdmission,input.backupPath); }
    finally { copyAdmission.release(); }
    if (archivePresent || backupHasCustody) return { state: "incomplete",
      reason: "A complete lifecycle pair is required, including the archive and retained files. Select its exact .lifecycle.json manifest." };
    if (!input.authorityAvailable) return { state: "unavailable", reason: "Live archive custody cannot be established from unavailable authority." };
    if (backupHasArchiveTransferCustody(admission,join(input.stateRoot, "state.db"))) return { state: "incomplete",
      reason: "Live archive custody requires a complete lifecycle pair. Preserve the existing evidence." };
    return { state: "eligible" };
  } catch { return { state: "unavailable", reason: "Archive custody could not be inspected safely." }; }
}
