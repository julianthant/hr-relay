/**
 * The `notes/` partitions ONE run's log lines may occupy — the ONE function the
 * logs READER opens partitions with and every note PRODUCER asserts against
 * (ref dashboard-surfaces §2.1, D5 audit P3).
 *
 * `notes/` is partitioned append-at-now: the writer files a line under
 * `localDatePart(clock.now())` at the moment of the write
 * (`src/backend/storage/events/note-jsonl-writer.ts`). The reader cannot afford to open
 * every day of every workflow to serve one run's thirteen lines, so it opens a
 * WINDOW composed from the run's durable instants — and nothing but this module
 * binds the two halves together. A note filed outside the window the reader
 * would open is a line that exists on disk and can never be served: the silent
 * drop this repository forbids.
 *
 * So the contract is structural rather than a comment. The scope arithmetic
 * lives here once; the reader composes its instants as a SUPERSET of the ones
 * `runRecordNoteScopeInstants` derives from authority alone (it adds the span
 * fold's), and a producer asserts against the authority-only scope. A minimum
 * over a superset can only be smaller and a maximum only larger, so the
 * producer's scope is contained in the reader's by construction — a note the
 * assertion admits is a note the reader opens the partition for. Authority's
 * `updatedAt` only moves forward, so the reader's window only widens with time;
 * it can never retreat past a note already admitted.
 *
 * The window is composed from DURABLE instants rather than from the wall clock,
 * because "now" is not a fact about the run and would re-widen the scope for
 * every old run an operator opens. An instant that cannot be parsed fails loud:
 * skipping a partition on the strength of a timestamp nobody could read is how
 * a run's real history gets reported as absent.
 */
import { z } from "zod";
import { localDatePart } from "../clock.js";
import type { RunRecord } from "./record.js";

/** One durable instant the window is composed from, with the name of the fact it is. */
export const RunNoteScopeInstantSchema = z.strictObject({
  label: z.string().min(1),
  /** An ISO instant — refused by name when it cannot be parsed. */
  at: z.string().min(1),
});
export type RunNoteScopeInstant = z.infer<typeof RunNoteScopeInstantSchema>;

/**
 * The `(workflow, date-range)` partition selection — structurally the
 * `EventStreamScope` the reader hands `readScopedEventStreamLines`, restated in
 * `domain` so that a note PRODUCER (which lives above `infra`) can compute the
 * same value without importing the stream reader.
 */
export const RunNotePartitionScopeSchema = z.strictObject({
  workflow: z.string().min(1),
  /** Inclusive `YYYY-MM-DD` lower bound on the partition date. */
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Inclusive `YYYY-MM-DD` upper bound on the partition date. */
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type RunNotePartitionScope = z.infer<typeof RunNotePartitionScopeSchema>;

/**
 * The margin on each end of a run's own activity window, and it is DELIBERATELY
 * asymmetric — the two ends carry different risks.
 *
 * **Below, none is needed.** A note is addressed to a run id, so it cannot have
 * been written before the run existed, and the window's lower end is the OLDEST
 * of the run's instants — its enqueue among them. A partition earlier than that
 * cannot hold a line about this run, so opening one would be reading for the
 * sake of it.
 *
 * **Above, one day.** A worker that writes its last note milliseconds after the
 * transition that closed the run files it on the NEXT day's partition when that
 * transition lands near midnight. One day covers that whole class; it is not a
 * guess at how long a straggler can lag, it is the width of the one boundary
 * the writer's clock and the run's last durable instant can fall either side
 * of. It stays until something durable records which partitions a run wrote —
 * a margin is the honest price of not having that fact, and the alternative is
 * a logs page that silently drops the last thing a run said.
 */
export const NOTE_PARTITION_MARGIN_DAYS_BEFORE = 0;
export const NOTE_PARTITION_MARGIN_DAYS_AFTER = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function instantMs(runId: string, instant: RunNoteScopeInstant): number {
  const parsed = Date.parse(instant.at);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `run ${runId} carries an unreadable ${instant.label} instant ${JSON.stringify(instant.at)}; the notes reader refuses `
      + "to decide which partitions it may skip from a timestamp it cannot read",
    );
  }
  return parsed;
}

/**
 * The durable instants EVERY holder of a run record has — the half a producer
 * computes its scope from, and a strict subset of the reader's set.
 *
 * `createdAt` is the run's enqueue (the same fact the span fold names
 * `run.queued`), so the authority-only window is self-sufficient for a producer
 * that holds no projection.
 */
export function runRecordNoteScopeInstants(authority: RunRecord): readonly RunNoteScopeInstant[] {
  const instants: RunNoteScopeInstant[] = [
    { label: "authority createdAt", at: authority.createdAt },
    { label: "authority updatedAt", at: authority.updatedAt },
  ];
  if (authority.lifecycle.state === "terminal") {
    instants.push({ label: "authority lifecycle endedAt", at: authority.lifecycle.endedAt });
  }
  return instants;
}

/** THE scope function — the reader's partition selection and the producer's admissible window. */
export function runNotePartitionScope(input: {
  readonly runId: string;
  readonly workflow: string;
  readonly instants: readonly RunNoteScopeInstant[];
}): RunNotePartitionScope {
  if (input.instants.length === 0) {
    throw new Error(
      `run ${input.runId} was scoped to its notes partitions from no instants at all; an empty window would report `
      + "the run's own lines as absent",
    );
  }
  const values = z.array(RunNoteScopeInstantSchema).parse(input.instants)
    .map((instant) => instantMs(input.runId, instant));
  return RunNotePartitionScopeSchema.parse({
    workflow: input.workflow,
    fromDate: localDatePart(new Date(Math.min(...values) - NOTE_PARTITION_MARGIN_DAYS_BEFORE * DAY_MS)),
    toDate: localDatePart(new Date(Math.max(...values) + NOTE_PARTITION_MARGIN_DAYS_AFTER * DAY_MS)),
  });
}

/**
 * The producer-side half of the contract: refuse, by name, a note whose
 * append-at-now partition falls outside the window the logs reader would open
 * for this run.
 *
 * `at` is the instant the note WILL be partitioned at — the writer's own
 * `clock.now()`, not the instant a caller would like it to have. Every producer
 * of a run-addressed note calls this before the append; the alternative is a
 * line on disk that the run's own logs tab can never show.
 */
export function assertNoteWithinRunScope(
  authority: RunRecord,
  note: { readonly runId: string; readonly workflow: string; readonly at: Date },
): void {
  if (note.runId !== authority.envelope.runId) {
    throw new Error(
      `refusing to scope a note for run ${note.runId} against run ${authority.envelope.runId}'s authority record: `
      + "the window would be composed from a different run's instants",
    );
  }
  const scope = runNotePartitionScope({
    runId: note.runId,
    workflow: authority.envelope.workflow,
    instants: runRecordNoteScopeInstants(authority),
  });
  if (note.workflow !== scope.workflow) {
    throw new Error(
      `refusing to file a note for run ${note.runId} under workflow ${note.workflow}: the run belongs to `
      + `${scope.workflow}, and the logs reader opens that workflow's partitions alone, so the line would never be served`,
    );
  }
  const day = localDatePart(note.at);
  if (day < scope.fromDate || day > scope.toDate) {
    throw new Error(
      `refusing to file a note for run ${note.runId} at ${note.at.toISOString()}: it would land in the `
      + `${scope.workflow} partition for ${day}, outside the run's own notes scope ${scope.fromDate}..${scope.toDate}, `
      + "so the run's logs tab could never serve it (ref dashboard-surfaces §2.1)",
    );
  }
}
