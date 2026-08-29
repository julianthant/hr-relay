import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { defineRuntimeIsolation } from "../../src/config/define-runtime-isolation.js";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, RunResultRecordSchema } from "../../src/domain/run/result.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { createActivityPersonPseudonymBackfillService } from "../../src/server/activity-person-pseudonym-backfill/service.js";
import { composeActivityPersonPseudonymBackfillCommand } from "../../src/server/activity-person-pseudonym-backfill/compose.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
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

  it("persists only the approved-subject HMAC evidence and returns no identifier or key material", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-backfill-"));
    const path = join(root, "authority.sqlite");
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-backfill-test" },
      manualClock(new Date(COMPOSITION_NOW)),
    );
    try {
      database.authority.runs.enqueue(compositionQueuedRun());
      const alternateSourceResult = resultWith({
        ...SEPARATIONS_RESULT,
        termination: { ...SEPARATIONS_RESULT.termination, emplId: "10800001" },
        finalization: {
          ...SEPARATIONS_RESULT.finalization,
          proof: { ...SEPARATIONS_RESULT.finalization.proof, observedEid: "10800002" },
        },
      });
      const service = createActivityPersonPseudonymBackfillService({
        authority: {
          runs: {
            get: () => TERMINAL_RUN,
            listByWorkflow: () => [TERMINAL_RUN],
          },
          runResults: { get: () => alternateSourceResult },
          activityPersonPseudonyms: database.authority.activityPersonPseudonyms,
        },
        pseudonyms: createActivityPersonPseudonymDomain({
          keyGeneration: "activity-person-g1",
          keyHex: KEY_HEX,
        }),
      });

      const report = service.backfill({ scope: "current-separations" });
      const stored = database.authority.activityPersonPseudonyms.get(
        TERMINAL_RUN.envelope.runId,
        "activity-person-g1",
      );

      assert.equal(stored?.pseudonym, "9e816075dee5a4a267b40f1505c09762a63eb2909aa42789a72790d6916e5d8a");
      assert.notEqual(
        stored?.pseudonym,
        createHash("sha256").update(COMPOSITION_EID).digest("hex"),
        "an unkeyed identifier digest is not pseudonym evidence",
      );
      const publicOutput = JSON.stringify(report);
      for (const secretValue of [COMPOSITION_EID, "10800001", "10800002", KEY_HEX]) {
        assert.equal(publicOutput.includes(secretValue), false);
      }
    } finally {
      database.close();
    }

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = raw.prepare("PRAGMA table_info(activity_person_pseudonyms)").all()
        .map((column) => {
          if (typeof column !== "object" || column === null) {
            throw new Error("pseudonym table_info row is not an object");
          }
          const name = Reflect.get(column, "name");
          if (typeof name !== "string") throw new Error("pseudonym table_info row has no name");
          return name;
        });
      const rows = raw.prepare("SELECT * FROM activity_person_pseudonyms").all();
      assert.deepEqual(columns, [
        "record_key",
        "run_id",
        "workflow",
        "key_generation",
        "pseudonym",
        "derivation",
        "record_json",
        "created_at",
      ]);
      const persisted = JSON.stringify(rows);
      for (const secretValue of [COMPOSITION_EID, "10800001", "10800002", KEY_HEX]) {
        assert.equal(persisted.includes(secretValue), false);
      }
    } finally {
      raw.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("composes one explicit selected-run backfill command against the isolated authority", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-command-"));
    const stateRoot = ".tracker-rebuild";
    const path = join(root, stateRoot, "state.db");
    const isolation = defineRuntimeIsolation({
      stateRoot,
      artifactRoot: ".tracker-rebuild/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      processLockRoot: ".tracker-rebuild/locks",
      browserProfileRoot: ".auth",
      browserSessionNamespace: "hrauto-rebuild",
    });
    mkdirSync(join(root, stateRoot), { recursive: true });
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-command-test" },
      manualClock(new Date(COMPOSITION_NOW)),
    );
    database.close();
    try {
      const outcome = composeActivityPersonPseudonymBackfillCommand({
        isolation,
        args: ["backfill", "--run", TERMINAL_RUN.envelope.runId, "--json"],
        repoRoot: root,
        clock: manualClock(new Date(COMPOSITION_NOW)),
        pseudonyms: createActivityPersonPseudonymDomain({
          keyGeneration: "activity-person-g1",
          keyHex: KEY_HEX,
        }),
      });

      assert.equal(outcome.exitCode, 1);
      assert.deepEqual(JSON.parse(outcome.output), {
        scope: "selected-runs",
        keyGeneration: "activity-person-g1",
        outcomes: [{
          runId: TERMINAL_RUN.envelope.runId,
          state: "unavailable",
          reason: "run-not-found",
        }],
        counts: { examined: 1, inserted: 0, existing: 0, unavailable: 1 },
      });
      assert.equal(outcome.output.includes(KEY_HEX), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
