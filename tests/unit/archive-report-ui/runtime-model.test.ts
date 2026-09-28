import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SavedArchiveReportWireSchema } from "../../../src/domain/dashboard/archive.js";
import {
  archiveInitialSummaryColumns,
  archiveSummaryColumnAlignment,
  archiveSummaryColumnLabel,
  archiveSummaryColumns,
  archiveSummaryValue,
  mergeArchiveSummaryColumns,
} from "../../../src/dashboard/surfaces/archive-runtime-model.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

const first = SavedArchiveReportWireSchema.parse({
  ...H_REPORT,
  runId: "00000000-0000-4000-8000-000000000151",
  sections: [
    { kind: "values", title: "Employment", values: [
      { label: "Employee", value: "Élodie Longname" },
      { label: "Last day worked", value: "2026-08-01" },
      { label: "Hours", value: 0 },
      { label: "Status", value: false },
      { label: "Optional note", value: null },
      { label: "Empty value", value: "" },
      { label: "Empty list", value: [] },
      { label: "Empty record", value: {} },
      { label: "Structured retained value", value: { city: "München", flags: [false, 0] } },
    ] },
    { kind: "values", title: "Retained outcome", values: [{ label: "Status", value: "confirmed" }] },
  ],
});

const heterogeneous = SavedArchiveReportWireSchema.parse({
  ...first,
  runId: "00000000-0000-4000-8000-000000000152",
  sections: [
    { kind: "values", title: "Different historical layout", values: [{ label: "Other field", value: "only this record" }] },
  ],
});

const shifted = SavedArchiveReportWireSchema.parse({
  ...first,
  runId: "00000000-0000-4000-8000-000000000153",
  sections: [
    { kind: "values", title: "New retained introduction", values: [{ label: "Added after archive", value: "keeps its own field" }] },
    { kind: "values", title: "Employment", values: [
      { label: "New leading field", value: "does not move Employee" },
      { label: "Employee", value: "Élodie after a layout change" },
      { label: "Last day worked", value: "2026-08-01" },
      { label: "Hours", value: 0 },
      { label: "Status", value: false },
      { label: "Optional note", value: null },
      { label: "Empty value", value: "" },
    ] },
    { kind: "values", title: "Retained outcome", values: [{ label: "Status", value: "confirmed" }] },
  ],
});

describe("Archive workflow summary columns", () => {
  it("keeps a complete path-backed catalog distinct from the compact initial selection", () => {
    const columns = archiveSummaryColumns([first]);

    assert.equal(columns.length, 10);
    assert.equal(archiveInitialSummaryColumns(columns).length, 5);
    assert.equal(new Set(columns.map(column => column.id)).size, columns.length);
    assert.equal(new Set(columns.map(column => column.path)).size, columns.length);
    assert.equal(columns.some(column => column.path === 'sections["Retained outcome"][0].values["Status"][0].value'), true);
  });

  it("keeps equal labels in their saved sections and distinguishes public scalar states", () => {
    const columns = archiveSummaryColumns([first]);
    const employmentStatus = required(columns.find(column => column.section === "Employment" && column.label === "Status"));
    const outcomeStatus = required(columns.find(column => column.section === "Retained outcome" && column.label === "Status"));
    const lastDayWorked = required(columns.find(column => column.label === "Last day worked"));
    const hours = required(columns.find(column => column.label === "Hours"));
    const optional = required(columns.find(column => column.label === "Optional note"));
    const empty = required(columns.find(column => column.label === "Empty value"));
    const emptyList = required(columns.find(column => column.label === "Empty list"));
    const emptyRecord = required(columns.find(column => column.label === "Empty record"));
    const structured = required(columns.find(column => column.label === "Structured retained value"));

    assert.notEqual(employmentStatus, undefined);
    assert.notEqual(outcomeStatus, undefined);
    assert.notEqual(lastDayWorked, undefined);
    assert.notEqual(hours, undefined);
    assert.notEqual(optional, undefined);
    assert.notEqual(empty, undefined);
    assert.notEqual(emptyList, undefined);
    assert.notEqual(emptyRecord, undefined);
    assert.notEqual(structured, undefined);
    assert.equal(archiveSummaryColumnLabel(employmentStatus, columns), "Employment · Status");
    assert.equal(archiveSummaryColumnLabel(outcomeStatus, columns), "Retained outcome · Status");
    assert.equal(archiveSummaryColumnAlignment(lastDayWorked), "right");
    assert.equal(archiveSummaryColumnAlignment(hours), "right");
    assert.equal(archiveSummaryValue(first, employmentStatus), "false");
    assert.equal(archiveSummaryValue(first, outcomeStatus), "confirmed");
    assert.equal(archiveSummaryValue(first, optional), "null");
    assert.equal(archiveSummaryValue(first, empty), '""');
    assert.equal(archiveSummaryValue(first, hours), "0");
    assert.equal(archiveSummaryValue(first, emptyList), "[]");
    assert.equal(archiveSummaryValue(first, emptyRecord), "{}");
    assert.equal(archiveSummaryValue(first, structured), '{"city":"München","flags":[false,0]}');
  });

  it("preserves loaded-page discoveries without relabelling a heterogeneous saved record", () => {
    const firstColumns = archiveSummaryColumns([first]);
    const laterColumns = archiveSummaryColumns([heterogeneous]);
    const catalog = mergeArchiveSummaryColumns(firstColumns, laterColumns);
    const employment = required(catalog.find(column => column.section === "Employment" && column.label === "Employee"));
    const historical = required(catalog.find(column => column.section === "Different historical layout" && column.label === "Other field"));

    assert.notEqual(employment, undefined);
    assert.notEqual(historical, undefined);
    assert.equal(catalog.length, firstColumns.length + laterColumns.length);
    assert.equal(archiveSummaryValue(heterogeneous, employment), "Absent");
    assert.equal(archiveSummaryValue(heterogeneous, historical), "only this record");
  });

  it("keeps a selected public field when other saved fields shift positional offsets", () => {
    const initial = archiveSummaryColumns([first]);
    const later = archiveSummaryColumns([shifted]);
    const initialEmployee = required(initial.find(column => column.section === "Employment" && column.label === "Employee"));
    const shiftedEmployee = required(later.find(column => column.section === "Employment" && column.label === "Employee"));

    assert.notEqual(initialEmployee, undefined);
    assert.notEqual(shiftedEmployee, undefined);
    assert.equal(first.sections.findIndex(section => section.kind === "values" && section.title === "Employment"), 0);
    assert.equal(shifted.sections.findIndex(section => section.kind === "values" && section.title === "Employment"), 1);
    assert.equal(initialEmployee.id, shiftedEmployee.id);
    assert.equal(initialEmployee.path, 'sections["Employment"][0].values["Employee"][0].value');
    assert.equal(mergeArchiveSummaryColumns(initial, later).filter(column => column.id === initialEmployee.id).length, 1);
    assert.equal(archiveSummaryValue(shifted, initialEmployee), "Élodie after a layout change");
  });

  it("keeps duplicate labels distinct through their saved section and occurrence", () => {
    const duplicateLabels = SavedArchiveReportWireSchema.parse({ ...first,
      sections: [{ kind: "values", title: "Employment", values: [
        { label: "Employee", value: "Primary retained identity" },
        { label: "Employee", value: "Second retained identity" },
      ] }],
    });
    const columns = archiveSummaryColumns([duplicateLabels]);
    const employees = columns.filter(column => column.section === "Employment" && column.label === "Employee");

    assert.equal(employees.length, 2);
    const [primary, secondary] = employees;
    assert.ok(primary !== undefined);
    assert.ok(secondary !== undefined);
    assert.notEqual(primary.id, secondary.id);
    assert.equal(archiveSummaryColumnLabel(primary, columns), "Employment · Employee · 1");
    assert.equal(archiveSummaryColumnLabel(secondary, columns), "Employment · Employee · 2");
    assert.equal(archiveSummaryValue(duplicateLabels, primary), "Primary retained identity");
    assert.equal(archiveSummaryValue(duplicateLabels, secondary), "Second retained identity");
  });
});
