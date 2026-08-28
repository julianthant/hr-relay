import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { SpanEventWireSchema } from "../../events/types.js";
import { readEventStreamLines } from "../events/jsonl-streams.js";
import { AuthorityDatabase } from "./authority-database.js";
import { storageHealthCauseFromError } from "./authority-boot.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "./backup-service.js";
import {
  BackupHealthSchema,
  AuthorityRunIdentityInventorySchema,
  RestoreCandidateSchema,
  SpanAuthorityReconciliationSchema,
  StorageDoctorReportSchema,
  StorageHealthCauseSchema,
  type AuthorityCopyInspection,
  type AuthorityRunIdentityInventory,
  type RestoreCandidate,
  type SpanAuthorityReconciliation,
  type StorageDoctorReport,
} from "./recovery-contracts.js";

export const StorageDoctorOptionsSchema = z.strictObject({
  authorityPath: z.string().min(1),
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
  busyTimeoutMs: z.number().int().positive(),
});

export const BackupSummaryOptionsSchema = z.strictObject({
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
});

/**
 * The CHEAP backup indicator the bootstrap summary serves (ref dashboard-surfaces §2.5's
 * "expose age/health in Settings", 2i-D): newest parseable manifest, judged
 * by its own created-at age and the live authority generation gap. This
 * deliberately does NOT re-hash backup bytes — every manifest was
 * byte-verified against the backup COPY when it was written
 * (`AuthorityBackupService`), so the summary trusts write-time verification
 * and the full `doctorAuthorityStorage` re-verifies bytes on demand for
 * restore decisions. A manifest that no longer parses is treated as absent
 * here — "missing" is the fail-safe reading for a summary whose enum has no
 * invalid arm — and the doctor names the corruption precisely.
 */
export function summarizeBackupHealth(
  input: unknown,
  liveAuthorityGeneration: number | undefined,
  clock: Clock = systemClock,
): "current" | "stale" | "missing" {
  const options = BackupSummaryOptionsSchema.parse(input);
  const directory = resolve(options.backupDirectory);
  if (!existsSync(directory)) return "missing";
  const manifests = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
    .map(({ name }) => name);
  let newest: { createdAtMs: number; authorityGeneration: number } | undefined;
  for (const name of manifests) {
    let createdAtMs: number;
    let authorityGeneration: number;
    try {
      const manifest = parseBackupManifestFile(join(directory, name));
      createdAtMs = Date.parse(manifest.createdAt);
      authorityGeneration = manifest.authorityGeneration;
    } catch {
      // Unparseable is a REAL state the doctor reports as `invalid` with the
      // error named; the summary's closed enum has no such arm, so the file
      // simply does not count as a usable backup here.
      continue;
    }
    // Ties on created-at break by generation: two backups in one clock tick
    // are ordered by what they actually captured.
    if (newest === undefined
      || createdAtMs > newest.createdAtMs
      || (createdAtMs === newest.createdAtMs && authorityGeneration > newest.authorityGeneration)) {
      newest = { createdAtMs, authorityGeneration };
    }
  }
  if (newest === undefined) return "missing";
  const age = clock.nowMs() - newest.createdAtMs;
  if (age > options.maxBackupAgeMs) return "stale";
  if (liveAuthorityGeneration !== undefined
    && liveAuthorityGeneration > newest.authorityGeneration) {
    return "stale";
  }
  return "current";
}

type CandidateWithMtime = Readonly<{
  candidate: RestoreCandidate;
  modifiedMs: number;
}>;

function backupInvalidCause(error: unknown) {
  return StorageHealthCauseSchema.parse({
    code: "backup-invalid",
    summary: error instanceof Error ? error.message : String(error),
  });
}

/**
 * D282's read-only cross-check. Only exact identities from the one authority
 * path and the one span root participate; malformed evidence stops absence
 * classification instead of being skipped around as though it were empty.
 */
export function reconcileSpanAuthority(
  stateRootInput: string,
  inventoryInput: unknown,
): SpanAuthorityReconciliation {
  const stateRoot = resolve(z.string().min(1).parse(stateRootInput));
  const inventory: AuthorityRunIdentityInventory = AuthorityRunIdentityInventorySchema.parse(inventoryInput);
  if (inventory.malformedRecords.length > 0) {
    return SpanAuthorityReconciliationSchema.parse({
      state: "malformed",
      findings: inventory.malformedRecords.map((record) => ({
        kind: "malformed-authority" as const,
        ...record,
      })),
    });
  }

  let lines: ReturnType<typeof readEventStreamLines>;
  try {
    lines = readEventStreamLines(stateRoot, "spans");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return SpanAuthorityReconciliationSchema.parse({
      state: "malformed",
      findings: [{
        kind: "malformed-span",
        fileName: "spans/",
        detail: detail.replaceAll(stateRoot, basename(stateRoot)),
      }],
    });
  }

  const runIds = new Set<string>();
  const queuedRunIds = new Set<string>();
  const malformed: z.input<typeof SpanAuthorityReconciliationSchema.options[1]>["findings"] = [];
  for (const line of lines) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line.text);
    } catch {
      malformed.push({
        kind: "malformed-span",
        fileName: basename(line.file.path),
        lineNumber: line.lineNumber,
        detail: "span line is not valid JSON",
      });
      continue;
    }
    const parsed = SpanEventWireSchema.safeParse(decoded);
    if (!parsed.success) {
      malformed.push({
        kind: "malformed-span",
        fileName: basename(line.file.path),
        lineNumber: line.lineNumber,
        detail: "span line failed strict SpanEventWireSchema parsing",
      });
      continue;
    }
    if ("runId" in parsed.data) runIds.add(parsed.data.runId);
    if (parsed.data.t === "run.queued") queuedRunIds.add(parsed.data.runId);
  }
  if (malformed.length > 0) {
    return SpanAuthorityReconciliationSchema.parse({ state: "malformed", findings: malformed });
  }

  const current = new Set(inventory.currentRunIds);
  const archived = new Set(inventory.archivedRunIds);
  const archivedFindings = [...runIds].filter((runId) => archived.has(runId)).sort().map((runId) => ({
    kind: "archived" as const,
    runId,
  }));
  const missingFindings = inventory.currentRunIds
    .filter((runId) => !archived.has(runId) && !queuedRunIds.has(runId))
    .sort()
    .map((runId) => ({ kind: "missing-span" as const, runId }));
  const unaccountedFindings = [...runIds]
    .filter((runId) => !current.has(runId) && !archived.has(runId))
    .sort()
    .map((runId) => ({ kind: "unaccounted" as const, runId }));
  const currentCount = [...runIds].filter((runId) => current.has(runId) && !archived.has(runId)).length;
  return SpanAuthorityReconciliationSchema.parse({
    state: "complete",
    counts: {
      current: currentCount,
      archived: archivedFindings.length,
      missingSpan: missingFindings.length,
      unaccounted: unaccountedFindings.length,
    },
    findings: [...archivedFindings, ...missingFindings, ...unaccountedFindings],
  });
}

async function inspectCandidates(
  directory: string,
  sourceDatabaseIdentity: string,
  authorityInspection: AuthorityCopyInspection | undefined,
  clock: Clock,
): Promise<readonly CandidateWithMtime[]> {
  if (!existsSync(directory)) return [];
  const manifestNames = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
    .map(({ name }) => name)
    .sort();
  const candidates: CandidateWithMtime[] = [];
  for (const manifestFileName of manifestNames) {
    const manifestPath = join(directory, manifestFileName);
    const modifiedMs = statSync(manifestPath).mtimeMs;
    try {
      const verified = await verifyBackupManifestAtPath(manifestPath, sourceDatabaseIdentity);
      const ageMs = clock.nowMs() - Date.parse(verified.manifest.createdAt);
      if (ageMs < 0) throw new Error(`backup manifest ${manifestFileName} was created in the future`);
      const generationGap = authorityInspection === undefined
        ? { state: "unavailable" as const, reason: "live authority generation is unavailable" }
        : {
            state: "known" as const,
            value: Math.max(0, authorityInspection.authorityGeneration - verified.manifest.authorityGeneration),
          };
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "verified-compatible",
          manifestFileName,
          backupFileName: verified.manifest.backupFileName,
          createdAt: verified.manifest.createdAt,
          authorityGeneration: verified.manifest.authorityGeneration,
          ageMs,
          generationGap,
        }),
      });
    } catch (error) {
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "invalid",
          manifestFileName,
          cause: backupInvalidCause(error),
        }),
      });
    }
  }
  return candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
}

export async function doctorAuthorityStorage(input: unknown, clock: Clock = systemClock): Promise<StorageDoctorReport> {
  const options = StorageDoctorOptionsSchema.parse(input);
  const authorityPath = resolve(options.authorityPath);
  const backupDirectory = resolve(options.backupDirectory);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  let authorityInspection: AuthorityCopyInspection | undefined;
  let authorityCause: ReturnType<typeof storageHealthCauseFromError> | undefined;
  let spanAuthority: SpanAuthorityReconciliation;
  try {
    authorityInspection = AuthorityDatabase.inspectExistingReadOnly(authorityPath, options.busyTimeoutMs);
  } catch (error) {
    authorityCause = storageHealthCauseFromError(error);
  }
  try {
    spanAuthority = reconcileSpanAuthority(
      dirname(authorityPath),
      AuthorityDatabase.inspectRunIdentitiesReadOnly(authorityPath, options.busyTimeoutMs),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    spanAuthority = SpanAuthorityReconciliationSchema.parse({
      state: "unavailable",
      reason: `exact span/authority reconciliation is unavailable: ${detail.replaceAll(dirname(authorityPath), basename(dirname(authorityPath)))}`,
    });
  }

  const candidates = await inspectCandidates(
    backupDirectory,
    sourceDatabaseIdentity,
    authorityInspection,
    clock,
  );
  const first = candidates[0];
  const latestVerified = candidates
    .filter((entry): entry is CandidateWithMtime & { candidate: Extract<RestoreCandidate, { state: "verified-compatible" }> } => (
      entry.candidate.state === "verified-compatible"
    ))
    .sort((left, right) => Date.parse(right.candidate.createdAt) - Date.parse(left.candidate.createdAt))[0];

  let backup: z.infer<typeof BackupHealthSchema>;
  if (first?.candidate.state === "invalid") {
    backup = BackupHealthSchema.parse({ state: "invalid", cause: first.candidate.cause });
  } else if (latestVerified === undefined) {
    backup = BackupHealthSchema.parse({
      state: candidates.length === 0 ? "missing" : "invalid",
      cause: StorageHealthCauseSchema.parse({
        code: candidates.length === 0 ? "backup-missing" : "backup-invalid",
        summary: candidates.length === 0
          ? `no authority backup manifests exist in ${basename(backupDirectory)}`
          : `no verified compatible authority backup exists in ${basename(backupDirectory)}`,
      }),
    });
  } else {
    const generationGap = latestVerified.candidate.generationGap;
    const stale = latestVerified.candidate.ageMs > options.maxBackupAgeMs
      || generationGap.state === "known" && generationGap.value > 0;
    const gapSummary = generationGap.state === "known"
      ? String(generationGap.value)
      : generationGap.reason;
    backup = BackupHealthSchema.parse(stale
      ? {
          state: "stale",
          latest: latestVerified.candidate,
          cause: StorageHealthCauseSchema.parse({
            code: "backup-stale",
            summary: `latest verified backup is ${String(latestVerified.candidate.ageMs)}ms old with authority generation gap ${gapSummary}`,
          }),
        }
      : { state: "current", latest: latestVerified.candidate });
  }

  if (authorityInspection === undefined && authorityCause === undefined) {
    throw new Error("authority doctor produced neither an inspection nor a failure cause");
  }
  return StorageDoctorReportSchema.parse({
    kind: "authority-storage-doctor",
    mode: "read-only",
    checkedAt: clock.now().toISOString(),
    sourceDatabaseIdentity,
    authority: authorityInspection === undefined
      ? { state: "degraded", cause: authorityCause }
      : { state: "healthy", inspection: authorityInspection },
    counts: authorityInspection === undefined
      ? { state: "unavailable", cause: authorityCause }
      : { state: "available", values: authorityInspection.counts },
    backup,
    spanAuthority,
    restoreCandidates: candidates.map(({ candidate }) => candidate),
  });
}
