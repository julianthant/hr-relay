# Plan — dashboard detail-fidelity audit (region by region)

**Date:** 2026-08-13 · **Owner:** frontend session · **Resumes:** `docs/handoffs/2026-08-13-frontend-detail-fidelity.md`
**Status legend:** `[ ]` not started · `[a]` audited (divergence log written) · `[f]` fixed + image-verified · `[x]` committed

## Goal

The dashboard becomes a **1:1 detail replica of the legacy rebuild-demo**. The operator built the
demo as the spec and reviews at the detail level — glyphs, spacings, chips, band alignment. Two
"matches the demo" claims have already been rejected on sight, so the acceptance bar is the
operator's eye, approximated here by reading side-by-side screenshots AS IMAGES per region.
Where the demo renders data the rebuild wire does not serve, the UI is still built to the demo's
exact spec and the missing feed is DECLARED (D198 pattern) so backend work knows precisely what to
serve and where it plugs in — see "Wire-hookup ledger" below.

## Oracle and binding references

- Demo source (the spec): `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/`
- Demo live: `cd ../hr-automation && npm run dev:dashboard` → `http://localhost:5173/?view=rebuild-demo`
- Rebuild live: `npm run rebuild:dashboard` (BFF :3938) + `npm run rebuild:dashboard:web` (Vite :5174)
- Binding docs: `src/dashboard/DESIGN.md` · doc 13 §1 (oracle), §7 (parity), §8 (guards) · doc 03 §Shell
- Populated states: live days are empty — compare against parity fixtures / `tests/parity/references/*.png`
  or seed the fixture server via the parity helpers.

## Method (per region — no step skipped, no region overlapped)

1. **Read the demo's source for the region** (file named in the table below) and enumerate every
   visible element into a checklist: each glyph, label, spacing token, class string, conditional arm.
2. **Diff structurally** against the rebuild's surface — markup shape, exact Tailwind classes, DS
   primitive usage, icon choice/size, text content, title/aria strings.
3. **Log every divergence** with `demo-file:line → rebuild-file:line` in this plan's region section
   BEFORE fixing anything.
4. **Fix by porting** — copy the demo's own markup/classes with a provenance comment (legacy commit
   hash + source path). Never reinterpret, never "improve".
5. **Screenshot both sides** with playwright-cli at **1440×900** (demo 5173 vs rebuild 5174/fixture
   server) and **read the two screenshots as images** before declaring the region done. A green
   parity run is not the bar; the images are.
6. **Deviations need a named reason** — unserved data (→ ledger entry), a D-decision, or an operator
   call — stated in the region's log, never silent.

## Region inventory (audit in this order)

| # | Region | Demo source | Rebuild target | Status |
|---|--------|-------------|----------------|--------|
| R1 | Top bar — every glyph, spacing, date-nav pill, notification cluster, tabs, search | `DemoShell.tsx` (top-bar half) + `DemoTopBarSurfaces.tsx` | `surfaces/top-bar.tsx` | [ ] |
| R2 | Workflow panel — ALL THREE modes (floating/icon/sidebar): header row, mode toggles, category labels, count alignment, the ACTIVE\|ALL row (no window footer — audit confirmed the demo has none) | `DemoShell.tsx` :160-235 + :636-1180, `RebuildDemo.tsx` (mount + keyboard), `demo-wire.ts` | `surfaces/shell.tsx` :106-600 + `app/dashboard-app.tsx` (NOT `use-panel-sections.ts` — that is log-panel plumbing) | [a] |
| R3 | Queue rows — chips, footers, member wells, section bands NEEDS YOU / ACTIVE / QUEUED / FINISHED TODAY | `DemoQueue.tsx` | `surfaces/queue.tsx` + `queue-toolbar.tsx` | [ ] |
| R4 | Status pills band | `demo-status.tsx` | `surfaces/status.tsx` | [ ] |
| R5 | Run-detail header row (log panel header) | `DemoLogPanel.tsx` (header region) | `surfaces/log-panel.tsx` | [ ] |
| R6 | Context rail rows — observation clock, badges, row anatomy | `DemoContextRail.tsx` | `surfaces/context-rail.tsx` | [ ] |
| R7 | Session footer | `DemoShell.tsx` (footer region) | `surfaces/shell.tsx` (footer) | [ ] |
| R8 | Dialogs — confirm-first dialogs, park/resolve, run-start, bulk bar | `DemoParkResolve.tsx`, `DemoRunStart.tsx`, `DemoBulkBar.tsx`, `ds/primitives-overlay.tsx` | `surfaces/park-resolve.tsx`, `run-start.tsx`, `actions.tsx` | [ ] |

R1 and R2 first — the operator named them explicitly. Each region gets its own divergence log
section appended to this file as the audit reaches it.

## Known-open detail items (from W2.5, found-not-fixed — fold into their regions)

- **R2:** panel toggle lacks the 2-char workflow code — bootstrap serves id+label only. This is a
  wire addition → ledger entry; UI ports the demo's rendering now, keyed off the field the wire will
  grow.
- **R3:** `Cancelled` pill clips at 1440 on busy days — demo-documented scroll behavior. VERIFY
  against the demo, do not "fix".
- **R3:** Select strip has no served bulk `actions[]` — wire gap, already booked (D198 pattern).
- **R7:** footer `+` needs pool `expectedVersion` — wire addition → ledger entry.

## Wire-hookup ledger (what backend must serve, ready-to-connect)

The operator's instruction: build everything exactly like the demo NOW, structured so the backend
knows what to build and where it connects. Protocol per gap, all four parts in the same commit:

1. **UI ports the demo exactly**, reading from the typed wire view-model. Where the field does not
   exist yet, the component takes it as an OPTIONAL typed prop/field with the demo's rendering
   behind it and the honest absent state (never a fabricated placeholder value — fail-visible
   absence, e.g. the element renders only when the field is present, exactly as a demo-faithful
   conditional).
2. **The wire schema grows the arm/field** in `src/domain/**` wire schemas where the shape is
   already decidable from the demo's own wire (`demo-wire.ts` etc. are the shape oracle — the demo
   already models what the field looks like).
3. **`config/pending-wire-bindings.json` gets a `declared-unserved` entry** naming the binding, the
   decision, and what closes it — `wire-connectivity.test.ts` enforces both directions.
4. **Doc 13 gets the normative sentence** in the same commit (a decision is not ratified until it
   lands in its owning doc).

Running list (grown during the audit; initial entries from the known-open items):

| Binding (proposed) | Consumer (UI, ready) | Shape oracle in demo | Status |
|---|---|---|---|
| bootstrap workflow `code` (2-char) | panel toggle + panel rows | `demo-data.ts` workflow defs | to declare |
| `QueueSurfaceWire.actions[]` (bulk) | Select strip / bulk bar | `demo-commands.ts` bulk actions | booked (handoff) |
| pool `expectedVersion` on footer `+` | session footer add control | `demo-workers-wire.ts` | to declare |

## Execution structure

- **Phase A — audit sweep (read-only, parallelizable).** Dispatch divergence-audit subagents
  (**Opus, or Sonnet on high — nothing lower**, per `[[subagent-dispatch-policy]]`), one per region
  or region pair. Read-only ⇒ no worktrees needed. Each returns a divergence log (demo-file:line →
  rebuild-file:line, element-by-element checklist), which lands in this file.
- **Phase B — fix waves (sequential on master).** Regions share files (`shell.tsx` hosts R2+R7), so
  fixes land one region at a time, in order, each as its own commit:
  `fix(dashboard): R<n> <region> — port the demo's <what>` with provenance comments in code.
  Screenshot-image verification (method step 5) happens per region BEFORE its commit.
- **Phase C — corpus + gates.** ONE deliberate `npm run test:parity:update` for the whole wave,
  after an assert run shows zero geometry failures; then
  `npm run typecheck && npm run lint && npm run test:coverage` (D191). Wire-ledger entries ride the
  region commits that need them.

## Rules in force (bit us before)

- Another session works this same checkout (separations). `/custom-hr-tree-guard` before any
  multi-file staging: attribution snapshot, explicit pathspecs, never `git add -A`; foreign red is
  reported, never fixed. A file committed mid-work by the other session is normal.
- The Edit tool corrupts escape bytes — python for byte-sensitive edits; `code-conventions` rejects
  raw control bytes.
- References re-freeze ONLY via `test:parity:update`, once per wave, orchestrator-serialized.
- Never push. Commit per region, straight to master (sequential dependent work — global policy).

## Region divergence logs

### R1 — Top bar (audited 2026-08-13; 59 elements: 27 match, 22 divergent, 9 missing, 4 extra)

Oracle: `DemoShell.tsx` `DemoTopBar` :493–631 (+ `DemoDoctorPopover` :296, `DemoSurfacesPopover`
:367) and `DemoTopBarSurfaces.tsx` (`DemoDateNav` :326, `DateCalendar` :178, `DemoSearchControl`
:388, `DemoNotificationBell` :579, `NotificationRow` :779). Rebuild: `surfaces/top-bar.tsx`,
`day-search.tsx`, `settings.tsx:307`, composed in `app/dashboard-app.tsx:387-411`. The ds/ layer is
byte-identical; every divergence is surface code.

Major findings (full detail in the audit transcript; fix list below is the actionable record):

1. **Bell + inbox anatomy wrong end to end.** Demo: raw square `<button>` with corner superscript
   badge (nothing painted at zero; critical→failed-solid tone), 480px `Drawer` with description
   line, filter chip row (All/Unread/Pings/Inbox/Snoozed), `<article>` rows with unread dot,
   severity glyph (Siren/TriangleAlert/Inbox), `dsText.ui` title, `N ago` age, badge row, labeled
   action buttons with `Mail`/`MailOpen`/`Clock` icons, `Un-snooze` arm, `EmptyState`, footer.
   Rebuild: bordered `Button` + always-painted dim `CountBadge`, a `Popover`, bare divs, clock
   timestamp, unlabeled icons, no dot/glyph/badges/footer.
2. **Preflight/doctor control MISSING** — the demo's FIRST icon-cluster item (`Stethoscope`,
   verdict-tinted, popover with per-check Badge/checkedAt/detail/Blocks/Fix + "Run doctor again").
   Doc 13 assigns the storage/preflight summary + doctor rerun to the Top Bar; no rebuild wire
   serves a preflight summary → WIRE-GAP (ledger).
3. **Tracker vocabulary drift** in ~8 strings ("the projection serves…" vs demo "the tracker
   holds…"), month labels, cell aria/title, `days on disk`, day-step disabled labels.
4. **Search dialog**: missing `Try:` chip row (6 example chips), 3-example placeholder vs demo's 4,
   missing `Day` results column, D184-forced single-day copy (on record).
5. **DateNav unserved-day arm**: demo points "Next day" at earliest served day when the current day
   is unserved; rebuild disables both arrows.
6. **History pair is dead chrome**: `dashboard-app.tsx:410` hardcodes `canBack:false`; demo drives
   it from `demo-nav-history.ts` (109-line pure client model — nothing blocks porting).
7. **Settings gear**: missing `aria-pressed` + pressed background class (attention dot stays —
   D169 on record).
8. **Catalog trigger**: `BookMarked` glyph vs demo's `FlaskConical`.
9. **EXTRA**: ShortcutsPopover glyph (demo deliberately removed it — operator quote in
   DemoShell.tsx:594), Tooltip wrapper on date pill, commandError span in popover.

**Orchestrator decisions for the R1 fix:**

- **Date-pill Tooltip stays** (an operator-filed defect fix from W2.5 — "hover hints anchor to
  their trigger"); recorded here as an operator-call deviation. Hint TEXT reverts to the demo's
  "tracker holds" wording.
- **Keyboard glyph is removed** from the top bar (demo's operator quote is explicit). The
  Shortcuts surface stays reachable via its keybinding; Settings grows the Help group in a later
  slice (the demo puts help in Settings).
- **Catalog trigger ports the `FlaskConical` glyph** and pressed treatment; the label stays "UI
  catalog" because the surface behind it IS the catalog (D177), not demo scaffolding — named
  deviation, label only.
- **Notification body/link/count stay off-wire** — doc 03 §2.6 deliberately keeps free text off
  the notification wire. The row markup ports fully; body/badge-row arms render only when the
  (optional) fields exist. This is an on-record deviation, NOT a ledger entry.
- **Preflight summary + doctor-rerun command** → wire-hookup ledger (doc 13 already assigns them
  to the top bar). UI built to demo spec, rendered when the optional bootstrap field arrives.
- **Cross-day search corpus** → wire-hookup ledger; D184's single-day copy stays until served.
  `Try:` chips + 4-example placeholder + 5-column table (Day column, honest constant today) port now.
- **Vocabulary reverts wholesale** to the demo's strings; single-day search copy is the ONE
  exception (D184).

Fix order (all in `feature` commits on master, one region commit):
top-bar.tsx (bell/drawer/rows/filters/footer/empty → doctor popover → vocabulary → pill title text
→ FlaskConical → DateNav arm → remove Shortcuts glyph) → settings.tsx (gear aria-pressed+class) →
day-search.tsx (Try: chips, placeholder, Day column, copy re-check) → dashboard-app.tsx (+ port
demo-nav-history.ts, wire `nav`).

### R2 — Workflow panel (audited 2026-08-13; floating 37 / icon 9 / sidebar 30 elements; 18 findings D1–D18)

Oracle: `DemoShell.tsx:160-235` (counting helpers) + `:636-1180` (panel), `RebuildDemo.tsx:505-519`
(global keys), `demo-wire.ts` (workflow ref + `DEMO_CATEGORY_ORDER`). Rebuild: `shell.tsx:106-600`,
`dashboard-app.tsx`, `server/dashboard/queries/bootstrap.ts`, `domain/dashboard/{bootstrap,projection}.ts`.
The window geometry, controls, behaviors (Escape/Tab-cycle/outside-click/focus), tokens and
`IconButton` are byte-identical — every divergence is counts, strings, wire fields, or the two
global key bindings.

Findings (full table in audit transcript):

- **D1/D2 (wire, value in hand):** toggle lacks the 2-char code span + `(code)` title parenthetical.
  `base/workflow.ts:200,244` already carries `code` (guarded 2-char); bootstrap just doesn't serve
  it. Served addition, NOT a declared-unserved entry.
- **D3/D4:** toggle scope sentence and count VALUE wrong — demo renders `dayActive` (queued+running
  across workflows, amber when >0); rebuild renders the day's TOTAL, so amber lights on idle days.
  The code comment claiming the projection "does not serve it" is FALSE — `statusCounts` is
  day-scoped; `queued + running` derives exactly. Pure-port.
- **D5–D12:** entry count cluster missing the ACTIVE column entirely: demo renders
  `active │ all` (active span with faint/amber arms, `│` U+2502 separator, `gap-hair`); rebuild has
  one total. Column head reads `rows` vs demo's `active │ all`. Per-workflow queued/running is a
  REAL wire gap: `WorkflowCountWireSchema` serves `{workflowId, count}` only → grow to
  `{workflowId, count, queued, running}` and serve from the projection's existing countable loop.
- **D13/D14:** `w` (cycle panel mode) and top-level Escape→icon are advertised in the toggle title
  AND shortcuts.tsx but NO global keydown listener exists — `cycleMode` has zero consumers. Two
  operator-facing surfaces assert a binding that does not exist. Port `RebuildDemo.tsx:505-519`.
- **D15/D16:** rebuild-only `disabled`/faint arms on rail entries (availability) — currently inert
  (bootstrap hardcodes available), undocumented. **Decision: delete** — the rail entry is a queue
  filter; demo has no availability concept there.
- **D17/D18:** category headings are machine-derived (`id.replace(/-/g," ")`, first-seen order) vs
  the demo's frontend-hardcoded display order + labels (doc 03:2346-2352 makes frontend ordering
  normative). **Decision: move to frontend** — port the demo's mechanism with a label+order table
  for this repo's real categories (`separation`→Separations, `timekeeping`→Timekeeping,
  `search`→Search, `operations`→Operations), unknown categories appending after in the demo's own
  fallback shape; server serves the raw category id.
- On-record, no action: storage key / element-id namespacing (operational isolation), fail-loud
  preference readers, `RAIL_NOTES` empty map.

**Orchestrator decisions for the R2 fix:** all ten fix-list steps apply as the audit ordered them;
D15/D16 delete; D17/D18 frontend table per doc 03. Wire schema edits live under `src/domain/**` →
run `npm run build:manifest` in the same change. Served additions (code, queued/running) need no
pending-wire-bindings entry — they are served and consumed in the same commit.

### R3 — Queue rows · R4 — Status band · R7 — Session footer

(Audits in flight.)
