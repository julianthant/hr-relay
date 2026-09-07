import { ProtectedStoreRecordSchema } from "../../src/domain/config/protected-settings.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { deriveCheckpointOutputDigest, deriveRunResultDigest } from "../../src/domain/run/result.js";
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
import { protectedSecretSource } from "../helpers/protected-secret-source.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../src/base/workflow.js";
import { manualClock } from "../../src/domain/clock.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import { SeparationsMatchIdentity, MatchIdentityOutputSchema } from "../../src/domain/contracts/separations/match-identity.js";
import { deriveItemId } from "../../src/domain/identifiers.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { verifyIdentityApproval, IdentityApprovalResultSchema } from "../../src/domain/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
  protectIdentityEvidencePacket,
} from "../../src/domain/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../src/domain/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../src/domain/separations/write-plan.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { parseInputRunText, toRawSubmission } from "../../src/domain/workflow/ingress.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { buildRunSection, type RunDetailQueryDeps } from "../../src/server/dashboard/queries/run-detail.js";
import { planStart } from "../../src/services/start/plan.js";
import { deriveJobRowFromCells } from "../../src/stores/ucpath/driver/person-org-operation.js";
import { HASH_A, NOW, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./server/helpers/dashboard-harness.js";
import { separationsDescriptor } from "../helpers/registered-workflows.js";

const CLOCK = manualClock(new Date(NOW));
const EID = "10873698";
const RUN_ID = uuidOf(1);
const GATE_NOW = "2026-08-14T18:00:00.000Z";

/**
 * D261: `actionId` left the ingress — the graph's head node resolves it — so a
 * separations submission is the ONE number an operator types plus the constant
 * the start surface contributes.
 */
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
  it("reads protected input once, retains it across rotation, and refuses override/absence before IDs", () => {
    const authority = openDatabase();
    let current = ProtectedStoreRecordSchema.parse(protectedSecretSource({ timekeeperName: "Synthetic First Operator" }).read());
    let reads = 0;
    let ids = 0;
    const source = { read: () => { reads += 1; return current; } };
    const request = { descriptor: separationsDescriptor, submissions: [SUBMISSION], dryRun: true,
      priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A,
      configSnapshotId: UUID_4, plannedBy: "local-operator" };
    const deps = { authority, clock: CLOCK, ids: { uuid: () => { ids += 1; return uuidOf(ids + 50); } },
      planTtlMs: 600_000, protectedSecrets: source };
    const first = planStart(deps, request);
    assert.equal(reads, 1);
    const retained = first.planned[0]?.input;
    assert.ok(retained);
    assert.equal(Reflect.get(retained.value as object, "timekeeperName"), "Synthetic First Operator");
    const changedBytes = ProtectedStoreRecordSchema.parse(protectedSecretSource({ timekeeperName: "Synthetic Second Operator" }).read());
    current = changedBytes;
    const sameBinding = planStart(deps, request);
    assert.equal(sameBinding.inputFingerprint, first.inputFingerprint, "values cannot enter fingerprints");
    current = { ...changedBytes, entries: { ...changedBytes.entries, timekeeperName: {
      ...changedBytes.entries.timekeeperName!, valueId: uuidOf(90),
    } } };
    const rotated = planStart(deps, request);
    assert.notEqual(rotated.inputFingerprint, first.inputFingerprint, "the retained valueId is identity");
    const beforeRetained = reads;
    const rerun = planStart(deps, { ...request, retainedInputs: [retained] });
    assert.equal(reads, beforeRetained);
    assert.deepEqual(rerun.planned[0]?.input, retained);
    current = ProtectedStoreRecordSchema.parse(protectedSecretSource().read());
    const beforeBlocked = ids;
    assert.throws(() => planStart(deps, request), /protected input timekeeperName is absent/);
    assert.equal(ids, beforeBlocked);
    const beforeOverride = reads;
    assert.throws(() => planStart(deps, { ...request, submissions: [{ ...SUBMISSION, timekeeperName: "Do Not Echo This" }] }),
      /^Error: caller-supplied protected input timekeeperName is refused$/);
    assert.equal(reads, beforeOverride);
    assert.equal(ids, beforeBlocked);
    assert.throws(() => planStart({ ...deps, protectedSecrets: { read: () => { throw new Error("Do Not Echo This"); } } }, request),
      /^Error: protected input timekeeperName source is unreadable$/);
    assert.equal(ids, beforeBlocked);
  });

  it("binds protected canary plans without document-derived titles, match keys or fingerprints", () => {
    const deps = { authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000,
      protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }) };
    const request = { descriptor: separationsDescriptor, submissions: [{ documentNumber: "4511" }],
      protectedSubmissionBindings: [{ kind: "test-data-local" as const, inputPath: "documentNumber" as const,
        name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf(88) }],
      dryRun: true, priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A,
      configSnapshotId: UUID_4, plannedBy: "local-operator" };
    const first = planStart(deps, request);
    const changed = planStart(deps, { ...request, submissions: [{ documentNumber: "4512" }] });
    assert.equal(first.inputFingerprint, changed.inputFingerprint);
    const retained = first.planned[0].input;
    assert.equal(first.planned[0].title, "Protected test subject");
    assert.equal(first.planned[0].matchKey.includes("4511"), false);
    assert.equal(first.planned[0].itemId, changed.planned[0].itemId);
    assert.throws(() => planStart(deps, { ...request, retainedInputs: [retained],
      submissions: [{ documentNumber: "4512" }] }), /retained protected input .* cannot change/);
    const rereadRefusal = { read: () => { throw new Error("must not reread"); } };
    assert.deepEqual(planStart({ ...deps, protectedSecrets: rereadRefusal }, { ...request, retainedInputs: [retained] })
      .planned[0].input, retained);
  });

  it("hides the protected canary document while keeping approval bound to its retained identity", () => {
    const base = MatchIdentityOutputSchema.parse(SeparationsMatchIdentity.example).packet;
    const binding = { kind: "test-data-local" as const, inputPath: "documentNumber" as const,
      name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: uuidOf(88) };
    const first = protectIdentityEvidencePacket(base, [binding]);
    assert.equal(first.documentNumber, "protected document");
    assert.equal(JSON.stringify(first).includes(base.documentNumber), false);
    assert.equal(deriveIdentityEvidenceDigest(first), deriveIdentityEvidenceDigest(
      protectIdentityEvidencePacket({ ...base, documentNumber: "4999" }, [binding])));
    assert.notEqual(deriveIdentityEvidenceDigest(first), deriveIdentityEvidenceDigest(
      protectIdentityEvidencePacket(base, [{ ...binding, sourceId: uuidOf(89) }])));
  });

  it("keeps protected names and signed comments out of checkpoint and result fingerprint preimages", () => {
    const first = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic First Operator", timekeeperComments: "Filed. -SFO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SFO", separationDate: "06/19/2026" } } };
    const rotated = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic Second Operator", timekeeperComments: "Filed. -SSO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SSO", separationDate: "06/19/2026" } } };
    assert.equal(deriveCheckpointOutputDigest(first), deriveCheckpointOutputDigest(rotated));
    assert.equal(deriveRunResultDigest(first), deriveRunResultDigest(rotated));
    assert.notEqual(deriveRunResultDigest(first), deriveRunResultDigest({ ...first,
      value: { ...first.value, dates: { ...first.value.dates, separationDate: "06/20/2026" } } }));
  });

  it("plans one item per document, and refuses a submission the ingress does not admit", () => {
    // The refused half is now the SHAPE the surface no longer sends: a
    // submission still carrying D261's retired `actionId` is refused by the
    // strict input schema rather than quietly ignored, which is what keeps a
    // stale caller from starting a run under a contract it does not hold.
    const planned = plan([SUBMISSION, { ...SUBMISSION, actionId: "6a7a33b2ac106d428b3217e0" }]);
    assert.equal(planned.planned.length, 1);
    assert.equal(planned.planned[0]?.matchKey, "separations:4510");
    assert.equal(
      planned.planned[0]?.itemId,
      deriveItemId("separations", "separations:4510"),
    );
    // The refusal retains the operator's EXACT raw submission (D109), so the
    // thing they typed is still readable beside the reason it was refused.
    assert.equal(planned.refused.length, 1);
    assert.deepEqual(planned.refused[0]?.rawInput, {
      ...SUBMISSION,
      actionId: "6a7a33b2ac106d428b3217e0",
    });
  });

  /**
   * D261's door, end to end through the ingress the modal actually uses: the
   * operator types ONE number and the plan is a real, schema-satisfying
   * separations run — the claim D260 measured as unavailable.
   */
  it("plans a run from typed text alone, which is the whole point of D261", () => {
    const surface = separationsDescriptor.surfaces.inputRun;
    assert.ok(surface, "separations declares a typed-text start surface");
    const entries = parseInputRunText(surface.parser, "4502; 4510");
    assert.equal(entries.length, 2);
    const planned = plan(entries.map((entry) => toRawSubmission(entry)));
    assert.equal(planned.refused.length, 0);
    assert.deepEqual(planned.planned.map(({ matchKey }) => matchKey), [
      "separations:4502",
      "separations:4510",
    ]);
    // Browser submissions carry only the typed document number.
    assert.deepEqual(toRawSubmission(entries[0]), {
      documentNumber: "4502",
    });
  });

  it("refuses typed text that is not a document number, and starts nothing", () => {
    const surface = separationsDescriptor.surfaces.inputRun;
    assert.ok(surface);
    // No `otherwise` arm: the box refuses as a WHOLE rather than starting the
    // good half of a paste, which is what `inputRunParserLabel` promises.
    assert.throws(() => parseInputRunText(surface.parser, "4502; Cramia, Dreitho"), /matched no parser rule/u);
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
        source: "kronos-timesheet",
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
    claimGeneration: 1,
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
    // Even a single exact name candidate remains an operator decision: the
    // packet carries no independently supplied EID, so D309 requires typing it.
    assert.equal(payload.value.approvalShape, "type-the-eid");
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

  it("binds approval to retained value identity and never serves historical protected bytes or digests", () => {
    const packet = packetWithPlan();
    assert.equal(JSON.stringify(packet).includes("Julian Zaw"), false);
    assert.equal(packet.plan.state, "planned");
    if (packet.plan.state !== "planned") throw new Error("fixture must carry a plan");
    const plannedPacket = packet.plan;
    const bind = (valueId: string) => ({ ...packet, plan: SeparationWritePlanSchema.parse({
      ...plannedPacket,
      document: { ...plannedPacket.document, timekeeperName: {
        kind: "protected-store", name: "timekeeperName", inputPath: "timekeeperName", valueId,
      } },
    }) });
    const first = bind(uuidOf(40));
    const rotated = bind(uuidOf(41));
    const digest = deriveIdentityEvidenceDigest(first);
    assert.notEqual(digest, deriveIdentityEvidenceDigest(rotated));
    const result = IdentityApprovalResultSchema.parse({ decision: "approved", eid: first.emplId,
      chosenFrom: "checked", evidenceDigest: digest });
    assert.equal(verifyIdentityApproval(first, result).state, "approved");
    assert.equal(verifyIdentityApproval(rotated, result).state, "refused");
    const historicalDigest = FingerprintSchema.parse("e".repeat(64));
    const refusal = verifyIdentityApproval(first, result, historicalDigest);
    assert.equal(refusal.state, "refused");
    assert.equal(JSON.stringify(refusal).includes(historicalDigest.slice(0, 12)), false);
    const historical = SeparationWritePlanSchema.parse({ ...packet.plan,
      document: { ...packet.plan.document, timekeeperName: "Another Synthetic Operator" } });
    assert.equal(deriveIdentityEvidenceDigest({ ...packet, plan: historical }), deriveIdentityEvidenceDigest(packet));
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
