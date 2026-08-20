/**
 * Ref write-safety §4 crash-window recovery (D118) and the §4.1 typed operator
 * resolutions behind the command kernel's `WriteResolutionExecutor` seam.
 *
 * Recovery has scheduling priority over claim expiry: the D118 sweep routes a
 * dead claim whose run owns an unfinished `attempting` intent here BEFORE any
 * ordinary requeue. This service re-runs the idempotency probe FIRST and
 * settles exactly one of ref write-safety §4's arms:
 *
 *   present + valid proof   → beat-⑦ backfill (same parsers as beat ⑥) + resume
 *   present + invalid proof → park `present-proof-invalid` (never done)
 *   qualified stabilized absence (D64/D69) → `retryable` + resume; ONLY this
 *                             arm may let a later fence mint a new generation
 *   not-yet-qualified absence → typed `wait` (a `not_before` requeue decision —
 *                             never a sleeping worker, никогда retry authority)
 *   ambiguous / unknown / inconsistent / operator-only / probe throw → park
 *
 * The operator resolutions are the ONLY release paths for a parked write:
 * confirmed-present re-runs the same atomic beat ⑦ under the same proof
 * parsers; confirmed-absent records the typed evidence note and marks the same
 * permanent intent `retryable`. There is no generic Done/Retry.
 *
 * D116: the recovery probe's driver lease runs outside any worker loop, so
 * `recover` itself binds the target run's retained `configFingerprint` around
 * the lease (see `WriteRecoveryDependencies.sessions`). The typed operator
 * resolutions are pure authority work and lease no driver, so no binding
 * applies there.
 */
import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import { JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import type { AnyCommitTaskContract } from "../domain/contracts/base.js";
import type { IdFactory } from "../domain/identifiers.js";
import {
  ActorIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WriteIntentIdSchema,
} from "../domain/ids.js";
import type { Fingerprint, TaskId } from "../domain/ids.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import {
  evaluateNegativeSettlement,
  NegativeSettlementPolicySchema,
  RecoveryProbeVerdictSchema,
  type WriteIntentRecord,
} from "../domain/write-safety.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import {
  rebuildCommitInput,
  requireWriteResolutionBinding,
  type TransactionRuntimeNode,
  type WriteBindingRepositories,
  type WriteResolutionArm,
} from "./write-resolution-binding.js";
export {
  findTransactionNodeByCommit,
  rebuildCommitInput,
} from "./write-resolution-binding.js";
import {
  BUILD_MANIFEST,
  resolveTaskImplFingerprint,
} from "../domain/workflow/build-manifest.js";
import { rejectCommandRequest } from "./command-kernel.js";
import type {
  WriteResolutionContext,
  WriteResolutionExecutor,
  WorkflowDescriptorResolver,
} from "./command-kernel.js";
import {
  buildCommittedSettlement,
  executeIdempotencyProbe,
  executeSequencedWriteCommit,
  type ProbeReadDeps,
  type RuntimeProbeVerdict,
  type TransactionSessionHost,
  type WriteSequencerAuthority,
  type WriteSequencerHooks,
} from "./write-sequencer.js";
import type { RunConfigFingerprintBinding } from "./worker-sessions.js";
import type { WriteIntentParkCode } from "../infra/sqlite/write-commit-contracts.js";
import type { TaskStoreRegistry } from "../base/store.js";
import type { TaskLogger } from "../base/task.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";

/* ── the typed recovery decision ─────────────────────────────────────────── */

export const WriteRecoveryDecisionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("backfilled"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("safe-to-retry"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("wait"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
    notBefore: IsoInstantSchema,
    observationsNeeded: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("parked"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
    code: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]),
    message: z.string().min(1),
  }),
]);
export type WriteRecoveryDecision = z.infer<typeof WriteRecoveryDecisionSchema>;

export interface WriteRecoveryDependencies {
  readonly stores: TaskStoreRegistry;
  readonly authority: WriteSequencerAuthority;
  /**
   * D116 (ref clock-config-secrets §4): the recovery probe leases a driver OUTSIDE any worker
   * loop's claimed-run binding window, so the host must also expose the
   * bind/release surface — `recover` binds the TARGET run's retained immutable
   * `configFingerprint` around its probe lease and releases it afterwards.
   * `WorkerSessionManager` satisfies this.
   */
  readonly sessions: Pick<TransactionSessionHost, "withDriver"> & RunConfigFingerprintBinding;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly taskDeadlineMs: number;
  readonly operator: unknown;
  readonly log: TaskLogger;
  readonly resolveImplFingerprint?: (taskId: TaskId) => Fingerprint;
  readonly hooks?: WriteSequencerHooks;
}

export interface WriteRecoveryInput {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly writeIntentId: string;
  /**
   * Absence observations collected EARLIER in this recovery episode, already in
   * `RecoveryProbeVerdict` shape. Pre-settlement observations are process-held:
   * after a crash they are re-collected from scratch, which can only delay a
   * retry, never fabricate authority (D69 counts only qualified observations).
   */
  readonly priorVerdicts?: readonly unknown[];
  readonly signal: AbortSignal;
}

export interface WriteRecoveryService {
  recover(input: WriteRecoveryInput): Promise<WriteRecoveryDecision>;
}

type AttemptingIntent = Extract<WriteIntentRecord, { status: "attempting" }>;

/* ── the recovery service ────────────────────────────────────────────────── */

export function createWriteRecoveryService(deps: WriteRecoveryDependencies): WriteRecoveryService {
  const operator = ActorIdSchema.parse(deps.operator);
  const resolveImplFingerprint = deps.resolveImplFingerprint
    ?? ((taskId: TaskId) => resolveTaskImplFingerprint(BUILD_MANIFEST, taskId));
  const instant = () => IsoInstantSchema.parse(deps.clock.now().toISOString());
  const probeDeps: ProbeReadDeps = {
    stores: deps.stores,
    sessions: deps.sessions,
    clock: deps.clock,
    scheduler: deps.scheduler,
    taskDeadlineMs: deps.taskDeadlineMs,
    log: deps.log,
  };

  function park(
    intent: AttemptingIntent,
    code: WriteIntentParkCode,
    message: string,
  ): WriteRecoveryDecision {
    deps.authority.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.parkAttempt({
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
        expectedVersion: intent.version,
        code,
        message,
        now: instant(),
      });
    });
    return WriteRecoveryDecisionSchema.parse({
      state: "parked",
      writeIntentId: intent.writeIntentId,
      generation: intent.generation,
      code,
      message,
    });
  }

  async function recover(input: WriteRecoveryInput): Promise<WriteRecoveryDecision> {
    const intent = deps.authority.authority.writeIntents.get(input.writeIntentId);
    if (intent === undefined) throw new Error(`write intent ${input.writeIntentId} does not exist`);
    if (intent.status !== "attempting") {
      throw new Error(
        `write intent ${input.writeIntentId} is ${intent.status}; §4 recovery owns only unfinished `
        + "attempting intents — parked intents take the typed operator resolutions",
      );
    }
    const run = deps.authority.authority.runs.get(intent.runId);
    if (run === undefined) {
      throw new Error(`write intent ${input.writeIntentId} names run ${intent.runId}, which does not exist`);
    }
    /*
     * D136: resolvability binds to the SEMANTIC surface this probe consumes —
     * the workflow/version identity, the transaction node that commits this
     * task, the canonical-input schema, the permanent key re-derived from the
     * exact durable input, and the retained binding proof — not to the
     * descriptor's whole source-closure hash. A worker that restarted onto a
     * newer build must still be able to recover the crash it caused.
     */
    const { node } = requireWriteResolutionBinding({
      arm: "recovery-probe",
      descriptor: input.descriptor,
      run,
      intent,
      repositories: deps.authority.authority,
    });
    const commitContract: AnyCommitTaskContract = node.commit.uses;
    const commitInput = rebuildCommitInput(
      deps.authority.authority,
      input.descriptor,
      node,
      run,
      intent,
    );
    const instanceSelection = run.envelope.resolvedInstance[intent.system];
    if (instanceSelection === undefined) {
      throw new Error(`run ${intent.runId} resolved no ${intent.system} instance; recovery cannot probe`);
    }

    /*
     * D116 (ref clock-config-secrets §4): the probe lease runs OUTSIDE any worker loop, so
     * recovery binds the TARGET run's retained immutable `configFingerprint`
     * itself — read from the authority run row the intent names, never
     * recomputed from current config and never taken from caller claims. The
     * bind sits OUTSIDE the probe's catch on purpose: a missing/malformed
     * fingerprint on the run row, or a host already bound to another run, is a
     * PRECONDITION failure that throws out of `recover` loudly — it must never
     * collapse into a park that reads as a probe verdict (ref write-safety §4).
     */
    const runConfigFingerprint = FingerprintSchema.parse(run.envelope.configFingerprint);
    deps.sessions.bindRunConfigFingerprint(runConfigFingerprint);

    /* the probe runs FIRST — before any startAt/resume logic (ref write-safety §4) */
    let verdict: RuntimeProbeVerdict;
    try {
      verdict = await executeIdempotencyProbe(probeDeps, {
        commitContract,
        commitInput,
        instance: instanceSelection,
        signal: input.signal,
      });
    } catch (error) {
      // A throwing probe is `unknown`, never `absent` (charter catch-swallow ban).
      return park(intent, "unknown", `recovery probe threw for key ${intent.idempotencyKey}: `
        + `${error instanceof Error ? error.message : "non-Error thrown"}`);
    } finally {
      deps.sessions.releaseRunConfigFingerprint();
    }

    if (verdict.state === "present") {
      const completion = commitContract.writeSafety.completion;
      let proofValue: JsonValue;
      let outputValue: JsonValue;
      try {
        const proofRaw: unknown = Reflect.apply(completion.proofFromPresentProbe, undefined, [verdict]);
        const proof = completion.proofSchema.parse(proofRaw);
        const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
        proofValue = JsonValueSchema.parse(proof);
        outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));
      } catch (error) {
        return park(
          intent,
          "present-proof-invalid",
          `recovery probe found key ${intent.idempotencyKey} present, but its proof cannot be validated `
          + `(${error instanceof Error ? error.message : "non-Error"}); a present we cannot validate is `
          + "indeterminate, not done",
        );
      }
      if (run.lifecycle.state !== "parked-write") {
        throw new Error(
          `run ${intent.runId} is ${run.lifecycle.state}; positive-recovery backfill requires the D118 `
          + "sweep's parked-write routing first — an unclaimable non-parked run stays unclaimable",
        );
      }
      const settlement = buildCommittedSettlement({
        descriptor: input.descriptor,
        nodeId: String(node.id),
        run,
        intent,
        commitContract,
        operator,
        implFingerprint: resolveImplFingerprint(commitContract.id),
        proofSource: "recovery-probe",
        proofValue,
        outputValue,
        confirmedAt: instant(),
        ids: deps.ids,
      });
      executeSequencedWriteCommit(
        deps.authority,
        {
          run: { runId: run.envelope.runId, expectedVersion: run.version },
          checkpoint: settlement.checkpoint,
          commit: settlement.commit,
        },
        { kind: "resume-queued", startAt: String(node.id) },
        deps.hooks,
      );
      return WriteRecoveryDecisionSchema.parse({
        state: "backfilled",
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
      });
    }

    if (verdict.state === "ambiguous") {
      return park(intent, "ambiguous",
        `recovery probe found ${String(verdict.matches)} matches for key ${intent.idempotencyKey}; `
        + "verify in the target system, then use the typed resolutions");
    }
    if (verdict.state === "unknown") {
      return park(intent, "unknown",
        `recovery probe is indeterminate for key ${intent.idempotencyKey}: ${verdict.reason}`);
    }

    /* absent — one observation is diagnostic; authority needs D64/D69 */
    const policy = NegativeSettlementPolicySchema.parse(commitContract.writeSafety.idempotency.recoveryAbsence);
    const priorVerdicts = (input.priorVerdicts ?? []).map((prior) => RecoveryProbeVerdictSchema.parse(prior));
    const observation = RecoveryProbeVerdictSchema.parse({ state: "absent", evidence: verdict.evidence });
    const evaluation = evaluateNegativeSettlement({
      writeIntentId: intent.writeIntentId,
      generation: intent.generation,
      idempotencyKeyDigest: intent.idempotencyKeyDigest,
      authoritativeSource: verdict.evidence.source,
      authoritativeSourceState: verdict.evidence.sourceState,
      queryDigest: verdict.evidence.queryDigest,
      fencedAt: intent.fencedAt,
      policy,
      verdicts: [...priorVerdicts, observation],
    }, deps.clock);

    if (evaluation.state === "safe-to-retry") {
      deps.authority.withAuthorityTransaction((repositories) => {
        repositories.writeIntents.settleRetryable({
          writeIntentId: intent.writeIntentId,
          generation: intent.generation,
          expectedVersion: intent.version,
          settlement: evaluation,
          now: instant(),
        });
        const current = repositories.runs.get(run.envelope.runId);
        if (current === undefined) throw new Error(`run ${run.envelope.runId} disappeared during settlement`);
        if (current.lifecycle.state !== "parked-write") {
          throw new Error(
            `run ${run.envelope.runId} is ${current.lifecycle.state}; a safe-to-retry settlement resumes only `
            + "a parked-write run",
          );
        }
        const resumed = repositories.runs.resume({
          runId: run.envelope.runId,
          expectedVersion: current.version,
          startAt: node.id,
          now: instant(),
        });
        if (resumed.state !== "applied") {
          throw new Error(`resuming run ${run.envelope.runId} after retry settlement failed: ${resumed.state}`);
        }
      });
      return WriteRecoveryDecisionSchema.parse({
        state: "safe-to-retry",
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
      });
    }
    if (evaluation.state === "wait") {
      // Waiting is a `not_before` requeue decision for the caller's scheduler —
      // never a sleeping worker and NEVER retry authority. Durable state is
      // deliberately unchanged: the run stays unclaimable under its park.
      return WriteRecoveryDecisionSchema.parse({
        state: "wait",
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
        notBefore: evaluation.notBefore,
        observationsNeeded: evaluation.observationsNeeded,
      });
    }
    const code: WriteIntentParkCode = evaluation.code === "operator-only"
      ? "operator-required"
      : evaluation.code === "ambiguous"
        ? "ambiguous"
        : "unknown";
    return park(intent, code, `negative settlement parked (${evaluation.code}): ${evaluation.reason}`);
  }

  return Object.freeze({ recover });
}

/* ── the kernel's typed operator resolutions (ref write-safety §4.1) ───────────────── */

export interface WriteResolutionDependencies {
  readonly descriptors: WorkflowDescriptorResolver;
  /**
   * MUST be the same `AuthorityDatabase` the kernel's `withAuthorityTransaction`
   * runs on: the resolution executes INSIDE the kernel's transaction, and
   * `commitWriteAttempt` composes as a nested savepoint on that connection.
   */
  readonly authority: WriteSequencerAuthority;
  readonly ids: IdFactory;
  readonly resolveImplFingerprint?: (taskId: TaskId) => Fingerprint;
  readonly hooks?: WriteSequencerHooks;
}

/**
 * D136: the resolution's target — the registered descriptor and the exact
 * transaction node this intent commits — validated against the SEMANTIC
 * surface the arm consumes rather than the descriptor's whole closure hash.
 *
 * A parked write waits for a human to go look in the target system, and that
 * wait routinely outlives an unrelated refactor somewhere in a ~31-file import
 * closure. Expiring the operator's only release path on such an edit is not a
 * recovery path; see `write-resolution-binding.ts` for exactly what may move
 * and what may not.
 */
function requireResolutionTarget(
  deps: WriteResolutionDependencies,
  repositories: WriteBindingRepositories,
  context: WriteResolutionContext,
  arm: WriteResolutionArm,
): Readonly<{ descriptor: AnyWorkflowDescriptor; node: TransactionRuntimeNode }> {
  const descriptor = deps.descriptors.resolve(context.run.envelope.workflow);
  if (descriptor === undefined) {
    throw new Error(`workflow ${context.run.envelope.workflow} is not registered; the parked write cannot resolve`);
  }
  const { node } = requireWriteResolutionBinding({
    arm,
    descriptor,
    run: context.run,
    intent: context.intent,
    repositories,
  });
  return Object.freeze({ descriptor, node });
}

function requireResolvableIntent(context: WriteResolutionContext): void {
  if (context.intent.status !== "attempting" && context.intent.status !== "parked") {
    throw new Error(
      `write intent ${context.intent.writeIntentId} is ${context.intent.status}; `
      + "it has no operator resolution",
    );
  }
}

export function createWriteResolutionExecutor(deps: WriteResolutionDependencies): WriteResolutionExecutor {
  const resolveImplFingerprint = deps.resolveImplFingerprint
    ?? ((taskId: TaskId) => resolveTaskImplFingerprint(BUILD_MANIFEST, taskId));

  return Object.freeze({
    resolvePresent(repositories: AuthorityRepositories, context: WriteResolutionContext): unknown {
      if (context.command.type !== "resolve-write-present") {
        throw new Error(`resolvePresent received a ${context.command.type} command`);
      }
      requireResolvableIntent(context);
      const { descriptor, node } = requireResolutionTarget(
        deps,
        repositories,
        context,
        "operator-confirmed-present",
      );
      const commitContract = node.commit.uses;
      const completion = commitContract.writeSafety.completion;
      const proofSchemaHash = deriveSchemaHash(completion.proofSchema, "output");
      const payload = context.command.payload;
      /*
       * D245 — BOTH proof checks are typed REJECTIONS, not throws.
       *
       * An operator now composes this payload from the field list the
       * parked-write section serves, so "the proof does not fit" is an ordinary
       * answer-level mistake rather than an inconsistent store: the client's own
       * check cannot see a `.refine()`, and the served schema can move between
       * the serve and the send. Thrown, it reached the dialog through the arm
       * reserved for "the server never answered" — with no code to quote and a
       * sentence about transport. `executeResolveGate` has answered
       * `schema-mismatch` for the identical situation one command over since the
       * gate landed; this matches it, and the refusal unwinds the whole
       * transaction exactly as the throw did, so nothing durable moves either
       * way.
       */
      if (payload.proof.schemaHash !== proofSchemaHash) {
        rejectCommandRequest(
          context.command,
          "schema-mismatch",
          `confirmed-present proof is bound to schema ${payload.proof.schemaHash.slice(0, 12)}…, but `
          + `${commitContract.id} requires ${proofSchemaHash.slice(0, 12)}…; the resolution changes nothing. `
          + "Reload the run — this build serves the schema the proof form composes against.",
        );
      }
      const parsedProof = completion.proofSchema.safeParse(payload.proof.value);
      if (!parsedProof.success) {
        rejectCommandRequest(
          context.command,
          "schema-mismatch",
          `confirmed-present proof does not parse through ${commitContract.id}'s completion proof schema: `
          + `${parsedProof.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
        );
      }
      const proof: unknown = parsedProof.data;
      const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
      const outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));

      let intent = context.intent;
      if (intent.status === "parked") {
        intent = repositories.writeIntents.reopenParkedAttempt({
          writeIntentId: intent.writeIntentId,
          generation: intent.generation,
          expectedVersion: intent.version,
          now: context.now,
        });
      }
      if (intent.status !== "attempting") {
        throw new Error(`write intent ${intent.writeIntentId} did not reopen to attempting; refusing to settle`);
      }
      const settlement = buildCommittedSettlement({
        descriptor,
        nodeId: String(node.id),
        run: context.run,
        intent,
        commitContract,
        operator: ActorIdSchema.parse(context.command.requestedBy),
        implFingerprint: resolveImplFingerprint(commitContract.id),
        proofSource: "operator-attestation",
        proofValue: JsonValueSchema.parse(proof),
        outputValue,
        confirmedAt: context.now,
        ids: deps.ids,
      });
      const result = executeSequencedWriteCommit(
        deps.authority,
        {
          run: { runId: context.run.envelope.runId, expectedVersion: context.run.version },
          checkpoint: settlement.checkpoint,
          commit: settlement.commit,
        },
        { kind: "resume-queued", startAt: String(node.id) },
        deps.hooks,
      );
      return { run: result.run };
    },

    resolveAbsent(repositories: AuthorityRepositories, context: WriteResolutionContext): unknown {
      if (context.command.type !== "resolve-write-absent") {
        throw new Error(`resolveAbsent received a ${context.command.type} command`);
      }
      requireResolvableIntent(context);
      const { node } = requireResolutionTarget(deps, repositories, context, "operator-confirmed-absent");
      repositories.writeIntents.settleRetryable({
        writeIntentId: context.intent.writeIntentId,
        generation: context.intent.generation,
        expectedVersion: context.intent.version,
        settlement: {
          state: "operator-confirmed-absent",
          writeIntentId: context.intent.writeIntentId,
          generation: context.intent.generation,
          operator: ActorIdSchema.parse(context.command.requestedBy),
          confirmedAt: context.now,
          evidenceNote: context.command.payload.evidenceNote,
        },
        now: context.now,
      });
      const resumed = repositories.runs.resume({
        runId: context.run.envelope.runId,
        expectedVersion: context.run.version,
        startAt: node.id,
        now: context.now,
      });
      if (resumed.state !== "applied") {
        throw new Error(
          `resuming run ${context.run.envelope.runId} after confirmed-absent failed: ${resumed.state}`,
        );
      }
      return { run: resumed.run };
    },
  });
}

