import { canonicalRunChildren } from "./canonical-runs.js";
import { requireCanonicalRun } from "./run-read.js";
import { buildRunDetail, buildRunSection, createRunNoteScanCache, type RunDetailQueryDeps } from "./run-detail.js";
import { TargetNotFoundError } from "../commands/refusals.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import type { ArchiveRunSnapshot, ArchiveSnapshotSource } from "../archive/archive-service.js";
import { ArchivedProjectionSectionsSchema, ArchivedRunAttemptSchema, type ArchivedProjectionSections, type ArchivedRunAttempt } from "../../../models/archive/sections.js";
import { NotePageSchema, PeoplePageSchema, type ContextDataSectionWire } from "../../../models/dashboard/run-detail.js";
import type { QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import { z } from "zod";

type FrozenNotePage = z.infer<typeof NotePageSchema>;

/**
 * The kernel's snapshot seam. It runs while the run is still LIVE — the bump
 * transaction has not archived it yet — so the projection can still render it,
 * which is exactly why the archive freezes the projection's own bytes instead
 * of re-deriving them later from rows the projection has stopped serving.
 */
export function createArchiveSnapshotSource(deps: RunDetailQueryDeps): ArchiveSnapshotSource {
  const snapshotBatch = (runIds: readonly string[]): ReadonlyMap<string, ArchiveRunSnapshot> => {
    if (runIds.length === 0) return new Map();
    if (deps.runReader === undefined) throw new Error("canonical run reader is required");
    const reader = deps.runReader;
    return reader.withRunTreeSnapshot(runIds, runs => {
    const byId = new Map(runs.map(run => [String(run.envelope.runId), run]));
    const capturedDeps: RunDetailQueryDeps = { ...deps, runReader: { list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader),
      read(runId) {
        const run = byId.get(runId);
        if (run === undefined) throw new Error("archive-capture-run-outside-snapshot");
        return { state: "present", disposition: "live", run };
      },
    } };
    const captured = deps.projection.captureQueueSnapshot(runs);
    const children = canonicalRunChildren(captured.runs);
    const memberIds = new Map(runIds.map((runId) => [runId,
      (children.get(runId) ?? []).filter((run) => run.envelope.shape === "operation-member")
        .map((run) => String(run.envelope.runId)),
    ]));
    const renderIds = [...new Set([...runIds, ...[...memberIds.values()].flat()])];
    const surfaces = new Map(captured.surfaces(renderIds).map((row) => [String(row.runId), row]));
    const snapshots = new Map<string, ArchiveRunSnapshot>();
    for (const runId of runIds) {
      const row = surfaces.get(runId);
      if (row === undefined) {
        throw new TargetNotFoundError(
          `run ${runId} has no live canonical row; refusing to archive a run the projection cannot render, `
          + "because an archived row that could not be built now can never be built later",
        );
      }
      const section = buildRunSection(capturedDeps, runId, "failure");
      if (section.section !== "failure") {
        throw new Error(`the failure section of run ${runId} came back as ${section.section}`);
      }
      const { payload } = section;
      const snapshot: ArchiveRunSnapshot = {
        row,
        detail: buildRunDetail(capturedDeps, runId),
        failure: payload.state === "available"
          ? { state: "present", value: payload.value }
          // `missing`, `purged` and `error` all carry their own reason, and the
          // archive keeps whichever one the live surface would have shown
          // rather than flattening three different facts into one absence.
          : { state: "absent", reason: payload.state === "error" ? payload.message : payload.reason },
        sections: freezeProjectionSections(capturedDeps, runId, memberIds.get(runId) ?? [], surfaces),
      };
      snapshots.set(runId, Object.freeze(snapshot));
    }
    return snapshots;
    });
  };
  return Object.freeze({
    snapshotBatch,
    snapshot(runId: string): ArchiveRunSnapshot {
      const snapshot = snapshotBatch([runId]).get(runId);
      if (snapshot === undefined) throw new Error(`archive batch omitted candidate ${runId}`);
      return snapshot;
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
function freezeProjectionSections(
  deps: RunDetailQueryDeps,
  runId: string,
  memberRunIds: readonly string[],
  surfaces: ReadonlyMap<string, QueueSurfaceWire>,
): ArchivedProjectionSections {
  const { row: fold, authority } = requireCanonicalRun(deps, runId);
  return ArchivedProjectionSectionsSchema.parse({
    logs: { state: "present", value: freezeLogs(deps, runId) },
    data: { state: "present", value: freezeData(deps, runId) },
    people: freezePeople(runId, memberRunIds, surfaces),
    attempts: fold === undefined
      ? { state: "absent", reason: "no execution span evidence was recorded" }
      : { state: "present", value: foldAttempts(fold, authority.envelope.attempt) },
  });
}

/**
 * EVERY combined log row, walked through the section's own cursor over ONE scan.
 *
 * The archived page reports `end-of-page` because it genuinely is the end —
 * there is no archived section endpoint to fetch a second page from, so a
 * frozen `nextCursor: present` would name a request nothing serves. Refusing
 * past the bound is the only honest alternative to truncating.
 */
function freezeLogs(deps: RunDetailQueryDeps, runId: string): FrozenNotePage {
  const notes: FrozenNotePage["notes"][number][] = [];
  const rows: NonNullable<FrozenNotePage["rows"]> = [];
  let structure: FrozenNotePage["operationStructure"];
  let cursor: string | undefined;
  /**
   * D5/L3 (audit P3): ONE immutable combined-log snapshot for the whole page walk.
   *
   * Every page below is still served by the production `buildRunSection` — the
   * freeze does not re-derive a payload the live panel would have shown
   * differently, which is the whole reason it goes through this seam — but each
   * call used to re-open and re-parse the same partitions to slice a different
   * 200 lines out of the same list, up to `FROZEN_LOG_PAGE_LIMIT` times per
   * run, once per run in a version bump. The cache lives for exactly this
   * freeze, so nothing long-lived can serve a page from a corpus a worker has
   * since appended to.
   */
  const noteScan = createRunNoteScanCache();
  for (let page = 0; page < FROZEN_LOG_PAGE_LIMIT; page += 1) {
    const section = buildRunSection(deps, runId, "logs", cursor, noteScan);
    if (section.section !== "logs") {
      throw new Error(`the logs section of run ${runId} came back as ${section.section}`);
    }
    const nextStructure = section.payload.operationStructure;
    if (nextStructure !== undefined) {
      if (structure === undefined) structure = nextStructure;
      else if (structure.state === "observed" && nextStructure.state === "observed"
        && structure.definition.contentDigest === nextStructure.definition.contentDigest) {
        structure = { ...structure, observations: [...structure.observations, ...nextStructure.observations] };
      } else if (structure.state !== nextStructure.state
        || (structure.state === "observed" && nextStructure.state === "observed")) throw new Error("archive-operation-structure-changed-during-freeze");
    }
    notes.push(...section.payload.notes);
    if (section.payload.rows === undefined) {
      throw new Error(`live logs for run ${runId} omitted combined rows; this build refuses to archive a pre-L3 shape`);
    }
    rows.push(...section.payload.rows);
    if (section.payload.nextCursor.state === "absent") {
      return NotePageSchema.parse({
        runId,
        ...(structure === undefined ? {} : { operationStructure: structure }),
        rows,
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
 * Member rows come from canonical parent/shape membership.
 *
 * There is no live `people` section in this composition (ref dashboard-surfaces D19's People
 * tab is a group-panel surface 2h left unbuilt), so this is not a freeze of a
 * served payload — it is the same projection the queue renders, one row per
 * member, which is exactly what the demo's member table shows. A run with no
 * members says so; a member the projection cannot render REFUSES the archive,
 * for the same reason an unrenderable row does.
 */
function freezePeople(
  runId: string,
  memberRunIds: readonly string[],
  byId: ReadonlyMap<string, QueueSurfaceWire>,
): ArchivedProjectionSections["people"] {
  if (memberRunIds.length === 0) {
    return { state: "absent", reason: "this run fanned out no member runs" };
  }
  const members = memberRunIds.map((memberRunId) => {
    const surface = byId.get(memberRunId);
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
function foldAttempts(fold: RunFoldRecord, currentAttempt: number): readonly ArchivedRunAttempt[] {
  const byAttempt = new Map<number, RunFoldRecord["taskSpans"][number][]>();
  for (let attempt = 1; attempt <= currentAttempt; attempt += 1) byAttempt.set(attempt, []);
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
