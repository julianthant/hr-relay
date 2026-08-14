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
| R2 | Workflow panel — ALL THREE modes (floating/icon/sidebar): header row, mode toggles, category labels, count alignment, the ACTIVE\|ALL row, window footer | `DemoShell.tsx` (~line 674 on: `WorkflowPanelMode`, panel window) | `surfaces/shell.tsx` + `app/use-panel-sections.ts` | [ ] |
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

(Appended per region as the audit reaches it.)
