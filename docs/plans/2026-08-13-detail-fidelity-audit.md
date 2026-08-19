# Plan — dashboard detail-fidelity audit (region by region)

**Date:** 2026-08-13 · **Owner:** frontend session · **Resumes:** `docs/handoffs/2026-08-13-frontend-detail-fidelity.md` _(handoffs removed 2026-08-18; in git history)_
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
| R1 | Top bar — every glyph, spacing, date-nav pill, notification cluster, tabs, search | `DemoShell.tsx` (top-bar half) + `DemoTopBarSurfaces.tsx` | `surfaces/top-bar.tsx` | [x] |
| R2 | Workflow panel — ALL THREE modes (floating/icon/sidebar): header row, mode toggles, category labels, count alignment, the ACTIVE\|ALL row (no window footer — audit confirmed the demo has none) | `DemoShell.tsx` :160-235 + :636-1180, `RebuildDemo.tsx` (mount + keyboard), `demo-wire.ts` | `surfaces/shell.tsx` :106-600 + `app/dashboard-app.tsx` (NOT `use-panel-sections.ts` — that is log-panel plumbing) | [x] |
| R3 | Queue rows — chips, footers, member wells, section bands NEEDS YOU / ACTIVE / QUEUED / FINISHED TODAY | `DemoQueue.tsx` | `surfaces/queue.tsx` (toolbar needs no R3 edit — bulk parts are R8's) | [x] |
| R4 | Status pills band (band itself lives in `DemoShell.tsx:1183-1364` → `shell.tsx:602-795`; `demo-status.tsx` is the vocabulary adapter) | `demo-status.tsx` + `DemoShell.tsx` | `surfaces/status.tsx` + `shell.tsx:602-795` | [x] |
| R5 | Run-detail header row (log panel header) | `DemoLogPanel.tsx` (header region) | `surfaces/log-panel.tsx` | [x] |
| R6 | Context rail rows — observation clock, badges, row anatomy | `DemoContextRail.tsx` | `surfaces/context-rail.tsx` (+ rail mount in `log-panel.tsx`) | [x] |
| R7 | Session footer | `DemoShell.tsx:1366-1958` + `demo-workers-wire.ts` | `surfaces/shell.tsx:797-1068` | [x] |
| R8 | Dialogs — confirm-first dialogs, park/resolve, run-start, bulk bar (+ `DemoActions.tsx`, `DemoRunStartKit.tsx` — audit widened the oracle set) | `DemoParkResolve.tsx`, `DemoActions.tsx`, `DemoRunStart.tsx`, `DemoRunStartKit.tsx`, `DemoBulkBar.tsx` | `surfaces/park-resolve.tsx`, `actions.tsx`, `run-start.tsx`, `run-start-kit.tsx`, `queue-toolbar.tsx` | [x] |

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
| bootstrap workflow `code` (2-char) | panel toggle + panel rows | `demo-data.ts` workflow defs | LANDED 2026-08-14 (R2 commit `5fe2893`) — `WorkflowBootstrapPrimitiveSchema#code`, regex-guarded 2 chars |
| `QueueBaseFields.actions[]` + per-row `expectedVersion` (bulk) | bulk strip + result-vector band (R8 f.5/6) | `DemoBulkBar.tsx:65-77` via `demo-wire.ts` `actionsAt` | PARTLY LANDED 2026-08-14 — per-row `actions[]` + CAS `expectedVersion` are SERVED and consumed (doc 13 §8.5, `1218306`/`78a6cfe`); the BULK strip + result-vector band remain the open half |
| pool `expectedVersion` on footer `+` | session footer add control + AddWorkersDialog (R7-2, anatomy pinned) | `demo-workers-wire.ts:151-209` | to declare — SECOND blocker: dashboard supervisor throws for spawnWorker (`compose.ts:178-186`, doc 05 lane) |
| worker-lease `version` on `WorkerCardWireSchema` (distinct from `revision`, which is a span counter) | footer `Stop` button (R7-4 — server half already complete) | `DemoShell.tsx:1706-1708` | to declare (priority: smallest change, restores a real control) |
| `WorkerCardWireSchema` batch: `workflowId`, `startedAt`/elapsed (already folded in the projector), `waiting` lease block, `browsers[]` (health/label/url/session id), `crashed`, state-enum lifecycle (`authenticating`/`keepalive`/`waiting`/`paused`/`failed` via the authority lease fold) | card identity/subline, footer clock, lease-wait block, BrowserTile grid + menus, crashed arm, attention chips (R7-1/3/5/6/7/8/9) | `demo-workers-wire.ts:19-57` | to declare (ONE batched change with the projector) |
| preflight/storage summary + doctor-rerun command | top-bar doctor popover (R1) | `DemoShell.tsx:296` DemoDoctorPopover | to declare |
| cross-day search corpus | day-search Day column (R1) | `DemoTopBarSurfaces.tsx` search | to declare (D184 copy until served) |
| per-workflow status counts on `WorkflowCountWireSchema` — WIDENED to the full per-status shape (was queued/running only) | panel ACTIVE│ALL column (R2) + status-band scoping (R4-1/R4-2) + worker-card `queued` chip (R7-5) | `DemoShell.tsx:159-235` counting helpers | LANDED 2026-08-14 (R2 commit `5fe2893`) — `{ workflowId, count, statusCounts[] }`; R4/R7 consume it, no further wire work |
| `InputRunSurfaceSchema` `examples[]` / `parserLabel` / value-noun | run-start typed input (R8 f.17) | `DemoRunStart.tsx:405-472` | to declare |
| `capability.note` + method tabs | run-start workflow-setup block (R8 f.11) | `DemoRunStart.tsx:696-715` | to declare (2h scope) |
| active-run policy control | run-start group 01 (R8 f.8) | `DemoRunStart.tsx` ENQUEUE_POLICY | to declare (already noted `run-start.tsx:28-29`) |
| per-workflow unstartable reasons | picker disclosure `<dl>` (R8 f.12) | `DemoRunStart.tsx:152-253` | to declare (picker body itself needs NO wire) |
| park fence window / settling / present-proof schema | park dialog blocks (R8 f.20) | `DemoParkResolve.tsx` fence+settling | refused-by-name in code (`park-resolve.tsx:20-34`) — declare for backend visibility |
| queue/run action descriptors (`SERVED_ACTIONS`) | confirm-first flow mount (R8 f.4) + `LogPanel onAction` (R5 f.8) | `DemoActions.tsx:430-447` | CONSUMER READY 2026-08-14 (`ebe2bac`) — the dialog is mounted, `onAction` is passed on both panels and routes into `composeCommandRequest`, and the `identity-gate` orphan below is CLOSED (fetched + its served controls drawn). Only the generic field is still unserved: NEITHER half exists: no `actions[]` field on `QueueBaseFields` / `RunDetailWireSchema` and no projector builds one. The two run-detail SECTION payloads that carry decisions DO project real descriptors (`parked-write` at `queries/run-detail.ts:509/752`, `identity-gate` at `:651/636`), so this row is the GENERIC arm only. Side finding: `identity-gate` is served and never fetched — `use-panel-sections.ts:30` omits it from the wanted set and `merge()` would throw on it — an undeclared orphan needing its own `served-unconsumed` entry. |
| `OutcomeWireSchema` `text` + `tone` (the served "so what" sentence) | outcome bar (R5 f.4) | `demo-data.ts:440` + fixture sentences | to declare — `tone` may not be needed: R5 (`57728e0`) tints the bar off the `DsStatus` the bar's own `StatusDot` already renders, so the dot and the band cannot disagree. Only `text` is genuinely unserved. |
| `ContextDataSectionSchema` entries batch: `step`, `staged`/`unconfirmed`/policy `tag`, freshness (`capturedAt`/`maxAgeMin`/consumer), `feedsInto`, `dir`+`system` | context-rail ledger levels, badges, stale line + override dialog, FeedsIntoLine, DirectionMark/SystemChip (R6 f.1/7/9/11/12) | `DemoContextRail.tsx` DemoDataPoint | to declare (ONE batched wire change) |
| command-result `conflict` arm (server-current values per patched field) | CAS re-offer surface (R6 f.6) | `DemoContextRail.tsx:699-749` | to declare |
| delegation links projection | rail Delegation section (R6 f.8) | `DemoContextRail.tsx:1000-1048` | to declare |
| member roster/conveyor + shared member pipeline | ConveyorHeader/MemberSourceBlock + SharedPipelineStrip (R5 f.12/14) | `DemoLogPanel.tsx:2069-2165,736-776` | to declare |
| `GateDecisionWireSchema.kind` + tab attention counts | DecisionNotice icon arm, per-tab dot (R5 f.10/15) | `DemoLogPanel.tsx:874-876,2651-2656` | to declare (low priority) |
| prior-runs list + custom-run descriptor for the rail dock | `Load prior run` / `Start custom run` (R6 f.5) | `DemoContextRail.tsx:822-930` | CONSUMER READY 2026-08-14 (R6 `05c3b33`) — the dock renders each button behind an optional `onLoadPriorRun` / `onStartCustomRun` handler and draws two cells instead of four while they are absent |
| `context-evidence` re-home | Receipt tab (leaves the rail per demo order, R6 f.19) | demo Receipt section | REMOVED FROM THE RAIL 2026-08-14 (R6 `05c3b33`); `LogPanel` no longer hands it down. Still `declared-unserved` (D184), so nothing regressed — it lands on Receipt when the evidence service does. |
| `QueueBaseFields` batch: `dryRun`, `warnings`, `containment`, `displayName`, `runNumber`, `gateOpenedAt`, `memberPreview`+`groupNoun`, member `eid`+outcome vocabulary, `pipeline[].durationSec`, `rejectedCount`, `facts[]`/`extractedCount`/`linkedRunIds`/`reviewRunId`, `priority`+`preset` | queue row chips, aria age, member well heads, fact band (R3 f.6/10-12/14/15/17/18/20/25) | `DemoRow` in `demo-data.ts` + `DemoQueue.tsx` | **CLOSED 2026-08-19 — every half is either SERVED or attributed to a named missing producer.** Wave 1 (`446e7d7`/`772f775`): `dryRun`, `warnings`, `gateOpenedAt`, `displayName` + subject-as-title. Wave 2 (D230/D231, schema v15): `runNumber`, `priority`, `containment`, `linkedRuns[]` (renamed from `linkedRunIds` — it resolves each target to its panel and LIVE status, which an id list cannot), `facts[]`, `pipeline[].durationSec`+`executions`, `memberPreview`. **NOT served, each with the producer it waits on** (`docs/findings/queue-rows.md`): `reviewRunId` (a demo-fixture concept never ratified into the run model — needs the first OCR-review child, same 2h producer as the declared-unserved `review`/`people` sections), `extractedCount` (nothing computes a packet's people count; the terminal result is opaque and guessing an array length is D7's own forbidden guess), `preset` (no descriptor declares `presets`; the choice is recorded nowhere from ingress to span), member `eid` (no `subjectProjection` names an identifier leaf — it would need a declared `identifierProjection`), `groupNoun` (no `operation`-shaped workflow is registered, so a declared noun is D186's sample-of-zero), `rejectedCount` + a `rejected` containment arm (a refused submission never becomes a run row, so there is nothing on a queue row to count). Each of these was deliberately NOT added to the wire: an arm nothing can populate is the orphan `wire-connectivity.test.ts` exists to catch. |
| served roster/People section + `records[]` stream | drill-in surface + record-stream well (R3 f.23/24) | `DemoQueue.tsx:1369-1820`, `DemoRecord` | deferred — named trigger in queue.tsx:110-115 |

## WAVE STATUS — COMPLETE (2026-08-14)

**Phase A (audit) · Phase B (fix waves) · Phase C (corpus + gates) are all closed.** Every region
landed as its own commit, the ONE deliberate re-freeze happened at the wave end, and the full gate
family is green.

| Phase | Outcome |
|---|---|
| A — audit sweep | R1–R8 divergence logs, all in this file |
| B — fix waves | `4901a7d` R1 · `5fe2893` R2 · `b7f79b0` R4 · `b70ef3d` R3 · `57728e0` R5 · `05c3b33` R6 · `d36b783` R7 · `c07424c` + `9847877` R8 · `ebe2bac` the consolidated wiring commit |
| C — corpus + gates | `efab4e1` the three defects the gate found · `82caea2` the re-freeze (400 files) |

**Final gates:** `typecheck` clean · `lint` clean (`--max-warnings 0` over `src tests scripts`) ·
`test:coverage` 196 files / 1823 tests, all passing · `test:parity` **147/147 green in ASSERT mode**.

### `ebe2bac` — the consolidated wiring commit (R2 D13/D14, R3 f.8, R5 f.7/f.8, R8 f.4/f.7)

*The keyboard exists now.* `src/dashboard/app/global-keys.ts` is the ONE window `keydown` listener,
ported from `RebuildDemo.tsx:441-534` — guards first (typing target, modifier, `useDsModalOpen()`),
then the keys. Per key: **`r`** bound (the run dialog is workflow-global since `c07424c`) · **`w`**
bound (`cycleMode` had zero consumers) · **top-level `Escape`** bound (floating → icon; already-icon
falls through rather than swallowing the key) · **`j`/`k`** bound over `visibleRunIds`, whose doc
comment had named this consumer since it was written · **`n`** bound over a new `attentionRunIds`,
which filters `visibleRunIds` by the SAME `bandOf` the NEEDS YOU band header draws from, so the key
and the band cannot disagree · **`m`** bound through the ds helper `openContextMenuFor` (also
caller-less until now); it opens nothing today because no row action is served, which is the same
honest absence every other action control has · **`1`–`4`** bound over the tabs the OPEN run
advertises, so `3` on a two-tab run does nothing rather than forcing an unrenderable section.

*Two registry corrections instead of two no-op bindings,* per this plan's own rule that two
operator-facing surfaces asserting a binding which does not exist IS the defect. **`Enter` was
removed** from `surfaces/shortcuts.tsx`: the demo opens a group's drill-in with it, this build has no
drill-in (R3 f.23/24, deferred with a named trigger), and here selecting a row already opens it.
**`Esc` was re-worded** from "back out of a group" (the same drill-in) to "minimise the Workflow
Panel", and moved to the `Anywhere` scope, which is what it now does.

*The identity gate was served and never fetched.* `use-panel-sections.ts:30` omitted `identity-gate`
from the wanted set and `merge()` would have thrown on it, so a run held at a gate drew a decision
card with no way to answer it while the server had projected the packet, the options, the approval
shape and both `resolve-gate` descriptors all along. It is fetched now on the parked write's exact
terms (whenever the run advertises it, never behind a tab), and `InlineDecision` reads its controls
off `sections["identity-gate"]` rather than off the generic `actions` prop — which is fed
`SERVED_ACTIONS = []` and could never have carried them.

*The confirm-first flow is mounted.* `ConfirmCommandDialog` sits at the app root per
`DemoActions.tsx:430-447`; `runAction` routes any descriptor carrying the server-authored `confirm`
through it and posts the rest straight away (D16 keeps group cancel out BY CONSTRUCTION — no
`confirm` block). `onAction` is passed on BOTH panels, so the day the generic action projection
lands, every row and panel control is live with no further change.
`src/dashboard/app/command-dispatch.ts` composes the envelope and **refuses by name** anything whose
payload cannot be built from served facts: a gate APPROVAL composes only when the server itself set
`approvalShape: "one-click"` over a single candidate (and then every leaf — EID, `chosenFrom`,
evidence digest, result schema hash — is a value the server served); a REJECTION needs the operator's
own reason and a choice-shaped approval needs the operator's own choice (§14.6 risk 1 — a surface
free to pick a candidate turns a risky approval into one click), so both refuse with a sentence
naming the surface that closes them; and the two park resolutions refuse because they have their own
wired dialog, which carries the evidence note this route cannot.
**Amended 2026-08-19 (D226):** the surface those two sentences named now exists, so the composer
TAKES the operator's answer as context instead of refusing for want of one. What still refuses is
what nobody authored: an approval or rejection with no answer supplied, an EID the packet never
showed, an answer that disagrees with the control pressed, and an `approvalShape` this build has no
ceremony for. The park resolutions are unchanged.

*Live verification (1440×900, served day `2026-08-12`, 28 rows).* `r` opened the run dialog (read as
an image); `w` cycled floating → icon → sidebar → floating in the stored preference; Escape closed
the dialog while the panel stayed put — the modal guard — and then minimised the panel at the top
level; `j j j k` walked and opened four runs in the drawn order; `2`/`1` switched tabs while `3`
correctly did nothing on a run advertising two; `m` opened no menu because nothing is served; `jjkr`
typed into the log filter moved nothing. **LIMITS, stated:** no served day carries a waiting or
parked row, so `n` is pinned by unit test only; and no run in authority is `parked-gate`, so the gate
fetch and its dispatch could not be exercised on live data — the day's two identity-check runs failed
BEFORE the gate could park. `tests/unit/dashboard/global-keys.test.ts` (20 cases) pins the traversal
arithmetic, the attention wrap, `attentionRunIds` against the band, and every composer arm including
the approval parsed back through `CommandRequestSchema` + `IdentityApprovalResultSchema`.

### `efab4e1` — what the wave-end gate found, because that is what a gate is for

The Phase-C assert run went red on **127 references plus 7 hard failures**, and every one of the 127
was a11y drift thrown BEFORE the pixel compare — so no screenshot had been compared at all. The 7
were not drift and no re-freeze could absorb them. Three real defects came out:

1. **The rail's live lock was an `alert` about a standing state.** R6 lifted the two danger lines out
   of the old `editing` gate so the reason is on screen before the operator reaches for a field —
   right for `problem` (`null` until a save is refused), wrong for `liveLock`, which is a fact about
   the RUN and true from the moment the panel opens. It announced itself assertively on page load for
   every terminal or claimed run with recorded data. `dual-adapter.spec.ts` caught it as a role the
   fixture adapter rendered and the seeded one did not. The sentence stays with `aria-live="polite"`
   — the lock CAN arrive mid-session when the day stream moves the row under an open panel, which is
   what D19 exists to warn about — but it no longer interrupts.
2. **The run-detail panel read its own clock.** R5 f.5's `decisionAge` landed as one
   `systemClock.now()` per render: one read, but the WRONG one, since the queue beside it dates its
   rows from `boot.serverClock.now`. The same gate could report two different ages depending on which
   surface you looked at — D124's defect with the clocks swapped — and it surfaced the way a
   non-deterministic value always does, as a reference nothing could settle (`258h 22m` → `258h 31m`
   between two runs of the lane; both re-freezes drifted again). `LogPanel` takes `servedNow` now,
   and the frozen gate age is `16m 0s`, measured from the fixture's own pinned clock.
3. **The park locator went stale with the port it was written for.** R8's `ParkResolutions` made the
   two resolutions the demo's tinted CARDS carrying the server's `detail` sentence after the label;
   the parity spec still clicked them by `{ name, exact: true }`, so BOTH park-dialog captures had
   been timing out. The locator is anchored rather than exact — the served label must still be the
   first thing the control says — and the `lg` dialog with its flex-wrap fence row enters the corpus
   for the first time, which closes the verification limit R8's own as-built recorded.

*Generalisable, and worth a lesson if one is written:* **an assert lane that throws on the semantic
half never reaches the pixel half**, so a corpus can be "reviewed" for a whole wave without a single
image being compared. The review that actually happened here was old-reference-image vs
new-reference-image, one per region, read as images.

### What remains open (nothing in it is a wave regression)

- **The wire-hookup ledger above** — every row still marked `to declare` / `booked` is backend work,
  with its consuming UI already built to the demo's spec behind an optional field.
- **R8 findings 5 + 6** — the bulk command strip and the bulk result-vector band, which build to demo
  spec once `QueueBaseFields` grows the optional `actions[]` + per-row `expectedVersion`.
- **R7's `WorkerCardWireSchema` batch** — R7-2 (`+`/AddWorkersDialog, two named blockers), R7-3
  (browser-health grid + menus + chip), R7-4 (`Stop`, needs the lease `version`), R7-5/6/7-data,
  R7-8 (crashed arm). Nothing further in R7 is a pure port.
- ~~**The identity-approval surface**~~ — **BUILT 2026-08-19 (D226).** All three ceremonies exist
  against the SERVER-computed `approvalShape`: `surfaces/identity-approve.tsx` renders the packet
  (disagreements first, the candidates, D211's write plan) with exactly the one control the server
  asked for, and `app/identity-ceremony.ts` is the pure fold both it and `command-dispatch.ts` read.
  An unrecognised shape draws a NAMED refusal and blocks the send — it never falls back to the
  approve button. Doc 09 §14.11 owns the ceremony table; doc 13 §3.4 generalises the rule.
- ~~**A gated fixture**~~ — **BUILT 2026-08-19 (D226).** Two fixture runs serve an `identity-gate`
  section, their shapes DERIVED by `deriveApprovalShape` from real inputs rather than authored
  (`tests/parity/helpers/fixture-gate.ts`), and four new dialog references photograph the choose,
  type-the-EID, reject and refused states. **Owed at the wave-end re-freeze:** four new pairs plus
  six drifted `run-open-gate` defaults — the decision card now draws the two served controls it
  never had.

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
  region commits that need them. **DONE — see "WAVE STATUS" above.** One correction to this plan's
  own method, learned by executing it: "an assert run shows zero geometry failures" is not something
  the lane can report while any a11y reference has drifted, because the a11y half is asserted FIRST
  and throws before the screenshot is compared. Geometry review is therefore
  old-reference-image vs new-reference-image, read as images, one per region — which is what
  happened.

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

**R1 FIXED + image-verified + committed 2026-08-14 (`1e4bb03`)** — every fix-order item landed
as decided. The wire half rode the SAME commit (the manifest was clean, so the ledger protocol's
four parts are together): `FrontendBootstrapWireSchema` grew optional `preflight`,
`config/pending-wire-bindings.json` declares it `declared-unserved`, doc 13 §3.1 states it
normatively, and `build:manifest` regenerated with a ZERO diff — `bootstrap.ts` is outside every
descriptor's import closure, which is the fact that made the domain edit safe beside another
session. `redaction-surface-scan` then refused the four new free-text leaves until
`SURFACE_LEAF_ORIGINS` said where their bytes come from — the guard working, and the reason the
audit table grew four `repository-authored` rows in the same commit.

Recorded deviations, each with its cause:

- **Notification body / badge row / link stay absent** (doc 03 §2.6 keeps free text off the wire).
  The row markup ports whole and every arm is gated on an OPTIONAL field declared in
  `NotificationRowExtras` — the plug point backend fills, never a placeholder.
- **`Pings` / `Inbox` chips count zero** because no row declares a delivery route yet; their filter
  answers the demo's own EmptyState, which says a zero here never means a record was deleted.
- **`Un-snooze` renders disabled with its reason** — the kernel serves `notification-snooze` and no
  inverse, so a live control would 422 on click. Hiding it (what the surface did before) moved every
  button beside it the moment a row snoozed.
- **A refused command is REPORTED** inside the drawer (`role="alert"`). The demo has no server to
  refuse one; swallowing it would let a failed `Mark read` read as a success.
- **`Try:` chips are QUOTED from the day's rows**, four not six: fixture queries would be fabricated
  data, `run` is dropped because a 36-char uuid is not an example anybody types, and the demo's last
  two chips demonstrate a zero-hit and a FAILING lookup, which this find cannot do.
- **`ShortcutsPopover` stays exported, unmounted** — the glyph is gone per the operator's quote; the
  component is whole for the global binding + Settings → Help that own it next.
- **Catalog label stays "UI catalog"** (D177) with the demo's `FlaskConical` glyph and pressed
  treatment; **the date pill keeps its `Tooltip`** with the demo's wording restored.
- **`NavPlace` is a quad, not the demo's triple** — it carries `day`, because the demo derives a
  row's day from a constant corpus and this app cannot without a fetch; `runId` is nullable because
  a panel with nothing open is a real place to come back to.

Image verification (1440×900, demo :5173 vs rebuild :5174, read as images): the closed bar matches
left to right, with the stethoscope correctly ABSENT (unserved) and no keyboard glyph; the drawer
matches the demo's 480px anatomy — description line, five filter chips (byte-identical `Chip`
rendering), EmptyState, standing footer — with the rebuild empty, which is the correct rendering;
the search dialog gained the `Try:` row and the five-column table. Three behaviours were verified
LIVE rather than by reading code: the tracker serves only `2026-08-12`, so the app opened on an
UNSERVED day and the ported DateNav arm pointed `Next day → Wed, Aug 12` while `Previous` refused —
before this fix both arrows were disabled and the operator was stranded; the gear reports pressed in
BOTH representations (`aria-pressed=true` and the surface-3 fill, per D187); and back/forward drove
a real panel switch, naming `Back to Person Lookup` then `Forward to Separation Timecard` with no
re-push loop. Parity references deferred to the wave-end re-freeze as planned.

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


**R2 AS-BUILT (2026-08-14, commit `5fe2893`).** All ten fix-list steps landed except D13/D14, which
are booked for the consolidated keydown commit as decided.

*The wire served.* `WorkflowBootstrapPrimitiveSchema` grew
`code: z.string().regex(/^[a-z0-9]{2}$/)` — the descriptor's own guarded code, not a derived one.
`WorkflowCountWireSchema` became
`{ workflowId, count, statusCounts: [{ status, count }] }` with two refinements (statuses unique,
per-status counts sum to `count`), filled in the projector's existing countable loop beside the
day-wide totals — ONE fold, D81 intact. R4-1/R4-2 and R7-5 need no further wire change; they read
these entries. Both are served AND consumed in this commit, so neither needed a
`pending-wire-bindings` row. Consuming helpers on the frontend:
`workflowStatusCounts(counts, id)` and `activeCount(statusCounts)` in `shell.tsx`.

*The wire REMOVED, which the audit's D17/D18 decision implies and is worth stating.* The bootstrap's
`workflowCategories` projection is gone, and with it `WorkflowCategoryPrimitiveSchema` and
`parseWorkflowCategories`. Its only two fields were display decisions the SERVER invented (`label`
was `id.replace(/-/g, " ")`, `order` was the registry's first-seen index); once doc 03 §Shell puts
both on the frontend the array serves nothing derivable, and keeping it would be exactly the
inert-served-field pattern D15/D16 deletes one level down. `src/dashboard/surfaces/workflow-category.ts`
now owns the table as `Record<WorkflowCategory, {label, order}>` — the descriptor vocabulary is a
closed six-value enum, so a new category with no heading fails `tsc` rather than rendering a hole —
plus `groupWorkflowsByCategory` (the ONE rule) and `workflowCategoryLabel`. Doc 13 §3.1/§3.2 carry
the normative sentences in the same commit. Guard follow-through:
`redaction-surface-audit.ts` lost the `workflowCategories[].label` origin row and needed NO row for
`workflows[].code` — the scan does not read a regex-constrained leaf as free text, which it told us
by failing on the row we first added.

*Deviation from the dispatch brief, oracle-justified.* The brief said the code renders on "the
toggle … and panel rows likewise". The demo's `WorkflowEntryList` entry renders the LABEL only —
no code, in the row, its title or its aria-label (`DemoShell.tsx:930-977`) — so the code stayed on
the launcher, per "the demo is the SPEC".

*Manifest.* `npm run build:manifest` produced a ZERO diff for this change, as R1 found: the
dashboard wire schemas sit outside every descriptor's import closure. (A later regeneration DID
drift, entirely on the other session's in-flight `src/domain/ui/ucpath-smart-hr-termination.ts` and
`src/stores/ucpath/**`; the manifest was restored to HEAD and is not in this commit.)

*Gates.* `typecheck` clean, `lint` clean over the touched tree, `vitest --project unit` 1670/1670
and `test:architecture` 450/450 green at the time of the change. The later full `test:coverage` run
shows 3 failures (`descriptor-coverage` ×2, `strict-boundary-schemas` ×1) and 1 lint error, ALL
attributable to the other session's uncommitted ucpath work — reported, not touched.

*Image verification (1440×900, headless, demo :5173 vs rebuild :5174), all three modes.* Floating,
icon and sidebar each read side by side against the demo. The rail is structurally pixel-aligned
with the demo: same header row, `ACTIVE│ALL` head at the same right-aligned position, same group
heading rhythm, same row height, same count cluster. Category headings render **Separations ·
Timekeeping · Search · Operations**, exactly the decided order. The launcher reads `pl │ 0` against
the demo's `os │ 12` — same icon/code/rule/count anatomy, the width difference being one glyph and
one digit. No entry is dimmed or disabled. The Run Modal's picker row now reads `Person Lookup pl`.
LIMIT, stated rather than glossed: the rebuild's live day is empty, so every count rendered its ZERO
arm; the non-zero amber/`fg` arms are byte-identical ports of the demo's own conditionals (verified
by reading, and rendered by the demo in the same screenshot pass) and were not photographed on the
rebuild, because the populated corpus is the parity fixture bundle and re-freezing that is the
orchestrator's wave-end step.

### R3 — Queue rows (audited 2026-08-14; 92 elements: 50 match, 19 divergent, 21 missing, 2 justified extras; findings 1–25)

Oracle: `DemoQueue.tsx` (+ `demo-data.ts`, `demo-status.tsx`, `DemoActions.tsx`). Rebuild:
`queue.tsx`, `queue-toolbar.tsx` (no R3 edit needed there), composed `dashboard-app.tsx:655-686`.
Full detail in the audit transcript; actionable record:

1. **`Attention first` is a FALSE claim** — the note says "what needs you, then what broke…" but
   the arm returns server order (oldest-started). Demo ranks within bands via `SORT_STATUS_RANK`
   (waiting 0 · failed 1 · parked 2 … cancelled 7, newest-first tiebreak). Pure-port + fix the note.
2/3/5. Empty state prints a raw ISO day and the raw `StatusBucket` enum key; `needsYou` arm
   missing; "Finished today" reads "Finished" with no today-ness input. All served-additions
   (`dayLabel` formatter exists in `top-bar.tsx:91`; `PROPOSED_STATUS` labels; `day === today`).
4. **Finished-today digest strip missing entirely** (dashed strip: `N verified · N with warnings ·
   N failed · N cancelled`) — served-addition, folds over band rows the client already holds.
6. Redirect/fact chip band below the well missing — `ParentBackChip` is a SERVED-ADDITION
   (lineage.parentRunId + sibling surface lookup); facts[]/linked/review/extractedCount are
   wire-gaps.
7. Group subline not suppressed when the member well is on screen (the demo's truncating-copy
   rationale). Pure-port.
8. **`j`/`k`/`Enter`/`m` advertised and unbound; `visibleRunIds` exported and dead** (its doc
   comment names the j/k traversal). Same no-global-keydown defect family as R2/R5/R8.
9. An operation row with no member surfaces served draws NO member info despite a served
   `memberRollup`. Served-addition: draw RollupStrip whenever `surfaceKind === "operation"`.
10. **Warnings `△ N` chip missing** (operator quote in demo source). Count is wire-gap, but the
    `doneWarnings → △ 1` arm is derivable TODAY and closes the D22 hue-only collision.
11. **Dry-run chip missing** + the violet/warning row-chip tones — wire-gap (`dryRun` on the
    envelope but not `QueueBaseFields`).
12. `memberPreview` (the counted anchor's names — "the names ARE its identity") — wire-gap.
13. Member rank inverts `cancelled` vs verifiedDone. Pure-port of rank values; KEEP the rebuild's
    stable-server-index tiebreak (better rule, audit concurs).
14. Member-well header loses rejected count / checked count / Outcome-vs-Detail heading switch —
    wire-gaps (note `MemberOutcomeWord` already ships unused in `status.tsx:160-197`).
15. `rejected` containment treatment missing at all three sites — wire-gap.
16. Row ⓘ can be ABSENT entirely (demo: always rendered, "quiet at rest is not absent");
    `panelKind` is SERVED and unread — port the panel sentence now; row-variant naming layer
    stays wire-gap.
17. Row accessible name loses gate age (aria is the ONLY place age reaches a screen reader for
    waiting/parked). Wire-gap (`gateOpenedAt`).
18. Footer: `#run` ordinal chip gone (wire-gap), trace id took its box, and the `showId` guard
    dropped so title==subtitle prints twice (pure-port). `attempt N` extra: keep (cited).
19. `omitKeys` not status-conditional (inert until actions serve). Pure-port.
20. MicroSteps tooltip loses per-step duration — wire-gap; rebuild's DS dot tones are CORRECT,
    do not port backwards.
21. Failed member's detail cell never tints — status IS served. Pure-port.
22. `cancel-tree` loses its D16 no-undo warning sentence. Pure-port (inert until served).
23/24. Drill-in roster + record-stream well — deferred wire-gaps (documented); the unreachable
    `View full list` branch gets the deferral note.
25. `displayName` (operator-renamed run) unrepresented at six sites — wire-gap.

Verified no-action: Cancelled-pill clip MATCHES the demo (both scroll — do not fix); status-pill
age suppression matches on screen; three justified rebuild extras keep.

**Orchestrator decisions (R3):** fix wave = audit's order 1–2 (pure-ports + served-additions) as
the R3 region commit. Finding 8: BIND, don't delete — the keys join the ONE consolidated global
keydown handler (with R2 D13/D14, R5 f.7, R8 f.7) in the final dashboard-app commit;
`visibleRunIds` becomes its consumer. Finding 10's derivable arm and 16's panel sentence land in
the R3 commit. The batched wire change (finding-order 4) is ONE `QueueBaseFields` + projector
change → single ledger row below; its consuming UI ports ride the same commit when the wire lands.
23/24 stay deferred with named triggers.

**R3 AS-BUILT (2026-08-14, commit `b70ef3d`).** Every decided item landed: pure-ports 1, 7, 13, 18b,
19, 21, 22; served-additions 2, 3, 4, 5, 6 (partial), 9, 10 (third arm), 16 (partial); housekeeping
23. Finding 8 is deliberately absent — the keys join the ONE consolidated keydown commit, and
`visibleRunIds` stays as its consumer (it is now also the seam finding 13's member rank is tested
through). Everything touched `src/dashboard/**`; **no `src/domain/**` edit and no `build:manifest`**,
per the dispatch constraint (the generated manifest is dirty with the other session's ucpath work).

*Deviations, each with its cause.*

- **`dayLabel` MOVED rather than shared in place.** It lived in `top-bar.tsx`, and `top-bar.tsx`
  already imports `queue.tsx` for a type — importing back would have been a cycle for a four-line
  date formatter. It is now in `surfaces/format.ts` (with `dayLabelWithToday`), which is where the
  other display-only formatters already are, and both surfaces read the one copy.
- **`filterLabel: string` became `filter?: QueueFilterScope`.** Three arms (all / needsYou / a status
  word) cannot be expressed by one optional string, and the previous prop was being fed
  `String(filter)` — the raw wire enum — which is the defect finding 3 names. The composition owns
  the mapping so the empty state and the pill the operator clicked cannot disagree.
- **`dayLabel: string` prop became `day: string` + `isToday: boolean`.** The prop held an ISO day
  while its name said label; formatting moved inside, and `isToday` is finding 5's input.
- **The `doneWarnings` filter's empty state says "are done".** That is the demo verbatim
  (`PROPOSED_STATUS[filter].label.toLowerCase()` over a visible word both terminal dones share), so
  the port is faithful; the D22 separation lives on the pill's own accessible name, not here. Named
  rather than silently "improved".
- **f.22 binds by descriptor `key`, not `command`.** `ActionCommandKeySchema` has no `cancel-tree`
  verb — the kernel accepts `cancel` — and binding the group sentence to that would put "its
  delegated review and every member" on a single run's ✕. `key` is the stable per-row identifier the
  action projection will name this control by. Inert until it serves one.
- **f.21 tints on the served status alone.** The demo also requires `containment !== "rejected"`;
  containment is not on this wire (ledger), and status-only is a strictly wider set that cannot
  mis-tint a member the server called failed.
- **f.9 suppresses the `Name`/`Detail` column heads at zero members.** The rollup band and the
  "0 of N members loaded" line are what the finding asks for; a labelled column head over an empty
  region reads as a failed render, which is R6 f.18's argument one surface across.
- **f.10 lands ONE of the demo's three warning arms.** The authored `warnings` count and the group
  member-rollup count both need a counted field this wire does not carry; inventing either would be
  a number about a real HR run that nothing produced. Ledger.
- **f.6 lands ONE chip of the demo's redirect band.** `ParentBackChip` only; fact chips, the linked
  review pointer and the extracted-people count are the `QueueBaseFields` batch. The lookup runs
  over the whole day's surfaces rather than the panel's scoped list, because a cross-workflow parent
  is exactly the case a scoped lookup misses, and `onOpenParent` moves the panel before selecting.
- **f.16 titles the ⓘ with the PANEL kind's name** (`Run Panel` / `Group Panel` / …). The demo titles
  it with the row VARIANT name, which needs the naming layer that stays a wire gap; the panel kind is
  served, so the title is derived rather than invented.

*Gates.* `typecheck` clean, `lint` clean over the whole tree, `vitest --project unit` 1680/1680 and
`test:architecture` 451/451 green. Two new unit files: `queue-ordering.test.ts` (the `attention`
comparator over a deliberately reverse-ranked input, its newest-first tiebreak, a named order NOT
being re-ranked, the member rank and its served-order tiebreak) and R4's `status-band-scope.test.ts`.
No `test:parity` run — wave-end re-freeze, as planned.

*Image verification (1440×900, headless, demo :5173 vs rebuild :5174, read as images), and its
LIMIT.* The rebuild's live day (`2026-08-14`) is empty, so what an empty day can show was verified
live and does: the empty state reads **"No Person Lookup runs on Fri, Aug 14"** (it printed the raw
ISO partition before), **"No Person Lookup runs need your attention"** under the `Needs you` scope,
and **"No Person Lookup runs are done"** under a status pill — the demo's own three arms. No console
errors. The POPULATED arms — the digest strip, the `△` chip, the band-header narrowing, the ranks,
the member well — were read on the DEMO in the same pass (its finished band renders exactly the
dashed `Today: 3 verified 1 failed` strip this commit ports, with the zero arms correctly absent) and
are byte-ports of the demo's own conditionals; on the rebuild they are pinned by the new unit tests
rather than photographed, because the populated corpus is the parity fixture bundle and re-freezing
it is the orchestrator's wave-end step. Stated as a limit, not glossed.

### R4 — Status pills band (audited 2026-08-14; band is byte-equivalent to the demo — every defect is in the DATA reaching it)

Oracle: `demo-status.tsx` (vocabulary adapter) + `DemoShell.tsx:1183-1364` (the band). Rebuild:
`status.tsx` + `shell.tsx:602-795`, composed `dashboard-app.tsx:298,610-616`.

- **R4-1 (HIGH, wire-gap): the pills count the whole day; the queue below shows one workflow.**
  Demo scopes every number to the active workflow; rebuild serves `statusCounts` folded over
  every surface in the day — so `Failed 3` can sit above a queue with zero failures, and the
  ported title "Every row in this view" is now FALSE. Fix is a per-workflow dimension on the
  served counts inside the same countable loop (D81's one-count-path); NEVER a client-side fold
  over `queueSurfaces` (`shell.tsx:1-17` refuses it by name). COUPLING: `dayCount` feeds BOTH this
  band and R2's panel toggle, and in the demo those are deliberately DIFFERENT quantities
  (toggle = day-wide across workflows; band = workflow-scoped) — the fix adds a NEW scoped count
  and leaves `dayCount` alone.
- **R4-2 (MED, served-addition): `All` and the eight pills come from two different aggregations**
  (`monthCounts` vs `statusCounts`, different member-exclusion predicates — agree today by
  coincidence). Once R4-1 serves the scoped array, fold `All` from the same array.
- R4-3 Tooltip-vs-title (keep, documented), R4-4 accessibleLabel (D22/D126, keep), R4-5 unused
  `MemberOutcomeWord` (documented, waits on R3's wire), R4-6 order/tones/arms all match. No-ops.

**Orchestrator decisions (R4):** R4-1's wire consolidates with R2's — ONE per-workflow counts
change (`WorkflowCountWireSchema` grows the full per-status shape, not just queued/running) serves
R2's ACTIVE│ALL column, R4's band scoping, AND R7-5's per-card `queued` chip. R4's re-point + R4-2
then ride as served-additions. The R2 fix dispatch carries this widened shape.

**R4 AS-BUILT (2026-08-14, commit `b7f79b0`).** Both items landed as decided, and the whole change
is three files under `src/dashboard/**` — R2 had already served the shape, so there was no wire work
and no `build:manifest` (the generated manifest is dirty with the other session's ucpath work).

*R4-1 is a RE-POINT.* `dashboard-app.tsx` derives `scopedStatusCounts` with R2's
`workflowStatusCounts(dayWire.workflowCounts, activeWorkflowId)` and hands it to `StatusFilters`.
Nothing folds `queueSurfaces` — `shell.tsx:1-17` refuses that by name and D81 is why. `dayCount` is
untouched and still feeds the panel launcher, which the audit's coupling note says is deliberately a
different quantity (day-wide across workflows); its prop simply LEAVES `StatusFilters`, which no
longer needs a second scope. The ported title "Every row in this view" is true again, and it matches
the demo's string byte for byte.

*R4-2 folds the same array.* New `totalCount(counts)` in `shell.tsx` sums the scoped entries, so
`All` is closed under addition with the eight pills beside it — which is how the demo has it
(`countRows(scopedRows)` feeds `counts.all` AND every pill). The projection already refines that a
workflow entry's per-status counts sum to its `count`, so the fold cannot disagree with the server's
own total. R4-3/4/5/6 stay no-ops as audited.

*Gates.* `typecheck` clean, `lint` clean over the whole tree, `vitest --project unit` 1674/1674 at
the time of the commit. `tests/unit/dashboard/status-band-scope.test.ts` pins the scope selector, the
unserved-workflow zero arm (an absent entry IS zero, and every pill must still draw), and the
composites' closure under addition — over schema-parsed fixtures, so the fixture cannot drift from
what the server may serve.

*Image verification (1440×900, headless, rebuild :5174, read as an image).* The band renders
`All 0 · Needs you 0` and eight zero pills scoped to Person Lookup, with no console error. LIMIT,
stated: the live day is empty, so only the zero arm was photographed; the non-zero arms are untouched
byte-identical markup and the SCOPING itself is what the unit test pins. Parity references deferred
to the wave-end re-freeze.

### R7 — Session footer (audited 2026-08-14; 41 elements: 17 match, 5 divergent, 19 missing, 3 extras; findings R7-1..14)

Oracle: `DemoShell.tsx:1366-1958` + `demo-workers-wire.ts`. Rebuild: `shell.tsx:797-1068`,
composed `dashboard-app.tsx:734-738`. OVERLAP: R7's whole footprint is `shell.tsx:797+` —
collision-free with R2 (:126-600) and R4 (:602-795) except the shared import block (:18-61);
sequence R7's fix after R2+R4 land.

- **R7-1 (HIGH): half of `WORKER_TONE` is dead** — the projector emits only
  working/idle/stopped, so `waiting`/`paused`/`failed` are unreachable, the "N workers need
  attention" chip can NEVER fire, and a live-but-unauthenticated daemon is misread as `idle`
  (the exact misread the demo's comment names). Real lease states exist in authority
  (`command-kernel.ts:1767-1796`).
- **R7-4 (MED): `Stop` is fully implementable and absent** — server half complete, workerId
  served; the ONLY gap is that `WorkerCardWire.revision` is a span counter, NOT the lease
  `version` the CAS needs — binding with it would fabricate the fact the CAS checks (and the
  kernel currently ignores the field, making that worse). One wire field.
- **R7-2: the `+` / AddWorkersDialog** (known ledger item, now pinned): needs pool
  `expectedVersion` AND a second blocker — `compose.ts:178-186` supervisor THROWS for
  spawnWorker (dashboard can't launch workers; doc 05's lane). Dialog anatomy fully pinned for
  the port.
- **R7-3: the browser-health half doesn't exist** — HEALTH_TONE (6 arms), BrowserTile grid,
  right-click menu (Peek/Check/Front/Refresh/Reopen/Pause), "N browsers need attention" chip.
  Wire: `browsers[]` on `WorkerCardWireSchema`. The rebuild's SystemChip is an honest
  substitution until then.
- R7-5/6/7/8: card identity renders workerId where demo renders WORKFLOW (one join away);
  lease-wait block ("why is nothing moving"); reserved micro-pipeline band (its token ALREADY
  exists unoccupied) + elapsed clock (projector already folds startedAt/endedAt — one field);
  crashed-worker arm. All wire-gaps on `WorkerCardWireSchema`.
- R7-9/10/11 (pure-ports, no wire): `working`→`Running` label; restore module-scope
  `capacityChip` (anti-drift helper the demo argues for); app-version title's MAJOR/MINOR
  sentence — the D179 archive semantics the rebuild implements and dropped the only place the
  operator is told.
- R7-12 connection indicator: rebuild-only, doc 13 §3.5, STRICTLY better — keep. R7-13 shell
  byte-equivalent. R7-14 negative sweep clean (no banned reintroductions, no unbound keys here).

**Orchestrator decisions (R7):** R7-1 keeps the six arms + the chip (renders only >0 — honest
absence under the build-ready-to-connect instruction) with a comment citing this audit and naming
the projector lease-fold that makes them reachable → ledger row. R7-4's lease `version` is the
priority wire field (smallest change, restores a real control). The R7 fix commit (after R2+R4):
pure-ports R7-9/10/11 + the `mt-auto` wrapper and reserved band shell of R7-7. Everything else
rides the `WorkerCardWireSchema` batch → ledger. R7-2 stays last (two named blockers).

**Pure-port slice FIXED + image-verified + committed 2026-08-14 (`d36b783`).** R7-9, R7-10, R7-11
and R7-7's structure halves landed exactly as decided, all inside `shell.tsx:797+`. Notes worth
keeping:

- R7-10's `capacityChip` ships BOTH arms though only the loud one has a caller. Deleting the quiet
  arm for lack of a caller is the drift the module-scope helper exists to prevent; its caller is
  the browser-health summary in the R7-3 batch.
- R7-10's chip `title` is a DEVIATION with a cause: the demo names each card's workflow and the
  lease it waits on, and neither is served. It joins what is — worker id + state word — and grows
  the demo's wording with the batch.
- R7-7's band is drawn EMPTY, not omitted. Holding a baseline costs nothing and claims nothing, so
  the batch lands without moving anything; drawing step dots from nothing would be the worst lie
  available on a panel about what a worker is doing. The footer's step slot carries the run the
  worker is on, stated at the slot rather than left silently wrong.
- Image check at 1440×900, both sides read as images: the rebuild bar reads `0 running · 0 idle ·
  2 stopped` (the R7-9 word landed) with `app 0.1.0` present; the demo's `+` and its
  `4 browsers need attention` chip are correctly absent on the rebuild (R7-2 blockers, R7-3 wire).
  Drawer open, both cards show the reserved band on one baseline. The demo's app-version tooltip
  was read back out of its own accessibility tree and matches the ported sentence exactly.

**STILL OPEN in R7, all on the `WorkerCardWireSchema` batch → ledger:** R7-2 (`+`/AddWorkersDialog,
two named blockers), R7-3 (browser-health grid + menus + chip), R7-4 (`Stop`, needs the lease
`version`), R7-5/6/7-data (workflow identity, lease-wait block, elapsed clock, step dots),
R7-8 (crashed arm). Nothing further here is a pure port.

### R5 — Run-detail header (audited 2026-08-13; 37 elements: 16 match, 8 divergent, 11 missing, 2 extra; findings 1–17)

Oracle: `DemoLogPanel.tsx` head block (+ `DemoActions.tsx` OutcomeActionButton — verified
line-for-line ported). Rebuild: `log-panel.tsx` :1306-1408 head, composed `dashboard-app.tsx:648-662`.

1. **Header StatusPill is a banned reintroduction** — demo deleted it under the quoted operator
   rule "THE HEADER DOES NOT REPEAT A STATE THE BAND DIRECTLY BELOW IT ALREADY STATES"
   (`DemoLogPanel.tsx:2510-2526`); rebuild redraws it at `log-panel.tsx:1330`. DELETE.
2. **`attempt N` warning Badge** — no demo counterpart anywhere (demo's attempt affordance is the
   rail's RunSelector). DELETE.
3. **Outcome bar lost its whole tone treatment** — demo tints the band via the six-arm
   `OUTCOME_TONE` map; rebuild's band is untinted, colour collapsed onto a 6px dot. Pure-port
   (literal class strings keyed off the computed `outcomeStatus`; never interpolate tokens).
4. **Outcome sentence client-derived from the enum** (`done-with-warnings · 14:32`) vs demo's
   served one-sentence "so what". Wire-gap: `OutcomeWireSchema` grows `text` + `tone`
   (`run-detail.ts:110-113`; shape oracle `demo-data.ts:440` + fixtures).
5. **Gate age gone from the outcome bar** — served-addition (`gate.openedAt` already consumed at
   :429; `fmtElapsed` imported). The demo's comment: it is the number deciding which of two
   waiting runs opens first.
6. **`PANEL_OMITS_OUTCOME_ACTIONS` INVERTED** — demo omits `open-park`, rebuild omits
   `open-gate`; the rebuild's comment asserts the demo's reasoning but applies it to the other
   key. Flip to `["open-park"]`.
7. **Tab shortcut `1–4` (and the whole registry) advertised, bound nowhere** — no window keydown
   handler exists in the rebuild. Same defect family as R2 D13/D14 and R8 f.7.
8. **Panel never handed an action dispatcher** — `onAction` unpassed (NOOP), `SERVED_ACTIONS=[]`
   pinned with a comment whose stated expiry ("lands with 2g") has passed; runtime is 2j.
9. Receipt tab glyph `ReceiptText` vs demo `Receipt`. Pure-port.
10. Per-tab attention dot missing — wire-gap (unread/attention counts on the detail wire); low
    priority while review/people tabs render UnservedTab.
11. `PanelKindInfo` ⓘ missing — header identity rule is title · ⓘ · trace; `panelKind`,
    `workflowLabel`, `traceId` all in hand.
12. `SharedPipelineStrip` missing — wire-gap (shared member pipeline on `TimelineWireSchema`).
13. Settling band — D198-cited, structurally unreachable; already on the ledger. No action.
14. Member branch (`ConveyorHeader` + `MemberSourceBlock`, 11 elements) — wire-gap: no
    sibling/parent roster on the detail wire.
15. `DecisionNotice`: `Pause` vs `PauseCircle` glyph + `open {age}` vs `since {clock}` are
    pure-ports; the per-`gate.kind` icon arm is a wire-gap (`GateDecisionWireSchema` has no kind).
16. Region breakpoints (container-query remap) — decision-cited, test-pinned, renders identically.
    Leave.
17. `StatusDot` — match, no action.

**Orchestrator decisions (R5):** 1, 2 delete; 3, 5, 6, 9, 15 (pure halves) apply; 11 PORTS (the ⓘ
affordance is not scaffolding — the vocabulary inside it uses the rebuild's real labels). 4 →
ledger; UI keeps the honest enum composition as the fallback arm until `text`/`tone` are served
(prints the wire's own value — not a fabrication). 8: fix agent verifies whether 2g's action
projection actually serves descriptors; if so, wire `onAction` + retire `SERVED_ACTIONS=[]`; if
not, ledger + comment correction. 7 folds into the ONE global keydown handler (with R2 D13/D14 and
R8 f.7) in the final dashboard-app commit. 10, 12, 14, 15-kind → ledger.

**AS-BUILT (committed 2026-08-14, `57728e0`).** Deletions 1, 2 landed — the header is
`title · ⓘ · trace` and nothing else. 3 ports `OUTCOME_TONE` as eight literal class strings keyed
off the computed `DsStatus`, not off a parallel served `tone`: the bar's own `StatusDot` reads the
same value, so the dot and the band cannot disagree, which is stronger than the demo's arrangement
(this narrows finding 4's ledger row to `text` alone). 5 adds `decisionAge` on the outcome bar; 6
flipped to `["open-park"]`; 9 `Receipt`; 15's pure halves (`Pause`, `open {age}`) landed with ONE
clock read per render feeding every age on the surface. 11 ports `PanelKindInfo` over the served
`panelKind`, with `PANEL_KIND_NAME` / `PANEL_KIND_EXPLANATION` deliberately duplicated
byte-identical from `queue.tsx:379-391` (that file is another region's, so the fold is left
mechanical and named in code).

**Finding 8 — INVESTIGATED, answer is a wire gap.** No generic action projection exists in either
half: no `actions[]` field on the queue or run-detail wire, and no projector that builds one. The
two run-detail SECTION payloads carrying decisions DO project real descriptors. So `onAction` stays
unpassed and the `SERVED_ACTIONS` comment — which asserted an expiry ("lands with 2g") the runtime
passed at 2j — was corrected to state what exists and cite the ledger row. A SECOND finding fell out
and is booked on that row: `identity-gate` is served by the server and never fetched by
`use-panel-sections.ts`, an orphan with no `served-unconsumed` declaration.

**Image verification.** Rebuild at 1440×900 against real served runs (`?day=2026-08-12`) and the
parity fixture corpus: header carries no status chip and no attempt badge, the ⓘ opens
`Run Panel` + explanation + `wfLabel · trace`, and the outcome bar is tinted red on a failed run and
green on a done one. LIMIT: no served day carries an OPEN GATE, so finding 5's `gateAge` could not
be photographed on live data — the demo side was read for the arm and `decisionAge` is
`fmtElapsed(elapsedSecondsBetween(...))` with no branch of its own.

### R6 — Context rail (audited 2026-08-13; 52 elements: 13 match, 9 divergent, 24 missing, 6 extra; findings 1–26)

Oracle: `DemoContextRail.tsx`. Rebuild: `surfaces/context-rail.tsx` (+ rail mount in
`log-panel.tsx:1201-1215,1471-1495`).

Major (full table in audit transcript):

1. **Three-level ledger lost its top level** — demo groups values under producing STEP (Well +
   recessed caps band + divided rows); rebuild renders one flat list. Wire: `entries[]` grows
   `step` (`ContextDataSectionSchema`, `run-detail.ts:263-296`).
2. `changed` badge (the word, not just the amber fill — colour-blind/forced-colors rationale)
   missing; `dirty` already computed. Pure-port.
3. **Data-section header row missing entirely**: "Extracted fields" label (rebuild says "Data"),
   the About-run-data ⓘ popover (bullets portable now; KeyValueList needs wire), and the explicit
   Widen/Narrow control (rebuild widens only implicitly, and can't narrow back). Pure-port + gap.
4. Rail header never says `Run data · editing` — state already plumbed outward, never read back.
   Served-addition (client state).
5. **Demo's four-button action dock replaced by a flat Save/Cancel pair** — missing: aria-live
   status line, `Load prior run`, `Reset edits`, `Start custom run`, and the pinned `grid-cols-2`
   geometry ("the primary's place is the bottom right corner").
6. **CAS-conflict re-offer surface absent** — demo's yours/server-now chips + "Keep my edits
   against generation N" / "Discard and load fresh"; rebuild flattens every non-applied outcome to
   one danger span ("a patch is never silently dropped and never merged blind"). Wire-gap: the
   command result union needs a `conflict` arm carrying server-current values.
7. Freshness stale line + override dialog (11 elements) — wire-gap (capturedAt/maxAgeMin/consumer).
8. `Delegation` section — wire-gap (nothing in the tree references delegation).
9. `FeedsIntoLine` — wire-gap (`feedsInto` on the wire).
10. `corrected` badge: wrong tone (warning vs info) + RAW ISO INSTANT in an operator-facing title
    (`fmtClock` imported two lines above). Pure-port.
11. `staged` / `unconfirmed` / locked-policy `tag` badges — wire-gap (edit schema has no flags, no
    one-word tag).
12/13. DirectionMark + SystemChip / `refreshed` badge — decision-cited absences, correctly
    refused. Named on the wire batch, no UI action.
14. Label lost `htmlFor` pairing; `labelId` is minted and DEAD (referenced by nothing) — also
    loses click-to-focus and `cursor-text`. Pure-port.
15. Label-line `flex-1` + gap-token drift (one step wider than demo). Pure-port.
16. Observation-clock fold omission — decision-cited, arithmetic checks out. Leave.
17. Data empty state: EmptyState component + different copy vs demo's plain `<p>`. Pure-port.
18. Attempts: locked ContextSection substitute for RunSelector, missing the `>1` gate ("a labelled
    section with nothing under it reads as a failed render").
19. **`Evidence` section in the rail is a rebuild-only insertion** — demo states the rail order
    twice (Data · Attempts · Delegation) and moves captures to Receipt explicitly.
20. **The summary count row the operator BANNED is back** (verbatim ban comment in the demo,
    dated 2026-07-27), moved from the ledger top to the rail floor. DELETE.
21. Inline reason Field + Cancel in the editing footer — rebuild-only, sits where the dock belongs.
22. Pending-correction sentence — keep (cited) but `fmtClock` the raw instant.
23. `derived` badge — keep (cited); the wire's `operator` arm is unhandled — dismiss it explicitly
    in the comment.
24. Spine label vocabulary — follows 3a/8. Pure-port.
25. `useContextRail` shape + storage key — decision-cited / operational isolation. Leave.
26. "Attempts and delegation are hidden while you edit" hint + its gate — missing; follows 3c.

**Orchestrator decisions (R6):** 20 delete; 19 REMOVE from the rail per the demo's stated order —
`context-evidence` re-homes to the Receipt tab when it lands (recorded on the ledger row, not
dropped). 2, 3a, 3c, 4, 10, 14, 15, 17, 24, 26 apply as pure-ports; 22, 23 keep-with-fix as
audited. 5+21 together: the dock geometry, aria-live line, and `Reset edits` port NOW (client
state); `Load prior run` / `Start custom run` render when their wire arms exist (→ ledger). The
inline reason Field: if the correction command's wire REQUIRES a reason, it stays as an on-record
deviation (provenance beats demo-exactness there); otherwise demo-exact. 18: add the `>1` gate
now; the ContextSection substitute is recorded as an on-record deviation pending RunSelector.
3b: port ⓘ with the portable bullets now. Wire batch → ONE ledger row on
`ContextDataSectionSchema` (`step`, `staged`/`unconfirmed`/`tag`, freshness trio, `feedsInto`,
`dir`+`system`); separate rows for the command-result `conflict` arm, delegation, and the R5
member/pipeline gaps. R6 fixes touch `log-panel.tsx` (rail mount) — sequence WITH R5 as one wave.

**AS-BUILT (committed 2026-08-14, `05c3b33`).** 20 deleted with the demo's ban comment in its
place; 19 removed from the rail AND from `LogPanel`'s `railSections` (it was `declared-unserved`
D184, so nothing regressed). 3a/3b/3c landed as the section head the rail never had —
`Extracted fields`, the About ⓘ, and an explicit Widen/Narrow; `expanded` is now ONE flag, raised
by the first focus (D19(d) intact) and lowered by the control, Cancel and an applied save. 5+21
landed as the demo's `Well` + `grid-cols-2` dock with the aria-live line, `Reset edits`, and the
commit arm at `col-start-2`. 2, 4, 10, 14, 15, 17, 18, 22, 23, 24, 26 landed as audited.

**The inline reason Field STAYS — decided on evidence.** `CheckpointPatchSchema.reason` is
`z.string().min(1)` (`src/domain/workflow/checkpoint.ts:257`), so the kernel refuses every patch
without one; the demo captures none because its save is a mock. On-record deviation, stated in
code. `Load prior run` / `Start custom run` render only behind optional handlers and nothing passes
them, so the dock draws two cells instead of four — fail-visible absence.

**Two lines are deliberately narrower than the demo's.** The spine label drops `delegation` and the
hidden-sections hint is gated on the section existing: this rail draws one of the demo's two
hideable sections, and a control advertising a section that is not there lies about its contents.

**Image verification.** 1440×900. Live served runs render the rail chrome (`Run data`,
`Extracted fields`, ⓘ, Widen, plain empty sentence, no count row, no Evidence, Attempts correctly
gated out at one attempt). Every served run has ZERO context-data entries and a locked policy, so
the populated states were photographed against the parity FIXTURE corpus served on the same routes:
locked rows with the lock + label pairing, the editable 2i-C run showing `corrected` in info tone,
the clocked pending-correction sentence, `Run data · editing`, the `changed` badge on a typed row,
the aria-live count, and `Save 1 correction` primary in the right-hand cell.

### R8 — Dialogs (audited 2026-08-13; park/resolve 25 · confirm 11 · run-start 61 · bulk bar 57 elements; findings 1–22)

Oracle: `DemoParkResolve.tsx`, `DemoActions.tsx` (ConfirmCommandDialog + ParkResolutions),
`DemoRunStart.tsx`, `DemoRunStartKit.tsx`, `DemoBulkBar.tsx`. Rebuild: `surfaces/park-resolve.tsx`,
`actions.tsx`, `run-start.tsx`, `run-start-kit.tsx`, `queue-toolbar.tsx`, composed in
`dashboard-app.tsx` + `log-panel.tsx`. Overlay primitives re-checked CLEAN (one cited ToastProvider
id-mint delta only). Full detail in the audit transcript; actionable record:

1. **ParkResolutions never ported** — the two write-resolution exits render as bare pills; the demo's
   tinted cards (`CheckCircle2`/`CircleSlash`, success/danger tints, `detail` sentence) are absent
   and the SERVED `detail` (`run-detail.ts:516-551`, on the wire at `actions.ts:62`) is dropped.
   The deferral comment at `actions.tsx:17` is now false. Pure-port from `DemoActions.tsx:231-280`
   + the `PARK_COMMANDS` filter on `BannerActions`.
2. **Refusal code discarded** — `park-resolve.tsx` throws away `result.code` and prints a hardcoded
   `command-refused`; demo branches on `hasRefusalCode` (Refusal vs no-code danger Banner) and
   raises a persistent danger toast. Served-addition + fabricated-constant smell. Port all three.
3. **Present arm draws the ABSENT glyph** — `variant="danger"` + `CircleSlash` unconditional;
   demo arms it `primary`+`CheckCircle2` when present. Pure-port (`arm` already computed :354).
4. **ConfirmCommandDialog mounted nowhere** — `SERVED_ACTIONS=[]` pins the whole confirm-first flow
   unreachable (park path is the wired exception). Composition gap + action-projection wire-gap.
   `PendingCommand.subject` is a dead prop — render it per demo.
5. **Bulk commands absent** — the four-button strip (`Retry/Bump/Cancel/Delete`, dangerGhost on
   hide, disabled-at-zero, exact titles) is PURE-PORT (kernel already accepts all four verbs);
   only per-row `actions[]` + `expectedVersion` + `notOffered` derivation is the booked wire gap.
6. **Bulk result-vector band missing entirely** (`DemoBulkBar.tsx:267-376`) — the partial-result
   surface (counts, per-result rows, notOffered details, both closing copy arms). Markup + copy
   pure-port; data rides the same `actions[]` wire gap.
7. **No global keydown listener at all** — `r` (+ the whole shortcuts registry) advertised and
   unbound. Pure-port of `RebuildDemo.tsx:444-457` behind `useDsModalOpen()`, lands in
   `dashboard-app.tsx` (OVERLAP: sequence after R1/R2 fixes).
8. **Run-start aside lost its header + three numbered RunControlGroups** (01 Queue behavior /
   02 Safety & mode / 03 Destination). Pure-port; only `Active-run policy` inside group 01 is a
   real wire-gap (documented at `run-start.tsx:28-29`).
9. **`@container` regressed to viewport query** on the DialogBody grid. Pure-port.
10. **Dialog 220px narrower** than demo (`max-w-[min(96vw,1320px)]` dropped). Pure-port.
11. **Workflow-setup block lost the category Chip** (served-addition — boot already carries
    categoryId+labels), the `capability.note`/`MethodTabs`/`methodWire.note` (wire-gaps, 2h), and
    the `What this will create` SectionLabel + `Workflow setup` label strings (pure-port).
12. **Workflow picker is a SERVED-ADDITION, not a wire-gap** — list, grouping, filter, selection
    and the `{n} not startable` count all derive from `boot.workflows`/`workflowCategories`/
    `WORKFLOW_DESCRIPTORS` already parsed in `dashboard-app.tsx`; only per-workflow unstartable
    REASON strings are wire. The header comment claiming otherwise is wrong.
13. Park dialog `size="md"` vs demo `lg` — pure-port.
14. Fence facts: `ChipRow` grid vs demo's flex-wrap Well — pure-port to the demo row.
15. Confirm dialog: subject line wrongly wrapped in `DialogBody` padding; nested title type class.
16. Empty-note error routed only into a disabled button's tooltip; demo puts it on the Field. Pure-port.
17. Typed input: Examples row / value-noun label / parserLabel / per-entry problem banners —
    wire-gaps per audit; rebuild-only parsed-entry preview has no demo counterpart.
18. **Vocabulary drift in 9 strings** (sort aria-label, multi-select title, launcher title, dialog
    description, Workflow setup, plan copy, test-instance banner truncation, EID placeholder, sort
    notes).
19. Park title/body/verb server-authored (doc 13 §8.5) — intentional, on record, NOT drift.
20. Three demo park blocks correctly absent (fence window / SettlingPanel / present-proof entry —
    confirmed unserved, correctly refused); subject radio correctly read-only (one proven subject).
21. `ProofUnserved` Refusal + reserved-space RefusedNotice: rebuild-only, cited, KEEP.
22. Minor extras: `Select all` disabled-at-zero (uncited), StageRail (cited, keep), transport
    Banner (keep), absent-input EmptyState (keep), `InlineParkedWrite` geometry claim → owned by
    the log-stream region, not R8.

**Orchestrator decisions for the R8 fix:**

- Findings 1, 2, 3, 8–11 (pure-port halves), 13, 14, 15, 16 apply as written. For 3: the ARM split
  (variant+icon) ports; the server-authored strings stay (19 — on-record deviation, doc 13 §8.5).
- **Picker (12) builds NOW from boot data** — served-addition; only the unstartable-reasons
  disclosure waits on wire (→ ledger). Correct the false header comment in the same commit.
- **Bulk strip + result band (5, 6) build NOW to demo spec** behind the optional `actions[]`
  field: buttons render disabled-with-reason until served, band renders when results exist. Wire:
  `QueueBaseFields` grows optional `actions[]` (+ per-row `expectedVersion`) → ledger entry
  updates the booked row with the pinned shape (`projection.ts:46`, shape oracle `demo-wire.ts` +
  `DemoBulkBar.tsx:65-77`).
- **Keydown handler (7) + ConfirmCommandDialog mount (4)** land in the LAST dashboard-app commit
  of the wave (after R1/R2), keydown first, confirm mount with the action-projection wiring.
- **Vocabulary (18): revert the six undefended strings** to the demo's. On-record exceptions: the
  three sort notes and the EID placeholder (rebuild wording is more truthful about the projection /
  avoids a fixture EID); `Select all` disabled-at-zero reverts to demo (enabled).
- **Typed-input preview (17):** at fix time, check whether the demo's per-entry problem model is
  client-side parser code — if so, port it and drop the rebuild-only preview; if it needs unserved
  data, keep the preview with a comment citing this audit. Examples/value-noun/parserLabel →
  ledger entries on `InputRunSurfaceSchema` (`ingress.ts:323`).
- New ledger rows: `InputRunSurfaceSchema` examples/parserLabel/valueNoun; `capability.note` +
  method tabs (2h); active-run policy; picker unstartable reasons; park fence-window/settling/
  proof-schema (already refused-by-name in code — ledger makes them visible to backend).

Fix order (per audit): actions.tsx → park-resolve.tsx → run-start(+kit) → queue-toolbar strings
now / bulk strip+band with the wire commit → dashboard-app.tsx LAST (overlap with R1/R2/R-shell).

**Run-start slice FIXED + image-verified + committed 2026-08-14 (`c07424c`)** — operator pulled it
forward. Findings 8, 9, 10, 11, 12, 18 landed as decided; picker built from boot data with both
honest absences (codes await R2's served field; not-startable reasons await wire). Finding 17
resolved KEPT-THROW: `parseInputRunText` is the `src/domain/workflow/ingress.ts` contract boundary
shared with start-plan submission — per-entry tolerance there is a domain edit (forbidden this
commit), and re-implementing its split rules client-side would preview entries the server never
receives; commented at `TypedInput` citing this audit. Two recorded deviations: `<ul>` not `<dl>`
in the not-startable disclosure (every `<dd>` would be empty); `RunStartDialog` takes
`workflows`+`categories`+`panelWorkflowId` (the demo's global-modal shape) instead of one
`workflow`. Screenshot comparison passed structurally; parity deferred to the wave-end re-freeze
as planned. Still open in R8: findings 1–7, 13–16, and the queue-toolbar/bulk + dashboard-app
(keydown, confirm mount) slices.

**No-wire slice FIXED + verified + committed 2026-08-14 (`9847877`)** — findings 1, 2, 3, 13, 14,
15, 16, 18 and the f.4b decision, all as decided. What is worth recording beyond the commit body:

- **f.1's deferral comment was FALSE, and the audit was right about why.** Both resolutions have
  been projected with their `detail` sentences since `run-detail.ts:516-551` existed; the surface
  simply drew them as banner pills and dropped the sentence. The split is pinned as a PARTITION
  over the `banner` placement (`tests/unit/dashboard/park-resolution-split.test.ts`, 5 cases) —
  a resolution drawn twice offers one irreversible answer in two shapes, one drawn in neither is a
  served exit with no control — and the filter reads the PLACEMENT as well as the command, so a
  park verb at `menu` is not pulled into the cards.
- **f.2's split is exact rather than approximate.** The demo's `hasRefusalCode` maps onto this
  wire without a judgement call: `CommandResultSchema` gives `rejected` a required `code` and gives
  `conflict` none (`src/domain/commands.ts:323-324`), so the two arms are the two result states. A
  transport throw takes the uncoded arm, which is the honest reading — it is not a server refusal
  and has no code of its own.
- **f.14 needed a shape change, not just a class change.** `SubjectFacts` grew an `inline` arm: its
  `ChipRow` is a grid, and a grid nested inside the demo's flex-wrap `Well` fights the wrap. The
  labelled block in `InlineParkedWrite` keeps the grid.
- **f.16 widened past the port.** The demo routes only the empty-note case to the Field; this now
  routes BOTH note problems there (empty and over-500), because the over-long case had the same
  defect in a quieter form. A refusal suppresses the field note — two verdicts on one answer.
- **f.22 verified, no change** — R3's `b70ef3d` carries `CANCEL_TREE_TITLE`, bound by key exactly as
  the audit anticipated.
- **Verification limit, stated.** The rebuild's park dialog could NOT be screenshotted: the D128
  Kuali parked write-intent is still in authority (`write_intents`, status `parked`, run
  `15d9d7db`), but that run has no row in the current `runs_view` projection, so no parked run is
  reachable from the queue on any served day. Verified instead by (a) reading the DEMO's
  `ParkResolutions` cards as an image at 1440×900 — tinted green/red cards, icon + bold label, the
  `detail` sentence in muted meta, two columns — which is what the port draws, and (b) the 5-case
  partition test. The f.18 strings WERE verified live on the rebuild: `Sort the queue` on the sort
  combobox, `Act on several rows at once` on the Select toggle, and `Select all 0 in view` reading
  `disabled: false`. Re-verify the park dialog visually the next time a run parks.

**STILL OPEN in R8 (two items, both already owned):** findings 5 + 6, the bulk command strip and
the bulk result-vector band, which build to demo spec behind the booked optional `actions[]` /
`expectedVersion` wire row; and findings 7 + 4, the global keydown listener and the
`ConfirmCommandDialog` mount, which the orchestrator assigned to the LAST dashboard-app commit of
the wave (keydown first, confirm mount with the action-projection wiring).
