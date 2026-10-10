import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { ucpathPendingTransactionSetDigest } from "../../../../src/models/systems/ucpath/delete-pending-terminations.js";
import { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import {
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
  RunResultRecordSchema,
  type RunResultRecord,
} from "../../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { SeparationsResultSchema } from "../../../../src/workflows/separations/workflow.js";
import {
  COMPOSITION_ACTION_ID,
  COMPOSITION_DEPARTMENT_OPTION,
  COMPOSITION_DOCUMENT,
  COMPOSITION_EFFECTIVE_DATE,
  COMPOSITION_EID,
  COMPOSITION_FINALIZATION_FIELDS,
  COMPOSITION_KUALI_LDW,
  COMPOSITION_LAST_DAY_WORKED,
  COMPOSITION_NOW,
  COMPOSITION_RECEIPT,
  COMPOSITION_SCOPE_OUTPUTS,
  COMPOSITION_SEPARATION_DATE,
  COMPOSITION_UCPATH_NAME,
  compositionQueuedRun,
} from "../../helpers/separations-composition-fixtures.js";
import { separationsDescriptor } from "../../helpers/registered-workflows.js";

export const ACTIVITY_PERSON_PSEUDONYM_KEY_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";


export const CURRENT_SEPARATIONS_RESULT = SeparationsResultSchema.parse({
  documentNumber: COMPOSITION_DOCUMENT,
  approved: COMPOSITION_SCOPE_OUTPUTS.approval.approved,
  employment: {
    emplRecord: COMPOSITION_SCOPE_OUTPUTS.employment.emplRecord,
    payrollTitleCode: COMPOSITION_SCOPE_OUTPUTS.employment.payrollTitleCode,
    payrollTitle: COMPOSITION_SCOPE_OUTPUTS.employment.payrollTitle,
  },
  department: {
    option: COMPOSITION_DEPARTMENT_OPTION,
    departmentCode: COMPOSITION_SCOPE_OUTPUTS["department-option"].departmentCode,
  },
  dates: {
    kualiLastDayWorked: COMPOSITION_KUALI_LDW,
    lastDayWorked: COMPOSITION_LAST_DAY_WORKED,
    kualiSeparationDate: COMPOSITION_KUALI_LDW,
    separationDate: COMPOSITION_SEPARATION_DATE,
    terminationEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
    lastDayWorkedChanged: false,
    separationDateChanged: true,
  },
  pendingSweep: {
    disposition: "committed",
    proof: {
      kind: "ucpath-pending-terminations-clear",
      emplId: COMPOSITION_EID,
      scannedRowCount: 0,
      observedAt: COMPOSITION_NOW,
      source: "ss-smart-hr-detail-read",
      version: 2,
      selectedTransactionIds: "none",
      protectedTransactionIds: "none",
      setDigest: ucpathPendingTransactionSetDigest({kind:"ucpath-pending-termination-set",emplId:COMPOSITION_EID,eligible:[],protected:[],source:"ss-smart-hr-detail-read",observedAt:IsoInstantSchema.parse(COMPOSITION_NOW)}),
    },
  },
  termination: {
    transactionNumber: COMPOSITION_RECEIPT,
    approvalStatus: "Pending",
    effectiveDate: COMPOSITION_EFFECTIVE_DATE,
    emplId: COMPOSITION_EID,
    displayedName: COMPOSITION_UCPATH_NAME,
    disposition: "committed",
  },
  finalization: {
    disposition: "committed",
    proof: {
      kind: "kuali-saved-finalization",
      actionId: COMPOSITION_ACTION_ID,
      documentNumber: COMPOSITION_DOCUMENT,
      observedEid: COMPOSITION_EID,
      fields: COMPOSITION_FINALIZATION_FIELDS,
      source: "reload-read-back",
    },
  },
});

export const CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH = deriveSchemaHash(
  SeparationsResultSchema,
  "output",
);

export const TERMINAL_SEPARATIONS_RUN = RunRecordSchema.parse({
  ...compositionQueuedRun(),
  lifecycle: { state: "terminal", outcome: "done", endedAt: COMPOSITION_NOW },
  version: 2, claimGeneration: 1,
  completion: { schemaVersion: 1, kind: "done", expectedVersion: 1,
    claim: { workerId: "fixture-worker", claimGeneration: 1 }, authorizedAt: COMPOSITION_NOW,
    resultDigest: deriveRunResultDigest({ schemaHash: CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH, value: CURRENT_SEPARATIONS_RESULT }) },
  updatedAt: COMPOSITION_NOW,
});

export function activityPersonPseudonymResultRecord(
  run: RunRecord = TERMINAL_SEPARATIONS_RUN,
  value: unknown = CURRENT_SEPARATIONS_RESULT,
): RunResultRecord {
  const result = { schemaHash: CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH, value };
  return RunResultRecordSchema.parse({
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    workflowId: run.envelope.workflow,
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
    resultSchemaHash: CURRENT_SEPARATIONS_RESULT_SCHEMA_HASH,
    result,
    resultDigest: deriveRunResultDigest(result),
    dependencies: [],
    dependencyDigest: deriveTerminalDependencyDigest([]),
    createdAt: COMPOSITION_NOW,
  });
}

export const TERMINAL_SEPARATIONS_RESULT = activityPersonPseudonymResultRecord();

export function seedSeparationsRunAuthority(
  database: AuthorityDatabase,
  path: string,
  run: RunRecord,
  result: RunResultRecord | undefined,
): void {
  const baseline = compositionQueuedRun();
  const { completion: _completion, ...unsettled } = run;
  const queued = RunRecordSchema.parse({
    ...unsettled,
    lifecycle: baseline.lifecycle,
    claimGeneration: 0,
    version: baseline.version,
    updatedAt: run.envelope.enqueuedAt,
  });
  database.authority.runs.enqueue(queued);
  const raw = new DatabaseSync(path);
  const triggerNames = ["runs_completion_immutable", "runs_completion_update"];
  const triggers = triggerNames.map(name => {
    const sql = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)?.sql;
    if (typeof sql !== "string") throw new Error(`fixture completion trigger missing: ${name}`);
    return { name, sql };
  });
  try {
    const search = createRunSearchIndex(raw);
    search.installTracking();
    raw.exec("BEGIN IMMEDIATE");
    for (const trigger of triggers) raw.exec(`DROP TRIGGER ${trigger.name}`);
    const row = runRecordColumns(run);
    const keys = Object.keys(row).filter(key => key !== "id");
    raw.prepare(`UPDATE runs SET ${keys.map(key => `${key}=?`).join(",")} WHERE id=?`)
      .run(...keys.map(key => row[key as keyof typeof row]), run.envelope.runId);
    if (result !== undefined) raw.prepare(`INSERT INTO run_results
      (run_id,workflow,attempt,result_digest,payload_json,created_at) VALUES (?,?,?,?,?,?)`)
      .run(result.runId, result.workflowId, result.attempt, result.resultDigest,
        canonicalJsonStringify(result), result.createdAt);
    for (const trigger of triggers) raw.exec(trigger.sql);
    let publication = search.rebuild({ restart: true, limit: 500 }, database.getMeta().authorityGeneration, run.updatedAt);
    while (publication.state === "building") publication = search.rebuild({ restart: false, limit: 500 }, database.getMeta().authorityGeneration, run.updatedAt);
    raw.exec("COMMIT");
  } catch (error) {
    if (raw.isTransaction) raw.exec("ROLLBACK");
    throw error;
  } finally {
    raw.close();
  }
}

export function seedTerminalSeparationsResult(
  database: AuthorityDatabase,
  path: string,
  run: RunRecord = TERMINAL_SEPARATIONS_RUN,
  result: RunResultRecord = activityPersonPseudonymResultRecord(run),
): void {
  seedSeparationsRunAuthority(database, path, run, result);
}

export function assertCurrentSeparationsFixtureContract(): void {
  if (TERMINAL_SEPARATIONS_RUN.envelope.contractFingerprint
    !== separationsDescriptor.contractFingerprint) {
    throw new Error("pseudonym fixture drifted from the current Separations descriptor");
  }
}
