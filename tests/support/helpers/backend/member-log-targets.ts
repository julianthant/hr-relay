import assert from "node:assert/strict";
import type { QueueRecordMember } from "../../../../src/models/dashboard/projection.js";
import { RunDetailSectionResponseSchema } from "../../../../src/models/dashboard/run-detail.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildRunSection } from "../../../../src/backend/runs/queries/run-detail.js";

/** Every member row that targets Logs opens its own child run's served, parseable log; returns how many it checked. */
export function assertMemberLogsServed(deps: RunDetailQueryDeps, members: readonly QueueRecordMember[]): number {
  let checked = 0;
  for (const member of members) {
    if (member.target.section !== "logs") continue;
    // A reading member intentionally targets its owning OCR run; every other member with child runs targets one of them.
    if (member.kind !== "reading" && member.childRunIds.length > 0) assert.ok(member.childRunIds.includes(member.target.runId), `${member.title} targets a non-child run`);
    const response = RunDetailSectionResponseSchema.parse(buildRunSection(deps, member.target.runId, "logs"));
    assert.equal(response.section, "logs");
    checked += 1;
  }
  return checked;
}
