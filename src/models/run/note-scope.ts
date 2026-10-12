/** The `notes/` partitions one run's log lines may occupy: structural scope arithmetic that keeps a note the reader would never open from being written. */
import { z } from "zod";
import { localDatePart } from "../../rules/time/clock.js";
import type { RunRecord } from "./record.js";

/** One durable instant the window is composed from, with the name of the fact it is. */
export const RunNoteScopeInstantSchema = z.strictObject({
  label: z.string().min(1),
  /** An ISO instant — refused by name when it cannot be parsed. */
  at: z.string().min(1),
});
export type RunNoteScopeInstant = z.infer<typeof RunNoteScopeInstantSchema>;

/** The `(workflow, date-range)` partition selection, restated so a note producer can compute it without importing the stream reader. */
export const RunNotePartitionScopeSchema = z.strictObject({
  workflow: z.string().min(1),
  /** Inclusive `YYYY-MM-DD` lower bound on the partition date. */
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Inclusive `YYYY-MM-DD` upper bound on the partition date. */
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type RunNotePartitionScope = z.infer<typeof RunNotePartitionScopeSchema>;

/** The margin on each end of a run's activity window, deliberately asymmetric: none below, one day above the last durable instant. */
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

/** The durable instants every holder of a run record has — the half a producer computes its scope from. */
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

/** The producer-side half: refuse, by name, a note whose append-at-now partition falls outside the window the reader would open. */
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
      + "so the run's logs tab could never serve it (ref dashboard-surfaces)",
    );
  }
}
