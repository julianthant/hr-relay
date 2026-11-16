# Separations

One Kuali separation document becomes one terminated employee across Kuali, UCPath and Kronos. Dry run reads and previews; it files and finalizes nothing.

## Sub-features

- Entry by Employee ID or Kuali document number.
- Identity from supplied-EID read-back, or the name-only gate (operator decision).
- Date reconciliation against the Kronos timecard; pending-termination check; termination preview; receipt verification preview; Kuali finalization preview.

## How to get to it (user POV)

Run → Separations → Enter EID or Enter document number (subject `finalization-canary`, document number from ignored local config) → Confirm → Start with `dryRun` checked.

## Driving it with playwright-cli

`test-data check --json --subject finalization-canary` first. Watch Logs by snapshot. The identity gate and any approval gate park for the operator: report and wait; never approve.

## Passing dry run

Logs show Kuali, UCPath and Kronos reads done and every transaction stage as previewed or Not clicked. No UCPath submit, no Kuali finalization; the Kuali document stays unsaved and unchanged. `explain run` shows no write attempt. The Explorer timeline for the workflow matches the Logs steps. In the planned values, the comment initials (`-XY` in the date-change and finalization comments) equal the signed-in account's Timekeeper initials, not letters derived from the timekeeper name.

## Gotchas

- Separations proposals from the assistant always use dry-run mode; the Run modal must still show `dryRun` checked.
- Stop at the first write boundary; a finalization stage that shows as performed means fail and escalate.
