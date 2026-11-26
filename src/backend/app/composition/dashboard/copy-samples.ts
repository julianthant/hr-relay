import { z } from "zod";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import type { RerunValuesResponse } from "../../../../models/dashboard/rerun-values.js";
import { workerPoolMember, WorkerSlotRecordSchema, type WorkerSlotRecord } from "../../../../models/run/worker-slot.js";
import { WorkerBrowserObservationSchema } from "../../../../models/run/worker-control.js";
import { CommandResultSchema, type CommandResult } from "../../../../rules/commands/commands.js";
import { deriveStableUuid } from "../../../../rules/identity/identifiers.js";
import { BrowserSystemIdSchema, CommandIdSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, WorkerIdSchema, WorkflowIdSchema, type BrowserSystemId, type IsoInstant } from "../../../../rules/identity/ids.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import type { CommandKernel } from "../../../runs/commands/command-kernel.js";
import type { WorkerMemberView } from "../../../runtime/workers/worker-pool.js";

/** Sample workers take ordinals above this, so they never share an ID with a real worker. */
export const SAMPLE_WORKER_ORDINAL_FLOOR = 9000;
const namespace = "relay-copy-seed-session";
const fingerprint = sha256Hex(namespace);

/** One sample Sessions card as the copy seed stores it: a worker in one state and the browsers it holds. */
export const CopySampleSessionSchema = z.strictObject({
  workflow: WorkflowIdSchema, ordinal: PositiveIntSchema.refine(ordinal => ordinal > SAMPLE_WORKER_ORDINAL_FLOOR, "sample worker ordinal too low"),
  state: z.enum(["idle", "busy", "waiting", "starting", "stopping", "stopped"]),
  runId: RunIdSchema.optional(), startedAt: IsoInstantSchema,
  browsers: z.array(z.strictObject({ system: BrowserSystemIdSchema, health: z.enum(["starting", "authenticated", "unknown"]), duo: z.boolean() })),
}).refine(session => (session.state === "busy") === (session.runId !== undefined), "a busy sample worker names its run");
export type CopySampleSession = z.input<typeof CopySampleSessionSchema>;

export function sampleWorkerId(session: Readonly<{ workflow: string; ordinal: number }>) {
  return WorkerIdSchema.parse(`${session.workflow}-worker-${String(session.ordinal)}`);
}

type Sample = Readonly<{ session: z.output<typeof CopySampleSessionSchema>; poolIndex: number; slot: WorkerSlotRecord; view: WorkerMemberView;
  leases: readonly { system: BrowserSystemId; since: IsoInstant }[] }>;

function sampleOf(raw: unknown, poolIndex: number): Sample {
  const session = CopySampleSessionSchema.parse(raw);
  const workerId = sampleWorkerId(session);
  const { startedAt } = session;
  const slot = WorkerSlotRecordSchema.parse({ workerId, workflow: session.workflow, ordinal: session.ordinal, poolIndex,
    paused: false, retiredAt: null, createdAt: startedAt, updatedAt: startedAt });
  const browsers = session.browsers.map(browser => WorkerBrowserObservationSchema.parse({ workerId,
    sessionId: deriveStableUuid(namespace, `${workerId}/${browser.system}`), system: browser.system,
    configFingerprint: fingerprint, signInFingerprint: fingerprint, browserMode: "headless", acceptDownloads: false, exclusive: false,
    health: browser.health, observedAt: startedAt, openedAt: startedAt, profileRevision: 1 }));
  const state = ({ idle: "running", busy: "running", waiting: "running", starting: "starting", stopping: "stopping", stopped: "exited" } as const)[session.state];
  const view: WorkerMemberView = {
    member: workerPoolMember(slot),
    lifetimeId: deriveStableUuid(namespace, `${workerId}/${session.state === "stopped" ? "stopped" : "lifetime"}`), version: 1,
    state,
    directive: "run", pid: undefined, startedAt,
    activity: session.state === "busy" && session.runId !== undefined ? { state: "busy", runId: RunIdSchema.parse(session.runId) }
      : session.state === "waiting" ? { state: "waiting", waiting: "authenticating" } : state === "running" ? { state: "idle" } : undefined,
    browsers, browserSystems: session.browsers.map(browser => browser.system),
    exit: session.state === "stopped" ? { outcome: "stopped", reason: "operator", code: 0, signal: null, at: startedAt, settlement: "settled" } : undefined,
    held: undefined,
  };
  const leases = session.state === "stopped" ? [] : session.browsers.filter(browser => browser.duo).map(browser => ({ system: browser.system, since: startedAt }));
  return { session, poolIndex, slot, view, leases };
}

type StoredSamples = Readonly<{ runIds: readonly string[]; sessions: readonly Readonly<{ workerId: string; payload: unknown }>[] }>;

function parseStored(stored: StoredSamples) {
  const sessions = stored.sessions.map(({ workerId, payload }, index) => {
    const sample = sampleOf(payload, index + 1);
    if (sample.slot.workerId !== workerId) throw new Error("copy-sample-session-identity-mismatch");
    return sample;
  });
  return { runIds: new Set(stored.runIds.map(id => RunIdSchema.parse(id))), sessions };
}

const RunTargetSchema = z.object({ commandId: CommandIdSchema, target: z.object({ runId: RunIdSchema }) });
const WorkerTargetSchema = z.object({ commandId: CommandIdSchema, family: z.literal("worker-browser"), type: z.string(), target: z.object({ workerId: WorkerIdSchema }) });

/**
 * The copy's sample runs and Sessions cards. The runs live in the history archive the executor never reads; the cards are
 * served beside the pool's members but never reach it. Every command on either is answered here.
 */
export function createCopySamples(input: Readonly<{ stored: StoredSamples; realSlots: () => readonly WorkerSlotRecord[]; changed: () => void }>) {
  const { runIds, sessions } = parseStored(input.stored);
  const real = new Set(input.realSlots().map(slot => slot.workerId));
  if (sessions.some(sample => real.has(sample.slot.workerId))) throw new Error("copy-sample-worker-collision");
  const samples = new Map(sessions.map(sample => [sample.slot.workerId, sample]));
  const refused = (commandId: string): CommandResult => CommandResultSchema.parse({ state: "rejected", commandId, code: "SAMPLE_RUN_REFUSED", message: ERROR_CATALOG.SAMPLE_RUN_REFUSED.text });
  const workerCommand = (request: unknown): CommandResult | undefined => {
    const parsed = WorkerTargetSchema.safeParse(request);
    if (!parsed.success) return undefined;
    const { commandId, type, target: { workerId } } = parsed.data;
    const sample = samples.get(workerId);
    if (sample === undefined) return undefined;
    // Stop settles the card as stopped, as a real worker's does; closing it removes the card.
    if (type === "stop-worker" && sample.session.state !== "stopped") samples.set(workerId, sampleOf({ ...sample.session, state: "stopped", runId: undefined }, sample.poolIndex));
    else if (type === "remove-worker") samples.delete(workerId);
    else return refused(commandId);
    input.changed();
    return CommandResultSchema.parse({ state: "applied", commandId, affectedTargets: [{ family: "worker-browser", workerId }] });
  };
  const runCommand = (request: unknown): CommandResult | undefined => {
    const parsed = RunTargetSchema.safeParse(request);
    return parsed.success && runIds.has(parsed.data.target.runId) ? refused(parsed.data.commandId) : undefined;
  };
  return Object.freeze({
    slots: (): readonly WorkerSlotRecord[] => [...samples.values()].map(sample => sample.slot),
    views: (): readonly WorkerMemberView[] => [...samples.values()].map(sample => sample.view),
    leases: (workerId: string) => samples.get(WorkerIdSchema.parse(workerId))?.leases,
    rerunValues: (request: unknown): RerunValuesResponse | undefined => {
      const parsed = z.object({ runId: RunIdSchema }).safeParse(request);
      return parsed.success && runIds.has(parsed.data.runId) ? { state: "refused", code: "sample-run" } : undefined;
    },
    guard: (kernel: CommandKernel): CommandKernel => Object.freeze({ ...kernel,
      execute: (request: unknown, parentCommandId?: string) => runCommand(request) ?? workerCommand(request) ?? kernel.execute(request, parentCommandId),
      executeWorkerPool: async (request: unknown) => workerCommand(request) ?? runCommand(request) ?? kernel.executeWorkerPool(request),
    }),
  });
}
export type CopySamples = ReturnType<typeof createCopySamples>;
