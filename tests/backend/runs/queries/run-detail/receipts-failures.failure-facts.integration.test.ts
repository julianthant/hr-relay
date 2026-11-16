import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { buildRunSection } from "../../../../../src/backend/runs/queries/run-detail.js";
import { FailureRecordSchema } from "../../../../../src/models/trust/failure.js";
import { workStudyWorkflow } from "../../../../../src/workflows/work-study/workflow.js";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { makeWorld, queuedEventOf, runEndedEventOf, failureRecordOf, uuidOf, traceOf, type DashboardWorld } from "../../../../support/helpers/backend/dashboard-harness.js";
import { onboardingModule, personLookupDescriptor, registeredModule } from "../../../../support/helpers/registered-workflows.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { dataOriginViewsOf } from "../../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { trustWorld } from "../../../../support/helpers/backend/trust-authority-fixture.js";

const profiles = createProfileFixtureSet();
const worlds: DashboardWorld[] = [];
const trustWorlds: Awaited<ReturnType<typeof trustWorld>>[] = [];
afterAll(() => profiles.close());
afterEach(async () => {
  for (const world of trustWorlds.splice(0)) await world.dispose();
  for (const world of worlds.splice(0)) await world.dispose();
});

async function fixture(kind: "ucpath" | "i9" = "ucpath", { withheld = false, observed = true } = {}) {
  const module = kind === "ucpath" ? registeredModule(workStudyWorkflow) : onboardingModule;
  const descriptor = module.descriptor;
  const nodeId = kind === "ucpath" ? "paypath-position" : "i9-lookup";
  const code = kind === "ucpath" ? "UNEXPECTED_PAGE_STATE" : "ONBOARDING_I9_LOOKUP_UNRESOLVED";
  const taskId = kind === "ucpath" ? "ucpath/read-paypath-position" : "workflow:onboarding/read-i9-lookup";
  const world = await makeWorld({ profileFixture: () => profiles.create(), descriptors: { resolve: () => descriptor } });
  worlds.push(world);
  const failure = FailureRecordSchema.parse({ ...failureRecordOf({ seed: 41, workflow: descriptor.id, code }),
    nodeId, taskId, occurredAt: world.clock.now().toISOString(),
    ...(kind === "ucpath" ? { action: { elementId: "ucpath.person-org.eid-input", operation: "read" } } : {}) });
  queuedEventOf(world, { seed: 41, workflow: descriptor.id, descriptor,
    lifecycle: { state: "terminal", outcome: "failed", failureId: failure.failureId, endedAt: failure.occurredAt } });
  world.authority.failures.set(failure.failureId, failure);
  const run = world.authority.getRun(failure.runId);
  assert.ok(run);
  const notes = createNoteTimelineWriter({ repository: world.timeline, clock: world.clock, pid: 4242 });
  const address = { runId: failure.runId, attempt: 1, traceId: failure.traceId,
    spanPath: `${failure.traceId}/${kind === "ucpath" ? nodeId : "ucpath-source"}#1` };
  notes.emitRunAction({ workflow: descriptor.id, address,
    action: { kind: "typed", targetId: "ucpath.person-org.eid-input", value: "10000001", at: failure.occurredAt } }, run);
  notes.emitRunLog({ workflow: descriptor.id, address, level: "step", message: "Untrusted diagnostic text" }, run);
  const observe = (value: string, retained = !withheld) => world.writer.emit({ t: "data.observed", ts: failure.occurredAt,
    observedAt: failure.occurredAt, workflow: descriptor.id, ...address, nodeId, taskId,
    points: [{ direction: "read", field: "emplId", values: [retained
      ? { key: "emplId", state: "allowed", classification: "direct-identifier", transform: "allow", value }
      : { key: "emplId", state: "redacted", classification: "direct-identifier", transform: "drop", rawValue: value }] }] });
  if (kind === "ucpath" && observed) observe("10000001");
  if (kind === "i9") world.writer.emit({ t: "span.ended", kind: "task", ts: failure.occurredAt, workflow: descriptor.id,
    ...address, spanPath: `${failure.traceId}/hire-subject#1`, outcome: "done" });
  runEndedEventOf(world, 41, "failed", { workflow: descriptor.id, failureId: failure.failureId });
  const deps = { runReader: world.runReader, timeline: world.timeline, stateRoot: world.stateRoot,
    projection: world.projection, authority: world.authority, descriptors: { resolve: () => ({ ...descriptor, dataOrigins: dataOriginViewsOf(module) }) },
    canonical: { reader: world.runReader, database: world.database, descriptors: { resolve: () => descriptor } },
    trust: { getFailure: (id: string) => world.authority.getFailure(id), countFailuresByFingerprint: () => 1,
      ensureReceipt: () => { throw new Error("failure facts must not derive or store a receipt"); } } };
  const read = () => {
    const section = buildRunSection(deps, failure.runId, "failure");
    assert.ok(section.section === "failure" && section.payload.state === "available");
    return section.payload.value;
  };
  return { world, failure, run, deps, read, notes, address, observe };
}

describe("served failure card facts", () => {
  it("serves the failed read, catalog reason, attempted action, completed fact, value and existing retry command", async () => {
    const h = await fixture();
    const failure = h.read();
    assert.deepEqual(failure.display, {
      title: "Open PayPath Actions for the employee",
      observation: "The system did not show the expected page. Review the current page before continuing.",
      attemptedAction: "Open PayPath Actions for the employee",
      lastCompleted: "Read Employee ID",
      field: { label: "Employee ID", value: "10000001", outcome: "Read" },
    });
    assert.equal(failure.retry?.kind, "command");
    assert.equal(failure.retry?.kind === "command" && failure.retry.command, "retry");
    assert.equal(failure.retry?.expectedVersion, h.run.version);
    assert.deepEqual(failure.decision?.options.map(({ id, label, send }) => ({ id, label, send })), [
      { id: "retry", label: "Retry step", send: { via: "action", actionKey: "retry-failed-step" } },
    ]);
    assert.doesNotMatch(JSON.stringify(failure.display), /Untrusted diagnostic text/u);
    assert.doesNotMatch(JSON.stringify(failure.display), /Person Org EID input|ucpath\.person-org/u, "registry-only captions do not enter display copy");
    assert.doesNotMatch(JSON.stringify({ ...failure.display, field: undefined }), /10000001/u, "a captured person value never enters a sentence");
  });

  it("serves the unresolved I-9 lookup with its own step, catalog reason and unwritten retry", async () => {
    const h = await fixture("i9");
    const failure = h.read();
    assert.equal(failure.display?.title, "Retain delegated I-9 lookup");
    assert.equal(failure.display?.observation, "The delegated I-9 lookup did not establish a result for this hire. No profile will be created.");
    assert.equal(failure.display?.attemptedAction, "Retain delegated I-9 lookup");
    assert.equal(failure.display?.lastCompleted, "Check UCPath duplicate identity");
    assert.equal(failure.display?.field, undefined, "the preceding tasks declare no operator field for the retained gesture value");
    assert.deepEqual(failure.decision?.options.map(option => option.label), ["Retry step"]);
  });

  it.each(["prepared", "attempting", "unknown", "committed", "verified"] as const)("serves no Retry step for write state %s", async writeState => {
    const h = await fixture();
    h.world.authority.failures.set(h.failure.failureId, FailureRecordSchema.parse({ ...h.failure, writeState, action: { operation: "commit" } }));
    const failure = h.read();
    assert.equal(failure.retry, undefined);
    assert.ok(failure.decision?.options.every(option => option.id !== "retry" && option.id !== "add-note"));
  });

  it("describes a missing capture as absent without claiming a save failed", async () => {
    const failure = (await fixture()).read();
    assert.deepEqual(failure.diagnosticBundle, { state: "absent", reason: "no diagnostic bundle was captured" });
    assert.doesNotMatch(JSON.stringify(failure), /could not be saved/u);
  });

  it("serves only the catalog sentence as the queue failure summary", async () => {
    const h = await fixture();
    h.world.authority.failures.set(h.failure.failureId, FailureRecordSchema.parse({ ...h.failure,
      summary: "[ucpath/read-paypath-position] UNEXPECTED_PAGE_STATE: raw detail — write state at failure: not-attempted" }));
    const row = h.world.projection.queueSurface(h.failure.runId);
    assert.ok(row);
    assert.deepEqual(row.liveMessage, { state: "present", value: "The system did not show the expected page. Review the current page before continuing." });
  });

  it("does not serve retry when a descriptor is unavailable or another run for the item is active", async () => {
    const h = await fixture();
    const missing = buildRunSection({ ...h.deps, canonical: { ...h.deps.canonical, descriptors: { resolve: () => undefined } } }, h.failure.runId, "failure");
    assert.ok(missing.section === "failure" && missing.payload.state === "available");
    assert.equal(missing.payload.value.retry, undefined);
    const { completion: _completion, ...source } = h.run;
    h.world.database.authority.runs.enqueue(RunRecordSchema.parse({ ...source,
      envelope: { ...h.run.envelope, runId: uuidOf(43), traceId: traceOf(43), attempt: 2 }, lifecycle: { state: "queued" }, claimGeneration: 0, version: 1 }));
    assert.equal(h.read().retry, undefined);
  });

  it("keeps actions recorded after the failure out of the last-completed fact and value row", async () => {
    const h = await fixture();
    h.notes.emitRunAction({ workflow: h.failure.workflowId, address: h.address,
      action: { kind: "selected", targetId: "ucpath.person-org.eid-input", value: "Later value", at: h.failure.occurredAt } }, h.run);
    h.observe("Later value");
    const failure = h.read();
    assert.equal(failure.display?.lastCompleted, "Read Employee ID");
    assert.equal(failure.display?.field?.value, "10000001");
  });

  it("omits a redacted observation even when the raw browser action retains a value", async () => {
    const failure = (await fixture("ucpath", { withheld: true })).read();
    assert.equal(failure.display?.lastCompleted, "Read Employee ID");
    assert.equal(failure.display?.field, undefined);
    assert.doesNotMatch(JSON.stringify(failure.display), /10000001/u);
  });

  it("keeps missing facts absent when a first read failed before retaining an observation", async () => {
    const failure = (await fixture("ucpath", { observed: false })).read();
    assert.equal(failure.display?.attemptedAction, "Open PayPath Actions for the employee");
    assert.equal(failure.display?.lastCompleted, undefined);
    assert.equal(failure.display?.field, undefined);
    assert.doesNotMatch(JSON.stringify(failure.display), /10000001|Person Org EID input/u);
  });

  it("omits retained values from a protected-input run", async () => {
    const h = await fixture();
    h.world.authority.put(RunRecordSchema.parse({ ...h.run, input: { ...h.run.input,
      parsed: { ...h.run.input.parsed, protectedBindings: [{ kind: "test-data-local", sourceId: uuidOf(49),
        inputPath: "emplId", name: "personLookupCanaryEid" }] } } }));
    const failure = h.read();
    assert.equal(failure.display?.lastCompleted, "Read Employee ID");
    assert.equal(failure.display?.field, undefined);
    assert.doesNotMatch(JSON.stringify(failure.display), /10000001/u);
  });

  it("serves a retry that the existing lifecycle accepts for an actual unwritten SQLite failure", async () => {
    const h = await trustWorld(profiles.create);
    trustWorlds.push(h);
    const run = h.fail(h.create(451), 452);
    const section = buildRunSection({ ...h.deps, descriptors: { resolve: () => personLookupDescriptor },
      canonical: { reader: h.reader, database: h.database, descriptors: { resolve: () => personLookupDescriptor } } }, run.envelope.runId, "failure");
    assert.ok(section.section === "failure" && section.payload.state === "available");
    const retry = section.payload.value.retry;
    assert.ok(retry);
    const outcome = h.service.retry({ commandId: uuidOf(453), runId: run.envelope.runId,
      expectedVersion: retry.expectedVersion, runtimeConfig: h.runtimeConfig }, personLookupDescriptor);
    assert.ok(outcome.state === "applied");
    assert.equal(outcome.run.envelope.retryOf, run.envelope.runId);
    assert.equal(outcome.run.lifecycle.state, "queued");
  });
});
