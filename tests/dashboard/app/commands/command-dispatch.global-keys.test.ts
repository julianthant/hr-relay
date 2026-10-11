
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import {
composeCommandRequest,
type CommandAction,
} from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { IdentityGateDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest,
} from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
const NOW = "2026-08-14T17:00:00.000Z";
const EID = "10833507";
const RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;



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
