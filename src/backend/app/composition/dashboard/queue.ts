import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineLaneRead, type DashboardReadLanes, type LaneWarmContext } from "../../../storage/sqlite/dashboard-read-host.js";
import { aggregateMemberRetryAvailable, batchMemberRetryAvailable } from "../../../runs/queries/run-retry.js";
import type { WorkerMemberView } from "../../../runtime/workers/worker-pool.js";
import { WorkerActivitySchema, WorkerDirectiveSchema, WorkerParentMessageSchema } from "../../../runtime/workers/worker-messages.js";
import { WorkerBrowserObservationSchema, WorkerSetupRefusalCodeSchema } from "../../../../models/run/worker-control.js";
import { WorkerPoolMemberSchema, WorkerSlotRecordSchema } from "../../../../models/run/worker-slot.js";
import { ErrorCatalogCodeSchema } from "../../../../models/failures/error-catalog.js";
import { BrowserSystemIdSchema, IsoInstantSchema, LocalDateSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { systemIdFactory } from "../../../../rules/identity/identifiers.js";
import { capturedInstantClock, systemClock, type Clock } from "../../../../rules/time/clock.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { CopySamples } from "./copy-samples.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/authority-database.js";

import { createRunQueueProjection, type DashboardDayLane, type RunQueueProjection } from "../../../runs/projections/run-queue-projection.js";
import { endedUnfinished, hostedOcrRun, offeredOcrReview, readQueueRecordMembers } from "../../../runs/queries/ocr-record-members.js";
import { DESCRIPTORS, descriptorSetHash, READABLE_WORKFLOW_MODULES, SERVER_REGISTRY, workflowQueueCapabilities } from "../../registries/workflow-registry.js";
import { queryAssistantUsage } from "../../../assistant/usage-counts.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import { composeQueueSummaries } from "./queue-summaries.js";

type ProjectionInput = Parameters<typeof createRunQueueProjection>[0];
type ProjectionAuthority = ProjectionInput["authority"];

/** The store reads and process facts a queue projection reads, over one connection. */
function operatorAuthority(input: Readonly<{ database: AuthorityDatabase; reader: Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot">;
  descriptors: ProjectionInput["descriptors"];
  workerMembers?: () => readonly WorkerMemberView[]; workerStartupPending?: (workflowId: string) => boolean;
  samples?: Pick<CopySamples, "slots" | "leases"> }>): ProjectionAuthority {
  const { database, descriptors } = input;
  const changeKey = database.trackAuthorityTables(["runs", "run_batches", "worker_pools"]);
  const commandsKey = database.trackAuthorityTables(["commands"]);
  let assistantRuns: { revision: number; ids: ReadonlySet<string> } | undefined;
  return {
    batchMemberRetryAvailable: run => batchMemberRetryAvailable(database.authority, run, descriptors.resolve(run.envelope.workflow), workflowQueueCapabilities(run.envelope.workflow)),
    aggregateMemberRetryAvailable: run => aggregateMemberRetryAvailable(database.authority, input.reader, run, id => descriptors.resolve(id)),
    queueParents: envelopes => database.authority.dependencies.parents(envelopes),
    recordMembers: (run, children) => database.withAuthorityReadSnapshot(() => readQueueRecordMembers(database.authority, input.reader,
      run, children, id => descriptors.resolve(id))),
    reviewAvailable: runId => database.withAuthorityReadSnapshot(() => {
      const current = input.reader.read(runId);
      if (current.state !== "present" || current.disposition !== "live") return false;
      const ocr = current.run.envelope.workflow === "ocr" ? current.run : hostedOcrRun(database.authority, current.run);
      return ocr !== undefined && !endedUnfinished(current.run) && offeredOcrReview(database.authority, input.reader, ocr) !== undefined;
    }),
    listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
    listGateResults: runId => database.authority.gateResults.listByRun(runId),
    listWorkerSlots: () => database.authority.workerSlots.list(),
    ...(input.samples === undefined ? {} : { listSampleWorkerSlots: input.samples.slots }),
    listWorkerRuns: workerId => database.authority.runs.listByWorker(workerId),
    ...(input.workerMembers === undefined ? {} : { workerMembers: input.workerMembers }),
    ...(input.workerStartupPending === undefined ? {} : { workerStartupPending: input.workerStartupPending }),
    heldDuoLeases: workerId => input.samples?.leases(workerId) ?? database.heldDuoLeases(workerId),
    listWorkerPools: () => database.authority.workerPools.list(),
    listRunBatches: () => database.authority.runSessions.list(),
    getRunBatch: (id) => database.authority.runSessions.get(id),
    getFailure: (failureId) => database.authority.failures.get(failureId),
    writeInFlight: runId => database.authority.writeIntents.listByRun(runId).some(intent => intent.status === "attempting"),
    changeKey,
    checkDaySources: (day, previous) => database.checkQueueDaySources(day, previous),
    nextDuoLeaseExpiry: nowMs => database.nextDuoLeaseExpiry(nowMs),
    delegationWait: runId => database.authority.dependencies.waitState(runId),
    getReceipt: (runId) => database.authority.evidenceReceipts.findByRun(runId),
    canonicalPerson: (runId) => database.canonicalPerson(runId),
    startedByAssistant: runId => {
      const revision = commandsKey();
      if (revision === undefined || assistantRuns?.revision !== revision) {
        const ids = database.assistantStartedRunIds();
        if (revision === undefined) return ids.has(runId);
        assistantRuns = { revision, ids };
      }
      return assistantRuns.ids.has(runId);
    },
    // Ref dashboard-surfaces: the one stored node output a queue row reads — the
    // subject's name, at the leaf the descriptor declares.
    latestCheckpoint: (workflowId, itemId, nodeId) =>
      database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
  };
}

const readableDescriptors: ProjectionInput["descriptors"] = { resolve: id => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
const WORKFLOW_IDS = Object.freeze(READABLE_WORKFLOW_MODULES.map(module => module.descriptor.id));

/* ── process facts ───────────────────────────────────────────────────────── */

const exitBase = { code: z.number().int().nullable(), signal: z.string().nullable(), at: z.string().min(1), settlement: z.enum(["settled", "failed"]) };
const WorkerExitFactSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ ...exitBase, outcome: z.literal("stopped"), reason: WorkerParentMessageSchema.options[0].shape.reason.optional() }),
  z.strictObject({ ...exitBase, outcome: z.literal("crashed"), failureCode: ErrorCatalogCodeSchema.optional() }),
  z.strictObject({ ...exitBase, outcome: z.literal("setup-refused"), failureCode: WorkerSetupRefusalCodeSchema }),
]);

const WorkerMemberViewSchema = z.strictObject({
  member: WorkerPoolMemberSchema,
  lifetimeId: z.string().min(1),
  version: z.number().int().nonnegative(),
  state: z.enum(["starting", "running", "stopping", "exited"]),
  directive: WorkerDirectiveSchema,
  pid: z.number().int().positive().optional(),
  startedAt: z.string().min(1),
  activity: WorkerActivitySchema.optional(),
  browsers: z.array(WorkerBrowserObservationSchema),
  browserSystems: z.array(BrowserSystemIdSchema).optional(),
  exit: WorkerExitFactSchema.optional(),
  held: z.enum(["exit-unobserved", "kill-undelivered"]).optional(),
});
/** What main alone knows: its worker pool's members and which workflows are still starting them. */
const ProcessFactsSchema = z.strictObject({ workers: z.array(WorkerMemberViewSchema), startupPending: z.array(WorkflowIdSchema),
  sampleSessions: z.array(z.strictObject({ slot: WorkerSlotRecordSchema,
    leases: z.array(z.strictObject({ system: BrowserSystemIdSchema, since: IsoInstantSchema })) })).optional() });
type ProcessFacts = Readonly<{ workers: readonly WorkerMemberView[]; startupPending: readonly string[];
  sampleSessions?: ReturnType<CopySamples["dayFacts"]> }>;

function exitOf(exit: z.infer<typeof WorkerExitFactSchema> | undefined): WorkerMemberView["exit"] {
  if (exit === undefined) return undefined;
  const base = { code: exit.code, signal: exit.signal, at: exit.at, settlement: exit.settlement };
  switch (exit.outcome) {
    case "stopped": return { ...base, outcome: exit.outcome, ...(exit.reason === undefined ? {} : { reason: exit.reason }) };
    case "crashed": return { ...base, outcome: exit.outcome, ...(exit.failureCode === undefined ? {} : { failureCode: exit.failureCode }) };
    case "setup-refused": return { ...base, outcome: exit.outcome, failureCode: exit.failureCode };
  }
}

/** The facts main sent, admitted back into the views the projection reads. */
function admitProcessFacts(input: unknown): ProcessFacts {
  const parsed = ProcessFactsSchema.parse(input);
  const workers = parsed.workers.map((view): WorkerMemberView => ({ member: view.member, lifetimeId: view.lifetimeId, version: view.version,
    state: view.state, directive: view.directive, pid: view.pid, startedAt: view.startedAt, activity: view.activity, browsers: view.browsers,
    ...(view.browserSystems === undefined ? {} : { browserSystems: view.browserSystems }), exit: exitOf(view.exit), held: view.held }));
  return { workers, startupPending: parsed.startupPending,
    ...(parsed.sampleSessions === undefined ? {} : { sampleSessions: parsed.sampleSessions }) };
}

/* ── the lane's replica ──────────────────────────────────────────────────── */

/** The package version the replica reports; read in the lane, where this module is loaded from the file system. */
const laneAppVersion = (): string => z.object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8"))).version;
const LANE_DESCRIPTOR_SET_HASH = descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint));

interface LaneReplica {
  readonly projection: RunQueueProjection;
  readonly state: {
    /** The read's instant: the replica folds and builds at main's dispatch time. */
    at: Clock;
    facts: ProcessFacts;
    /** The facts as main sent them, for the days the replica cached; undefined until a read sends them. */
    factsKey: string | undefined;
  };
}
const replicas = new WeakMap<AuthorityDatabase, LaneReplica>();

/** One projection per lane connection, folded from the timeline pages that connection reads. */
function laneReplica(context: LaneWarmContext): LaneReplica {
  const held = replicas.get(context.history);
  if (held !== undefined) return held;
  const { history } = context;
  const noFacts: ProcessFacts = { workers: [], startupPending: [] };
  const state: LaneReplica["state"] = { at: capturedInstantClock(new Date(context.nowMs).toISOString()), facts: noFacts, factsKey: undefined };
  const clock: Clock = Object.freeze({
    now: () => state.at.now(), nowMs: () => state.at.nowMs(), monotonicMs: () => systemClock.monotonicMs(), todayLocal: () => state.at.todayLocal(),
    timeOfDayCode: (at?: Date) => state.at.timeOfDayCode(at), fiscalYear: (at?: Date) => state.at.fiscalYear(at),
  });
  const reader = new RunRecordService({ database: history, clock, ids: systemIdFactory,
    publishQueued: () => { throw new Error("read-lane-write-refused"); }, resolveDescriptor: id => SERVER_REGISTRY[id]?.descriptor });
  const summaries = { ...composeQueueSummaries(history), activity: () => { throw new Error("read-lane-activity-unserved"); } };
  const projection = createRunQueueProjection({
    assistantUsage: (from, to, generatedAt) => queryAssistantUsage(history, { from, to, generatedAt }),
    timeline: history.authority.timelineEvents, stateRoot: context.start.stateRoot, clock, appVersion: laneAppVersion(),
    descriptorSetHash: LANE_DESCRIPTOR_SET_HASH, ledger: createTransactionHistory(history.authority), queueCapabilities: workflowQueueCapabilities,
    descriptors: readableDescriptors, replica: true,
    reader: { read: reader.read.bind(reader), list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader), summaries },
    authority: operatorAuthority({ database: history, reader, descriptors: readableDescriptors,
      workerMembers: () => state.facts.workers, workerStartupPending: workflowId => state.facts.startupPending.includes(workflowId),
      samples: {
        slots: () => state.facts.sampleSessions?.map(({ slot }) => slot) ?? [],
        leases: workerId => state.facts.sampleSessions?.find(({ slot }) => slot.workerId === workerId)?.leases,
      } }),
  });
  const replica: LaneReplica = { projection, state };
  replicas.set(history, replica);
  return replica;
}

const QueueDayArgsSchema = z.strictObject({
  day: LocalDateSchema,
});

/** Queue and Sessions use a replica built on the first day read from the timeline in that read's snapshot. */
export const queueDayRead = defineLaneRead(import.meta.url, "dashboard-queue-day", {
  lane: "navigation", priority: "interactive", processFacts: true, args: QueueDayArgsSchema, sourceProof: "per-read",
  run(context, { day }) {
    const replica = laneReplica(context);
    replica.state.at = capturedInstantClock(new Date(context.nowMs).toISOString());
    const factsKey = JSON.stringify(context.processFacts);
    replica.state.facts = admitProcessFacts(context.processFacts);
    if (factsKey !== replica.state.factsKey) {
      replica.state.factsKey = factsKey;
      replica.projection.processFactsChanged();
    }
    replica.projection.ingestFromTimeline();
    const health = replica.projection.health();
    if (health.state === "degraded") throw new Error(`queue-day-fold-degraded: ${health.lastError ?? "unknown"}`);
    return replica.projection.buildLaneDay(day);
  },
});

/** Main's side of the lane day: the process facts it sends, under a revision that moves whenever they change. */
function createDayLane(lanes: DashboardReadLanes, workerMembers: () => readonly WorkerMemberView[],
  workerStartupPending: (workflowId: string) => boolean, samples?: Pick<CopySamples, "dayFacts">): DashboardDayLane {
  let revision = 0, held: string | undefined;
  const facts = (): Readonly<{ revision: number; facts: ProcessFacts }> => {
    const current: ProcessFacts = { workers: workerMembers(), startupPending: WORKFLOW_IDS.filter(workflowId => workerStartupPending(workflowId)),
      ...(samples === undefined ? {} : { sampleSessions: samples.dayFacts() }) };
    const key = JSON.stringify(current);
    if (key !== held) { held = key; revision += 1; }
    return { revision, facts: current };
  };
  return {
    processRevision: () => facts().revision,
    async read(day, request) {
      const reply = await lanes.read(queueDayRead, { day }, {
        processFacts: facts(), ...(request.slot === undefined ? {} : { slot: request.slot }), ...(request.signal === undefined ? {} : { signal: request.signal }) });
      return { body: reply.body, processRevision: reply.position.processRevision };
    },
  };
}

export function createOperatorProjection(input: Omit<ProjectionInput, "authority" | "timeline" | "assistantUsage" | "dayLane" | "replica"> & { database: AuthorityDatabase; workerMembers?: () => readonly WorkerMemberView[];
  workerStartupPending?: (workflowId: string) => boolean; reader: Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot">;
  /** With lanes, the day is built on the navigation lane from its replica; the pool's members are then required. */
  readLanes?: DashboardReadLanes;
  /** A copy's sample Sessions cards, served beside the durable worker slots. */
  samples?: Pick<CopySamples, "slots" | "leases" | "dayFacts"> }) {
  const { stateRoot, clock, appVersion, descriptorSetHash: setHash, ledger, database, descriptors } = input;
  let dayLane: DashboardDayLane | undefined;
  if (input.readLanes !== undefined) {
    if (input.workerMembers === undefined) throw new Error("queue-day-lane-worker-members-required");
    dayLane = createDayLane(input.readLanes, input.workerMembers, input.workerStartupPending ?? (() => false), input.samples);
  }
  return createRunQueueProjection({
    assistantUsage: (from, to, generatedAt) => queryAssistantUsage(database, { from, to, generatedAt }),
    timeline: database.authority.timelineEvents,
    stateRoot,
    clock,
    appVersion,
    descriptorSetHash: setHash,
    ledger,
    reader: input.reader,
    queueCapabilities: workflowQueueCapabilities,
    authority: operatorAuthority({ database, reader: input.reader, descriptors,
      ...(input.workerMembers === undefined ? {} : { workerMembers: input.workerMembers }),
      ...(input.workerStartupPending === undefined ? {} : { workerStartupPending: input.workerStartupPending }),
      ...(input.samples === undefined ? {} : { samples: input.samples }) }),
    descriptors,
    ...(dayLane === undefined ? {} : { dayLane }),
  });
}
