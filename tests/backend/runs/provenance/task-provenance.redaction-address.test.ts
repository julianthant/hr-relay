import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import type { RecordedDataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

/* ── (a) the declaration audit ───────────────────────────────────────────── */

describe("redaction surface scan — the declaration audit", () => {

  it("retains observed object keys in real collector addresses without treating them as authored text", () => {
    const points: RecordedDataPoint[] = [];
    const execution = { runId: UUID_1, traceId: "pl-180000-aaaa", attempt: 1, workflowId: "person-lookup", nodeId: "searching", taskId: SearchPersonOrg.id };
    const collector = createTaskProvenanceCollector({ descriptor: personLookupDescriptor, execution,
      observationSpanPath: "pl-180000-aaaa/searching#2.3", upstreamEvidence: { checkpoints: [] },
      clock: manualClock(new Date(NOW)), onRecord: batch => points.push(...batch.points) });
    const key = "Qwertzuiop Vbnmasdfghjkl";
    collector.recordData({ direction: "read", field: "results", value: [{ [key]: "captured" }] });
    collector.recordData({ direction: "read", field: "selection", value: [{ [key]: "captured" }],
      aliases: [{ path: [], source: { kind: "local", field: "results", path: [] } }] });
    assert.equal(points.length, 2);
    assert.equal(points[0]?.origins, undefined);
    assert.ok(points[1]?.origins?.some(entry => entry.path.includes(key) && entry.origin.path.includes(key)));
  });
});
