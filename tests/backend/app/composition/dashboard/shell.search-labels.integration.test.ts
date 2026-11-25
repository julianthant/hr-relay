import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it, vi } from "vitest";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { composeShell } from "../../../../../src/backend/app/composition/dashboard/shell.js";
import { READABLE_WORKFLOW_MODULES, SERVER_REGISTRY } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { queueRowTitle } from "../../../../../src/dashboard/surfaces/queue/queue-model.js";
import { RunRecordSchema, type RunRecord } from "../../../../../src/models/run/record.js";
import { PersonLookupInput } from "../../../../../src/models/workflows/person-lookup/input.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { searchResults } from "../../../../../src/dashboard/state/search-wiring-adapter.js";
import { CrossDateSearchQuerySchema } from "../../../../../src/models/dashboard/search.js";
import { ActorIdSchema, FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { makeWorld, runRecordOf, uuidOf } from "../../../../support/helpers/backend/dashboard-harness.js";

async function fixture() {
  const profile = await createBoundProfileFixture();
  const world = await makeWorld({ profileFixture: async () => profile,
    descriptors: { resolve: id => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor } });
  const { database, clock, projection } = world;
  const artifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
  await artifacts.ready;
  const shell = composeShell({
    database, clock, ids: { uuid: randomUUID }, artifacts,
    descriptors: { resolve: id => SERVER_REGISTRY[id]?.descriptor },
    appVersion: "test", actorLabel: () => "Test operator", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    preflightReport: () => { throw new Error("unused preflight"); },
    workbookCompatibility: () => { throw new Error("unused workbooks"); },
    activity: { read: () => { throw new Error("unused activity"); }, readSelected: () => { throw new Error("unused activity"); } },
    projection,
    backfillGaps: { detected: () => { throw new Error("unused gap"); } },
  });
  return { database, shell, clock, projection,
    seed: (run: RunRecord) => { world.authority.put(run); database.authority.runs.enqueue(run); },
    close: async () => { shell.hub.close(); await world.dispose(); } };
}

it("labels hidden child workflows in served search without adding them to public starts", async () => {
  const { shell, seed, close } = await fixture();
  try {
    seed(runRecordOf({ seed: 4101, workflow: "onboarding", shape: "operation", displayName: "Intake packet" }));
    seed(runRecordOf({ seed: 4102, parentSeed: 4101, workflow: "i9-lookup", displayName: "Lookup request" }));
    const page = shell.search.search({ q: "", facets: { workflow: "i9-lookup" } });
    assert.equal(page.results.length, 1);
    assert.deepEqual(page.results[0].registration, { state: "registered", label: "I-9 Lookup", code: "il", categoryId: "search" });
    assert.equal(SERVER_REGISTRY["i9-lookup"], undefined);
  } finally { await close(); }
});

it("uses queue display names for children, unidentified runs and members without indexing those names", async () => {
  const { database, shell, clock, projection, seed, close } = await fixture();
  try {
    const parent = runRecordOf({ seed: 4111, workflow: "i9-lookup", shape: "operation", displayName: "Intake packet" });
    const runs = [parent,
      runRecordOf({ seed: 4112, parentSeed: 4111, workflow: "i9-lookup", displayName: "Lookup request" }),
      runRecordOf({ seed: 4113, workflow: "person-lookup", displayName: "Pending identification" }),
      runRecordOf({ seed: 4114, parentSeed: 4111, workflow: "i9-lookup", shape: "operation-member", displayName: "Approved record" }),
    ];
    for (const run of runs) seed(run);
    const unnamed = runRecordOf({ seed: 4115 });
    runs.push(unnamed);
    seed(unnamed);
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 }).emit(runQueuedSpanEvent({
      run: unnamed, title: "Known queued request", actorId: ActorIdSchema.parse("synthetic-operator"),
    }));
    const unrecorded = runRecordOf({ seed: 4116 });
    seed(unrecorded);
    const query = CrossDateSearchQuerySchema.parse({ q: "" });
    const page = shell.search.search(query);
    assert.ok(page.results.every(row => row.metadata.subject.state === "unavailable"));
    const results = searchResults({ ...page, query });
    const queue = projection.queueSurfaces([...runs, unrecorded].map(run => run.envelope.runId));
    for (const run of runs) {
      const queued = queue.find(row => row.runId === run.envelope.runId);
      assert.ok(queued);
      if (run.displayName !== undefined) assert.equal(queueRowTitle(queued), run.displayName);
      assert.equal(results.find(row => row.id === run.envelope.runId)?.subject, queueRowTitle(queued));
    }
    const unrecordedQueue = projection.queueSurface(unrecorded.envelope.runId);
    assert.ok(unrecordedQueue);
    assert.equal(results.find(row => row.id === unrecorded.envelope.runId)?.subject, queueRowTitle(unrecordedQueue));
    assert.equal(shell.search.search({ q: "Pending identification" }).totalMatches, 0);
    assert.equal(shell.search.search({ q: "Known queued request" }).totalMatches, 0);
    assert.ok(results.every(row => row.workflow !== page.results.find(result => result.runId === row.id)?.workflowId));
  } finally { await close(); }
});

it("serves the visible Queue title for known input without a retained queued event", async () => {
  const { shell, seed, projection, close } = await fixture();
  try {
    const base = runRecordOf({ seed: 4201, descriptor: personLookupDescriptor });
    const input = PersonLookupInput.parse({ name: "SYNTHETIC, REQUEST" });
    const run = RunRecordSchema.parse({ ...base, input: { ...base.input, raw: input, parsed: { ...base.input.parsed, value: input } } });
    seed(run);
    const queue = projection.queueSurface(run.envelope.runId);
    assert.ok(queue);
    assert.notEqual(queueRowTitle(queue), run.envelope.workflow);
    const buildQueue = vi.spyOn(projection, "queueSurfaces");
    const query = CrossDateSearchQuerySchema.parse({ q: "" });
    const page = shell.search.search(query);
    assert.equal(searchResults({ ...page, query })[0].subject, queueRowTitle(queue));
    assert.equal(buildQueue.mock.calls.length, 0);
  } finally { await close(); }
});

it("withholds a protected-input rename at the served search and adapter boundary", async () => {
  const { shell, seed, projection, close } = await fixture();
  try {
    const base = runRecordOf({ seed: 4202, descriptor: personLookupDescriptor, displayName: "Withheld operator name" });
    const input = PersonLookupInput.parse({ emplId: "10000001" });
    const run = RunRecordSchema.parse({ ...base, input: { ...base.input, raw: input,
      parsed: { ...base.input.parsed, value: input, protectedBindings: [
        { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: uuidOf(99) },
      ] } } });
    seed(run);
    const queue = projection.queueSurface(run.envelope.runId);
    assert.ok(queue);
    assert.deepEqual(queue.displayName, { state: "absent", reason: "the operator's display name is withheld because this run carries protected input" });
    const query = CrossDateSearchQuerySchema.parse({ q: "" });
    const page = shell.search.search(query);
    assert.equal(JSON.stringify(page).includes("Withheld operator name"), false);
    assert.equal(searchResults({ ...page, query })[0].subject, queueRowTitle(queue));
  } finally { await close(); }
});
