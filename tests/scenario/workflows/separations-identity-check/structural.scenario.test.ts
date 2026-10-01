/**
 * Executable scenarios for `separations-identity-check` — separations chunk 3
 * (`docs/rebuild/migrations/separations.md` §3), the UCPath identity passage and ref write-safety
 * §14's supplied-EID machine authority and name-only operator gate.
 *
 * The corpus covers every identity scenario the behaviour review names
 * (S14–S24) plus the three gate paths, and it is deliberately split by what each
 * arm falsifies:
 *
 * - **Graph walks** run the descriptor's real binds, the real gate, and the real
 *   terminal derive, so they falsify the PATH — including the coverage points
 *   `gate:identity-approval/opened` and `/resolved`, which are the first gate
 *   points any production descriptor in this tree has produced.
 * - **Task walks** run the real task implementations against the deterministic
 *   UCPath driver, because a refusal is only observable as "it refused" rather
 *   than "it returned something plausible" when the real implementation runs.
 *
 * The fixture grid is authored as raw CELLS and parsed by the real
 * `deriveJobRowFromCells`, so a fixture cannot agree with a broken parse.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema, FingerprintSchema, IsoInstantSchema } from "../../../../src/domain/ids.js";
import { classifyNameSimilarity } from "../../../../src/domain/matching/name-match.js";
import { deriveIdentityEvidenceDigest } from "../../../../src/domain/separations/identity-evidence.js";
import { MatchIdentityOutputSchema } from "../../../../src/domain/contracts/separations/match-identity.js";
import type { MatchIdentityOutput } from "../../../../src/domain/contracts/separations/match-identity.js";
import { classifyJobSummary } from "../../../../src/domain/separations/job-summary-classification.js";
import { UcpathJobSummaryReadSchema } from "../../../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathJobSummary } from "../../../../src/domain/ui/ucpath-job-summary.js";
import type { SearchPersonOrgOutput } from "../../../../src/domain/contracts/ucpath/search-person-org.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { readJobSummaryTask } from "../../../../src/backend/systems/ucpath/tasks/read-job-summary.js";
import { matchIdentityTask } from "../../../../src/stores/separations/tasks/match-identity.js";
import { verifyIdentityApprovalTask } from "../../../../src/stores/separations/tasks/verify-identity-approval.js";
import { separationsIdentityCheckDescriptor } from "../../../helpers/registered-workflows.js";
import { SEPARATIONS_IDENTITY_CHECK_CLAIMS } from "../../coverage-claims.js";
import { walkDescriptor } from "../../helpers/pure-walk.js";
import { noSeparationWritePlan } from "../../../../src/domain/separations/write-plan.js";

const taskCtx = Object.freeze({
  signal: new AbortController().signal,
  log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
  fail: (code: string, message: string): never => { throw new Error(`${code}: ${message}`); },
  recordData: () => undefined,
});

const EID = EidSchema.parse("10800001");
const OTHER_EID = EidSchema.parse("10800000");
const DOCUMENT = "4510";
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-12T18:00:00.000Z");

/** Columns as the live Person Org Employment Instances grid renders them. */
function cells(overrides: Partial<Readonly<{
  emplRecord: string; effectiveDate: string; hrStatus: string; businessUnit: string;
  positionNumber: string; deptId: string; department: string; jobCode: string;
  jobTitle: string; expectedJobEndDate: string; fte: string; emplClass: string;
}>> = {}): readonly string[] {
  const row = {
    emplRecord: "0",
    effectiveDate: "07/01/2025",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    positionNumber: "40012345",
    deptId: "000414",
    department: "Housing Dining Hospitality",
    jobCode: "004920",
    jobTitle: "STDT 3",
    expectedJobEndDate: "",
    fte: "0.500000",
    emplClass: "Student",
    ...overrides,
  };
  return [
    row.emplRecord, row.effectiveDate, row.hrStatus, row.businessUnit, row.positionNumber,
    row.deptId, row.department, row.jobCode, row.jobTitle, row.expectedJobEndDate,
    row.fte, row.emplClass,
  ];
}

function jobSummary(
  rows: readonly (readonly string[])[],
  overrides: Partial<Pick<UcpathJobSummary, "emplId" | "displayedName" | "renderContext">> = {},
): UcpathJobSummary {
  const jobRows = rows.map((row, rowIndex) => deriveJobRowFromCells(row, rowIndex));
  return {
    pageStateId: "ucpath.person-org.detail-ready",
    emplId: EID,
    displayedName: "Hernandez, Jose Santos",
    jobRows,
    rowCount: jobRows.length,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

function nameSearch(overrides: Partial<SearchPersonOrgOutput["selection"]> = {}): SearchPersonOrgOutput {
  const candidate = {
    emplId: EID,
    name: "Hernandez, Jose Santos",
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 3",
    employeeStatus: "active" as const,
    hdh: true,
  };
  return {
    results: [candidate],
    selection: {
      status: "resolved",
      selected: candidate,
      candidateEids: [EID],
      ...overrides,
    } as SearchPersonOrgOutput["selection"],
  };
}

const RUN_INPUT = {
  documentNumber: DOCUMENT,
  employeeName: "Hernandez, Jose Santos",
  emplId: EID,
  emplIdSource: "document-eid" as const,
  documentEid: { state: "present" as const, value: EID },
};

const NAME_ONLY_INPUT = {
  ...RUN_INPUT,
  emplIdSource: "name-resolved" as const,
  documentEid: { state: "absent" as const, reason: "the separation document carried no EID" },
};

async function readJobSummary(summary: UcpathJobSummary, emplId = EID): Promise<UcpathJobSummary> {
  const driver = createDeterministicUcpathPersonOrgDriver(
    undefined,
    UcpathJobSummaryReadSchema.parse({ state: "read", summary }),
  );
  return await readJobSummaryTask.impl.run({
    input: { emplId },
    ctx: { ...taskCtx, driver },
  }) as UcpathJobSummary;
}

async function comparisonFor(
  summary: UcpathJobSummary,
  search: SearchPersonOrgOutput = nameSearch(),
  input: typeof RUN_INPUT | typeof NAME_ONLY_INPUT = RUN_INPUT,
): Promise<MatchIdentityOutput> {
  return MatchIdentityOutputSchema.parse(await matchIdentityTask.impl.run({
    input: {
      documentNumber: input.documentNumber,
      documentName: input.employeeName,
      documentEid: input.documentEid,
      emplId: input.emplId,
      emplIdSource: input.emplIdSource,
      jobSummary: summary,
      nameSelection: search.selection,
      plan: noSeparationWritePlan("this fixture composes no separation write plan"),
    },
    ctx: taskCtx,
  }));
}

describe("separations-identity-check scenarios", () => {
  it("match-identity refusals identify the defect without persisting either EID", async () => {
    const messages: string[] = [];
    const failingCtx = {
      ...taskCtx,
      fail: (code: string, message: string): never => {
        messages.push(`${code}: ${message}`);
        throw new Error(code);
      },
    };
    const base = {
      documentNumber: RUN_INPUT.documentNumber,
      documentName: RUN_INPUT.employeeName,
      documentEid: RUN_INPUT.documentEid,
      emplId: RUN_INPUT.emplId,
      emplIdSource: RUN_INPUT.emplIdSource,
      nameSelection: nameSearch().selection,
      plan: noSeparationWritePlan("this fixture composes no separation write plan"),
    };

    await assert.rejects(matchIdentityTask.impl.run({
      input: { ...base, jobSummary: jobSummary([cells()], { emplId: OTHER_EID }) },
      ctx: failingCtx,
    }));
    await assert.rejects(matchIdentityTask.impl.run({
      input: {
        ...base,
        documentEid: { state: "present", value: OTHER_EID },
        jobSummary: jobSummary([cells()]),
      },
      ctx: failingCtx,
    }));

    assert.equal(messages.length, 2);
    for (const message of messages) {
      assert.doesNotMatch(message, new RegExp(EID));
      assert.doesNotMatch(message, new RegExp(OTHER_EID));
      assert.match(message, /correct|rerun|refus/iu);
    }
  });

  it("separations-identity-check/single-active-job — exact supplied EID needs no approval", async () => {
    const summary = await readJobSummary(jobSummary([cells()]));
    const comparison = await comparisonFor(summary);
    assert.equal(comparison.packet.nameTier, "same");
    assert.equal((comparison.packet.jobs as { disposition: string }).disposition, "single-active-job");

    const verified = await verifyIdentityApprovalTask.impl.run({
      input: { packet: comparison.packet, evidenceDigest: comparison.evidenceDigest },
      ctx: taskCtx,
    });
    const walk = walkDescriptor(separationsIdentityCheckDescriptor, RUN_INPUT, {
      outputs: {
        "job-summary": summary,
        "name-search": nameSearch(),
        comparison,
        approval: verified,
      },
    });
    assert.deepEqual(walk.visited, ["job-summary", "name-search", "comparison", "approval"]);
    assert.deepEqual(walk.skipped, ["identity-approval"]);
    assert.deepEqual(walk.covered, []);
    const result = walk.result as { approved: { authority: string; emplId: string } };
    assert.equal(result.approved.emplId, EID);
    assert.equal(result.approved.authority, "machine-verification");
  });

  it("separations-identity-check/similar-name-never-auto-proceeds — S15's silent risk, closed", async () => {
    // Kuali "Hernandez, Jose Santo" vs UCPath "Hernandez, Jose Santos": one edit.
    // Legacy calls this `similar`, trusts the EID, proceeds AND rewrites the
    // name in the live document. Here it remains disconfirming evidence, while
    // exact supplied-EID read-back determines that no approval is required.
    const summary = await readJobSummary(jobSummary([cells()]));
    const comparison = await comparisonFor(summary, nameSearch(), {
      ...RUN_INPUT,
      employeeName: "Hernandez, Jose Santo",
    });
    assert.equal(comparison.packet.nameTier, "similar");
    assert.equal(comparison.packet.approvalShape, "choose-a-candidate");
    const comparisons = comparison.packet.comparisons as readonly { field: string; agrees: boolean }[];
    // Disconfirming evidence FIRST (§14.6 risk 1).
    assert.equal(comparisons[0]?.agrees, false);
    assert.equal(comparisons[0]?.field, "name");
  });

  it("separations-identity-check/different-name-two-candidates — S17: the T002173685 shape", async () => {
    // The document's EID resolves one person; a search on the document's NAME
    // resolves a DIFFERENT career employee. Both candidates remain visible.
    //
    // A finding worth recording: the incident's OWN pair — Kuali
    // "Hernandez, Jose Santos" versus
    // the UCPath detail's "Santos Hernandez" — classifies as `same` under the
    // ported tier function, because the alignment tolerates extra tokens on the
    // longer side. Legacy fires its wrong-person control only on `different`,
    // so a tier-triggered identity rule would not have detected the very case
    // it exists for. The independently supplied/read-back EID is decisive here;
    // the contradictory name candidate remains evidence rather than a fallback.
    assert.equal(
      classifyNameSimilarity("Hernandez, Jose Santos", "Santos Hernandez"),
      "same",
    );
    const summary = await readJobSummary(jobSummary([cells()]));
    const careerSearch: SearchPersonOrgOutput = {
      results: [],
      selection: {
        status: "resolved",
        selected: {
          emplId: OTHER_EID,
          name: "Hernandez, Jose",
          department: "Facilities Management",
          jobTitle: "BLDG MAINT WORKER SR",
          employeeStatus: "active",
          hdh: false,
        },
        candidateEids: [OTHER_EID],
      },
    };
    const comparison = await comparisonFor(summary, careerSearch, {
      ...RUN_INPUT,
      employeeName: "Hernandez, Maria",
    });
    assert.equal(comparison.packet.nameTier, "different");
    assert.equal(comparison.packet.approvalShape, "type-the-eid");
    assert.deepEqual(comparison.packet.approvableEids, [EID, OTHER_EID]);

    // The contradictory name candidate remains visible but does not replace
    // the supplied EID whose UCPath detail read back exactly.
    const verified = await verifyIdentityApprovalTask.impl.run({
      input: { packet: comparison.packet, evidenceDigest: comparison.evidenceDigest },
      ctx: taskCtx,
    }) as { approved: { authority: string; emplId: string; nameTier: string } };
    assert.equal(verified.approved.authority, "machine-verification");
    assert.equal(verified.approved.emplId, EID);
    assert.equal(verified.approved.nameTier, "different");
  });

  it("separations-identity-check/already-terminated-single-row — S22's silent risk, closed", async () => {
    // A single-employment person who is already terminated auto-redirects to
    // the detail page, so legacy's grid scan NEVER RUNS and the run proceeds to
    // file a second termination. Here the classification is unconditional.
    const summary = await readJobSummary(jobSummary([cells({ hrStatus: "Inactive" })]));
    assert.equal(summary.renderContext.entry, "auto-detail");
    const classified = classifyJobSummary(summary.jobRows);
    assert.equal(classified.disposition, "no-active-job");
    assert.equal(classified.rows[0]?.hrStatus, "Inactive");

    const comparison = await comparisonFor(summary);
    assert.equal(comparison.packet.approvalShape, "choose-a-candidate");
    const employment = (comparison.packet.comparisons as readonly { field: string; agrees: boolean }[])
      .find(({ field }) => field === "employment");
    assert.equal(employment?.agrees, false);
  });

  it("separations-identity-check/already-terminated-multi-row — S21, as data rather than a throw", async () => {
    const summary = await readJobSummary(jobSummary([
      cells({ emplRecord: "0", hrStatus: "Terminated" }),
      cells({ emplRecord: "1", hrStatus: "Terminated", jobTitle: "STDT 2" }),
    ]));
    assert.equal(summary.rowCount, 2);
    const classified = classifyJobSummary(summary.jobRows);
    assert.equal(classified.disposition, "no-active-job");
    assert.equal(classified.inactiveRowCount, 2);
    // Legacy throws here. The rows still reach the operator verbatim.
    assert.deepEqual(classified.rows.map(({ hrStatus }) => hrStatus), ["Terminated", "Terminated"]);
  });

  it("separations-identity-check/concurrent-active-jobs — S23 refuses to pick, and says so", async () => {
    const summary = await readJobSummary(jobSummary([
      cells({ emplRecord: "0" }),
      cells({ emplRecord: "1", department: "Campus Dining and Retail", jobTitle: "STDT 2" }),
    ]));
    const classified = classifyJobSummary(summary.jobRows);
    assert.equal(classified.disposition, "concurrent-active-jobs");
    assert.equal(classified.activeRowCount, 2);
    const comparison = await comparisonFor(summary);
    assert.equal(comparison.packet.approvalShape, "choose-a-candidate");
  });

  it("separations-identity-check/unreadable-department — S24 is an absent arm WITH a reason", async () => {
    const summary = await readJobSummary(jobSummary([cells({ department: "", jobCode: "" })]));
    assert.deepEqual(summary.jobRows[0]?.department, {
      state: "absent",
      reason: "the Person Org Employment Instances grid rendered Department Description as an empty cell",
    });
    const classified = classifyJobSummary(summary.jobRows);
    // Surfaced, never skipped — and it does NOT fail the identity check, which
    // does not use the department.
    assert.deepEqual(classified.unreadableCells, [
      "row 0 (empl record 0): Department",
      "row 0 (empl record 0): Job Code",
      "row 0 (empl record 0): Expected Job End Date",
    ]);
    assert.equal(classified.rows[0]?.department,
      "(unreadable: the Person Org Employment Instances grid rendered Department Description as an empty cell)");
  });

  it("separations-identity-check/job-summary-not-found — S19: a complete EID that UCPath does not know", async () => {
    const driver = createDeterministicUcpathPersonOrgDriver(
      undefined,
      UcpathJobSummaryReadSchema.parse({
        state: "employee-not-found",
        emplId: EID,
        observedMarker: "No matching values were found",
      }),
    );
    await assert.rejects(
      readJobSummaryTask.impl.run({ input: { emplId: EID }, ctx: { ...taskCtx, driver } }),
      /employee-not-found: .*No matching values were found.*not\s+a timeout/s,
    );
  });

  it("separations-identity-check/gate-approved — name-only path, real gate included", async () => {
    const summary = await readJobSummary(jobSummary([cells()]));
    const comparison = await comparisonFor(summary, nameSearch(), NAME_ONLY_INPUT);
    // The digest is a pure function of the stored packet: re-derivation agrees.
    assert.equal(
      deriveIdentityEvidenceDigest(comparison.packet),
      comparison.evidenceDigest,
    );
    const approved = await verifyIdentityApprovalTask.impl.run({
      input: {
        packet: comparison.packet,
        evidenceDigest: comparison.evidenceDigest,
        approval: {
          decision: "approved",
          eid: EID,
          chosenFrom: "checked",
          evidenceDigest: comparison.evidenceDigest,
        },
      },
      ctx: taskCtx,
    }) as { approved: { evidenceDigest: string } };
    assert.equal(approved.approved.evidenceDigest, comparison.evidenceDigest);
  });

  it("separations-identity-check/gate-rejected — a rejection names what the operator saw", async () => {
    const summary = await readJobSummary(jobSummary([cells({ hrStatus: "Inactive" })]));
    const comparison = await comparisonFor(summary, nameSearch(), NAME_ONLY_INPUT);
    await assert.rejects(
      verifyIdentityApprovalTask.impl.run({
        input: {
          packet: comparison.packet,
          evidenceDigest: comparison.evidenceDigest,
          approval: {
            decision: "rejected",
            reason: "this is the wrong Jose; the document means the student",
            evidenceDigest: comparison.evidenceDigest,
          },
        },
        ctx: taskCtx,
      }),
      /identity-approval-rejected: .*wrong Jose.*employment — document/s,
    );
  });

  it("separations-identity-check/gate-evidence-moved — §14.5: an approval never outlives its packet", async () => {
    const comparison = await comparisonFor(
      await readJobSummary(jobSummary([cells()])),
      nameSearch(),
      NAME_ONLY_INPUT,
    );
    await assert.rejects(
      verifyIdentityApprovalTask.impl.run({
        input: {
          packet: comparison.packet,
          evidenceDigest: comparison.evidenceDigest,
          approval: {
            decision: "approved",
            eid: EID,
            chosenFrom: "checked",
            evidenceDigest: FingerprintSchema.parse("f".repeat(64)),
          },
        },
        ctx: taskCtx,
      }),
      /identity-approval-evidence-moved/,
    );
    // And an EID the packet never showed cannot be approved at all: nothing in
    // this run read that person, so there is nothing to approve.
    await assert.rejects(
      verifyIdentityApprovalTask.impl.run({
        input: {
          packet: comparison.packet,
          evidenceDigest: comparison.evidenceDigest,
          approval: {
            decision: "approved",
            eid: OTHER_EID,
            chosenFrom: "manual",
            evidenceDigest: comparison.evidenceDigest,
          },
        },
        ctx: taskCtx,
      }),
      /identity-approval-eid-not-shown/,
    );
  });

  it("claims exactly the coverage points the gate path walks", async () => {
    const summary = await readJobSummary(jobSummary([cells()]));
    const comparison = await comparisonFor(summary, nameSearch(), NAME_ONLY_INPUT);
    const approval = {
      decision: "approved" as const,
      eid: EID,
      chosenFrom: "checked" as const,
      evidenceDigest: comparison.evidenceDigest,
    };
    const walk = walkDescriptor(separationsIdentityCheckDescriptor, NAME_ONLY_INPUT, {
      outputs: {
        "job-summary": summary,
        "name-search": nameSearch(),
        comparison,
        "identity-approval": approval,
        approval: await verifyIdentityApprovalTask.impl.run({
          input: { packet: comparison.packet, evidenceDigest: comparison.evidenceDigest, approval },
          ctx: taskCtx,
        }),
      },
    });
    const claimed = SEPARATIONS_IDENTITY_CHECK_CLAIMS
      .find(({ scenarioId }) => scenarioId === "separations-identity-check/gate-approved");
    assert.deepEqual([...(claimed?.covers ?? [])].sort(), [...walk.covered].sort());
  });
});
