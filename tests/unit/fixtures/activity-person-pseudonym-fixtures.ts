import { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import {
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
  RunResultRecordSchema,
  type RunResultRecord,
} from "../../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import {
  SeparationsResultSchema,
  separationsDescriptor,
} from "../../../src/workflows/separations/descriptor.js";
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
} from "./separations-composition-fixtures.js";

export const ACTIVITY_PERSON_PSEUDONYM_KEY_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

export const TERMINAL_SEPARATIONS_RUN = RunRecordSchema.parse({
  ...compositionQueuedRun(),
  lifecycle: { state: "terminal", outcome: "done", endedAt: COMPOSITION_NOW },
  version: 2,
  updatedAt: COMPOSITION_NOW,
});

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
  const queued = RunRecordSchema.parse({
    ...run,
    lifecycle: baseline.lifecycle,
    version: baseline.version,
    updatedAt: baseline.updatedAt,
  });
  database.authority.runs.enqueue(queued);
  const raw = new DatabaseSync(path);
  try {
    raw.prepare(`
      UPDATE tasks SET state = ?, version = ?, record_json = ? WHERE record_key = ?
    `).run("terminal", run.version, canonicalJsonStringify(run), run.envelope.runId);
    if (result !== undefined) {
      raw.prepare(`
        INSERT INTO run_results
          (record_key, workflow, attempt, result_digest, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        result.runId,
        result.workflowId,
        result.attempt,
        result.resultDigest,
        canonicalJsonStringify(result),
        result.createdAt,
      );
    }
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
