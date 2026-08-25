# Document shapes — hr-scan's memory

One entry per document type. `hr-scan` reads this FIRST and appends/refreshes an entry whenever it meets a new shape or learns a trap. Keep entries short and operational; no personal data, ever. Newest changes carry a date.

## Template (copy for a new shape)

```
## <shape-id> — <human name>            (first seen YYYY-MM-DD · last confirmed YYYY-MM-DD)
**Recognize by:** <title text / form number / header layout / logo / page count pattern>
**Page structure:** <what page 1 holds, what follows; where a new document starts inside a stack>
**Fields:** name → <where, format> · <field> → <where, format> · … (only what the page reliably carries)
**Ignore:** <boilerplate, instructions, signature blocks, anything with SSN/DOB unless required>
**Traps:** <handwriting zones, checkboxes that scan as noise, two-sided scans, stapled extras, date formats>
**Output mapping:** <which emitted columns / which workflow inputRun field each field feeds>
```

## scanner-people-list — scanner stack of one-page-per-person forms            (first seen 2026-08-04 · last confirmed 2026-08-14)
**Recognize by:** filename `Xerox Scan_<date>.pdf`; each page a filled HR form for ONE person; consistent header across pages.
**Page structure:** one person per page (occasionally two pages when the form is double-sided — second page has no name line). New person = page with a name line.
**Fields:** name → top block, printed or handwritten, as `Last, First Middle` or `First Last` (normalize to `Last, First Middle`) · department/unit → header area · employee/position type → checkbox row.
**Ignore:** instructions, signature lines, anything in the SSN/DOB boxes (`9999` = blank).
**Traps:** handwritten names (send to an opus reader); duplicates across pages (same person scanned twice — dedupe); middle initials with/without period; the operator wants UNIQUE names only and usually an EID column via person-lookup.
**Output mapping:** → spreadsheet (`last, first middle`, EID, page) or hr-manage worklist.

## i9-stack — paper Form I-9 pages (Section 1 / Section 2)            (first seen 2026-08-05 · last confirmed 2026-08-06)
**Recognize by:** USCIS Form I-9 header; "Section 1. Employee Information and Attestation" vs "Section 2. Employer Review and Verification" page titles; ~44-page stacks.
**Page structure:** a person = S1 page(s) + S2 page(s), not always adjacent; strays with only one section exist and must be listed as strays, not paired by guess.
**Fields:** name → S1 top (`Last, First, Middle Initial`) · S2 employee name line (must match S1 to pair) · S2 document list / dates → the table; hire date → S2.
**Ignore:** SSN, DOB (never transcribe), preparer/translator block unless the audit asks.
**Traps:** pairing S1↔S2 by name only when exact; a shred verdict requires the operator to CONFIRM the shred criterion first (the audit is a decision, not a parse); two S1s for one name = two people until disproven.
**Output mapping:** → shred-audit table (person, S1 pages, S2 pages, verdict, reason) — verdicts only after the criterion is confirmed.

## onboarding-packet — per-person onboarding evidence set            (first seen 2026-08-18 · last confirmed 2026-08-20)
**Recognize by:** a set of separate PDFs per person: `Signed Offer Letter`, `EE Data Gathering Form`, sometimes ID copies / direct-deposit forms.
**Page structure:** each document its own file; the packet is the folder.
**Fields:** name → offer letter salutation / EE form top · start date, title, department, pay rate → offer letter body and EE form rows.
**Ignore:** ID images beyond "present / absent"; banking details.
**Traps:** canonical document names matter (`Signed Offer Letter`, `EE Data Gathering Form`); name casing is Title Case, never ALL CAPS; packets are filed under `YYYY-MM-DD/<Name>/` as folders, not zips.
**Output mapping:** → onboarding worklist for hr-manage; evidence folder check.

## roster-xlsx — cohort roster spreadsheet (Teams/SharePoint export)            (first seen 2026-08-18 · last confirmed 2026-08-18)
**Recognize by:** `.xlsx` with one row per person, header row with name / EID / dept / status columns.
**Page structure:** n/a (tabular).
**Fields:** as headers; normalize name to `Last, First Middle`; EID as string (leading zeros).
**Ignore:** hidden sheets unless named; formatting.
**Traps:** don't re-download if the operator already gave you the cohort; diff against the known list and only act on the delta; SSO-gated link — fetch via the browser session, not curl.
**Output mapping:** → hr-manage worklist (row id, label/EID).
