import * as profileCredentials from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileFixtureSet, installationAdmission, profileFixtureStorageAdmission, releaseAdmissionFixture, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import { TargetNotFoundError } from "../../../../src/backend/runs/commands/refusals.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";
import { z } from "zod";
import { mkdtempSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { composeExplainRuntime,explainRunFrom,parseDiagnosticArgs } from "../../../../src/backend/app/composition/explain-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { appendEmergencyFault } from "../../../../src/backend/logs/emergency-faults.js";
import { readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import type { TimelineAppend } from "../../../../src/models/events/timeline.js";
import { RunIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
EXIT_RUN_ID,
EXIT_TRACE_ID,
seedPersonLookupExitRun,
} from "../../../support/fixtures/receipt-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  for (const profile of heldProfiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function seeded(seedRun = true): Promise<AuthorityDatabase> {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot;
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "explain-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), { path: join(root, "state.db"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  if (seedRun) seedPersonLookupExitRun(database);
  return database;
}

describe("explain run", () => {
  it("reads bounded persisted debug categories without attributing global events to a run or changing source inventory", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const root = profile.stateRoot;
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
    const before = readFileSync(path); const inventory = readdirSync(root, { recursive: true, encoding: "utf8" }).sort();
    const sourceBytes = inventory.filter(name => lstatSync(join(root, name)).isFile()).map(name => [name, readFileSync(join(root, name))] as const);
    const output = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--limit", "2", "--json"] });
    assert.match(output, /nextCursor/u);
    let after = 0; const categories = new Set<string>();
    for (;;) {
      const page = AuthorityDatabase.inspectTimelinePageReadOnly(admission, path, { after, limit: 2 });
      assert.ok(page.records.length <= 2);
      const rendered = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation,
        args: ["diagnostics", "--after", String(after), "--limit", "2", "--json"] });
      const view = z.object({ records: z.array(z.object({ eventId: z.string(),
        payload: z.object({ kind: z.literal("debug"), event: z.object({ level: z.literal("error") }) }) })) }).parse(JSON.parse(rendered));
      assert.deepEqual(view.records.map(record => record.eventId), page.records.map(record => record.eventId));
      for (const record of page.records) if (record.payload.kind === "debug") {
        categories.add(record.payload.event.category);
        assert.equal("level" in record.payload.event, false);
      }
      after = page.nextCursor;
      if (!page.hasMore) break;
    }
    assert.equal(categories.size, 7);
    assert.deepEqual(readFileSync(path), before); assert.deepEqual(readdirSync(root, { recursive: true, encoding: "utf8" }).sort(), inventory);
    for (const [name, bytes] of sourceBytes) assert.deepEqual(readFileSync(join(root, name)), bytes);
    assert.throws(() => parseDiagnosticArgs(["--limit", "1001"]));
    assert.throws(() => parseDiagnosticArgs(["--after", "-1"]));
    assert.throws(() => parseDiagnosticArgs(["--boot", "--run", EXIT_RUN_ID]));
  });

  it("reads stopped boot faults without a database and refuses unsafe or incomplete spool bytes", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-explain-boot-")); roots.push(root);
    appendEmergencyFault({ stateRoot: root, build: "fixture", code: "DATABASE_UNAVAILABLE", error: new Error("Bearer SECRET"), now: new Date("2026-08-04T00:11:13.500Z"),
      area: "worker-startup", reason: "database-unavailable" });
    const path = join(root, "logs", "boot.jsonl"); const before = readFileSync(path);
    const output = composeExplainRuntime({ admission: RuntimeAdmission.syntheticFixture(join(root, "state.db")), isolation: rebuildRuntimeIsolation,
      args: ["diagnostics", "--boot", "--json"] });
    assert.match(output, /DATABASE_UNAVAILABLE/u); assert.equal(output.includes("SECRET"), false);
    assert.match(output, /"level": "error"/u);
    assert.deepEqual(readFileSync(path), before); assert.equal(readdirSync(root).includes("state.db"), false);
    writeFileSync(path, "{", { mode: 0o600 }); assert.throws(() => readLocalDebugLog(root), /boot-log-incomplete/u);
    writeFileSync(path, "{\n", { mode: 0o600 }); assert.throws(() => readLocalDebugLog(root), /boot-log-invalid/u);
    writeFileSync(path, Buffer.alloc(5 * 1024 * 1024 + 1)); assert.throws(() => readLocalDebugLog(root), /boot-log-cap-exceeded/u);
    rmSync(path); symlinkSync(join(root, "missing"), path); assert.throws(() => readLocalDebugLog(root), /boot-log-path-unsafe/u);
  });
  it("composes CLI explanations from the selected person's authority without creating machine authority", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    explainRunFrom(database, EXIT_RUN_ID);
    const generation = database.getMeta().authorityGeneration;
    const byRun = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["run", EXIT_RUN_ID, "--json"] });
    const byTrace = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["run", EXIT_TRACE_ID, "--json"] });
    assert.equal(byRun, byTrace);
    assert.equal(z.object({ runId: z.string() }).parse(JSON.parse(byRun)).runId, EXIT_RUN_ID);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.equal(readdirSync(profile.machine.stateRoot).includes("state.db"), false);
    profile.machine.assertLive(); profile.admission.assertLive();
  });

  it("refuses a missing profile selection before reading credentials or opening authority", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-explain-unselected-"))); roots.push(root);
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      const machine = installationAdmission(root, lifetime);
      assert.equal(machine.readProfileRegistry().activeProfileId, null);
      const credentials = vi.spyOn(profileCredentials, "createCredentialStore");
      assert.throws(() => composeExplainRuntime({ admission: machine, isolation: rebuildRuntimeIsolation, args: ["run", EXIT_RUN_ID] }), /profile-session-stale/u);
      assert.equal(credentials.mock.calls.length, 0);
      assert.equal(readdirSync(machine.stateRoot).includes("profiles"), false);
    } finally { releaseAdmissionFixture(root); await lifetime.close(); }
  });

  it("routes diagnostics --run to the selected profile's authority without machine authority or credential reads", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const writer = createDebugEventWriter({ repository: database.authority.timelineEvents, clock: manualClock(new Date("2026-08-04T00:11:13.500Z")), build: "fixture" });
    writer.emit({ category: "http", phase: "failed", correlationId: "run-scoped" }, { kind: "run", runId: RunIdSchema.parse(EXIT_RUN_ID) }, WorkflowIdSchema.parse("person-lookup"));
    const expected = AuthorityDatabase.inspectTimelinePageReadOnly(profile.admission, profile.path, { runId: RunIdSchema.parse(EXIT_RUN_ID), after: 0, limit: 100 });
    assert.ok(expected.records.length > 0);
    const generation = database.getMeta().authorityGeneration;
    const before = readFileSync(profile.path);
    const inventory = readdirSync(profile.stateRoot, { recursive: true, encoding: "utf8" }).sort();
    const machineInventory = readdirSync(profile.machine.stateRoot).sort();
    const credentials = vi.spyOn(profileCredentials, "createCredentialStore");
    const output = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] });
    const view = z.object({ records: z.array(z.object({ eventId: z.string(), cursor: z.number() })), nextCursor: z.number() }).parse(JSON.parse(output));
    assert.deepEqual(view.records.map(record => [record.eventId, record.cursor]), expected.records.map(record => [record.eventId, record.cursor]));
    assert.equal(view.nextCursor, expected.nextCursor);
    assert.equal(credentials.mock.calls.length, 0);
    assert.deepEqual(readFileSync(profile.path), before);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(readdirSync(profile.stateRoot, { recursive: true, encoding: "utf8" }).sort(), inventory);
    assert.deepEqual(readdirSync(profile.machine.stateRoot).sort(), machineInventory);
    assert.equal(machineInventory.includes("state.db"), false);
    profile.machine.assertLive(); profile.admission.assertLive();
  });

  it("refuses a diagnostics run that belongs to another profile's authority", async () => {
    await seeded();
    await seeded(false);
    const profile = heldProfiles.at(-1); assert.ok(profile);
    assert.notEqual(profile.machine, heldProfiles[0]?.machine);
    assert.throws(() => composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] }), /timeline-event-owner-missing/u);
    profile.machine.assertLive(); profile.admission.assertLive();
  });

  it("refuses diagnostics --run with a missing profile selection before reading credentials", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-explain-diag-unselected-"))); roots.push(root);
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      const machine = installationAdmission(root, lifetime);
      assert.equal(machine.readProfileRegistry().activeProfileId, null);
      const credentials = vi.spyOn(profileCredentials, "createCredentialStore");
      assert.throws(() => composeExplainRuntime({ admission: machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] }), /profile-session-stale/u);
      assert.equal(credentials.mock.calls.length, 0);
      assert.equal(readdirSync(machine.stateRoot).includes("profiles"), false);
    } finally { releaseAdmissionFixture(root); await lifetime.close(); }
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
