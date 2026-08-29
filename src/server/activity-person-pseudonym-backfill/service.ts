import type { RunRecord } from "../../domain/run/record.js";
import type { RunResultRecord } from "../../domain/run/result.js";
import { deriveSchemaHash } from "../../domain/schema-bound-value.js";
import type {
  ActivityPersonPseudonymDomain,
  ActivityPersonPseudonymEvidence,
} from "../../domain/trust/activity-person-pseudonym.js";
import {
  ActivityPersonPseudonymBackfillReportSchema,
  ActivityPersonPseudonymBackfillRequestSchema,
  type ActivityPersonPseudonymBackfillOutcome,
  type ActivityPersonPseudonymBackfillReport,
} from "../../domain/trust/activity-person-pseudonym-backfill.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";
import { SeparationsResultSchema } from "../../workflows/separations/descriptor.js";

export interface ActivityPersonPseudonymBackfillAuthority {
  readonly runs: Readonly<{
    get(runId: string): RunRecord | undefined;
    listByWorkflow(workflow: string): readonly RunRecord[];
  }>;
  readonly runResults: Readonly<{
    get(runId: string): RunResultRecord | undefined;
  }>;
  readonly activityPersonPseudonyms: Pick<
    AuthorityRepositories["activityPersonPseudonyms"],
    "insert"
  >;
}

export interface ActivityPersonPseudonymBackfillService {
  backfill(input: unknown): ActivityPersonPseudonymBackfillReport;
}

const CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH = deriveSchemaHash(SeparationsResultSchema, "output");

function backfillRun(
  run: RunRecord,
  authority: ActivityPersonPseudonymBackfillAuthority,
  pseudonyms: ActivityPersonPseudonymDomain,
): ActivityPersonPseudonymBackfillOutcome {
  if (run.envelope.workflow !== "separations") {
    return { runId: run.envelope.runId, state: "unavailable", reason: "workflow-not-separations" };
  }
  if (run.lifecycle.state !== "terminal") {
    return { runId: run.envelope.runId, state: "unavailable", reason: "run-not-terminal" };
  }
  if (run.lifecycle.outcome !== "done") {
    return { runId: run.envelope.runId, state: "unavailable", reason: "terminal-outcome-not-done" };
  }
  const result = authority.runResults.get(run.envelope.runId);
  if (result === undefined) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "run-result-missing" };
  }
  if (result.runId !== run.envelope.runId || result.workflowId !== run.envelope.workflow) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "run-result-identity-mismatch" };
  }
  if (result.resultSchemaHash !== CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH
    || result.result.schemaHash !== CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "result-schema-not-current" };
  }
  const parsed = SeparationsResultSchema.safeParse(result.result.value);
  if (!parsed.success) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "canonical-subject-malformed" };
  }
  const evidence: ActivityPersonPseudonymEvidence = pseudonyms.deriveEvidence({
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    canonicalSubject: parsed.data.approved.emplId,
  });
  const inserted = authority.activityPersonPseudonyms.insert(evidence);
  return {
    runId: run.envelope.runId,
    state: inserted.state,
    keyGeneration: pseudonyms.keyGeneration,
  };
}

export function createActivityPersonPseudonymBackfillService(input: Readonly<{
  authority: ActivityPersonPseudonymBackfillAuthority;
  pseudonyms: ActivityPersonPseudonymDomain;
}>): ActivityPersonPseudonymBackfillService {
  return Object.freeze({
    backfill: (requestInput: unknown): ActivityPersonPseudonymBackfillReport => {
      const request = ActivityPersonPseudonymBackfillRequestSchema.parse(requestInput);
      const runs = input.authority.runs.listByWorkflow("separations");
      const outcomes = Object.freeze(runs.map((run) => backfillRun(run, input.authority, input.pseudonyms)));
      return Object.freeze(ActivityPersonPseudonymBackfillReportSchema.parse({
        scope: request.scope,
        keyGeneration: input.pseudonyms.keyGeneration,
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
