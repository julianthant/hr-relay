/**
 * Offline recovery for the one crash window between committed run authority
 * and its required `run.queued` JSONL root.
 *
 * Existing span bytes are immutable. Recovery therefore appends one marked
 * root whose identity is derived entirely from the run/session/start-plan
 * authority. The shared restore admission excludes a server or worker start
 * while the stopped proof is consumed and the line is durably appended.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { FingerprintSchema, RunIdSchema, WorkflowIdSchema } from "../../domain/ids.js";
import { localDatePart } from "../../domain/clock.js";
import { SpanEventWireSchema } from "../../events/types.js";
import { eventStreamFileName, readEventStreamLines } from "../../infra/events/jsonl-streams.js";
import { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { RecoveryStopProofStore } from "../../infra/sqlite/recovery-stop-proof.js";
import { StoppedSystemProofSchema } from "../../infra/sqlite/recovery-contracts.js";
import {
  acquireRuntimeRestoreAdmission,
  observeRuntimeLockSnapshot,
  type RestoreAdmissionHandle,
} from "../../infra/sqlite/runtime-process-locks.js";
import { runQueuedSpanEvent } from "../dashboard/commands/run-queued-span.js";

const NonNegativeIntSchema = z.number().int().nonnegative();

export const SpanRootRepairRequestSchema = z.strictObject({
  runId: RunIdSchema,
  stoppedSystemProof: StoppedSystemProofSchema,
});

export const SpanRootRepairReportSchema = z.strictObject({
  state: z.enum(["repaired", "already-repaired"]),
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  streamFileName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}\.jsonl$/u),
  repairedAt: z.iso.datetime({ offset: true }),
  sourceAuthorityGeneration: NonNegativeIntSchema,
  sourceAuthorityFingerprint: FingerprintSchema,
  priorStreamBytes: NonNegativeIntSchema,
  priorStreamSha256: FingerprintSchema,
});
export type SpanRootRepairReport = z.infer<typeof SpanRootRepairReportSchema>;

export const OfflineSpanRootRepairOptionsSchema = z.strictObject({
  stateRoot: z.string().min(1),
  authorityPath: z.string().min(1),
  processLockRoot: z.string().min(1),
  stoppedProofMaxAgeMs: z.number().int().positive(),
  busyTimeoutMs: z.number().int().positive(),
});

type AdmissionFactory = (
  input: Readonly<{ processLockRoot: string; pid: number }>,
  clock: Clock,
) => RestoreAdmissionHandle;

function sha256(bytes: Buffer): string {
  return FingerprintSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function appendDurably(path: string, line: string): void {
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`span repair target ${basename(path)} is not a regular file`);
    const bytes = Buffer.from(`${line}\n`, "utf8");
    const written = writeSync(descriptor, bytes);
    if (written !== bytes.byteLength) {
      throw new Error(
        `span repair append to ${basename(path)} wrote ${String(written)} of ${String(bytes.byteLength)} bytes`,
      );
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncPath(dirname(path));
}

function withoutProcessRepairFields(event: z.infer<typeof SpanEventWireSchema>): unknown {
  const { pid: _pid, repair: _repair, ...identity } = event as z.infer<typeof SpanEventWireSchema> & {
    readonly repair?: unknown;
  };
  return identity;
}

function parseExistingSpanLine(input: Readonly<{
  text: string;
  lineNumber: number;
  file: Readonly<{ path: string }>;
}>): z.infer<typeof SpanEventWireSchema> {
  try {
    return SpanEventWireSchema.parse(JSON.parse(input.text));
  } catch {
    throw new Error(
      `span root repair refused unreadable ${basename(input.file.path)} line ${String(input.lineNumber)}`,
    );
  }
}

export class OfflineSpanRootRepairService {
  readonly #stateRoot: string;
  readonly #authorityPath: string;
  readonly #processLockRoot: string;
  readonly #busyTimeoutMs: number;
  readonly #clock: Clock;
  readonly #proofs: RecoveryStopProofStore;
  readonly #admissionFactory: AdmissionFactory;
  readonly #pid: number;

  constructor(
    input: unknown,
    clock: Clock = systemClock,
    admissionFactory: AdmissionFactory = acquireRuntimeRestoreAdmission,
    pid: number = process.pid,
  ) {
    const options = OfflineSpanRootRepairOptionsSchema.parse(input);
    this.#stateRoot = resolve(options.stateRoot);
    this.#authorityPath = resolve(options.authorityPath);
    this.#processLockRoot = resolve(options.processLockRoot);
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#clock = clock;
    this.#admissionFactory = admissionFactory;
    this.#pid = z.number().int().positive().parse(pid);
    this.#proofs = new RecoveryStopProofStore({
      processLockRoot: this.#processLockRoot,
      maxProofAgeMs: options.stoppedProofMaxAgeMs,
    }, clock);
  }

  repair(input: unknown): SpanRootRepairReport {
    const request = SpanRootRepairRequestSchema.parse(input);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(this.#authorityPath);
    const admission = this.#admissionFactory({
      processLockRoot: this.#processLockRoot,
      pid: this.#pid,
    }, this.#clock);
    try {
      const liveSnapshot = observeRuntimeLockSnapshot({
        processLockRoot: this.#processLockRoot,
        sourceDatabaseIdentity,
      }, this.#clock);
      this.#proofs.consumeAgainstLiveSnapshot(request.stoppedSystemProof, liveSnapshot);

      const before = AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(
        this.#authorityPath,
        this.#busyTimeoutMs,
      );
      const database = AuthorityDatabase.open({
        path: this.#authorityPath,
        busyTimeoutMs: this.#busyTimeoutMs,
        migrationOwner: "span-root-repair",
      }, this.#clock);
      let queued: ReturnType<typeof runQueuedSpanEvent>;
      try {
        const run = database.authority.runs.get(request.runId);
        if (run === undefined) throw new Error(`span root repair run ${request.runId} does not exist`);
        if (run.sessionId === undefined) {
          throw new Error(`span root repair run ${request.runId} has no durable run session`);
        }
        const session = database.authority.runSessions.get(run.sessionId);
        if (session === undefined) throw new Error(`span root repair run ${request.runId} names a missing run session`);
        if (session.origin.kind !== "start-plan") {
          throw new Error(`span root repair run ${request.runId} was not started from a start plan`);
        }
        const plan = database.authority.startPlans.get(session.origin.startPlanId);
        if (plan === undefined) throw new Error(`span root repair run ${request.runId} names a missing start plan`);
        if (plan.consumedBy === undefined) {
          throw new Error(`span root repair run ${request.runId} names an unconsumed start plan`);
        }
        const matches = plan.planned.filter((candidate) => candidate.runId === request.runId);
        if (matches.length !== 1 || matches[0] === undefined) {
          throw new Error(
            `span root repair run ${request.runId} has ${String(matches.length)} matching planned entries; exactly one is required`,
          );
        }
        const planned = matches[0];
        const envelope = run.envelope;
        const bindings = [
          ["workflow", session.workflow, envelope.workflow],
          ["session start", session.startedAt, envelope.enqueuedAt],
          ["plan workflow", plan.workflowId, envelope.workflow],
          ["planned item", planned.itemId, envelope.itemId],
          ["planned trace", planned.traceId, envelope.traceId],
          ["descriptor version", plan.descriptorVersion, envelope.descriptorVersion],
          ["descriptor fingerprint", plan.descriptorFingerprint, envelope.contractFingerprint],
          ["config fingerprint", plan.configFingerprint, envelope.configFingerprint],
          ["config snapshot", plan.configSnapshotId, envelope.configSnapshotId],
          ["shape", plan.shape, envelope.shape],
          ["priority", plan.priority, envelope.priority],
          ["dry-run", plan.dryRun, envelope.dryRun],
          ["actor", plan.plannedBy, session.origin.actorId],
        ] as const;
        const mismatch = bindings.find(([, left, right]) => !sameJson(left, right));
        if (mismatch !== undefined) {
          throw new Error(`span root repair run ${request.runId} disagrees with its ${mismatch[0]} authority`);
        }
        if (!sameJson(plan.resolvedInstance, envelope.resolvedInstance)
          || !sameJson(planned.rawInput, run.input.raw)
          || !sameJson(planned.input, run.input.parsed)) {
          throw new Error(`span root repair run ${request.runId} disagrees with its planned input or instance authority`);
        }
        queued = runQueuedSpanEvent({
          run,
          actorId: session.origin.actorId,
          title: planned.title,
          ...(planned.subtitle === undefined ? {} : { subtitle: planned.subtitle }),
        });
      } finally {
        database.close();
      }
      const after = AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(
        this.#authorityPath,
        this.#busyTimeoutMs,
      );
      if (before.authorityGeneration !== after.authorityGeneration
        || before.authorityContentFingerprint !== after.authorityContentFingerprint) {
        throw new Error(`span root repair run ${request.runId} authority changed during reconstruction`);
      }

      const runEvents = readEventStreamLines(this.#stateRoot, "spans")
        .map((line) => ({ line, event: parseExistingSpanLine(line) }))
        .filter(({ event }) => "runId" in event && event.runId === request.runId);
      const expectedIdentity = withoutProcessRepairFields(SpanEventWireSchema.parse({ ...queued, pid: this.#pid }));
      const existingRoots = runEvents.filter(({ event }) => event.t === "run.queued");
      if (existingRoots.length > 0) {
        if (existingRoots.length === 1) {
          const root = existingRoots[0]?.event;
          if (root?.t === "run.queued" && "repair" in root && root.repair !== undefined
            && sameJson(withoutProcessRepairFields(root), expectedIdentity)) {
            return SpanRootRepairReportSchema.parse({
              state: "already-repaired",
              runId: request.runId,
              workflow: root.workflow,
              streamFileName: basename(existingRoots[0]?.line.file.path ?? ""),
              repairedAt: root.repair.repairedAt,
              sourceAuthorityGeneration: root.repair.sourceAuthorityGeneration,
              sourceAuthorityFingerprint: root.repair.sourceAuthorityFingerprint,
              priorStreamBytes: root.repair.priorStreamBytes,
              priorStreamSha256: root.repair.priorStreamSha256,
            });
          }
        }
        throw new Error(`span root repair run ${request.runId} already has ${String(existingRoots.length)} queue root(s)`);
      }
      if (runEvents.length === 0) {
        throw new Error(`span root repair run ${request.runId} has no span events to recover around`);
      }

      const streamFileName = eventStreamFileName(queued.workflow, localDatePart(new Date(queued.ts)));
      const streamPath = join(this.#stateRoot, "spans", streamFileName);
      const stat = lstatSync(streamPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`span root repair target ${streamFileName} is not a regular no-follow file`);
      }
      const priorBytes = readFileSync(streamPath);
      const repairedAt = this.#clock.now().toISOString();
      const repair = {
        kind: "authority-reconstruction",
        repairedAt,
        sourceAuthorityGeneration: before.authorityGeneration,
        sourceAuthorityFingerprint: before.authorityContentFingerprint,
        priorStreamBytes: priorBytes.byteLength,
        priorStreamSha256: sha256(priorBytes),
      } as const;
      const repairedRoot = SpanEventWireSchema.parse({ ...queued, pid: this.#pid, repair });
      appendDurably(streamPath, JSON.stringify(repairedRoot));
      return SpanRootRepairReportSchema.parse({
        state: "repaired",
        runId: request.runId,
        workflow: queued.workflow,
        streamFileName,
        repairedAt,
        sourceAuthorityGeneration: before.authorityGeneration,
        sourceAuthorityFingerprint: before.authorityContentFingerprint,
        priorStreamBytes: priorBytes.byteLength,
        priorStreamSha256: repair.priorStreamSha256,
      });
    } finally {
      admission.release();
    }
  }
}
