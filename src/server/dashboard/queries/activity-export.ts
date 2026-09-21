/**
 * The Activity report's served CSV export (D240, ref frontend-backend-integration §6.7).
 *
 * ## The rules travel with the numbers, or the export is a lie
 *
 * Ref frontend-backend-integration §5 has carried `export if later served` in the Activity row since 2i,
 * and `docs/findings/activity.md` recorded the condition attached to building
 * it: **an exported report with the numbers and without the rules is precisely
 * the lying artifact this surface's whole design prevents.** The panel puts its
 * caveats one press away in the ⓘ because a caveat in a footnote nobody scrolls
 * to is a caveat nobody read; a CSV has no ⓘ, so the caveats are a BLOCK of the
 * artifact, ahead of every total they qualify.
 *
 * They are the SAME sentences, not a second copy: `activityReportCaveats` lives
 * in the browser-safe contract and both consumers read it, so a rule that moves
 * moves in both places. Two copies would be the same lie with a delay on it.
 *
 * ## It exports the SERVED payload, and nothing it was not handed
 *
 * Every number below is read off `ActivityReportWire` — including the error
 * rate, which comes from the one `activityErrorRatePercent` the tile renders,
 * so the exported rate cannot round differently than the screen it was taken
 * from. Nothing here re-counts, re-buckets or re-derives, which is D81's rule
 * restated for a second consumer of one payload.
 *
 * What is deliberately ABSENT: the panel footer's operator id and app build.
 * Those are client props that never crossed this wire, and a server composing
 * them would be asserting provenance about a reader it cannot see. The window,
 * the generation instant and the wire version are on the payload, and they are
 * what the header block carries.
 *
 * ## Shape
 *
 * Labelled blocks separated by a blank line, each with its own header row —
 * the shape a spreadsheet opens correctly and a person reads top to bottom.
 * Text cells with formula prefixes are escaped with an apostrophe before RFC 4180 quoting.
 * Numeric values retain their numeric representation.
 */
import {
  activityErrorRatePercent,
  activityReportCaveats,
  activityStatusRuns,
  type ActivityReportWire,
} from "../../../domain/dashboard/activity.js";

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

  // AHEAD of the totals, on purpose: a reader who stops after the first screen
  // of a spreadsheet has still read the rules the numbers were counted by.
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
    // D124 at one more remove: an absent quantile exports its REASON, never a
    // zero that a spreadsheet would happily average.
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
      // The short code gets its own column rather than being folded into the
      // label: a spreadsheet sorts and filters columns, and gluing `sd` onto
      // the front of a label would make both halves unfilterable. An
      // unregistered workflow exports an EMPTY code for the same reason it
      // exports an empty category — it has no registry row to read one from,
      // and the reason it has none is already in the Label cell.
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

  // D236's second authority, labelled as one HERE too — the exported copy is
  // read without the panel's subtitle beside it, so the block states its own
  // seam rather than relying on the caveat block alone.
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
