import { DatabaseSync as DatabaseSync_m0 } from "node:sqlite";
import { testRunLifecycle as testRunLifecycle_m0,testWorkerPorts as testWorkerPorts_m0 } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { afterEach as afterEach_m0,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { z as z_m0 } from "zod";
import { createDeterministicProviderHarness as createDeterministicProviderHarness_m0,createDeterministicProviderHarness as createDeterministicProviderHarness_m1 } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { executeClaimedRun as executeClaimedRun_m0,type RunExecutorDependencies as RunExecutorDependencies_m0,type RunProviderWiring as RunProviderWiring_m0 } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { RunRecord as RunRecord_m0 } from "../../../../src/models/run/record.js";
import { defineTaskContract as defineTaskContract_m0 } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash as deriveSchemaHash_m0 } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput as defineCanonicalInput_m0 } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS as STANDARD_WORKFLOW_ACTIONS_m0 } from "../../../../src/models/workflow/presentation.js";
import {
FingerprintSchema as FingerprintSchema_m0,FingerprintSchema as FingerprintSchema_m1,
IsoInstantSchema as IsoInstantSchema_m1,ScenarioIdSchema as ScenarioIdSchema_m0,TraceIdSchema as TraceIdSchema_m0,taskId as taskId_m0
} from "../../../../src/rules/identity/ids.js";
import type { ContentAddressedArtifactWriter as ContentAddressedArtifactWriter_m0 } from "../../../../src/workflow-kit/artifacts.js";
import { flow as flow_m0 } from "../../../../src/workflow-kit/flow.js";
import { defineServiceStore as defineServiceStore_m0,defineTaskStoreRegistry as defineTaskStoreRegistry_m0 } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask as defineTask_m0 } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor as defineWorkflowDescriptor_m0,type AnyWorkflowDescriptor as AnyWorkflowDescriptor_m0 } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A as HASH_A_m0 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m0,sequentialIdFactory as sequentialIdFactory_m0 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { ManualScheduler as ManualScheduler_m0,happySessionHarness as happySessionHarness_m0,openAuthorityHarness as openAuthorityHarness_m0,recordingEmitter as recordingEmitter_m0,recordingLogger as recordingLogger_m0,sessionManagerFor as sessionManagerFor_m0 } from "../../../support/helpers/phase1f-executor-harness.js";


{


const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const SIGNAL = new AbortController().signal;
const SCENARIO = ScenarioIdSchema_m0.parse("ocr/capability-wiring-happy");
const FIXTURE_BYTES = new TextEncoder().encode("executor capability wiring fixture bytes");
const PAYLOAD = {
  schemaHash: FingerprintSchema_m0.parse(HASH_A_m0),
  value: { page: "wiring-fixture" },
};

/* ── fixture contracts + descriptors (real factory builds) ───────────────── */

const FixtureInput = z_m0.strictObject({ name: z_m0.string().min(1) });
const FixtureCanonicalInput = defineCanonicalInput_m0(
  FixtureInput,
  z_m0.strictObject({ name: z_m0.string().min(1) }),
  [{ name: "Battistessa, Johnnie" }],
);

function descriptorMeta(id: string, code: string) {
  return {
    id,
    version: 1,
    contractFingerprint: HASH_A_m0,
    code,
    label: "Capability wiring fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: FixtureCanonicalInput,
    inputSubject: "name",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS_m0,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z_m0.output<typeof FixtureInput>) => `name:${input.name}` },
    presentation: { title: (input: z_m0.output<typeof FixtureInput>) => input.name },
    scenarios: [`${id}/happy`],
  } as const;
}

const FixtureOutput = z_m0.strictObject({ value: z_m0.string().min(1) });

const providersOnlyContract = defineTaskContract_m0({
  id: taskId_m0("ocr/extract-form-page"),
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

const artifactsOnlyContract = defineTaskContract_m0({
  id: taskId_m0("ocr/extract-form-page"),
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

const WiredOutput = z_m0.strictObject({
  providerState: z_m0.string().min(1),
  artifactSha: z_m0.string().min(1),
  artifactBytes: z_m0.number().int().nonnegative(),
});

const wiredContract = defineTaskContract_m0({
  id: taskId_m0("ocr/extract-form-page"),
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
  example: { providerState: "produced", artifactSha: HASH_A_m0, artifactBytes: 1 },
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

const providersOnlyTask = defineTask_m0(providersOnlyContract, {
  sessions: [],
  async run(): Promise<z_m0.output<typeof FixtureOutput>> {
    throw new Error("providers refusal fixture must never be invoked without wiring");
  },
});

const _artifactsOnlyTask = defineTask_m0(artifactsOnlyContract, {
  sessions: [],
  async run(): Promise<z_m0.output<typeof FixtureOutput>> {
    throw new Error("artifacts refusal fixture must never be invoked without wiring");
  },
});

const _wiredTask = defineTask_m0(wiredContract, {
  sessions: [],
  async run({ ctx }) {
    const ref = await ctx.artifacts.put(FIXTURE_BYTES, { mediaType: "text/plain" });
    const bytes = await byteLength(await ctx.artifacts.open(ref));
    const response = await ctx.providers["geocode.census"].call(PAYLOAD);
    if (response.state !== "produced") {
      ctx.fail("provider-unavailable", `ocr.extract answered ${response.state}`);
    }
    observed.artifactSha = ref.sha256;
    observed.artifactBytes = bytes;
    observed.providerState = response.state;
    ctx.recordData([
      { direction: "read", field: "providerState", value: response.state },
      { direction: "read", field: "artifactSha", value: ref.sha256 },
      { direction: "read", field: "artifactBytes", value: bytes },
    ]);
    return { providerState: response.state, artifactSha: ref.sha256, artifactBytes: bytes };
  },
});

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
      schema: z_m0.strictObject({ done: z_m0.boolean() }),
      dependsOn: ["extract"],
      derive: () => ({ done: true }),
    });
  return defineWorkflowDescriptor_m0({ ...descriptorMeta(id, code), flow: fixtureFlow });
}

const providersDescriptor = fixtureDescriptor("wiring-refusal-providers", "wp", providersOnlyContract);

function registryFor(task: typeof providersOnlyTask | typeof _artifactsOnlyTask | typeof _wiredTask) {
  const store = defineServiceStore_m0("ocr", { fixture: task });
  return defineTaskStoreRegistry_m0([store], {
    scenarioIds: [SCENARIO],
    tasks: [{ id: task.contract.id, effect: task.contract.effect }],
  });
}

/* ── harness ─────────────────────────────────────────────────────────────── */

function queuedRunFor(descriptor: AnyWorkflowDescriptor_m0) {
  return {
    ...QUEUED_RUN_m0,
    envelope: {
      ...QUEUED_RUN_m0.envelope,
      workflow: descriptor.id,
      traceId: TraceIdSchema_m0.parse(`${descriptor.code}-170000-2222`),
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: {},
    },
    input: {
      raw: { name: "Battistessa, Johnnie" },
      parsed: {
        schemaHash: deriveSchemaHash_m0(descriptor.canonicalInput, "output"),
        value: { name: "Battistessa, Johnnie" },
        protectedBindings: [],
      },
      ingressSchemaHash: HASH_A_m0,
    },
  };
}

function wiringHarness(
  descriptor: AnyWorkflowDescriptor_m0,
  stores: ReturnType<typeof registryFor>,
  seams?: Readonly<{ providers?: RunProviderWiring_m0; artifacts?: ContentAddressedArtifactWriter_m0 }>,
) {
  const authority = openAuthorityHarness_m0();
  disposers.push(authority.dispose);
  const sessions = happySessionHarness_m0();
  const emitter = recordingEmitter_m0();
  const deps: RunExecutorDependencies_m0 = {
    lifecycle: testRunLifecycle_m0(authority.database, authority.clock),
    descriptor,
    stores,
    authority: authority.database,
    sessions: sessionManagerFor_m0(sessions, authority.clock),
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory_m0("e"),
    scheduler: new ManualScheduler_m0(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger_m0().log,
    ...(seams?.providers === undefined ? {} : { providers: seams.providers }),
    ...(seams?.artifacts === undefined ? {} : { artifacts: seams.artifacts }),
  };
  return { authority, emitter, deps };
}

function claim(authority: ReturnType<typeof openAuthorityHarness_m0>, descriptor: AnyWorkflowDescriptor_m0): {
  run: RunRecord_m0;
  claim: { workerId: string; claimGeneration: number };
} {
  const { database, clock, path } = authority;
  const ports = testWorkerPorts_m0(database, clock, { path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(descriptor.id).find(candidate => candidate.poolIndex === 1);
  if (slot === undefined) throw new Error("fixture native worker slot absent");
  const claimed = ports.claimNext({ commandId: sequentialIdFactory_m0("c").uuid(), workflow: descriptor.id, workerId: slot.workerId });
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

describe_m0("executor capability wiring refusals", () => {
afterEach_m0(_afterEachFixture0);


  it_m0("refuses provider admission when the run's retained config snapshot is absent", async () => {
    const adapter = createDeterministicProviderHarness_m0("geocode.census", []);
    const harness = wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
    const { database } = harness.authority;
    const deps: RunExecutorDependencies_m0 = {
      ...harness.deps,
      providers: Object.freeze({
        adapters: { "geocode.census": adapter.adapter },

        configSnapshots: database.authority.configSnapshots,
        idFactory: admissionIdFactory(),
      }),
    };
    database.authority.runs.enqueue(queuedRunFor(providersDescriptor));
    const claimed = claim(harness.authority, providersDescriptor);

    const raw = new DatabaseSync_m0(harness.authority.path);
    try {
      const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='settings_snapshots_retained'").get();
      if (typeof trigger?.sql !== "string") throw new Error("fixture immutable snapshot trigger missing");
      raw.exec("PRAGMA foreign_keys=OFF");
      raw.exec("DROP TRIGGER settings_snapshots_retained");
      try { raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(claimed.run.envelope.configSnapshotId); }
      finally { raw.exec(trigger.sql); }
    } finally { raw.close(); }
    await assert_m0.rejects(executeClaimedRun_m0(deps, { ...claimed, signal: SIGNAL }), /settings-snapshot-missing/u);
    const unchanged = new DatabaseSync_m0(harness.authority.path, { readOnly: true });
    try { assert_m0.equal(unchanged.prepare("SELECT state FROM runs WHERE id=?").get(claimed.run.envelope.runId)?.state, "claimed"); } finally { unchanged.close(); }
    assert_m0.equal(adapter.calls().length, 0);
  });
});
}

{


describe_m1("task, store, session, provider, and artifact seams", () => {

  it_m1("validates deterministic provider envelopes and fails loud when scripted outcomes end", async () => {
    const hash = FingerprintSchema_m1.parse("a".repeat(64));
    const response = {
      state: "produced" as const,
      value: { schemaHash: hash, value: { text: "recognized" } },
    };
    const harness = createDeterministicProviderHarness_m1("ocr.extract", [{
      kind: "return",

      outcome: {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema_m1.parse("2026-08-03T12:00:00.000Z") },
      },
    }]);
    const signal = new AbortController().signal;
    const request = { capability: "ocr.extract" as const, payload: { schemaHash: hash, value: { artifact: "fixture" } } };
    assert_m1.deepEqual(
      await harness.adapter.invoke(request, {
        signal,
        deadlineMonotonicMs: 100,
        requestId: "00000000-0000-4000-8000-000000000021",
      }),
      {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema_m1.parse("2026-08-03T12:00:00.000Z") },
      },
    );
    assert_m1.equal(harness.calls().length, 1);
    await assert_m1.rejects(harness.adapter.invoke(request, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000022" }), /no queued script/);
    await assert_m1.rejects(harness.adapter.invoke({ capability: "geocode.nominatim", payload: request.payload }, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000023" }), /cannot invoke capability/);

  })
});
}
