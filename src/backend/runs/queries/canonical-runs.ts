import type { RunRecordService } from "../lifecycle/run-record-service.js";
import type { RunRecord } from "../../../models/run/record.js";
import { ProjectionDegradedError } from "../commands/refusals.js";

/** A surface consumes one generation-bound list, never a page from a newer authority. */
export function listCanonicalRuns(
  reader: Pick<RunRecordService, "list">,
  disposition: "live",
): readonly RunRecord[] {
  const rows: RunRecord[] = [];
  let cursor: Parameters<RunRecordService["list"]>[0]["cursor"];
  do {
    const page = reader.list({ disposition, limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
    if (page.state === "refused") throw new ProjectionDegradedError("canonical run list refused: cursor-stale");
    rows.push(...page.rows);
    cursor = page.cursor;
  } while (cursor !== undefined);
  return rows;
}

/** Resolve parent membership once per surface snapshot, rather than enumerating per row. */
export function canonicalRunChildren(rows: readonly RunRecord[]): ReadonlyMap<string, readonly RunRecord[]> {
  const children = new Map<string, RunRecord[]>();
  for (const row of rows) {
    const parent = row.envelope.parent?.runId;
    if (parent === undefined) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(row);
    children.set(parent, siblings);
  }
  return children;
}
