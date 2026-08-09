/**
 * D170 — the five non-enqueue intake arms, driven through the REAL kernel over
 * the REAL authority database.
 *
 * What the suite is actually protecting:
 *
 * - a binding is minted only against the layout the file ACTUALLY presents,
 *   and a confirmation carrying a stale `headerFingerprint` is refused rather
 *   than applied to whatever column now sits there;
 * - any change to the mapping unvalidates the session, so a stale `validated`
 *   can never gate an enqueue;
 * - a header/sheet move discards the row-level decisions that named rows under
 *   the OLD header, instead of silently re-pointing them;
 * - a repeat of an identical decision is a no-op, not a version bump;
 * - `enqueue-intake-manifest` is still refused `capability-unavailable` with
 *   zero authority movement.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel, type IntakeParser } from "../../src/core/command-kernel.js";
import { manualClock } from "../../src/domain/clock.js";
import { detectColumns, headerFingerprint } from "../../src/domain/intake/mapping.js";
import { IntakeSessionSchema } from "../../src/domain/intake/session.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { deriveIntakeParse } from "../../src/server/intake/intake-parser.js";
import { HASH_A, NOW, UUID_2, UUID_7 } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  INTAKE_FIXTURE_WORKFLOW_ID,
  intakeFixtureDescriptor,
  intakeFixtureProjection,
} from "../fixtures/intake-workflow-fixture.js";

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
const openDatabases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

let commandSequence = 0;
function commandId(): string {
  commandSequence += 1;
  return `${String(commandSequence).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function harness(sessionOverrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-intake-arms-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "intake-arms-test" },
    clock,
  );
  openDatabases.push(database);

  const session = IntakeSessionSchema.parse({
    intakeSessionId: UUID_7,
    actorId: "local-operator",
    workflow: INTAKE_FIXTURE_WORKFLOW_ID,
    artifact: { id: UUID_2, sha256: HASH_A, bytes: 4096, mediaType: "text/csv" },
    sheet: SHEET,
    headerRowIndex: HEADER_ROW,
    bindings: [],
    constants: [],
    corrections: [],
    exclusions: [],
    state: "mapping",
    validation: { state: "none" },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...sessionOverrides,
  });
  database.withAuthorityTransaction((repositories) => repositories.intakeSessions.create(session));

  const kernel = createCommandKernel({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("b"),
    descriptors: {
      resolve: (workflowId) => (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined),
    },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("unused"); },
      spawnWorker: () => { throw new Error("unused"); },
      refreshBrowser: () => { throw new Error("unused"); },
      reopenBrowser: () => { throw new Error("unused"); },
    },
    intakeParser: fixtureParser,
    intakeProjections: {
      resolve: (workflowId) => (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined),
    },
  });

  const current = () => {
    const held = database.authority.intakeSessions.get(UUID_7);
    if (held === undefined) throw new Error("the fixture session vanished");
    return held;
  };

  const send = (type: string, payload?: Record<string, unknown>) => kernel.execute({
    commandId: commandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "intake",
    type,
    target: { intakeSessionId: UUID_7, expectedVersion: current().version },
    ...(payload === undefined ? {} : { payload }),
  });

  const bindEid = () => send("confirm-intake-mapping", {
    targetFieldId: "emplId",
    sourceColumnId: EID_COLUMN,
    headerFingerprint: LAYOUT_FINGERPRINT,
  });

  return { database, kernel, current, send, bindEid };
}

/* ── the arms ────────────────────────────────────────────────────────────── */

describe("D170 intake arms — confirm-intake-mapping", () => {
  it("mints a binding against the layout the file actually presents", () => {
    const { current, bindEid } = harness();
    assert.equal(bindEid().state, "applied");
    const session = current();
    assert.equal(session.version, 2);
    assert.deepEqual(
      session.bindings.map((binding) => [String(binding.targetFieldId), String(binding.canonicalFieldId)]),
      [["emplId", "eid"]],
    );
    assert.equal(String(session.bindings[0].sourceColumnId), String(EID_COLUMN));
  });

  it("refuses a confirmation built against a layout this file does not present", () => {
    const { current, send } = harness();
    const result = send("confirm-intake-mapping", {
      targetFieldId: "emplId",
      sourceColumnId: EID_COLUMN,
      headerFingerprint: "b".repeat(64),
    });
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "schema-mismatch");
    assert.equal(current().version, 1, "a refused confirmation moves no authority row");
  });

  it("refuses a target the projection does not declare, and a column not in the file", () => {
    const { send } = harness();
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

  it("rebinds one target to one column, and repeats are no-ops", () => {
    const { current, send, bindEid } = harness();
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

describe("D170 intake arms — inspect-intake", () => {
  it("settles the header row discovery preselects when the operator has not chosen", () => {
    const { current, send } = harness({ headerRowIndex: null });
    assert.equal(current().headerRowIndex, null);
    assert.equal(send("inspect-intake", {}).state, "applied");
    assert.equal(current().headerRowIndex, HEADER_ROW);
  });

  it("is a no-op when the selection already holds", () => {
    const { current, send } = harness();
    assert.equal(send("inspect-intake", { sheet: SHEET, headerRowIndex: HEADER_ROW }).state, "applied");
    assert.equal(current().version, 1);
  });

  it("discards bindings, corrections and exclusions when the layout moves", () => {
    const { current, send, bindEid } = harness();
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

  it("refuses a header row the sheet does not have, and an unknown sheet", () => {
    const { current, send } = harness();
    const absentRow = send("inspect-intake", { headerRowIndex: 99 });
    assert.equal(absentRow.state, "rejected");
    assert.match(absentRow.state === "rejected" ? absentRow.message : "", /header-row-absent/);
    const unknownSheet = send("inspect-intake", { sheet: "Nope" });
    assert.equal(unknownSheet.state, "rejected");
    assert.equal(current().version, 1);
  });
});

describe("D170 intake arms — corrections and exclusions", () => {
  it("refuses a correction for a field with no bound column", () => {
    const { send } = harness();
    const result = send("correct-intake-row", { sourceRow: 1, field: "emplId", correctedValue: "10456712" });
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /no bound column/);
  });

  it("refuses a source row past the end of the sheet's data rows", () => {
    const { send, bindEid } = harness();
    bindEid();
    const result = send("correct-intake-row", { sourceRow: 9, field: "emplId", correctedValue: "10456712" });
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /beyond the 3 data rows/);
  });

  it("upserts one correction per (row, field) and no-ops an identical one", () => {
    const { current, send, bindEid } = harness();
    bindEid();
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456799" });
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456700" });
    assert.equal(current().corrections.length, 1);
    assert.equal(current().corrections[0].correctedValue, "10456700");
    const versionBefore = current().version;
    send("correct-intake-row", { sourceRow: 2, field: "emplId", correctedValue: "10456700" });
    assert.equal(current().version, versionBefore);
  });

  it("keeps an exclusion's original reason and refuses a conflicting second one", () => {
    const { current, send } = harness();
    assert.equal(send("exclude-intake-row", { sourceRow: 2, reason: "Not in scope" }).state, "applied");
    const versionBefore = current().version;
    assert.equal(send("exclude-intake-row", { sourceRow: 2, reason: "Not in scope" }).state, "applied");
    assert.equal(current().version, versionBefore, "an identical exclusion is a no-op");
    const conflicting = send("exclude-intake-row", { sourceRow: 2, reason: "Different reason" });
    assert.equal(conflicting.state, "rejected");
    assert.equal(current().exclusions[0].reason, "Not in scope");
  });
});

describe("D170 intake arms — validate-intake", () => {
  it("retains the validation arm with the readAt it resolved rows against", () => {
    const { current, send, bindEid } = harness();
    bindEid();
    assert.equal(send("validate-intake").state, "applied");
    const session = current();
    assert.equal(session.state, "validated");
    assert.equal(session.validation.state, "validated");
    if (session.validation.state !== "validated") throw new Error("unreachable");
    assert.equal(session.validation.readAt, NOW);
    assert.equal(session.validation.validatedAt, NOW);
  });

  it("unvalidates the session as soon as any decision moves", () => {
    const { current, send, bindEid } = harness();
    bindEid();
    send("validate-intake");
    assert.equal(current().state, "validated");
    send("exclude-intake-row", { sourceRow: 3, reason: "Not in scope" });
    assert.equal(current().state, "mapping");
    assert.equal(current().validation.state, "none");
  });

  it("refuses when the workflow declares no intake projection", () => {
    const { send } = harness({ workflow: "person-lookup" });
    const result = send("validate-intake");
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "policy-refused");
  });

  it("refuses while no header row is settled", () => {
    const { send } = harness({ headerRowIndex: null });
    const result = send("validate-intake");
    assert.equal(result.state, "rejected");
    assert.match(result.state === "rejected" ? result.message : "", /no settled header row/);
  });
});

describe("D170 intake arms — the enqueue arm stays deferred", () => {
  it("refuses enqueue-intake-manifest with zero authority movement", () => {
    const { database, kernel } = harness();
    const before = database.getMeta().authorityGeneration;
    const result = kernel.execute({
      commandId: commandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "intake",
      type: "enqueue-intake-manifest",
      target: { intakeManifestId: UUID_2, expectedVersion: 1 },
    });
    assert.equal(result.state, "rejected");
    assert.equal(result.state === "rejected" ? result.code : "", "capability-unavailable");
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("refuses every arm on a session that does not exist", () => {
    const { kernel } = harness();
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
