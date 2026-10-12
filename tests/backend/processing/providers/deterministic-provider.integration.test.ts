import { createWiredCapabilityTask } from "../../../support/helpers/backend/capability-wiring-world.js";
import { DatabaseSync } from "node:sqlite";
import { testRunLifecycle, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import { default as assert } from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { executeClaimedRun, type RunExecutorDependencies, type RunProviderWiring } from "../../../../src/backend/runtime/execution/run-executor.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { FingerprintSchema, IsoInstantSchema, ScenarioIdSchema, TraceIdSchema, taskId } from "../../../../src/rules/identity/ids.js";
import { type ContentAddressedArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";
import { flow as flow_m0 } from "../../../../src/workflow-kit/flow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { ManualScheduler, happySessionHarness, openAuthorityHarness, recordingEmitter, recordingLogger, sessionManagerFor } from "../../../support/helpers/phase1f-executor-harness.js";

{

const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const SIGNAL = new AbortController().signal;
const SCENARIO = ScenarioIdSchema.parse("ocr/capability-wiring-happy");
const FIXTURE_BYTES = new TextEncoder().encode("executor capability wiring fixture bytes");
const PAYLOAD = {
  schemaHash: FingerprintSchema.parse(HASH_A),
  value: { page: "wiring-fixture" },
};

/* ── fixture contracts + descriptors (real factory builds) ───────────────── */

const FixtureInput = z.strictObject({ name: z.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ name: z.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);

function descriptorMeta(id: string, code: string) {
  return {
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Capability wiring fixture",
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
  } as const;
}

const FixtureOutput = z.strictObject({ value: z.string().min(1) });

const providersOnlyContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Providers refusal fixture",
  effect: "read",
  input: FixtureInput,
  output: FixtureOutput,
  errorCodes: ["provider-unavailable"] as const,
  providers: ["geocode.census"] as const,
  subject: { kind: "none", reason: "executor capability wiring fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { value: "fixture" },
});

const artifactsOnlyContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Artifacts refusal fixture",
  effect: "read",
  input: FixtureInput,
  output: FixtureOutput,
  errorCodes: ["provider-unavailable"] as const,
  artifacts: "content-addressed",
  subject: { kind: "none", reason: "executor capability wiring fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { value: "fixture" },
});

const WiredOutput = z.strictObject({
  providerState: z.string().min(1),
  artifactSha: z.string().min(1),
  artifactBytes: z.number().int().nonnegative(),
});

const wiredContract = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Wired capability fixture",
  effect: "read",
  input: FixtureInput,
  output: WiredOutput,
  errorCodes: ["provider-unavailable"] as const,
  providers: ["geocode.census"] as const,
  artifacts: "content-addressed",
  subject: { kind: "none", reason: "executor capability wiring fixture" },
  scenarios: [SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" },
  example: { providerState: "produced", artifactSha: HASH_A, artifactBytes: 1 },
});

async function byteLength(stream: AsyncIterable<unknown>): Promise<number> {
  let total = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("artifact stream yielded a non-byte chunk");
    total += chunk.byteLength;
  }
  return total;
}

const observed: { artifactSha?: string; artifactBytes?: number; providerState?: string } = {};

const providersOnlyTask = defineTask(providersOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof FixtureOutput>> {
    throw new Error("providers refusal fixture must never be invoked without wiring");
  },
});

const _artifactsOnlyTask = defineTask(artifactsOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof FixtureOutput>> {
    throw new Error("artifacts refusal fixture must never be invoked without wiring");
  },
});

const _wiredTask = createWiredCapabilityTask(wiredContract, FIXTURE_BYTES, PAYLOAD, byteLength, () => observed);

function fixtureDescriptor(id: string, code: string, contract:
  | typeof providersOnlyContract
  | typeof artifactsOnlyContract
  | typeof wiredContract) {
  const fixtureFlow = flow_m0(FixtureInput)
    .step("extract", contract, {
      dependsOn: [],
      replay: "checkpoint",
      bind: ({ input }) => ({ name: input.name }),
    })
    .build({
      schema: z.strictObject({ done: z.boolean() }),
      dependsOn: ["extract"],
      derive: () => ({ done: true }),
    });
  return defineWorkflowDescriptor({ ...descriptorMeta(id, code), flow: fixtureFlow });
}

const providersDescriptor = fixtureDescriptor("wiring-refusal-providers", "wp", providersOnlyContract);

function registryFor(task: typeof providersOnlyTask | typeof _artifactsOnlyTask | typeof _wiredTask) {
  const store = defineServiceStore("ocr", { fixture: task });
  return defineTaskStoreRegistry([store], {
    scenarioIds: [SCENARIO],
    tasks: [{ id: task.contract.id, effect: task.contract.effect }],
  });
}

/* ── harness ─────────────────────────────────────────────────────────────── */

function queuedRunFor(descriptor: AnyWorkflowDescriptor) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: descriptor.id,
      traceId: TraceIdSchema.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: {
        schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie" },
        protectedBindings: [],
      },
      ingressSchemaHash: HASH_A,
    },
  };
}

function wiringHarness(
  descriptor: AnyWorkflowDescriptor,
  stores: ReturnType<typeof registryFor>,
  seams?: Readonly<{ providers?: RunProviderWiring; artifacts?: ContentAddressedArtifactWriter }>,
) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = happySessionHarness();
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor,
    stores,
    authority: authority.database,
    sessions: sessionManagerFor(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("e"),
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
    ...(seams?.providers === undefined ? {} : { providers: seams.providers }),
    ...(seams?.artifacts === undefined ? {} : { artifacts: seams.artifacts }),
  };
  return { authority, emitter, deps };
}

function claim(authority: ReturnType<typeof openAuthorityHarness>, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const { database, clock, path } = authority;
  const ports = testWorkerPorts(database, clock, { path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(descriptor.id).find(candidate => candidate.poolIndex === 1);
  if (slot === undefined) throw new Error("fixture native worker slot absent");
  const claimed = ports.claimNext({ commandId: sequentialIdFactory("c").uuid(), workflow: descriptor.id, workerId: slot.workerId });
  if (claimed.state !== "applied") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration } };
}

function admissionIdFactory() {
  let next = 0;
  return Object.freeze({
    next: () => {
      next += 1;
      return `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
    },
  });
}

/* ── the arms ────────────────────────────────────────────────────────────── */

describe("executor capability wiring refusals", () => {
afterEach(_afterEachFixture0);

  it("refuses provider admission when the run's retained config snapshot is absent", async () => {
    const adapter = createDeterministicProviderHarness("geocode.census", []);
    const harness = wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
    const { database } = harness.authority;
    const deps: RunExecutorDependencies = {
      ...harness.deps,
      providers: Object.freeze({
        adapters: { "geocode.census": adapter.adapter },

        configSnapshots: database.authority.configSnapshots,
        idFactory: admissionIdFactory(),
      }),
    };
    database.authority.runs.enqueue(queuedRunFor(providersDescriptor));
    const claimed = claim(harness.authority, providersDescriptor);

    const raw = new DatabaseSync(harness.authority.path);
    try {
      const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='settings_snapshots_retained'").get();
      if (typeof trigger?.sql !== "string") throw new Error("fixture immutable snapshot trigger missing");
      raw.exec("PRAGMA foreign_keys=OFF");
      raw.exec("DROP TRIGGER settings_snapshots_retained");
      try { raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(claimed.run.envelope.configSnapshotId); }
      finally { raw.exec(trigger.sql); }
    } finally { raw.close(); }
    await assert.rejects(executeClaimedRun(deps, { ...claimed, signal: SIGNAL }), /settings-snapshot-missing/u);
    const unchanged = new DatabaseSync(harness.authority.path, { readOnly: true });
    try { assert.equal(unchanged.prepare("SELECT state FROM runs WHERE id=?").get(claimed.run.envelope.runId)?.state, "claimed"); } finally { unchanged.close(); }
    assert.equal(adapter.calls().length, 0);
  });
});
}

{

describe("task, store, session, provider, and artifact seams", () => {

  it("validates deterministic provider envelopes and fails loud when scripted outcomes end", async () => {
    const hash = FingerprintSchema.parse("a".repeat(64));
    const response = {
      state: "produced" as const,
      value: { schemaHash: hash, value: { text: "recognized" } },
    };
    const harness = createDeterministicProviderHarness("ocr.extract", [{
      kind: "return",

      outcome: {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    }]);
    const signal = new AbortController().signal;
    const request = { capability: "ocr.extract" as const, payload: { schemaHash: hash, value: { artifact: "fixture" } } };
    assert.deepEqual(
      await harness.adapter.invoke(request, {
        signal,
        deadlineMonotonicMs: 100,
        requestId: "00000000-0000-4000-8000-000000000021",
      }),
      {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    );
    assert.equal(harness.calls().length, 1);
    await assert.rejects(harness.adapter.invoke(request, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000022" }), /no queued script/);
    await assert.rejects(harness.adapter.invoke({ capability: "geocode.nominatim", payload: request.payload }, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000023" }), /cannot invoke capability/);

  })
});
}
