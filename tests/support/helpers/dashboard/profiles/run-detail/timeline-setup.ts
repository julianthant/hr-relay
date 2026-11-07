import type { z } from "zod";
import { RunDetailWireSchema, type RunDetailWire, TimelineStepWireSchema } from "../../../../../../src/models/dashboard/run-detail.js";
import type { Status } from "../../../../fixtures/dashboard/fixture-queue.js";
import type * as FixtureIdentityTypes from "../../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../../fixtures/dashboard/fixture-queue.js";


interface DetailSeed {
  readonly seed: number;
  readonly panelKind: "run" | "member" | "group";
  readonly title: string;
  readonly status: Status;
  readonly workflowId?: string;
  readonly attempt?: number;
  readonly gate: unknown;
  readonly outcome: unknown;
  readonly timeline: readonly {
    seed: number;
    minute: number;
    nodeId: string;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    notRunReason?: "condition-false" | "branch-not-selected";
  }[];
  readonly steps?: readonly z.input<typeof TimelineStepWireSchema>[];
  readonly dataFacts?: number;
  readonly sections?: readonly string[];
}

export function createTimelineSetup({ at, traceOf, uuidOf, WORKFLOW_ID, absent, FIXTURE_IDS }: {
  at: typeof FixtureIdentityTypes.at;
  traceOf: typeof FixtureIdentityTypes.traceOf;
  uuidOf: typeof FixtureIdentityTypes.uuidOf;
  WORKFLOW_ID: typeof FixtureIdentityTypes.WORKFLOW_ID;
  absent: typeof FixtureQueueTypes.absent;
  FIXTURE_IDS: typeof FixtureQueueTypes.FIXTURE_IDS;
}) {
  function detailOf(input: DetailSeed): RunDetailWire {
    return RunDetailWireSchema.parse({
      runId: uuidOf(input.seed),
      rowRevision: input.seed,
      panelKind: input.panelKind,
      header: {
        runId: uuidOf(input.seed),
        traceId: traceOf(input.seed),
        workflowId: input.workflowId ?? WORKFLOW_ID,
        actorId: "local-operator",
        title: input.title,
        status: input.status,
        attempt: input.attempt ?? 1,
      },
      timeline: {
        steps: input.steps ?? input.timeline.map(event => ({ key: event.nodeId, label: event.label,
          state: event.state, members: [{ nodeId: event.nodeId, categoryKey: event.nodeId, label: event.label, state: event.state }] })),
        events: input.timeline.map((event, index) => ({
          native: { eventId: uuidOf(input.seed * 100 + 9000 + index), order: index * 2 + 2,
            runId: uuidOf(input.seed), attempt: input.attempt ?? 1, traceId: traceOf(input.seed),
            spanPath: `${traceOf(input.seed)}/${event.nodeId}`, nodeId: event.nodeId },
          categoryKey: input.steps?.find(step => step.members.some(member => member.nodeId === event.nodeId))?.key ?? event.nodeId,
          noteId: uuidOf(input.seed * 100 + 9000 + index),
          sequence: index,
          at: at(event.minute),
          label: event.label,
          state: event.state,
          notRun: event.notRunReason === undefined
            ? {
              state: "absent",
              reason: event.state === "skipped"
                ? "this step did not run; its span recorded no reason"
                : "this step ran",
            }
            : { state: "present", reason: event.notRunReason },
        })),
      },
      gate: input.gate,
      outcome: input.outcome,
      context: { dataFacts: input.dataFacts ?? 2, evidenceFacts: 0, attempts: 1 },
      availableSections: input.sections ?? (input.status === "failed"
        ? ["logs", "receipt", "context-data", "context-attempts", "failure"]
        : ["logs", "receipt", "context-data", "context-attempts"]),
    });
  }

  const NO_GATE = absent("this run reached no gate");

  const STILL_RUNNING = absent("run is still executing");

  const FIXTURE_RUN_DETAILS: Readonly<Record<string, RunDetailWire>> = Object.freeze({
    [FIXTURE_IDS.queuedRun]: detailOf({
      seed: 1, panelKind: "run", title: "EID 10873698", status: "queued",
      gate: absent("this run has not started"), outcome: absent("this run has not started"),
      timeline: [], dataFacts: 0,
    }),
    [FIXTURE_IDS.runningRun]: detailOf({
      seed: 2, panelKind: "run", title: "Battistessa, Johnnie", status: "running",
      gate: NO_GATE, outcome: STILL_RUNNING,
      timeline: [{ seed: 2, minute: 52, nodeId: "searching", label: "searching", state: "active" }],
    }),
    [FIXTURE_IDS.doneRun]: detailOf({
      seed: 3, panelKind: "run", title: "EID 10101010", status: "done",
      gate: NO_GATE,
      outcome: { state: "terminal", result: "verified-done", completedAt: at(39) },
      timeline: [
        { seed: 3, minute: 35, nodeId: "searching", label: "searching", state: "done" },
        { seed: 3, minute: 36, nodeId: "cross-verify", label: "cross-verify", state: "done" },
        { seed: 3, minute: 37, nodeId: "active-status", label: "active-status", state: "done" },
        { seed: 3, minute: 38, nodeId: "crm-dates", label: "crm-dates", state: "done" },
      ],
    }),
    [FIXTURE_IDS.failedRun]: detailOf({
      seed: 4, panelKind: "run", title: "EID 10555001", status: "failed",
      gate: NO_GATE,
      outcome: { state: "terminal", result: "failed", completedAt: at(36) },
      timeline: [
        { seed: 4, minute: 33, nodeId: "searching", label: "searching", state: "done" },
        { seed: 4, minute: 35, nodeId: "cross-verify", label: "cross-verify", state: "failed" },
      ],
    }),
    [FIXTURE_IDS.openGateRun]: detailOf({
      seed: 5, panelKind: "run", title: "Morrow, Bea", status: "awaiting-approval",
      gate: { state: "open", gateId: uuidOf(105), nodeId: "identity-approval", label: "identity-review", openedAt: at(49), revision: 5 },
      outcome: STILL_RUNNING,
      timeline: [
        { seed: 5, minute: 47, nodeId: "searching", label: "searching", state: "done" },
        { seed: 5, minute: 49, nodeId: "identity-approval", label: "gate:identity-review", state: "blocked" },
      ],
      sections: ["logs", "receipt", "context-data", "context-attempts", "identity-gate"],
    }),
    [FIXTURE_IDS.gateNameMismatchRun]: detailOf({
      seed: 44, panelKind: "member", title: "Morrow, Bea", status: "awaiting-approval",
      gate: { state: "open", gateId: uuidOf(144), nodeId: "identity-approval", label: "identity-review", openedAt: at(24), revision: 44 },
      outcome: STILL_RUNNING,
      timeline: [
        { seed: 44, minute: 22, nodeId: "searching", label: "searching", state: "done" },
        { seed: 44, minute: 24, nodeId: "identity-approval", label: "gate:identity-review", state: "blocked" },
      ],
      sections: ["logs", "receipt", "context-data", "context-attempts", "identity-gate"],
    }),
    [FIXTURE_IDS.parkedRun]: detailOf({
      seed: 6, panelKind: "run", title: "EID 10777012", status: "blocked",
      gate: NO_GATE,
      outcome: absent("a write to UCPath is fenced and unresolved; the run is stopped"),
      timeline: [
        { seed: 6, minute: 44, nodeId: "searching", label: "searching", state: "done" },
        { seed: 6, minute: 45, nodeId: "terminate", label: "terminate", state: "blocked" },
      ],
      sections: ["logs", "context-data", "context-attempts", "parked-write"],
    }),
    [FIXTURE_IDS.memberRun]: detailOf({
      seed: 31, panelKind: "member", title: "Alvarez, Maria", status: "done",
      gate: NO_GATE,
      outcome: { state: "terminal", result: "verified-done", completedAt: at(32) },
      timeline: [
        { seed: 31, minute: 29, nodeId: "searching", label: "searching", state: "done" },
        { seed: 31, minute: 30, nodeId: "cross-verify", label: "cross-verify", state: "done" },
        { seed: 31, minute: 31, nodeId: "active-status", label: "active-status", state: "done" },
        { seed: 31, minute: 32, nodeId: "crm-dates", label: "crm-dates", state: "skipped", notRunReason: "condition-false" },
      ],
    }),
    [FIXTURE_IDS.groupOf13]: detailOf({
      seed: 70, panelKind: "group", title: "Separation audit — August", status: "partial",
      gate: NO_GATE, outcome: absent("members are still executing"),
      timeline: [
        { seed: 70, minute: 10, nodeId: "fan-out", label: "fan-out", state: "done" },
        { seed: 70, minute: 14, nodeId: "members", label: "members", state: "active" },
      ],
      steps: [
        {
          key: "identity", label: "Identity check",
          state: "done",
          durationSec: 46,
          members: [
            { nodeId: "fan-out", categoryKey: "identity", label: "Person lookup", state: "done", durationSec: 31 },
            { nodeId: "identity-approval", categoryKey: "identity", label: "Identity approval", state: "done", durationSec: 15 },
          ],
        },
        {
          key: "termination", label: "UCPath termination",
          state: "done",
          durationSec: 168,
          executions: 2,
          members: [
            { nodeId: "terminate", categoryKey: "termination", label: "Open the termination", state: "done", durationSec: 122 },
            { nodeId: "confirm-date", categoryKey: "termination", label: "Confirm the effective date", state: "done", durationSec: 46 },
          ],
        },
        {
          key: "finalization", label: "Kuali finalization",
          state: "active",
          members: [{ nodeId: "members", categoryKey: "finalization", label: "Finalize the separation document", state: "active" }],
        },
        {
          key: "timecard", label: "Separation timecard",
          state: "replayed",
          members: [
            { nodeId: "read-timecard", categoryKey: "timecard", label: "Read the timecard", state: "replayed", replayedFrom: { attempt: 1, claimGeneration: 2 } },
            { nodeId: "close-pay-period", categoryKey: "timecard", label: "Close the pay period", state: "replayed", replayedFrom: { attempt: 1, claimGeneration: 2 } },
          ],
        },
        {
          key: "document", label: "Separation document",
          state: "pending",
          members: [{ nodeId: "file-document", categoryKey: "document", label: "File to OnBase", state: "pending" }],
        },
      ],
    }),
  });

  return { FIXTURE_RUN_DETAILS };
}
