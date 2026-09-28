import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SavedArchiveGroupsWireSchema, SavedArchiveReportWireSchema, SavedRuntimeVersionIndexWireSchema, type SavedRuntimeVersionIndexWire } from "../../../src/domain/dashboard/archive.js";
import {
  archiveInitialSummaryColumns,
  archiveReportCount,
  archiveReviewMatchesPreview,
  archiveReviewRunLabel,
  archiveRuntimeVersionPreview,
  archiveSummaryColumnAlignment,
  archiveSummaryColumnLabel,
  archiveSummaryColumns,
  archiveSummaryValue,
  mergeArchiveSummaryColumns,
  groupArchiveVersions,
} from "../../../src/dashboard/surfaces/archive-runtime-model.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

it("retains current, multiple historical and unknown groups without merging workflows or run counts", () => {
  const groups = SavedArchiveGroupsWireSchema.parse({ groups: [
    { dashboardVersion: { major: 2, minor: 0 }, workflow: "person-lookup", workflowVersion: { major: 2, minor: 1 }, reportCount: 1, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: { major: 1, minor: 1 }, workflow: "person-lookup", workflowVersion: { major: 1, minor: 2 }, reportCount: 2, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: { major: 1, minor: 0 }, workflow: "person-lookup", workflowVersion: { major: 1, minor: 1 }, reportCount: 3, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: { major: 1, minor: 0 }, workflow: "separations", workflowVersion: { major: 1, minor: 0 }, reportCount: 1, latestCompletedAt: H_REPORT.completedAt },
    { dashboardVersion: null, workflow: "retired-workflow", workflowVersion: null, reportCount: 1, latestCompletedAt: H_REPORT.completedAt },
  ] });
  const projected = groupArchiveVersions(groups.groups);
  assert.deepEqual(projected.map(row => [row.key, row.reportCount, row.workflows.length]), [
    ["2.0", 1, 1], ["1.1", 2, 1], ["1.0", 4, 2], ["unrecorded", 1, 1],
  ]);
  assert.equal(archiveReportCount(1), "1 run");
  assert.equal(archiveReportCount(4), "4 runs");
  assert.deepEqual(groupArchiveVersions([]), []);
});

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

describe("Archive normalized version previews", () => {
  const wire = SavedRuntimeVersionIndexWireSchema.parse({ revision: 1,
    dashboard: { major: 2, minor: 0 }, changes: [], workflows: [
      { workflowId: "person-lookup", label: "Person lookup", version: { major: 2, minor: 1 } },
      { workflowId: "separations-kuali-read", label: "Separations", version: { major: 2, minor: 4 } },
    ] });

  it("keeps a two-workflow proper subset minor with unchanged dashboard", () => {
    const preview = archiveRuntimeVersionPreview(wire, "workflows", ["person-lookup"]);
    assert.ok(preview !== null);
    assert.deepEqual(preview.scope, { kind: "workflows", workflowIds: ["person-lookup"] });
    assert.deepEqual(preview.transition.after.dashboard, wire.dashboard);
    assert.deepEqual(preview.transition.after.workflows, [
      { workflowId: "person-lookup", version: { major: 2, minor: 2 } },
      { workflowId: "separations-kuali-read", version: { major: 2, minor: 4 } },
    ]);
  });

  it("normalizes two selected workflows and explicit all scope to the same major transition", () => {
    const selected = archiveRuntimeVersionPreview(wire, "workflows", ["separations-kuali-read", "person-lookup"]);
    const all = archiveRuntimeVersionPreview(wire, "dashboard", []);
    assert.ok(selected !== null);
    assert.deepEqual(selected, all);
    assert.deepEqual(selected.scope, { kind: "dashboard" });
    assert.deepEqual(selected.transition.after.dashboard, { major: 3, minor: 0 });
    assert.ok(selected.transition.after.workflows.every(row => row.version.major === 3 && row.version.minor === 0));
  });

  it("normalizes a one-workflow registry and refuses empty or retired selection", () => {
    const sole = SavedRuntimeVersionIndexWireSchema.parse({ ...wire, workflows: wire.workflows.slice(0, 1) });
    const preview = archiveRuntimeVersionPreview(sole, "workflows", ["person-lookup"]);
    assert.ok(preview !== null);
    assert.deepEqual(preview.scope, { kind: "dashboard" });
    assert.deepEqual(preview.transition.after.dashboard, { major: 3, minor: 0 });
    assert.deepEqual(preview.transition.after.workflows[0]?.version, { major: 3, minor: 0 });
    assert.equal(archiveRuntimeVersionPreview(wire, "workflows", []), null);
    assert.equal(archiveRuntimeVersionPreview(wire, "workflows", ["retired-workflow"]), null);
    assert.equal(archiveRuntimeVersionPreview(SavedRuntimeVersionIndexWireSchema.parse({ ...wire, workflows: [] }), "dashboard", []), null);
  });

  it("refuses a review whose returned versions disagree with the normalized selection", () => {
    const minor = archiveRuntimeVersionPreview(wire, "workflows", ["person-lookup"]);
    const all = archiveRuntimeVersionPreview(wire, "workflows", ["person-lookup", "separations-kuali-read"]);
    assert.ok(minor !== null && all !== null);
    const reviewed = { scope: minor.scope, before: minor.transition.before, after: minor.transition.after } as SavedRuntimeVersionIndexWire["changes"][number];
    assert.equal(archiveReviewMatchesPreview(minor, reviewed), true);
    assert.equal(archiveReviewMatchesPreview(all, reviewed), false);
    assert.equal(archiveReviewMatchesPreview(minor, { ...reviewed, after: all.transition.after }), false);
    assert.equal(archiveReviewMatchesPreview(minor, { ...reviewed, before: { ...reviewed.before, workflows: reviewed.before.workflows.map(row => row.workflowId === "person-lookup" ? { ...row, version: { major: 2, minor: 0 } } : row) } }), false);
  });
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

it("right-aligns the exact retained Termination effective date column", () => {
  const report = SavedArchiveReportWireSchema.parse({ ...H_REPORT, sections: [{ kind: "values", title: "Employment", values: [
    { label: "Termination effective date", value: "2026-08-01" }, { label: "Employee", value: "Synthetic person" },
  ] }] });
  const columns = archiveSummaryColumns([report]);
  assert.equal(archiveSummaryColumnAlignment(required(columns.find(column => column.label === "Termination effective date"))), "right");
  assert.equal(archiveSummaryColumnAlignment(required(columns.find(column => column.label === "Employee"))), "left");
});

it("uses distinct compact reviewed run identities and full IDs when abbreviations collide", () => {
  const first = "aa11bb22-0100-4000-8000-000000000001";
  const second = "aa11bb22-0100-4000-8000-000000000002";
  const collision = "aa11bb22-0200-4000-8000-000000000001";
  assert.equal(archiveReviewRunLabel(first, [first, second]), "aa11bb22…00000001");
  assert.equal(archiveReviewRunLabel(second, [first, second]), "aa11bb22…00000002");
  assert.equal(archiveReviewRunLabel(first, [first, collision]), first);
  assert.equal(archiveReviewRunLabel(collision, [first, collision]), collision);
});
