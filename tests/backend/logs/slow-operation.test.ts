import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { composeSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { composeWorkerRuntime } from "../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import type { DebugEvent } from "../../../src/models/events/timeline.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
import { admitFixtureSlot } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { duoCeremonyGatesOver } from "../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler } from "../../support/helpers/phase1f-executor-harness.js";

const AT = new Date("2026-11-14T12:00:00.000Z");

function slowOperationEvents(database: AuthorityDatabase): DebugEvent[] {
  return database.authority.timelineEvents.page({}).flatMap(record =>
    record.payload.kind === "debug" && record.payload.event.reason === "slow-operation" ? [record.payload.event] : []);
}

function assertSlowOperation(event: DebugEvent | undefined, category: "http" | "worker"): void {
  assert.ok(event);
  assert.equal(event.category, category);
  assert.equal(event.phase, "settled");
  assert.equal(event.area, "storage");
  assert.equal(event.reason, "slow-operation");
  assert.equal(event.code, "authority-transaction");
  assert.equal(event.durationMs, 51);
  assert.match(event.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
  assert.equal(event.message, undefined);
  assert.equal(event.stack, undefined);
  const text = JSON.stringify(event);
  assert.equal(text.includes("fixture@"), false);
  assert.equal(text.includes("SELECT"), false);
  assert.equal(text.includes("disposable"), false);
}

describe("slow storage operations in the debug report", () => {
  it("records one event from the dashboard backend", async () => {
    const profile = await createBoundProfileFixture();
    const clock = manualClock(AT);
    const context = composeSelectedProfileStorage({ machineAdmission: profile.machine, admission: profile.admission,
      credentials: boundProfileCredentials(profile.admission), hostFacts: { primaryDisplay: null }, clock });
    try {
      context.database.withAuthorityTransaction(() => { clock.advanceMonotonic(51); });
      const events = slowOperationEvents(context.database);
      assert.equal(events.length, 1);
      assertSlowOperation(events[0], "http");
    } finally {
      await context.account.close();
      context.database.close();
      await profile.close();
    }
  });

  it("records one event from a workflow worker", async () => {
    const profile = await createBoundProfileFixture();
    const clock = manualClock(AT);
    for (const name of ["package.json", "package-lock.json"]) writeFileSync(join(profile.workspace, name), readFileSync(join(process.cwd(), name)));
    const context = composeSelectedProfileStorage({ machineAdmission: profile.machine, admission: profile.admission,
      credentials: boundProfileCredentials(profile.admission), hostFacts: { primaryDisplay: null }, clock });
    try {
      context.database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, "person-lookup", 1, clock.now().toISOString()));
      let events: DebugEvent[] = [];
      const report = await composeWorkerRuntime({
        lifetimeLock: profile.lifetime, admission: profile.machine, repoRoot: profile.workspace, isolation: rebuildRuntimeIsolation,
        args: ["person-lookup", "--pool-index", "1", "--drain"], clock, env: {},
        preflightRunnerFactory: healthyRuntimePreflightRunners,
        duoCeremony: duoCeremonyGatesOver(context.database, clock, new ManualScheduler(clock)),
        sessionFactory: { probeProfile: async () => undefined, open: () => { throw new Error("no browser may open"); } },
        write: () => undefined,
        closeDatabase(database) {
          database.withAuthorityTransaction(() => { clock.advanceMonotonic(51); });
          events = slowOperationEvents(database);
          database.close();
        },
      });
      assert.equal(report.stopped, "idle");
      assert.equal(events.length, 1);
      assertSlowOperation(events[0], "worker");
    } finally {
      await context.account.close();
      context.database.close();
      await profile.close();
    }
  });
});
