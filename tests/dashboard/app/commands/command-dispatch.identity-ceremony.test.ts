
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import {
composeCommandRequest,
type CommandAction,
} from "../../../../src/dashboard/app/commands/command-dispatch.js";
import {
type IdentityGateDetail
} from "../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";
import { IdentityGateDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { directIdentifierDigestReference } from "../../../../src/rules/redaction/redaction.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest,
} from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";

const NOW = "2026-08-14T17:00:00.000Z";
/** The EID the document carries and the run checked. */
const CHECKED = "10833507";
/** The person a search on the document's NAME resolves — a different human. */
const NAME_SEARCH = "10001799";
const RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const CONTEXT = { actorId: "local-operator", source: "run-detail" } as const;

function jobRows() {
  return [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
  ], 0)];
}


function packetOf(input: {
  readonly documentName: string;
  readonly searchResolvesEid: string;
}): IdentityEvidencePacket {
  const rows = jobRows();
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: input.documentName,
    documentEidText: CHECKED,
    emplIdSource: "document-eid",
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: CHECKED as never,
      displayedName: "Hernandez, Jose Santos",
      jobRows: rows,
      rowCount: rows.length,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: NOW as never,
    },
    nameSelection: {
      status: "resolved",
      selected: {
        emplId: input.searchResolvesEid as never,
        name: input.searchResolvesEid === CHECKED ? "Hernandez, Jose Santos" : "Hernandez, Jose",
        department: "Housing Dining Hospitality",
        jobTitle: "STDT 3",
        employeeStatus: "active",
        hdh: true,
      },
      candidateEids: [input.searchResolvesEid as never],
    },
    plan: noSeparationWritePlan("this fixture composes no separation write plan"),
  });
}

/** The three packets the three ceremonies fall out of. */
const ONE_CLICK = packetOf({ documentName: "Hernandez, Jose Santos", searchResolvesEid: CHECKED });
/** the name agrees, but a search on it resolves a DIFFERENT person */
const CHOOSE = packetOf({ documentName: "Hernandez, Jose Santos", searchResolvesEid: NAME_SEARCH });
/** Names that do not match. */
const TYPE_EID = packetOf({ documentName: "Okonkwo, Adaeze", searchResolvesEid: NAME_SEARCH });

function gateDetail(packet: IdentityEvidencePacket, overrides: Record<string, unknown> = {}): IdentityGateDetail {
  const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
  return IdentityGateDetailWireSchema.parse({
    runId: runId(1),
    gateId: "identity-approval",
    label: "Identity Approval",
    parkedAt: NOW,
    resumeAt: "approval",
    expectedVersion: 3,
    resultSchemaHash: RESULT_SCHEMA_HASH,
    evidenceDigest: deriveIdentityEvidenceDigest(packet),
    packet,

    options: packet.approvableEids.map((eid) => ({
      eid: String(eid),
      chosenFrom: String(eid) === String(packet.emplId)
        ? "checked"
        : String(eid) === String(nameSearchEid) ? "name-search" : "manual",
      displayName: String(eid) === String(packet.emplId) ? packet.ucpathName : `EID ${String(eid)}`,
      origin: "a UCPath search on the document's name listed this EID",
    })),
    approvalShape: packet.approvalShape,
    actions: [{
      key: "resolve-gate-approved",
      label: "Approve the chosen EID",
      intent: "primary",
      placement: ["banner"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: 3,
      resolution: "approved",
    }],
    ...overrides,
  });
}

const APPROVE: CommandAction = {
  key: "resolve-gate-approved",
  label: "Approve",
  intent: "primary",
  placement: ["banner"],
  kind: "command",
  command: "resolve-gate",
  expectedVersion: 3,
  resolution: "approved",
};
const REJECT: CommandAction = { ...APPROVE, key: "resolve-gate-rejected", resolution: "rejected" };

function available(detail: IdentityGateDetail) {
  return { state: "available" as const, value: detail };
}

describe("composeCommandRequest — the three ceremonies reach the real command endpoint", () => {

  it("composes a TYPED EID, and the label still comes off the served option", () => {
    const detail = gateDetail(TYPE_EID);
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: available(detail), gateAnswer: { decision: "approved", eid: CHECKED } },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = CommandRequestSchema.parse(composed.request);
    if (parsed.family !== "gate") return assert.fail("expected a gate command");
    const result = IdentityApprovalResultSchema.parse(parsed.payload.result.value);
    if (result.decision !== "approved") return assert.fail("expected an approval");
    assert.equal(result.eid, CHECKED);
    assert.equal(result.chosenFrom, "checked");
  });

  it("composes a REJECTION with the operator's own trimmed reason and the bound digest", () => {
    const detail = gateDetail(ONE_CLICK);
    const composed = composeCommandRequest(
      REJECT,
      { runId: runId(1), expectedVersion: 3 },
      {
        ...CONTEXT,
        gate: available(detail),
        gateAnswer: { decision: "rejected", reason: "  the UCPath detail is a different person  " },
      },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = CommandRequestSchema.parse(composed.request);
    if (parsed.family !== "gate") return assert.fail("expected a gate command");
    const result = IdentityApprovalResultSchema.parse(parsed.payload.result.value);
    assert.equal(result.decision, "rejected");
    if (result.decision !== "rejected") return;
    assert.equal(result.reason, "the UCPath detail is a different person");
    assert.equal(result.evidenceDigest, detail.evidenceDigest);
  });

  it("still composes the ONE ceremony whose answer is a served fact", () => {
    // `one-click` with exactly one candidate needs no human input beyond the
    // press: the server said one click and named the person.
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: available(gateDetail(ONE_CLICK)) },
    );
    assert.equal(composed.state, "ready");
  });

  it("REFUSES a typed-EID ceremony when no operator answer was supplied", () => {
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: available(gateDetail(TYPE_EID)) },
    );

    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /no operator answer was supplied/u);
  });

  it("REFUSES an EID the packet never showed, even with an answer supplied", () => {
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      {
        ...CONTEXT,
        gate: available(gateDetail(TYPE_EID)),
        gateAnswer: { decision: "approved", eid: "99999999" },
      },
    );
    assert.equal(composed.state, "refused");
    const reason = composed.state === "refused" ? composed.reason : "";
    assert.match(reason, new RegExp(`never showed EID ${directIdentifierDigestReference("99999999")}`));
    assert.doesNotMatch(reason, /99999999/);
  });

  it("REFUSES when the answer and the control pressed disagree", () => {
    // Two tabs, two dialogs, one stale press. Sending either would record a
    // decision the operator did not make.
    const composed = composeCommandRequest(
      REJECT,
      { runId: runId(1), expectedVersion: 3 },
      {
        ...CONTEXT,
        gate: available(gateDetail(CHOOSE)),
        gateAnswer: { decision: "approved", eid: NAME_SEARCH },
      },
    );
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /disagree/);
  });

  it("REFUSES an unsupported ceremony outright — no payload, no send", () => {
    const forged = {
      ...gateDetail(CHOOSE),
      approvalShape: "biometric-scan",
    } as unknown as IdentityGateDetail;
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: available(forged), gateAnswer: { decision: "approved", eid: CHECKED } },
    );
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /biometric-scan/);
  });
});
