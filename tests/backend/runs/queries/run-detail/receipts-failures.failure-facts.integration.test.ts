import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { buildRunSection } from "../../../../../src/backend/runs/queries/run-detail.js";
import { FailureRecordSchema, type FailureRecord } from "../../../../../src/models/trust/failure.js";
import { OnboardingReadHirePlan } from "../../../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingMatchHireSubject } from "../../../../../src/models/workflows/onboarding/match-hire-subject.js";
import { OnboardingReadI9Lookup } from "../../../../../src/models/workflows/onboarding/read-i9-lookup.js";
import { RecordedDataPointSchema } from "../../../../../src/rules/workflow/task-provenance.js";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import { createTaskProvenanceCollector } from "../../../../../src/backend/runs/provenance/task-provenance.js";
import { readPayPathPositionTask } from "../../../../../src/backend/systems/ucpath/tasks/read-paypath-position.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { UcpathReadPayPathPosition } from "../../../../../src/models/systems/ucpath/read-paypath-position.js";
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

async function fixture(kind: "ucpath" | "i9" = "ucpath", { withheld = false, observed = true, failedAt, beforeFailure }: {
  withheld?: boolean;
  observed?: boolean;
  failedAt?: Readonly<{ nodeId: string; taskId: string; code: string }>;
  beforeFailure?: (world: DashboardWorld, failure: FailureRecord) => void | Promise<void>;
} = {}) {
  const module = kind === "ucpath" ? registeredModule(workStudyWorkflow) : onboardingModule;
  const descriptor = module.descriptor;
  const nodeId = kind === "ucpath" ? "paypath-position" : "i9-lookup";
  const code = kind === "ucpath" ? "UNEXPECTED_PAGE_STATE" : "ONBOARDING_I9_LOOKUP_UNRESOLVED";
  const taskId = kind === "ucpath" ? "ucpath/read-paypath-position" : "workflow:onboarding/read-i9-lookup";
  const world = await makeWorld({ profileFixture: () => profiles.create(), descriptors: { resolve: () => descriptor } });
  worlds.push(world);
  const failure = FailureRecordSchema.parse({ ...failureRecordOf({ seed: 41, workflow: descriptor.id, code }),
    nodeId, taskId, ...failedAt, occurredAt: world.clock.now().toISOString(),
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
  if (kind === "i9" && failedAt === undefined) world.writer.emit({ t: "span.ended", kind: "task", ts: failure.occurredAt, workflow: descriptor.id,
    ...address, spanPath: `${failure.traceId}/hire-subject#1`, outcome: "done" });
  await beforeFailure?.(world, failure);
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
  it.each([{ outcome: "Provided", refused: true }, { outcome: "Read", refused: false }])(
    "serves a real PayPath task's recorded fact as $outcome", async ({ outcome, refused }) => {
      const h = await fixture("ucpath", { observed: false, beforeFailure: async (world, failure) => {
        const descriptor = registeredModule(workStudyWorkflow).descriptor;
        const spanPath = `${failure.traceId}/paypath-position#1`;
        const collector = createTaskProvenanceCollector({ descriptor, clock: world.clock, upstreamEvidence: { checkpoints: [] },
          execution: { runId: failure.runId, traceId: failure.traceId, attempt: failure.attempt,
            workflowId: failure.workflowId, nodeId: "paypath-position", taskId: UcpathReadPayPathPosition.id },
          onRecord: batch => world.writer.emit({ t: "data.observed", ts: batch.recordedAt, observedAt: batch.recordedAt,
            workflow: failure.workflowId, runId: failure.runId, traceId: failure.traceId, attempt: failure.attempt,
            spanPath, nodeId: "paypath-position", taskId: UcpathReadPayPathPosition.id,
            points: redactObservedDataPoints(UcpathReadPayPathPosition.id, batch.points) }),
        });
        const output = UcpathReadPayPathPosition.output.parse({ ...UcpathReadPayPathPosition.example,
          position: { ...UcpathReadPayPathPosition.example.position, positionPool: "" } });
        const invoke = () => readPayPathPositionTask.impl.run({ input: UcpathReadPayPathPosition.input.parse({ emplId: "10000001" }), ctx: {
          driver: { ...createDeterministicUcpathPersonOrgDriver(), ...deterministicPayPathOperations(refused
            ? { refusal: "unexpected-page-state" } : { read: output }) },
          signal: new AbortController().signal, recordData: collector.recordData,
          captureScreenshot: async () => undefined, log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
          fail: code => { throw new Error(code); },
        } });
        if (refused) await assert.rejects(invoke(), /unexpected-page-state/u);
        else {
          const read = await invoke();
          assert.deepEqual(read, output);
          assert.ok(collector.finalizeRead(read).points.every(point => point.direction === "read"));
        }
      } });
      const display = h.read().display;
      const label = refused ? "Employee ID" : "Employee";
      assert.equal(display?.lastCompleted, `${outcome} ${label}`);
      assert.deepEqual(display?.field, { label, value: refused ? "10000001" : UcpathReadPayPathPosition.example.displayedName, outcome });
      assert.doesNotMatch(JSON.stringify({ ...display, field: undefined }), /10000001/u);
      h.world.authority.put(RunRecordSchema.parse({ ...h.run, input: { ...h.run.input,
        parsed: { ...h.run.input.parsed, protectedBindings: [{ kind: "test-data-local", sourceId: uuidOf(49),
          inputPath: "emplId", name: "personLookupCanaryEid" }] } } }));
      const protectedDisplay = h.read().display;
      assert.equal(protectedDisplay?.lastCompleted, `${outcome} ${label}`);
      assert.equal(protectedDisplay?.field, undefined);
      assert.doesNotMatch(JSON.stringify(protectedDisplay), /10000001/u);
    },
  );

  it.each([
    { failedAt: { nodeId: "ucpath-source", taskId: "ucpath/search-person-match", code: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" },
      nodeId: "hire-plan", taskId: OnboardingReadHirePlan.id, output: OnboardingReadHirePlan.output.parse({ ...OnboardingReadHirePlan.example,
        employee: { ...OnboardingReadHirePlan.example.employee, ssn: "123456789" } }),
      lastCompleted: "Validate hire data", field: { label: "Position", value: "12345678", outcome: "Read" } },
    { failedAt: { nodeId: "i9-lookup", taskId: String(OnboardingReadI9Lookup.id), code: "ONBOARDING_I9_LOOKUP_UNRESOLVED" },
      nodeId: "hire-subject", taskId: OnboardingMatchHireSubject.id, output: OnboardingMatchHireSubject.output.parse(OnboardingMatchHireSubject.example),
      lastCompleted: "Check UCPath duplicate identity", field: { label: "Hire match", value: "New hire", outcome: "Read" } },
    { failedAt: { nodeId: "hire-findings", taskId: "ucpath/read-hire-findings", code: "UNEXPECTED_PAGE_STATE" },
      nodeId: "i9-lookup", taskId: OnboardingReadI9Lookup.id, output: OnboardingReadI9Lookup.output.parse(OnboardingReadI9Lookup.example),
      lastCompleted: "Retain delegated I-9 lookup", field: { label: "I-9 status", value: "Not found", outcome: "Read" } },
  ])("serves the last recorded Onboarding values before $failedAt.nodeId fails", async testCase => {
    const h = await fixture("i9", {
      failedAt: testCase.failedAt,
      beforeFailure: (world, failure) => {
        const spanPath = `${failure.traceId}/${testCase.nodeId}#1`;
        const points = Object.entries<unknown>(testCase.output).map(([field, value]) => RecordedDataPointSchema.parse({
          direction: "read", field, value, recordedAt: failure.occurredAt,
          execution: { runId: failure.runId, traceId: failure.traceId, attempt: failure.attempt,
            workflowId: failure.workflowId, nodeId: testCase.nodeId, taskId: testCase.taskId },
        }));
        world.writer.emit({ t: "data.observed", ts: failure.occurredAt, observedAt: failure.occurredAt,
          workflow: failure.workflowId, runId: failure.runId, traceId: failure.traceId, attempt: failure.attempt,
          spanPath, nodeId: testCase.nodeId, taskId: testCase.taskId, points: redactObservedDataPoints(testCase.taskId, points) });
        world.writer.emit({ t: "span.ended", kind: "task", ts: failure.occurredAt, workflow: failure.workflowId,
          runId: failure.runId, traceId: failure.traceId, attempt: failure.attempt, spanPath, outcome: "done" });
      },
    });
    const display = h.read().display;
    assert.equal(display?.lastCompleted, testCase.lastCompleted);
    assert.deepEqual(display?.field, testCase.field);
    assert.doesNotMatch(JSON.stringify(display), /123456789|2000-01-14|employee\.dob|employee\.ssn/u);
  });

  it("serves the failed read, catalog reason, attempted action, completed fact, value and existing retry command", async () => {
    const h = await fixture();
    const failure = h.read();
    assert.deepEqual(failure.display, {
      title: "Open PayPath Actions for the employee",
      observation: "The expected page did not appear. Review the current page.",
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
    assert.equal(failure.display?.observation, "The I-9 lookup found nothing for this hire. No profile was created.");
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
    assert.deepEqual(row.liveMessage, { state: "present", value: "The expected page did not appear. Review the current page." });
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
