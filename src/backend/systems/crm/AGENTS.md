# CRM store

ACT CRM onboarding reads for Person Lookup. Raw Playwright access and locator recipes stay under
`driver/`; tasks import only the task-safe declaration at `driver-declaration.ts` and the schema-first
domain driver contract.

## Person Lookup invariants

- `ONB_SearchOnboardings?q=` is fuzzy. A search row is never identity proof.
- Record identity reads use the same resolver: search by EID, open every plausible record, and accept only an
  exact displayed `UCPath Employee ID`. The optional name fallback keeps the same exact-EID gate.
- Zero exact displayed-EID records is a genuine absence; more than one is ambiguous and throws.
- Search data rows have exactly five direct `td` cells. The one live-verified two-cell auxiliary row
  is non-data; any other shape, missing record link, wrong host/path, or missing field selector
  throws.
- Selected-record verification reopens its exact URL and record ID, refuses changed displayed EID
  or name, and returns the current record facts. Acquisition failures remain Check failed.
- Multiple forms with one exact EID prove one person, but only unanimous facts can describe them; a single selected form requires separate confidence.
- Dates without an available name return an explicit not-read binding and no-confident-record with null dates; no query or displayed identity is claimed.
- Employment date is `First Day of Service (Effective Date)` and oath date is `Date Signed`.
  History transitions do not supply either date.
- Blank dates become absence only after the record's displayed EID and the exact page state have
  been verified. Missing selectors and malformed nonblank dates fail the check; Person Lookup
  returns Check failed, while the shared onboarding-record read throws.
- Wait for the SSO form before choosing Active Directory, verify the selected option value after reload, and distinguish the Communities login form from an authenticated landing.
- Scope login controls by verified IDs and names; realm-dependent labels do not prove the selected realm.

## Further reading

Before changing login, selectors, or history interpretation, read `session.ts` and `driver/` for
current recipes and `docs/rebuild/reference/stores.md` for the current task catalog.
Root rules apply.
