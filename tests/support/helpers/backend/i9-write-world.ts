import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { I9RecordIdsSchema } from "../../../../src/models/systems/i9/read-section2-signer.js";
import { I9ProfileTargetSchema, I9_PROFILE_EXAMPLE } from "../../../../src/models/ui/i9-creation.js";
import { I9CreateProfile } from "../../../../src/models/systems/i9/create-profile.js";
import { I9StageProfile } from "../../../../src/models/systems/i9/stage-profile.js";
import { I9CreateRemoteRecord } from "../../../../src/models/systems/i9/create-remote-record.js";
import { I9StageRemoteRecord } from "../../../../src/models/systems/i9/stage-remote-record.js";
import { DRY_RUN_I9_PROFILE_ID } from "../../../../src/models/workflow/dry-run.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { createDeterministicI9Driver } from "../../../../src/backend/systems/i9/driver/fake.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { NodeIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { WRITE_FIXTURE_FINGERPRINT, WRITE_FIXTURE_NOW } from "../../fixtures/write-sequencer-fixtures.js";
import { testRunLifecycle, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { ManualScheduler, recordingLogger, recordingTimelineEmitter, sessionFactoryHarness } from "../phase1f-executor-harness.js";

const Input = I9ProfileTargetSchema.safeExtend({ startDate: I9StageRemoteRecord.input.shape.startDate,
  existingProfileId: I9RecordIdsSchema.shape.profileId.optional() });
const example = Input.parse({ ...I9_PROFILE_EXAMPLE, startDate: "09/11/2026" });
const canonicalInput = defineCanonicalInput(Input, Input, [example]);
function profileTarget(input: typeof example) {
  const { startDate: _date, existingProfileId: _id, ...target } = input;
  return target;
}
const descriptorBase = {
  id: "i9-write-proof", code: "iwp", version: 1, contractFingerprint: WRITE_FIXTURE_FINGERPRINT,
  label: "I-9 write proof", icon: "ShieldCheck", category: "onboarding", canonicalInput, inputSubject: "email",
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: (input: typeof example) => input.email }, presentation: { title: (input: typeof example) => input.email }, scenarios: ["onboarding/write-transactions"],
} as const;
export const i9WriteDescriptor = defineWorkflowDescriptor({ ...descriptorBase,
  flow: flow(Input).transaction("profile-create", {
    dependsOn: [], prepare: { uses: I9StageProfile, bind: ({ input }) => profileTarget(input) },
    commit: { uses: I9CreateProfile, bind: ({ input }) => profileTarget(input) },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000,
  }).transaction("remote-create", {
    dependsOn: ["profile-create"],
    prepare: { uses: I9StageRemoteRecord, bind: ({ input, outputs }) => ({ ...profileTarget(input), startDate: input.startDate,
      profileId: outputs["profile-create"].output.receipt.profileId }) },
    commit: { uses: I9CreateRemoteRecord, bind: ({ input, outputs }) => ({ ...profileTarget(input), startDate: input.startDate,
      profileId: outputs["profile-create"].output.receipt.profileId }) },
    previewBind: ({ input, dryRun }) => {
      const source = dryRun?.transactions.find(step => step.nodeId === "profile-create");
      if (source === undefined) return undefined;
      if (source.preview.outcome.state === "would-prepare") {
        const target = { ...profileTarget(input), startDate: input.startDate, profileId: DRY_RUN_I9_PROFILE_ID };
        return { prepare: target, commit: target, samples: [{ label: "dry-run sample", sourceNodeId: NodeIdSchema.parse("profile-create"),
          field: "I-9 profile ID", value: DRY_RUN_I9_PROFILE_ID }] };
      }
      const probe = source.preview.probe;
      if (probe.state !== "present" && probe.state !== "durable-intent") return undefined;
      const output = I9CreateProfile.output.parse(probe.output.value);
      const target = { ...profileTarget(input), startDate: input.startDate, profileId: output.receipt.profileId };
      return { prepare: target, commit: target, samples: [] };
    },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000,
  }).build({ schema: I9CreateRemoteRecord.output, dependsOn: ["remote-create"], derive: ({ outputs }) => outputs["remote-create"].output }),
});

const remoteOnlyDescriptor = defineWorkflowDescriptor({
  ...descriptorBase, id: "i9-remote-write-proof", code: "irwp",
  flow: flow(Input).transaction("remote-create", {
    dependsOn: [],
    prepare: { uses: I9StageRemoteRecord, bind: ({ input }) => ({ ...profileTarget(input), startDate: input.startDate,
      profileId: I9RecordIdsSchema.shape.profileId.parse(input.existingProfileId) }) },
    commit: { uses: I9CreateRemoteRecord, bind: ({ input }) => ({ ...profileTarget(input), startDate: input.startDate,
      profileId: I9RecordIdsSchema.shape.profileId.parse(input.existingProfileId) }) },
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000,
  }).build({ schema: I9CreateRemoteRecord.output, dependsOn: ["remote-create"], derive: ({ outputs }) => outputs["remote-create"].output }),
});

export function createI9WriteWorld() {
  const disposers: (() => Promise<void>)[] = [];
  async function harness(options: Partial<Parameters<typeof createDeterministicI9Driver>[0]> = {}) {
    const profile = await createBoundProfileFixture();
    const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
    const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "i9-write-proof" }, clock);
    disposers.push(async () => { database.close(); await profile.close(); });
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const driver = createDeterministicI9Driver({ lookup: { i9Status: "not-found", signerName: "" }, now: WRITE_FIXTURE_NOW, ...options });
    const sessions = sessionFactoryHarness({ i9: () => driver });
    const scheduler = new ManualScheduler(clock), ids = sequentialIdFactory("c"), log = recordingLogger().log;
    const emitter = recordingTimelineEmitter(database, clock);
    const captures: string[] = [];
    async function run(dryRun = false, input = example) {
      const descriptor = input.existingProfileId === undefined ? i9WriteDescriptor : remoteOnlyDescriptor;
      const runId = randomUUID(), itemId = randomUUID(), now = clock.now().toISOString();
      const ports = testWorkerPorts(database, clock, { path: profile.path, descriptor, poolIndex: 1 });
      const worker = database.authority.workerSlots.list(descriptor.id).find(row => row.poolIndex === 1); assert.ok(worker);
      const record = RunRecordSchema.parse({ envelope: { runId, itemId, workflow: descriptor.id, traceId: `iwp-120000-${runId.slice(0, 4)}`,
        descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
        resolvedInstance: { i9: "prod" }, configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
        shape: "single", priority: "bulk", dryRun, attempt: 1, enqueuedAt: now },
        input: { raw: input, parsed: { schemaHash: deriveSchemaHash(canonicalInput, "output"), value: input, protectedBindings: [] },
          ingressSchemaHash: deriveSchemaHash(Input, "input") }, lifecycle: { state: "queued" }, claimGeneration: 0,
        version: 1, createdAt: now, updatedAt: now });
      assert.equal(database.authority.runs.enqueue(record).state, "inserted");
      await runWorkerLoop({ ...ports, workflowId: WorkflowIdSchema.parse(descriptor.id), workerId: WorkerIdSchema.parse(worker.workerId),
        descriptor, stores: taskStoreRegistry, authority: database, sessionFactory: sessions.factory,
        browserScreenshotCapture: { capture: async context => {
          assert.equal(context.screenshot.state, "available");
          if (context.trigger.kind === "task-point") captures.push(`${context.trigger.nodeId}:${context.trigger.boundary}`);
        } }, emitter: emitter.emitter, clock, ids, scheduler, taskDeadlineMs: 60_000, sessionAcquireMs: 20_000,
        duoCeremony: duoCeremonyGatesOver(database, clock, scheduler), heartbeatIntervalMs: 600_000, idleRepollMs: 1_000,
        log, stopSignal: new AbortController().signal, exitWhenIdle: true,
        writeSequencerFor: manager => createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores: taskStoreRegistry,
          authority: database, sessions: manager, emitter: emitter.emitter, clock, ids, scheduler, taskDeadlineMs: 60_000,
          operator: "local-operator", log }),
      });
      const current = database.authority.runs.get(runId); assert.ok(current);
      return current;
    }
    return { database, driver, captures, run, example };
  }
  return { harness, cleanup: async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); } };
}
