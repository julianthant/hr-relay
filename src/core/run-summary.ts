import { RunSummarySchema, type RunSummary } from "../domain/run/summary.js";
import type { RunSummarySource } from "../domain/run/summary.js";
import { CurrentSeparationsPseudonymSourceResultSchema } from "../domain/trust/activity-person-pseudonym-backfill.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { canonicalJsonStringify } from "../domain/canonical-json.js";
import { sha256Hex } from "../domain/sha256.js";
import { localDatePart } from "../domain/clock.js";

/** Baseline derivation; identity remains explicitly unavailable until validated by Q's source adapter. */
export function deriveRunSummary(source: RunSummarySource, sourceGeneration: number): RunSummary {
  const { run, result, receipt, failure, resolution } = source;
  const person = deriveCanonicalPerson(run,result);
  return RunSummarySchema.parse({
    runId: run.envelope.runId, workflow: run.envelope.workflow, itemId: run.envelope.itemId,
    descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
    title: run.displayName ?? source.queueTitle ?? run.envelope.workflow, localDay: localDatePart(new Date(run.envelope.enqueuedAt)),
    enqueuedAt:run.envelope.enqueuedAt,startedAt:source.startedAt,
    endedAt:run.lifecycle.state === "terminal" ? run.lifecycle.endedAt : null,
    durationMs:run.lifecycle.state === "terminal" && source.startedAt !== null && Date.parse(run.lifecycle.endedAt)>=Date.parse(source.startedAt)
      ? Date.parse(run.lifecycle.endedAt)-Date.parse(source.startedAt) : null,
    sourceCursor:source.cursor,sessionId:run.sessionId??null,children:source.children,dependencyRunIds:source.dependencyRunIds,
    completionClass:run.lifecycle.state === "terminal" ? run.lifecycle.outcome : null,failureTransient:failure?.transient??null,
    createdAt: run.createdAt, updatedAt: run.updatedAt, lifecycle: run.lifecycle,
    priority: run.envelope.priority, shape: run.envelope.shape, parentRunId: run.envelope.parent?.runId ?? null,
    attempt: run.envelope.attempt, sourceGeneration, sourceDigest: sha256Hex(canonicalJsonStringify(source)),
    warningCount: receipt?.warnings.length ?? null, receiptResult: receipt?.result ?? null,
    failureCode: failure?.code ?? null, resolution,
    person,
  });
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
