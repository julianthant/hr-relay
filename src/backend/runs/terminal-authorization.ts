/**
 * The ONE assembly point for `TerminalAuthorizationRecord` (refs dashboard-surfaces/operator-trust,
 * D110/D114).
 *
 * The interpreter never hand-builds this row inline: the record preserves the
 * exact pre-terminal CAS (`expectedVersion`) and the held claim so a later
 * replay cannot substitute a stale or unrelated authorization, and both
 * invariants are only checkable against the CURRENT run record at the moment
 * of authorization. This factory takes that current record, refuses to
 * authorize anything a worker does not actually own, and binds the exact
 * consequence identity (the failure, or the result) that the
 * atomic terminal composites will re-validate.
 */
import { z } from "zod";
import { IsoInstantSchema } from "../../domain/ids.js";
import { runClaim, RunRecordSchema } from "../../domain/run/record.js";
import { RunResultRecordSchema } from "../../domain/run/result.js";
import {
  TerminalAuthorizationRecordSchema,
  type FailureTerminalAuthorizationRecord,
  type SuccessTerminalAuthorizationRecord,
} from "../../domain/run/terminal-authorization.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";

const FailureConsequenceSchema = z.strictObject({
  kind: z.literal("failed"),
  failure: FailureRecordSchema,
});

const SuccessConsequenceSchema = z.strictObject({
  kind: z.literal("done"),
  result: RunResultRecordSchema,
});

export const TerminalConsequenceSchema = z.discriminatedUnion("kind", [
  FailureConsequenceSchema,
  SuccessConsequenceSchema,
]);
export type TerminalConsequence = z.infer<typeof TerminalConsequenceSchema>;

export interface TerminalAuthorizationInput {
  /** The CURRENT run record, read inside the worker's own execution. */
  readonly run: unknown;
  readonly authorizedAt: unknown;
  readonly consequence: TerminalConsequence;
}

export function buildFailureTerminalAuthorization(
  input: TerminalAuthorizationInput & { readonly consequence: { readonly kind: "failed" } },
): FailureTerminalAuthorizationRecord {
  const record = buildTerminalAuthorization(input);
  if (record.kind !== "failed") throw new Error("failure authorization arm produced a non-failed record");
  return record;
}

export function buildSuccessTerminalAuthorization(
  input: TerminalAuthorizationInput & { readonly consequence: { readonly kind: "done" } },
): SuccessTerminalAuthorizationRecord {
  const record = buildTerminalAuthorization(input);
  if (record.kind !== "done") throw new Error("success authorization arm produced a non-done record");
  return record;
}

export function buildTerminalAuthorization(
  input: TerminalAuthorizationInput,
): FailureTerminalAuthorizationRecord | SuccessTerminalAuthorizationRecord {
  const run = RunRecordSchema.parse(input.run);
  const authorizedAt = IsoInstantSchema.parse(input.authorizedAt);
  const consequence = TerminalConsequenceSchema.parse(input.consequence);
  const claim = runClaim(run);
  if (claim === undefined) {
    throw new Error(
      `run ${run.envelope.runId} is ${run.lifecycle.state} and holds no claim; `
      + "only the claim-holding worker may authorize a terminal settlement",
    );
  }
  if (Date.parse(authorizedAt) < Date.parse(run.envelope.enqueuedAt)) {
    throw new Error(`run ${run.envelope.runId} terminal authorization predates its enqueue`);
  }

  const identity = {
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    /** The pre-terminal CAS: the version the atomic composite must observe. */
    expectedVersion: run.version,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
    authorizedAt,
  } as const;

  if (consequence.kind === "failed") {
    const { failure } = consequence;
    if (failure.runId !== run.envelope.runId
      || failure.workflowId !== run.envelope.workflow
      || failure.attempt !== run.envelope.attempt
      || failure.traceId !== run.envelope.traceId) {
      throw new Error(
        `failure ${failure.failureId} does not identify run ${run.envelope.runId} `
        + `attempt ${String(run.envelope.attempt)}; refusing to authorize an unrelated failure`,
      );
    }
    return TerminalAuthorizationRecordSchema.parse({
      kind: "failed",
      ...identity,
      failureId: failure.failureId,
    });
  }

  const { result } = consequence;
  if (result.runId !== run.envelope.runId
    || result.workflowId !== run.envelope.workflow
    || result.attempt !== run.envelope.attempt
    || result.descriptorVersion !== run.envelope.descriptorVersion
    || result.contractFingerprint !== run.envelope.contractFingerprint
    || result.configFingerprint !== run.envelope.configFingerprint
    || result.configSnapshotId !== run.envelope.configSnapshotId) {
    throw new Error(
      `run result for ${result.runId} does not bind run ${run.envelope.runId}'s exact identity `
      + "and fingerprints; refusing to authorize it",
    );
  }
  return TerminalAuthorizationRecordSchema.parse({
    kind: "done",
    ...identity,
    resultDigest: result.resultDigest,
  });
}
