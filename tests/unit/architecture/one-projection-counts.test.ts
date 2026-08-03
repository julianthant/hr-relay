/**
 * D81 — ONE projection owns every count (doc 03 §10.1; doc 10 §3.13).
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
 * 2. FIXTURE — a seeded world containing hidden, delegated (operation +
 *    members), rejected/failed, gated, and terminal rows proves Workflow
 *    Panel total == Status Bar sum == rendered Queue Panel row count BY
 *    CONSTRUCTION, folded and served from the one payload. (Archived rows
 *    join this fixture when the D80 archive service lands in 2i — archive
 *    state is not yet representable in this tree.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, it } from "vitest";
import {
  claimEventOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  DAY,
  type DashboardWorld,
} from "../server/helpers/dashboard-harness.js";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

const COUNT_FIELDS = new Set(["monthCounts", "workflowCounts", "statusCounts"]);
const THE_PROJECTION = "src/server/dashboard/projectors/run-queue-projection.ts";

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
  it("allows count construction in exactly one production module: the run/queue projection", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");
      // src/domain/** DECLARES the wire fields as zod schema keys; declaring
      // a contract is not computing a count. Every executable surface path —
      // server, client, core, workflows — stays in scope.
      if (relativePath.startsWith("src/domain/")) continue;
      const constructions = countFieldConstructions(file);
      if (constructions.length === 0) continue;
      if (relativePath !== THE_PROJECTION) {
        offenders.push(`${relativePath}: builds ${[...new Set(constructions)].join(", ")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a count/aggregate reachable from a surface may only originate in the one run/queue projection",
    );
    // The one legal constructor must actually exist — an empty scan proves
    // nothing once files move.
    assert.ok(
      countFieldConstructions(`${REPO_ROOT}/${THE_PROJECTION}`).length >= 3,
      "the run/queue projection must be the module that builds the count fields",
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
    queuedEventOf(world, { seed: 3, hidden: true }); // hidden — in no rendering
    queuedEventOf(world, { seed: 4, shape: "operation" }); // delegated group
    queuedEventOf(world, { seed: 5, shape: "operation-member", parentSeed: 4 });
    queuedEventOf(world, { seed: 6, shape: "operation-member", parentSeed: 4 });
    queuedEventOf(world, { seed: 7 }); // rejected/failed terminal
    world.writer.emit({
      t: "span.ended", kind: "run", ts: world.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(7), attempt: 1, traceId: `pl-100007-${uuidOf(7).slice(0, 4)}`,
      spanPath: `pl-100007-${uuidOf(7).slice(0, 4)}`, outcome: "failed", failureId: uuidOf(9007),
    });
    world.authority.put(runRecordOf({
      seed: 7,
      lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:20:00.000Z", failureId: uuidOf(9007) },
      version: 3,
    }));
    queuedEventOf(world, { seed: 8 }); // parked on an operator gate
    world.writer.emit({
      t: "gate.opened", ts: world.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(8), attempt: 1, traceId: `pl-100008-${uuidOf(8).slice(0, 4)}`,
      spanPath: `pl-100008-${uuidOf(8).slice(0, 4)}`, gate: "approval",
    });

    const payload = world.projection.buildDashboardDayWire(DAY);

    // The three renderings, each read off the ONE payload:
    const workflowPanelTotal = payload.workflowCounts.reduce((sum, { count }) => sum + count, 0);
    const statusBarSum = payload.statusCounts.reduce((sum, { count }) => sum + count, 0);
    const renderedQueueRows = payload.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member").length;

    assert.equal(workflowPanelTotal, statusBarSum);
    assert.equal(statusBarSum, renderedQueueRows);
    assert.equal(renderedQueueRows, 5); // 1,2,4,7,8 — hidden gone, members contained

    // Containment applied once, inside the projection: the members ride flat
    // for layout, counted only in their operation's rollup.
    const operation = payload.queueSurfaces.find(({ runId }) => runId === uuidOf(4));
    if (operation?.surfaceKind !== "operation") assert.fail("the delegated group must project as an operation");
    assert.equal(operation.memberRollup.total, 2);
    assert.equal(payload.queueSurfaces.some(({ runId }) => runId === uuidOf(3)), false);

    // And the month calendar rendering descends from the same fold.
    assert.deepEqual(payload.monthCounts, [{ day: DAY, count: 5 }]);
  });
});
