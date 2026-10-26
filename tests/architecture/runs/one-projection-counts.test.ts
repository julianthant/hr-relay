import { syntheticDatabasePath } from "../../support/helpers/synthetic-database-admission.js";
import { fenceWriteFixture } from "../../support/helpers/write-fence-fixture.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { ledgerCommitFixture, fixtureUuid } from "../../support/fixtures/ledger-projection-fixtures.js";
import { seedAtomicWriteOwner, atomicWriteCheckpoint } from "../../support/helpers/timeline-write-fixture.js";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, it } from "vitest";
import {
  claimEventOf,
  failureRecordOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  DAY,
  type DashboardWorld,
} from "../../support/helpers/backend/dashboard-harness.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const COUNT_FIELDS = new Set(["monthCounts", "workflowCounts", "statusCounts"]);
const CALENDAR_SUMMARY = "src/backend/storage/sqlite/run-summaries.ts";
const THE_PROJECTION = "src/backend/runs/projections/run-queue-projection.ts";


const LEDGER_BLOCK_BUILDERS = [
  "src/models/dashboard/activity.ts",
  "src/backend/storage/sqlite/transaction-history.ts",
];
const LEDGER_BLOCK_CONSUMERS = [
  "src/backend/storage/sqlite/transaction-history.ts",
  THE_PROJECTION,
  "src/backend/runs/queries/activity-summaries.ts",
];

function identifiers(filePath: string): ReadonlySet<string> {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const MOCK_COUNT_OWNER = "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts";
function countFieldConstructions(filePath: string, content = readFileSync(filePath, "utf8")): readonly string[] {
  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    // An object-literal property named monthCounts/workflowCounts/statusCounts
    // is a count being BUILT; reading one off a parsed payload is fine.
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = node.name;
      if (ts.isIdentifier(name) && COUNT_FIELDS.has(name.text)) {
        let parent: ts.Node | undefined = node.parent;
        while (parent !== undefined && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
        const admitted = relative(REPO_ROOT, filePath).replaceAll("\\", "/") === MOCK_COUNT_OWNER
          && parent !== undefined && ts.isFunctionDeclaration(parent) && parent.name?.text === "mockWorkflowCounts"
          && parent.parameters.length === 1 && parent.parameters[0].name.getText(source) === "runs"
          && parent.body?.getText(source).replace(/\s+/gu, "") === '{returnMOCK_WORKFLOWS.map(flow=>{constrows=runs.filter(run=>run.workflowId===flow.id);returnWorkflowCountWireSchema.parse({workflowId:flow.id,count:rows.length,statusCounts:mockQueueCounts(rows)});});}'
          && name.text === "statusCounts";
        if (!admitted) found.push(name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("one-projection-counts", () => {
  it("keeps queue/status counts in one projection and bounds the admitted Calendar month-count owner", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");

      if (relativePath.startsWith("src/models/")) continue;
      const constructions = countFieldConstructions(file);
      if (constructions.length === 0) continue;
      if (relativePath === CALENDAR_SUMMARY && constructions.length === 1 && constructions[0] === "monthCounts") continue;
      if (relativePath !== THE_PROJECTION) {
        offenders.push(`${relativePath}: builds ${[...new Set(constructions)].join(", ")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a count/aggregate reachable from a surface may only originate in the one run/queue projection",
    );
    assert.deepEqual(countFieldConstructions(`${REPO_ROOT}/${CALENDAR_SUMMARY}`), ["monthCounts"],
      "the admitted Calendar summary owns exactly one month count projection; queue/status counts remain forbidden");
    // The one legal constructor must actually exist — an empty scan proves
    // nothing once files move.
    assert.ok(
      countFieldConstructions(`${REPO_ROOT}/${THE_PROJECTION}`).length >= 3,
      "the run/queue projection must be the module that builds the count fields",
    );
  });

  it("admits the one closed preview count constructor and rejects served, sibling or extra constructors", () => {
    const path = `${REPO_ROOT}/${MOCK_COUNT_OWNER}`;
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes("statusCounts: mockQueueCounts(rows)"));
    assert.deepEqual(countFieldConstructions(path, content), []);
    for (const [candidatePath, candidate] of [
      [`${REPO_ROOT}/src/dashboard/client/queries/day-queries.ts`, content],
      [`${REPO_ROOT}/src/dashboard/surfaces/workflows/mocks/new-sibling.ts`, content],
      [path, `${content}\nconst arbitrary = { statusCounts: [] };`],
      [path, content.replace("statusCounts: mockQueueCounts(rows)", "statusCounts: []")],
    ]) assert.ok(countFieldConstructions(candidatePath, candidate).length > 0);
  });

  it("bounds carve-out to one builder and one consumer", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const builders: string[] = [];
    const consumers: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const names = identifiers(file);
      if (names.has("ActivityLedgerBlockSchema")) builders.push(relativePath);
      if (names.has("foldActivityRange")) consumers.push(relativePath);
    }

    assert.deepEqual(
      builders.sort((a, b) => a.localeCompare(b)),
      [...LEDGER_BLOCK_BUILDERS].sort((a, b) => a.localeCompare(b)),
      "a write-ledger block is built in exactly the declared modules",
    );
    assert.deepEqual(
      consumers.sort((a, b) => a.localeCompare(b)),
      [...LEDGER_BLOCK_CONSUMERS].sort((a, b) => a.localeCompare(b)),
      "a write-ledger block is asked for in exactly the declared modules",
    );
  });

  const worlds: DashboardWorld[] = [];
  afterEach(() => {
    for (const world of worlds.splice(0)) world.dispose();
  });

  it("proves badge total == status sum == rendered rows by construction over a hostile seeded world", () => {
    const world = makeWorld();
    worlds.push(world);

    queuedEventOf(world, { seed: 1 }); // plain queued
    queuedEventOf(world, { seed: 2 }); // running
    claimEventOf(world, 2);
    world.authority.put(runRecordOf({
      seed: 2,
      lifecycle: {
        state: "running",
        workerId: "person-lookup-worker-1",
        claimedAt: "2026-08-03T17:00:05.000Z",
        heartbeatAt: "2026-08-03T17:00:05.000Z",
      },
      claimGeneration: 1,
      version: 2,
    }));
    queuedEventOf(world, { seed: 3 });
    queuedEventOf(world, { seed: 4, shape: "operation" }); // delegated group
    queuedEventOf(world, { seed: 5, shape: "operation-member", parentSeed: 4 });
    queuedEventOf(world, { seed: 6, shape: "operation-member", parentSeed: 4 });
    queuedEventOf(world, { seed: 7 }); // rejected/failed terminal
    world.writer.emit({
      t: "span.ended", kind: "run", ts: world.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(7), attempt: 1, traceId: `pl-100007-${uuidOf(7).slice(0, 4)}`,
      spanPath: `pl-100007-${uuidOf(7).slice(0, 4)}`, outcome: "failed", failureId: uuidOf(9007),
    });
    world.authority.put(RunRecordSchema.parse({
      ...runRecordOf({ seed: 7, version: 3, claimGeneration: 1 }),
      lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:20:00.000Z", failureId: uuidOf(9007) },
      updatedAt: "2026-08-03T17:20:00.000Z",
      completion: { schemaVersion: 1, kind: "failed", expectedVersion: 2,
        claim: { workerId: "projection-fixture-worker", claimGeneration: 1 },
        authorizedAt: "2026-08-03T17:20:00.000Z", failureId: uuidOf(9007) },
    }));

    queuedEventOf(world, { seed: 8 }); // parked on an operator gate
    world.writer.emit({
      t: "gate.opened", ts: world.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(8), attempt: 1, traceId: `pl-100008-${uuidOf(8).slice(0, 4)}`,
      spanPath: `pl-100008-${uuidOf(8).slice(0, 4)}`, gate: "approval",
    });

    world.authority.put(runRecordOf({ seed: 8, lifecycle: { state: "parked-gate",
      gateId: "approval", resumeAt: "searching", parkedAt: world.clock.now().toISOString() },
    }));

    const payload = world.projection.buildDashboardDayWire(DAY);

    // The three renderings, each read off the ONE payload:
    const workflowPanelTotal = payload.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusBarSum = payload.statusCounts.reduce((sum, { count }) => sum + count, 0);
    const renderedQueueRows = payload.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member").length;

    assert.equal(workflowPanelTotal, statusBarSum);
    assert.equal(statusBarSum, renderedQueueRows);
    assert.equal(renderedQueueRows, 6); // 1,2,3,4,7,8 — members contained

    // Containment applied once, inside the projection: the members ride flat
    // for layout, counted only in their operation's rollup.
    const operation = payload.queueSurfaces.find(({ runId }) => runId === uuidOf(4));
    if (operation?.surfaceKind !== "operation") assert.fail("the delegated group must project as an operation");
    assert.equal(operation.memberRollup.total, 2);

    // And the month calendar rendering descends from the same fold.
    assert.deepEqual(payload.monthCounts, [{ day: DAY, count: 6 }]);



    world.authority.failures.set(
      uuidOf(9007),
      failureRecordOf({ seed: 7, code: "SESSION_LOST", transient: true }),
    );
    for (const [index, instance] of [[0, "prod"], [1, "test"]] as const) {
      const fixture = ledgerCommitFixture(index, { instance, confirmedAt: instantOffsetOf(0),
        runId: fixtureUuid(`one-projection-run-${String(index)}`), itemId: fixtureUuid(`one-projection-item-${String(index)}`) });
      seedAtomicWriteOwner(world.database, fixture.commit, syntheticDatabasePath(world.database));
      assert.equal(fenceWriteFixture(world.database, { intent: fixture.intent, attempt: fixture.attempt }).state, "fenced");
      world.database.commitWriteAttempt(fixture.commit, atomicWriteCheckpoint(fixture.commit));
    }
    const report = world.projection.buildActivityReportWire(DAY, DAY);
    assert.deepEqual(report.ledger, {
      systems: [{ system: "ucpath", entries: 2, prod: 1, test: 1 }],
    });
    assert.deepEqual(world.projection.buildDashboardDayWire(DAY).monthCounts, payload.monthCounts);
    assert.deepEqual(world.projection.buildDashboardDayWire(DAY).statusCounts, payload.statusCounts);
    assert.deepEqual(world.projection.buildDashboardDayWire(DAY).workflowCounts, payload.workflowCounts);
    assert.equal(report.totalRuns, 6);
  });
});
