# Archive surface — wire gaps

**This ledger is at ZERO as of 2026-08-19.** Every record it held is either landed (Track B5,
per **D223**; the contracts live in `docs/rebuild/03-tracker-dashboard.md` §10.2's
*D223 as-built* block) or moved to the category file that actually owns it. The file stays so
the next archive finding has somewhere to go, and so the history of what was here is legible.

Records were opened 2026-08-14 while porting the rebuild-demo's `DemoArchive.tsx`
(legacy `hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoArchive.tsx` + `demo-archive-wire.ts`)
onto the served `/api/v1/archive` wire (`src/domain/dashboard/archive.ts`, D179).

Owning docs for anything new: `docs/rebuild/03-tracker-dashboard.md` §10.2 (D80/D179/D223) and
`docs/rebuild/13-frontend-backend-integration.md` §5 / line 131.

## What was here, and where it went

| Record | Disposition |
| --- | --- |
| Logs, Data and People tabs | **LANDED** — D223 freezes the section payloads into the archived record (archive schema generation 2, read-forward per D133) and the detail renders Summary · Logs · Data · People · Evidence with the descriptor list EMPTY. Doc 03 §10.2 *D223 as-built*. |
| Evidence tiles — label, step, system, captured-at, retention | **LANDED** — the frozen `captures` block describes every captured artifact (kind, media type, size, digest, sensitivity, capture instant, bundle origin, screenshot dimensions, declared retention) with `step` and `system` joined off the bundle's origin failure and kept as NAMED absences where it names none. The bytes are still pointers; nothing on this path reads the content store. |
| Per-attempt history | **LANDED** — the frozen `attempts` block, folded off the `(runId, attempt, spanPath)` identity the projection already carried, rendered as the Summary tab's Attempts card. |
| Export an archived run | **LANDED** — the panel header's Export writes `archive-<traceId>.json` containing exactly the display-redacted `ArchivedRunDetailWire`, which is why it opens no new redaction surface. |
| Write-ledger Action/Confirmation await a declared presentation reading | **LANDED** — `LEDGER_PRESENTATION_DECLARATIONS` carries separations' three commit contracts, keyed by PROOF SCHEMA HASH (`(system, completionKind)` cannot work: two of the three are `save-verify` on `ucpath`). Two declare their confirmation ABSENT with a reason, which is a stronger statement than the undeclared fallback. The missing end-to-end test also landed: `archive-model.test.ts` archives a run that really filed a line and resolves it back with the registry empty. |
| Change record behind a sweep (what, why, by, commit) | **LANDED** — charter §25's change record is authored in the bump dialog at PLAN time, rides the plan fingerprint, and is copied into the application verbatim. `fromVersions` is derived from the archived records' own frozen identities. |
| Dry-run, priority and preset on an archived run | **MOVED** to [queue-rows.md](queue-rows.md). `dryRun` landed 2026-08-14 (446e7d7); `priority`/`preset` are queue-row gaps the archive inherits, because an archived row is a frozen copy of `QueueSurfaceWire`. |
| Workflow short code | **MOVED** to [workflow-taxonomy.md](workflow-taxonomy.md), which is where the question was always deferred to. |

## One measurement still owed

D223's storage growth was accepted by the operator on 2026-08-18, and the measured per-archived-run
delta is owed in doc 03 §10.2's as-built block **once a real archive exists**. No production
database has archived a run yet, and a number taken from a fixture would be a measurement of the
fixture. This is not a finding — it is a stated obligation with a named home.
