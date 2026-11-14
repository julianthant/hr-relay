import { separationsDescriptor, separationsIdentityCheckModule } from "../../../support/helpers/registered-workflows.js";
import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import {
availableSections,
buildRunDetail,
buildRunSection,
resolveIdentityGateAnswer,
type RunDetailQueryDeps,
} from "../../../../src/backend/runs/queries/run-detail.js";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { TimelineEventRecordSchema, timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import {
checkpointLookupKey,
RunCheckpointRecordSchema,
type RunCheckpointRecord,
} from "../../../../src/models/workflow/checkpoint.js";
import { IDENTITY_REVIEW_TEXT } from "../../../../src/backend/runs/decisions/decision-catalog.js";
import { MatchIdentityOutputSchema } from "../../../../src/models/workflows/separations/match-identity.js";
import { IdentityGateAnswerRequestSchema, type CommandRequest, type IdentityGateAnswerRequest } from "../../../../src/rules/commands/commands.js";
import { deriveStableUuid } from "../../../../src/rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { ApprovedIdentitySubjectSchema, IdentityApprovalResultSchema, verifyIdentityApproval } from "../../../../src/rules/separations/identity-approval.js";
import { VerifyIdentityApprovalOutputSchema } from "../../../../src/models/workflows/separations/verify-identity-approval.js";
import { IdentityGateDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { SeparationsCanonicalInput } from "../../../../src/workflows/separations/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest,
} from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import { taskImplFingerprint } from "../../../../src/workflow-kit/fingerprints.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import {
FIXTURE_IDENTITY_GATE,
FIXTURE_IDENTITY_GATE_NAME_MISMATCH,
} from "../../../support/fixtures/dashboard/fixture-day.js";
import { FIXTURE_GATE_CHECKED_EID } from "../../../support/fixtures/dashboard/fixture-gate.js";
import {
makeWorld,
queuedEventOf,
runRecordOf,
uuidOf,
type DashboardWorld,
} from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const worlds: DashboardWorld[] = [];
const checkpointEvents = new WeakMap<DashboardWorld, Map<string, unknown>>();
async function world(): Promise<DashboardWorld> {
  const created = await makeWorld({ profileFixture: profileFixtures.create });
  worlds.push(created);
  checkpointEvents.set(created, new Map());
  return created;
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

const RUN_ID = uuidOf(1);
const NOW = "2026-08-12T18:00:00.000Z";
const EID = "10833507";
const HASH = "a".repeat(64);
const IDENTITY_DESCRIPTOR = separationsIdentityCheckModule.descriptor;
const RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

const PARKED_GATE_LIFECYCLE = {
  state: "parked-gate",
  gateId: "identity-approval",
  parkedAt: NOW,
  resumeAt: "approval",
} as const;

const GATE_NODES = [{
  nodeId: "identity-approval",
  label: "Identity Approval",
  dependsOn: ["comparison"],
  resultSchemaHash: RESULT_SCHEMA_HASH,
}];

function packetOf(overrides: Readonly<{
  differentName?: boolean;
  searchEid?: string;
  eid?: string;
  documentName?: string;
  ucpathName?: string;
  source?: "name-resolved" | "document-eid" | "operator-entered";
}> = {}): IdentityEvidencePacket {
  const source = overrides.source ?? "name-resolved";
  const eid = overrides.eid ?? EID;
  const ucpathName = overrides.ucpathName ?? "Hernandez, Jose Santos";
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: overrides.documentName ?? (overrides.differentName === true ? "Hernandez, Maria" : "Hernandez, Jose Santos"),
    documentEidText: source === "document-eid" ? eid : "the separation document carried no EID",
    emplIdSource: source,
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: eid as never,
      displayedName: ucpathName,
      jobRows: rows,
      rowCount: rows.length,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: NOW as never,
    },
    nameSelection: {
      status: "resolved",
      selected: {
        emplId: (overrides.searchEid ?? eid) as never,
        name: overrides.differentName === true ? "Hernandez, Maria" : ucpathName,
        department: "Housing Dining Hospitality",
        jobTitle: "STDT 3",
        employeeStatus: "active",
        hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true,
      },
      candidateEids: [(overrides.searchEid ?? eid) as never],
    },
    plan: noSeparationWritePlan("this fixture composes no separation write plan"),
  });
}

function checkpointOf(packet: IdentityEvidencePacket, nodeId = "comparison", descriptor: AnyWorkflowDescriptor = IDENTITY_DESCRIPTOR): RunCheckpointRecord {
  const task = descriptorRuntimeNodes(descriptor)
    .find((node) => node.kind === "task" && String(node.id) === nodeId);
  if (task === undefined || task.kind !== "task") throw new Error(`identity checkpoint task ${nodeId} is absent`);
  const value = MatchIdentityOutputSchema.parse({
    packet,
    approvalRequired: packet.emplIdSource === "name-resolved" || packet.emplIdSource === "operator-entered",
    evidenceDigest: deriveIdentityEvidenceDigest(packet),
  });
  return RunCheckpointRecordSchema.parse({
    workflowId: descriptor.id,
    itemId: runRecordOf({ seed: 1 }).envelope.itemId,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: RUN_ID,
    output: { schemaHash: deriveSchemaHash(task.uses.output, "output"), value },
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: taskImplFingerprint(task.uses),
    provenance: [],
    writtenAt: NOW,
  });
}

function putCheckpoint(w: DashboardWorld, input: unknown): { record: RunCheckpointRecord; eventId: string } {
  const record = RunCheckpointRecordSchema.parse(input);
  const run = w.authority.getRun(RUN_ID);
  if (run === undefined) throw new Error("identity checkpoint fixture run was not seeded");
  w.authority.putCheckpoint(record);
  const eventId = deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(
    record.workflowId,
    record.itemId,
    record.nodeId,
    record.attempt,
    record.claimGeneration,
  ));
  const events = checkpointEvents.get(w);
  if (events === undefined) throw new Error("identity checkpoint timeline fixture was not initialized");
  events.set(eventId, {
    payload: {
      kind: "checkpoint-recorded",
      runId: record.runId,
      workflow: record.workflowId,
      attempt: record.attempt,
      claimGeneration: record.claimGeneration,
      checkpoint: timelineCheckpointReference(record),
    },
  });
  return { record, eventId };
}

/** `null` means "this build registers no descriptor for the run's workflow". */
function depsOf(
  w: DashboardWorld,
  gateNodes: readonly unknown[] | null = GATE_NODES,
  includeCanonical = true,
  descriptor: AnyWorkflowDescriptor = IDENTITY_DESCRIPTOR,
  attemptingWriteIntents: readonly unknown[] = [],
): RunDetailQueryDeps {
  const timelineEvents = {
    get: (eventId: string) => checkpointEvents.get(w)?.get(eventId),
  };
  const canonical = {
    reader: w.runReader,
    descriptors: {
      resolve: (workflowId: string) => String(descriptor.id) === workflowId ? descriptor : undefined,
    },
    database: {
      withAuthorityReadSnapshot: <Result>(read: () => Result) => read(),
      authority: {
        runs: { listChildren: () => [], get: () => w.authority.getRun(RUN_ID) },
        deletedRuns: { get: () => undefined },
        writeIntents: { listAttemptingByItem: () => attemptingWriteIntents, listByRun: () => [], listByBusinessKey: () => [] },
        gateResults: { listByRun: () => [] },
        runCheckpoints: {
          listByItem: () => [],
          latest: (workflowId: string, itemId: string, nodeId: string) =>
            w.authority.latestCheckpoint(workflowId, itemId, nodeId),
          listByAttempt: (workflowId: string, itemId: string, nodeId: string, attempt: number) => {
            const stored = w.authority.latestCheckpoint(workflowId, itemId, nodeId);
            return stored?.attempt === attempt ? [stored] : [];
          },
        },
        timelineEvents,
      },
    },
  };
  return { runReader: w.runReader,
    stateRoot: w.stateRoot, timeline:w.timeline,
    projection: w.projection,
    authority: w.authority,
    ...(includeCanonical ? { canonical: canonical as never } : {}),
    descriptors: {
      resolve: () => (gateNodes === null
        ? undefined
        : { details: [], gateNodes: gateNodes as never }),
    },
  };
}

const SEPARATIONS_INPUT = { documentNumber: "4510", timekeeperName: "Synthetic Timekeeper", searchTimeoutMs: 15000 };

function seed(w: DashboardWorld, input?: Readonly<{ lifecycle?: unknown; version?: number; descriptor?: AnyWorkflowDescriptor }>): void {
  const descriptor = input?.descriptor ?? IDENTITY_DESCRIPTOR;
  queuedEventOf(w, {
    seed: 1,
    workflow: String(descriptor.id),
    claimGeneration: 1,
    version: input?.version ?? 4,
    lifecycle: input?.lifecycle ?? PARKED_GATE_LIFECYCLE,
  });
  const seeded = w.authority.getRun(RUN_ID);
  if (seeded === undefined) throw new Error("identity gate fixture run was not seeded");
  w.authority.put(RunRecordSchema.parse({
    ...seeded,
    envelope: {
      ...seeded.envelope,
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
    },
    ...(descriptor === separationsDescriptor ? { input: { ...seeded.input, parsed: { ...seeded.input.parsed, value: SEPARATIONS_INPUT,
      protectedBindings: [{ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId: uuidOf(90) }],
      schemaHash: deriveSchemaHash(SeparationsCanonicalInput, "output") } } } : {}),
  }));
}

function gateSection(w: DashboardWorld, deps = depsOf(w)) {
  const response = buildRunSection(deps, RUN_ID, "identity-gate");
  if (response.section !== "identity-gate") throw new Error("wrong section");
  return response.payload;
}

function available(payload: ReturnType<typeof gateSection>) {
  if (payload.state !== "available") throw new Error("gate unavailable");
  return payload;
}

type ServedGate = ReturnType<typeof available>["value"];

function optionRefOf(value: ServedGate, index = 0): string {
  const ref = value.options[index]?.ref;
  if (ref === undefined) throw new Error(`served gate has no option ${String(index)}`);
  return ref;
}

function answerOf(value: ServedGate, payload: IdentityGateAnswerRequest["payload"], overrides: Readonly<{ expectedVersion?: number }> = {}): IdentityGateAnswerRequest {
  return IdentityGateAnswerRequestSchema.parse({
    commandId: uuidOf(31),
    family: "gate",
    type: "answer-identity-gate",
    requestedBy: "local-operator",
    requestedAt: NOW,
    source: "run-detail",
    target: { runId: value.runId, gateId: "identity-approval", expectedVersion: overrides.expectedVersion ?? value.expectedVersion },
    payload,
  });
}

function accepted(resolution: ReturnType<typeof resolveIdentityGateAnswer>): CommandRequest {
  if (resolution.state !== "accepted") throw new Error(`answer refused: ${resolution.code} ${resolution.message}`);
  return resolution.request;
}

function resolvedValue(command: CommandRequest) {
  assert.ok(command.family === "gate" && command.type === "resolve-gate");
  return IdentityApprovalResultSchema.parse(command.payload.result.value);
}

describe("the identity-gate run-detail section (ref write-safety §14.4)", () => {
  it("serves the opened gate's native event order without deriving it from the park time", async () => {
    const w = await world(); seed(w);
    const run = w.authority.getRun(RUN_ID); assert.ok(run);
    putCheckpoint(w, checkpointOf(packetOf()));
    const record = TimelineEventRecordSchema.parse({ schemaVersion: 1,
      eventId: uuidOf(9801), cursor: w.timeline.highWaterMark() + 1, workflow: IDENTITY_DESCRIPTOR.id,
      scope: { kind: "run", runId: RUN_ID }, occurredAt: NOW, recordedAt: NOW, retentionDate: "2026-08-12",
      source: { kind: "native" }, payload: { kind: "span", event: { t: "gate.opened", ts: NOW, pid: 4242,
        workflow: IDENTITY_DESCRIPTOR.id, runId: RUN_ID, attempt: 1, traceId: run.envelope.traceId,
        spanPath: run.envelope.traceId, gate: "identity-approval" } } });
    const deps = depsOf(w);
    const section = gateSection(w, { ...deps, timeline: { ...w.timeline, highWaterMark: () => record.cursor,
      page: request => [...w.timeline.page(request), ...(Number(request.after ?? 0) < record.cursor ? [record] : [])],
    } });
    assert.equal(section.state, "available");
    if (section.state !== "available") throw new Error("gate unavailable");
    assert.equal(section.value.order, record.cursor);
  });

  it("advertises the section for a parked-gate run and for no other lifecycle", async () => {
    const w = await world();
    seed(w);
    const detail = buildRunDetail(depsOf(w), RUN_ID);
    assert.ok(detail.availableSections.includes("identity-gate"));

    assert.equal(detail.header.status, "awaiting-approval");

    const queued = await world();
    seed(queued, { lifecycle: { state: "queued" } });
    assert.ok(!availableSections(
      queued.projection.runFold(RUN_ID) ?? (() => { throw new Error("no fold"); })(),
      queued.authority.getRun(RUN_ID) ?? (() => { throw new Error("no run"); })(),
    ).includes("identity-gate"));
  });

  it("serves the review authority stored as display text, with the refs an answer must carry", async () => {
    const w = await world();
    seed(w);
    const packet = packetOf();
    putCheckpoint(w, checkpointOf(packet));

    const payload = gateSection(w);
    assert.equal(payload.state, "available");
    if (payload.state !== "available") throw new Error("unreachable");
    const { value } = payload;
    assert.equal(value.runId, RUN_ID);
    assert.equal(value.expectedVersion, 4);
    assert.equal(value.label, "Identity Approval");
    assert.equal(value.parkedAt, NOW);
    assert.match(value.gateRef, /^[0-9a-f-]{36}$/u);
    assert.equal(value.reason, IDENTITY_REVIEW_TEXT.reason.eid);
    assert.deepEqual(value.comparisons.map(({ label }) => label), packet.comparisons.map(({ field }) => IDENTITY_REVIEW_TEXT.label[field]));
    assert.deepEqual(value.comparisons.map(({ agrees }) => agrees), packet.comparisons.map(({ agrees }) => agrees));
    assert.deepEqual(value.options.map(({ displayName, maskedEid, origin }) => ({ displayName, maskedEid, origin })),
      [{ displayName: packet.ucpathName, maskedEid: "••••3507", origin: IDENTITY_REVIEW_TEXT.origin["name-resolved"] }]);
    assert.equal(packet.approvalShape, "type-the-eid");
    assert.equal(value.approvalShape, "one-click");
    assert.equal(value.actions[0]?.label, "Approve this person");
    const approve = value.actions[0];
    assert.ok(approve?.kind === "command" && approve.confirm, "the presentation still requires fresh operator confirmation");
    assert.equal(IdentityGateDetailWireSchema.safeParse({ ...value, approvalShape: "choose-a-candidate" }).success, false);
  });

  it("reads a pre-existing typed-risk approved subject without rewriting its packet or digest", async () => {
    const w = await world();
    seed(w);
    const packet = packetOf();
    const evidenceDigest = deriveIdentityEvidenceDigest(packet);
    const subject = ApprovedIdentitySubjectSchema.parse({ authority: "operator-approval", emplId: packet.emplId,
      chosenFrom: "checked", evidenceDigest, ucpathName: packet.ucpathName, nameTier: packet.nameTier, approvalShape: "type-the-eid" });
    const storedOutput = VerifyIdentityApprovalOutputSchema.parse({ documentNumber: packet.documentNumber, approved: subject, jobs: packet.jobs });
    putCheckpoint(w, checkpointOf(packet));
    const payload = gateSection(w);
    assert.equal(payload.state, "available");
    if (payload.state !== "available") throw new Error("gate unavailable");
    assert.equal(payload.value.approvalShape, "one-click");
    const answered = accepted(resolveIdentityGateAnswer(depsOf(w), answerOf(payload.value, { decision: "approved", gateRef: payload.value.gateRef, optionRef: optionRefOf(payload.value) }), undefined));
    assert.equal(resolvedValue(answered).evidenceDigest, evidenceDigest);
    assert.deepEqual(VerifyIdentityApprovalOutputSchema.parse(JSON.parse(JSON.stringify(storedOutput))), storedOutput);
    assert.equal(storedOutput.approved.authority, "operator-approval");
    assert.equal(storedOutput.approved.evidenceDigest, evidenceDigest);
    assert.equal(deriveIdentityEvidenceDigest(packet), evidenceDigest);
  });

  it("resolves an approval to the exact gate-result schema hash the kernel will demand", async () => {
    const w = await world();
    seed(w);
    const packet = packetOf();
    putCheckpoint(w, checkpointOf(packet));
    const { value } = available(gateSection(w));

    const command = accepted(resolveIdentityGateAnswer(depsOf(w),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: optionRefOf(value) }), undefined));
    assert.equal(command.type, "resolve-gate");
    assert.equal(command.family === "gate" ? command.payload.result.schemaHash : undefined, RESULT_SCHEMA_HASH);
    assert.deepEqual(command.target, { runId: RUN_ID, gateId: "identity-approval", expectedVersion: 4 });
    // The value the kernel will parse through the descriptor's gate schema.
    assert.deepEqual(resolvedValue(command), { decision: "approved", eid: EID, chosenFrom: "checked", evidenceDigest: deriveIdentityEvidenceDigest(packet) });
  });

  it("labels every option with the choice the post-gate node will verify", async () => {
    const w = await world();
    seed(w);
    const packet = packetOf({ differentName: true });
    putCheckpoint(w, checkpointOf(packet));
    const { value } = available(gateSection(w));
    assert.deepEqual(
      value.options.map(({ displayName, maskedEid }) => ({ displayName, maskedEid })),
      [{ displayName: packet.ucpathName, maskedEid: "••••3507" }],
    );
    assert.deepEqual(resolvedValue(accepted(resolveIdentityGateAnswer(depsOf(w),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: optionRefOf(value) }), undefined))),
    { decision: "approved", eid: EID, chosenFrom: "checked", evidenceDigest: deriveIdentityEvidenceDigest(packet) });
    // One candidate is a confirm even when the names differ; the confirm turns destructive instead.
    assert.equal(value.approvalShape, "one-click");
    assert.deepEqual(
      value.actions.map((action) => action.kind === "command" ? action.resolution : undefined),
      ["approved", "rejected"],
    );
    const approve = value.actions[0];
    assert.equal(approve?.kind === "command" ? approve.confirm?.tone : undefined, "destructive");
    // D1: one candidate is approve or reject, both the served gate actions, with the declared arm text; the reason is the declared one.
    const rejected = resolvedValue(accepted(resolveIdentityGateAnswer(depsOf(w), answerOf(value, { decision: "rejected", gateRef: value.gateRef }), undefined)));
    assert.deepEqual(rejected, { decision: "rejected", reason: "Rejected in Logs", evidenceDigest: deriveIdentityEvidenceDigest(packet) });
    assert.deepEqual(value.decision?.options.map(({ id, label, send, recommended }) => [id, label, send, recommended]), [
      ["approve", "Approve match", { via: "action", actionKey: "resolve-gate-approved" }, true],
      ["reject", "Reject match", { via: "action", actionKey: "resolve-gate-rejected" }, undefined],
    ]);
    assert.deepEqual(value.decision?.options.map(({ confirm }) => confirm), [approve?.kind === "command" ? approve.confirm : undefined, undefined]);
  });


  it("pins the mock fixture's gate descriptors and option labels to this query's", async () => {
    for (const fixture of [FIXTURE_IDENTITY_GATE, FIXTURE_IDENTITY_GATE_NAME_MISMATCH]) {
      const w = await world();
      seed(w, { version: fixture.expectedVersion });
      // The fixture serves no packet; rebuild the one its builder composes from the served name rows and checked Employee ID.
      const names = fixture.comparisons.find(({ label }) => label === IDENTITY_REVIEW_TEXT.label.name);
      assert.ok(names);
      putCheckpoint(w, checkpointOf(packetOf({ eid: FIXTURE_GATE_CHECKED_EID, documentName: names.request, ucpathName: names.ucpath })));
      const payload = gateSection(w);
      if (payload.state !== "available") throw new Error("unreachable");

      assert.equal(payload.value.label, fixture.label);
      assert.equal(payload.value.expectedVersion, fixture.expectedVersion);
      assert.equal(payload.value.reason, fixture.reason);
      assert.deepEqual(payload.value.comparisons.map(({ label, agrees }) => ({ label, agrees })), fixture.comparisons.map(({ label, agrees }) => ({ label, agrees })));
      assert.deepEqual(payload.value.options.map(({ displayName, maskedEid, origin }) => ({ displayName, maskedEid, origin })),
        fixture.options.map(({ displayName, maskedEid, origin }) => ({ displayName, maskedEid, origin })));
      assert.equal(payload.value.approvalShape, fixture.approvalShape);
      const decision = payload.value.decision;
      if (fixture.approvalShape === "choose-a-candidate") {
        // D2: the pick table rows are the served options, keyed by their opaque refs; without a declared gate correction there is no fill row.
        assert.equal(decision?.type, "pick-person");
        const confirm = decision?.options.find(({ id }) => id === "confirm");
        const table = confirm?.input?.kind === "candidate" ? confirm.input.table : undefined;
        assert.deepEqual(table?.rows.map(({ id }) => id), payload.value.options.map(({ ref }) => ref));
        assert.deepEqual(table?.rows.map(row => row.cells.find(({ columnId }) => columnId === "eid")?.value), payload.value.options.map(({ maskedEid }) => maskedEid));
        const approve = payload.value.actions.find(action => action.kind === "command" && action.resolution === "approved");
        assert.deepEqual(confirm?.confirm, approve?.kind === "command" ? approve.confirm : undefined);
        assert.equal(table?.typed, undefined);
        assert.equal(payload.value.correction, undefined);
        const cancelKey = w.projection.queueSurface(RUN_ID)?.actions.find(action => action.kind === "command" && action.command === "cancel")?.key;
        assert.deepEqual(decision?.options.find(({ id }) => id === "cancel-run")?.send, cancelKey === undefined ? undefined : { via: "row-action", actionKey: cancelKey });
      } else {
        assert.equal(decision?.type, "identity-mismatch");
      }
      assert.deepEqual(
        JSON.parse(JSON.stringify(payload.value.actions)) as unknown,
        JSON.parse(JSON.stringify(fixture.actions)) as unknown,
      );
    }
  });

  it("answers `missing` with the one closed sentence rather than a half panel", async () => {
    // (a) no registered descriptor at all.
    const noDescriptor = await world();
    seed(noDescriptor);
    const a = gateSection(noDescriptor, depsOf(noDescriptor, null));
    assert.equal(a.state, "missing");
    assert.equal(a.state === "missing" ? a.reason : "", IDENTITY_REVIEW_TEXT.unavailable);

    // The packet endpoint cannot fall back to its coarse item-latest reader if
    // the canonical checkpoint and timeline authority are unavailable.
    const noCanonical = await world();
    seed(noCanonical);
    putCheckpoint(noCanonical, checkpointOf(packetOf()));
    const noAuthority = gateSection(noCanonical, depsOf(noCanonical, GATE_NODES, false));
    assert.equal(noAuthority.state, "missing");
    assert.equal(noAuthority.state === "missing" ? noAuthority.reason : "", IDENTITY_REVIEW_TEXT.unavailable);

    // (b) the build declares no such gate.
    const wrongGate = await world();
    seed(wrongGate);
    const b = gateSection(wrongGate, depsOf(wrongGate, [{
      ...GATE_NODES[0], nodeId: "some-other-gate",
    }]));
    assert.equal(b.state, "missing");
    assert.equal(b.state === "missing" ? b.reason : "", IDENTITY_REVIEW_TEXT.unavailable);

    // (c) the gate exists and its evidence node stored nothing.
    const noPacket = await world();
    seed(noPacket);
    const c = gateSection(noPacket);
    assert.equal(c.state, "missing");
    assert.equal(c.state === "missing" ? c.reason : "", IDENTITY_REVIEW_TEXT.unavailable);

    // A separately stored checkpoint without its timeline link is not enough
    // to authorize a packet, and the fixture keeps that event independent.
    const noEvent = await world();
    seed(noEvent);
    const stored = putCheckpoint(noEvent, checkpointOf(packetOf()));
    checkpointEvents.get(noEvent)?.delete(stored.eventId);
    const missingLink = gateSection(noEvent);
    assert.equal(missingLink.state, "missing");
    assert.equal(missingLink.state === "missing" ? missingLink.reason : "", IDENTITY_REVIEW_TEXT.unavailable);


    const changedBinding = await world();
    seed(changedBinding);
    const altered = RunCheckpointRecordSchema.parse({
      ...checkpointOf(packetOf()),
      implFingerprint: HASH,
    });
    putCheckpoint(changedBinding, altered);
    const d = gateSection(changedBinding);
    assert.equal(d.state, "missing");
    assert.equal(d.state === "missing" ? d.reason : "", IDENTITY_REVIEW_TEXT.unavailable);
  });

  it("refuses to serve a historical supplied-EID park as a current operator decision", async () => {
    const w = await world();
    seed(w);
    putCheckpoint(w, checkpointOf(packetOf({ source: "document-eid" })));
    const payload = gateSection(w);
    assert.equal(payload.state, "missing");
    assert.equal(payload.state === "missing" ? payload.reason : "", IDENTITY_REVIEW_TEXT.unavailable);
  });

  it("refuses to serve the section for a run that is not parked on a gate", async () => {
    const w = await world();
    seed(w, { lifecycle: { state: "queued" } });
    assert.throws(
      () => buildRunSection(depsOf(w), RUN_ID, "identity-gate"),
      /section identity-gate is not available/,
    );
  });
});

const SEARCH_EID = "10800001";

async function chooseWorld() {
  const w = await world();
  seed(w);
  const packet = packetOf({ searchEid: SEARCH_EID });
  putCheckpoint(w, checkpointOf(packet));
  const { value } = available(gateSection(w));
  assert.equal(value.options.length, 2);
  return { w, packet, value, digest: deriveIdentityEvidenceDigest(packet) };
}

describe("the served identity review keeps evidence off the wire", () => {
  it("serves no full Employee ID, digest, node id, packet or comparison note", async () => {
    for (const packet of [packetOf(), packetOf({ searchEid: SEARCH_EID, differentName: true })]) {
      const w = await world();
      seed(w);
      putCheckpoint(w, checkpointOf(packet));
      const { value } = available(gateSection(w));
      const wire = JSON.stringify(value);
      assert.doesNotMatch(wire, /(?<![0-9a-f])10\d{6}(?![0-9a-f])/u);
      for (const eid of packet.approvableEids) assert.ok(!wire.includes(String(eid)), `full EID ${String(eid)} is served`);
      assert.doesNotMatch(wire, /[0-9a-f]{64}/u);
      assert.ok(!wire.includes(deriveIdentityEvidenceDigest(packet)));
      assert.ok(!wire.includes('"gateId"'));
      assert.ok(!wire.includes("identity-approval"));
      assert.ok(!wire.includes('"packet"'));
      for (const { note } of packet.comparisons) assert.ok(note.length === 0 || !wire.includes(note), `note ${note} is served`);
      for (const fragment of ["(S1", "T00"]) assert.ok(!wire.includes(fragment), `${fragment} is served`);
    }
  });

  it("serves option refs that the served gate ref and masked last four digits cannot reverse to an Employee ID", async () => {
    const { packet, value } = await chooseWorld();
    for (const eid of packet.approvableEids.map(String)) {
      const option = value.options.find(candidate => candidate.maskedEid === `••••${eid.slice(-4)}`);
      assert.ok(option !== undefined);
      assert.notEqual(option.ref, deriveStableUuid("identity-gate-option", canonicalJsonStringify([value.gateRef, eid])));
      assert.ok(value.decision?.options.every(decision => decision.input?.kind !== "candidate"
        || decision.input.table.rows.every(row => row.id !== deriveStableUuid("identity-gate-option", canonicalJsonStringify([value.gateRef, eid])))));
    }
  });
});

describe("resolving an identity answer", () => {
  it("refuses a stale gate ref, a stale version and an unknown option ref", async () => {
    const { w, value } = await chooseWorld();
    const optionRef = optionRefOf(value);
    const refusals = [
      answerOf(value, { decision: "approved", gateRef: uuidOf(77), optionRef }),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef }, { expectedVersion: value.expectedVersion + 1 }),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: uuidOf(78) }),
      answerOf(value, { decision: "rejected", gateRef: uuidOf(77) }),
    ];
    for (const answer of refusals) {
      const resolution = resolveIdentityGateAnswer(depsOf(w), answer, undefined);
      assert.equal(resolution.state, "refused");
      assert.equal(resolution.state === "refused" ? resolution.code : undefined, "invalid-state");
    }
  });

  it("resolves a pick by option ref to that candidate's eid and provenance", async () => {
    const { w, packet, value, digest } = await chooseWorld();
    assert.equal(value.approvalShape, "choose-a-candidate");
    const byMask = (masked: string): string => value.options.find(option => option.maskedEid === masked)?.ref ?? "";
    const checked = resolvedValue(accepted(resolveIdentityGateAnswer(depsOf(w),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: byMask(`••••${EID.slice(-4)}`) }), undefined)));
    assert.deepEqual(checked, { decision: "approved", eid: EID, chosenFrom: "checked", evidenceDigest: digest });
    const searched = accepted(resolveIdentityGateAnswer(depsOf(w),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: byMask(`••••${SEARCH_EID.slice(-4)}`) }), undefined));
    assert.deepEqual(resolvedValue(searched), { decision: "approved", eid: SEARCH_EID, chosenFrom: "name-search", evidenceDigest: digest });
    assert.equal(searched.family === "gate" ? searched.payload.result.schemaHash : undefined, RESULT_SCHEMA_HASH);
    assert.equal(digest, deriveIdentityEvidenceDigest(packet));
  });

  it("never answers the gate with a typed Employee ID, even one that names a found candidate", async () => {
    const { value } = await chooseWorld();
    for (const typedEid of [SEARCH_EID, EID, "10000000"]) {
      assert.equal(IdentityGateAnswerRequestSchema.safeParse({ ...answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: optionRefOf(value) }),
        payload: { decision: "approved", gateRef: value.gateRef, typedEid } }).success, false);
    }
  });

  it("resolves a one-click approval and a rejection to canonical resolve-gate commands", async () => {
    const w = await world();
    seed(w);
    const packet = packetOf();
    putCheckpoint(w, checkpointOf(packet));
    const { value } = available(gateSection(w));
    const digest = deriveIdentityEvidenceDigest(packet);
    const approved = accepted(resolveIdentityGateAnswer(depsOf(w),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: optionRefOf(value) }), undefined));
    assert.deepEqual(resolvedValue(approved), { decision: "approved", eid: EID, chosenFrom: "checked", evidenceDigest: digest });
    const rejected = accepted(resolveIdentityGateAnswer(depsOf(w), answerOf(value, { decision: "rejected", gateRef: value.gateRef }), undefined));
    assert.deepEqual(resolvedValue(rejected), { decision: "rejected", reason: "Rejected in Logs", evidenceDigest: digest });
    for (const command of [approved, rejected]) {
      assert.equal(command.family === "gate" ? command.payload.result.schemaHash : undefined, RESULT_SCHEMA_HASH);
      assert.equal(command.commandId, uuidOf(31));
    }
  });

  it("replays the journaled command unchanged and refuses a different answer under the same command id", async () => {
    const { w, value } = await chooseWorld();
    const answer = answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: optionRefOf(value, 0) });
    const journaled = accepted(resolveIdentityGateAnswer(depsOf(w), answer, undefined));
    const replay = resolveIdentityGateAnswer(depsOf(w), answer, journaled);
    assert.equal(replay.state, "accepted");
    assert.deepEqual(replay.state === "accepted" ? replay.request : undefined, journaled);
    const different = resolveIdentityGateAnswer(depsOf(w),
      answerOf(value, { decision: "approved", gateRef: value.gateRef, optionRef: optionRefOf(value, 1) }), journaled);
    assert.equal(different.state, "refused");
    assert.equal(different.state === "refused" ? different.code : undefined, "command-divergent");
    const flipped = resolveIdentityGateAnswer(depsOf(w), answerOf(value, { decision: "rejected", gateRef: value.gateRef }), journaled);
    assert.equal(flipped.state === "refused" ? flipped.code : undefined, "command-divergent");
  });
});

const SEPARATIONS_GATE_NODES = [{ ...GATE_NODES[0], dependsOn: descriptorRuntimeNodes(separationsDescriptor)
  .flatMap(node => node.kind === "gate" && String(node.id) === "identity-approval" ? node.dependsOn.map(String) : []) }];

describe("the typed Employee ID lookup served with the Separations pick-person gate", () => {
  async function separationsWorld(packet: IdentityEvidencePacket, attempting: readonly unknown[] = []) {
    const w = await world();
    seed(w, { descriptor: separationsDescriptor });
    putCheckpoint(w, checkpointOf(packet, "comparison", separationsDescriptor));
    const deps = depsOf(w, SEPARATIONS_GATE_NODES, true, separationsDescriptor, attempting);
    return { w, value: available(gateSection(w, deps)).value };
  }
  const confirmTable = (value: ServedGate) => {
    const input = value.decision?.options.find(({ id }) => id === "confirm")?.input;
    return input?.kind === "candidate" ? input.table : undefined;
  };

  it("serves the typed row and the one-field rerun request for several candidates", async () => {
    const { w, value } = await separationsWorld(packetOf({ searchEid: SEARCH_EID }));
    const run = w.authority.getRun(RUN_ID);
    assert.ok(run);
    const keys = separationsDescriptor.timeline.filter(step => !run.envelope.stepOmissions?.some(omission => omission.step === step.key)).map(step => step.key);
    assert.equal(value.decision?.type, "pick-person");
    assert.deepEqual(confirmTable(value)?.typed, { label: "Employee ID", placeholder: "8 digits", pattern: "^10\\d{6}$", lookup: true });
    assert.deepEqual(value.correction, { inputField: "operatorEmployeeId", label: "Employee ID", placeholder: "8 digits", pattern: "^10\\d{6}$",
      expectedVersion: 4, confirm: { ...IDENTITY_REVIEW_TEXT.lookup, tone: "neutral" },
      request: { workflowId: "separations",
        rerunSource: { runId: RUN_ID, expectedVersion: 4, intent: "rerun", selectedStepKeys: keys,
          gateCorrection: { gateId: "identity-approval", inputField: "operatorEmployeeId" } },
        submissions: [{}], selectedStepKeys: keys, dryRun: run.envelope.dryRun, browserMode: run.envelope.browserMode ?? "headless",
        captureBrowserScreenshots: run.envelope.captureBrowserScreenshots ?? false, priority: run.envelope.priority } });
    assert.ok(keys.length > 0);
    assert.equal(IdentityGateDetailWireSchema.safeParse(value).success, true);
    assert.deepEqual(value.correction?.request.submissions, [{}]);
    for (const eid of [EID, SEARCH_EID]) assert.equal(JSON.stringify(value).includes(eid), false, `full EID ${eid} is served`);
  });

  it("serves no typed row or correction for one candidate", async () => {
    const { value } = await separationsWorld(packetOf());
    assert.equal(value.decision?.type, "identity-mismatch");
    assert.equal(JSON.stringify(value.decision).includes("typed"), false);
    assert.equal(value.correction, undefined);
  });

  it.each([
    { search: "matches the entered ID", searchEid: undefined, ucpathName: undefined },
    { search: "resolves an old candidate", searchEid: SEARCH_EID, ucpathName: undefined },
    { search: "matches the entered ID, whose UCPath name differs from the form", searchEid: undefined, ucpathName: "Okafor, Adaeze" },
  ])("serves the replacement run's park with one option, Approve and Reject, and no typed row when the name search $search", async ({ searchEid, ucpathName }) => {
    const typed = "10800002";
    const packet = packetOf({ eid: typed, source: "operator-entered", ...(searchEid === undefined ? {} : { searchEid }), ...(ucpathName === undefined ? {} : { ucpathName }) });
    const { value } = await separationsWorld(packet);
    assert.deepEqual(packet.approvableEids, [typed]);
    if (searchEid !== undefined) {
      const forged = IdentityApprovalResultSchema.parse({ decision: "approved", eid: searchEid, chosenFrom: "name-search", evidenceDigest: deriveIdentityEvidenceDigest(packet) });
      const refusal = verifyIdentityApproval(packet, forged);
      assert.equal(refusal.state === "refused" ? refusal.code : refusal.state, "identity-approval-eid-not-shown");
    }
    assert.equal(value.options.length, 1);
    assert.equal(value.decision?.type, "identity-mismatch");
    assert.deepEqual(value.decision?.options.map(({ id }) => id), ["approve", "reject"]);
    assert.equal(JSON.stringify(value.decision).includes("typed"), false);
    assert.equal(value.correction, undefined);
    assert.equal(value.reason, IDENTITY_REVIEW_TEXT.reason["eid-entered"]);
    assert.equal(JSON.stringify(value).includes(typed), false, "the typed EID is served in full");
    assert.match(JSON.stringify(value), /••••0002/u);
  });

  it("serves the candidates but no typed row or correction while a write intent is attempting", async () => {
    const { value } = await separationsWorld(packetOf({ searchEid: SEARCH_EID }), [{ intentId: uuidOf(77) }]);
    assert.equal(value.decision?.type, "pick-person");
    assert.equal(value.options.length, 2);
    assert.equal(confirmTable(value)?.rows.length, 2);
    assert.equal(confirmTable(value)?.typed, undefined);
    assert.equal(value.correction, undefined);
  });
});
