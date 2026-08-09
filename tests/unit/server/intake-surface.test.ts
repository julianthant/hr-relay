/**
 * D170 — the intake upload route, the parser seam, and the session wire, over
 * the REAL content-addressed artifact writer, the REAL shared grid edge and
 * the REAL authority database.
 *
 * The four properties this suite exists for:
 *
 * 1. **The route creates the session** — bytes in, a durable `mapping` row and
 *    a wire out, with discovery already run over the real file.
 * 2. **A re-upload of the same digest JOINS its open session** rather than
 *    forking a second one that would enqueue the same rows twice.
 * 3. **Suggestions are hints.** The wire proposes `Employee ID#` → `emplId`
 *    and still serves an EMPTY `bindings` array; only a command mints one.
 * 4. **The parse is re-derived, never stored** — the wire's validation
 *    dispositions come back from the retained `readAt`, and the session row
 *    holds no rows or columns at all.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { manualClock } from "../../../src/domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/domain/ids.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import {
  INTAKE_UPLOAD_MAX_BYTES,
  createIntakeService,
  type IntakeService,
} from "../../../src/server/dashboard/commands/intake-service.js";
import { createIntakeParser } from "../../../src/server/intake/intake-parser.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  INTAKE_FIXTURE_WORKFLOW_ID,
  intakeFixtureDescriptor,
  intakeFixtureProjection,
} from "../../fixtures/intake-workflow-fixture.js";

const ROSTER_CSV = [
  "Work-study roster,,",
  "Employee ID#,Effective Date,Dept",
  "10456712,07/01/2026,Housing Dining Hospitality",
  "10-4567,07/01/2026,Housing Dining Hospitality",
  "10998801,07/01/2026,Student Affairs",
  "",
].join("\n");

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

interface Surface {
  readonly intake: IntakeService;
  readonly database: AuthorityDatabase;
  readonly send: (
    intakeSessionId: string,
    expectedVersion: number,
    type: string,
    payload?: Record<string, unknown>,
  ) => Promise<{ readonly state: string }>;
}

function surface(): Surface {
  const root = mkdtempSync(join(tmpdir(), "hrauto-intake-surface-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "intake-surface-test" },
    clock,
  );
  openDatabases.push(database);

  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: root,
    artifactRoot: ".tracker-rebuild/artifacts",
  });
  const parser = createIntakeParser({ artifacts });
  const projections = {
    resolve: (workflowId: string) =>
      (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined),
  };
  const descriptors = {
    resolve: (workflowId: string) =>
      (workflowId === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined),
  };

  const intake = createIntakeService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: {
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
    },
    artifacts,
    parser,
    projections,
    descriptors,
    clock,
    ids: sequentialIdFactory("c"),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });

  const kernel = createCommandKernel({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: sequentialIdFactory("d"),
    descriptors,
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
    intakeParser: parser,
    intakeProjections: projections,
  });

  return {
    intake,
    database,
    send: async (intakeSessionId, expectedVersion, type, payload) => {
      const command = {
        commandId: commandId(),
        requestedAt: NOW,
        requestedBy: "local-operator",
        source: "dashboard",
        family: "intake",
        type,
        target: { intakeSessionId, expectedVersion },
        ...(payload === undefined ? {} : { payload }),
      };
      // Exactly what the `/api/v1/commands` route does before dispatching.
      await intake.prepare(command);
      return kernel.execute(command);
    },
  };
}

async function uploadRoster(intake: IntakeService) {
  const outcome = await intake.upload({
    workflow: INTAKE_FIXTURE_WORKFLOW_ID,
    mediaType: "text/csv; charset=utf-8",
    bytes: new TextEncoder().encode(ROSTER_CSV),
  });
  if (outcome.state === "refused") throw new Error(`the fixture roster was refused: ${outcome.message}`);
  return outcome;
}

describe("D170 intake upload route", () => {
  it("creates a mapping session with discovery already run over the real file", async () => {
    const { intake, database } = surface();
    const created = await uploadRoster(intake);
    assert.equal(created.state, "created");

    const wire = created.session;
    assert.equal(wire.wireVersion, 1);
    assert.equal(wire.state, "mapping");
    assert.equal(wire.expectedVersion, 1);
    assert.deepEqual([...wire.sheets], ["default"]);
    assert.equal(wire.headerRowIndex, 1, "the heading row outranks the title row above it");
    assert.deepEqual(wire.columns.map((column) => column.header), ["Employee ID#", "Effective Date", "Dept"]);
    assert.deepEqual([...wire.columns[0].samples], ["10456712", "10-4567", "10998801"]);
    assert.equal(wire.rowCount, 3);
    assert.equal(wire.validation.state, "none");
    assert.notEqual(wire.headerFingerprint, null);

    const stored = database.authority.intakeSessions.get(wire.intakeSessionId);
    assert.notEqual(stored, undefined);
    // The durable row retains DECISIONS and the source identity only.
    assert.deepEqual(JSON.parse(JSON.stringify(stored?.bindings)), []);
    assert.equal(stored?.artifact.sha256, wire.artifact.sha256);
  });

  it("proposes bindings as hints and applies none of them", async () => {
    const { intake } = surface();
    const wire = (await uploadRoster(intake)).session;
    assert.deepEqual(wire.bindings, []);
    const eidSuggestions = wire.suggestions.filter((entry) => String(entry.targetFieldId) === "emplId");
    assert.ok(eidSuggestions.length > 0, "the scorer must reach the wire");
    assert.equal(
      String(eidSuggestions[0].sourceColumnId),
      String(wire.columns[0].sourceColumnId),
      "the EID column is the proposal",
    );
    assert.deepEqual(wire.targets.map((target) => String(target.targetFieldId)).sort(), [
      "department", "effectiveDate", "emplId",
    ]);
  });

  it("joins the open session when the same bytes are uploaded again", async () => {
    const { intake } = surface();
    const first = await uploadRoster(intake);
    const second = await uploadRoster(intake);
    assert.equal(second.state, "joined");
    assert.equal(second.session.intakeSessionId, first.session.intakeSessionId);
  });

  it("refuses a file the grid edge cannot read, and mints no session", async () => {
    const { intake, database } = surface();
    const blank = "\n\n\n";
    const outcome = await intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv",
      bytes: new TextEncoder().encode(blank),
    });
    assert.equal(outcome.state, "refused");
    assert.equal(outcome.state === "refused" ? outcome.code : "", "empty-sheet");
    // The bytes are published (content-addressed and harmless); the SESSION is
    // what must not exist over a file nobody can read.
    assert.equal(database.authority.intakeSessions.findActiveBySource(sha256Hex(blank)).length, 0);
  });

  it("refuses a media type the grid edge does not read, an empty body, and an oversize one", async () => {
    const { intake } = surface();
    await assert.rejects(() => intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "application/pdf",
      bytes: new TextEncoder().encode(ROSTER_CSV),
    }));
    await assert.rejects(() => intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv",
      bytes: new Uint8Array(0),
    }));
    await assert.rejects(() => intake.upload({
      workflow: INTAKE_FIXTURE_WORKFLOW_ID,
      mediaType: "text/csv",
      bytes: new Uint8Array(INTAKE_UPLOAD_MAX_BYTES + 1),
    }));
  });

  it("refuses a workflow that declares no intake projection", async () => {
    const { intake } = surface();
    await assert.rejects(
      () => intake.upload({
        workflow: "person-lookup",
        mediaType: "text/csv",
        bytes: new TextEncoder().encode(ROSTER_CSV),
      }),
      /is not registered for spreadsheet intake/,
    );
  });
});

describe("D170 intake session wire", () => {
  it("serves the re-derived validation dispositions against the retained readAt", async () => {
    const { intake, send } = surface();
    const created = await uploadRoster(intake);
    const sessionId = created.session.intakeSessionId;
    const headerFingerprint = created.session.headerFingerprint;
    assert.notEqual(headerFingerprint, null);

    const bind = async (targetFieldId: string, columnIndex: number, expectedVersion: number) => {
      const wire = await intake.read(sessionId);
      const result = await send(sessionId, expectedVersion, "confirm-intake-mapping", {
        targetFieldId,
        sourceColumnId: wire.columns[columnIndex].sourceColumnId,
        headerFingerprint,
      });
      assert.equal(result.state, "applied");
    };
    await bind("emplId", 0, 1);
    await bind("effectiveDate", 1, 2);

    assert.equal((await send(sessionId, 3, "validate-intake")).state, "applied");

    const validated = await intake.read(sessionId);
    assert.equal(validated.state, "validated");
    assert.equal(validated.validation.state, "validated");
    if (validated.validation.state !== "validated") throw new Error("unreachable");
    assert.equal(validated.validation.readAt, NOW);
    assert.equal(validated.validation.validRows, 2, "row 2's `10-4567` is not a UCPath EID");
    assert.deepEqual(
      validated.validation.rejected.map((reject) => [reject.sourceRow, reject.code]),
      [[2, "cell-coercion"]],
    );
    assert.deepEqual([...validated.validation.excluded], []);
  });

  it("re-derives an excluded row out of the valid set without storing a single row", async () => {
    const { intake, send, database } = surface();
    const created = await uploadRoster(intake);
    const sessionId = created.session.intakeSessionId;
    const headerFingerprint = created.session.headerFingerprint;

    const wire = await intake.read(sessionId);
    assert.equal(
      (await send(sessionId, 1, "confirm-intake-mapping", {
        targetFieldId: "emplId",
        sourceColumnId: wire.columns[0].sourceColumnId,
        headerFingerprint,
      })).state,
      "applied",
    );
    assert.equal(
      (await send(sessionId, 2, "confirm-intake-mapping", {
        targetFieldId: "effectiveDate",
        sourceColumnId: wire.columns[1].sourceColumnId,
        headerFingerprint,
      })).state,
      "applied",
    );
    assert.equal(
      (await send(sessionId, 3, "exclude-intake-row", { sourceRow: 2, reason: "Bad EID, out of scope" })).state,
      "applied",
    );
    assert.equal((await send(sessionId, 4, "validate-intake")).state, "applied");

    const validated = await intake.read(sessionId);
    if (validated.validation.state !== "validated") throw new Error("unreachable");
    assert.equal(validated.validation.validRows, 2);
    assert.deepEqual([...validated.validation.excluded], [2]);
    assert.deepEqual(validated.validation.rejected, []);

    const stored = JSON.stringify(database.authority.intakeSessions.get(sessionId));
    assert.ok(!stored.includes("10456712"), "no cell value is ever stored on the session row");
    assert.ok(!stored.includes("Employee ID#"), "no detected column is ever stored on the session row");
  });

  it("fails loud on a session that does not exist", async () => {
    const { intake } = surface();
    await assert.rejects(
      () => intake.read("11111111-1111-4111-8111-111111111111"),
      /does not exist/,
    );
  });
});
