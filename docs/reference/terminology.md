# Relay terminology

| Term | Meaning |
| --- | --- |
| Onboarding (sign-up) | Creating a Relay profile and signing in with Duo, owned by `src/backend/profiles/`. |
| Onboarding workflow | Hiring a person through CRM, UCPath and I-9, owned by `src/workflows/onboarding/`. |
| Operator | The one HR person using the dashboard. |
| Served / mock | Dashboard data from the backend or fixtures, selected per workflow in `config/dashboard-workflow-sources.json`. [Dashboard instructions](../../src/dashboard/AGENTS.md#rules) own source-switch rules. |
| Dry run | `dryRun=true`: a live read and preview of every applicable form, with no UCPath submission or Kuali finalization. Local run evidence may persist. It is different from a mock run. |
| Sign-off | The operator's explicit approval of a workflow's live dry run. Tests do not constitute sign-off. [Dashboard ready on the Mac](../roadmap/roadmap.md#dashboard-ready-on-the-mac) owns the release sequence. |
| Person Lookup | A read-only UCPath person search cross-checked against CRM, also delegated to by other workflows. |
| Separations | One Kuali separation document processed into an employee termination across Kuali, UCPath and Kronos. Writes occur only outside dry runs. |
| OCR | PDF page reading, record grouping and identity lookup for operator review and release. It writes nothing to HR systems. |
| EC (Emergency Contact) | A PDF operation that delegates approved OCR records to EC members, each previewing or saving one person's primary UCPath contact. EC consumes OCR; it is a separate workflow. |
| Parent / delegated rows / member list | A parent delegates work to child runs. The Queue displays children as delegated rows. The member list contains approved records in source order. Children are not independent operator-started runs. |
| Settled parent | A parent whose members have all finished. A mixed-outcome EC parent still admits eligible failed-member Retry; UNKNOWN and a committed or unresolved Save refuse. [Dashboard contract](dashboard-surfaces.md) owns member controls. |
| SharePoint Download | Sync of one SharePoint `.xlsx` or `.csv` into the Spreadsheets library, rather than a workflow. |
| Spreadsheets library | The typed workbook store, with one mutable master per workbook and manual named versions. [Backend instructions](../../src/backend/AGENTS.md#product-boundaries) own workflow-output placement. |
