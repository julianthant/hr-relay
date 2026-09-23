import { at,uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { sectionResponse } from "./section-wire.js";

type DataEntrySeed = Readonly<{
  label: string;
  valueRedacted: string;
  edit?: Record<string, unknown>;
  observedAt?: string;
  source?: "live" | "derived" | "operator";
  correctedAt?: string;
}>;

const LOCKED_NOT_DECLARED = {
  state: "locked",
  reason: "not declared correctable by this workflow",
} as const;

const CLAIMED_EDIT_LOCK = {
  state: "locked",
  reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
    + "editing reopens when it parks or finishes",
} as const;

function sectionsOf(seed: number, entries: readonly DataEntrySeed[], editing?: Record<string, unknown>) {
  const runId = uuidOf(seed);
  return Object.freeze({
    "context-data": sectionResponse({
      section: "context-data",
      payload: {
        runId,
        editing: editing ?? {
          state: "locked",
          reason: "run is terminal; corrections apply only to a non-executing resumable run",
        },
        entries: entries.map((entry) => ({
          label: entry.label,
          valueRedacted: entry.valueRedacted,
          edit: entry.edit ?? LOCKED_NOT_DECLARED,
          ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
          ...(entry.source === undefined ? {} : { source: entry.source }),
          ...(entry.correctedAt === undefined ? {} : { correctedAt: entry.correctedAt }),
        })),
      },
    }),
    "context-attempts": sectionResponse({
      section: "context-attempts",
      payload: { runId, entries: [{ label: "Attempt 1", valueRedacted: `${at(30)} · this attempt` }] },
    }),
  });
}

export const FIXTURE_CONTEXT_DATA_SECTIONS = Object.freeze({
  [FIXTURE_IDS.queuedRun]: sectionsOf(1, [
    {
      label: "Starts on",
      valueRedacted: "2026-07-15",
      edit: {
        state: "editable",
        nodeId: "crm-dates",
        fieldPath: "startsOn.value",
        value: "2026-07-15",
        pendingCorrection: { state: "none" },
      },
      observedAt: at(51),
      source: "live",
    },
    {
      label: "Invited on",
      valueRedacted: "2026-06-01",
      edit: {
        state: "editable",
        nodeId: "crm-dates",
        fieldPath: "invitedOn.value",
        value: "2026-06-01",
        pendingCorrection: { state: "pending", value: "2026-06-02", correctedAt: at(50) },
      },
      observedAt: at(50),
      source: "operator",
      correctedAt: at(50),
    },
  ], { state: "editable", expectedVersion: 2 }),
  [FIXTURE_IDS.runningRun]: sectionsOf(2, [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "pending" },
  ], CLAIMED_EDIT_LOCK),
  [FIXTURE_IDS.doneRun]: sectionsOf(3, [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "active" },
  ]),
  [FIXTURE_IDS.failedRun]: sectionsOf(4, [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "not-reached" },
  ]),
  [FIXTURE_IDS.openGateRun]: sectionsOf(5, [
    { label: "Selection", valueRedacted: "ambiguous (2 candidates)" },
    { label: "Active status", valueRedacted: "pending" },
  ], CLAIMED_EDIT_LOCK),
  [FIXTURE_IDS.gateTypedEidRun]: sectionsOf(44, [
    { label: "Selection", valueRedacted: "name mismatch" },
    { label: "Active status", valueRedacted: "pending" },
  ], CLAIMED_EDIT_LOCK),
  [FIXTURE_IDS.parkedRun]: sectionsOf(6, [
    { label: "Selection", valueRedacted: "exact-match", observedAt: at(44), source: "live" },
    { label: "Termination reason", valueRedacted: "Resign - No Reason Given", observedAt: at(44), source: "derived" },
  ], {
    state: "locked",
    reason: "run is parked-write; corrections apply only to a non-executing resumable run",
  }),
  [FIXTURE_IDS.memberRun]: sectionsOf(31, [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "active" },
  ]),
  [FIXTURE_IDS.groupOf13]: sectionsOf(70, [
    { label: "Selection", valueRedacted: "13 members" },
    { label: "Active status", valueRedacted: "mixed" },
  ]),
});
