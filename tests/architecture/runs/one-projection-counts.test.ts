import { RunRecordSchema } from "../../../src/models/run/record.js";
import { ledgerCommitFixture, fixtureUuid } from "../../support/fixtures/ledger-projection-fixtures.js";
import { seedAtomicWriteOwner, atomicWriteCheckpoint } from "../../support/helpers/timeline-write-fixture.js";
/**
 * D81 — ONE projection owns every count (ref dashboard-surfaces §10.1; ref guards-and-tests §3.13).
 *
 * The recorded bug class: legacy badges, the status strip, and the queue list
 * each derived their own counts, so any two could disagree (≥4 historical
 * fixes). The contract: Workflow Panel badges, Status Bar pills, and Queue
 * Panel rows are three renderings of ONE server payload; a count is never
 * computed a second time.
 *
 * Two mechanical halves:
 *
 * 1. STRUCTURE — the dashboard count fields (`monthCounts`,
 *    `workflowCounts`, `statusCounts`) are CONSTRUCTED in exactly one
 *    production module: the run/queue projection. Any other `src/` module
 *    building one of those keys is a second aggregate path — a route "just
 *    for the badge", a client-side re-derivation — and fails here by file
 *    name. The client may only parse and pass them through.
 *
 * 2. FIXTURE — a seeded world containing delegated (operation + members),
 *    rejected/failed, gated, and terminal rows proves Workflow Panel total ==
 *    Status Bar sum == rendered Queue Panel row count BY CONSTRUCTION, folded
 *    and served from the one payload. An ARCHIVED row is the ONE whole-run
 *    exclusion (D179, and since D234 the only one): it is dropped once, in the
 *    same pass member containment is applied, so a prior-version run leaves the
 *    queue, the workflow badge, the status pill and the month calendar at the
 *    same instant.
 *
 * 3. THE CARVE-OUT (D236) — the Activity report's write-ledger block is the ONE
 *    served total that does not descend from this projection, because the
 *    ledger is a different authority whose entries outlive the runs that filed
 *    them (ref dashboard-surfaces §10.1). An exemption nothing bounds is an exemption anything
 *    can join, so it is pinned from both sides: STRUCTURALLY, a ledger block is
 *    built in exactly one module and consumed only by the retained projection and approved Q port, so another path
 *    over the ledger fails by file name; and BEHAVIOURALLY, filing entries into
 *    the seeded world's ledger must move the block and must move NO count —
 *    "reported beside the totals" is a claim about what does not happen.
 */
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

/**
 * D236's exemption, bounded by file name.
 *
 * `ActivityLedgerBlockSchema` is where a block is BUILT: the domain module
 * declares it and the one ledger read-through parses one. `foldActivityRange`
 * is where a block is ASKED FOR: the read-through offers it and the projection
 * passes it through. Q adds the admitted internal summary consumer. Any other `src/` module naming either identifier is a
 * second counting path over the write ledger — the exact thing D81 deletes,
 * one authority over.
 */
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

function countFieldConstructions(filePath: string): readonly string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    // An object-literal property named monthCounts/workflowCounts/statusCounts
    // is a count being BUILT; reading one off a parsed payload is fine.
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = node.name;
      if (ts.isIdentifier(name) && COUNT_FIELDS.has(name.text)) found.push(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("one-projection-counts (D81)", () => {
  it("keeps queue/status counts in one projection and bounds the admitted Calendar month-count owner", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");
      // src/domain/** DECLARES the wire fields as zod schema keys; declaring
      // a contract is not computing a count. Every executable surface path —
      // server, client, core, workflows — stays in scope.
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

  it("bounds D236's carve-out to one builder and one consumer", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const builders: string[] = [];
    const consumers: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const names = identifiers(file);
      if (names.has("ActivityLedgerBlockSchema")) builders.push(relativePath);
      if (names.has("foldActivityRange")) consumers.push(relativePath);
    }
    // Exact set equality both ways: a NEW module folding the ledger is the
    // second counting path this guard exists to refuse, and a module that
    // stopped doing so means the carve-out moved and this list is now a
    // sentence about nothing.
    assert.deepEqual(
      builders.sort((a, b) => a.localeCompare(b)),
      [...LEDGER_BLOCK_BUILDERS].sort((a, b) => a.localeCompare(b)),
      "a write-ledger block is built in exactly the modules D236 names",
    );
    assert.deepEqual(
      consumers.sort((a, b) => a.localeCompare(b)),
      [...LEDGER_BLOCK_CONSUMERS].sort((a, b) => a.localeCompare(b)),
      "a write-ledger block is asked for in exactly the modules D236 names",
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
    queuedEventOf(world, { seed: 3 }); // D234: every run is rendered
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
    // D179/D80: a prior-version run a bump has archived. It is dropped in the
    // SAME pass member containment is applied, which is why adding it here
    // moves no count on its own — that agreement is the whole property.
    queuedEventOf(world, { seed: 9 });
    world.authority.put(runRecordOf({ seed: 9,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: world.clock.now().toISOString() },
    }));
    world.authority.archived.add(uuidOf(9));
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
    assert.equal(renderedQueueRows, 6); // 1,2,3,4,7,8 — archived gone, members contained

    // Containment applied once, inside the projection: the members ride flat
    // for layout, counted only in their operation's rollup.
    const operation = payload.queueSurfaces.find(({ runId }) => runId === uuidOf(4));
    if (operation?.surfaceKind !== "operation") assert.fail("the delegated group must project as an operation");
    assert.equal(operation.memberRollup.total, 2);
    // The archived row is the one whole run absent from every rendering.
    assert.equal(payload.queueSurfaces.some(({ runId }) => runId === uuidOf(9)), false);

    // And the month calendar rendering descends from the same fold.
    assert.deepEqual(payload.monthCounts, [{ day: DAY, count: 6 }]);

    /*
     * D236 — the carve-out, as the thing that must NOT happen. Two real confirmations
     * are filed into this world's database history, which is a
     * different authority from every row above; the Activity report must report
     * them and every count must be byte-identical to the payload just proved.
     * A block that moved a count would be the second summation path D81 deletes
     * wearing an exemption's clothes.
     */
    // The Activity report refuses a failure breakdown with a hole in it, so
    // the seeded failed run gets its authority record here — the day wire never
    // asked for one, which is why this seed had none until the report joined.
    world.authority.failures.set(
      uuidOf(9007),
      failureRecordOf({ seed: 7, code: "SESSION_LOST", transient: true }),
    );
    for (const [index, instance] of [[0, "prod"], [1, "test"]] as const) {
      const fixture = ledgerCommitFixture(index, { instance, confirmedAt: instantOffsetOf(0),
        runId: fixtureUuid(`one-projection-run-${String(index)}`), itemId: fixtureUuid(`one-projection-item-${String(index)}`) });
      seedAtomicWriteOwner(world.database, fixture.commit);
      assert.equal(world.database.authority.writeIntents.fenceAttempt({ intent: fixture.intent, attempt: fixture.attempt }).state, "fenced");
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
