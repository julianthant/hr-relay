# Relay roadmap

Statuses: `done`, `now`, `next`, `later`. One line per key implementation.

## Foundation

- [done] Approved mock dashboard frozen — 146 key-state screenshots are the visual contract; unused UI removed.
- [now] One combined codebase — frontend, backend and launch fixes merged onto one branch.
- [next] Cleanup — old plans, history docs, decision log and CLAUDE.md removed; new AGENTS.md.
- [next] AI providers removed — only the ChatGPT-subscription OCR entry point remains.
- [next] Every check green — typecheck, lint, tests, screenshots and coverage pass; merged into master.
- [next] Docs and comments describe the current system — no decision numbers, dates or history.

## Wiring base

Every component connected to real backend data. Each workflow keeps its mock until its own step.

- [next] Shell, workflow catalog and Queue — real day, runs and row commands.
- [next] Run and Rerun — real start plans and command results.
- [next] Logs and decisions — real steps, actions and live updates.
- [next] Explorer — timelines generated from registered workflow definitions.
- [next] OCR and Records — real records, corrections and approval.
- [next] Settings — saved values, credentials and storage paths.
- [next] ChatGPT account — Sign in with ChatGPT so OCR runs on the operator's subscription.
- [next] Preflight and storage — real readiness checks.
- [next] Sessions and workers — real workers and controls.
- [next] Notifications and search — durable inbox and cross-day search.
- [next] Analytics and exports — real metrics, CSV and XLSX.
- [next] Spreadsheets and Intake — saved workbooks and roster imports.
- [next] Error codes — every failure shows its defined code and text.

## Workflows

One at a time: dry run and operator sign-off before the next.

- [later] Person Lookup
- [later] Separations
- [later] OCR
- [later] Oath Signature
- [later] Oath Upload
- [later] Emergency Contact
- [later] OnBase Emergency Contact
- [later] I-9 Check
- [later] I-9 Lookup
- [later] Onboarding
- [later] Work-Study
- [later] Kronos Pay Rule
- [later] CRM Document Download
- [later] SharePoint Download
- [later] Old Kronos Reports
- [later] Background Check

## Release

- [later] Cutover — the rebuild replaces production in one switch.
- [later] Desktop app — packaged local app.
