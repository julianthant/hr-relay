import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { defineRuntimeIsolation } from "../../src/config/define-runtime-isolation.js";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, RunResultRecordSchema } from "../../src/domain/run/result.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { journalProtectedSettings } from "./helpers/journaled-protected-settings.js";
import { settingsRootPaths } from "../../src/domain/config/settings-root.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { createActivityPersonPseudonymBackfillService } from "../../src/server/activity-person-pseudonym-backfill/service.js";
import { composeActivityPersonPseudonymBackfillCommand } from "../../src/server/activity-person-pseudonym-backfill/compose.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { createProtectedSettingsFileAuthority } from "../../src/infra/config/settings-file.js";
import { SeparationsResultSchema } from "../../src/workflows/separations/workflow.js";
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
import {
  activityPersonPseudonymResultRecord,
  seedSeparationsRunAuthority,
  seedTerminalSeparationsResult,
} from "./fixtures/activity-person-pseudonym-fixtures.js";
import { separationsDescriptor } from "../helpers/registered-workflows.js";

const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const TEST_PSEUDONYM_DOMAIN = createActivityPersonPseudonymDomain({
  keyGeneration: "activity-person-g1",
  keyHex: KEY_HEX,
});

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
    const reviewed: unknown[] = [];
    const service = createActivityPersonPseudonymBackfillService({
      authority: {
        runs: {
          get: () => TERMINAL_RUN,
          listCurrentByWorkflow: () => [TERMINAL_RUN],
        },
      },
      writeCapability: {
        keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
        reviewAndInsert: (runIds: unknown) => {
          reviewed.push(runIds);
          return [{
            runId: TERMINAL_RUN.envelope.runId,
            state: "inserted",
            keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
          }];
        },
      },
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
    assert.deepEqual(reviewed, [[TERMINAL_RUN.envelope.runId]]);
  });

  it("refuses a selected-run lookup that returns a different run identity", () => {
    const foreignRun = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      envelope: {
        ...TERMINAL_RUN.envelope,
        runId: "99999999-9999-4999-8999-999999999999",
        traceId: "sp-200000-9999",
      },
    });
    let reviewed = 0;
    const service = createActivityPersonPseudonymBackfillService({
      authority: {
        runs: {
          get: () => foreignRun,
          listCurrentByWorkflow: () => [],
        },
      },
      writeCapability: {
        keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
        reviewAndInsert: () => {
          reviewed += 1;
          return [{
            runId: foreignRun.envelope.runId,
            state: "inserted",
            keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
          }];
        },
      },
    });

    const report = service.backfill({
      scope: "selected-runs",
      runIds: [TERMINAL_RUN.envelope.runId],
    });

    assert.deepEqual(report.outcomes, [{
      runId: TERMINAL_RUN.envelope.runId,
      state: "unavailable",
      reason: "run-identity-mismatch",
    }]);
    assert.equal(reviewed, 0);
  });

  it("uses only the strict non-archived current Separations corpus", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-current-corpus-"));
    const path = join(root, "authority.sqlite");
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-current-corpus-test" },
      manualClock(new Date(COMPOSITION_NOW)),
    );
    try {
      seedTerminalSeparationsResult(database, path);
      const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
      try {
        raw.prepare(`
          INSERT INTO archived_runs
            (record_key, application_id, workflow, descriptor_version, contract_fingerprint,
             app_version, content_digest, record_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          TERMINAL_RUN.envelope.runId,
          "88888888-8888-4888-8888-888888888888",
          "separations",
          TERMINAL_RUN.envelope.descriptorVersion,
          TERMINAL_RUN.envelope.contractFingerprint,
          null,
          "a".repeat(64),
          "{}",
          COMPOSITION_NOW,
        );
      } finally {
        raw.close();
      }
      let reviewed = 0;
      const service = createActivityPersonPseudonymBackfillService({
        authority: database.authority,
        writeCapability: {
          keyGeneration: TEST_PSEUDONYM_DOMAIN.keyGeneration,
          reviewAndInsert: () => {
            reviewed += 1;
            return [];
          },
        },
      });

      const report = service.backfill({ scope: "current-separations" });

      assert.deepEqual(report, {
        scope: "current-separations",
        keyGeneration: "activity-person-g1",
        outcomes: [],
        counts: { examined: 0, inserted: 0, existing: 0, unavailable: 0 },
      });
      assert.equal(reviewed, 0);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rolls back every new row when the batch key differs from durable generation authority", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-batch-rollback-"));
    const path = join(root, "authority.sqlite");
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-batch-rollback-test" },
      manualClock(new Date(COMPOSITION_NOW)),
    );
    const secondRun = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      envelope: {
        ...TERMINAL_RUN.envelope,
        runId: "33333333-3333-4333-8333-333333333333",
        itemId: "44444444-4444-4444-8444-444444444444",
        traceId: "sp-100001-3333",
      },
    });
    try {
      seedTerminalSeparationsResult(database, path);
      seedTerminalSeparationsResult(
        database,
        path,
        secondRun,
        activityPersonPseudonymResultRecord(secondRun),
      );
      database.createActivityPersonPseudonymBackfillWriteCapability(TEST_PSEUDONYM_DOMAIN)
        .reviewAndInsert([secondRun.envelope.runId]);
      const existing = database.authority.activityPersonPseudonyms.get(
        secondRun.envelope.runId,
        TEST_PSEUDONYM_DOMAIN.keyGeneration,
      );
      const generationBefore = database.getMeta().authorityGeneration;
      const divergentDomain = createActivityPersonPseudonymDomain({
        keyGeneration: "activity-person-g1",
        keyHex: "ff".repeat(32),
      });
      const service = createActivityPersonPseudonymBackfillService({
        authority: database.authority,
        writeCapability: database.createActivityPersonPseudonymBackfillWriteCapability(
          divergentDomain,
        ),
      });

      assert.throws(
        () => service.backfill({
          scope: "selected-runs",
          runIds: [TERMINAL_RUN.envelope.runId, secondRun.envelope.runId],
        }),
        /generation activity-person-g1 is already bound to different key material/u,
      );
      assert.equal(database.authority.activityPersonPseudonyms.get(
        TERMINAL_RUN.envelope.runId,
        divergentDomain.keyGeneration,
      ), undefined);
      assert.deepEqual(database.authority.activityPersonPseudonyms.get(
        secondRun.envelope.runId,
        divergentDomain.keyGeneration,
      ), existing);
      assert.equal(database.getMeta().authorityGeneration, generationBefore);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists a multi-run generation through one bounded authority transaction", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-bounded-batch-"));
    const path = join(root, "authority.sqlite");
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-bounded-batch-test" },
      manualClock(new Date(COMPOSITION_NOW)),
    );
    const secondRun = RunRecordSchema.parse({
      ...TERMINAL_RUN,
      envelope: {
        ...TERMINAL_RUN.envelope,
        runId: "33333333-3333-4333-8333-333333333333",
        itemId: "44444444-4444-4444-8444-444444444444",
        traceId: "sp-100001-3333",
      },
    });
    try {
      seedTerminalSeparationsResult(database, path);
      seedTerminalSeparationsResult(
        database,
        path,
        secondRun,
        activityPersonPseudonymResultRecord(secondRun),
      );
      const generationBefore = database.getMeta().authorityGeneration;
      const service = createActivityPersonPseudonymBackfillService({
        authority: database.authority,
        writeCapability: database.createActivityPersonPseudonymBackfillWriteCapability(
          TEST_PSEUDONYM_DOMAIN,
        ),
      });

      const report = service.backfill({
        scope: "selected-runs",
        runIds: [TERMINAL_RUN.envelope.runId, secondRun.envelope.runId],
      });

      assert.deepEqual(report.outcomes.map(({ state }) => state), ["inserted", "inserted"]);
      assert.equal(database.getMeta().authorityGeneration, generationBefore + 1);
      assert.equal(database.authority.activityPersonPseudonyms.listByRuns([
        TERMINAL_RUN.envelope.runId,
        secondRun.envelope.runId,
      ]).length, 2);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
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
    const { emplId: _missingEmplId, ...subjectWithoutEid } = SEPARATIONS_RESULT.approved;
    const missingSubject = resultWith({
      ...SEPARATIONS_RESULT,
      approved: subjectWithoutEid,
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
      {
        name: "mismatched result execution",
        run: TERMINAL_RUN,
        result: RunResultRecordSchema.parse({ ...RESULT_RECORD, attempt: RESULT_RECORD.attempt + 1 }),
        reason: "run-result-identity-mismatch",
      },
      { name: "missing binding", run: TERMINAL_RUN, result: missingSubject, reason: "canonical-subject-missing" },
      { name: "malformed binding", run: TERMINAL_RUN, result: malformedSubject, reason: "canonical-subject-malformed" },
      { name: "ambiguous binding", run: TERMINAL_RUN, result: ambiguousSubject, reason: "canonical-subject-ambiguous" },
    ] as const;

    for (const fixture of cases) {
      const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-refusal-"));
      const path = join(root, "authority.sqlite");
      const database = AuthorityDatabase.open(
        { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-refusal-test" },
        manualClock(new Date(COMPOSITION_NOW)),
      );
      try {
        if (fixture.run !== undefined) {
          if (fixture.run.lifecycle.state === "queued") {
            database.authority.runs.enqueue(fixture.run);
          } else {
            seedSeparationsRunAuthority(database, path, fixture.run, fixture.result);
          }
        }
        const outcomes = database.createActivityPersonPseudonymBackfillWriteCapability(
          TEST_PSEUDONYM_DOMAIN,
        ).reviewAndInsert([TERMINAL_RUN.envelope.runId]);

        assert.deepEqual(outcomes, [{
          runId: TERMINAL_RUN.envelope.runId,
          state: "unavailable",
          reason: fixture.reason,
        }], fixture.name);
        assert.deepEqual(
          database.authority.activityPersonPseudonyms.listByRun(TERMINAL_RUN.envelope.runId),
          [],
          fixture.name,
        );
      } finally {
        database.close();
        rmSync(root, { recursive: true, force: true });
      }
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
      const performedFinalization = SEPARATIONS_RESULT.finalization;
      if (!("proof" in performedFinalization)) throw new Error("fixture finalization must be the performed arm");
      const alternateSourceResult = resultWith({
        ...SEPARATIONS_RESULT,
        termination: { ...SEPARATIONS_RESULT.termination, emplId: "10800001" },
        finalization: {
          ...performedFinalization,
          proof: { ...performedFinalization.proof, observedEid: "10800002" },
        },
      });
      seedTerminalSeparationsResult(database, path, TERMINAL_RUN, alternateSourceResult);
      const writeCapability = database.createActivityPersonPseudonymBackfillWriteCapability(
        TEST_PSEUDONYM_DOMAIN,
      );
      const service = createActivityPersonPseudonymBackfillService({
        authority: database.authority,
        writeCapability,
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
      const directIdentifiers = [COMPOSITION_EID, "10800001", "10800002"];
      const forbiddenValues = [
        ...directIdentifiers,
        ...directIdentifiers.map((identifier) => JSON.stringify(identifier.slice(-4))),
        ...directIdentifiers.map((identifier) => createHash("sha256").update(identifier).digest("hex")),
        KEY_HEX,
      ];
      for (const secretValue of forbiddenValues) {
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
      const generationColumns = raw.prepare(
        "PRAGMA table_info(activity_person_pseudonym_generations)",
      ).all().map((column) => {
        if (typeof column !== "object" || column === null) {
          throw new Error("pseudonym generation table_info row is not an object");
        }
        const name = Reflect.get(column, "name");
        if (typeof name !== "string") {
          throw new Error("pseudonym generation table_info row has no name");
        }
        return name;
      });
      const generationRows = raw.prepare(
        "SELECT * FROM activity_person_pseudonym_generations",
      ).all();
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
      assert.deepEqual(generationColumns, [
        "record_key",
        "key_generation",
        "key_commitment",
        "derivation",
        "record_json",
        "created_at",
      ]);
      assert.equal(generationRows.length, 1);
      const persisted = JSON.stringify({ evidence: rows, generations: generationRows });
      const directIdentifiers = [COMPOSITION_EID, "10800001", "10800002"];
      const forbiddenValues = [
        ...directIdentifiers,
        ...directIdentifiers.map((identifier) => JSON.stringify(identifier.slice(-4))),
        ...directIdentifiers.map((identifier) => createHash("sha256").update(identifier).digest("hex")),
        KEY_HEX,
      ];
      for (const secretValue of forbiddenValues) {
        assert.equal(persisted.includes(secretValue), false);
      }
    } finally {
      raw.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("composes one explicit selected-run backfill command against the isolated authority", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-command-"));
    const stateRoot = ".tracker";
    const path = join(root, stateRoot, "state.db");
    const isolation = defineRuntimeIsolation({
      stateRoot,
      artifactRoot: ".tracker/artifacts",
      backendPort: 3938,
      frontendPort: 5174,
      processLockRoot: ".tracker/locks",
      browserProfileRoot: ".auth",
      browserSessionNamespace: "hrauto-rebuild",
    });
    mkdirSync(join(root, stateRoot), { recursive: true });
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "pseudonym-command-test" },
      manualClock(new Date(COMPOSITION_NOW)),
    );
    const protectedStore = createProtectedSettingsFileAuthority({
      path: settingsRootPaths(join(root, stateRoot)).ordinary,
      assertWriteIdAvailable: () => undefined,
    });
    journalProtectedSettings(database, protectedStore, {
      activityPersonPseudonym: { set: { keyHex: KEY_HEX, keyGeneration: "activity-person-g1" } },
    }, COMPOSITION_NOW);
    database.close();
    try {
      const productionComposition = readFileSync(
        new URL("../../src/server/activity-person-pseudonym-backfill/compose.ts", import.meta.url),
        "utf8",
      );
      assert.doesNotMatch(productionComposition, /pseudonyms\?:/u);
      assert.match(
        productionComposition,
        /createActivityPersonPseudonymBackfillWriteCapability\(\s*requireActivityPersonPseudonymDomain\(createJournaledProtectedSecretSource\(\{ file: protectedAuthority, database \}\)\)/u,
      );
      const outcome = composeActivityPersonPseudonymBackfillCommand({
        isolation,
        args: ["backfill", "--run", TERMINAL_RUN.envelope.runId, "--json"],
        repoRoot: root,
        clock: manualClock(new Date(COMPOSITION_NOW)),
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
