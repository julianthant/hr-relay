import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { checkpointLookupKey } from "../../../../src/models/workflow/checkpoint.js";
import { deriveStableUuid } from "../../../../src/rules/identity/identifiers.js";
import { BUILD_MANIFEST,resolveTaskImplFingerprint } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { buildRunSection,type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { MatchIdentityOutputSchema,SeparationsMatchIdentity } from "../../../../src/models/workflows/separations/match-identity.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { IdentityApprovalResultSchema } from "../../../../src/rules/separations/identity-approval.js";
import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest
} from "../../../../src/rules/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../../src/rules/separations/write-plan.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { descriptorRuntimeNodes,workflowDryRunSupport } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A,NOW,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import {
makeWorld,
runRecordOf,
uuidOf,
type DashboardWorld,
} from "../../../support/helpers/backend/dashboard-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(NOW));
const EID = "10873698";
const RUN_ID = uuidOf(1);
const GATE_NOW = "2026-08-14T18:00:00.000Z";


const SUBMISSION = Object.freeze({
  documentNumber: "4510",
});

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const worlds: DashboardWorld[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
  for (const world of worlds.splice(0)) world.dispose();
});

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-separations-wire-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  return database;
}

function plan(submissions: readonly unknown[], dryRun = false) {
  return planStart(
    { protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }), authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000 },
    {
      descriptor: separationsDescriptor,
      submissions,
      dryRun,
      priority: "bulk" as const,
      shape: "single" as const,
      configFingerprint: HASH_A,
      configSnapshotId: UUID_4,
      plannedBy: "local-operator",
    },
  );
}

describe("separations — start planning through the existing service", () => {

  it("gives an explicit re-read its OWN item, which is §'the re-run wall' item 2's whole point", () => {
    // Checkpoint keys omit run id, so repeated runs can replay the same item node evidence.
    const planned = plan([
      SUBMISSION,
      { ...SUBMISSION, reRead: { ordinal: 1, reason: "the department corrected the last day worked" } },
    ]);
    assert.equal(planned.planned.length, 2);
    assert.equal(planned.planned[0]?.matchKey, "separations:4510");
    assert.equal(planned.planned[1]?.matchKey, "separations:4510#re-read-1");
    assert.notEqual(planned.planned[0]?.itemId, planned.planned[1]?.itemId);
  });

  it("dry-run stops at the first transaction node", () => {
    const support = workflowDryRunSupport(separationsDescriptor);
    assert.deepEqual(support, { state: "supported", stopsAt: "clear-pending" });

    const transactions = descriptorRuntimeNodes(separationsDescriptor)
      .filter((node) => node.kind === "transaction");
    assert.equal(transactions.length, 3);
    for (const node of transactions) {
      assert.equal(
        node.kind === "transaction" ? node.dryRun : "not-a-transaction",
        "stop-after-prepare",
        String(node.id),
      );
    }
    assert.equal(plan([SUBMISSION], true).planned.length, 1);
  });
});

/* ── the gate half: the wire an approver actually reads ───────────────────── */

const PARKED_GATE_LIFECYCLE = {
  state: "parked-gate",
  gateId: "identity-approval",
  parkedAt: GATE_NOW,
  resumeAt: "approval",
} as const;


function gateNodeViews(): readonly unknown[] {
  return descriptorRuntimeNodes(separationsDescriptor).flatMap((node) => (
    node.kind === "gate"
      ? [{
        nodeId: String(node.id),
        label: node.label,
        dependsOn: node.dependsOn.map(String),
        resultSchemaHash: deriveSchemaHash(node.result, "output"),
      }]
      : []
  ));
}

function packetWithPlan(): IdentityEvidencePacket {
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000412",
    "HOUSING/DINING/HOSPITALITY", "004921", "STDT 2", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: "Battistessa, Johnnie",
    documentEidText: "blank (the document supplied no EID)",
    emplIdSource: "name-resolved",
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: EID as never,
      displayedName: "Battistessa, Johnnie",
      jobRows: rows,
      rowCount: rows.length,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: GATE_NOW as never,
    },
    nameSelection: {
      status: "resolved",
      selected: {
        emplId: EID as never,
        name: "Battistessa, Johnnie",
        department: "Housing Dining Hospitality",
        jobTitle: "STDT 2",
        employeeStatus: "active",
        hdh: true,
      },
      candidateEids: [EID as never],
    },
    plan: SeparationWritePlanSchema.parse({
      state: "planned",
      termination: {
        terminationType: "Graduated/No longer a Student",
        classification: "involuntary",
        template: "UC_INVOL_TERM",
        reasonCode: "No Longer Student",
        emplRecord: "0",
        effectiveDate: "06/20/2026",
        lastDateWorked: "06/12/2026",
        initiatorComments: "Termination eff 06/20/2026. Last Day Worked 06/12/2026. "
          + "Holiday Pay on 06/19/2026. Kuali form #4510.",
      },
      document: {
        documentNumber: "4510",
        department: "000412 - Housing/Dining/Hospitality",
        departmentCode: "000412",
        ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
        payrollTitleCode: "004921",
        payrollTitle: "STDT 2",
        terminationEffectiveDate: "06/20/2026",
        timekeeperName: { kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId: uuidOf(91) },
      },
      dates: {
        kualiLastDayWorked: "06/12/2026",
        lastDayWorked: "06/12/2026",
        lastDayWorkedChanged: false,
        kualiSeparationDate: "06/12/2026",
        separationDate: "06/19/2026",
        separationDateChanged: true,
        separationDeterminingLeave: "holiday",
        unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
        source: "kronos-timesheet",
      },
    }),
  });
}

function seedGate(world: DashboardWorld, packet: IdentityEvidencePacket): void {
  const seeded = RunRecordSchema.parse({ ...runRecordOf({ seed: 1, workflow: separationsDescriptor.id }),
    envelope: { ...runRecordOf({ seed: 1 }).envelope, workflow: separationsDescriptor.id,
      descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint } });
  testWorkerPorts(world.database, manualClock(new Date(GATE_NOW)), { path: join(world.stateRoot, "authority.db"), descriptor: separationsDescriptor, poolIndex: 1 });
  const slot = world.database.authority.workerSlots.list(separationsDescriptor.id).find(record => record.poolIndex === 1 && record.retiredAt === null);
  assert.ok(slot);
  const workerId = slot.workerId;
  world.database.authority.runs.enqueue(seeded);
  const claimed = world.database.authority.runs.claimNext({ workflow: separationsDescriptor.id,
    workerId, now: GATE_NOW });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") throw new Error("identity fixture claim refused");
  let current = claimed.run;
  for (const lifecycle of [
    { state: "validating", workerId, claimedAt: GATE_NOW, heartbeatAt: GATE_NOW },
    { state: "running", workerId, claimedAt: GATE_NOW, heartbeatAt: GATE_NOW },
    PARKED_GATE_LIFECYCLE,
  ]) {
    const result = world.database.authority.runs.transition({ runId: RUN_ID, expectedVersion: current.version,
      claim: { workerId, claimGeneration: 1 }, lifecycle, now: GATE_NOW });
    assert.equal(result.state, "applied");
    if (result.state !== "applied") throw new Error("identity fixture transition refused");
    current = result.run;
  }
  world.authority.put(current);
  const checkpoint = RunCheckpointRecordSchema.parse({

    workflowId: seeded.envelope.workflow,
    itemId: seeded.envelope.itemId,
    nodeId: "comparison",
    attempt: 1,
    claimGeneration: 1,
    runId: RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(MatchIdentityOutputSchema, "output"),
      value: MatchIdentityOutputSchema.parse({
        packet,
        evidenceDigest: deriveIdentityEvidenceDigest(packet),
      }),
    },
    descriptorVersion: separationsDescriptor.version,
    contractFingerprint: separationsDescriptor.contractFingerprint,
    implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, SeparationsMatchIdentity.id),
    provenance: [],
    writtenAt: GATE_NOW,
  });
  world.database.authority.runCheckpoints.insert(checkpoint);
  world.authority.putCheckpoint(checkpoint);
  const event = world.database.authority.timelineEvents.get(deriveStableUuid("timeline-checkpoint-recorded",
    checkpointLookupKey(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
      checkpoint.attempt, checkpoint.claimGeneration)));
  assert.ok(event);
  assert.equal(event.payload.kind, "checkpoint-recorded");
  if (event.payload.kind !== "checkpoint-recorded") throw new Error("identity fixture checkpoint event absent");
  assert.deepEqual(event.payload.checkpoint, timelineCheckpointReference(checkpoint));
}

describe("separations — the identity-gate wire", () => {
  it("serves the whole packet INCLUDING the write plan, and the actions that resolve it", () => {
    const world = makeWorld();
    worlds.push(world);
    const packet = packetWithPlan();
    seedGate(world, packet);

    const deps: RunDetailQueryDeps = { runReader: world.runReader, timeline: world.timeline,
      stateRoot: world.stateRoot,
      projection: world.projection,
      authority: world.authority,
      canonical: { reader: world.runReader, database: world.database,
        descriptors: { resolve: () => separationsDescriptor } },
      descriptors: { resolve: () => ({ details: [], gateNodes: gateNodeViews() as never }) },
    };
    const response = buildRunSection(deps, RUN_ID, "identity-gate");
    const payload = Reflect.get(response, "payload") as {
      state: string;
      value: {
        gateId: string;
        resultSchemaHash: string;
        evidenceDigest: string;
        approvalShape: string;
        runId: string;
        expectedVersion: number;
        options: readonly { eid: string; chosenFrom: string }[];
        packet: { plan: { state: string } };
        actions: readonly { command: string }[];
      };
    };
    assert.equal(payload.state, "available", JSON.stringify(payload));

    // The composition's ONE new gate fact, on the wire an approver reads.
    assert.equal(payload.value.packet.plan.state, "planned");
    const served = SeparationWritePlanSchema.parse(payload.value.packet.plan);
    assert.equal(served.state, "planned");
    if (served.state === "planned") {
      assert.equal(served.termination.template, "UC_INVOL_TERM");
      assert.equal(served.document.department, "000412 - Housing/Dining/Hospitality");
      assert.equal(served.dates.separationDate, "06/19/2026");
      // §9.1's answer, visible where the human is looking.
      assert.deepEqual(served.dates.unclassifiedPayCodes, [
        "Independence Day Observed",
        "Juneteenth Observed",
      ]);
    }

    // The schema hash the surface echoes back is byte for byte the value
    // `executeResolveGate` compares an incoming payload against.
    assert.equal(
      payload.value.resultSchemaHash,
      deriveSchemaHash(IdentityApprovalResultSchema, "output"),
    );
    assert.equal(payload.value.evidenceDigest, deriveIdentityEvidenceDigest(packet));

    assert.equal(payload.value.approvalShape, "type-the-eid");

    assert.deepEqual(
      payload.value.actions.map(({ command }) => command),
      ["resolve-gate", "resolve-gate"],
    );
    const command = CommandRequestSchema.parse({
      commandId: uuidOf(31),
      family: "gate",
      type: "resolve-gate",
      requestedBy: "local-operator",
      requestedAt: GATE_NOW,
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
    assert.equal(
      IdentityApprovalResultSchema.parse(
        command.family === "gate" ? command.payload.result.value : undefined,
      ).decision,
      "approved",
    );
  });

  it("names EXACTLY ONE gate dependency holding an identity packet, which is what the section requires", () => {

    const views = gateNodeViews() as readonly { nodeId: string; dependsOn: readonly string[] }[];
    assert.equal(views.length, 1);
    assert.deepEqual(views[0]?.dependsOn, ["comparison"]);
  });
});
