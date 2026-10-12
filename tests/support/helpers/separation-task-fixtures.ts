import { EidSchema, IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { type DataPoint } from "../../../src/rules/workflow/task-provenance.js";
import { type UcpathJobRow, type UcpathJobSummary, UcpathJobSummarySchema } from "../../../src/models/ui/ucpath-job-summary.js";
import { type UcpathPersonSelection } from "../../../src/models/systems/ucpath/search-person-org.js";



export class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function createSeparationTaskFixtures() {
  const DOCUMENT = "4444";

  const EID = EidSchema.parse("10800000");

  const NAME = "Person, Deterministic";

  const NOW = IsoInstantSchema.parse("2026-08-14T19:00:00.000Z");

  function taskContext() {
    const records: DataPoint[] = [];
    const ctx = {
      signal: new AbortController().signal,
      log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
      fail: (code: string, message: string): never => {
        throw new TaskRefusal(code, message);
      },
      recordData(input: DataPoint | readonly DataPoint[]): void {
        records.push(...(Array.isArray(input) ? input : [input]) as DataPoint[]);
      },
    };
    return { ctx: ctx as never, records };
  }

  function cell(value: string) {
    return { state: "present" as const, value };
  }

  function absentCell(reason: string) {
    return { state: "absent" as const, reason };
  }

  function jobRow(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
    return {
      rowIndex: 0,
      emplRecord: "0",
      hrStatus: "Active",
      businessUnit: "SDCMP",
      effectiveDate: cell("07/01/2025"),
      positionNumber: cell("40012345"),
      deptId: cell("000412"),
      department: cell("HOUSING/DINING/HOSPITALITY"),
      jobCode: cell("004921"),
      jobTitle: cell("STDT 2"),
      expectedJobEndDate: absentCell("the grid rendered this cell empty"),
      fte: cell("0.500000"),
      emplClass: cell("Student"),
      ...overrides,
    };
  }

  function jobSummary(rows: readonly UcpathJobRow[] = [jobRow()], emplId = EID): UcpathJobSummary {
    return UcpathJobSummarySchema.parse({
      pageStateId: "ucpath.person-org.detail-ready",
      emplId,
      displayedName: NAME,
      jobRows: [...rows],
      rowCount: rows.length,
      renderContext: {
        entry: "auto-detail",
        searchResultRows: 0,
        employmentInstances: "already-complete",
      },
      observedAt: NOW,
    });
  }

  const nameSelection: UcpathPersonSelection = {
    status: "resolved",
    selected: {
      emplId: EID,
      name: NAME,
      department: "Housing Dining Hospitality",
      jobTitle: "STDT 2",
      employeeStatus: "active",
      hdh: true,
    },
    candidateEids: [EID],
  };
  return { DOCUMENT, taskContext, cell, jobRow, jobSummary, EID, NAME, NOW, nameSelection };
}
