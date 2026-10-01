# CRM store

ACT CRM onboarding reads for Person Lookup. Raw Playwright access and locator recipes stay under
`driver/`; tasks import only the task-safe declaration at `../declaration.ts` and the schema-first
domain driver contract.

## Person Lookup invariants

- `ONB_SearchOnboardings?q=` is fuzzy. A search row is never identity proof.
- Both reads use the same resolver: search by EID, open every plausible record, and accept only an
  exact displayed `UCPath Employee ID`. The optional name fallback keeps the same exact-EID gate.
- Zero exact displayed-EID records is a genuine absence; more than one is ambiguous and throws.
- Search data rows have exactly five direct `td` cells. The one live-verified two-cell auxiliary row
  is non-data; any other shape, missing record link, wrong host/path, or missing field selector
  throws.
- `invitedOn` is the `ProcessStageText → Offer Letter Sent` history transition; `startsOn` is the
  record's `First Day of Service (Effective Date)`; `completedOn` is the
  `ProcessStageText → Completed` transition. `Date Signed` is not completion.
- Blank dates become absence only after the record's displayed EID and the exact page state have
  been verified. Missing selectors and malformed nonblank dates throw.

## Further reading

Before changing login, selectors, or history interpretation, search [LESSONS.md](LESSONS.md) and
read the matching entries; its Provenance section preserves the port sources. Use `driver/` for
current recipes and `docs/rebuild/reference/stores.md` for the current task catalog.
Requested lessons go in that ledger. Keep this file and `CLAUDE.md` identical; root rules apply.
