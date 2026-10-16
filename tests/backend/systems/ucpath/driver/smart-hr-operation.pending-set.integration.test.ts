import assert from "node:assert/strict";

import type { Page } from "playwright";
import { describe, it } from "vitest";
import { joinPendingSweepGridRows, readInProgressSubjectOnPage } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-operation.js";
import type { UcpathPendingSweepTarget, UcpathTransactionRow } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema, IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
import { createDeterministicUcpathDriverRow } from "../../../../support/helpers/ucpath-pending-row-fixtures.js";

const EID = EidSchema.parse("10203262");
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-28T19:00:00.000Z");
const { transactionRow } = createDeterministicUcpathDriverRow(EID);

function sweepTarget(
  eligible: readonly UcpathTransactionRow[],
  protectedRows: readonly UcpathTransactionRow[] = [],
): UcpathPendingSweepTarget {
  return {
    emplId: EID,
    expectedName: "Deterministic Person",
    observedSet: {
      kind: "ucpath-pending-termination-set",
      emplId: EID,
      eligible: [...eligible],
      protected: [...protectedRows],
      observedAt: OBSERVED_AT,
      source: "ss-smart-hr-detail-read",
    },
  };
}

function gridRow(overrides: Partial<Readonly<{
  transactionType: string;
  effectiveDate: string;
  displayedName: string;
  emplId: typeof EID;
  action: string;
  country: string;
}>> = {}) {
  return {
    transactionType: "Termination",
    effectiveDate: "06/11/2026",
    displayedName: "Deterministic Person",
    emplId: EID,
    action: "Terminatn",
    country: "USA",
    ...overrides,
  };
}

describe("Transactions in Progress exact-set join", () => {
  it("joins the stable T id through the complete shared facts and excludes protected filings", () => {
    const eligible = transactionRow();
    const protectedFiling = transactionRow({
      transactionId: "T009000002",
      approvalStatus: "Approved",
    });
    assert.deepEqual(
      joinPendingSweepGridRows(sweepTarget([eligible], [protectedFiling]), [gridRow()]),
      [{ candidateIndex: 0, selected: { ...gridRow(), transactionId: eligible.transactionId } }],
    );
  });

  it("refuses changed, newly appeared and ambiguous rows before selection", () => {
    const first = transactionRow();
    const second = transactionRow({ transactionId: "T009000002" });
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first]), [gridRow({ effectiveDate: "06/12/2026" })]),
      /joined 0 Transactions in Progress rows/u,
    );
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first]), [gridRow(), gridRow({ effectiveDate: "06/12/2026" })]),
      /exposed 2 eligible rows/u,
    );
    assert.throws(
      () => joinPendingSweepGridRows(sweepTarget([first, second]), [gridRow(), gridRow()]),
      /joined 2 Transactions in Progress rows/u,
    );
  });

  it("reads the staged subject through named row controls and refuses conflicting names", async () => {
    const page = (rows: readonly Readonly<{ eid: string; name: string }>[]): Page => ({
      locator: () => ({
        all: async () => rows.map((row) => ({
          locator: (selector: string) => ({
            count: async () => 1,
            innerText: async () => selector.includes("EMPLID") ? row.eid : row.name,
          }),
        })),
      }),
    }) as unknown as Page;

    assert.equal(
      await readInProgressSubjectOnPage(page([
        { eid: EID, name: "Person, Deterministic" },
        { eid: EID, name: "Deterministic Person" },
      ]), EID),
      "Person, Deterministic",
    );
    await assert.rejects(
      readInProgressSubjectOnPage(page([
        { eid: EID, name: "Person, Deterministic" },
        { eid: EID, name: "Somebody Else" },
      ]), EID),
      /2 distinct names/u,
    );
  });
});
