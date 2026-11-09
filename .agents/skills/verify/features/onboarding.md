# Onboarding

One new hire from the saved roster row becomes a reviewed UCPath hire, an I-9 record and verified master results. Dry run reads and previews; it files, creates and fills nothing.

## Sub-features

- Roster row choice (`roster-choice` gate) and hire mode: New hire or Rehire.
- Read and validate hire data (CRM), Check UCPath duplicates, Search I-9 profiles.
- Review UCPath hire findings, then the write-review gate (operator decision).
- Create or reuse the I-9 record, File and verify the UCPath hire, Fill verified master results.

## Subject and data

There is no synthetic Onboarding subject. At `LIVE GO` the operator supplies a real hire (email) and imports the real onboarding roster into the dashboard Spreadsheets library before Start. Keep that data only under `.work/verify/`; never put it in `config/test-data.json`, a commit, a screenshot caption or a report. Refer to the hire as "operator-provided hire".

## How to get to it (user POV)

Spreadsheets → import the roster (type `onboarding-roster`). Run → Onboarding → choose the saved roster row and the hire mode → Confirm (read the input and step plan; screenshot) → Start with `dryRun` checked.

## Driving it with playwright-cli

Watch Queue and Logs by snapshot. The roster-row choice and the write-review gate park for the operator: report and wait; never choose or approve for them. Stop at the write-review gate.

## Passing dry run

Checkpoint 1 (the agent's stop): Logs show every step before the gate in order: CRM read, UCPath duplicate check, I-9 lookup, findings. The run is parked at the write-review gate with `dryRun` true. The write plan does not exist yet; the agent never approves and reports `parked at hire review`.

Full acceptance (after the operator releases the gate): only the transactions the plan applies to (I-9 profile save and remote I-9 create, or the existing-record path; hire create) show Previewed or stopped-after-prepare, never performed. The hire receipt read and the master fill depend on an unsubmitted hire, so Logs show them Unavailable. `explain run` shows no UCPath submit, no I-9 create and no master-cell fill; the roster cells and workbook version are unchanged. The Explorer timeline for Onboarding matches the Logs steps.

## Gotchas

- Any write step shown as performed means fail and escalate.
- A rehire needs the Rehire mode; check the Confirm screen shows the chosen mode.
