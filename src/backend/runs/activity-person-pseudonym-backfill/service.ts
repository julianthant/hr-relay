import type { RunRecord } from "../../../domain/run/record.js";
import type { RunId } from "../../../domain/ids.js";
import {
  ActivityPersonPseudonymBackfillReportSchema,
  ActivityPersonPseudonymBackfillRequestSchema,
  type ActivityPersonPseudonymBackfillOutcome,
  type ActivityPersonPseudonymBackfillReport,
} from "../../../domain/trust/activity-person-pseudonym-backfill.js";
import type {
  ActivityPersonPseudonymBackfillWriteCapability,
} from "../../storage/sqlite/authority-database.js";

export interface ActivityPersonPseudonymBackfillAuthority {
  readonly runs: Readonly<{
    get(runId: string): RunRecord | undefined;
    listCurrentByWorkflow(workflow: string): readonly RunRecord[];
  }>;
}

export interface ActivityPersonPseudonymBackfillService {
  backfill(input: unknown): ActivityPersonPseudonymBackfillReport;
}

function missingRun(runId: RunId): ActivityPersonPseudonymBackfillOutcome {
  return { runId, state: "unavailable", reason: "run-not-found" };
}

function mismatchedRun(runId: RunId): ActivityPersonPseudonymBackfillOutcome {
  return { runId, state: "unavailable", reason: "run-identity-mismatch" };
}

export function createActivityPersonPseudonymBackfillService(input: Readonly<{
  authority: ActivityPersonPseudonymBackfillAuthority;
  writeCapability: ActivityPersonPseudonymBackfillWriteCapability;
}>): ActivityPersonPseudonymBackfillService {
  return Object.freeze({
    backfill: (requestInput: unknown): ActivityPersonPseudonymBackfillReport => {
      const request = ActivityPersonPseudonymBackfillRequestSchema.parse(requestInput);
      const targets = request.scope === "current-separations"
        ? input.authority.runs.listCurrentByWorkflow("separations").map((run) => ({
          requestedRunId: run.envelope.runId,
          run,
        }))
        : request.runIds.map((requestedRunId) => ({
          requestedRunId,
          run: input.authority.runs.get(requestedRunId),
        }));
      const prepared: readonly (
        | Readonly<{ kind: "unavailable"; outcome: ActivityPersonPseudonymBackfillOutcome }>
        | Readonly<{ kind: "review"; runId: RunId }>
      )[] = targets.map(({ requestedRunId, run }) => {
        if (run === undefined) return { kind: "unavailable", outcome: missingRun(requestedRunId) };
        if (run.envelope.runId !== requestedRunId) {
          return { kind: "unavailable", outcome: mismatchedRun(requestedRunId) };
        }
        return { kind: "review", runId: run.envelope.runId };
      });
      const reviewedRunIds = prepared.flatMap((target) =>
        target.kind === "review" ? [target.runId] : []);
      const reviewed = reviewedRunIds.length === 0
        ? []
        : input.writeCapability.reviewAndInsert(reviewedRunIds);
      if (reviewed.length !== reviewedRunIds.length) {
        throw new Error(
          `activity person pseudonym batch returned ${String(reviewed.length)} outcomes for `
          + `${String(reviewedRunIds.length)} reviewed runs`,
        );
      }
      let reviewedIndex = 0;
      const outcomes = Object.freeze(prepared.map((target) => {
        if (target.kind === "unavailable") return target.outcome;
        const outcome = reviewed[reviewedIndex];
        reviewedIndex += 1;
        if (outcome === undefined || outcome.runId !== target.runId) {
          throw new Error(`activity person pseudonym batch returned a foreign outcome for run ${target.runId}`);
        }
        return outcome;
      }));
      return Object.freeze(ActivityPersonPseudonymBackfillReportSchema.parse({
        scope: request.scope,
        keyGeneration: input.writeCapability.keyGeneration,
        outcomes,
        counts: {
          examined: outcomes.length,
          inserted: outcomes.filter(({ state }) => state === "inserted").length,
          existing: outcomes.filter(({ state }) => state === "existing").length,
          unavailable: outcomes.filter(({ state }) => state === "unavailable").length,
        },
      }));
    },
  });
}
