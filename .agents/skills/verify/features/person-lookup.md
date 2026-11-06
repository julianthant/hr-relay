# Person Lookup

Searches or matches one person in UCPath, cross-checks CRM, reads status and optional CRM dates. Read-only.

## Sub-features

- Search by EID or name; Match by name plus DOB or SSN.
- CRM check; keep non-HDH; include CRM dates (needs CRM check).
- Batch start from a spreadsheet: one Queue batch, one row per person; failed member Retry icon sits in its Logs header.

## How to get to it (user POV)

Run → Person Lookup → enter an EID (subject `person-lookup-canary`, value from ignored local config) → Confirm → Start.

## Driving it with playwright-cli

Check `test-data check --json --subject person-lookup-canary` first. Fill the EID from the operator-provided value or the typed reader; never echo it into evidence (evidence names the label). Confirm screen shows the options and step plan.

## Passing dry run

Run reaches Done with a served outcome word (Active, Inactive or Not found). Logs list the UCPath Person Org read and the CRM cross-check. `explain run` shows no write attempt. Queue row title becomes `Last, First · EID #`.

## Gotchas

- Stale backend after a workflow edit refuses the run; restart per hr-manage.
- A down system (UCPath or CRM): record it, skip, continue.
