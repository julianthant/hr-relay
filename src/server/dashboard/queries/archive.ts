/**
 * The Archive read model and the version-bump state (D179; doc 03 §10.2, doc
 * 13 §5 "Archive + version bump", §3.6 `GET /api/v1/archive`).
 *
 * **Two halves with opposite rules, in one file so the difference is visible.**
 *
 * `buildArchivedRunDetail` reads ONE archived run and resolves NOTHING. No
 * descriptor, no projection, no live authority beyond the archive tables — the
 * stored record already holds the row, the detail, the receipt, the failure
 * and the evidence pointers, which is what "self-contained" means. Doc 13 §8
 * guard #11 checks it the only way that proves anything: by reading a record
 * back with the workflow registry emptied.
 *
 * `buildArchiveIndex` is the opposite by necessity — the version STATE a bump
 * would act on is a fact about the registry NOW, so it re-derives current
 * identities, candidates and blockers per request rather than reading them out
 * of a plan. A plan goes stale the moment a run is enqueued, and a surface
 * that showed the plan's copy would invite an operator to apply a sweep whose
 * blocker list they had already been shown as empty.
 *
 * `createArchiveSnapshotSource` is the kernel's seam: the final projected row,
 * detail and failure section for a run about to be archived, built by the SAME
 * production projections the live surfaces render, so the frozen bytes are the
 * bytes the operator last saw.
 */
import { z } from "zod";
import {
  ArchiveIndexWireSchema,
  ArchivedRunDetailWireSchema,
  type ArchiveIndexWire,
  type ArchivedRunDetailWire,
} from "../../../domain/dashboard/archive.js";
import type { Clock } from "../../../domain/clock.js";
import { VersionScopeSchema } from "../../../domain/commands.js";
import type { WorkflowVersionIdentity } from "../../../domain/archive/model.js";
import { versionBumpPlanFingerprint } from "../../../domain/archive/model.js";
import { archiveRetention } from "../../../domain/archive/retention.js";
import type { LedgerReadThrough } from "../../../infra/ledger/ledger-read-through.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import {
  assessVersionBump,
  type ArchiveRunSnapshot,
  type ArchiveSnapshotSource,
} from "../../../services/archive/archive-service.js";
import {
  ArchivedProjectionSectionsSchema,
  ArchivedRunAttemptSchema,
  type ArchivedProjectionSections,
  type ArchivedRunAttempt,
} from "../../../domain/archive/sections.js";
import {
  NotePageSchema,
  PeoplePageSchema,
  type ContextDataSectionWire,
} from "../../../domain/dashboard/run-detail.js";

/** The frozen log page's own shape — one place, so the loop and the parse agree. */
type FrozenNotePage = z.infer<typeof NotePageSchema>;
import type { RunFoldRecord } from "../projectors/run-queue-projection.js";
import { buildRunDetail, buildRunSection, type RunDetailQueryDeps } from "./run-detail.js";

export interface ArchiveQueryDeps {
  readonly clock: Clock;
  readonly appVersion: string;
  /**
   * Read-only authority access. The Archive never mutates; a bump is a command
   * and goes through the one command path.
   */
  readonly authority: {
    withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  };
  /**
   * The registry, used ONLY for the version state — never on the archived
   * detail path. `list` is what an application-scope bump needs: charter §25's
   * "a dashboard update bumps the effective version of EVERY workflow".
   */
  readonly descriptors: {
    list(): readonly Readonly<{ id: string; label: string; version: number; contractFingerprint: string }>[];
  };
  /**
   * Resolves an archived run's ledger pointers against the LIVE ledger. It is
   * a required dependency rather than an optional one on purpose: a reader
   * composed without it would serve an empty Write-ledger card on a run that
   * filed real HR transactions, which is the most dangerous empty state this
   * surface has.
   */
  readonly ledger: LedgerReadThrough;
}

export function buildArchiveIndex(deps: ArchiveQueryDeps): ArchiveIndexWire {
  const registered = deps.descriptors.list();
  return deps.authority.withAuthorityTransaction((repositories) => {
    const currentIdentity = (workflowId: string): WorkflowVersionIdentity | undefined => {
      const descriptor = registered.find((entry) => entry.id === workflowId);
      if (descriptor === undefined) return undefined;
      return {
        workflowId: descriptor.id,
        descriptorVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
      } as WorkflowVersionIdentity;
    };

    const versionState = registered.map((descriptor) => {
      const assessment = assessVersionBump(
        { repositories, currentIdentity, appVersion: deps.appVersion },
        VersionScopeSchema.parse({ kind: "workflows", workflowIds: [descriptor.id] }),
      );
      return {
        workflowId: descriptor.id,
        workflowLabel: descriptor.label,
        current: {
          workflowId: descriptor.id,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
        },
        archivable: assessment.candidates.length,
        blockers: assessment.blockers,
      };
    });

    const archived = repositories.archivedRuns.list();
    return ArchiveIndexWireSchema.parse({
      wireVersion: 1,
      archiveSchemaGeneration: 1,
      generatedAt: deps.clock.now().toISOString(),
      currentAppVersion: deps.appVersion,
      entries: archived.map((record) => ({
        runId: record.runId,
        traceId: record.traceId,
        workflowId: record.workflowId,
        workflowLabel: record.workflowLabel.state === "present"
          ? record.workflowLabel.value
          : record.workflowId,
        title: record.row.title,
        status: record.row.status,
        archivedIdentity: record.archivedIdentity,
        appVersion: record.appVersion,
        drift: record.drift,
        startedAt: record.row.startedAt,
        endedAt: record.row.endedAt,
        archivedAt: record.archivedAt,
        applicationId: record.applicationId,
        // Copied off the FROZEN row, never re-derived: the index and the
        // detail must name the same instances, and the detail reads `row`.
        resolvedInstances: record.row.resolvedInstances,
        archiveFingerprint: record.contentDigest,
      })),
      sweeps: repositories.versionBumpApplications.list().map((application) => ({
        applicationId: application.applicationId,
        versionPlanId: application.versionPlanId,
        scope: application.scope,
        targetVersion: application.targetVersion,
        appliedAppVersion: application.appliedAppVersion,
        appliedIdentities: application.appliedIdentities,
        appliedBy: application.appliedBy,
        appliedAt: application.appliedAt,
        archivedCount: application.archivedRunIds.length,
      })),
      versionState,
      plans: repositories.versionPlans.list().map((row) => ({
        versionPlanId: row.versionPlanId,
        expectedVersion: row.version,
        planFingerprint: versionBumpPlanFingerprint(row.plan),
        scope: row.plan.scope,
        targetVersion: row.plan.targetVersion,
        changeFingerprint: row.plan.changeFingerprint,
        observedAppVersion: row.plan.observedAppVersion,
        observedIdentities: row.plan.observedIdentities,
        candidates: row.plan.candidates,
        blockers: row.plan.blockers,
        plannedBy: row.plan.plannedBy,
        plannedAt: row.plan.plannedAt,
        state: row.state,
      })),
    });
  });
}

export function buildArchivedRunDetail(deps: ArchiveQueryDeps, runIdInput: string): ArchivedRunDetailWire {
  const registered = deps.descriptors.list();
  return deps.authority.withAuthorityTransaction((repositories) => {
    const record = repositories.archivedRuns.get(runIdInput);
    if (record === undefined) {
      throw new Error(`archived run ${runIdInput} does not exist`);
    }
    /**
     * The ONLY registry read on this path, and it decides an AFFORDANCE, not
     * content: a relaunch starts a fresh run on the CURRENT version, so it is
     * unavailable when there is no current version to start. Everything the
     * page renders comes out of `record`.
     */
    const current = registered.find((entry) => entry.id === record.workflowId);
    return ArchivedRunDetailWireSchema.parse({
      wireVersion: 1,
      archiveSchemaGeneration: record.archiveSchemaGeneration,
      runId: record.runId,
      applicationId: record.applicationId,
      workflowId: record.workflowId,
      workflowLabel: record.workflowLabel.state === "present"
        ? record.workflowLabel.value
        : record.workflowId,
      archivedIdentity: record.archivedIdentity,
      appVersion: record.appVersion,
      drift: record.drift,
      archivedAt: record.archivedAt,
      archivedBy: record.archivedBy,
      archiveFingerprint: record.contentDigest,
      row: record.row,
      detail: record.detail,
      receipt: record.receipt,
      failure: record.failure,
      evidence: record.evidence,
      /*
       * The read-through. The archived record keeps naming the lines and
       * copies none of them, so this is the one place the two meet — and it
       * happens on READ, per request, against whatever the live ledger holds
       * now. It is not a descriptor read and it resolves no old-version code:
       * the ledger is a flat append-only file whose entry schema is the same
       * one every reader in this tree uses.
       */
      ledger: deps.ledger.resolve(record.evidence.ledgerPartitions),
      /*
       * Computed from the record's OWN fields, the D86 policy constants and
       * `now` — no store read, no descriptor. Reading the artifact bytes back
       * to confirm a retention state would break the property this whole path
       * exists to have (doc 03 §10.2: an archived run resolves nothing), so
       * the pointer count states its derivation rather than claiming an
       * observation.
       */
      retention: archiveRetention({
        now: deps.clock.now().toISOString(),
        endedAt: record.row.endedAt,
        pointerCounts: {
          artifacts: record.evidence.artifactIds.length,
          checkpoints: record.evidence.checkpointNodeIds.length,
          writeIntents: record.evidence.writeIntentIds.length,
          ledgerLines: record.evidence.ledgerPartitions.length,
        },
      }),
      relaunches: repositories.archiveRelaunches.listByArchivedRun(record.runId).map((relaunch) => ({
        runId: relaunch.runId,
        relaunchedIdentity: relaunch.relaunchedIdentity,
        relaunchedBy: relaunch.relaunchedBy,
        relaunchedAt: relaunch.relaunchedAt,
      })),
      relaunch: current === undefined
        ? {
          state: "unavailable",
          reason: `${record.workflowId} is no longer registered; a relaunch starts a fresh run on the current `
            + "version, and there is none",
        }
        : {
          state: "available",
          current: {
            workflowId: current.id,
            descriptorVersion: current.version,
            contractFingerprint: current.contractFingerprint,
          },
        },
    });
  });
}

/**
 * The kernel's snapshot seam. It runs while the run is still LIVE — the bump
 * transaction has not archived it yet — so the projection can still render it,
 * which is exactly why the archive freezes the projection's own bytes instead
 * of re-deriving them later from rows the projection has stopped serving.
 */
export function createArchiveSnapshotSource(deps: RunDetailQueryDeps): ArchiveSnapshotSource {
  return Object.freeze({
    snapshot(runId: string): ArchiveRunSnapshot {
      const row = deps.projection.queueSurface(runId);
      if (row === undefined) {
        throw new Error(
          `run ${runId} has no span fold; refusing to archive a run the projection cannot render, `
          + "because an archived row that could not be built now can never be built later",
        );
      }
      const section = buildRunSection(deps, runId, "failure");
      if (section.section !== "failure") {
        throw new Error(`the failure section of run ${runId} came back as ${section.section}`);
      }
      const { payload } = section;
      const snapshot: ArchiveRunSnapshot = {
        row,
        detail: buildRunDetail(deps, runId),
        failure: payload.state === "available"
          ? { state: "present", value: payload.value }
          // `missing`, `purged` and `error` all carry their own reason, and the
          // archive keeps whichever one the live surface would have shown
          // rather than flattening three different facts into one absence.
          : { state: "absent", reason: payload.state === "error" ? payload.message : payload.reason },
        sections: freezeProjectionSections(deps, runId),
      };
      return Object.freeze(snapshot);
    },
  });
}

/**
 * The upper bound on `logs` paging. It is a REFUSAL bound, not a page size: the
 * loop below walks the section's own cursor to the end and throws if it has not
 * arrived, because a frozen log that silently stopped at N would be an archived
 * run whose story ends mid-sentence with nothing saying so.
 */
const FROZEN_LOG_PAGE_LIMIT = 500;

/**
 * D223's four projection-owned sections, frozen through the SAME production
 * queries the live surfaces call. Nothing here re-derives a payload the live
 * panel would have shown differently — that is the whole reason the freeze goes
 * through this seam instead of reading authority a second time.
 */
function freezeProjectionSections(deps: RunDetailQueryDeps, runId: string): ArchivedProjectionSections {
  const fold = deps.projection.runFold(runId);
  if (fold === undefined) {
    throw new Error(`run ${runId} has no span fold; its sections cannot be frozen`);
  }
  return ArchivedProjectionSectionsSchema.parse({
    logs: { state: "present", value: freezeLogs(deps, runId) },
    data: { state: "present", value: freezeData(deps, runId) },
    people: freezePeople(deps, runId, fold.memberRunIds),
    attempts: { state: "present", value: foldAttempts(fold) },
  });
}

/**
 * EVERY note line, walked through the section's own cursor.
 *
 * The archived page reports `end-of-page` because it genuinely is the end —
 * there is no archived section endpoint to fetch a second page from, so a
 * frozen `nextCursor: present` would name a request nothing serves. Refusing
 * past the bound is the only honest alternative to truncating.
 */
function freezeLogs(deps: RunDetailQueryDeps, runId: string): FrozenNotePage {
  const notes: FrozenNotePage["notes"][number][] = [];
  let cursor: string | undefined;
  for (let page = 0; page < FROZEN_LOG_PAGE_LIMIT; page += 1) {
    const section = buildRunSection(deps, runId, "logs", cursor);
    if (section.section !== "logs") {
      throw new Error(`the logs section of run ${runId} came back as ${section.section}`);
    }
    notes.push(...section.payload.notes);
    if (section.payload.nextCursor.state === "absent") {
      return NotePageSchema.parse({
        runId,
        notes,
        nextCursor: { state: "absent", reason: "end-of-page" },
      });
    }
    cursor = section.payload.nextCursor.value;
  }
  throw new Error(
    `run ${runId} still reports more log pages after ${String(FROZEN_LOG_PAGE_LIMIT)} of them; refusing to `
    + "freeze a truncated log, because an archived run whose story stops mid-sentence says nothing about it",
  );
}

function freezeData(deps: RunDetailQueryDeps, runId: string): ContextDataSectionWire {
  const section = buildRunSection(deps, runId, "context-data");
  if (section.section !== "context-data") {
    throw new Error(`the data section of run ${runId} came back as ${section.section}`);
  }
  return section.payload;
}

/**
 * The member rows, projected from the fold's OWN member ids.
 *
 * There is no live `people` section in this composition (doc 03 D19's People
 * tab is a group-panel surface 2h left unbuilt), so this is not a freeze of a
 * served payload — it is the same projection the queue renders, one row per
 * member, which is exactly what the demo's member table shows. A run with no
 * members says so; a member the projection cannot render REFUSES the archive,
 * for the same reason an unrenderable row does.
 */
function freezePeople(
  deps: RunDetailQueryDeps,
  runId: string,
  memberRunIds: readonly string[],
): ArchivedProjectionSections["people"] {
  if (memberRunIds.length === 0) {
    return { state: "absent", reason: "this run fanned out no member runs" };
  }
  const members = memberRunIds.map((memberRunId) => {
    const surface = deps.projection.queueSurface(memberRunId);
    if (surface === undefined) {
      throw new Error(
        `run ${runId} names member ${memberRunId}, which the projection cannot render; refusing to archive a `
        + "run whose member rows would be permanently unreadable",
      );
    }
    return {
      runId: surface.runId,
      parentRunId: runId,
      rowRevision: surface.rowRevision,
      label: surface.displayName.state === "present" ? surface.displayName.value : surface.title,
      status: surface.status,
    };
  });
  return {
    state: "present",
    value: PeoplePageSchema.parse({
      parentRunId: runId,
      members,
      total: members.length,
      nextCursor: { state: "absent", reason: "end-of-page" },
    }),
  };
}

/**
 * The per-attempt history, folded from the run's own task spans.
 *
 * Span identity is `(runId, attempt, spanPath)`, so grouping by `attempt` is
 * reading the identity the fold already carries rather than inferring a
 * boundary from instants. Attempt 1 is always emitted even when it folded no
 * spans — a run that died before its first task still HAD a first attempt, and
 * an empty attempt list would say the run never started.
 */
function foldAttempts(fold: RunFoldRecord): readonly ArchivedRunAttempt[] {
  const byAttempt = new Map<number, RunFoldRecord["taskSpans"][number][]>();
  for (let attempt = 1; attempt <= fold.attempt; attempt += 1) byAttempt.set(attempt, []);
  for (const span of fold.taskSpans) {
    const bucket = byAttempt.get(span.attempt);
    if (bucket === undefined) byAttempt.set(span.attempt, [span]);
    else bucket.push(span);
  }
  return [...byAttempt.entries()]
    .sort(([left], [right]) => left - right)
    .map(([attempt, spans]) => {
      const counts = new Map<string, number>();
      let unfinished = 0;
      for (const span of spans) {
        if (span.outcome === undefined) unfinished += 1;
        else counts.set(span.outcome, (counts.get(span.outcome) ?? 0) + 1);
      }
      const starts = spans.map((span) => span.startedAt).filter((at): at is string => at !== undefined).sort();
      const ends = spans.map((span) => span.endedAt).filter((at): at is string => at !== undefined).sort();
      return ArchivedRunAttemptSchema.parse({
        attempt,
        steps: spans.length,
        startedAt: starts[0] === undefined
          ? {
            state: "absent",
            reason: spans.length === 0
              ? "this attempt folded no task span at all"
              : "no span.started was folded for any step of this attempt",
          }
          : { state: "present", value: starts[0] },
        endedAt: ends.at(-1) === undefined
          ? {
            state: "absent",
            reason: spans.length === 0
              ? "this attempt folded no task span at all"
              : "no step of this attempt folded a span.ended",
          }
          : { state: "present", value: ends.at(-1) },
        outcomes: [...counts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([outcome, count]) => ({ outcome, count })),
        unfinished,
      });
    });
}
