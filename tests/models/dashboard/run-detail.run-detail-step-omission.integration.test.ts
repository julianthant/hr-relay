
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import {
instantOffsetOf,
uuidOf,
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});
const OMITTED_STEP = "kronos-timecard";

/* ── the wire's own refusals ─────────────────────────────────────────────── */

const BASE_DETAIL = {
  runId: uuidOf(1),
  rowRevision: 1,
  panelKind: "run",
  header: {
    runId: uuidOf(1),
    traceId: "pl-000619-4ebf",
    workflowId: "person-lookup",
    actorId: "local-operator",
    title: "EID 10873698",
    status: "done",
    attempt: 1,
  },
  timeline: { events: [] },
  gate: { state: "absent", reason: "this run has no gate" },
  outcome: { state: "terminal", result: "verified-done", completedAt: instantOffsetOf(0, 5_000) },
  context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
  availableSections: ["logs"],
} as const;

describe("run detail wire refusals under step omission", () => {
  it("refuses verified-done beside an omitted step", () => {
    assert.throws(
      () => RunDetailWireSchema.parse({ ...BASE_DETAIL, omittedSteps: [OMITTED_STEP] }),
      /a run with an omitted step cannot be verified-done/u,
    );
  });

  it("accepts an omitted step beside a partial outcome", () => {
    const parsed = RunDetailWireSchema.parse({
      ...BASE_DETAIL,
      outcome: { ...BASE_DETAIL.outcome, result: "partial" },
      omittedSteps: [OMITTED_STEP],
    });
    assert.deepEqual(parsed.omittedSteps, [OMITTED_STEP]);
  });

  it("refuses a not-run reason on a member that ran", () => {
    assert.throws(
      () => RunDetailWireSchema.parse({
        ...BASE_DETAIL,
        timeline: {
          events: [],
          steps: [{
            label: "Kronos timecard",
            state: "done",
            members: [{ label: "Timecard", state: "done", notRunReason: "operator-asserted" }],
          }],
        },
      }),
      /a done member cannot carry a not-run reason/u,
    );
  });
});
