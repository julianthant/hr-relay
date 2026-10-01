import { RuntimeAdmission } from "../../src/infra/runtime-control/admission.js";
import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";
/**
 * D162 executor capability wiring (ref data-intake-and-edit-data §4.11): the run executor mints
 * admitted provider clients per task invocation over the run's RETAINED
 * config snapshot, injects the kernel's content-addressed writer, and every
 * unwired or unreadable-snapshot arm refuses with a structured node failure
 * — never a bypass around admission, never a substituted client or writer.
 *
 * Every fixture contract borrows the manifest-known id `ocr/extract-form-page`
 * with test-local schemas: `interpret` builds checkpoint expectations for
 * every task node UP FRONT via `resolveTaskImplFingerprint`, which fails loud
 * on an id the generated manifest does not carry — so even the refusal arms
 * need a manifest id, and the arms are told apart by their failure messages.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../src/base/artifacts.js";
import { flow } from "../../src/base/flow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../src/base/store.js";
import { defineTask } from "../../src/base/task.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import {
  executeClaimedRun,
  type RunExecutorDependencies,
  type RunProviderWiring,
} from "../../src/backend/runtime/run-executor.js";
import { defaultRuntimePaths } from "../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema } from "../../src/domain/config/schema.js";
import { defineTaskContract } from "../../src/domain/contracts/base.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  ProviderAdmissionIdSchema,
  ScenarioIdSchema,
  TraceIdSchema,
  taskId,
} from "../../src/domain/ids.js";
import { isRunNodeExecutionIdentity } from "../../src/domain/provider-admission.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { createContentAddressedArtifactWriter } from "../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createDeterministicProviderHarness } from "../../src/backend/processing/providers/deterministic-provider.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { HASH_A, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  RUN_ID,
  WORKER_ID,
  sequentialIdFactory,
} from "../fixtures/phase1f-run-fixtures.js";
import {
  happySessionHarness,
  ManualScheduler,
  openAuthorityHarness,
  recordingEmitter,
  recordingLogger,
  sessionManagerFor,
} from "../helpers/phase1f-executor-harness.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

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
  providers: ["ocr.extract"] as const,
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
  providers: ["ocr.extract"] as const,
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

let observed: { artifactSha?: string; artifactBytes?: number; providerState?: string } = {};

const providersOnlyTask = defineTask(providersOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof FixtureOutput>> {
    throw new Error("providers refusal fixture must never be invoked without wiring");
  },
});

const artifactsOnlyTask = defineTask(artifactsOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof FixtureOutput>> {
    throw new Error("artifacts refusal fixture must never be invoked without wiring");
  },
});

const wiredTask = defineTask(wiredContract, {
  sessions: [],
  async run({ ctx }) {
    const ref = await ctx.artifacts.put(FIXTURE_BYTES, { mediaType: "text/plain" });
    const bytes = await byteLength(await ctx.artifacts.open(ref));
    const response = await ctx.providers["ocr.extract"].call(PAYLOAD);
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
  const fixtureFlow = flow(FixtureInput)
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
const artifactsDescriptor = fixtureDescriptor("wiring-refusal-artifacts", "wa", artifactsOnlyContract);
const wiredDescriptor = fixtureDescriptor("wiring-wired", "ww", wiredContract);

function registryFor(task: typeof providersOnlyTask | typeof artifactsOnlyTask | typeof wiredTask) {
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

function claim(database: AuthorityDatabase, descriptor: AnyWorkflowDescriptor): {
  run: RunRecord;
  claim: { workerId: string; claimGeneration: number };
} {
  const claimed = database.authority.runs.claimNext({
    workflow: descriptor.id,
    workerId: WORKER_ID,
    now: new Date("2026-08-03T09:00:00.000Z").toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return { run: claimed.run, claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration } };
}

/** The run's retained snapshot: `QUEUED_RUN`'s envelope ids, an ocr.extract budget. */
function seedSnapshot(database: AuthorityDatabase): void {
  const defaults = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  const config = ConfigSchema.parse({
    ...defaults,
    providers: {
      ...defaults.providers,
      ocrExtract: {
        timeoutMs: 30_000,
        concurrency: 2,
        requestsPerMinute: 10,
        dailyRequestLimit: 100,
        costLimitUsdMicros: 1_000_000,
      },
    },
  });
  database.authority.configSnapshots.insert({
    configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
    revision: 1,
    fingerprint: QUEUED_RUN.envelope.configFingerprint,
    capturedAt: IsoInstantSchema.parse(NOW),
    capturedBy: "local-operator",
    config,
    provenance: {},
  });
}

function admissionIdFactory() {
  let next = 0;
  return Object.freeze({
    next: () => {
      next += 1;
      return ProviderAdmissionIdSchema.parse(`00000000-0000-4000-8000-${String(next).padStart(12, "0")}`);
    },
  });
}

function tempArtifactWriter(): ContentAddressedArtifactWriter {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hrauto-wiring-artifacts-"));
  disposers.push(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return createContentAddressedArtifactWriter({
    admission: RuntimeAdmission.syntheticRoots(join(workspaceRoot, ".tracker"), join(workspaceRoot, ".tracker/artifacts")),
  });
}

function terminalFailure(database: AuthorityDatabase) {
  const run = database.authority.runs.get(RUN_ID);
  assert.ok(run !== undefined && run.lifecycle.state === "terminal");
  const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
  assert.ok(failureId !== undefined);
  const failure = database.authority.failures.get(failureId);
  assert.ok(failure !== undefined);
  return failure;
}

/* ── the arms ────────────────────────────────────────────────────────────── */

describe("executor capability wiring refusals", () => {
  it("refuses a providers-declaring contract when the composition wires no admitted client", async () => {
    const harness = wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(providersDescriptor));
    const claimed = claim(database, providersDescriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const failure = terminalFailure(database);
    assert.equal(failure.nodeId, "extract");
    assert.match(failure.summary, /wires no admitted provider client/u);
  });

  it("refuses an artifacts-declaring contract when the composition wires no writer", async () => {
    const harness = wiringHarness(artifactsDescriptor, registryFor(artifactsOnlyTask));
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(artifactsDescriptor));
    const claimed = claim(database, artifactsDescriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const failure = terminalFailure(database);
    assert.equal(failure.nodeId, "extract");
    assert.match(failure.summary, /wires no artifact writer/u);
  });

  it("refuses provider admission when the run's retained config snapshot is absent", async () => {
    const adapter = createDeterministicProviderHarness("ocr.extract", []);
    const harness = wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
    // Fully wired against the REAL repositories; only the snapshot row is
    // missing — the refusal must name the unreadable snapshot, not crash.
    const { database } = harness.authority;
    const deps: RunExecutorDependencies = {
      ...harness.deps,
      providers: Object.freeze({
        adapters: { "ocr.extract": adapter.adapter },
        repository: database.authority.providerAdmissions,
        configSnapshots: database.authority.configSnapshots,
        idFactory: admissionIdFactory(),
      }),
    };
    database.authority.runs.enqueue(queuedRunFor(providersDescriptor));
    const claimed = claim(database, providersDescriptor);

    const outcome = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const failure = terminalFailure(database);
    assert.equal(failure.nodeId, "extract");
    assert.match(failure.summary, /retained config snapshot .+ is absent from authority/u);
    assert.equal(adapter.calls().length, 0);
  });
});

describe("executor capability wiring, wired", () => {
  it("mints admitted clients over the retained snapshot and injects the kernel writer", async () => {
    observed = {};
    const adapter = createDeterministicProviderHarness("ocr.extract", [{
      kind: "return",
      estimate: { maximumCostUsdMicros: 0 },
      outcome: {
        response: {
          state: "produced",
          value: { schemaHash: FingerprintSchema.parse(HASH_A), value: { extracted: true } },
        },
        usage: { requestCount: 1, costUsdMicros: 0 },
        evidence: { summary: "deterministic wiring fixture", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    }]);
    const artifacts = tempArtifactWriter();
    const harness = wiringHarness(wiredDescriptor, registryFor(wiredTask));
    const { database } = harness.authority;
    const admissionIds = admissionIdFactory();
    const deps: RunExecutorDependencies = {
      ...harness.deps,
      providers: Object.freeze({
        adapters: { "ocr.extract": adapter.adapter },
        repository: database.authority.providerAdmissions,
        configSnapshots: database.authority.configSnapshots,
        idFactory: admissionIds,
      }),
      artifacts,
    };
    seedSnapshot(database);
    database.authority.runs.enqueue(queuedRunFor(wiredDescriptor));
    const claimed = claim(database, wiredDescriptor);

    const outcome = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");

    // The task saw the REAL wired capabilities: the writer round-tripped the
    // exact bytes, and the provider answer arrived through admission.
    assert.equal(observed.artifactBytes, FIXTURE_BYTES.byteLength);
    assert.equal(observed.artifactSha?.length, 64);
    assert.equal(observed.providerState, "produced");

    // Exactly one adapter call, carrying the task's payload under the declared
    // capability — the client added nothing and dropped nothing.
    const calls = adapter.calls();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.request, { capability: "ocr.extract", payload: PAYLOAD });

    // Admission settled durably in authority: the reservation was consumed and
    // the outcome recorded against the minted admission id.
    const admission = database.authority.providerAdmissions.get(
      ProviderAdmissionIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    );
    assert.ok(admission !== undefined);
    assert.equal(admission.lifecycle.state, "settled");
    // A run-node identity, not D178's operator-advisory arm.
    assert.ok(isRunNodeExecutionIdentity(admission.execution));
    assert.equal(admission.execution.taskId, "ocr/extract-form-page");
    assert.equal(admission.execution.nodeId, "extract");
    assert.equal(admission.configSnapshotId, QUEUED_RUN.envelope.configSnapshotId);
  });
});
