/**
 * D307 — the executor under step omission.
 *
 * A two-step fixture graph: `read` (a service task that must NEVER run when
 * its step is omitted) feeds `fold`. The `reading` step declares an omission
 * whose producer rebuilds `read` from one typed fact. The proof is the
 * executor's own durable and span evidence, not a stubbed plan.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../src/base/store.js";
import { defineTask } from "../../src/base/task.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/core/run-executor.js";
import { taskSpanPath } from "../../src/core/span-emitter.js";
import { defineTaskContract } from "../../src/domain/contracts/base.js";
import { NodeIdSchema, ScenarioIdSchema, TraceIdSchema, taskId } from "../../src/domain/ids.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import type { StepOmissionDeclaration } from "../../src/domain/workflow/step-omission.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { HASH_A } from "./fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  openAuthorityHarness,
  recordingEmitter,
  recordingLogger,
  sessionManagerFor,
} from "./fixtures/phase1f-executor-harness.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;
const SCENARIO = ScenarioIdSchema.parse("ocr/step-omission-happy");

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);
/**
 * Both nodes borrow the ONE manifest-known, fixture-classified task id
 * (`ocr/extract-form-page`, see `evidence-classification.ts`): the executor
 * resolves impl fingerprints through the generated manifest and refuses an
 * unknown id. Its leaves are the classified ones; the two nodes differ only
 * in what they bind.
 */
const FixtureIo = z.strictObject({ disposition: z.string().min(1), providerState: z.string().min(1) });
const fixtureContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Step omission fixture task",
  effect: "read",
  input: z.strictObject({ disposition: z.string().min(1) }),
  output: FixtureIo,
  errorCodes: ["provider-unavailable"] as const,
  subject: { kind: "none", reason: "step omission fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { disposition: "observed", providerState: "observed!" },
});

const invocations: string[] = [];
const fixtureTask = defineTask(fixtureContract, {
  sessions: [],
  async run({ input, ctx }) {
    invocations.push(input.disposition);
    const providerState = `${input.disposition}!`;
    ctx.recordData([
      { direction: "read", field: "disposition", value: input.disposition },
      { direction: "read", field: "providerState", value: providerState },
    ]);
    return { disposition: input.disposition, providerState };
  },
});

function fixtureDescriptor(
  id: string,
  code: string,
  omission: StepOmissionDeclaration,
  artifactProjections?: readonly Readonly<{
    id: string;
    source: Readonly<{ nodeId: "read" | "fold"; fieldPath: string }>;
    keyFields: readonly [string, ...string[]];
    sink: "xlsx-retention";
    blocking: true;
  }>[],
) {
  const fixtureFlow = flow(FixtureInput)
    .step("read", fixtureContract, { dependsOn: [], replay: "checkpoint", bind: () => ({ disposition: "observed" }) })
    .step("fold", fixtureContract, {
      dependsOn: ["read"],
      replay: "checkpoint",
      bind: ({ outputs }) => ({ disposition: outputs.read.providerState }),
    })
    .build({
      schema: z.strictObject({ folded: z.string().min(1) }),
      dependsOn: ["read", "fold"],
      derive: ({ outputs }) => ({ folded: outputs.fold.providerState }),
    });
  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Step omission fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof FixtureInput>) => `name:${input.name}` },
    presentation: { title: (input: z.output<typeof FixtureInput>) => input.name },
    scenarios: [`${id}/happy`],
    timeline: [
      { key: "reading", label: "Reading", nodes: ["read"], omission },
      { key: "folding", label: "Folding", nodes: ["fold"] },
    ],
    flow: fixtureFlow,
    ...(artifactProjections === undefined ? {} : { artifactProjections }),
  });
}

const FORM = { fields: [{ key: "value", label: "Value", kind: "text" as const }] };
const honestDescriptor = fixtureDescriptor("omission-honest", "oh", {
  form: FORM,
  produces: { read: ({ facts }) => ({ disposition: facts.value, providerState: facts.value }) },
});
const lyingDescriptor = fixtureDescriptor("omission-lying", "ol", {
  form: FORM,
  produces: { read: () => ({ wrong: "shape" }) },
});
const bareDescriptor = fixtureDescriptor("omission-bare", "ob", { form: FORM, produces: {} });
/** Bullet 5 — the asserted node ("read") also declares an artifact projection; an assertion projects nothing. */
const projectingDescriptor = fixtureDescriptor(
  "omission-projecting",
  "op",
  { form: FORM, produces: { read: ({ facts }) => ({ disposition: facts.value, providerState: facts.value }) } },
  [{
    id: "retention-row",
    source: { nodeId: "read", fieldPath: "disposition" },
    keyFields: ["disposition"],
    sink: "xlsx-retention",
    blocking: true,
  }],
);

const registry = defineTaskStoreRegistry([defineServiceStore("ocr", { fixture: fixtureTask })], {
  scenarioIds: [SCENARIO],
  tasks: [{ id: fixtureContract.id, effect: fixtureContract.effect }],
});

function harnessFor(descriptor: AnyWorkflowDescriptor) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    descriptor,
    stores: registry,
    authority: authority.database,
    sessions: sessionManagerFor(happySessionHarness(), authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("a"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
  return { authority, emitter, deps };
}

function queuedRunFor(descriptor: AnyWorkflowDescriptor, stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: { schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: { name: "Battistessa, Johnnie" } },
      ingressSchemaHash: HASH_A,
    },
  };
}

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const claimed = database.authority.runs.claimNext({
    workflow: descriptor.id,
    workerId: WORKER_ID,
    now: new Date("2026-09-01T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration } };
}

describe("executor step omission (D307)", () => {
  it("publishes the producer's output without running the task, and the terminal record cites it as asserted", async () => {
    invocations.length = 0;
    const harness = harnessFor(honestDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(honestDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, honestDescriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    if (outcome.state === "failed") {
      const failure = database.authority.failures.get(outcome.failureId);
      assert.fail(`run failed at ${failure?.nodeId ?? "?"}: ${failure?.summary ?? "?"}`);
    }
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    // Only the fold ran, and it consumed the ASSERTED value, not an observation.
    assert.deepEqual(invocations, ["typed"]);

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    assert.deepEqual(result.result.value, { folded: "typed!" });
    assert.deepEqual(
      result.dependencies.map((dependency) => [dependency.nodeId, dependency.state]),
      [["read", "asserted"], ["fold", "resolved"]],
    );
    const asserted = result.dependencies.find((dependency) => dependency.nodeId === "read");
    assert.ok(asserted?.state === "asserted");
    assert.equal(asserted.step, "reading");
    assert.equal(asserted.outputSchemaHash, deriveSchemaHash(FixtureIo, "output"));

    // The assertion is durable as a MARKED checkpoint row — every leaf operator-sourced,
    // the omitted step named — so the commit-input rebuild and the receipt can resolve it.
    const assertedRow = database.authority.runCheckpoints.latest(honestDescriptor.id, run.envelope.itemId, "read");
    assert.ok(assertedRow);
    assert.deepEqual(assertedRow.assertion, { step: "reading", assertedAt: asserted.assertedAt });
    assert.deepEqual(assertedRow.output.value, { disposition: "typed", providerState: "typed" });
    assert.deepEqual(assertedRow.provenance.map(({ path, source }) => [path, source]), [["disposition", "operator"], ["providerState", "operator"]]);
    const foldRow = database.authority.runCheckpoints.latest(honestDescriptor.id, run.envelope.itemId, "fold");
    assert.ok(foldRow);
    assert.equal(foldRow.assertion, undefined);

    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const spans = harness.emitter.events().map((event) => [event.t, event.spanPath, "outcome" in event ? event.outcome : ""]);
    assert.deepEqual(spans, [
      ["span.started", taskSpanPath(trace, node("read"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("read"), 1, 1), "skipped"],
      ["span.started", taskSpanPath(trace, node("fold"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("fold"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("fold"), 1, 1), "done"],
      ["span.ended", trace, "done"],
    ]);
    const skip = harness.emitter.events().find((event) => event.t === "span.ended" && "outcome" in event && event.outcome === "skipped");
    assert.ok(skip !== undefined && skip.t === "span.ended" && "notRunReason" in skip);
    assert.equal(skip.notRunReason, "operator-asserted");
  });

  it("runs every node as before when no step is omitted", async () => {
    invocations.length = 0;
    const harness = harnessFor(honestDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(honestDescriptor));
    const claimed = claim(database, honestDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    if (outcome.state === "failed") {
      const failure = database.authority.failures.get(outcome.failureId);
      assert.fail(`run failed at ${failure?.nodeId ?? "?"}: ${failure?.summary ?? "?"}`);
    }
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    assert.deepEqual(invocations, ["observed", "observed!"]);
    const result = database.authority.runResults.get(RUN_ID);
    assert.deepEqual(result?.dependencies.map((dependency) => dependency.state), ["resolved", "resolved"]);
  });

  it("fails the asserted node by name when its producer returns a value the output schema refuses", async () => {
    const harness = harnessFor(lyingDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(lyingDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, lyingDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.equal(failure?.nodeId, "read");
    assert.match(failure?.summary ?? "", /producer for node "read" returned a value the node's output schema refuses at: disposition, providerState/u);
  });

  it("terminalizes as an entry-validation failure when an executing node would read a node the omission leaves unread", async () => {
    const harness = harnessFor(bareDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(bareDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, bareDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    // A refused omission is THIS run's failure, with a durable record the
    // operator can read — never a thrown error that leaves the run claimed.
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.match(failure?.summary ?? "", /step omission refused \[dependency-omitted\]: node "fold" \(step "folding"\) reads "read"/u);
  });

  it("fails an asserted node by name when it also declares an artifact projection — an assertion projects nothing", async () => {
    const harness = harnessFor(projectingDescriptor);
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(projectingDescriptor, [{ step: "reading", facts: { value: "typed" } }]));
    const claimed = claim(database, projectingDescriptor);
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId !== undefined);
    const failure = database.authority.failures.get(failureId);
    assert.equal(failure?.nodeId, "read");
    assert.match(failure?.summary ?? "", /node "read" declares artifact projections and cannot be asserted/u);
  });
});
