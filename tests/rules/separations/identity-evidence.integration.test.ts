
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { deriveJobRowFromCells } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { MatchIdentityOutputSchema,SeparationsMatchIdentity } from "../../../src/models/workflows/separations/match-identity.js";
import type { IdentityEvidencePacket } from "../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest,
protectIdentityEvidencePacket,
} from "../../../src/rules/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../src/rules/separations/write-plan.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { HASH_A,NOW,UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
uuidOf,
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";
import { protectedSecretSource } from "../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(NOW));
const EID = "10873698";
const GATE_NOW = "2026-08-14T18:00:00.000Z";

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

function _plan(submissions: readonly unknown[], dryRun = false) {
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
});

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

describe("separations — the identity-gate wire", () => {

  it("moves the evidence digest when a PLANNED VALUE moves, not only when the person does", () => {

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
});
