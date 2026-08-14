# Frontend/backend findings ledger (non-normative)

Session-recorded mismatches between the dashboard frontend, the served wire, and the plan
docs — kept here so a FUTURE session can triage each entry into the owning doc
(`docs/rebuild/*`) and design the fix. Standing operator rules recorded 2026-08-14:

- **Backend problems are diagnosed and recorded here, never fixed in a frontend session.**
- **A frontend feature not listed in the plans is not built** — it gets an entry here instead.
- Every entry names the symptom, the evidence, the mechanism (when diagnosed), and what a fix
  would involve, so the next session starts from the diagnosis rather than re-deriving it.

This folder is NOT plan SSOT. Nothing here is a ratified decision (doc 04 rules apply);
entries graduate by landing in their owning doc and being deleted or marked triaged here.

| Entry | Status |
| --- | --- |
| [2026-08-14 — composed-run timeline is empty](2026-08-14-run-timeline-empty.md) | diagnosed |
| [2026-08-14 — chunk workflows render as sibling workflows](2026-08-14-rail-composition-taxonomy.md) | recorded |
