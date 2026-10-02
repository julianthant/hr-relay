/**
 * The identity-approval gate run-detail section (ref write-safety §14.4; separations §3's
 * chunk-3 directive, "a command arm plus wire state ONLY").
 *
 * The approval UI is a later slice, so what this suite pins is the whole SERVER
 * half a frontend will bind to without any further server change: the section is
 * advertised exactly when a run is parked on a gate, the packet it serves is the
 * one authority stored rather than one this query composed, the schema hash it
 * publishes is the exact value the command kernel will demand, and every way the
 * composition can fail to describe the gate is a `missing` with a reason instead
 * of a half panel an operator could act on.
 *
 * The last property is the one that matters most. A gate section is the surface
 * on which somebody authorises a real termination against a named human; a panel
 * that renders with the evidence quietly absent is strictly worse than no panel.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { CommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { MatchIdentityOutputSchema } from "../../../../../../src/models/workflows/separations/match-identity.js";
import { deriveSchemaHash } from "../../../../../../src/models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../../../../src/rules/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../../../../src/rules/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../../../../src/rules/separations/identity-evidence.js";
import {
  checkpointLookupKey,
  RunCheckpointRecordSchema,
  type RunCheckpointRecord,
} from "../../../../../../src/models/workflow/checkpoint.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../../../src/workflow-kit/validation/build-manifest.js";
import { deriveStableUuid } from "../../../../../../src/rules/identity/identifiers.js";
import { timelineCheckpointReference } from "../../../../../../src/models/events/timeline.js";
import { descriptorRuntimeNodes } from "../../../../../../src/workflow-kit/workflow.js";
import { separationsIdentityCheckModule } from "../../../../../../src/backend/app/registries/step-proof-modules.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { deriveJobRowFromCells } from "../../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import {
  availableSections,
  buildRunDetail,
  buildRunSection,
  type RunDetailQueryDeps,
} from "../../../../../../src/backend/runs/queries/run-detail.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../../support/helpers/backend/dashboard-harness.js";
import { noSeparationWritePlan } from "../../../../../../src/rules/separations/write-plan.js";
import {
  FIXTURE_IDENTITY_GATE,
  FIXTURE_IDENTITY_GATE_TYPED_EID,
} from "../../../../../support/fixtures/dashboard/fixture-day.js";
import { fixtureIdentityGateActions } from "../../../../../support/fixtures/dashboard/fixture-gate.js";

const worlds: DashboardWorld[] = [];
const checkpointEvents = new WeakMap<DashboardWorld, Map<string, unknown>>();
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  checkpointEvents.set(created, new Map());
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
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
  source?: "name-resolved" | "document-eid";
}> = {}): IdentityEvidencePacket {
  const source = overrides.source ?? "name-resolved";
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: overrides.differentName === true ? "Hernandez, Maria" : "Hernandez, Jose Santos",
    documentEidText: source === "document-eid" ? EID : "the separation document carried no EID",
    emplIdSource: source,
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
        name: overrides.differentName === true ? "Hernandez, Maria" : "Hernandez, Jose Santos",
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

function checkpointOf(packet: IdentityEvidencePacket, nodeId = "comparison"): RunCheckpointRecord {
  const task = descriptorRuntimeNodes(IDENTITY_DESCRIPTOR)
    .find((node) => node.kind === "task" && String(node.id) === nodeId);
  if (task === undefined || task.kind !== "task") throw new Error(`identity checkpoint task ${nodeId} is absent`);
  const value = MatchIdentityOutputSchema.parse({
    packet,
    evidenceDigest: deriveIdentityEvidenceDigest(packet),
  });
  return RunCheckpointRecordSchema.parse({
    workflowId: IDENTITY_DESCRIPTOR.id,
    itemId: runRecordOf({ seed: 1 }).envelope.itemId,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: RUN_ID,
    output: { schemaHash: deriveSchemaHash(task.uses.output, "output"), value },
    descriptorVersion: IDENTITY_DESCRIPTOR.version,
    contractFingerprint: IDENTITY_DESCRIPTOR.contractFingerprint,
    implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, task.uses.id),
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
): RunDetailQueryDeps {
  const timelineEvents = {
    get: (eventId: string) => checkpointEvents.get(w)?.get(eventId),
  };
  const canonical = {
    reader: w.runReader,
    descriptors: {
      resolve: (workflowId: string) => String(IDENTITY_DESCRIPTOR.id) === workflowId ? IDENTITY_DESCRIPTOR : undefined,
    },
    database: {
      authority: {
        runCheckpoints: {
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
    stateRoot: w.stateRoot,
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

function seed(w: DashboardWorld, input?: Readonly<{ lifecycle?: unknown; version?: number }>): void {
  queuedEventOf(w, {
    seed: 1,
    workflow: String(IDENTITY_DESCRIPTOR.id),
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
      descriptorVersion: IDENTITY_DESCRIPTOR.version,
      contractFingerprint: IDENTITY_DESCRIPTOR.contractFingerprint,
    },
  }));
}

function gateSection(w: DashboardWorld, deps = depsOf(w)) {
  const response = buildRunSection(deps, RUN_ID, "identity-gate");
  if (response.section !== "identity-gate") throw new Error("wrong section");
  return response.payload;
}

describe("the identity-gate run-detail section (ref write-safety §14.4)", () => {
  it("advertises the section for a parked-gate run and for no other lifecycle", () => {
    const w = world();
    seed(w);
    const detail = buildRunDetail(depsOf(w), RUN_ID);
    assert.ok(detail.availableSections.includes("identity-gate"));
    // The coarse queue status stays what it already was; the section is what
    // makes the decision addressable.
    assert.equal(detail.header.status, "awaiting-approval");

    const queued = world();
    seed(queued, { lifecycle: { state: "queued" } });
    assert.ok(!availableSections(
      queued.projection.runFold(RUN_ID) ?? (() => { throw new Error("no fold"); })(),
      queued.authority.getRun(RUN_ID) ?? (() => { throw new Error("no run"); })(),
    ).includes("identity-gate"));
  });

  it("serves the packet authority stored, with the digest an approval must carry", () => {
    const w = world();
    seed(w);
    const packet = packetOf();
    putCheckpoint(w, checkpointOf(packet));

    const payload = gateSection(w);
    assert.equal(payload.state, "available");
    if (payload.state !== "available") throw new Error("unreachable");
    const { value } = payload;
    assert.equal(value.runId, RUN_ID);
    assert.equal(value.gateId, "identity-approval");
    assert.equal(value.resumeAt, "approval");
    assert.equal(value.expectedVersion, 4);
    assert.deepEqual(value.packet, packet);
    assert.equal(value.evidenceDigest, deriveIdentityEvidenceDigest(packet));
    assert.equal(value.approvalShape, packet.approvalShape);
  });

  it("publishes the exact gate-result schema hash the kernel will demand", () => {
    const w = world();
    seed(w);
    putCheckpoint(w, checkpointOf(packetOf()));
    const payload = gateSection(w);
    if (payload.state !== "available") throw new Error("unreachable");
    assert.equal(payload.value.resultSchemaHash, RESULT_SCHEMA_HASH);

    // And a command built straight off this payload parses through the kernel's
    // own request schema unchanged — which is what "no further server change"
    // means for the approval surface.
    const command = CommandRequestSchema.parse({
      commandId: uuidOf(31),
      family: "gate",
      type: "resolve-gate",
      requestedBy: "local-operator",
      requestedAt: NOW,
      source: "run-detail",
      target: {
        runId: payload.value.runId,
        gateId: payload.value.gateId,
        expectedVersion: payload.value.expectedVersion,
      },
      payload: {
        result: {
          schemaHash: payload.value.resultSchemaHash,
          value: {
            decision: "approved",
            eid: payload.value.options[0]?.eid,
            chosenFrom: payload.value.options[0]?.chosenFrom,
            evidenceDigest: payload.value.evidenceDigest,
          },
        },
      },
    });
    assert.equal(command.type, "resolve-gate");
    // The value the kernel will parse through the descriptor's gate schema.
    assert.deepEqual(
      IdentityApprovalResultSchema.parse(
        command.family === "gate" ? command.payload.result.value : undefined,
      ).decision,
      "approved",
    );
  });

  it("labels every option with the choice the post-gate node will verify", () => {
    const w = world();
    seed(w);
    const packet = packetOf({ differentName: true });
    putCheckpoint(w, checkpointOf(packet));
    const payload = gateSection(w);
    if (payload.state !== "available") throw new Error("unreachable");
    assert.deepEqual(
      payload.value.options.map(({ eid, chosenFrom }) => ({ eid, chosenFrom })),
      [{ eid: EID, chosenFrom: "checked" }],
    );
    // A name-resolved EID requires the explicit typed-EID ceremony even when
    // the search returned exactly one candidate.
    assert.equal(payload.value.approvalShape, "type-the-eid");
    assert.equal(payload.value.actions.length, 2);
    assert.deepEqual(
      payload.value.actions.map((action) => action.kind === "command" ? action.resolution : undefined),
      ["approved", "rejected"],
    );
    const approve = payload.value.actions[0];
    assert.equal(approve?.kind === "command" ? approve.confirm?.tone : undefined, "destructive");
  });

  /**
   * The parity corpus's adapter #1 AUTHORS this section — it holds no authority
   * rows to derive one from — so its option mapping and its two `resolve-gate`
   * descriptors are a COPY of the ones this query builds. A copy nobody
   * compares is a reference that documents last month's copy.
   *
   * The comparison is EXACT rather than normalized, because it can be: the
   * server is seeded with the fixture's own packet, so every interpolated name,
   * document number and disagreement list is the same on both sides. Only the
   * run version differs, and the fixture's copy is asked for the one the query
   * served rather than pinned to a seed.
   */
  it("pins the parity fixture's gate descriptors and option labels to this query's", () => {
    for (const fixture of [FIXTURE_IDENTITY_GATE, FIXTURE_IDENTITY_GATE_TYPED_EID]) {
      const w = world();
      seed(w);
      putCheckpoint(w, checkpointOf(fixture.packet));
      const payload = gateSection(w);
      if (payload.state !== "available") throw new Error("unreachable");

      assert.deepEqual(payload.value.options, fixture.options);
      assert.equal(payload.value.approvalShape, fixture.approvalShape);
      assert.deepEqual(
        JSON.parse(JSON.stringify(payload.value.actions)) as unknown,
        JSON.parse(JSON.stringify(
          fixtureIdentityGateActions(fixture.packet, payload.value.expectedVersion),
        )) as unknown,
      );
    }
  });

  it("answers `missing` with a reason rather than a half panel", () => {
    // (a) no registered descriptor at all.
    const noDescriptor = world();
    seed(noDescriptor);
    const a = gateSection(noDescriptor, depsOf(noDescriptor, null));
    assert.equal(a.state, "missing");
    assert.match(a.state === "missing" ? a.reason : "", /has no registered descriptor/);

    // The packet endpoint cannot fall back to its coarse item-latest reader if
    // the canonical checkpoint and timeline authority are unavailable.
    const noCanonical = world();
    seed(noCanonical);
    putCheckpoint(noCanonical, checkpointOf(packetOf()));
    const noAuthority = gateSection(noCanonical, depsOf(noCanonical, GATE_NODES, false));
    assert.equal(noAuthority.state, "missing");
    assert.match(noAuthority.state === "missing" ? noAuthority.reason : "", /cannot verify checkpoint identity without canonical authority/);

    // (b) the build declares no such gate.
    const wrongGate = world();
    seed(wrongGate);
    const b = gateSection(wrongGate, depsOf(wrongGate, [{
      ...GATE_NODES[0], nodeId: "some-other-gate",
    }]));
    assert.equal(b.state, "missing");
    assert.match(b.state === "missing" ? b.reason : "", /declares no gate "identity-approval"/);

    // (c) the gate exists and its evidence node stored nothing.
    const noPacket = world();
    seed(noPacket);
    const c = gateSection(noPacket);
    assert.equal(c.state, "missing");
    assert.match(c.state === "missing" ? c.reason : "", /0 of them hold an identity decision packet/);

    // A separately stored checkpoint without its timeline link is not enough
    // to authorize a packet, and the fixture keeps that event independent.
    const noEvent = world();
    seed(noEvent);
    const stored = putCheckpoint(noEvent, checkpointOf(packetOf()));
    checkpointEvents.get(noEvent)?.delete(stored.eventId);
    const missingLink = gateSection(noEvent);
    assert.equal(missingLink.state, "missing");
    assert.match(missingLink.state === "missing" ? missingLink.reason : "", /0 of them hold an identity decision packet/);

    // (d) a current-looking checkpoint whose implementation binding no longer
    //     matches the registered task cannot supply the gate's decision packet.
    const changedBinding = world();
    seed(changedBinding);
    const altered = RunCheckpointRecordSchema.parse({
      ...checkpointOf(packetOf()),
      implFingerprint: HASH,
    });
    putCheckpoint(changedBinding, altered);
    const d = gateSection(changedBinding);
    assert.equal(d.state, "missing");
    assert.match(d.state === "missing" ? d.reason : "", /0 of them hold an identity decision packet/);
  });

  it("refuses to serve a historical supplied-EID park as a current operator decision", () => {
    const w = world();
    seed(w);
    putCheckpoint(w, checkpointOf(packetOf({ source: "document-eid" })));
    const payload = gateSection(w);
    assert.equal(payload.state, "missing");
    assert.match(
      payload.state === "missing" ? payload.reason : "",
      /requires an operator decision only for a name-resolved EID/u,
    );
  });

  it("refuses to serve the section for a run that is not parked on a gate", () => {
    const w = world();
    seed(w, { lifecycle: { state: "queued" } });
    assert.throws(
      () => buildRunSection(depsOf(w), RUN_ID, "identity-gate"),
      /section identity-gate is not available/,
    );
  });
});
