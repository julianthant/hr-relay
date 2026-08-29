import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, RunResultRecordSchema } from "../../src/domain/run/result.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { createActivityPersonPseudonymBackfillService } from "../../src/server/activity-person-pseudonym-backfill/service.js";
import { SeparationsResultSchema, separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
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
} from "./fixtures/separations-composition-fixtures.js";

const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

const TERMINAL_RUN = RunRecordSchema.parse({
  ...compositionQueuedRun(),
  lifecycle: { state: "terminal", outcome: "done", endedAt: COMPOSITION_NOW },
  version: 2,
  updatedAt: COMPOSITION_NOW,
});

const SEPARATIONS_RESULT = SeparationsResultSchema.parse({
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

const RESULT_SCHEMA_HASH = deriveSchemaHash(SeparationsResultSchema, "output");
const RESULT_RECORD = RunResultRecordSchema.parse({
  runId: TERMINAL_RUN.envelope.runId,
  attempt: TERMINAL_RUN.envelope.attempt,
  workflowId: TERMINAL_RUN.envelope.workflow,
  descriptorVersion: TERMINAL_RUN.envelope.descriptorVersion,
  contractFingerprint: separationsDescriptor.contractFingerprint,
  configFingerprint: TERMINAL_RUN.envelope.configFingerprint,
  configSnapshotId: TERMINAL_RUN.envelope.configSnapshotId,
  resultSchemaHash: RESULT_SCHEMA_HASH,
  result: { schemaHash: RESULT_SCHEMA_HASH, value: SEPARATIONS_RESULT },
  resultDigest: deriveRunResultDigest({ schemaHash: RESULT_SCHEMA_HASH, value: SEPARATIONS_RESULT }),
  dependencies: [],
  dependencyDigest: deriveTerminalDependencyDigest([]),
  createdAt: COMPOSITION_NOW,
});

function resultWith(value: unknown) {
  const result = { schemaHash: RESULT_SCHEMA_HASH, value };
  return RunResultRecordSchema.parse({
    ...RESULT_RECORD,
    result,
    resultDigest: deriveRunResultDigest(result),
  });
}

describe("reviewed activity person pseudonym backfill", () => {
  it("writes one generation-bound row from the terminal Separations approved subject", () => {
    const inserted: unknown[] = [];
    const service = createActivityPersonPseudonymBackfillService({
      authority: {
        runs: {
          get: () => TERMINAL_RUN,
          listByWorkflow: () => [TERMINAL_RUN],
        },
        runResults: { get: () => RESULT_RECORD },
        activityPersonPseudonyms: {
          insert: (record: unknown) => {
            inserted.push(record);
            return { state: "inserted", record } as never;
          },
        },
      },
      pseudonyms: createActivityPersonPseudonymDomain({
        keyGeneration: "activity-person-g1",
        keyHex: KEY_HEX,
      }),
    });

    const report = service.backfill({ scope: "current-separations" });

    assert.deepEqual(report, {
      scope: "current-separations",
      keyGeneration: "activity-person-g1",
      outcomes: [{
        runId: TERMINAL_RUN.envelope.runId,
        state: "inserted",
        keyGeneration: "activity-person-g1",
      }],
      counts: { examined: 1, inserted: 1, existing: 0, unavailable: 0 },
    });
    assert.deepEqual(inserted, [{
      runId: TERMINAL_RUN.envelope.runId,
      workflowId: "separations",
      keyGeneration: "activity-person-g1",
      pseudonym: "9e816075dee5a4a267b40f1505c09762a63eb2909aa42789a72790d6916e5d8a",
      derivation: "hmac-sha-256/activity-person/v1",
    }]);
  });

  it("returns named unavailable evidence and writes nothing for every unreviewed binding shape", () => {
    const queued = RunRecordSchema.parse(compositionQueuedRun());
    const failed = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      lifecycle: {
        state: "terminal",
        outcome: "failed",
        endedAt: COMPOSITION_NOW,
        failureId: "66666666-6666-4666-8666-666666666666",
        errorSummary: "safe fixture failure",
      },
    });
    const foreign = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      envelope: { ...TERMINAL_RUN.envelope, workflow: "person-lookup" },
    });
    const missingSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: {
        chosenFrom: SEPARATIONS_RESULT.approved.chosenFrom,
        evidenceDigest: SEPARATIONS_RESULT.approved.evidenceDigest,
        ucpathName: SEPARATIONS_RESULT.approved.ucpathName,
        nameTier: SEPARATIONS_RESULT.approved.nameTier,
        approvalShape: SEPARATIONS_RESULT.approved.approvalShape,
      },
    });
    const malformedSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: { ...SEPARATIONS_RESULT.approved, emplId: "not-an-eid" },
    });
    const ambiguousSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: { ...SEPARATIONS_RESULT.approved, emplId: ["10800000", "10800001"] },
    });
    const cases = [
      { name: "missing run", run: undefined, result: undefined, reason: "run-not-found" },
      { name: "foreign workflow", run: foreign, result: RESULT_RECORD, reason: "workflow-not-separations" },
      { name: "nonterminal run", run: queued, result: RESULT_RECORD, reason: "run-not-terminal" },
      { name: "non-done terminal run", run: failed, result: undefined, reason: "terminal-outcome-not-done" },
      { name: "missing result", run: TERMINAL_RUN, result: undefined, reason: "run-result-missing" },
      { name: "missing binding", run: TERMINAL_RUN, result: missingSubject, reason: "canonical-subject-missing" },
      { name: "malformed binding", run: TERMINAL_RUN, result: malformedSubject, reason: "canonical-subject-malformed" },
      { name: "ambiguous binding", run: TERMINAL_RUN, result: ambiguousSubject, reason: "canonical-subject-ambiguous" },
    ] as const;

    for (const fixture of cases) {
      let writes = 0;
      const service = createActivityPersonPseudonymBackfillService({
        authority: {
          runs: {
            get: () => fixture.run,
            listByWorkflow: () => [],
          },
          runResults: { get: () => fixture.result },
          activityPersonPseudonyms: {
            insert: () => {
              writes += 1;
              throw new Error(`${fixture.name} reached pseudonym persistence`);
            },
          },
        },
        pseudonyms: createActivityPersonPseudonymDomain({
          keyGeneration: "activity-person-g1",
          keyHex: KEY_HEX,
        }),
      });

      const report = service.backfill({
        scope: "selected-runs",
        runIds: [TERMINAL_RUN.envelope.runId],
      });

      assert.deepEqual(report.outcomes, [{
        runId: TERMINAL_RUN.envelope.runId,
        state: "unavailable",
        reason: fixture.reason,
      }], fixture.name);
      assert.deepEqual(report.counts, {
        examined: 1,
        inserted: 0,
        existing: 0,
        unavailable: 1,
      }, fixture.name);
      assert.equal(writes, 0, fixture.name);
    }
  });
});
