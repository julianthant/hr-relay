import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { insertImportedArtifact } from "../../../../src/backend/storage/sqlite/imported-artifacts.js";
import { importedArtifact } from "../../../../src/models/intake/imported-artifact.js";
import { reviewedIntakeFixture } from "../../../support/fixtures/intake-kernel-seams.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { deriveIntakeParse } from "../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { detectColumns,headerFingerprint } from "../../../../src/models/intake/mapping.js";
import { IntakeSessionSchema } from "../../../../src/models/intake/session.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { ItemIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { IntakeParser } from "../../../../src/workflow-kit/intake-parser.js";
import {
INTAKE_FIXTURE_WORKFLOW_ID,
INTAKE_SERIAL_WORKFLOW_ID,
intakeFixtureDescriptor,
intakeFixtureProjection,
intakeSerialFixtureDescriptor,
} from "../../../support/fixtures/intake-workflow-fixture.js";
import {
CONFIG_SNAPSHOT,
HASH_A,
NOW,
UUID_1,
UUID_2,
UUID_3,
UUID_7,
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN,sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

/* ── the source file, as a grid the shared edge would have produced ──────── */

const SHEET = "Cohort A";
const GRID: readonly (readonly string[])[] = [
  ["Work-study roster", "", ""],
  ["Employee ID#", "Effective Date", "Dept"],
  ["10456712", "07/01/2026", "Housing Dining Hospitality"],
  ["10-4567", "07/01/2026", "Housing Dining Hospitality"],
  ["10998801", "07/01/2026", "Student Affairs"],
];
const HEADER_ROW = 1;
const COLUMNS = detectColumns(
  [...GRID[HEADER_ROW]],
  [["10456712", "10-4567", "10998801"], ["07/01/2026"], ["Housing Dining Hospitality"]],
);
const LAYOUT_FINGERPRINT = headerFingerprint(COLUMNS);
const EID_COLUMN = COLUMNS[0].sourceColumnId;
const DATE_COLUMN = COLUMNS[1].sourceColumnId;
const DEPT_COLUMN = COLUMNS[2].sourceColumnId;

/** A second worksheet, so a sheet switch is a real layout change. */
const OTHER_SHEET = "Cohort B";
const OTHER_GRID: readonly (readonly string[])[] = [
  ["EID", "Effective Date"],
  ["10111111", "08/01/2026"],
];

function grid(sheet: string) {
  if (sheet === SHEET) {
    return { state: "parsed" as const, sheets: [SHEET, OTHER_SHEET], sheet: SHEET, grid: GRID };
  }
  if (sheet === OTHER_SHEET) {
    return { state: "parsed" as const, sheets: [SHEET, OTHER_SHEET], sheet: OTHER_SHEET, grid: OTHER_GRID };
  }
  return {
    state: "refused" as const,
    code: "unknown-sheet" as const,
    message: `worksheet ${JSON.stringify(sheet)} is not in this workbook`,
  };
}

/** The seam a caller would have prepared — pure over the fixture grids. */
const fixtureParser: IntakeParser = Object.freeze({
  parse: (request: Readonly<{ sheet: string; headerRowIndex: number | null }>) =>
    deriveIntakeParse(grid(request.sheet), request.headerRowIndex),
});

/* ── harness ─────────────────────────────────────────────────────────────── */

const roots: string[] = [];
const openFixtures: Awaited<ReturnType<typeof openBoundDatabaseFixture>>[] = [];
afterEach(async () => {
  for (const fixture of openFixtures.splice(0)) await fixture.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

let commandSequence = 0;
function commandId(): string {
  commandSequence += 1;
  return `${String(commandSequence).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

async function harness(sessionOverrides: Record<string, unknown> = {}, preReservation = false) {
  const clock = manualClock(new Date(NOW));
  const opened = await openBoundDatabaseFixture("intake-arms-test", clock);
  const database = opened.database;
  const path = opened.path;
  roots.push(opened.profile.workspace);
  openFixtures.push(opened);
  // The config identity an intake fan-out stamps must name a stored snapshot.
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);


  const session = IntakeSessionSchema.parse({
    intakeSessionId: UUID_7,
    actorId: "local-operator",
    workflow: INTAKE_FIXTURE_WORKFLOW_ID,
    artifact: { id: UUID_2, sha256: HASH_A, bytes: 4096, mediaType: "text/csv" },
    sourceName: "cohort-a.csv",
    sheet: SHEET,
    headerRowIndex: HEADER_ROW,
    bindings: [],
    constants: [],
    corrections: [],
    exclusions: [],
    state: "mapping",
    validation: { state: "none" },
    ...(preReservation ? {} : { reservedManifestId: UUID_3 }),
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...sessionOverrides,
  });
  if (preReservation) {
    const legacy = new DatabaseSync(path);
    try {
      insertImportedArtifact(legacy, importedArtifact(JSON.stringify(session), null));
    } finally {
      legacy.close();
    }
  } else {
    database.withAuthorityTransaction((repositories) => repositories.intakeSessions.create(session));
  }

  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("b"),
    configIdentity: { configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: UUID_1 },
    descriptors: {
      resolve: (workflowId) => {
        if (workflowId === INTAKE_FIXTURE_WORKFLOW_ID) return intakeFixtureDescriptor;
        if (workflowId === INTAKE_SERIAL_WORKFLOW_ID) return intakeSerialFixtureDescriptor;
        return undefined;
      },
    },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: { pool: {
      planPoolWorkerCount: async () => { throw new Error("unused worker plan"); },
      spawnPoolWorker: async () => { throw new Error("unused worker spawn"); },
      refreshPoolBrowser: async () => { throw new Error("unused browser refresh"); },
      reopenPoolBrowser: async () => { throw new Error("unused browser reopen"); },
      stopPoolWorker: async () => { throw new Error("unused worker stop"); },
      pausePoolWorker: async () => { throw new Error("unused worker pause"); },
      resumePoolWorker: async () => { throw new Error("unused worker resume"); },
    } },
    intakeParser: fixtureParser,
    intakeProjections: {
      resolve: (workflowId) =>
        (workflowId === INTAKE_FIXTURE_WORKFLOW_ID || workflowId === INTAKE_SERIAL_WORKFLOW_ID
          ? intakeFixtureProjection
          : undefined),
    },
  });

  const current = () => {
    const held = database.authority.intakeSessions.get(UUID_7);
    if (held === undefined) throw new Error("the fixture session vanished");
    return held;
  };

  const send = (type: string, payload?: Record<string, unknown>) => {
    const reviewBinding = type === "enqueue-intake-manifest" ? reviewedIntakeFixture({ session: current(), parser: fixtureParser,
      projection: intakeFixtureProjection, descriptor: current().workflow === INTAKE_SERIAL_WORKFLOW_ID ? intakeSerialFixtureDescriptor : intakeFixtureDescriptor,
      manifests: database.authority.intakeManifests }) : undefined;
    return kernel.execute({ commandId: commandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "intake", type,
      target: { intakeSessionId: UUID_7, expectedVersion: current().version },
      ...(payload === undefined ? {} : { payload: { ...payload, ...(reviewBinding === undefined ? {} : { reviewBinding }) } }),
    });
  };

  const bindEid = () => send("confirm-intake-mapping", {
    targetFieldId: "emplId",
    sourceColumnId: EID_COLUMN,
    headerFingerprint: LAYOUT_FINGERPRINT,
  });

  /** Both REQUIRED targets bound, then validated — the pre-enqueue state. */
  const mapAndValidate = () => {
    bindEid();
    send("confirm-intake-mapping", {
      targetFieldId: "effectiveDate",
      sourceColumnId: DATE_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    send("validate-intake");
  };

  return { database, kernel, current, send, bindEid, mapAndValidate };
}

/* ── the arms ────────────────────────────────────────────────────────────── */

describe("intake arms — confirm-intake-mapping", () => {
  it("mints a binding against the layout the file actually presents", async () => {
    const { current, bindEid } = await harness();
    assert.equal(bindEid().state, "applied");
    const session = current();
    assert.equal(session.version, 2);
    assert.deepEqual(
      session.bindings.map((binding) => [String(binding.targetFieldId), String(binding.canonicalFieldId)]),
      [["emplId", "eid"]],
    );
    assert.equal(String(session.bindings[0].sourceColumnId), String(EID_COLUMN));
  });

  it("refuses a confirmation built against a layout this file does not present", async () => {
    const { current, send } = await harness();
    const result = send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: EID_COLUMN,
      headerFingerprint: "b".repeat(64),
    });
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "schema-mismatch");
    assert.equal(current().version, 1, "a refused confirmation moves no authority row");
  });

  it("rejects mapping confirmation before mutation when the target or source column is unknown", async () => {
    const { send } = await harness();
    const unknownTarget = send("confirm-intake-mapping", {
      targetFieldId: "notAField",
      sourceColumnId: EID_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    assert.equal(unknownTarget.state, "rejected");
    const unknownColumn = send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: "aaaaaaaabbbbbbbb",
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    assert.equal(unknownColumn.state, "rejected");
  });

  it("rebinds one target to one column, and repeats are no-ops", async () => {
    const { current, send, bindEid } = await harness();
    bindEid();
    const rebind = send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: DEPT_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    assert.equal(rebind.state, "applied");
    assert.equal(current().bindings.length, 1, "one target binds at most one column");
    assert.equal(String(current().bindings[0].sourceColumnId), String(DEPT_COLUMN));

    const versionBefore = current().version;
    const repeat = send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: DEPT_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    assert.equal(repeat.state, "applied");
    assert.equal(current().version, versionBefore, "an identical confirmation is a no-op");
  });
});

describe("intake arms — inspect-intake", () => {
  it("settles the header row discovery preselects when the operator has not chosen", async () => {
    const { current, send } = await harness({ headerRowIndex: null });
    assert.equal(current().headerRowIndex, null);
    assert.equal(send("inspect-intake", {}).state, "applied");
    assert.equal(current().headerRowIndex, HEADER_ROW);
  });

  it("is a no-op when the selection already holds", async () => {
    const { current, send } = await harness();
    assert.equal(send("inspect-intake", { sheet: SHEET, headerRowIndex: HEADER_ROW }).state, "applied");
    assert.equal(current().version, 1);
  });

  it("discards bindings, corrections and exclusions when the layout moves", async () => {
    const { current, send, bindEid } = await harness();
    bindEid();
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456799" });
    send("exclude-intake-row", { sourceRow: 3, reason: "Duplicate of row 1" });
    assert.equal(current().bindings.length, 1);
    assert.equal(current().corrections.length, 1);
    assert.equal(current().exclusions.length, 1);

    assert.equal(send("inspect-intake", { sheet: OTHER_SHEET }).state, "applied");
    const moved = current();
    assert.equal(moved.sheet, OTHER_SHEET);
    assert.deepEqual(moved.bindings, []);
    assert.deepEqual(moved.corrections, []);
    assert.deepEqual(moved.exclusions, []);
    assert.equal(moved.validation.state, "none");
  });

  it("refuses a header row the sheet does not have, and an unknown sheet", async () => {
    const { current, send } = await harness();
    const absentRow = send("inspect-intake", { headerRowIndex: 99 });
    assert.equal(absentRow.state, "rejected");
    assert.match(absentRow.state === "rejected" ? absentRow.message : "", /header-row-absent/);
    const unknownSheet = send("inspect-intake", { sheet: "Nope" });
    assert.equal(unknownSheet.state, "rejected");
    assert.equal(current().version, 1);
  });
});

describe("intake arms — corrections and exclusions", () => {
  it("refuses a correction for a field with no bound column", async () => {
    const { send } = await harness();
    const result = send("correct-intake-row", { sourceRow: 1, field: "emplId", correctedValue: "10456712" });
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /no bound column/);
  });

  it("refuses a source row past the end of the sheet's data rows", async () => {
    const { send, bindEid } = await harness();
    bindEid();
    const result = send("correct-intake-row", { sourceRow: 9, field: "emplId", correctedValue: "10456712" });
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /beyond the 3 data rows/);
  });

  it("upserts one correction per (row, field) and no-ops an identical one", async () => {
    const { current, send, bindEid } = await harness();
    bindEid();
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456799" });
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456700" });
    assert.equal(current().corrections.length, 1);
    assert.equal(current().corrections[0].correctedValue, "10456700");
    const versionBefore = current().version;
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456700" });
    assert.equal(current().version, versionBefore);
  });

  it("keeps an exclusion's original reason and refuses a conflicting second one", async () => {
    const { current, send } = await harness();
    assert.equal(send("exclude-intake-row", { sourceRow: 2, reason: "Not in scope" }).state, "applied");
    const versionBefore = current().version;
    assert.equal(send("exclude-intake-row", { sourceRow: 2, reason: "Not in scope" }).state, "applied");
    assert.equal(current().version, versionBefore, "an identical exclusion is a no-op");
    const conflicting = send("exclude-intake-row", { sourceRow: 2, reason: "Different reason" });
    assert.equal(conflicting.state, "rejected");
    assert.equal(current().exclusions[0].reason, "Not in scope");
  });
});

describe("intake arms — validate-intake", () => {
  it("retains the validation arm with the readAt it resolved rows against", async () => {
    const { current, send, bindEid } = await harness();
    bindEid();
    assert.equal(send("validate-intake").state, "applied");
    const session = current();
    assert.equal(session.state, "validated");
    assert.equal(session.validation.state, "validated");
    if (session.validation.state !== "validated") throw new Error("unreachable");
    assert.equal(session.validation.readAt, NOW);
    assert.equal(session.validation.validatedAt, NOW);
  });

  it("unvalidates the session as soon as any decision moves", async () => {
    const { current, send, bindEid } = await harness();
    bindEid();
    send("validate-intake");
    assert.equal(current().state, "validated");
    send("exclude-intake-row", { sourceRow: 3, reason: "Not in scope" });
    assert.equal(current().state, "mapping");
    assert.equal(current().validation.state, "none");
  });

  it("refuses when the workflow declares no intake projection", async () => {
    const { send } = await harness({ workflow: "person-lookup" });
    const result = send("validate-intake");
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "policy-refused");
  });

  it("refuses while no header row is settled", async () => {
    const { send } = await harness({ headerRowIndex: null });
    const result = send("validate-intake");
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /no settled header row/);
  });
});

describe("intake arms — every arm needs its session", () => {
  it("refuses every arm on a session that does not exist", async () => {
    const { kernel } = await harness();
    const result = kernel.execute({
      commandId: commandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "intake",
      type: "validate-intake",
      target: { intakeSessionId: UUID_2, expectedVersion: 1 },
    });
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "target-not-found");
  });
});



/** The fixture file's row 2 (`10-4567`) is the one the canonical EID refuses. */
const REJECTED_ROW = 2;

function enqueue(send: Awaited<ReturnType<typeof harness>>["send"], dryRun = false) {
  return send("enqueue-intake-manifest", { dryRun });
}

describe("enqueue-intake-manifest — the readiness gate", () => {
  it("refuses a pre-reservation session by id instead of minting a manifest identity", async () => {
    const { database, send, mapAndValidate } = await harness({}, true);
    send("exclude-intake-row", { sourceRow: REJECTED_ROW, reason: "Malformed EID" });
    mapAndValidate();

    const result = enqueue(send);

    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "invalid-state");
    assert.match(result.state === "rejected" ? result.message : "", new RegExp(`intake session ${UUID_7}`));
    assert.match(result.state === "rejected" ? result.message : "", /predates reserved manifest identities/u);
    assert.equal(database.authority.intakeManifests.findBySource(HASH_A).length, 0);
  });

  it("refuses a session that has not been validated", async () => {
    const { database, current, send, bindEid } = await harness();
    bindEid();
    const before = database.getMeta().authorityGeneration;
    const result = enqueue(send);
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "invalid-state");
    assert.match(result.state === "rejected" ? result.message : "", /rejection review is mandatory/);
    assert.equal(current().state, "mapping");
    assert.equal(database.getMeta().authorityGeneration, before, "a refused enqueue moves no authority row");
  });

  it("refuses while a row is still rejected, naming the rows that block it", async () => {
    const { database, send, mapAndValidate } = await harness();
    mapAndValidate();
    const result = enqueue(send);
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "policy-refused");
    const message = result.state === "rejected" ? result.message : "";
    assert.match(message, /unresolved-rejections/);
    assert.match(message, new RegExp(`source rows ${String(REJECTED_ROW)}`));
    assert.equal(database.authority.intakeManifests.findBySource(HASH_A).length, 0);
  });

  it("refuses a file whose every row is excluded rather than reporting a no-op success", async () => {
    const { database, send, mapAndValidate } = await harness();
    for (const sourceRow of [1, 2, 3]) send("exclude-intake-row", { sourceRow, reason: "Wrong sheet" });
    mapAndValidate();
    const result = enqueue(send);
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /no-valid-rows/);
    assert.equal(database.authority.intakeManifests.findBySource(HASH_A).length, 0);
  });

  it("refuses a dry run the GRAPH cannot offer", async () => {
    const { send, mapAndValidate } = await harness();
    send("exclude-intake-row", { sourceRow: REJECTED_ROW, reason: "Malformed EID" });
    mapAndValidate();
    const result = enqueue(send, true);
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "policy-refused");

    assert.match(
      result.state === "rejected" ? result.message : "",
      /has no transaction node, so a dry run would be indistinguishable from a real run/,
    );
  });

  it("conflicts when the session moved since the plan was reviewed", async () => {
    const { current, kernel, send, mapAndValidate } = await harness();
    send("exclude-intake-row", { sourceRow: REJECTED_ROW, reason: "Malformed EID" });
    mapAndValidate();
    const result = kernel.execute({
      commandId: commandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "intake",
      type: "enqueue-intake-manifest",
      target: { intakeSessionId: UUID_7, expectedVersion: current().version - 1 },
      payload: { dryRun: false },
    });
    assert.equal(result.state, "conflict");
    assert.equal(current().state, "validated");
  });
});

describe("enqueue-intake-manifest — the fan-out", () => {
  async function readyHarness() {
    const created = await harness();
    created.send("exclude-intake-row", { sourceRow: REJECTED_ROW, reason: "Malformed EID" });
    created.mapAndValidate();
    return created;
  }

  it("mints one immutable manifest and one queued run per valid row", async () => {
    const { database, current, send } = await readyHarness();
    const result = enqueue(send);
    assert.equal(result.state, "applied");

    const session = current();
    assert.equal(session.state, "enqueued");
    assert.notEqual(session.intakeManifestId, undefined);

    const manifests = database.authority.intakeManifests.findBySource(HASH_A);
    assert.equal(manifests.length, 1);
    const manifest = manifests[0];
    assert.equal(manifest.manifestId, session.intakeManifestId);
    assert.deepEqual({ ...manifest.totals }, {
      sourceRows: 3,
      valid: 2,
      rejected: 0,
      rejectionEvents: 0,
      excluded: 1,
      corrected: 0,
    });
    assert.equal(manifest.source.originalName, "cohort-a.csv");
    assert.equal(manifest.workflowContractFingerprint, intakeFixtureDescriptor.contractFingerprint);

    const runTargets = result.state === "applied"
      ? result.affectedTargets.filter((target) => target.family === "run")
      : [];
    assert.equal(runTargets.length, 2);
    for (const row of manifest.validRows) {
      const runs = database.authority.runs.listByItem({
        workflow: INTAKE_FIXTURE_WORKFLOW_ID,
        itemId: row.itemId,
      });
      assert.equal(runs.length, 1, `source row ${String(row.sourceRow)} enqueued exactly one run`);
      const run = runs[0];
      assert.equal(run.lifecycle.state, "queued");
      assert.equal(run.envelope.shape, "single");
      assert.equal(run.envelope.priority, "bulk");
      assert.equal(run.envelope.dryRun, false);
      assert.equal(run.envelope.configSnapshotId, UUID_1);
      assert.equal(run.envelope.configFingerprint, CONFIG_SNAPSHOT.fingerprint);

      assert.equal(run.input.parsed.schemaHash, manifest.canonicalInputSchemaHash);
      assert.deepEqual(run.input.raw, row.parsedInput);
    }
  });

  it("records the excluded row and the source value a correction replaced", async () => {
    const { database, current, send } = await harness();
    send("exclude-intake-row", { sourceRow: 3, reason: "Left the department" });
    send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: EID_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    send("correct-intake-row", { sourceRow: REJECTED_ROW, field: "emplId", correctedValue: "10456799" });
    send("confirm-intake-mapping", {
      targetFieldId: "effectiveDate",
      sourceColumnId: DATE_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    send("validate-intake");
    assert.equal(enqueue(send).state, "applied");

    const manifestId = current().intakeManifestId;
    if (manifestId === undefined) throw new Error("the enqueued session names no manifest");
    const manifest = database.authority.intakeManifests.get(manifestId);
    if (manifest === undefined) throw new Error("the manifest is missing from authority");
    assert.equal(manifest.totals.valid, 2);
    assert.deepEqual(manifest.exclusions.map((entry) => entry.sourceRow), [3]);
    assert.equal(manifest.corrections.length, 1);

    assert.equal(manifest.corrections[0].original.state, "allowed");
    assert.equal(
      manifest.corrections[0].original.state === "allowed" ? manifest.corrections[0].original.value : "",
      "10-4567",
      "the complete classified original value from the file's own cell",
    );
  });

  it("fans out exactly once — a second enqueue is refused", async () => {
    const { database, current, kernel, send } = await readyHarness();
    assert.equal(enqueue(send).state, "applied");
    const manifestId = current().intakeManifestId;
    const result = kernel.execute({
      commandId: commandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "intake",
      type: "enqueue-intake-manifest",
      target: { intakeSessionId: UUID_7, expectedVersion: current().version },
      payload: { dryRun: false },
    });
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /fans out exactly once/);
    assert.equal(current().intakeManifestId, manifestId);
    assert.equal(database.authority.intakeManifests.findBySource(HASH_A).length, 1);
  });

  it("refuses every mapping command once the session enqueued", async () => {
    const { send } = await readyHarness();
    assert.equal(enqueue(send).state, "applied");
    const result = send("exclude-intake-row", { sourceRow: 1, reason: "Too late" });
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /only an open session/);
  });

  it("writes NOTHING when the enqueue policy refuses the LAST row", async () => {
    const { database, current, send } = await harness({ workflow: INTAKE_SERIAL_WORKFLOW_ID });
    send("exclude-intake-row", { sourceRow: REJECTED_ROW, reason: "Malformed EID" });
    send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: EID_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    send("confirm-intake-mapping", {
      targetFieldId: "effectiveDate",
      sourceColumnId: DATE_COLUMN,
      headerFingerprint: LAYOUT_FINGERPRINT,
    });
    send("validate-intake");

    // Source row 3 already has an active run, and this workflow is
    // `reject-active` — so the fan-out refuses AFTER inserting row 1's.
    const collidingItemId = ItemIdSchema.parse(deriveItemId(INTAKE_SERIAL_WORKFLOW_ID, "eid:10998801"));
    database.withAuthorityTransaction((repositories) => repositories.runs.enqueue({
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        runId: UUID_3,
        workflow: INTAKE_SERIAL_WORKFLOW_ID,
        itemId: collidingItemId,
        traceId: "is-170000-3333",
      },
    }));
    const versionBefore = current().version;
    const generationBefore = database.getMeta().authorityGeneration;

    const result = enqueue(send);
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "policy-refused");

    assert.equal(database.authority.intakeManifests.findBySource(HASH_A).length, 0, "no manifest survives");
    const survivingRow1 = database.authority.runs.listByItem({
      workflow: INTAKE_SERIAL_WORKFLOW_ID,
      itemId: ItemIdSchema.parse(deriveItemId(INTAKE_SERIAL_WORKFLOW_ID, "eid:10456712")),
    });
    assert.equal(survivingRow1.length, 0, "the run inserted before the refusal rolled back with it");
    assert.equal(current().state, "validated");
    assert.equal(current().version, versionBefore);
    assert.equal(database.getMeta().authorityGeneration, generationBefore);
  });
});
