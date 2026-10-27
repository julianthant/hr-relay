import { defineTask } from "../../../../src/workflow-kit/task.js";
import { type defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { testRunLifecycle, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { z } from "zod";
import { type RunExecutorDependencies, type RunProviderWiring } from "../../../../src/backend/runtime/execution/run-executor.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { FingerprintSchema, ScenarioIdSchema, taskId, TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { type ContentAddressedArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A } from "../../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, ManualScheduler, openAuthorityHarness, recordingEmitter, recordingLogger, sessionManagerFor } from "../phase1f-executor-harness.js";





export function createCapabilityWiringTestWorld() {
  const disposers: (() => void)[] = [];

  const SIGNAL = new AbortController().signal;

  const SCENARIO = ScenarioIdSchema.parse("ocr/capability-wiring-happy");

  const FIXTURE_BYTES = new TextEncoder().encode("executor capability wiring fixture bytes");

  const PAYLOAD = {
    schemaHash: FingerprintSchema.parse(HASH_A),
    value: { page: "wiring-fixture" },
  };

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

  async function wiringHarness(
    descriptor: AnyWorkflowDescriptor,
    stores: ReturnType<typeof defineTaskStoreRegistry>,
    seams?: Readonly<{ providers?: RunProviderWiring; artifacts?: ContentAddressedArtifactWriter }>,
  ) {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const sessions = happySessionHarness();
    const emitter = recordingEmitter();
    const deps: RunExecutorDependencies = {
      lifecycle: testRunLifecycle(authority.database, authority.clock),
      descriptor,
      stores,
      authority: authority.database,
      sessions: await sessionManagerFor(sessions, authority.clock),
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

  function claim(authority: Pick<Awaited<ReturnType<typeof openAuthorityHarness>>, "database" | "clock" | "path">, descriptor: AnyWorkflowDescriptor): {
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
  const cleanup = () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
  return { disposers, SIGNAL, SCENARIO, FIXTURE_BYTES, PAYLOAD, FixtureOutput, providersOnlyContract, artifactsOnlyContract, wiredContract, byteLength, fixtureDescriptor, queuedRunFor, wiringHarness, claim, cleanup };
}

export function createWiredCapabilityTask(wiredContract: ReturnType<typeof createCapabilityWiringTestWorld>["wiredContract"], FIXTURE_BYTES: Uint8Array, PAYLOAD: ReturnType<typeof createCapabilityWiringTestWorld>["PAYLOAD"], byteLength: (stream: AsyncIterable<unknown>) => Promise<number>, observed: () => { artifactSha?: string; artifactBytes?: number; providerState?: string }) {
  return defineTask(wiredContract, {
  sessions: [],
  async run({ ctx }) {
    const ref = await ctx.artifacts.put(FIXTURE_BYTES, { mediaType: "text/plain" });
    const bytes = await byteLength(await ctx.artifacts.open(ref));
    const response = await ctx.providers["geocode.census"].call(PAYLOAD);
    if (response.state !== "produced") {
      ctx.fail("provider-unavailable", `ocr.extract answered ${response.state}`);
    }
    observed().artifactSha = ref.sha256;
    observed().artifactBytes = bytes;
    observed().providerState = response.state;
    ctx.recordData([
      { direction: "read", field: "providerState", value: response.state },
      { direction: "read", field: "artifactSha", value: ref.sha256 },
      { direction: "read", field: "artifactBytes", value: bytes },
    ]);
    return { providerState: response.state, artifactSha: ref.sha256, artifactBytes: bytes };
  },
});
}
