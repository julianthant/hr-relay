import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { composeShell } from "../../../../../src/backend/app/composition/dashboard/shell.js";
import { SERVER_REGISTRY } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { queryQueueSummaries } from "../../../../../src/backend/runs/queries/queue-summaries.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { searchResults } from "../../../../../src/dashboard/state/search-wiring-adapter.js";
import { CrossDateSearchQuerySchema } from "../../../../../src/models/dashboard/search.js";
import { ActorIdSchema, FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

async function fixture() {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-09-21T12:00:00Z"));
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 500, migrationOwner: "shell-search-labels" }, clock);
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const artifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
  await artifacts.ready;
  const shell = composeShell({
    database, clock, ids: { uuid: randomUUID }, artifacts,
    descriptors: { resolve: id => SERVER_REGISTRY[id]?.descriptor },
    appVersion: "test", actorLabel: () => "Test operator", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    preflightReport: () => { throw new Error("unused preflight"); },
    workbookCompatibility: () => { throw new Error("unused workbooks"); },
    activity: { read: () => { throw new Error("unused activity"); }, readSelected: () => { throw new Error("unused activity"); } },
    projection: { onChange: () => () => {}, health: () => ({ state: "live" }), generation: () => 0,
      cursor: () => "pc:1", descriptorSetHash: () => "a".repeat(64), buildDashboardDayWire: () => { throw new Error("unused day"); } },
    backfillGaps: { detected: () => { throw new Error("unused gap"); } },
  });
  return { database, shell, clock, close: async () => { shell.hub.close(); database.close(); await profile.close(); } };
}

it("labels hidden child workflows in served search without adding them to public starts", async () => {
  const { database, shell, close } = await fixture();
  try {
    database.authority.runs.enqueue(runRecordOf({ seed: 4101, workflow: "onboarding", shape: "operation", displayName: "Intake packet" }));
    database.authority.runs.enqueue(runRecordOf({ seed: 4102, parentSeed: 4101, workflow: "i9-lookup", displayName: "Lookup request" }));
    const page = shell.search.search({ q: "", facets: { workflow: "i9-lookup" } });
    assert.equal(page.results.length, 1);
    assert.deepEqual(page.results[0].registration, { state: "registered", label: "I-9 Lookup", code: "il", categoryId: "search" });
    assert.equal(SERVER_REGISTRY["i9-lookup"], undefined);
  } finally { await close(); }
});

it("uses queue display names for children, unidentified runs and members without indexing those names", async () => {
  const { database, shell, clock, close } = await fixture();
  try {
    const parent = runRecordOf({ seed: 4111, workflow: "i9-lookup", shape: "operation", displayName: "Intake packet" });
    const runs = [parent,
      runRecordOf({ seed: 4112, parentSeed: 4111, workflow: "i9-lookup", displayName: "Lookup request" }),
      runRecordOf({ seed: 4113, workflow: "person-lookup", displayName: "Pending identification" }),
      runRecordOf({ seed: 4114, parentSeed: 4111, workflow: "i9-lookup", shape: "operation-member", displayName: "Approved record" }),
    ];
    for (const run of runs) database.authority.runs.enqueue(run);
    const unnamed = runRecordOf({ seed: 4115 });
    runs.push(unnamed);
    database.authority.runs.enqueue(unnamed);
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 }).emit(runQueuedSpanEvent({
      run: unnamed, title: "Known queued request", actorId: ActorIdSchema.parse("synthetic-operator"),
    }));
    const unrecorded = runRecordOf({ seed: 4116 });
    database.authority.runs.enqueue(unrecorded);
    const query = CrossDateSearchQuerySchema.parse({ q: "" });
    const page = shell.search.search(query);
    assert.ok(page.results.every(row => row.metadata.subject.state === "unavailable"));
    const results = searchResults({ ...page, query });
    const queue = queryQueueSummaries(database, { limit: 20, topLevel: false });
    for (const run of runs) {
      const queued = queue.items.find(row => row.runId === run.envelope.runId);
      assert.ok(queued);
      assert.equal(queued.title, run.displayName ?? "Known queued request");
      assert.equal(results.find(row => row.id === run.envelope.runId)?.subject, queued.title);
    }
    assert.equal(results.find(row => row.id === unrecorded.envelope.runId)?.subject, "person-lookup");
    assert.equal(queue.items.find(row => row.runId === unrecorded.envelope.runId)?.title, "person-lookup");
    assert.equal(shell.search.search({ q: "Pending identification" }).totalMatches, 0);
    assert.equal(shell.search.search({ q: "Known queued request" }).totalMatches, 0);
    assert.ok(results.every(row => row.workflow !== page.results.find(result => result.runId === row.id)?.workflowId));
  } finally { await close(); }
});
