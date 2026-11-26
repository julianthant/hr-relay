import { expect, it } from "vitest";
import { pacificDayStart, planCopySeed } from "../../../scripts/profiles/seed-copy.js";
import { WORKFLOW_MODULES, workflowQueueCapabilities } from "../../../src/backend/app/registries/workflow-registry.js";
import { COPY_HISTORY_SEED_BUILD } from "../../../src/backend/storage/sqlite/isolated-history-store.js";
import { searchPartitionDay } from "../../../src/models/dashboard/search-calendar.js";
import workflowSources from "../../../config/dashboard-workflow-sources.json" with { type: "json" };

const sources: Record<string, string> = workflowSources;

it.each(["2026-11-24T08:05:00.000Z", "2026-11-24T20:00:00.000Z", "2026-03-08T08:05:00.000Z", "2026-11-01T07:05:00.000Z", "2026-03-08T20:00:00.000Z", "2026-11-01T20:00:00.000Z"])("plans today's live runs inside the Pacific day at %s", at => {
  const now = new Date(at);
  const start = pacificDayStart(now);
  expect(searchPartitionDay(new Date(start))).toBe(searchPartitionDay(now));
  expect(searchPartitionDay(new Date(start - 1))).not.toBe(searchPartitionDay(now));

  const plan = planCopySeed({ now, existing: [], modules: WORKFLOW_MODULES, capabilities: workflowQueueCapabilities,
    profileId: "11111111-1111-4111-8111-111111111111", buildId: COPY_HISTORY_SEED_BUILD });
  const live = plan.runs.filter(row => "live" in row);
  for (const { run } of live) {
    const enqueuedAt = Date.parse(run.envelope.enqueuedAt);
    expect(enqueuedAt).toBeGreaterThanOrEqual(start);
    expect(enqueuedAt).toBeLessThanOrEqual(now.getTime());
    expect(searchPartitionDay(new Date(enqueuedAt))).toBe(searchPartitionDay(now));
    if (run.lifecycle.state === "running") expect(Date.parse(run.lifecycle.claimedAt)).toBeLessThanOrEqual(now.getTime());
  }
  expect(new Set(live.map(row => row.workflow.id))).toEqual(new Set(Object.keys(sources).filter(id => sources[id] === "served")));
  expect(plan.sessions.every(({ payload }) => sources[payload.workflow] === "served")).toBe(true);
  const duo = live.filter(row => row.state === "needs-duo").map(row => row.workflow.id);
  expect(duo).not.toContain("emergency-contact");
  expect(duo).not.toContain("i9-check-start");
  expect(plan.batches.map(batch => batch.workflow)).toEqual(["person-lookup"]);
  const [batch] = plan.batches;
  expect(live.filter(row => row.run.sessionId === batch?.sessionId).map(row => row.run.lifecycle.state === "terminal" ? row.run.lifecycle.outcome : row.run.lifecycle.state))
    .toEqual(["done", "cancelled"]);
});
