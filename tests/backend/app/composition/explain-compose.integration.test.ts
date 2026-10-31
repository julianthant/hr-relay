import { createClonedProfileFixtures, profileFixtureStorageAdmission, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import { TargetNotFoundError } from "../../../../src/backend/runs/commands/refusals.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";
import { mkdtempSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { composeExplainRuntime,explainRunFrom,parseDiagnosticArgs } from "../../../../src/backend/app/composition/explain-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { appendEmergencyFault,readEmergencyFaults } from "../../../../src/backend/logs/emergency-faults.js";
import { renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { TimelineAppend } from "../../../../src/models/events/timeline.js";
import { RunIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
EXIT_RUN_ID,
EXIT_TRACE_ID,
seedPersonLookupExitRun,
} from "../../../support/fixtures/receipt-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profiles = createClonedProfileFixtures();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const profile of heldProfiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function seeded(): Promise<AuthorityDatabase> {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot;
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "explain-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), { path: join(root, "state.db"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  seedPersonLookupExitRun(database);
  return database;
}

describe("explain run", () => {
  it("reads bounded persisted debug categories without attributing global events to a run or changing source inventory", async () => {
    const database = await seeded();
    const root = heldProfiles.at(-1)?.stateRoot; assert.ok(root);
    const writer = createDebugEventWriter({ repository: database.authority.timelineEvents, clock: manualClock(new Date("2026-08-04T00:11:13.500Z")), build: "fixture" });
    for (const category of ["session", "duo", "worker", "http", "sse", "client", "boot"] as const) {
      writer.emit({ category, phase: "failed", correlationId: category, code: "FIXTURE" }, { kind: "transport", connectionId: "fixture" });
    }
    const linked = { category: "http", phase: "failed", correlationId: "linked" };
    const runScope: TimelineAppend["scope"] = { kind: "run", runId: RunIdSchema.parse(EXIT_RUN_ID) };
    assert.throws(() => writer.emit(linked, runScope), /debug-run-workflow-required/u);
    assert.throws(() => writer.emit(linked, runScope, WorkflowIdSchema.parse("separations")), /timeline-event-owner-mismatch/u);
    writer.emit(linked, runScope, WorkflowIdSchema.parse("person-lookup"));
    const runView = explainRunFrom(database, EXIT_RUN_ID);
    assert.equal(runView.debugEvents?.records.length, 1);
    assert.equal(runView.debugEvents?.records[0]?.scope.kind, "run");
    const path = join(root, "state.db");
    const admission = profileFixtureStorageAdmission(path);
    const before = readFileSync(path); const inventory = readdirSync(root, { recursive: true }).sort();
    const sourceBytes = inventory.filter(name => lstatSync(join(root, name)).isFile()).map(name => [name, readFileSync(join(root, name))] as const);
    assert.match(composeExplainRuntime({ admission, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--limit", "2", "--json"] }), /nextCursor/u);
    let after = 0; const categories = new Set<string>();
    for (;;) {
      const page = AuthorityDatabase.inspectTimelinePageReadOnly(admission, path, { after, limit: 2 });
      assert.ok(page.records.length <= 2);
      for (const record of page.records) if (record.payload.kind === "debug") categories.add(record.payload.event.category);
      after = page.nextCursor;
      if (!page.hasMore) break;
    }
    assert.equal(categories.size, 7);
    assert.deepEqual(readFileSync(path), before); assert.deepEqual(readdirSync(root, { recursive: true }).sort(), inventory);
    for (const [name, bytes] of sourceBytes) assert.deepEqual(readFileSync(join(root, name)), bytes);
    assert.throws(() => parseDiagnosticArgs(["--limit", "1001"]));
    assert.throws(() => parseDiagnosticArgs(["--after", "-1"]));
    assert.throws(() => parseDiagnosticArgs(["--boot", "--run", EXIT_RUN_ID]));
  });

  it("reads stopped boot faults without a database and refuses unsafe or incomplete spool bytes", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-explain-boot-")); roots.push(root);
    appendEmergencyFault({ stateRoot: root, build: "fixture", code: "DATABASE_UNAVAILABLE", error: new Error("Bearer SECRET"), now: new Date("2026-08-04T00:11:13.500Z") });
    const path = join(root, "logs", "boot.jsonl"); const before = readFileSync(path);
    const output = composeExplainRuntime({ admission: RuntimeAdmission.syntheticFixture(join(root, "state.db")), isolation: rebuildRuntimeIsolation,
      args: ["diagnostics", "--boot", "--json"] });
    assert.match(output, /DATABASE_UNAVAILABLE/u); assert.equal(output.includes("SECRET"), false);
    assert.deepEqual(readFileSync(path), before); assert.equal(readdirSync(root).includes("state.db"), false);
    writeFileSync(path, "{", { mode: 0o600 }); assert.throws(() => readEmergencyFaults(root), /boot-log-incomplete/u);
    writeFileSync(path, "{\n", { mode: 0o600 }); assert.throws(() => readEmergencyFaults(root), /boot-log-invalid/u);
    writeFileSync(path, Buffer.alloc(5 * 1024 * 1024 + 1)); assert.throws(() => readEmergencyFaults(root), /boot-log-cap-exceeded/u);
    rmSync(path); symlinkSync(join(root, "missing"), path); assert.throws(() => readEmergencyFaults(root), /boot-log-path-unsafe/u);
  });
  it("resolves either identity form to the same explanation", async () => {
    const database = await seeded();
    const byRun = explainRunFrom(database, EXIT_RUN_ID);
    const byTrace = explainRunFrom(database, EXIT_TRACE_ID);
    assert.deepEqual(byTrace, byRun);
    assert.equal(byRun.runId, EXIT_RUN_ID);
    assert.equal(byRun.traceId, EXIT_TRACE_ID);
  });

  it("refuses an identity that is neither form rather than guessing", async () => {
    const database = await seeded();
    assert.throws(() => explainRunFrom(database, "the-run-i-mean"), /neither a run id .* nor a trace id/s);
    assert.throws(
      () => explainRunFrom(database, "00000000-0000-4000-8000-000000000000"),
      (error: unknown) => error instanceof TargetNotFoundError && /absent from canonical authority/.test(error.message),
    );
  });

  it("resolves the node timeline, checkpoint reuse, and terminal outcome", async () => {
    const view = explainRunFrom(await seeded(), EXIT_TRACE_ID);

    assert.equal(view.state, "terminal");
    assert.deepEqual(view.outcome, { state: "present", value: "done" });
    assert.equal(view.attempt, 1);

    const timeline = new Map(view.timeline.map((entry) => [entry.nodeId, entry]));
    assert.equal(timeline.get("searching")?.disposition, "replayed-from-checkpoint");
    assert.match(String(timeline.get("searching")?.detail), /attempt 1/);
    assert.equal(timeline.get("cross-verify")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("active-status")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("crm-dates")?.disposition, "not-run");
    assert.match(String(timeline.get("crm-dates")?.detail), /condition-false/);

    const reuse = new Map(view.reuse.map((entry) => [entry.nodeId, entry]));
    assert.equal(reuse.get("searching")?.kind, "checkpoint");
    assert.equal(reuse.get("cross-verify")?.kind, "fresh-live");
    assert.ok((reuse.get("searching")?.ageMs ?? 0) > 0);
  });

  it("names every absence instead of rendering an empty section", async () => {
    const view = explainRunFrom(await seeded(), EXIT_RUN_ID);
    assert.equal(view.failure.state, "absent");
    assert.equal(view.openGate.state, "absent");
    assert.equal(view.openDependency.state, "absent");
    assert.match(view.notifications.reason, /2g slice/);
    assert.equal(view.commandHistory.state, "absent");
    assert.match(view.commandHistory.reason, /indexes commands by id, not by run/);
    assert.deepEqual(view.writes, [], "a read-only workflow fenced no external write");
  });

  it("carries the receipt's verdicts and a concrete next safe action", async () => {
    const view = explainRunFrom(await seeded(), EXIT_RUN_ID);
    assert.equal(view.receipt.state, "present");
    if (view.receipt.state !== "present") throw new Error("unreachable");
    assert.equal(view.receipt.value.result, "verified-done");
    assert.equal(view.receipt.value.confidence, "verified");
    const mandatory = view.receipt.value.verification.filter((row) => row.mandatory);
    assert.ok(mandatory.length > 0);
    assert.ok(mandatory.every((row) => row.verdict === "verified"), "every mandatory obligation is verified");
    assert.deepEqual(view.receipt.value.warnings, []);
    assert.match(view.nextSafeAction, /Nothing\. This run is settled/);
  });

  it("renders an operator-readable report carrying every ref operator-trust §2.5 section", async () => {
    const text = renderExplainRun(explainRunFrom(await seeded(), EXIT_TRACE_ID));
    for (const heading of [
      "state", "node timeline", "checkpoint reuse", "subject bindings", "failure",
      "last successful action", "open gate", "open dependency", "command history",
      "notifications", "write intent / proof", "evidence receipt", "next safe action",
    ]) {
      assert.ok(text.includes(`  ${heading}\n`), `report is missing the "${heading}" section`);
    }
    assert.match(text, /run 4ebf7275-.* trace pl-000619-4ebf/);
    assert.match(text, /terminal → done/);
    assert.match(text, /identity\.eid-agrees-across-sources\s+verified/);
    // No credential, cookie, or storage-state canary may reach a terminal.
    for (const canary of ["password", "Cookie", "storageState", "PRIVATE KEY"]) {
      assert.ok(!text.includes(canary), `explain output leaked ${canary}`);
    }
  });
});
