/**
 * The identity-approval gate run-detail section (doc 09 §14.4; separations §3's
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
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import { MatchIdentityOutputSchema } from "../../../src/domain/contracts/separations/match-identity.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../src/domain/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../src/domain/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../src/domain/separations/identity-evidence.js";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { deriveJobRowFromCells } from "../../../src/stores/ucpath/driver/person-org-operation.js";
import {
  availableSections,
  buildRunDetail,
  buildRunSection,
  type RunDetailQueryDeps,
} from "../../../src/server/dashboard/queries/run-detail.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const RUN_ID = uuidOf(1);
const NOW = "2026-08-12T18:00:00.000Z";
const EID = "10833507";
const OTHER_EID = "10401814";
const HASH = "a".repeat(64);
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

function packetOf(overrides: Readonly<{ differentName?: boolean }> = {}): IdentityEvidencePacket {
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: overrides.differentName === true ? "Hernandez, Maria" : "Hernandez, Jose Santos",
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
    nameSelection: overrides.differentName === true
      ? {
        status: "resolved",
        selected: {
          emplId: OTHER_EID as never,
          name: "Hernandez, Maria",
          department: "Facilities Management",
          jobTitle: "BLDG MAINT WORKER SR",
          employeeStatus: "active",
          hdh: false,
        },
        candidateEids: [OTHER_EID as never],
      }
      : { status: "not-found", selected: null, candidateEids: [], searchName: "Hernandez, Jose Santos" },
  });
}

function checkpointOf(packet: IdentityEvidencePacket, nodeId = "comparison"): unknown {
  const value = MatchIdentityOutputSchema.parse({
    packet,
    evidenceDigest: deriveIdentityEvidenceDigest(packet),
  });
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: runRecordOf({ seed: 1 }).envelope.itemId,
    nodeId,
    attempt: 1,
    runId: RUN_ID,
    output: { schemaHash: deriveSchemaHash(MatchIdentityOutputSchema, "output"), value },
    descriptorVersion: 1,
    contractFingerprint: HASH,
    implFingerprint: HASH,
    provenance: [],
    writtenAt: NOW,
  });
}

/** `null` means "this build registers no descriptor for the run's workflow". */
function depsOf(
  w: DashboardWorld,
  gateNodes: readonly unknown[] | null = GATE_NODES,
): RunDetailQueryDeps {
  return {
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
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
    version: input?.version ?? 4,
    lifecycle: input?.lifecycle ?? PARKED_GATE_LIFECYCLE,
  });
}

function gateSection(w: DashboardWorld, deps = depsOf(w)) {
  const response = buildRunSection(deps, RUN_ID, "identity-gate");
  if (response.section !== "identity-gate") throw new Error("wrong section");
  return response.payload;
}

describe("the identity-gate run-detail section (doc 09 §14.4)", () => {
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
    w.authority.putCheckpoint(checkpointOf(packet) as never);

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
    w.authority.putCheckpoint(checkpointOf(packetOf()) as never);
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
    w.authority.putCheckpoint(checkpointOf(packet) as never);
    const payload = gateSection(w);
    if (payload.state !== "available") throw new Error("unreachable");
    assert.deepEqual(
      payload.value.options.map(({ eid, chosenFrom }) => ({ eid, chosenFrom })),
      [{ eid: EID, chosenFrom: "checked" }, { eid: OTHER_EID, chosenFrom: "name-search" }],
    );
    // §14.6 risk 1: an ambiguous decision is never a one-click approve.
    assert.equal(payload.value.approvalShape, "type-the-eid");
    assert.equal(payload.value.actions.length, 2);
    assert.deepEqual(
      payload.value.actions.map((action) => action.kind === "command" ? action.resolution : undefined),
      ["approved", "rejected"],
    );
    const approve = payload.value.actions[0];
    assert.equal(approve?.kind === "command" ? approve.confirm?.tone : undefined, "destructive");
  });

  it("answers `missing` with a reason rather than a half panel", () => {
    // (a) no registered descriptor at all.
    const noDescriptor = world();
    seed(noDescriptor);
    const a = gateSection(noDescriptor, depsOf(noDescriptor, null));
    assert.equal(a.state, "missing");
    assert.match(a.state === "missing" ? a.reason : "", /has no registered descriptor/);

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

    // (d) TWO of the gate's dependencies hold a packet: which one the gate is
    //     about is not derivable, and picking one would be a guess.
    const ambiguous = world();
    seed(ambiguous);
    const packet = packetOf();
    ambiguous.authority.putCheckpoint(checkpointOf(packet, "comparison") as never);
    ambiguous.authority.putCheckpoint(checkpointOf(packet, "second") as never);
    const d = gateSection(ambiguous, depsOf(ambiguous, [{
      ...GATE_NODES[0], dependsOn: ["comparison", "second"],
    }]));
    assert.equal(d.state, "missing");
    assert.match(d.state === "missing" ? d.reason : "", /2 of them hold an identity decision packet/);
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
