# Status — Dashboard readiness — 2026-08-31 (HEAD 0d5809c1)

_Plan source: `docs/rebuild/03a-finish-the-dashboard.md`,
`docs/rebuild/04-close-the-deferrals.md`, and
`docs/rebuild/reference/frontend-backend-integration.md`. Verified against: current source and
pending-wire inventory, final integrated coverage/parity receipts, `npm run web:build`, Git state,
and `npm run cli -- phase`._

## 1 · Complete

| item | evidence | since |
|---|---|---|
| Dashboard development bundle | `npm run web:build` passed at this checkout; emitted `index.html`, `capture.html`, `kit.html`, CSS and JS assets | 2026-08-31 |
| Shell, Top Bar, workflow/status, queue and run detail | current app routes and `ref frontend-backend-integration` §5 matrix | Phase 3a |
| Logs, categorical timeline, Context/Attempts, identity gates and parked-write resolution | current run-detail matrix and integrated tests | Phase 3a/3b |
| Start Run | current D293 design: Input → Options → Confirm; Customize steps inserts Steps; per-start Destination controls removed | 2026-08-31 |
| Receipt, failure, retry comparison and verified captures | D289/D292 authority, Receipt consumer, exact byte URLs and 301-case parity corpus | 2026-08-31 |
| Archive evidence and version bump | frozen archive detail, verified capture resources/downloads, ledger/export/version surfaces | 2026-08-31 |
| Spreadsheet intake | upload, mapping, corrections/exclusions, validation, manifest review and enqueue are wired end to end | Phase 3a |
| Activity, search and exports | Activity/CSV, bounded cross-date search and dedicated evidenced XLSX download | 2026-08-30 |
| Settings and storage | bounded resolver-owned edit/readback, restart-required states, Settings preflight rerun and read-only storage doctor including span-authority diagnoses | 2026-08-31 |
| Explorer | graph projection plus exact validate/apply/readback for label, icon and category; strict source briefs for allowed policy/Edit Data changes | 2026-08-30 |
| Sessions and workers | session/worker cards, browser/run state and the reviewed pool/stop controls | Phase 3a |
| Integrated quality gates | 4,742/4,742 tests; 85.38% statements; 87.34% lines; 301/301 visual/a11y parity; typecheck and lint passed | 2026-08-31 |

## 2 · Drift — where the as-built differs from the plan

| plan said | reality | kind | consequence |
|---|---|---|---|
| Doc 04 still calls artifact screenshots and D289 comparison implementation gaps | The current Receipt serves both verified captures and D289 retry comparison | stale-plan-text | Current dashboard capability is greater than the Phase 4 summary says; the owning reference/code win |
| Doc 04 calls generic artifact bytes absent | Run/Archive capture bytes are now served through their verified authorities, while the broader generic `ArtifactResourceWireSchema` gallery/status family remains open | done-differently | Capture evidence works in its approved placements; there is still no general-purpose artifact browser |
| Preflight is broadly described as served | Settings owns a typed preflight rerun, but `FrontendBootstrapWireSchema#preflight` remains declared-unserved, so the Top Bar preflight popover does not mount | stale-plan-text / partial | Use Settings for preflight; do not assume a Top Bar health verdict exists |

## 3 · Next

1. Build the production byte path: make `dashboard:prod` parse `--prod`, serve `dist/dashboard`, restrict phone-origin files, deliver `capture.html`, and add the on-demand tunnel launcher.
2. Add the capture-to-OCR-run binding when the first OCR-consuming workflow lands; close the intake-column and capture metadata/replace-photo residue with it.
3. Serve OCR Review and Group People only when their Phase 3c workflow authorities exist; they remain declared-unserved today.
4. Resolve the remaining declared wire gaps: Top Bar bootstrap preflight and Context Evidence, or retain explicit named deferrals.
5. Finish broader settings/editor/authoring and any remaining session commands only when their named owners and contracts exist.
6. Reconcile Doc 04's stale screenshot/comparison summaries with the integrated D289/D292 truth.

## 4 · Needs you

No decision is needed to use or review the dashboard through `npm run dashboard` now. It must not be treated as the daily production dashboard until the production byte path and workflow/cutover gates are complete.
