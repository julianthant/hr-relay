import type { RunRecord } from "../../domain/run/record.js";
import type { RunResultRecord } from "../../domain/run/result.js";
import { EidSchema, type RunId } from "../../domain/ids.js";
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
  runId: RunId,
  run: RunRecord | undefined,
  authority: ActivityPersonPseudonymBackfillAuthority,
  pseudonyms: ActivityPersonPseudonymDomain,
): ActivityPersonPseudonymBackfillOutcome {
  if (run === undefined) {
    return { runId, state: "unavailable", reason: "run-not-found" };
  }
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
  if (result.runId !== run.envelope.runId
    || result.workflowId !== run.envelope.workflow
    || result.attempt !== run.envelope.attempt
    || result.descriptorVersion !== run.envelope.descriptorVersion
    || result.contractFingerprint !== run.envelope.contractFingerprint
    || result.configFingerprint !== run.envelope.configFingerprint
    || result.configSnapshotId !== run.envelope.configSnapshotId) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "run-result-identity-mismatch" };
  }
  if (result.resultSchemaHash !== CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH
    || result.result.schemaHash !== CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "result-schema-not-current" };
  }
  const approved = objectProperty(result.result.value, "approved");
  if (approved === undefined || approved === null) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "canonical-subject-missing" };
  }
  if (Array.isArray(approved)) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "canonical-subject-ambiguous" };
  }
  const canonicalSubject = objectProperty(approved, "emplId");
  if (canonicalSubject === undefined || canonicalSubject === null) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "canonical-subject-missing" };
  }
  if (Array.isArray(canonicalSubject)) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "canonical-subject-ambiguous" };
  }
  if (!EidSchema.safeParse(canonicalSubject).success) {
    return { runId: run.envelope.runId, state: "unavailable", reason: "canonical-subject-malformed" };
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

function objectProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

export function createActivityPersonPseudonymBackfillService(input: Readonly<{
  authority: ActivityPersonPseudonymBackfillAuthority;
  pseudonyms: ActivityPersonPseudonymDomain;
}>): ActivityPersonPseudonymBackfillService {
  return Object.freeze({
    backfill: (requestInput: unknown): ActivityPersonPseudonymBackfillReport => {
      const request = ActivityPersonPseudonymBackfillRequestSchema.parse(requestInput);
      const targets = request.scope === "current-separations"
        ? input.authority.runs.listByWorkflow("separations").map((run) => ({
          runId: run.envelope.runId,
          run,
        }))
        : request.runIds.map((runId) => ({ runId, run: input.authority.runs.get(runId) }));
      const outcomes = Object.freeze(targets.map(({ runId, run }) =>
        backfillRun(runId, run, input.authority, input.pseudonyms)));
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
