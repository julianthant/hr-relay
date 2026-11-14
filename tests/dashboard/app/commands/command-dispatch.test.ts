import { type DashboardClient, createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { lifecycleCommandId } from "../../../../src/rules/commands/lifecycle-command-id.js";
import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../../support/helpers/dashboard/identity-ceremony-fixtures.js";
import { identityReviewWire } from "../../../support/helpers/dashboard/identity-review-wire.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { composeCommandRequest, verifyShellCommandEffect, type CommandAction } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { RunDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { CommandRequestSchema, CommandResultSchema, DashboardCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { type IdentityEvidencePacket, buildIdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import { type IdentityGateDetail } from "../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";
import { z } from "zod";
import { PHASE1_ACTIVE_COMMAND_ARMS } from "../../../../src/backend/runs/commands/command-kernel.js";
import { queueRowActions, type QueueRowActionFacts } from "../../../../src/backend/runs/projections/queue-row-actions.js";
import { ActionCommandKeySchema, ActionDescriptorWireSchema, type ActionDescriptorWire } from "../../../../src/models/dashboard/actions.js";
import { QueueStatusSchema } from "../../../../src/models/dashboard/projection.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { createDashboardModelFixtures } from "../../../support/helpers/dashboard-model-fixtures.js";

{
const NOW = "2026-08-14T17:00:00.000Z";
const EID = "10833507";

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

it("composes only the exact served child retry at its current revision", () => {
  const action = RunDetailWireSchema.shape.childRetry.unwrap().parse({ key: "retry-child", label: "Retry", kind: "command", command: "retry",
    expectedVersion: 3, intent: "neutral", icon: "retry", placement: ["banner"] });
  assert.ok(action.kind === "command");
  const target = { runId: runId(1), expectedVersion: 3 };
  const composed = composeCommandRequest(action, target, { ...CONTEXT, childRetry: action });
  assert.ok(composed.state === "ready");
  const request = CommandRequestSchema.parse(composed.request);
  assert.equal(request.type, "retry"); assert.equal(request.family, "run");
  assert.deepEqual(request.target, target);
  assert.equal(composeCommandRequest(action, target, CONTEXT).state, "refused");
  assert.equal(composeCommandRequest(action, { ...target, expectedVersion: 4 }, { ...CONTEXT, childRetry: action }).state, "refused");
  assert.equal(composeCommandRequest(action, target, { ...CONTEXT, source: "queue", childRetry: action }).state, "refused");
  assert.equal(composeCommandRequest({ ...action, key: "other" }, target, { ...CONTEXT, childRetry: action }).state, "refused");
});

it("verifies child retry through the exact replacement and immutable source, including hidden page children", async () => {
  const f = createDashboardModelFixtures();
  const source = RunDetailWireSchema.parse({ ...f.DETAIL, header: { ...f.DETAIL.header, parentRunId: runId(8), status: "failed" } });
  const next = RunDetailWireSchema.parse({ ...source, runId: runId(9), rowRevision: 1,
    header: { ...source.header, runId: runId(9), retryOf: source.runId, attempt: source.header.attempt + 1, status: "running" } });
  let observed = next;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async input => {
    const path = new URL(String(input)).pathname;
    assert.match(path, /\/runs\//u);
    return Response.json(path.endsWith(source.runId) ? source : observed);
  } });
  const command = CommandRequestSchema.parse({ commandId: runId(7), requestedAt: NOW, requestedBy: CONTEXT.actorId, source: CONTEXT.source,
    family: "run", type: "retry", target: { runId: source.runId, expectedVersion: source.rowRevision } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
    affectedTargets: [{ family: "run", runId: source.runId }, { family: "run", runId: next.runId }] });
  assert.ok(reply.state === "applied");
  assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, reply)).state, "matched");
  const parent = RunDetailWireSchema.parse({ ...f.DETAIL, runId: runId(8), rowRevision: 8,
    header: { ...f.DETAIL.header, runId: runId(8), status: "running" } });
  const parentClient = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async input => {
    const path = new URL(String(input)).pathname;
    const foreign = RunDetailWireSchema.parse({ ...f.DETAIL, runId: runId(6), header: { ...f.DETAIL.header, runId: runId(6) } });
    return Response.json(path.endsWith(parent.runId) ? parent : path.endsWith(source.runId) ? source : path.endsWith(observed.runId) ? observed : foreign);
  } });
  const refreshReply = CommandResultSchema.parse({ ...reply, affectedTargets: [...reply.affectedTargets, { family: "run", runId: parent.runId }] });
  assert.equal((await verifyShellCommandEffect(parentClient, f.DAY.day, command, refreshReply)).state, "matched");
  for (const targets of [
    [...reply.affectedTargets, { family: "run", runId: runId(6) }],
    [...reply.affectedTargets, { family: "run", runId: next.runId }],
    [{ family: "run", runId: parent.runId }, { family: "run", runId: next.runId }],
  ]) {
    const malformed = CommandResultSchema.parse({ ...reply, affectedTargets: targets });
    assert.equal((await verifyShellCommandEffect(parentClient, f.DAY.day, command, malformed)).state, "mismatch");
  }
  for (const header of [{ ...next.header, retryOf: runId(6) }, { ...next.header, parentRunId: runId(6) },
    { ...next.header, attempt: source.header.attempt }, { ...next.header, workflowId: "other-workflow" }]) {
    observed = RunDetailWireSchema.parse({ ...next, header });
    assert.equal((await verifyShellCommandEffect(client, f.DAY.day, command, reply)).state, "mismatch");
  }
});

it("verifies a gate-arm answer only against the gate resolved approved by the same requester at a newer revision", async () => {
  const request = DashboardCommandRequestSchema.parse({ family: "gate", type: "answer-gate-arm", commandId: runId(7), requestedAt: NOW, requestedBy: CONTEXT.actorId,
    source: CONTEXT.source, target: { runId: runId(1), gateId: "hire-review", expectedVersion: 3 }, payload: { arm: "new-hire" } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: runId(1) }] });
  const gate = { state: "resolved", nodeId: "hire-review", resolution: "approved", resolvedBy: CONTEXT.actorId };
  for (const [detail, expected] of [[{ rowRevision: 4, gate }, "matched"], [{ rowRevision: 3, gate }, "mismatch"],
    [{ rowRevision: 4, gate: { ...gate, resolvedBy: "someone-else" } }, "mismatch"], [{ rowRevision: 4, gate: { ...gate, resolution: "rejected" } }, "mismatch"],
    [{ rowRevision: 4, gate: { state: "open", nodeId: "hire-review" } }, "mismatch"]] as const) {
    const client = { runDetail: async () => detail } as unknown as DashboardClient;
    assert.equal((await verifyShellCommandEffect(client, "2026-08-14", request, reply)).state, expected);
  }
});

describe("composeCommandRequest — the run family", () => {
  for (const verb of ["retry", "recover-run", "pause", "resume", "cancel", "bump"] as const) {
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
  const { actions, ...rest } = overrides;
  return {
    state: "available" as const,
    value: identityReviewWire(packet(), {
      runId: runId(1),
      label: "Identity Approval",
      parkedAt: NOW,
      expectedVersion: 3,
      actions: (actions as ActionDescriptorWire[] | undefined) ?? [identityApprovalAction("Approve this person")],
      overrides: rest,
    }),
  };
}

const APPROVE = commandAction({ command: "resolve-gate", resolution: "approved" });
const REJECT = commandAction({ command: "resolve-gate", resolution: "rejected" });

describe("composeCommandRequest — the identity gate (ref write-safety §14.4)", () => {
  const GATE_CONTEXT = { ...CONTEXT, gateId: "identity-approval" } as const;

  it("composes an approval from the served refs only, and the dashboard union accepts it", () => {
    const section = gateSection();
    assert.equal(section.value.approvalShape, "one-click");
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...GATE_CONTEXT, gate: section },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = DashboardCommandRequestSchema.parse(composed.request);
    assert.equal(parsed.family, "gate");
    if (parsed.family !== "gate" || parsed.type !== "answer-identity-gate") return assert.fail("expected answer-identity-gate");
    assert.deepEqual(parsed.target, { runId: section.value.runId, gateId: "identity-approval", expectedVersion: 3 });
    assert.deepEqual(parsed.payload, { decision: "approved", gateRef: section.value.gateRef, optionRef: section.value.options[0]?.ref });
  });

  it("composes a served rejection as the decision and the gateRef alone", () => {
    const rejectAction = { ...REJECT, key: "resolve-gate-rejected" };
    const section = gateSection();
    const composed = composeCommandRequest(rejectAction, { runId: runId(1), expectedVersion: 3 }, { ...GATE_CONTEXT, gate: section });
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = DashboardCommandRequestSchema.parse(composed.request);
    if (parsed.family !== "gate" || parsed.type !== "answer-identity-gate") throw new Error("a rejection is an identity-gate answer");
    assert.deepEqual(parsed.payload, { decision: "rejected", gateRef: section.value.gateRef });
  });

  it("REFUSES an answer when the run detail names no open gate", () => {
    const composed = composeCommandRequest(APPROVE, { runId: runId(1), expectedVersion: 3 }, { ...CONTEXT, gate: gateSection() });
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /no open gate/);
  });

  it("REFUSES a served gate action with an unknown resolution", () => {
    const composed = composeCommandRequest(commandAction({ command: "resolve-gate" }), { runId: runId(1), expectedVersion: 3 }, { ...GATE_CONTEXT, gate: gateSection() });
    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /not an approval/);
  });

  it("REFUSES when the section is absent or unavailable, naming which", () => {
    const absent = composeCommandRequest(APPROVE, { runId: runId(1), expectedVersion: 3 }, GATE_CONTEXT);
    assert.equal(absent.state, "refused");
    assert.match(absent.state === "refused" ? absent.reason : "", /no identity-gate section/);

    const missing = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...GATE_CONTEXT, gate: { state: "missing", reason: "this build cannot describe the gate" } },
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

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const CONTEXT = { actorId: "local-operator", source: "run-detail" } as const;

const { ONE_CLICK, CHOOSE, NAME_MISMATCH, gateDetail } =
  createIdentityCeremonyFixtures(NOW, CHECKED, NAME_SEARCH, runId);











const APPROVE: CommandAction = identityApprovalAction("Approve");

function available(detail: IdentityGateDetail) {
  return { state: "available" as const, value: detail };
}

describe("composeCommandRequest — the ceremonies reach the identity-answer endpoint", () => {
  const GATE_CONTEXT = { ...CONTEXT, gateId: "identity-approval" } as const;

  it("composes a PICKED candidate from a name-mismatch review by the picked option's ref", () => {
    const detail = gateDetail(NAME_MISMATCH);
    const picked = detail.options[0];
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...GATE_CONTEXT, gate: available(detail), gateAnswer: { decision: "approved", optionRef: picked.ref } },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = DashboardCommandRequestSchema.parse(composed.request);
    if (parsed.family !== "gate" || parsed.type !== "answer-identity-gate") return assert.fail("expected answer-identity-gate");
    assert.deepEqual(parsed.payload, { decision: "approved", gateRef: detail.gateRef, optionRef: picked.ref });
  });

  it("still composes the ONE ceremony whose answer is a served fact", () => {
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...GATE_CONTEXT, gate: available(gateDetail(ONE_CLICK)) },
    );
    assert.equal(composed.state, "ready");
  });

  it("REFUSES a pick when no operator answer was supplied", () => {
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...GATE_CONTEXT, gate: available(gateDetail(NAME_MISMATCH)) },
    );

    assert.equal(composed.state, "refused");
    assert.match(composed.state === "refused" ? composed.reason : "", /no operator answer was supplied/u);
  });

  it("REFUSES a ref the review never served, even with an answer supplied", () => {
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      {
        ...GATE_CONTEXT,
        gate: available(gateDetail(NAME_MISMATCH)),
        gateAnswer: { decision: "approved", optionRef: "00000000-0000-4000-8000-0000000000ff" },
      },
    );
    assert.equal(composed.state, "refused");
  });

  it("REFUSES an unsupported ceremony outright — no payload, no send", () => {
    const forged = {
      ...gateDetail(CHOOSE),
      approvalShape: "biometric-scan",
    } as unknown as IdentityGateDetail;
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...GATE_CONTEXT, gate: available(forged), gateAnswer: { decision: "approved", typedEid: CHECKED } },
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
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, { ...factsFor(status), ...(status === "failed" ? { recoverySource: "failed" as const } : {}) }),
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

  it("refuses a rename with no answer or an illegal name, and sends an empty name as a clear", () => {
    const rename = served.find((action) => action.kind === "command" && action.command === "rename");
    assert.ok(rename?.kind === "command", "the projection served no rename to test");
    const target = { runId: uuid(1), expectedVersion: rename.expectedVersion };
    const base = { actorId: "local-operator", source: "queue" } as const;

    const unanswered = composeCommandRequest(rename, target, base);
    assert.equal(unanswered.state, "refused");
    if (unanswered.state === "refused") assert.match(unanswered.reason, /no name was supplied/);

    for (const blank of ["", "   "]) {
      const composed = composeCommandRequest(rename, target, { ...base, renameAnswer: blank });
      assert.equal(composed.state, "ready", `"${blank}" should clear the name`);
      if (composed.state !== "ready") continue;
      const parsed = CommandRequestSchema.safeParse(composed.request);
      assert.ok(parsed.success);
      if (!parsed.success || parsed.data.type !== "rename") continue;
      assert.deepEqual(parsed.data.payload, { displayName: "" });
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
    const unreachable = ["edit-checkpoint", "recheck-write", "resolve-write-absent"] as const;
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

it("reads a rename back from the served name and treats an empty name as the default", async () => {
  const { FIXTURE_DAY_WIRE } = await import("../../../support/fixtures/dashboard/fixture-queue.js");
  const root = FIXTURE_DAY_WIRE.queueSurfaces.find((row) => row.parent === null);
  assert.ok(root);
  let displayName: typeof root.displayName = { state: "present", value: "April contacts" };
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json({
    ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map((candidate) => candidate.runId === root.runId
      ? { ...root, rowRevision: root.rowRevision + 1, displayName, actions: [] } : candidate),
  }) });
  const commandFor = (displayName: string) => CommandRequestSchema.parse({
    family: "run", type: "rename", commandId: "77777777-7777-4777-8777-777777777777", source: "queue",
    requestedBy: "local-operator", requestedAt: "2026-08-03T12:00:00.000Z",
    target: { runId: root.runId, expectedVersion: root.rowRevision }, payload: { displayName },
  });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: "77777777-7777-4777-8777-777777777777",
    affectedTargets: [{ family: "run", runId: root.runId }] });
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, commandFor("April contacts"), reply)).state, "matched");
  displayName = { state: "absent", reason: "the operator has not renamed this run" };
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, commandFor("April contacts"), reply)).state, "mismatch");
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, commandFor(""), reply)).state, "matched");
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, commandFor("   "), reply)).state, "matched");
  displayName = { state: "present", value: "April contacts" };
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, commandFor(""), reply)).state, "mismatch");
});

it("checks cancellation effect and rejects an unrelated acknowledged run", async () => {
  const { FIXTURE_DAY_WIRE } = await import("../../../support/fixtures/dashboard/fixture-queue.js");
  const roots = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.parent === null);
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

it("verifies an explicit recovery's new item attempt without expecting the immutable source to change", async () => {
  const { FIXTURE_DAY_WIRE } = await import("../../../support/fixtures/dashboard/fixture-queue.js");
  const source = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.parent === null); assert.ok(source);
  const nextId = "99999999-9999-4999-8999-999999999999";
  let correctItem = true;
  const next = () => ({ ...source, runId: nextId, traceId: "pl-120001-9999", attempt: source.attempt + 1, rowRevision: 1,
    itemId: correctItem ? source.itemId : "88888888-8888-4888-8888-888888888888", actions: [] });
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json({ ...FIXTURE_DAY_WIRE,
    queueSurfaces: [...FIXTURE_DAY_WIRE.queueSurfaces, next()] }) });
  const command = CommandRequestSchema.parse({ family: "run", type: "recover-run", commandId: "77777777-7777-4777-8777-777777777777", source: "queue",
    requestedBy: "local-operator", requestedAt: "2026-08-03T12:00:00.000Z", target: { runId: source.runId, expectedVersion: source.rowRevision } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
    affectedTargets: [{ family: "run", runId: nextId }, { family: "run", runId: source.runId }] });
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, command, reply)).state, "matched");
  correctItem = false;
  assert.equal((await verifyShellCommandEffect(client, FIXTURE_DAY_WIRE.day, command, reply)).state, "mismatch");
});

it("reads back a recovered child's authenticated parent and rejects unrelated acknowledgement targets", async () => {
  const { FIXTURE_DAY_WIRE } = await import("../../../support/fixtures/dashboard/fixture-queue.js");
  const base = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.parent === null); assert.ok(base);
  const parentId = "88888888-8888-4888-8888-888888888888", nextId = "99999999-9999-4999-8999-999999999999";
  const parent = { ...base, runId: parentId, traceId: "pl-120001-8888", itemId: parentId, rowRevision: base.rowRevision + 1, actions: [] };
  const source = { ...base, parent: { runId: parentId, visibility: "linked" as const, partitionDay: FIXTURE_DAY_WIRE.day, workflowId: parent.workflowId, label: parent.title, title: parent.title, panelKind: parent.panelKind, status: parent.status } };
  const next = { ...source, runId: nextId, traceId: "pl-120002-9999", attempt: source.attempt + 1, rowRevision: 1, actions: [] };
  const unrelated = { ...parent, runId: "66666666-6666-4666-8666-666666666666", traceId: "pl-120003-6666" };
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json({ ...FIXTURE_DAY_WIRE,
    queueSurfaces: [...FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.runId !== source.runId), source, parent, next, unrelated] }) });
  const command = CommandRequestSchema.parse({ family: "run", type: "recover-run", commandId: "77777777-7777-4777-8777-777777777777", source: "queue",
    requestedBy: "local-operator", requestedAt: "2026-08-03T12:00:00.000Z", target: { runId: source.runId, expectedVersion: source.rowRevision } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
    affectedTargets: [nextId, source.runId, parentId].map(runId => ({ family: "run", runId })) });
  assert.equal((await verifyShellCommandEffect(client,FIXTURE_DAY_WIRE.day,command,reply)).state,"matched");
  const extra = CommandResultSchema.parse({ ...reply, affectedTargets: [...("affectedTargets" in reply ? reply.affectedTargets : []), { family: "run", runId: unrelated.runId }] });
  assert.equal((await verifyShellCommandEffect(client,FIXTURE_DAY_WIRE.day,command,extra)).state,"mismatch");
});
