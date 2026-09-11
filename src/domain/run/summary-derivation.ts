import { RunSummarySchema, type RunSummary } from "./summary.js";
import type { RunSummarySource } from "./summary.js";
import { CurrentSeparationsPseudonymSourceResultSchema } from "../trust/activity-person-pseudonym-backfill.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";
import { projectReceiptForOperator } from "../trust/evidence.js";
import { localDatePart } from "../clock.js";

/** One derivation for initial publication, affected-run maintenance and explicit rebuild. */
export function deriveRunSummary(source: RunSummarySource, sourceGeneration: number): RunSummary {
  const { run, result, receipt, failure, resolution } = source;
  const person = deriveCanonicalPerson(run,result);
  const projectedReceipt = receipt === null ? null : projectReceiptForOperator(receipt);
  // Queue/Activity measure from enqueue, including queue wait (the retained surface contract).
  const startedAt = run.envelope.enqueuedAt;
  const summary = RunSummarySchema.parse({
    runId: run.envelope.runId, workflow: run.envelope.workflow, itemId: run.envelope.itemId,
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    title: run.displayName ?? source.queueTitle ?? run.envelope.workflow, localDay: localDatePart(new Date(run.envelope.enqueuedAt)),
    enqueuedAt:run.envelope.enqueuedAt,startedAt,
    endedAt:run.lifecycle.state === "terminal" ? run.lifecycle.endedAt : null,
    durationMs:run.lifecycle.state === "terminal" && Date.parse(run.lifecycle.endedAt)>=Date.parse(startedAt)
      ? Date.parse(run.lifecycle.endedAt)-Date.parse(startedAt) : null,
    sourceCursor:source.cursor,sessionId:run.sessionId??null,children:source.children,dependencyRunIds:source.dependencyRunIds,
    completionClass:run.lifecycle.state === "terminal" ? run.lifecycle.outcome : null,failureTransient:failure?.transient??null,
    createdAt: run.createdAt, updatedAt: run.updatedAt, lifecycle: run.lifecycle,
    priority: run.envelope.priority, shape: run.envelope.shape, parentRunId: run.envelope.parent?.runId ?? null,
    attempt: run.envelope.attempt, sourceGeneration, sourceDigest: "0".repeat(64),
    warningCount: projectedReceipt?.state === "available" ? projectedReceipt.value.warnings.length : null, receiptResult: receipt?.result ?? null,
    failureCode: failure?.code ?? null, resolution,
    person,
  });
  return { ...summary, sourceDigest: RunSummarySchema.shape.sourceDigest.parse(runSummaryDigest(summary)) };
}

/** Versioned digest of contributing summary facts, excluding publication and heartbeat clocks.
 * This is only the derived read model's integrity boundary, never an archive/source proof.
 */
export function runSummaryDigest(summary: RunSummary): string {
  const {sourceDigest:_digest,sourceGeneration:_generation,updatedAt:_updatedAt,...facts}=summary;
  const lifecycle={...facts.lifecycle};
  if("heartbeatAt" in lifecycle)lifecycle.heartbeatAt=lifecycle.claimedAt;
  return sha256Hex(canonicalJsonStringify({format:"run-summary-v2",...facts,lifecycle}));
}

export function deriveCanonicalPerson(run: RunSummarySource["run"], result: RunSummarySource["result"]): RunSummary["person"] {
  let person: RunSummary["person"] = { state: "unavailable", reason: "canonical-result-unavailable" };
  if (run.envelope.workflow === "separations" && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done" && result !== null) {
    const hash = deriveSchemaHash(CurrentSeparationsPseudonymSourceResultSchema, "output");
    if (result.runId !== run.envelope.runId || result.workflowId !== run.envelope.workflow
      || result.attempt !== run.envelope.attempt || result.descriptorVersion !== run.envelope.descriptorVersion
      || result.contractFingerprint !== run.envelope.contractFingerprint || result.configFingerprint !== run.envelope.configFingerprint
      || result.configSnapshotId !== run.envelope.configSnapshotId) throw new Error("summary-result-identity-mismatch");
    const parsed = CurrentSeparationsPseudonymSourceResultSchema.safeParse(result.result.value);
    if (result.resultSchemaHash === hash && result.result.schemaHash === hash && parsed.success) {
      person = { state: "available", identity: parsed.data.approved.emplId };
    }
  }
  return person;
}
