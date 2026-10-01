import type { RunRecordService } from "../run-record-service.js";
import type { RunRecord } from "../../../domain/run/record.js";
import { SectionUnavailableError, TargetNotFoundError } from "../refusals.js";

export type TrustRunReader = Pick<RunRecordService, "read" | "list">;

/** Live trust doors never serve an archived run through current descriptors. */
export function requireTrustRun(reader: Pick<TrustRunReader, "read"> | undefined, runId: string): RunRecord {
  if (reader === undefined) throw new Error("TRUST_RUN_READER_NOT_CONFIGURED");
  const existence = reader.read(runId);
  if (existence.state === "absent") throw new TargetNotFoundError(`run ${runId} is absent from canonical authority`);
  if (existence.state === "deleted") throw new TargetNotFoundError(`run ${runId} is deleted from canonical authority`);
  if (existence.run.envelope.runId !== runId) throw new Error(`TRUST_RUN_IDENTITY_MISMATCH: ${runId}`);
  if (existence.disposition === "archived") throw new SectionUnavailableError(`run ${runId} is archived; use its immutable Archive resource`);
  return existence.run;
}

export function assertTrustEvidenceIdentity(
  run: RunRecord,
  evidence: Readonly<{ runId: string; workflowId: string; traceId: string; attempt: number }>,
  label: string,
): void {
  const envelope = run.envelope;
  if (evidence.runId !== envelope.runId || evidence.workflowId !== envelope.workflow
    || evidence.traceId !== envelope.traceId || evidence.attempt !== envelope.attempt) {
    throw new Error(`TRUST_EVIDENCE_IDENTITY_MISMATCH: ${label} does not belong to run ${envelope.runId}`);
  }
}

/** Refuse an invalidated page walk; never publish a partial observation set. */
export function listLiveTrustRuns(reader: TrustRunReader): readonly RunRecord[] {
  const rows: RunRecord[] = [];
  let cursor: Extract<ReturnType<TrustRunReader["list"]>, { state: "listed" }>["cursor"];
  do {
    const page = reader.list({ disposition: "live", limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
    if (page.state === "refused") throw new Error(`TRUST_RUN_LIST_REFUSED: ${page.refusal.reason}`);
    rows.push(...page.rows);
    cursor = page.cursor;
  } while (cursor !== undefined);
  return rows;
}
