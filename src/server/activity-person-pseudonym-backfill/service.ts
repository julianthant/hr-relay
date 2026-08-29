import type { RunRecord } from "../../domain/run/record.js";
import type { RunId } from "../../domain/ids.js";
import {
  ActivityPersonPseudonymBackfillReportSchema,
  ActivityPersonPseudonymBackfillRequestSchema,
  type ActivityPersonPseudonymBackfillOutcome,
  type ActivityPersonPseudonymBackfillReport,
} from "../../domain/trust/activity-person-pseudonym-backfill.js";
import type {
  ActivityPersonPseudonymBackfillWriteCapability,
} from "../../infra/sqlite/authority-database.js";

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
      const outcomes = Object.freeze(targets.flatMap(({ requestedRunId, run }) => {
        if (run === undefined) return [missingRun(requestedRunId)];
        if (run.envelope.runId !== requestedRunId) return [mismatchedRun(requestedRunId)];
        return input.writeCapability.reviewAndInsert([run.envelope.runId]);
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
