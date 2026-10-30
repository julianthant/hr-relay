import { sourceBoundReadContract } from "./source-bound-read-fixtures.js";

import { fixtureDuoCeremonyGates } from "../helpers/duo-ceremony-fixtures.js";
import type { DuoCeremonyGateFactory } from "../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkerSessionProvider } from "../../../src/workflow-kit/session.js";
import {
  defineBrowserStore,
  defineTaskStoreRegistry,
  declareDriverFor,
  type TaskStoreRegistry,
} from "../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { defineWorkflowDescriptor, descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import type { TestClock } from "../../../src/rules/time/clock.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { ContractFieldPathSchema } from "../../../src/models/task/task-contract.js";
import {
  EidSchema,
  taskId,
  FingerprintSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  TaskIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/rules/identity/ids.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import type { MutationCapability } from "../../../src/models/ui/driver.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import type { RuntimeFlowNode } from "../../../src/models/workflow/graph.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { WorkerSessionManager, type WorkerSessionManagerOptions } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { assertSequencerMintedMutationCapability } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { recordBrowserAction, runDeclaredAction } from "../../../src/backend/systems/browser-shared/action-notes.js";
import { CONFIG_SNAPSHOT, HASH_C, UUID_2, UUID_3, UUID_4 } from "./phase1c-contract-fixtures.js";
import {
  FIXTURE_SESSION_ACQUIRE_MS,
  ManualScheduler,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  type SessionFactoryHarness,
} from "../helpers/phase1f-executor-harness.js";

export const WRITE_FIXTURE_EID = "10812345";
export const WRITE_FIXTURE_KEY = `${WRITE_FIXTURE_EID}|fixture-termination`;
export const WRITE_FIXTURE_KEY_DIGEST = deriveIdempotencyKeyDigest("ucpath", WRITE_FIXTURE_KEY);
export const WRITE_FIXTURE_SCENARIO = ScenarioIdSchema.parse("ucpath/write-fixture-happy");
export const WRITE_FIXTURE_OBSERVATION = ObservationIdSchema.parse("ucpath.write-fixture.subject-eid");
export const WRITE_FIXTURE_STAGED_STATE = PageStateIdSchema.parse("ucpath.write-fixture.staged");
export const WRITE_FIXTURE_WORKFLOW_ID = "write-fixture";
export const WRITE_FIXTURE_NODE_ID = "submit-write";
export const WRITE_FIXTURE_RUN_ID = UUID_2;
export const WRITE_FIXTURE_ITEM_ID = UUID_3;
export const WRITE_FIXTURE_WORKER_ID = "write-fixture-worker-1";
export const WRITE_FIXTURE_FINGERPRINT = FingerprintSchema.parse("e".repeat(64));
export const WRITE_FIXTURE_IMPL_FINGERPRINT = FingerprintSchema.parse("d".repeat(64));
export const WRITE_FIXTURE_SECRET_CANARY = "RAW_TRANSACTION_SECRET_CANARY";

const SubjectInput = z.strictObject({ eid: EidSchema });
export const WriteFixtureProofSchema = z.strictObject({
  transactionId: z.string().regex(/^T\d{6,}$/),
  documentNumber: z.string().optional(),
});
const ProbeOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), proof: WriteFixtureProofSchema }),
  z.strictObject({
    state: z.literal("absent"),
    evidence: z.strictObject({
      idempotencyKeyDigest: FingerprintSchema,
      source: ObservationIdSchema,
      sourceState: PageStateIdSchema,
      observedAt: z.iso.datetime({ offset: true }),
      queryDigest: FingerprintSchema,
      evidenceRef: z.string().regex(/^(observation|artifact|span):[A-Za-z0-9/_.:#-]{1,256}$/),
    }),
  }),
  z.strictObject({
    state: z.literal("ambiguous"),
    matches: z.number().int().min(2),
    observedAt: z.iso.datetime({ offset: true }),
    queryDigest: FingerprintSchema,
    evidence: z.array(z.string().regex(/^(observation|artifact|span):[A-Za-z0-9/_.:#-]{1,256}$/)).min(2),
  }),
  z.strictObject({
    state: z.literal("unknown"),
    reason: z.string().min(1),
    observedAt: z.iso.datetime({ offset: true }),
  }),
]);

export function ambiguousProbeVerdict(observedAt: string) {
  return {
    state: "ambiguous" as const,
    matches: 2,
    observedAt,
    queryDigest: HASH_C,
    evidence: [`observation:${UUID_4}`, `observation:${UUID_2}`],
  };
}

export function unknownProbeVerdict(observedAt: string, reason = "grid did not render") {
  return { state: "unknown" as const, reason, observedAt };
}

function personSubject(requiredAt: "before-subject-read" | "after-prepare-before-fence") {
  return {
    kind: "person" as const,
    expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" as const },
    observe: WRITE_FIXTURE_OBSERVATION,
    match: "normalized-exact-eid" as const,
    requiredAt,
  };
}

export function absentProbeEvidence(observedAt: string, evidenceRef = `observation:${UUID_4}`) {
  return {
    state: "absent" as const,
    evidence: {
      idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
      source: WRITE_FIXTURE_OBSERVATION,
      sourceState: WRITE_FIXTURE_STAGED_STATE,
      observedAt,
      queryDigest: HASH_C,
      evidenceRef,
    },
  };
}

/* ── sealed contracts ────────────────────────────────────────────────────── */

export const WriteFixtureProbe = defineTaskContract({
  id: taskId("ucpath/read-write-fixture-probe"),
  title: "Read Write Fixture Probe",
  effect: "read" as const,
  input: SubjectInput,
  output: ProbeOutputSchema,
  errorCodes: ["unexpected-page-state"] as const,
  subject: personSubject("before-subject-read"),
  scenarios: [WRITE_FIXTURE_SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: absentProbeEvidence("2026-08-03T09:00:00.000Z"),
});

export const WriteFixturePrepare = defineTaskContract({
  id: taskId("ucpath/fill-write-fixture"),
  title: "Fill Write Fixture",
  effect: "prepare" as const,
  input: SubjectInput,
  output: z.strictObject({ staged: z.literal(true), stagedPageState: PageStateIdSchema }),
  errorCodes: ["unexpected-page-state"] as const,
  subject: personSubject("after-prepare-before-fence"),
  scenarios: [WRITE_FIXTURE_SCENARIO],
  checkpoint: "in-memory-only" as const,
  example: { staged: true as const, stagedPageState: WRITE_FIXTURE_STAGED_STATE },
});

export const WriteFixtureCommit = defineTaskContract({
  id: taskId("ucpath/submit-write-fixture"),
  title: "Submit Write Fixture",
  effect: "commit" as const,
  input: SubjectInput,
  output: WriteFixtureProofSchema,
  errorCodes: ["submit-failed"] as const,
  subject: personSubject("after-prepare-before-fence"),
  scenarios: [WRITE_FIXTURE_SCENARIO],
  writeSafety: {
    completion: {
      kind: "receipt" as const,
      proofSchema: WriteFixtureProofSchema,
      proofFromOutput: (output: z.output<typeof WriteFixtureProofSchema>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof WriteFixtureProofSchema> }) => proof,
      outputFromProof: (proof: z.output<typeof WriteFixtureProofSchema>) => proof,
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/read-write-fixture-probe"), effect: "read" as const },
      key: ({ eid }: z.output<typeof SubjectInput>) => `${eid}|fixture-termination`,
      recoveryAbsence: {
        kind: "stabilized" as const,
        minSinceFenceMs: 30_000,
        consistentReads: 2 as const,
        minBetweenReadsMs: 5_000,
        requireSameSourceState: true as const,
      },
    },
  },
  example: { transactionId: "T123456" },
});

/** Save-verify sibling: proof comes from a post-click read-back, and its recovery absence is operator-only. */
export const WriteFixtureVerify = defineTaskContract({
  id: taskId("ucpath/read-write-fixture-verify"),
  title: "Read Write Fixture Verify",
  effect: "read" as const,
  input: SubjectInput,
  output: ProbeOutputSchema,
  errorCodes: ["unexpected-page-state"] as const,
  subject: personSubject("before-subject-read"),
  scenarios: [WRITE_FIXTURE_SCENARIO],
  freshness: { defaultMaxAgeMs: 0 },
  provenance: { default: "live" as const },
  example: { state: "present" as const, proof: { transactionId: "T123456" } },
});

export const WriteFixtureSaveCommit = defineTaskContract({
  id: taskId("ucpath/save-write-fixture"),
  title: "Save Write Fixture",
  effect: "commit" as const,
  input: SubjectInput,
  output: WriteFixtureProofSchema,
  errorCodes: ["submit-failed"] as const,
  subject: personSubject("after-prepare-before-fence"),
  scenarios: [WRITE_FIXTURE_SCENARIO],
  writeSafety: {
    completion: {
      kind: "save-verify" as const,
      verify: { taskId: TaskIdSchema.parse("ucpath/read-write-fixture-verify"), effect: "read" as const },
      proofSchema: WriteFixtureProofSchema,
      proofFromOutput: (output: z.output<typeof WriteFixtureProofSchema>) => output,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof WriteFixtureProofSchema> }) => proof,
      outputFromProof: (proof: z.output<typeof WriteFixtureProofSchema>) => proof,
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/read-write-fixture-probe"), effect: "read" as const },
      key: ({ eid }: z.output<typeof SubjectInput>) => `${eid}|fixture-termination`,
      recoveryAbsence: {
        kind: "operator-only" as const,
        reason: "the fixture save target has no trustworthy negative read",
      },
    },
  },
  example: { transactionId: "T123456" },
});

/** The exact task-output scopes the sealed transaction fixture can produce. */
export const WRITE_FIXTURE_TASK_IDS = Object.freeze([
  WriteFixtureProbe.id,
  WriteFixturePrepare.id,
  WriteFixtureCommit.id,
  WriteFixtureSaveCommit.id,
  WriteFixtureVerify.id,
]);

/* ── the recording fake driver + store ───────────────────────────────────── */

export interface WriteFixtureDriver {
  readonly system: "ucpath";
  read(id: string): Promise<string>;
  prepare(id: string): Promise<{ filled: true }>;
  commit(id: string, capability: MutationCapability): Promise<{ clicked: true }>;
}

export interface WriteFixtureWorld {
  /** Ordered cross-surface event log: probe / prepare / subject-read / commit-click / verify. */
  readonly events: string[];
  /** Queue of probe outputs; a probe call past the queue end fails loudly. */
  readonly probeResults: unknown[];
  /** Queue of verify outputs for the save-verify arm. */
  readonly verifyResults: unknown[];
  /** The value the staged page displays for the subject observation. */
  subjectEid: string;
  /** Commit output override; default is a valid receipt. */
  commitOutput: unknown;
  /** When set, the commit impl throws this instead of clicking. */
  commitThrows?: Error;
  /** Mutation control: record a declared page fact before invoking the external commit. */
  commitRecordsBeforeClick: boolean;
  /** Called between the fence and the click (the fence-before-click witness). */
  onCommitClick?: () => void;
  /** Optional non-cooperative tail: the commit callback ignores abort until this promise settles. */
  afterCommitClickBeforeTaskSettlement?: () => Promise<void>;
  /** Called when the staged page's subject observation is read (beat ③). */
  onSubjectRead?: () => void;
  /** The exact capability the last commit click received (beat ⑤ witness). */
  lastCapability?: unknown;
  /** Called during prepare, before it returns (budget-expiry injection). */
  onPrepare?: () => void;
  /** When true the served driver has NO read() method. */
  omitDriverRead: boolean;
  /** When set, driver.read throws it. */
  subjectReadThrows?: Error;
  /** Throw only after the probe has recorded its observation. */
  probeThrowsAfterRecord?: Error;
  /** Mutation control: author one unclassified point and require a loud refusal. */
  recordUndeclaredProbeField: boolean;
  /** Mutation control: author one unclassified commit point after the click. */
  recordUndeclaredCommitField: boolean;
}

export function createWriteFixtureWorld(): WriteFixtureWorld {
  return {
    events: [],
    probeResults: [],
    verifyResults: [],
    subjectEid: WRITE_FIXTURE_EID,
    commitOutput: { transactionId: "T123456" },
    commitRecordsBeforeClick: false,
    omitDriverRead: false,
    recordUndeclaredProbeField: false,
    recordUndeclaredCommitField: false,
  };
}

export const writeFixtureDriverDeclaration = declareDriverFor<WriteFixtureDriver>()("ucpath", "semantic-ready");
const writeFixtureSession = defineWorkerSessionProvider("ucpath");

function createFixtureDriver(world: WriteFixtureWorld): WriteFixtureDriver {
  const read = async (id: string): Promise<string> => {
    world.events.push(`subject-read:${id}`);
    world.onSubjectRead?.();
    if (world.subjectReadThrows !== undefined) throw world.subjectReadThrows;
    return world.subjectEid;
  };
  const commit = async (id: string, capability: MutationCapability): Promise<{ clicked: true }> => {
    assertSequencerMintedMutationCapability(capability);
    world.lastCapability = capability;
    world.onCommitClick?.();
    world.events.push(`commit-click:${id}`);
    recordBrowserAction("clicked", id);
    return { clicked: true };
  };
  const prepare = async (id: string): Promise<{ filled: true }> => {
    recordBrowserAction("typed", id, WRITE_FIXTURE_EID);
    return { filled: true };
  };

  if (world.omitDriverRead) return { system: "ucpath", prepare, commit } as WriteFixtureDriver;
  return { system: "ucpath", read, prepare, commit };
}

export interface WriteFixtureRegistry {
  readonly registry: TaskStoreRegistry;
  readonly world: WriteFixtureWorld;
}

export function buildWriteFixtureRegistry(world: WriteFixtureWorld): TaskStoreRegistry {
  const probe = defineTask(writeFixtureDriverDeclaration, WriteFixtureProbe, {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      world.events.push("probe");
      const next = world.probeResults.shift();
      if (next === undefined) {
        throw new Error("write fixture probe was invoked with no queued result; the test under-provisioned it");
      }
      if (next instanceof Error) throw next;
      const verdict = await runDeclaredAction({ id: "probe-state", kind: "read", targetId: "ucpath.write-fixture.probe-state" },
        async () => ProbeOutputSchema.parse(next), (value) => value.state);
      ctx.recordData([
        { direction: "read", field: "state", value: verdict.state },
        { direction: "read", field: "eid", value: input.eid },
        { direction: "read", field: "secretCanary", value: WRITE_FIXTURE_SECRET_CANARY },
      ]);
      if (world.recordUndeclaredProbeField) {
        ctx.recordData({ direction: "read", field: "undeclaredProbeField", value: "must-refuse" });
      }
      if (world.probeThrowsAfterRecord !== undefined) throw world.probeThrowsAfterRecord;
      return verdict;
    },
  });
  const prepare = defineTask(writeFixtureDriverDeclaration, WriteFixturePrepare, {
    sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
    async run({ ctx }) {
      world.events.push("prepare");
      world.onPrepare?.();
      await ctx.driver.prepare("ucpath.write-fixture.eid-input");
      const staged = { staged: true as const, stagedPageState: WRITE_FIXTURE_STAGED_STATE };
      ctx.recordData([
        { direction: "write", field: "staged", value: staged.staged },
        { direction: "read", field: "stagedPageState", value: staged.stagedPageState },
      ]);
      return staged;
    },
  });
  const commit = defineTask(writeFixtureDriverDeclaration, WriteFixtureCommit, {
    sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
    async run({ ctx }) {
      if (world.commitThrows !== undefined) throw world.commitThrows;
      if (world.commitRecordsBeforeClick) {
        ctx.recordData({ direction: "read", field: "preClickPageState", value: "ready-to-submit" });
      }
      await ctx.driver.commit("ucpath.write-fixture.save-submit", ctx.mutation);
      await world.afterCommitClickBeforeTaskSettlement?.();
      const proof = WriteFixtureProofSchema.parse(world.commitOutput);
      ctx.recordData({ direction: "write", field: "transactionId", value: proof.transactionId });
      if (world.recordUndeclaredCommitField) {
        ctx.recordData({ direction: "read", field: "undeclaredCommitField", value: "RAW_UNDECLARED_COMMIT" });
      }
      return proof;
    },
  });
  const saveCommit = defineTask(writeFixtureDriverDeclaration, WriteFixtureSaveCommit, {
    sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
    async run({ ctx }) {
      if (world.commitThrows !== undefined) throw world.commitThrows;
      if (world.commitRecordsBeforeClick) {
        ctx.recordData({ direction: "read", field: "preClickPageState", value: "ready-to-submit" });
      }
      await ctx.driver.commit("ucpath.write-fixture.save", ctx.mutation);
      await world.afterCommitClickBeforeTaskSettlement?.();
      const proof = WriteFixtureProofSchema.parse(world.commitOutput);
      ctx.recordData({ direction: "write", field: "transactionId", value: proof.transactionId });
      if (world.recordUndeclaredCommitField) {
        ctx.recordData({ direction: "read", field: "undeclaredCommitField", value: "RAW_UNDECLARED_COMMIT" });
      }
      return proof;
    },
  });
  const verify = defineTask(writeFixtureDriverDeclaration, WriteFixtureVerify, {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      world.events.push("verify");
      const next = world.verifyResults.shift();
      if (next === undefined) {
        throw new Error("write fixture verify was invoked with no queued result; the test under-provisioned it");
      }
      if (next instanceof Error) throw next;
      const verdict = await runDeclaredAction({ id: "verify-state", kind: "read", targetId: "ucpath.write-fixture.verify-state" },
        async () => ProbeOutputSchema.parse(next), (value) => value.state);
      ctx.recordData([
        { direction: "read", field: "state", value: verdict.state },
        { direction: "read", field: "eid", value: input.eid },
      ]);
      return verdict;
    },
  });
  const store = defineBrowserStore("ucpath", writeFixtureDriverDeclaration, writeFixtureSession, {
    readWriteFixtureProbe: probe,
    fillWriteFixture: prepare,
    submitWriteFixture: commit,
    saveWriteFixture: saveCommit,
    readWriteFixtureVerify: verify,
  });
  const corpus = {
    scenarioIds: [WRITE_FIXTURE_SCENARIO],
    tasks: [
      WriteFixtureProbe, WriteFixturePrepare, WriteFixtureCommit,
      WriteFixtureSaveCommit, WriteFixtureVerify,
    ].map(({ id, effect }) => ({ id, effect })),
  };
  return defineTaskStoreRegistry([store], corpus);
}

/* ── the descriptor (one transaction node; save variant selectable) ──────── */

const WriteFixtureInput = z.strictObject({ eid: EidSchema });
const WriteFixtureCanonicalInput = defineCanonicalInput(
  WriteFixtureInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: WRITE_FIXTURE_EID }],
);


interface FixtureDescriptorOptions {
  readonly contractFingerprint?: string;
  readonly version?: number;
  readonly memo?: boolean;
  readonly documentNumber?: boolean;
  readonly omittable?: boolean;
  readonly enqueue?: "reject-active" | "allow-parallel";
  readonly commitEid?: string;

  readonly dryRun?: "stop-after-prepare" | "unsupported";
  readonly traversal?: boolean;
}

function buildDescriptor(
  commitVariant: "receipt" | "save-verify",
  options: FixtureDescriptorOptions = {},
): AnyWorkflowDescriptor {
  const commitContract = commitVariant === "receipt" ? WriteFixtureCommit : WriteFixtureSaveCommit;
  const commitEid = options.commitEid;
  const fixtureInput = options.documentNumber === true ? WriteFixtureInput.extend({ documentNumber: z.string().optional() })
    : options.memo === true ? WriteFixtureInput.extend({ memo: z.string().optional() }) : WriteFixtureInput;
  const canonicalInput = options.documentNumber === true
    ? defineCanonicalInput(fixtureInput, z.strictObject({ eid: EidSchema, documentNumber: z.string().optional() }), [{ eid: WRITE_FIXTURE_EID }])
    : options.memo === true ? defineCanonicalInput(fixtureInput, z.strictObject({ eid: EidSchema, memo: z.string().optional() }), [{ eid: WRITE_FIXTURE_EID }]) : WriteFixtureCanonicalInput;
  const fixtureGraph = flow(fixtureInput)
    .transaction(WRITE_FIXTURE_NODE_ID, {
      dependsOn: [],
      prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
      commit: {
        uses: commitContract,
        bind: ({ input }) => ({ eid: EidSchema.parse(commitEid === undefined ? input.eid : commitEid) }),
      },
      dryRun: options.dryRun ?? "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    });
  const omittedFlow = () => fixtureGraph.step("read", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .build({ schema: z.strictObject({ eid: EidSchema }), dependsOn: [], derive: ({ input }) => ({ eid: input.eid }) });
  const traversalFlow = () => fixtureGraph.transaction("second-write", {
    dependsOn: [WRITE_FIXTURE_NODE_ID], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
    commit: { uses: commitContract, bind: ({ input }) => ({ eid: input.eid }) },
    previewBind: ({ input }) => ({ prepare: { eid: input.eid }, commit: { eid: input.eid }, samples: [] }),
    dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000,
  }).step("after-write", WriteFixtureProbe, { dependsOn: ["second-write"], replay: "always-rerun",
    bind: ({ input }) => ({ eid: input.eid }) }).build({ schema: z.strictObject({ transactionId: z.string().min(1) }),
      dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => ({ transactionId: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }) });
  const fixtureFlow = () => fixtureGraph.build({
    schema: z.strictObject({ transactionId: z.string().min(1) }), dependsOn: [WRITE_FIXTURE_NODE_ID],
    derive: ({ outputs }) => ({ transactionId: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }),
  });
  const definition = {
    id: WRITE_FIXTURE_WORKFLOW_ID,
    version: options.version ?? 1,
    contractFingerprint: FingerprintSchema.parse(options.contractFingerprint ?? WRITE_FIXTURE_FINGERPRINT),
    code: "wf",
    label: "Write Fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: options.enqueue ?? "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof WriteFixtureInput>) => `eid:${input.eid}` },
    presentation: { title: (input: z.output<typeof WriteFixtureInput>) => `Write fixture ${input.eid}` },
    scenarios: ["write-fixture/happy"],
    ...(options.omittable === true ? { timeline: [{ key: "reading", label: "Read", nodes: ["read"] }, { key: "write", label: "Write", nodes: [WRITE_FIXTURE_NODE_ID],
      omission: { form: { fields: [{ key: "reason", label: "Reason", kind: "text" as const }] }, produces: {} } }] } : {}),
  } as const;
  return options.omittable === true ? defineWorkflowDescriptor({ ...definition, flow: omittedFlow() })
    : options.traversal === true ? defineWorkflowDescriptor({ ...definition, flow: traversalFlow() })
    : defineWorkflowDescriptor({ ...definition, flow: fixtureFlow() });
}

export const writeFixtureDescriptor = buildDescriptor("receipt");
export const writeFixtureTraversalDescriptor = buildDescriptor("receipt", { traversal: true });
export const writeFixtureOmittableDescriptor = buildDescriptor("receipt", { omittable: true });
export const writeFixtureMemoDescriptor = buildDescriptor("receipt", { memo: true });
export const writeFixtureDocumentDescriptor = buildDescriptor("receipt", { documentNumber: true });
export const writeFixtureParallelDescriptor = buildDescriptor("receipt", { enqueue: "allow-parallel" });


export const writeFixtureDescriptorWithoutDryRunArm = buildDescriptor("receipt", {
  contractFingerprint: FingerprintSchema.parse("d".repeat(64)),
  dryRun: "unsupported",
});

// Construct the unsupported definition inside the test; a module-level throw would prevent collection.
export function defineAuthoredDryRunDescriptor(): AnyWorkflowDescriptor {
  return defineWorkflowDescriptor({
    id: WorkflowIdSchema.parse("authored-dry-run-fixture"),
    version: 1,
    contractFingerprint: FingerprintSchema.parse("e".repeat(64)),
    code: "ad",
    label: "Authored Dry Run Fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: WriteFixtureCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {
      inputRun: {
        placeholder: "Enter an EID",
        parser: {
          split: { kind: "whole-text" },
          rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "eid" }],
        },

        supportsDryRun: true,
      },
    },
    details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` },
    presentation: { title: (input) => `Authored dry run ${input.eid}` },
    scenarios: ["write-fixture/happy"],
    flow: flow(WriteFixtureInput)
      .transaction(WRITE_FIXTURE_NODE_ID, {
        dependsOn: [],
        prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
        commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
        dryRun: "stop-after-prepare",
        probePolicy: "always",
        probeToFenceMaxMs: 30_000,
      })
      .build({
        schema: z.strictObject({ transactionId: z.string().min(1) }),
        dependsOn: [WRITE_FIXTURE_NODE_ID],
        derive: ({ outputs }) => ({ transactionId: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }),
      }),
  });
}
export const writeFixtureSaveDescriptor = buildDescriptor("save-verify");



/** What an unrelated edit to `src/rules/identity/ids.ts` looks like to a stored run. */
export const WRITE_FIXTURE_MOVED_FINGERPRINT = FingerprintSchema.parse("f".repeat(64));
export const WRITE_FIXTURE_MOVED_EID = "10899999";

/** Same graph, same semantics, moved source closure — must stay resolvable. */
export const writeFixtureDescriptorAfterUnrelatedEdit = buildDescriptor("receipt", {
  contractFingerprint: WRITE_FIXTURE_MOVED_FINGERPRINT,
});

/** Moved closure AND a moved `commit.bind` — the permanent key names another transaction. */
export const writeFixtureDescriptorWithMovedKey = buildDescriptor("receipt", {
  contractFingerprint: WRITE_FIXTURE_MOVED_FINGERPRINT,
  commitEid: WRITE_FIXTURE_MOVED_EID,
});

/** Moved closure plus a durable task dependency whose checkpoint recovery must require. */
export const writeFixtureDescriptorWithDependencyAfterUnrelatedEdit = defineWorkflowDescriptor({
  id: WRITE_FIXTURE_WORKFLOW_ID,
  version: 1,
  contractFingerprint: WRITE_FIXTURE_MOVED_FINGERPRINT,
  code: "wf",
  label: "Write Fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: WriteFixtureCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `eid:${input.eid}` },
  presentation: { title: (input) => `Write fixture ${input.eid}` },
  scenarios: ["write-fixture/happy"],
  flow: flow(WriteFixtureInput)
    .step("probe-evidence", WriteFixtureProbe, {
      dependsOn: [],
      bind: ({ input }) => ({ eid: input.eid }),
      replay: "checkpoint",
    })
    .transaction(WRITE_FIXTURE_NODE_ID, {
      dependsOn: ["probe-evidence"],
      prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    })
    .build({
      schema: z.strictObject({ transactionId: z.string().min(1) }),
      dependsOn: [WRITE_FIXTURE_NODE_ID],
      derive: ({ outputs }) => ({ transactionId: outputs[WRITE_FIXTURE_NODE_ID].output.transactionId }),
    }),
});

/** Moved closure AND a declared semantic version bump — never re-derived away. */
export const writeFixtureDescriptorAtVersion2 = buildDescriptor("receipt", {
  contractFingerprint: WRITE_FIXTURE_MOVED_FINGERPRINT,
  version: 2,
});

/** Moved closure AND the transaction now commits a different task entirely. */
export const writeFixtureSaveDescriptorAfterUnrelatedEdit = buildDescriptor("save-verify", {
  contractFingerprint: WRITE_FIXTURE_MOVED_FINGERPRINT,
});

export function writeFixtureTransactionNode(
  descriptor: AnyWorkflowDescriptor,
): Extract<RuntimeFlowNode, { kind: "transaction" }> {
  const node = descriptorRuntimeNodes(descriptor)
    .find((candidate): candidate is Extract<RuntimeFlowNode, { kind: "transaction" }> =>
      candidate.kind === "transaction");
  if (node === undefined) throw new Error("write fixture descriptor lost its transaction node");
  return node;
}

/* ── run fixtures ────────────────────────────────────────────────────────── */

export const WRITE_FIXTURE_NOW = "2026-08-03T09:00:00.000Z";

export function writeFixtureQueuedRun(options: Readonly<{
  runId?: string;
  itemId?: string;
  dryRun?: boolean;
}> = {}): Record<string, unknown> {
  return {
    envelope: {
      runId: options.runId ?? WRITE_FIXTURE_RUN_ID,
      workflow: WRITE_FIXTURE_WORKFLOW_ID,
      itemId: options.itemId ?? WRITE_FIXTURE_ITEM_ID,
      traceId: "wf-090000-2222",
      descriptorVersion: 1,
      contractFingerprint: WRITE_FIXTURE_FINGERPRINT,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      shape: "single",
      priority: "bulk",
      dryRun: options.dryRun ?? false,
      attempt: 1,
      enqueuedAt: WRITE_FIXTURE_NOW,
    },
    input: {
      raw: { eid: WRITE_FIXTURE_EID },
      parsed: {
        schemaHash: deriveSchemaHash(WriteFixtureCanonicalInput, "output"),
        protectedBindings: [],
        value: { eid: WRITE_FIXTURE_EID },
      },
      ingressSchemaHash: deriveSchemaHash(WriteFixtureInput, "input"),
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: WRITE_FIXTURE_NOW,
    updatedAt: WRITE_FIXTURE_NOW,
  };
}

export function writeFixtureSessions(world: WriteFixtureWorld): SessionFactoryHarness {
  const harness = sessionFactoryHarness({ ucpath: () => createFixtureDriver(world) });
  return { ...harness, factory: { ...harness.factory, open: async input => {
    const resource = await harness.factory.open(input);
    return { ...resource, screenshot: async () => ({ state: "available" as const, sessionId: resource.sessionId,
      pageVersion: 1, observedAt: WRITE_FIXTURE_NOW, bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 }) };
  } } };
}

export async function writeFixtureSessionManager(
  harness: SessionFactoryHarness,
  registry: TaskStoreRegistry,
  clock: TestClock,
  duoCeremony?: DuoCeremonyGateFactory,
  browserScreenshotCapture?: WorkerSessionManagerOptions["browserScreenshotCapture"],
): Promise<WorkerSessionManager> {
  duoCeremony ??= await fixtureDuoCeremonyGates(clock);
  return new WorkerSessionManager({
    workerId: WorkerIdSchema.parse(WRITE_FIXTURE_WORKER_ID),
    workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID),
    stores: registry,
    browserScreenshotCapture: browserScreenshotCapture ?? { capture: async () => undefined },
    factory: harness.factory,
    clock,
    scheduler: new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony,
  });
}

export { recordingEmitter, recordingLogger };
