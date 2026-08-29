/**
 * THE THREE IDENTITY-APPROVAL CEREMONIES (ref write-safety §14.6 risk 1, D226).
 *
 * ALWAYS-GATE fires on every separation, so the dominant failure mode is
 * RUBBER-STAMPING: a control that is one click on every run trains the operator
 * to approve without reading. §14.6's answer is that the shape of the decision
 * changes with its risk and that the SERVER decides the shape — which is only
 * true if the client obeys it. These are the arms that make it true.
 *
 * The load-bearing assertions here are the REFUSALS. A composer that answered
 * where the server asked a question would be the exact rot §14.6 predicts, and
 * it would pass every other gate in the tree.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import { IdentityGateDetailWireSchema } from "../../../src/domain/dashboard/run-detail.js";
import { directIdentifierDigestReference } from "../../../src/domain/redaction.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../src/domain/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../src/domain/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../src/domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../src/domain/separations/write-plan.js";
import { deriveJobRowFromCells } from "../../../src/stores/ucpath/driver/person-org-operation.js";
import {
  composeCommandRequest,
  type CommandAction,
} from "../../../src/dashboard/app/command-dispatch.js";
import {
  EMPTY_IDENTITY_GATE_DRAFT,
  identityCeremonyFor,
  identityDraftProblem,
  identityGateAnswer,
  optionFor,
  type IdentityGateDetail,
} from "../../../src/dashboard/app/identity-ceremony.js";

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

/**
 * A packet whose shape is DERIVED, never asserted.
 *
 * `deriveApprovalShape` is the server's own policy and these fixtures feed it
 * real inputs, so a change to that policy moves these tests rather than leaving
 * them agreeing with a stale constant.
 */
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
/** the names do not match at all — S17's shape, and the riskiest one */
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
    // The SERVER's own mapping (`run-detail.ts`): the checked EID is `checked`,
    // the one a name search resolved is `name-search`. A surface may not invent
    // either label — the post-gate node re-derives it and refuses a
    // contradiction as `identity-approval-choice-mismatch`.
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

describe("identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1)", () => {
  it("derives all three shapes from real packet inputs, never from a constant", () => {
    assert.equal(ONE_CLICK.approvalShape, "one-click");
    assert.equal(CHOOSE.approvalShape, "choose-a-candidate");
    assert.equal(TYPE_EID.approvalShape, "type-the-eid");
    // The two risky packets carry BOTH people, which is the whole reason the
    // ceremony exists: the operator is choosing between them.
    assert.equal(CHOOSE.approvableEids.length, 2);
    assert.equal(TYPE_EID.approvableEids.length, 2);
  });

  it("maps each shape to its own control, and a rejection to its own", () => {
    assert.equal(identityCeremonyFor(gateDetail(ONE_CLICK), "approved").kind, "confirm");
    assert.equal(identityCeremonyFor(gateDetail(CHOOSE), "approved").kind, "choose");
    assert.equal(identityCeremonyFor(gateDetail(TYPE_EID), "approved").kind, "type-the-eid");
    assert.equal(identityCeremonyFor(gateDetail(TYPE_EID), "rejected").kind, "reject");
  });

  it("REFUSES an approvalShape this build has no control for — it never falls back to one click", () => {
    // A wire value can outrun a bundle: a server upgraded ahead of a browser
    // tab serves a shape this build never compiled. Approving under a ceremony
    // nobody implemented is §14.6 risk 1 with the server's own guard removed.
    const forged = { ...gateDetail(CHOOSE), approvalShape: "biometric-scan" } as unknown as IdentityGateDetail;
    const ceremony = identityCeremonyFor(forged, "approved");
    assert.equal(ceremony.kind, "unsupported");
    assert.match(ceremony.kind === "unsupported" ? ceremony.reason : "", /biometric-scan/);
  });

  it("REFUSES a packet whose shape and candidate count contradict each other", () => {
    // The server states both facts. When they disagree only the server can say
    // which it meant, so this reports the contradiction rather than guessing.
    const oneClickTwoOptions = { ...gateDetail(CHOOSE), approvalShape: "one-click" } as IdentityGateDetail;
    assert.equal(identityCeremonyFor(oneClickTwoOptions, "approved").kind, "unsupported");

    const chooseOneOption = { ...gateDetail(ONE_CLICK), approvalShape: "choose-a-candidate" } as IdentityGateDetail;
    assert.equal(identityCeremonyFor(chooseOneOption, "approved").kind, "unsupported");
  });
});

describe("identityDraftProblem — the bounds, stated where the value is typed", () => {
  it("asks for a candidate before it will let one be sent", () => {
    const ceremony = identityCeremonyFor(gateDetail(CHOOSE), "approved");
    assert.match(identityDraftProblem(ceremony, EMPTY_IDENTITY_GATE_DRAFT) ?? "", /Pick which candidate/);
    assert.equal(identityDraftProblem(ceremony, { eid: NAME_SEARCH, reason: "" }), undefined);
  });

  it("asks for eight digits, and then for an EID THE PACKET SHOWED", () => {
    const ceremony = identityCeremonyFor(gateDetail(TYPE_EID), "approved");
    assert.match(identityDraftProblem(ceremony, { eid: "107792", reason: "" }) ?? "", /8-digit/);
    // The narrow rule D202 #2 records: this chunk performs no second live read,
    // so an EID nothing here looked at cannot be approved from here.
    assert.match(
      identityDraftProblem(ceremony, { eid: "99999999", reason: "" }) ?? "",
      /identity-approval-eid-not-shown/,
    );
    assert.equal(identityDraftProblem(ceremony, { eid: CHECKED, reason: "" }), undefined);
  });

  it("asks for a rejection reason, and accepts one that is only whitespace-padded", () => {
    const ceremony = identityCeremonyFor(gateDetail(ONE_CLICK), "rejected");
    assert.notEqual(identityDraftProblem(ceremony, EMPTY_IDENTITY_GATE_DRAFT), undefined);
    assert.notEqual(identityDraftProblem(ceremony, { eid: "", reason: "   " }), undefined);
    assert.equal(identityDraftProblem(ceremony, { eid: "", reason: " wrong person " }), undefined);
  });

  it("carries the unsupported reason through as the problem, so the send stays blocked", () => {
    const forged = { ...gateDetail(CHOOSE), approvalShape: "biometric-scan" } as unknown as IdentityGateDetail;
    const ceremony = identityCeremonyFor(forged, "approved");
    assert.match(identityDraftProblem(ceremony, { eid: CHECKED, reason: "" }) ?? "", /biometric-scan/);
    assert.equal(identityGateAnswer(ceremony, { eid: CHECKED, reason: "" }), undefined);
  });
});

describe("composeCommandRequest — the three ceremonies reach the real command endpoint (D226)", () => {
  it("composes a CHOSEN candidate under the server's own chosenFrom label", () => {
    const detail = gateDetail(CHOOSE);
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: available(detail), gateAnswer: { decision: "approved", eid: NAME_SEARCH } },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = CommandRequestSchema.parse(composed.request);
    assert.equal(parsed.family, "gate");
    if (parsed.family !== "gate") return;
    assert.equal(parsed.payload.result.schemaHash, detail.resultSchemaHash);
    const result = IdentityApprovalResultSchema.parse(parsed.payload.result.value);
    assert.equal(result.decision, "approved");
    if (result.decision !== "approved") return;
    assert.equal(result.eid, NAME_SEARCH);
    // NOT invented: the label is the served option's, which the post-gate node
    // re-derives and refuses a contradiction to.
    assert.equal(result.chosenFrom, optionFor(detail.options, NAME_SEARCH)?.chosenFrom);
    assert.equal(result.chosenFrom, "name-search");
    assert.equal(result.evidenceDigest, detail.evidenceDigest);
  });

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
