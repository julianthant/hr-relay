import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { lifecycleCommandId } from "../../../../src/rules/commands/lifecycle-command-id.js";
import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../../support/helpers/dashboard/identity-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { composeCommandRequest, verifyShellCommandEffect, type CommandAction } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { IdentityGateDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import { type IdentityEvidencePacket, buildIdentityEvidencePacket, deriveIdentityEvidenceDigest } from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import { type IdentityGateDetail } from "../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";
import { directIdentifierDigestReference } from "../../../../src/rules/redaction/redaction.js";
import { z } from "zod";
import { PHASE1_ACTIVE_COMMAND_ARMS } from "../../../../src/backend/runs/commands/command-kernel.js";
import { queueRowActions, type QueueRowActionFacts } from "../../../../src/backend/runs/projections/queue-row-actions.js";
import { ActionCommandKeySchema, ActionDescriptorWireSchema, type ActionDescriptorWire } from "../../../../src/models/dashboard/actions.js";
import { QueueStatusSchema } from "../../../../src/models/dashboard/projection.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";

{
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
        hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
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

    const composed = composeCommandRequest(
      REJECT,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: gateSection() },
    );
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /no operator answer/);
  });

  it("REFUSES an approval nobody authored when the server asked for a choice — §14.6 risk 1", () => {

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
}

{
const NOW = "2026-08-14T17:00:00.000Z";

const CHECKED = "10833507";

const NAME_SEARCH = "10203262";
const RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const CONTEXT = { actorId: "local-operator", source: "run-detail" } as const;

const { ONE_CLICK, CHOOSE, TYPE_EID, gateDetail } =
  createIdentityCeremonyFixtures(NOW, CHECKED, NAME_SEARCH, RESULT_SCHEMA_HASH, runId);











const APPROVE: CommandAction = identityApprovalAction("Approve");
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
}

{
type Status = z.infer<typeof QueueStatusSchema>;
const uuid = (n: number): string => {
  const digits = String(n).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
};

function factsFor(status: Status, over: Partial<QueueRowActionFacts> = {}): QueueRowActionFacts {
  return {
    status,
    rowRevision: 7,
    dryRun: false,
    isChild: false,
    parkedWrite: false,
    memberCount: 0,
    isMember: false,
    named: false,
    hasReviewPanel: false,
    ...over,
  };
}

describe("queue-row action descriptors — every served verb has a command behind it", () => {
  const served = QueueStatusSchema.options.flatMap((status) => [
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status)),
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { isChild: true, memberCount: 0 })),
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { memberCount: 3 })),
  ]);

  it("composes every served descriptor into a request the kernel's own union parses", () => {
    for (const action of served) {
      if (action.kind === "navigation") {
        assert.equal(ActionDescriptorWireSchema.parse(action).kind, "navigation");
        assert.equal("command" in action, false);
        continue;
      }
      assert.ok(action.kind === "command");
      const composed = composeCommandRequest(
        action,
        { runId: uuid(1), expectedVersion: action.expectedVersion },
        {
          actorId: "local-operator",
          source: "queue",

          renameAnswer: "Friday exception pack",
        },
      );
      assert.equal(
        composed.state,
        "ready",
        `${action.key} refused composition: ${composed.state === "refused" ? composed.reason : ""}`,
      );
      const parsed = CommandRequestSchema.safeParse(composed.request);
      assert.ok(parsed.success, `${action.key} composed an envelope the kernel refuses`);
    }
  });

  it("refuses a rename with no name, and one the display-name schema would reject", () => {
    const rename = served.find((action) => action.kind === "command" && action.command === "rename");
    assert.ok(rename?.kind === "command", "the projection served no rename to test");
    const target = { runId: uuid(1), expectedVersion: rename.expectedVersion };
    const base = { actorId: "local-operator", source: "queue" } as const;

    const unanswered = composeCommandRequest(rename, target, base);
    assert.equal(unanswered.state, "refused");
    if (unanswered.state === "refused") assert.match(unanswered.reason, /no name was supplied/);

    for (const blank of ["", "   "]) {
      const composed = composeCommandRequest(rename, target, { ...base, renameAnswer: blank });
      assert.equal(composed.state, "refused", `"${blank}" composed a rename`);
    }

    const tooLong = composeCommandRequest(rename, target, { ...base, renameAnswer: "x".repeat(121) });
    assert.equal(tooLong.state, "refused");

    const ok = composeCommandRequest(rename, target, { ...base, renameAnswer: "  Friday exception pack  " });
    assert.equal(ok.state, "ready");
    if (ok.state !== "ready") return;
    const parsed = CommandRequestSchema.safeParse(ok.request);
    assert.ok(parsed.success);
    if (!parsed.success) return;
    assert.equal(parsed.data.family, "run");
    assert.equal(parsed.data.type, "rename");
    assert.deepEqual(
      parsed.data.type === "rename" ? parsed.data.payload : undefined,
      { displayName: "Friday exception pack" },
    );

    assert.equal(parsed.data.target.expectedVersion, rename.expectedVersion);
  });

  it("catches a synthesized descriptor whose verb this path cannot send", () => {
    const unreachable = ["edit-checkpoint", "resolve-write-present", "resolve-write-absent"] as const;
    for (const command of unreachable) {
      assert.ok(
        !served.some((action) => action.kind === "command" && action.command === command),
        `the projection serves "${command}", which this test asserts it must not`,
      );
    }

    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("edit-checkpoint"));

    assert.ok(!(ActionCommandKeySchema.options as readonly string[]).includes("force-done"));
    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("force-done"));

    const refused = composeCommandRequest(
      ActionDescriptorWireSchema.parse({
        kind: "command", command: "resolve-write-absent", key: "x", label: "x",
        intent: "neutral", placement: ["footer"], expectedVersion: 1,
        writeTarget: { writeIntentId: uuid(4), intentGeneration: 1, writeAttemptId: uuid(5),
          bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) },
      }) as Extract<ActionDescriptorWire, { kind: "command" }>,
      { runId: uuid(1), expectedVersion: 1 },
      { actorId: "local-operator", source: "queue" },
    );
    assert.equal(refused.state, "refused");
  });
});
}

// The actual transport and verifier must agree on every deleted target's durable command identity.
it("confirms cascade deletion only through the exact lifecycle tombstone provenance", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const childId = "22222222-2222-4222-8222-222222222222";
  const command = CommandRequestSchema.parse({ family: "run", type: "delete", commandId: "33333333-3333-4333-8333-333333333333",
    requestedBy: "local-operator", requestedAt: "2026-08-03T12:00:00.000Z", source: "queue", target: { runId, expectedVersion: 2 } });
  const expected = lifecycleCommandId("operator-delete", command.commandId);
  let childCommandId = expected;
  let absent = false;
  const reads: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
    const target = url.includes(childId) ? childId : runId;
    reads.push(target);
    const selected = absent ? { state: "absent", disposition: "absent", runId: target }
      : { state: "deleted", disposition: "deleted", runId: target, commandId: target === childId ? childCommandId : expected,
        workflowId: "person-lookup", itemId: "44444444-4444-4444-8444-444444444444", attempt: 1, deletedAt: "2026-08-03T12:00:00.000Z" };
    return Response.json({ schemaVersion: 1, state: "unavailable", selected, reason: "item-identity-unknown" });
  } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
    affectedTargets: [{ family: "run", runId }, { family: "run", runId: childId }] });
  assert.equal((await verifyShellCommandEffect(client, "2026-08-03", command, reply)).state, "matched");
  assert.deepEqual(reads, [runId, childId]);
  childCommandId = lifecycleCommandId("operator-delete", "55555555-5555-4555-8555-555555555555");
  assert.equal((await verifyShellCommandEffect(client, "2026-08-03", command, reply)).state, "mismatch");
  absent = true;
  assert.equal((await verifyShellCommandEffect(client, "2026-08-03", command, reply)).state, "mismatch", "absence alone cannot prove deletion");
});

it("checks cancellation effect and rejects an unrelated acknowledged run", async () => {
  const { FIXTURE_DAY_WIRE } = await import("../../../support/fixtures/dashboard/fixture-queue.js");
  const roots = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.lineage.state === "root");
  const root = roots.find(row => row.actions.some(action => action.kind === "command" && action.command === "cancel"));
  assert.ok(root); const other = roots.find(row => row.runId !== root.runId); assert.ok(other);
  let cancelled = true;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json({ ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row => row.runId === root.runId || row.runId === other.runId
      ? { ...row, status: cancelled ? "cancelled" : row.status, rowRevision: row.rowRevision + 1, actions: [],
        endedAt: cancelled ? { state: "present", value: row.updatedAt } : row.endedAt,
        gateOpenedAt: { state: "absent", reason: "No open gate after cancellation" } } : row),
  }) });
  const command = CommandRequestSchema.parse({ family: "run", type: "cancel", commandId: "77777777-7777-4777-8777-777777777777", source: "queue",
    requestedBy: "local-operator", requestedAt: "2026-08-03T12:00:00.000Z", target: { runId: root.runId, expectedVersion: root.rowRevision } });
  const reply = { state: "applied" as const, commandId: command.commandId, affectedTargets: [{ family: "run" as const, runId: root.runId }] };
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, command, reply)).state, "matched");
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, command, { ...reply, affectedTargets: [...reply.affectedTargets, { family: "run", runId: other.runId }] })).state, "mismatch");
  cancelled = false;
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, command, reply)).state, "mismatch", "acknowledgment cannot replace effect readback");
});
