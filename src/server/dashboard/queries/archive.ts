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
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import {
  assessVersionBump,
  type ArchiveRunSnapshot,
  type ArchiveSnapshotSource,
} from "../../../services/archive/archive-service.js";
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
      };
      return Object.freeze(snapshot);
    },
  });
}
