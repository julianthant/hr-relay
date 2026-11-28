import assert from "node:assert/strict";
import type { TimelineEventRecord } from "../../../../src/models/events/timeline.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { referenceComparisonForGate } from "../../../../src/models/processing/workbooks/reference-fields.js";

export function referenceCheckLines(events: readonly TimelineEventRecord[]): readonly string[] {
  return events.flatMap(({ payload }) => payload.kind === "note"
    && /\/reference-fields-[^/]+#/u.test(payload.note.spanPath)
    && /^(?:Not in |Reference not checked: )|, row \d+: [^:]+ (?:matches|differs)$/u.test(payload.note.message)
    ? [payload.note.message] : []);
}

export function referenceGateId(run: RunRecord) {
  assert.ok(run.lifecycle.state === "parked-gate" && referenceComparisonForGate(run.lifecycle.gateId) !== undefined);
  return run.lifecycle.gateId;
}
