
import {
  activityErrorRatePercent,
  activityReportCaveats,
  activityStatusRuns,
  type ActivityReportWire,
} from "../../../models/dashboard/activity.js";

import { spreadsheetCsvRow as row } from "../exports/spreadsheet-csv.js";

export function activityReportCsvFileName(report: ActivityReportWire): string {
  return `activity-${report.from}_${report.to}.csv`;
}

export function activityReportCsv(report: ActivityReportWire): string {
  const blocks: string[][] = [];

  blocks.push([
    row(["Activity report"]),
    row(["Window from", report.from]),
    row(["Window to", report.to]),
    row(["Generated at", report.generatedAt]),
    row(["Wire version", report.wireVersion]),
  ]);

  // Put counting rules before totals so a partial spreadsheet view still shows their meaning.
  blocks.push([
    row(["How this report is counted"]),
    row(["Rule"]),
    ...activityReportCaveats(report).map((caveat) => row([caveat])),
  ]);

  blocks.push([
    row(["Totals"]),
    row(["Measure", "Value"]),
    row(["Runs in range", report.totalRuns]),
    row(["Terminal runs", report.terminalRuns]),
    row(["Still open", report.inFlightRuns]),
    row(["Read back", report.completion.readBack]),
    row(["Warnings", report.completion.warnings]),
    row(["Warnings unread", report.completion.warningsUnknown]),
    row([
      "Distinct people",
      report.people.state === "present" ? report.people.distinct : report.people.reason,
    ]),
    row(["Person identity evidence rows", report.people.evidenceRows]),
    ...(report.people.state === "absent"
      ? [row(["Person identity unavailable rows", report.people.unavailableRows])]
      : []),
    row(["Failed runs", activityStatusRuns(report, "failed")]),
    row(["Error rate %", activityErrorRatePercent(report)]),
    row(["Measured durations", report.durations.measuredRuns]),
    row(["Unmeasured durations", report.durations.unmeasuredRuns]),
    // Export an absent quantile reason; zero would be averaged as a real measurement.
    row([
      "Median duration (ms)",
      report.durations.medianMs.state === "present"
        ? report.durations.medianMs.value
        : report.durations.medianMs.reason,
    ]),
    row([
      "Longest duration (ms)",
      report.durations.longestMs.state === "present"
        ? report.durations.longestMs.value
        : report.durations.longestMs.reason,
    ]),
    row([
      "Longest duration run",
      report.durations.longestMs.state === "present" ? report.durations.longestMs.runId : "",
    ]),
    row(["Total measured duration (ms)", report.durations.totalMs]),
  ]);

  blocks.push([
    row(["Still open — by what it is waiting on"]),
    row(["Status", "Runs", "Sample run ids"]),
    ...report.statuses.map((status) => row([status.status, status.runs, status.sample.join(" ")])),
  ]);

  blocks.push([
    row(["By workflow"]),
    row([
      "Workflow", "Code", "Label", "Category", "Runs",
      "Read back", "Warnings", "Unread", "Failed", "Cancelled", "Partial", "Open",
    ]),
    ...report.workflows.map((workflow) => row([
      workflow.workflowId,
      // Export short code as its own sortable column instead of embedding it in the workflow label.
      workflow.registration.state === "registered" ? workflow.registration.code : "",
      // Never an id dressed as a label: an unregistered workflow exports the
      // reason the report gives on screen.
      workflow.registration.state === "registered" ? workflow.registration.label : workflow.registration.reason,
      workflow.registration.state === "registered" ? workflow.registration.categoryId : "",
      workflow.runs,
      workflow.completion.readBack,
      workflow.completion.warnings,
      workflow.completion.warningsUnknown,
      workflow.failed,
      workflow.cancelled,
      workflow.partial,
      workflow.open,
    ])),
  ]);

  blocks.push([
    row(["By category"]),
    row(["Category", "Runs"]),
    ...report.categories.map((category) => row([
      category.category.state === "registered" ? category.category.categoryId : category.category.reason,
      category.runs,
    ])),
  ]);

  blocks.push([
    row(["By day"]),
    row(["Day", "Runs"]),
    ...report.days.map((day) => row([day.day, day.runs])),
  ]);

  blocks.push([
    row(["By outcome"]),
    row(["Outcome", "Runs"]),
    ...report.outcomes.map((outcome) => row([outcome.outcome, outcome.runs])),
  ]);

  blocks.push([
    row(["Failures"]),
    row(["Code", "Runs", "Transient", "Sample run ids"]),
    ...(report.failures.length === 0
      ? [row(["No run in this range settled with a structured failure."])]
      : report.failures.map((failure) => row([
        failure.code, failure.runs, failure.transient, failure.sample.join(" "),
      ]))),
  ]);


  blocks.push([
    row(["Write ledger — what was actually filed"]),
    row(["A separate authority from every total above; confirmed entries survive Archive transfer and remain until explicit owner deletion."]),
    row(["System", "Entries", "Production", "Test instance"]),
    ...(report.ledger.systems.length === 0
      ? [row(["No ledger entries. Nothing in this report's reach filed anything into a real HR system."])]
      : report.ledger.systems.map((line) => row([line.system, line.entries, line.prod, line.test]))),
  ]);

  return `${blocks.map((lines) => lines.join("\r\n")).join("\r\n\r\n")}\r\n`;
}
