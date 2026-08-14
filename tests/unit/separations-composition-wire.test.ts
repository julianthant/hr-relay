/**
 * The composed `separations` workflow, driven through the machinery that
 * ALREADY exists — §3's rule for every chunk of this migration: *"makes its
 * workflow fully operable through the machinery that already exists … verify
 * that; do not build it."*
 *
 * So nothing here is new server surface. What it pins is that a registered
 * workflow with three transaction nodes, an operator gate and a three-value
 * structured ingress is start-able, previewable, approvable and resumable
 * without one further server change — and that the ONE genuinely new fact this
 * chunk added (the gate packet's write-plan block) reaches the wire an approver
 * reads, rather than living only in the graph.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../src/base/workflow.js";
import { manualClock } from "../../src/domain/clock.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import { MatchIdentityOutputSchema } from "../../src/domain/contracts/separations/match-identity.js";
import { deriveItemId } from "../../src/domain/identifiers.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../src/domain/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../src/domain/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../src/domain/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../src/domain/separations/write-plan.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { buildRunSection, type RunDetailQueryDeps } from "../../src/server/dashboard/queries/run-detail.js";
import { planStart } from "../../src/services/start/plan.js";
import { deriveJobRowFromCells } from "../../src/stores/ucpath/driver/person-org-operation.js";
import { separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
import { HASH_A, NOW, UUID_4 } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./server/helpers/dashboard-harness.js";

const CLOCK = manualClock(new Date(NOW));
const EID = "10873698";
const RUN_ID = uuidOf(1);
const GATE_NOW = "2026-08-14T18:00:00.000Z";

const SUBMISSION = Object.freeze({
  actionId: "6a7a33b2ac106d428b3217e0",
  documentNumber: "4510",
  timekeeperName: "Julian Zaw",
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
    { authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000 },
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
  it("plans one item per document, and refuses a submission the ingress does not admit", () => {
    const planned = plan([SUBMISSION, { documentNumber: "4510" }]);
    assert.equal(planned.planned.length, 1);
    assert.equal(planned.planned[0]?.matchKey, "separations:4510");
    assert.equal(
      planned.planned[0]?.itemId,
      deriveItemId("separations", "separations:4510"),
    );
    // The refusal retains the operator's EXACT raw submission (D109), so the
    // thing they typed is still readable beside the reason it was refused.
    assert.equal(planned.refused.length, 1);
    assert.deepEqual(planned.refused[0]?.rawInput, { documentNumber: "4510" });
  });

  it("gives an explicit re-read its OWN item, which is §'the re-run wall' item 2's whole point", () => {
    // A checkpoint is keyed (workflow, itemId, node, attempt) with no run id, so
    // a second run of one document replays the first run's reads — whose
    // `observedAt` differs by construction. The operator's explicit re-read is
    // part of the canonical input, so the start plan mints a different item.
    const planned = plan([
      SUBMISSION,
      { ...SUBMISSION, reRead: { ordinal: 1, reason: "the department corrected the last day worked" } },
    ]);
    assert.equal(planned.planned.length, 2);
    assert.equal(planned.planned[0]?.matchKey, "separations:4510");
    assert.equal(planned.planned[1]?.matchKey, "separations:4510#re-read-1");
    assert.notEqual(planned.planned[0]?.itemId, planned.planned[1]?.itemId);
  });

  it("is dry-startable through the GRAPH (D209), stopping at the first transaction node", () => {
    const support = workflowDryRunSupport(separationsDescriptor);
    assert.deepEqual(support, { state: "supported", stopsAt: "clear-pending" });
    // …and all three transaction nodes declare the arm, which is what D209
    // requires: checking only the first would be a true statement about the
    // wrong thing (D205).
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

/**
 * The gate node view the dashboard composition derives from a descriptor —
 * derived here from the REAL registered descriptor rather than hand-written, so
 * a gate whose `dependsOn` or result schema moved fails this suite.
 */
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
    documentEidText: EID,
    emplIdSource: "document-eid",
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
        timekeeperName: "Julian Zaw",
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
      },
    }),
  });
}

function seedGate(world: DashboardWorld, packet: IdentityEvidencePacket): void {
  queuedEventOf(world, { seed: 1, version: 4, lifecycle: PARKED_GATE_LIFECYCLE });
  const seeded = runRecordOf({ seed: 1 });
  world.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
    // The harness's own run identity: the identity-gate section is GENERIC — it
    // locates the packet through the descriptor's `dependsOn` and hard-codes no
    // node name — so what this suite substitutes is the real `separations` gate
    // VIEW, which is the half that could drift.
    workflowId: seeded.envelope.workflow,
    itemId: seeded.envelope.itemId,
    nodeId: "comparison",
    attempt: 1,
    runId: RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(MatchIdentityOutputSchema, "output"),
      value: MatchIdentityOutputSchema.parse({
        packet,
        evidenceDigest: deriveIdentityEvidenceDigest(packet),
      }),
    },
    descriptorVersion: 1,
    contractFingerprint: "a".repeat(64),
    implFingerprint: "a".repeat(64),
    provenance: [],
    writtenAt: GATE_NOW,
  }));
}

describe("separations — the identity-gate wire", () => {
  it("serves the whole packet INCLUDING the write plan, and the actions that resolve it", () => {
    const world = makeWorld();
    worlds.push(world);
    const packet = packetWithPlan();
    seedGate(world, packet);

    const deps: RunDetailQueryDeps = {
      stateRoot: world.stateRoot,
      projection: world.projection,
      authority: world.authority,
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
    // A single unambiguous, same-named, single-active-job candidate off the
    // document's own EID is the one shape that is a one-click approve.
    assert.equal(payload.value.approvalShape, "one-click");
    // And a command built straight off this payload parses through the kernel's
    // own request schema unchanged, which is what "approvable through the
    // existing machinery" means for a workflow whose gate dominates three real
    // writes across two systems.
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

  it("moves the evidence digest when a PLANNED VALUE moves, not only when the person does", () => {
    // §14.5, made load-bearing by putting the plan in the packet: an approval is
    // an observation of a specific packet, and a reconciled date the run would
    // file is part of what was observed.
    const packet = packetWithPlan();
    const moved = SeparationWritePlanSchema.parse(
      packet.plan.state === "planned"
        ? { ...packet.plan, dates: { ...packet.plan.dates, separationDate: "06/26/2026" } }
        : packet.plan,
    );
    assert.notEqual(
      deriveIdentityEvidenceDigest(packet),
      deriveIdentityEvidenceDigest({ ...packet, plan: moved }),
    );
  });

  it("names EXACTLY ONE gate dependency holding an identity packet, which is what the section requires", () => {
    // `buildIdentityGatePayload` refuses when the gate's `dependsOn` does not
    // resolve to exactly one identity decision packet. The composed graph hangs
    // everything the operator must see off `comparison` and depends the gate on
    // that node alone, so the requirement is met by shape rather than by luck.
    const views = gateNodeViews() as readonly { nodeId: string; dependsOn: readonly string[] }[];
    assert.equal(views.length, 1);
    assert.deepEqual(views[0]?.dependsOn, ["comparison"]);
  });
});
