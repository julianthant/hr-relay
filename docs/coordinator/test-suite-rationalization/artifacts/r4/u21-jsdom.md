# R4 u21 — jsdom ownership, runtime, and output

## Ownership

The jsdom population remains 21 files / 258 cases. No jsdom file was deleted or converted to a
source-text snapshot. These files own real DOM semantics: presses, focus/blur/Escape behavior,
dialog and disclosure lifecycle, React cleanup, request races, and stateful ARIA changes. Static
render arms that share a file with a DOM interaction remain beside the same component capability;
splitting them would add fixture/import cost without removing the jsdom environment from the file.

The highest-cost files remain justified: `run-captures-app` owns the full real DashboardApp and
typed-client lifecycle across 41 cases; `run-start-dialog` owns start-dialog interaction/refusal;
`explorer-edit-dialog` owns edit-dialog keyboard and validation behavior.

## Actionable output defect

A focused baseline across `ui-catalog-surface`, `failure-record-render`, and
`run-detail-timeline-render` passed 35/35 but printed the React diagnostic
`The current testing environment is not configured to support act(...)` 36 times. Each file calls
React `act` directly but lacked the environment declaration already used by the other direct-root
jsdom files.

Each now declares `IS_REACT_ACT_ENVIRONMENT` at the file boundary. The same focused family plus the
new `IconButton` semantics passed 4 files / 36 cases in 1.30 seconds with zero act-environment or
not-wrapped-in-act diagnostics. No diagnostic was globally suppressed; unexpected React output
would still surface with project, file, suite, and full behavior title.

## Before / after

| Measure | Intake | Final candidate |
| --- | ---: | ---: |
| jsdom files | 21 | 21 |
| jsdom cases | 258 | 258 |
| summed per-file runtime | 23.402 s | 17.165 s |
| focused React act diagnostics | 36 | 0 |

Runtime is observational, not a claimed performance improvement: both measurements share the same
command shape but run-to-run host contention differs. The structural result is that no DOM risk was
discarded and no file moved into jsdom.
