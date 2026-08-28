import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import {
  SpanEventWireSchema,
  type RunQueuedWire,
  type SpanEventWire,
} from "../../events/types.js";
import { readEventStreamLines } from "../events/jsonl-streams.js";
import {
  AuthorityDatabase,
  AuthorityRunIdentityReadError,
} from "./authority-database.js";
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
  spanRoot: z.string().min(1),
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
  busyTimeoutMs: z.number().int().positive(),
});

export const BackupSummaryOptionsSchema = z.strictObject({
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
});

export const SpanAuthorityHealthSummarySchema = z.strictObject({
  state: z.enum(["healthy", "degraded"]),
  summary: z.string().min(1),
});
export type SpanAuthorityHealthSummary = z.infer<typeof SpanAuthorityHealthSummarySchema>;

/** One health judgment consumed by preflight and the CLI; archived evidence is accounted evidence. */
export function summarizeSpanAuthorityReconciliation(input: unknown): SpanAuthorityHealthSummary {
  const reconciliation = SpanAuthorityReconciliationSchema.parse(input);
  if (reconciliation.state === "complete") {
    const { current, archived, missingSpan, unaccounted } = reconciliation.counts;
    if (missingSpan === 0 && unaccounted === 0) {
      return SpanAuthorityHealthSummarySchema.parse({
        state: "healthy",
        summary: `span/authority identities reconcile (${String(current)} current, ${String(archived)} archived)`,
      });
    }
    return SpanAuthorityHealthSummarySchema.parse({
      state: "degraded",
      summary: `span/authority identities include ${String(missingSpan)} missing-span and ${String(unaccounted)} unaccounted run(s)`,
    });
  }
  if (reconciliation.state === "malformed") {
    const kinds = [...new Set(reconciliation.findings.map(({ kind }) => kind))].sort();
    return SpanAuthorityHealthSummarySchema.parse({
      state: "degraded",
      summary: `span/authority reconciliation is malformed (${kinds.join(", ")})`,
    });
  }
  return SpanAuthorityHealthSummarySchema.parse({
    state: "degraded",
    summary: `span/authority reconciliation is unavailable: ${reconciliation.reason}`,
  });
}

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

  type RunEvent = Extract<SpanEventWire, { runId: string }>;
  type LineRef = Readonly<{ fileName: string; lineNumber: number }>;
  type RunState = {
    root?: RunQueuedWire;
    rootLine?: LineRef;
    currentAttempt?: number;
    lastTimestampMs?: number;
    terminal: boolean;
    readonly taskSpans: Set<string>;
  };
  const runStates = new Map<string, RunState>();
  const malformed: z.input<typeof SpanAuthorityReconciliationSchema.options[1]>["findings"] = [];
  const malformedSpan = (line: LineRef, detail: string): void => {
    malformed.push({ kind: "malformed-span", ...line, detail });
  };

  const rootScoped = (event: RunEvent): boolean => event.t === "run.claimed"
    || event.t === "run.requeued"
    || event.t === "gate.opened"
    || event.t === "gate.resolved"
    || event.t === "transaction.previewed"
    || (event.t === "span.ended" && event.kind === "run");
  const taskScoped = (event: RunEvent): boolean => (event.t === "span.started" && event.kind === "task")
    || (event.t === "span.ended" && event.kind === "task")
    || event.t === "transaction.fenced"
    || event.t === "data.observed";

  for (const line of lines) {
    const lineRef = { fileName: basename(line.file.path), lineNumber: line.lineNumber };
    let decoded: unknown;
    try {
      decoded = JSON.parse(line.text);
    } catch {
      malformedSpan(lineRef, "span line is not valid JSON");
      continue;
    }
    const parsed = SpanEventWireSchema.safeParse(decoded);
    if (!parsed.success) {
      malformedSpan(lineRef, "span line failed strict SpanEventWireSchema parsing");
      continue;
    }
    if (!("runId" in parsed.data)) continue;
    const event = parsed.data;
    const state = runStates.get(event.runId) ?? {
      terminal: false,
      taskSpans: new Set<string>(),
    };
    runStates.set(event.runId, state);

    if (event.t === "run.queued") {
      if (state.root !== undefined) {
        malformedSpan(
          lineRef,
          JSON.stringify(state.root) === JSON.stringify(event)
            ? `run ${event.runId} has duplicate run.queued roots`
            : `run ${event.runId} has conflicting duplicate run.queued roots`,
        );
        continue;
      }
      if (state.lastTimestampMs !== undefined) {
        malformedSpan(lineRef, `run ${event.runId} run.queued root appears after another run event`);
      }
      if (event.spanPath !== event.traceId || event.parentSpanPath !== undefined) {
        malformedSpan(lineRef, `run ${event.runId} run.queued root path does not equal its trace root`);
      }
      state.root = event;
      state.rootLine = lineRef;
      state.currentAttempt = event.attempt;
      state.lastTimestampMs = Date.parse(event.ts);
      continue;
    }

    if (state.root === undefined || state.currentAttempt === undefined) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} appears before its run.queued root`);
      state.lastTimestampMs = Date.parse(event.ts);
      continue;
    }
    const root = state.root;
    if (state.terminal) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} appears after its terminal run span`);
    }
    if (event.workflow !== root.workflow) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} carries a foreign workflow identity`);
    }
    if (event.traceId !== root.traceId) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} carries a foreign trace identity`);
    }
    if (event.attempt !== state.currentAttempt) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} carries an out-of-order attempt`);
    }
    const timestampMs = Date.parse(event.ts);
    if (state.lastTimestampMs !== undefined && timestampMs < state.lastTimestampMs) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} precedes the prior run event timestamp`);
    }
    state.lastTimestampMs = timestampMs;
    if (rootScoped(event) && (event.spanPath !== root.traceId || event.parentSpanPath !== undefined)) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} does not use the run root path`);
    }
    if (taskScoped(event)
      && (!event.spanPath.startsWith(`${root.traceId}/`) || event.parentSpanPath !== root.traceId)) {
      malformedSpan(lineRef, `run ${event.runId} ${event.t} task identity is not a child of the run root`);
    }
    if (event.t === "span.started" && event.kind === "task") {
      const key = `${String(event.attempt)}\0${event.spanPath}`;
      if (state.taskSpans.has(key)) malformedSpan(lineRef, `run ${event.runId} task span opens twice`);
      state.taskSpans.add(key);
    }
    if (event.t === "span.ended" && event.kind === "task") {
      const key = `${String(event.attempt)}\0${event.spanPath}`;
      if (!state.taskSpans.delete(key)) {
        malformedSpan(lineRef, `run ${event.runId} task span ends before its matching start`);
      }
    }
    if (event.t === "run.requeued") {
      if (event.nextAttempt !== event.attempt + 1) {
        malformedSpan(lineRef, `run ${event.runId} run.requeued does not advance exactly one attempt`);
      } else {
        state.currentAttempt = event.nextAttempt;
      }
    }
    if (event.t === "span.ended" && event.kind === "run") state.terminal = true;
  }
  if (malformed.length > 0) {
    return SpanAuthorityReconciliationSchema.parse({ state: "malformed", findings: malformed });
  }

  const current = new Map(inventory.currentRuns.map((identity) => [identity.runId, identity]));
  const archived = new Map(inventory.archivedRuns.map((identity) => [identity.runId, identity]));
  const mismatchedRoots: z.input<typeof SpanAuthorityReconciliationSchema.options[1]>["findings"] = [];
  const comparableFields = [
    "workflow",
    "itemId",
    "traceId",
    "parentRunId",
    "shape",
    "priority",
    "dryRun",
    "descriptorVersion",
    "contractFingerprint",
    "resolvedInstance",
    "configFingerprint",
  ] as const;
  for (const [runId, state] of runStates) {
    if (state.root === undefined || state.rootLine === undefined || state.currentAttempt === undefined) continue;
    const identity = archived.get(runId) ?? current.get(runId);
    if (identity === undefined) continue;
    const fields = comparableFields.filter((field) => field === "resolvedInstance"
      ? canonicalJsonStringify(state.root?.[field]) !== canonicalJsonStringify(identity[field])
      : state.root?.[field] !== identity[field]);
    if (state.currentAttempt !== identity.attempt) fields.push("attempt");
    if (identity.source === "current") {
      if (state.root.retryOf !== identity.retryOf) fields.push("retryOf");
      if (state.root.configSnapshotId !== identity.configSnapshotId) fields.push("configSnapshotId");
    }
    if (fields.length > 0) {
      mismatchedRoots.push({
        kind: "malformed-span",
        ...state.rootLine,
        detail: `run ${runId} run.queued root does not match ${identity.source} authority fields: ${fields.join(", ")}`,
      });
    }
  }
  if (mismatchedRoots.length > 0) {
    return SpanAuthorityReconciliationSchema.parse({ state: "malformed", findings: mismatchedRoots });
  }

  const runIds = [...runStates.keys()];
  const queuedRunIds = new Set([...runStates].flatMap(([runId, state]) => state.root === undefined ? [] : [runId]));
  const archivedFindings = runIds.filter((runId) => archived.has(runId)).sort().map((runId) => ({
    kind: "archived" as const,
    runId,
  }));
  const missingFindings = inventory.currentRuns
    .map(({ runId }) => runId)
    .filter((runId) => !archived.has(runId) && !queuedRunIds.has(runId))
    .sort()
    .map((runId) => ({ kind: "missing-span" as const, runId }));
  const unaccountedFindings = [...runIds]
    .filter((runId) => !current.has(runId) && !archived.has(runId))
    .sort()
    .map((runId) => ({ kind: "unaccounted" as const, runId }));
  const currentCount = [...queuedRunIds].filter((runId) => current.has(runId) && !archived.has(runId)).length;
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
  const spanRoot = resolve(options.spanRoot);
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
      spanRoot,
      AuthorityDatabase.inspectRunIdentitiesReadOnly(authorityPath, options.busyTimeoutMs),
    );
  } catch (error) {
    if (error instanceof AuthorityRunIdentityReadError) {
      spanAuthority = SpanAuthorityReconciliationSchema.parse({
        state: "malformed",
        findings: [{
          kind: "malformed-authority",
          source: error.source,
          recordKey: error.recordKey,
          detail: error.detail,
        }],
      });
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      spanAuthority = SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        reason: `exact span/authority reconciliation is unavailable: ${detail.replaceAll(dirname(authorityPath), basename(dirname(authorityPath))).replaceAll(spanRoot, basename(spanRoot))}`,
      });
    }
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
