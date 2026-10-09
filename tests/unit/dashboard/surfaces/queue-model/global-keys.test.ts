
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { IdentityGateDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../../../src/rules/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../../../src/rules/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../../../src/rules/separations/identity-evidence.js";
import { deriveJobRowFromCells } from "../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { attentionRunIds } from "../../../../../src/dashboard/surfaces/queue/queue-model.js";
import { nextAttention, stepSelection } from "../../../../../src/dashboard/app/navigation/global-keys.js";
import {
  composeCommandRequest,
  type CommandAction,
} from "../../../../../src/dashboard/app/commands/command-dispatch.js";
import { noSeparationWritePlan } from "../../../../../src/rules/separations/write-plan.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";
const EID = "10833507";
const RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

function surface(input: Record<string, unknown>) {
  return QueueSurfaceWireSchema.parse({
    itemId: input.runId ?? runId(9),
    workflowId: "person-lookup",
    traceId: "pl-120000-1111",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "1.0.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_A,
    configFingerprint: HASH_B,
    resolvedInstances: [],
    dryRun: false,
  priority: "interactive",
  runNumber: { state: "present", value: 1 },
  session: { state: "absent", reason: "fixture row predates run sessions (D269)" },
  containment: "root",
  linkedRuns: [],
  facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run has not ended" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "A run",
    subtitle: { state: "absent", reason: "no second identifier" },
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision: 1,
    surfaceKind: "single",
    ...input,
  });
}

describe("stepSelection — the j/k arithmetic", () => {
  const ids = ["a", "b", "c"];

  it("moves one place in each direction", () => {
    assert.equal(stepSelection(ids, "b", "next"), "c");
    assert.equal(stepSelection(ids, "b", "previous"), "a");
  });

  it("CLAMPS at both ends rather than wrapping — the demo's own arithmetic", () => {
    assert.equal(stepSelection(ids, "c", "next"), "c");
    assert.equal(stepSelection(ids, "a", "previous"), "a");
  });

  it("lands on the first row when nothing is selected, in EITHER direction", () => {
    // This is what makes the first keystroke of a session do something. Both
    // arms answer the same row because index -1 clamps to 0 from both sides.
    assert.equal(stepSelection(ids, undefined, "next"), "a");
    assert.equal(stepSelection(ids, undefined, "previous"), "a");
  });

  it("answers nothing on an empty queue instead of an invented id", () => {
    assert.equal(stepSelection([], "a", "next"), undefined);
  });

  it("treats a selection the list no longer holds as no selection", () => {
    // A run whose row left the view (a filter change, a day change) must not
    // freeze the keyboard: the id is simply not in the list, which is -1.
    assert.equal(stepSelection(ids, "gone", "next"), "a");
  });
});

describe("nextAttention — the `n` binding", () => {
  const visible = ["a", "b", "c", "d"];
  const attention = ["b", "d"];

  it("goes to the next attention row AFTER the selection", () => {
    assert.equal(nextAttention(visible, attention, "a"), "b");
    assert.equal(nextAttention(visible, attention, "b"), "d");
  });

  it("WRAPS to the first when the selection is past the last one", () => {
    assert.equal(nextAttention(visible, attention, "d"), "b");
  });

  it("starts at the first when nothing is selected", () => {
    assert.equal(nextAttention(visible, attention, undefined), "b");
  });

  it("answers nothing — never a row that does not need you — when none do", () => {
    assert.equal(nextAttention(visible, [], "a"), undefined);
  });
});

describe("attentionRunIds — the band and the key cannot disagree", () => {
  it("selects exactly the NEEDS YOU band's rows, in the drawn order", () => {
    const rows = [
      surface({ runId: runId(1), status: "running" }),
      surface({ runId: runId(2), status: "awaiting-approval" }),
      surface({
        runId: runId(3),
        status: "done",
        endedAt: { state: "present", value: NOW },
      }),
      surface({ runId: runId(4), status: "blocked" }),
    ];
    // `awaiting-approval` and `blocked` are the two statuses the band draws;
    // the order is the band's, so the waiting row precedes the parked one.
    assert.deepEqual(attentionRunIds(rows, "attention", NOW), [runId(2), runId(4)]);
  });
});



function commandAction(input: Record<string, unknown>): CommandAction {
  return {
    key: "k",
    label: "A command",
    intent: "neutral",
    placement: ["footer"],
    kind: "command",
    expectedVersion: 3,
    ...input,
  } as CommandAction;
}

const CONTEXT = { actorId: "local-operator", source: "run-detail" } as const;

describe("composeCommandRequest — the run family", () => {
  for (const verb of ["retry", "cancel", "bump"] as const) {
    it(`composes a legal envelope for ${verb}`, () => {
      const composed = composeCommandRequest(
        commandAction({ command: verb }),
        { runId: runId(1), expectedVersion: 3 },
        CONTEXT,
      );
      if (verb === "retry") {
        assert.equal(composed.state, "refused");
        if (composed.state !== "refused") assert.fail("retry must require the source-bound Rerun review");
        assert.match(composed.reason, /Open Rerun to review steps and values/u);
        assert.equal("request" in composed, false);
        return;
      }
      assert.equal(composed.state, "ready");
      if (composed.state !== "ready") return;

      const parsed = CommandRequestSchema.parse(composed.request);
      assert.equal(parsed.family, "run");
      assert.equal(parsed.type, verb);
    });
  }

  it("REFUSES both park resolutions rather than double-routing them", () => {

    const composed = composeCommandRequest(
      commandAction({
        command: "resolve-write-absent",
        writeTarget: { writeIntentId: runId(7), intentGeneration: 1 },
      }),
      { runId: runId(1), expectedVersion: 3 },
      CONTEXT,
    );
    assert.equal(composed.state, "refused");
  });
});

function packet(): IdentityEvidencePacket {
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: "Hernandez, Jose Santos",
    documentEidText: EID,
    emplIdSource: "document-eid",
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: EID as never,
      displayedName: "Hernandez, Jose Santos",
      jobRows: rows,
      rowCount: rows.length,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: NOW as never,
    },

    nameSelection: {
      status: "resolved",
      selected: {
        emplId: EID as never,
        name: "Hernandez, Jose Santos",
        department: "Housing Dining Hospitality",
        jobTitle: "STDT 3",
        employeeStatus: "active",
        hdh: true,
      },
      candidateEids: [EID as never],
    },
    plan: noSeparationWritePlan("this fixture composes no separation write plan"),
  });
}

function gateSection(overrides: Record<string, unknown> = {}) {
  const built = packet();
  return {
    state: "available" as const,
    value: IdentityGateDetailWireSchema.parse({
      runId: runId(1),
      gateId: "identity-approval",
      label: "Identity Approval",
      parkedAt: NOW,
      resumeAt: "approval",
      expectedVersion: 3,
      resultSchemaHash: RESULT_SCHEMA_HASH,
      evidenceDigest: deriveIdentityEvidenceDigest(built),
      packet: built,
      options: built.approvableEids.map((eid) => ({
        eid: String(eid),
        chosenFrom: "checked",
        displayName: "Hernandez, Jose Santos",
        origin: "the EID this run checked (document-eid)",
      })),
      approvalShape: built.approvalShape,
      actions: [{
        key: "resolve-gate-approved",
        label: "Approve this person",
        intent: "primary",
        placement: ["banner"],
        kind: "command",
        command: "resolve-gate",
        expectedVersion: 3,
        resolution: "approved",
      }],
      ...overrides,
    }),
  };
}

const APPROVE = commandAction({ command: "resolve-gate", resolution: "approved" });
const REJECT = commandAction({ command: "resolve-gate", resolution: "rejected" });

describe("composeCommandRequest — the identity gate (ref write-safety §14.4)", () => {
  it("composes an approval from SERVED facts only, and the kernel's schema accepts it", () => {
    const section = gateSection();
    assert.equal(section.value.approvalShape, "one-click");
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: section },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = CommandRequestSchema.parse(composed.request);
    assert.equal(parsed.family, "gate");
    if (parsed.family !== "gate") return;

    assert.equal(parsed.payload.result.schemaHash, section.value.resultSchemaHash);
    const result = IdentityApprovalResultSchema.parse(parsed.payload.result.value);
    assert.equal(result.decision, "approved");
    if (result.decision !== "approved") return;
    assert.equal(result.eid, section.value.options[0]?.eid);
    assert.equal(result.chosenFrom, section.value.options[0]?.chosenFrom);
    assert.equal(result.evidenceDigest, section.value.evidenceDigest);
  });

  it("REFUSES a rejection nobody authored — the reason is the operator's own", () => {
    // The ceremony dialog supplies it; a dispatcher that minted an empty reason
    // would put a sentence nobody wrote on a terminal failure record.
    const composed = composeCommandRequest(
      REJECT,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: gateSection() },
    );
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /no operator answer/);
  });

  it("REFUSES an approval nobody authored when the server asked for a choice — §14.6 risk 1", () => {
    // A surface free to pick the first candidate would turn a risky approval
    // into one click, which is rubber-stamping manufactured by accident.
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: gateSection({ approvalShape: "type-the-eid" }) },
    );
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /type-the-eid/);
  });

  it("REFUSES when the section is absent or unavailable, naming which", () => {
    const absent = composeCommandRequest(APPROVE, { runId: runId(1), expectedVersion: 3 }, CONTEXT);
    assert.equal(absent.state, "refused");
    assert.match(absent.state === "refused" ? absent.reason : "", /no identity-gate section/);

    const missing = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: { state: "missing", reason: "this build cannot describe the gate" } },
    );
    assert.equal(missing.state, "refused");
    assert.match(missing.state === "refused" ? missing.reason : "", /cannot describe the gate/);
  });
});
