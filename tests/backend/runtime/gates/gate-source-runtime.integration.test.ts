import { createClonedProfileFixtures, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import { GateIdSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { testRunService, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { personLookupModule } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createGateSourceRuntime, type GateSourceDelivery, type GateSourceEnvelope, type GateSourcePort } from "../../../../src/backend/runtime/gates/gate-source-runtime.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKFLOW_ID, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/admission-fixture.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler, recordingLogger, recordingTimelineEmitter, happySessionHarness as sourceSessionHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createClonedProfileFixtures();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  releaseAdmissionFixtures();
  for (const profile of heldProfiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) {
    releaseAdmissionFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});

const NOW = "2026-08-03T09:00:00.000Z";

async function repoRootWithState() {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const repoRoot = profile.workspace, stateRoot = profile.stateRoot;
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "worker-composition-fixture", version: "0.1.0", type: "module" }));
  return { repoRoot, stateRoot };
}

function reopen(stateRoot: string, clock: TestClock): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);
  return database;
}

describe("worker-loop source gate composition", () => {
  for (const mode of ["external", "children-terminal"] as const) {
    it(`parks and source-settles a ${mode} descriptor through the production worker loop`, async () => {
      const { stateRoot } = await repoRootWithState();
      const clock = manualClock(new Date(NOW));
      const database = reopen(stateRoot, clock);
      const descriptor = sourceGateDescriptor(mode);
      const workerPorts = testWorkerPorts(database, clock, { path: join(stateRoot, "state.db"), descriptor, poolIndex: 1 });
      const workerSlot = database.authority.workerSlots.list(descriptor.id)[0]; assert.ok(workerSlot);
      database.authority.runs.enqueue(RunRecordSchema.parse(sourceGateQueuedRun(descriptor)));

      const sourceKind = mode === "external" ? "external" : "workflow";
      const sourceId = mode === "external" ? "source-ticket-system" : String(SOURCE_CHILD.id);
      let dispatch: ((event: GateSourceEnvelope) => Promise<GateSourceDelivery>) | undefined;
      const source: GateSourcePort = {
        kind: sourceKind,
        sourceId,
        bindCorrelation: ({ canonicalInput }) =>
          (canonicalInput as Readonly<{ ticket: string }>).ticket,
        subscribe: async (deliver, _signal) => {
          dispatch = deliver;
          return (): void => undefined;
        },
      };
      const sourceRuntime = createGateSourceRuntime({
        database,
        lifecycle: testRunService(database, clock),
        descriptors: { resolve: (id) => id === WORKFLOW_ID ? descriptor : undefined },
        ports: [source],
        clock,
      });
      const stopController = new AbortController();
      const stopSource = await sourceRuntime.start(stopController.signal);
      const sessions = sourceSessionHarness();
      const spans = recordingTimelineEmitter(database, clock);
      const workerPromise = runWorkerLoop({
        workflowId: WorkflowIdSchema.parse(WORKFLOW_ID),
        workerId: workerSlot.workerId,
        descriptor,
        stores: taskStoreRegistry,
        authority: database,
        lifecycle: workerPorts.lifecycle,
        gateSources: sourceRuntime,
        sessionFactory: sessions.factory,
        emitter: spans.emitter,
        clock,
        ids: sequentialIdFactory("d"),
        scheduler: new ManualScheduler(clock),
        taskDeadlineMs: 60_000,
        sessionAcquireMs: 15_000,
        duoCeremony: await fixtureDuoCeremonyGates(clock),
        heartbeatIntervalMs: 60_000,
        idleRepollMs: 60_000,
        log: recordingLogger().log,
        stopSignal: stopController.signal,
        exitWhenIdle: false,
        claimNext: workerPorts.claimNext,
      });
      let workerFailure: unknown;
      void workerPromise.catch((error: unknown) => { workerFailure = error; });

      try {
        let parked = database.authority.runs.get(RUN_ID);
        const deadline = Date.now() + 5_000;
        while (parked?.lifecycle.state !== "parked-gate" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          parked = database.authority.runs.get(RUN_ID);
        }
        assert.ok(parked?.lifecycle.state === "parked-gate", `worker loop did not commit the source gate park: ${workerFailure instanceof Error ? workerFailure.message : String(workerFailure)}`);
        assert.ok(dispatch !== undefined, "the source port was not registered with the runtime");
        const event: GateSourceEnvelope = {
          eventId: UUID_7,
          runId: RunIdSchema.parse(RUN_ID),
          attempt: parked.envelope.attempt,
          gateId: GateIdSchema.parse("source-result"),
          expectedVersion: PositiveIntSchema.parse(parked.version),
          event: {
            ticket: "synthetic-ticket-10873698",
            complete: true,
            ...(mode === "children-terminal" ? { terminal: "done" } : {}),
          },
        };
        assert.deepEqual(await dispatch(event), {
          state: "settled",
          result: {
            schemaHash: deriveSchemaHash(SOURCE_GATE_RESULT, "output"),
            value: { complete: true },
          },
        });
        stopController.abort(new Error("source settlement proof complete"));

        const report = await workerPromise;
        assert.deepEqual(report.outcomes.map(({ state }) => state), ["parked-gate"]);
        assert.equal(report.stopped, "stop-signal");
        const settledRun = database.authority.runs.get(RUN_ID);
        assert.ok(settledRun?.lifecycle.state === "queued", "the exact parked run was not requeued");
        assert.equal(settledRun.version, parked.version + 1);

        const results = database.authority.gateResults.listByRun(RUN_ID);
        assert.equal(results.length, 1);
        const [stored] = results;
        assert.ok(stored !== undefined && "source" in stored);
        if (stored !== undefined && "source" in stored) {
          assert.deepEqual(stored.source, {
            kind: sourceKind,
            sourceId,
            eventId: UUID_7,
            eventDigest: sha256Hex(canonicalJsonStringify(event.event)),
            correlationKey: "ticket",
            correlationDigest: sha256Hex(canonicalJsonStringify("synthetic-ticket-10873698")),
            attempt: parked.envelope.attempt,
          });
          assert.deepEqual(stored.result, {
            schemaHash: deriveSchemaHash(SOURCE_GATE_RESULT, "output"),
            value: { complete: true },
          });
        }

        const sourceResolutions = database.authority.timelineEvents.page({ workflow: WORKFLOW_ID })
          .flatMap((record) => record.payload.kind === "span" ? [record.payload.event] : [])
          .filter((eventRecord) => eventRecord.t === "gate.resolved"
            && eventRecord.runId === RUN_ID && eventRecord.gate === "source-result");
        assert.equal(sourceResolutions.length, 1, "one durable gate resolution event must publish");
      } finally {
        stopController.abort(new Error("source gate test cleanup"));
        await workerPromise.catch(() => undefined);
        await stopSource();
      }
    });
  }
});

const SOURCE_GATE_INPUT = z.strictObject({ ticket: z.string().min(1) });
const SOURCE_GATE_CANONICAL_INPUT = defineCanonicalInput(
  SOURCE_GATE_INPUT,
  z.strictObject({ ticket: z.string().min(1) }),
  [{ ticket: "synthetic-ticket-10873698" }],
);
const SOURCE_GATE_EVENT = z.strictObject({
  ticket: z.string().min(1),
  complete: z.boolean(),
  terminal: z.enum(["done", "failed"]).optional(),
});
const SOURCE_GATE_RESULT = z.strictObject({ complete: z.boolean() });
const SOURCE_CHILD = {
  id: WorkflowIdSchema.parse("source-child-fixture"),
  input: SOURCE_GATE_INPUT,
  result: SOURCE_GATE_RESULT,
};
type SourceGateMode = "external" | "children-terminal";

function sourceGateDescriptor(mode: SourceGateMode) {
  const registered = personLookupModule.descriptor;
  const metadata = {
    id: WORKFLOW_ID,
    version: registered.version,
    contractFingerprint: registered.contractFingerprint,
    code: registered.code,
    label: "Synthetic source gate",
    icon: registered.icon,
    category: registered.category,
    input: SOURCE_GATE_INPUT,
    canonicalInput: SOURCE_GATE_CANONICAL_INPUT,
    inputSubject: "none",
    surface: registered.surface,
    enqueue: registered.enqueue,
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    scenarios: ["person-lookup/source-gate-composition-proof"] as [string],
    identity: { matchKey: ({ ticket }: z.output<typeof SOURCE_GATE_INPUT>) => `ticket:${ticket}` },
    presentation: { title: ({ ticket }: z.output<typeof SOURCE_GATE_INPUT>) => `Source gate ${ticket}` },
  } as const;

  if (mode === "external") {
    const graph = flow(SOURCE_GATE_INPUT)
      .gate("source-result", {
        dependsOn: [],
        label: "External source result",
        resolvedBy: "external",
        subscribes: {
          kind: "external",
          sourceId: "source-ticket-system",
          event: SOURCE_GATE_EVENT,
          correlationKey: "ticket",
        },
        result: SOURCE_GATE_RESULT,
        resolve: (event: z.output<typeof SOURCE_GATE_EVENT>) => ({ complete: event.complete }),
      })
      .build({
        schema: SOURCE_GATE_RESULT,
        dependsOn: ["source-result"],
        derive: ({ outputs }) => outputs["source-result"],
      });
    return defineWorkflowDescriptor({ ...metadata, flow: graph });
  }

  const graph = flow(SOURCE_GATE_INPUT)
    .gate("source-result", {
        dependsOn: [],
        label: "Child terminal result",
        resolvedBy: "children-terminal",
        subscribes: {
          kind: "workflow",
          workflow: SOURCE_CHILD,
          event: SOURCE_GATE_EVENT,
          correlationKey: "ticket",
          terminal: ["done"],
        },
        result: SOURCE_GATE_RESULT,
        resolve: (event: z.output<typeof SOURCE_GATE_EVENT>) => ({ complete: event.complete }),
      })
      .build({
        schema: SOURCE_GATE_RESULT,
        dependsOn: ["source-result"],
        derive: ({ outputs }) => outputs["source-result"],
    });
  return defineWorkflowDescriptor({ ...metadata, flow: graph });
}

function sourceGateQueuedRun(descriptor: ReturnType<typeof sourceGateDescriptor>) {
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: WORKFLOW_ID,
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
    },
    input: {
      raw: { ticket: "synthetic-ticket-10873698" },
      parsed: {
        schemaHash: deriveSchemaHash(SOURCE_GATE_CANONICAL_INPUT, "output"),
        value: { ticket: "synthetic-ticket-10873698" },
        protectedBindings: [],
      },
      ingressSchemaHash: deriveSchemaHash(SOURCE_GATE_INPUT, "input"),
    },
  };
}
