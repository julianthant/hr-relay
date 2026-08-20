# HR Rebuild Roadmap
<!-- `docs/rebuild/14-roadmap.md` is the plan as written, in the roadmap notation (see .claude/skills/custom-update-plan/SKILL.md §Notation): everything between roadmap:start and roadmap:end renders at docs/roadmap/index.html via `npm run roadmap`; appendices after roadmap:end are prose. Per D263 (doc 07 §0.1) a node also carries `doc:` — the docs/rebuild sections owning its contracts — and a `log:` block, the append-only per-session journal the `## session:` spine markers summarise. -->
asOf: 2026-08-20
head: 8eb77ab
eyebrow: hr-automation-rebuild · the plan · source: docs/rebuild/14-roadmap.md
source: Stems from `docs/rebuild/07-master-plan.md` (§2 phases, §3.3 order, §3.7 sizes)
source: `docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` (Tracks 0/A/B/C)
source: `docs/plans/2026-08-20-dashboard-architecture-audit.md` (Track D) · doc 07 wins on any disagreement
footer: Generated from `docs/rebuild/14-roadmap.md` (the plan, written in the roadmap notation) by `npm run roadmap` — edit the plan, never this file; `/custom-update-plan` keeps plan, site and owning docs in step. The normative plan is `docs/rebuild/07-master-plan.md`; the decision changelog `docs/rebuild/04-reconciliation.md`. Sizes are relative build sizes (doc 07 §3.7), not calendar.
> The ground-up rebuild of UCSD's UCPath HR automation, as a tree. **Phases 0–2 are complete** — the platform is built and proven; **Phase 3** migrates the 13 remaining legacy workflows one at a time and entered at **separations**; legacy stays the sole production authority until one all-at-once cutover. Every box shows what it **builds** (by layer, filled when built) and what it **needs** — select one for detail, hover to light up what it unlocks.

tiles:
- Phases complete | 0 · 1 · 2 | runtime marker `completedThrough: 2j`
- Active | Phase 3 | per-workflow migration · entered at separations
- Workflows migrated | 2 of 15 | + separations at 8 of 9 exit criteria
- Decisions | D1–D264 | rounds 68–88 landed this wave · D131 retired, never reused
- Gates | 64 guards | 2,271 tests · parity 151/151 re-frozen 08-20 · schema v15
- !Critical-path blocker | Wait for 08-28 | canary **4537 named** — S7 admits its separation date then; the three commits run ② → ① → ③

<!-- roadmap:start -->

## Foundation design {#phase-0}
phase: Phase 0
status: done
when: 2026-07-31 | seeded from legacy @5879004
size: M
chip: complete
doc: 07 §2 · 07 §3 · 00
open: no

> Docs 00–13 reconciled through Round 12 (D1–D94); testing policy ratified; the all-at-once cutover (D89/D93) and the two-repo model ratified; the separations identity gate designed here, not at order 8 (D77).

builds:
- [x] DOCS the plan SSOT `docs/rebuild/00–13`, each doc owning its contracts
- [x] DOCS the decision changelog `04-reconciliation` as a pointer index
- [x] DOCS ALWAYS-GATE identity approval designed (doc 09 §14)
- [x] DOCS size model + MUST / SHOULD / LATER delivery tiers (D76)
- [x] DOCS two-repo coexistence + one cutover (D88–D94)

### ALWAYS-GATE identity approval
status: done
date: D77 · doc 09 §14

> Manual approval on every separation, both types, no auto-approve-on-match — the control that defends against the `T002173685` wrong-person incident, pulled forward from order 8.

### Size model + delivery tiers
status: done
date: D76 · doc 07 §3.7

> MUST (the spine) · SHOULD (Phase-2 tails) · LATER (explorer, advisories, catalog) — what may slip without invalidating the base.

## The SPINE {#phase-1}
phase: Phase 1
status: done
when: 07-31 → 08-04 | five days
size: XL
chip: complete 2026-08-04
open: no

> The minimum base that carries one workflow end to end. **Exit (D74): person-lookup ran LIVE** against real UCPath + CRM on the new executor — run `4ebf7275` / trace `pl-000619-4ebf`, recovered a dead CRM session mid-run, terminal `done` at attempt 2, all four parity surfaces from the ONE projection.

needs:
- phase-0

### 1a · 1b — guards, baselines, the strict domain leaf {#p1-base}
status: done
date: 2026-07-31
size: L

builds:
- [x] BE guard plumbing + the reviewed guard inventory
- [x] DOCS honest legacy baselines + the D58 capability inventory
- [x] BE strict domain leaf (zod at every boundary)
- [x] BE clock / config / secrets single-sourced (doc 11)
- [x] BE runtime isolation pinned (`.tracker-rebuild`, 3938/5174, locks)

### 1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG {#p1-authority}
status: done
date: 2026-08-01
size: XL

builds:
- [x] BE authority SQLite + backup / doctor / degraded mode / restore interlock
- [x] BE the command family + proof union type shells
- [x] BE semantic UI registry (406 ported selector keys, provenance-pinned) + ucpath / crm / kuali drivers
- [x] BE task contracts (doc 01) and the three authoring tiers
- [x] BE workflow DAG, delegation, the completion program (doc 02)

needs:
- p1-base

### 1f — registry, workers, commands, the write sequencer {#p1-kernel}
status: done
date: 2026-08-02 → 03
size: XL

builds:
- [x] BE the ONE `WORKFLOW_MODULES` composition root
- [x] BE worker loop with claim / heartbeat / CAS, worker-owned browser sessions
- [x] BE start-plan ingress authority (D109), terminal authority (D110/D114), provider admission (D112)
- [x] BE the write sequencer: probe → prepare → binding proof → fence → commit → proof → atomic outbox
- [x] BE login proven by CONTENT, never URL (D120); Duo Autopilot hands-off

needs:
- p1-authority

### 1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell {#p1-spine}
status: done
date: 2026-08-04
size: M

builds:
- [x] BE span emission + the one run/queue projection
- [x] BOTH in-process Hono BFF: bootstrap / day / run-detail queries, one typed client, resumable SSE
- [x] FE the exact Person Lookup shell in the approved design system, both themes
- [x] PROOF the Playwright parity lane (a11y + screenshot, ASSERT mode)

needs:
- p1-kernel

### Phase 1 exit — the live run {#p1-exit}
status: done
date: D74 · 2026-08-04

> Found three presentation defects no fixture could — skipped-arm (D123), terminal duration (D124), accessible-name collision (D126) — all fixed the same day. Open item it left: a dead CRM session cost **262.9 s** to surface → `sessionAcquireMs` (D125).

builds:
- [x] PROOF person-lookup live against real UCPath + CRM, dead-session recovery mid-run, all four parity surfaces from one projection

needs:
- p1-spine

## Transaction proof, then the deferred base tails {#phase-2}
phase: Phase 2
status: done
when: 08-04 → 08-09 | six days
size: XL
chip: complete 2026-08-09
open: no

> **The controlled commit is MET live (D135):** one real Kuali write on doc `4489` — dry run zero durable rows · forced mismatch refused pre-fence · commit 16.45 s with reload read-back proof · idempotent re-run `already-present` in 2 ms · both docs restored. Then four tails landed against a proven spine.

needs:
- p1-exit

### Transaction proof — the first real write {#p2-proof}
status: done
date: D128–D135 · 2026-08-04
size: L

> Same-day withdrawal of the wrong D128 conclusion: the two real causes were driver defects in THIS tree (a ~700 ms gadget debounce, a `commit` returning at request time). Write-heavy migration unblocked.

builds:
- [x] BE `kuali/save-timekeeper-annotation` — the one-transaction-node proving workflow
- [x] PROOF fence durable before the click, reload read-back, propagation window measured (`recoveryAbsence: stabilized`)
- [x] BE mutation-capability registry; `write-sequencer.ts` the only mint
- [x] BOTH preview / binding / fenced write / read-back / parked-write resolution through the production client

needs:
- p1-exit

### 2g — event / trust layer {#p2-2g}
status: done
date: D134–D145
size: L

builds:
- [x] BE schema v10
- [x] BE automatic redacted diagnostic capture
- [x] BE durable actor-keyed notification inbox (row commits before any OS delivery)
- [x] BE knowledge / fix admission
- [x] BE ordered fsync'd ledger projector
- [x] BE D82's evidence receipt DERIVED from authority

needs:
- p2-proof

### 2h — data / intake foundation {#p2-2h}
status: done
date: D146–D167
size: XL

builds:
- [x] BE canonical field registry + column mapping
- [x] BE validation / rejection + immutable intake manifests + rerun diff
- [x] BE extraction / OCR / roster / normalization stores
- [x] BOTH OCR three-producer routes (live-proven on the real 44-page I-9 scan) + classify/group scanner
- [x] WIRE executor / worker provider + artifact wiring
- [x] BE durable capture sessions
- [x] BE Edit Data core
- [x] DOCS legacy change accounting RETIRED (D150)

needs:
- p2-proof

### 2i — the operator surface (A–G) {#p2-2i}
status: done
date: D168–D180
size: L

builds:
- [x] BOTH trust surfaces + notification bell over the durable inbox
- [x] BOTH Edit Data rail (D168)
- [x] BOTH Settings + storage doctor + live backup cadence (D169)
- [x] BOTH intake surface over schema v12 (D170–D173)
- [x] BOTH token-scoped phone capture: QR start, PDF bundler, intake handoff (D174/D175)
- [x] BOTH read-only Workflow Explorer + UI catalog
- [x] BOTH AI advisories (redaction / strict-output / exhaustion / zero-authority pinned)
- [x] BOTH archive model (schema v13, UPDATE/DELETE aborted in SQL) + version bump + Activity report (D176–D180)

needs:
- p2-2g
- p2-2h

### 2j — the closing gate {#p2-2j}
status: done
date: D181–D190 · 2026-08-09
size: M

> **Found four real defects every earlier green gate missed:** `cli storage restore` could never have worked (D181); every `paper-ink` parity reference had been photographed dark; the run-detail trust panel was **2 px wide** since 1i-spine (D187); the receipt builder 500'd on a reachable path.

builds:
- [x] PROOF scenario corpus + `scenario-coverage` audit
- [x] PROOF restore drill on a copy of the real authority DB (corrupt → doctor refuses 0.92 s → restore 0.99 s)
- [x] PROOF 3-worker soak, concurrency matrix, redaction scan
- [x] DOCS capability-inventory validation (D184/D188)
- [x] DOCS every owning doc to as-built

needs:
- p2-2i

### Left Phase 2 by explicit disposition
status: never

> Workflow Explorer EDIT half — D186, trigger: the *second* production workflow whose policy you want to change · BFF serves no frontend bytes / no `dashboard:prod` — D189, builds at the first phone-consuming migration (orders 3–4), confirmed 2026-08-12.

## flag: 2026-08-12 | **D193 — scope and entry.** Solo, local, never hosted. Phase 3 enters at **separations (order 8)**, chosen to force the store task libraries into existence; the §3.3 ordering is NOT re-sequenced. Separations questionnaire fully answered → READY TO BUILD. `test:coverage` becomes the per-commit gate (D191).

## Per-workflow migration — separations first {#phase-3}
phase: Phase 3
status: active
when: 08-12 → today | nine days so far
size: XL
chip: active
open: yes

> One workflow at a time through the seven-step loop (doc 07 §3.1): questionnaire → author → guards → **live dry run** → **controlled commit** → rebuild-ready → close-out. The order of work inside the phase: **the dashboard defaults first** (the generic surfaces every workflow inherits), then each workflow as ONE migration node — its store chunks, its live proofs, its controlled commits, and its own **dashboard wiring** on top of the defaults. Separations went first and forced the defaults into existence; they are now a prerequisite every later migration reads.

needs:
- p2-2j

### Dashboard defaults — the generic surfaces every workflow inherits {#dash-defaults}
status: active
chip: B+C done · D ratified (D264)
size: L

> Built ONCE so a migration only wires it: the run modal, queue rows, run detail + timeline, gate ceremonies, notifications, archive, activity, explorer. Track B finished the surfaces with separations as the forcing function; Track C is proving the connection against a real run; Track D hardens the stack before cutover. A workflow's own "Dashboard · wire" task sits under that workflow and reads this node as its prerequisite.

needs:
- p2-2i

#### Track B · dashboard completion {#track-b}
status: done
chip: B1–B8 all landed · 08-19 → 20

> Separations as the forcing function; the findings ledger swept to zero-or-decided — the definition of "frontend done".

builds:
- [x] BOTH B1 the three identity-approval ceremonies + rejection, against the SERVER's shape; gated parity fixture (D226)
- [x] BOTH B2 a settled gate's decision on the panel; a rehearsal never wears `verified-done` (D237/D238)
- [x] FE B3 the run modal's four rows — three were already in the bundle, one drawn as a read-only fact (D250/D251)
- [x] BOTH B4 queue rows: `QueueBaseFields` served + drawn, rename, the bulk strip + result vector, runs + archived runs (D230–D235)
- [x] BOTH B5 archive: frozen sections, five tabs, Export, ledger read-through (D223)
- [x] BOTH B6 explorer: field census, the declared `when` in words, descriptor prose (D227–D229)
- [x] WIRE B7 worker-card / session-footer batch; the rail names step, direction and bound; a CAS conflict is a refusal (D252/D253)
- [x] BE B8 findings ledger zero-or-decided; `span.patched` RETIRED; a span close binds to an OPEN entry (D254/D255)

#### Track C · connection proof {#track-c}
status: done
chip: done 08-20 — §9.22 + the five same-day fixes + the ONE re-freeze

> One pass: the REAL dashboard drives a REAL composed separations dry run — plan → start → gate parks → approve through the B1 ceremony → resume → preview terminal → archive — every UI assertion paired against a direct authority-database check. Closes with the ONE deliberate parity re-freeze. Re-runs over the real commits as Track A's final evidence. Already found and fixed two projection defects on the real run (D258/D259).

builds:
- [x] PROOF `docs/migrations/separations.md` §9.22 — items 1–8 recorded
- [x] BE D258 a timeline event id carries its occurrence ordinal, read forward — the one pre-D214 run that was refusing every archive reads again
- [x] BOTH D259 a replayed step is its own timeline arm (`replayed`, with `replayedFrom`), never `pending`
- [x] PROOF every surface's assertion paired against a direct authority check over the ONE run (§9.22 items 1–8)
- [x] BOTH the five §9.22 defects fixed same-day — ticking served clock (D256), SSE-followed panel (D257), honest shape hazard, replayed arm (D259), archive unblocked (D258)
- [x] BOTH D261 the start door — `resolve-action` finds the action id from the document number; the modal takes ONE box; live run `sp-105225-1e0b` parked at the gate, zero writes
- [x] PROOF the deliberate parity re-freeze — 151/151 assert-green, every drift mapped to its decision

needs:
- track-b
#### Track D · dashboard hardening, pre-cutover budgets {#track-d}
status: planned
date: D264 · audit 2026-08-20
chip: ratified 2026-08-20 (D264) · D1–D5 planned · D6–D10 proposed

> From the 2026-08-20 architecture audit (`docs/plans/2026-08-20-dashboard-architecture-audit.md`). **Verdict: the stack and shape are right; nothing is swapped.** Eleven ordered moves, none a rewrite, sequenced after Track C and before the next workflow leans on the dashboard. **Ruled by D264:** the track sits here under the dashboard defaults; D1–D5 are planned; D6–D10 stay proposed behind one named trigger; and §3.5 is answered — the descriptor registry LEAVES the browser bundle as row D11, amending D251. D4 and D5 double as the FIRST measurement of doc 13 §7.4's performance budgets, whose recorded numbers become the non-regression gates for every later workflow.

builds:
- [ ] BE D1 one status/outcome derivation — exported `deriveRunStatus`, ONE `TASK_OUTCOME` vocabulary, ONE `panelKindOf`; the detail panel stops disagreeing with the queue row (closes C1/C2, part of M3)
- [ ] BOTH D2 hygiene — dead hooks and exports deleted, a typed not-found error instead of message-sniffing, the inert phone-host gate wired or deleted with its D189 note, `testSystemsOf`/`plural`/`shortHash` unified, the D253 sentence corrected (closes C3/C4/M7/M8)
- [ ] FE D3 every command settlement folds through `settleCommandResult` — 7 sites still enumerate both refusal arms by hand (closes C5)
- [ ] BOTH D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; then MEASURED against a seeded 1,240-row / 108-member fixture and recorded as doc 13 §7.4's first numbers (closes P1)
- [ ] BE D5 bound the read scans — the member preview slices ids before joining, one receipt read per row, the notes reader scoped by workflow and day range, the archive freeze reads the corpus once; measured and recorded (closes P2/P3/P4)
- [?] FE D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate and `state/` becomes what doc 13 §2 says it is (closes M2)
- [?] FE D7 split `LoadedApp` along its own seams — `useDayRoute`/`useRunDetailState`/`useBulkSelection` into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx` (closes M1)
- [?] BOTH D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, and ONE `foldTaskExecutions(row)` for pipeline / timeline / archive (closes M3/M5/M6)
- [?] FE D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured (closes P5)
- [?] BOTH D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped (closes M4)
- [ ] BOTH D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads (`summary`, `enqueue`, `surfaces.inputRun`) and `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import (amends D251; doc 13 §4)

needs:
- track-c
- fact(met): operator ruling 2026-08-20 — D1–D5 planned, D6–D10 proposed, §3.5 → move (D264)

note: D6–D10 are the maintainability slice and carry ONE trigger — they start before the second migration's `Dashboard · wire` task does, and until then they stay proposed; once D1–D5 land they can be dispatched as independent worktree units.

log:
- 2026-08-20 | docs-cohesion step 4a | ratified by D264 — D1–D5 planned, D6–D10 proposed, D11 added (77a0be76)

### Separations — order 8, the first migration {#order-8}
status: planned
size: XL
chip: 8 of 9 — the three commits wait for 08-28 (S7)

> write-heavy — UCPath termination + Kuali finalization. The wrong-person incident (`T002173685`); the deepest write-safety proof, entered first by your choice (D193). Built bottom-up: store tasks first, one small provable sub-workflow per system interaction, then composed — lego recomposition, never conditional branches inside one monolith (§3.1/§3.2 directives). What remains is the calendar: canary 4537 is named and mapped, and S7 admits it on 2026-08-28.

needs:
- dash-defaults
- track-a

#### 1 · new-kronos timecard read {#sep-1}
status: done
date: D196 · D205 live 08-13

> Live proof took 17 attempts and ten defects — the last two (pinned-viewport scroll, header/cell column offset) unreachable by any fixture.

builds:
- [x] BE the `new-kronos` store: real driver, login recipe, published UI registry, 16 ported selectors live-re-verified
- [x] BE two page-visit read tasks; `separations-kronos-timecard` sub-workflow
- [x] BE virtualized-grid read terminated on coverage, not on the widget (D205)
- [x] PROOF live proof: run `sk-171645-4adf`, 64-day window, 67 days covered

needs:
- fact(met): §b questionnaire answered (2026-08-12)

#### 2 · Kuali separation-document read {#sep-2}
status: done
date: D197 · live 08-12

> Five real runs `done`, three with `verified` receipts over real documents.

builds:
- [x] BE a READ family on the existing `kuali` driver (14 more selectors live-re-verified)
- [x] BE the `separations` pure mini-store
- [x] PROOF §4a termination-type map captured live: 16 options + blank sentinel, exact-match-only, no default arm

#### 3 · UCPath employment grid + the ALWAYS-GATE {#sep-3}
status: done
date: D201–D203 · live 08-12

> The first live gated run: parked, a real approval through the real command endpoint, resumed — and it found that a gate's durable record is not a checkpoint (D203).

builds:
- [x] BE rich whole-grid UCPath read, classified by a pure fold (D201)
- [x] BE the identity-approval gate node, server-computed approval shape
- [x] BE gate results as dependency evidence (D203) and in the receipt (D204)
- [x] PROOF first live gated run — parked, real approval through the real command endpoint, resumed

#### 4 · UCPath termination WRITE {#sep-4}
status: done
date: D206 · prepare live 08-14

builds:
- [x] BE two fenced transactions: the pending sweep + the filing
- [x] PROOF Smart HR wizard prepare arm live-proven
- [x] PROOF a duplicate-filing defect caught by the first live read

needs:
- sep-3

#### 5a/b/c · Kuali finalization WRITE {#sep-5}
status: done
date: D207 · D217 · prepare live on doc 4524

builds:
- [x] BE ONE transaction node behind the same gate
- [x] PROOF all ten `submitDocumentV2` formKeys captured passively off Kuali's `ActionPage`
- [x] BE the step-13 date write-backs folded into the one-pass staged set (D217)

needs:
- sep-2

#### 6a · THE COMPOSITION {#sep-6a}
status: done
date: D211

> An approval of a person is not an approval of a date — the packet's digest covers what the approval authorises.

builds:
- [x] BE eighteen nodes, one ALWAYS-GATE, three fenced transactions
- [x] BE the gate packet carries the dates, template and department the approval binds

needs:
- sep-1
- sep-4
- sep-5

#### 6b · composed LIVE pass {#sep-6b}
status: done
date: D212–D215

builds:
- [x] PROOF whole read chain on two real subjects in 82 s, parked, approved, resumed — zero durable write rows
- [x] BE checkpoint key gains `claimGeneration` (D214, schema v14)
- [x] BE a dry run probes in the real order and REPORTS `already-present` (D215)

needs:
- sep-6a

#### 6c · PREVIEW TERMINAL reached {#sep-6c}
status: done
date: doc 4502 · canary 4510 refused pre-gate

> Still zero write rows beyond 2026-08-04's proof.

builds:
- [x] PROOF a real `transaction.previewed` terminal with a `partial`/`unknown` receipt
- [x] PROOF the real run on 4510 refused `NO_ACTIVE_EMPLOYMENT` before the gate

needs:
- sep-6b
#### Track A · separations backend completion {#track-a}
status: planned
chip: canary 4537 named — S7 unblocks 08-28

> Separations is at **8 of 9 exit criteria**. The canary is **doc 4537** (named 08-19, mapped live in §9.19: the first subject with an active terminable employment). S7 refuses to plan until its separation date, **2026-08-28** — then ② UCPath filing, ① the pending sweep on the row ② creates, ③ Kuali finalization.

builds:
- [ ] PROOF controlled commit ① pending sweep · ② UCPath termination · ③ Kuali finalization — each with fence + read-back evidence
- [ ] PROOF `probeToFenceMaxMs` per beat; D207's 30 s Kuali window on this write's own evidence; seven Kuali payload shapes observed live; the `would-prepare` preview arm live
- [x] PROOF the first live RETRY on the composed graph — six retries, two lineages, one `done` (§9.20)
- [x] BE browser-profile wedge root-caused (A7)
- [ ] DOCS close-out: regression scenarios, knowledge records, capability dispositions → separations **rebuild-ready**

needs:
- sep-6c
- you(met): name the §4f2 canary target(s) — doc 4537, 2026-08-19
- fact: S7 admits doc 4537 on 2026-08-28 (its separation date)

| # | Step | Status |
|---|---|---|
| ✓A1 | **Canary named: doc 4537 / EID 10628128** (08-19) — §9.19 mapped it live: one Active terminable employment, every finalization control resolving; 4524 and 4510 both gone | done |
| A2–A4 | Controlled commits, in the order the facts force: ② UCPath filing → ① pending sweep (on the row ② creates) → ③ Kuali finalization | **08-28** (S7) |
| A5 | Obligations only the commits discharge (timings, propagation window, seven payload shapes, the preview arm live) | after A2–A4 |
| ✓A6 | Live RETRY on the composed graph — six retries, no collision, one reached `done` (§9.20) | done |
| ✓A7 | Root-cause the browser-profile wedge — **closed by D243/D244** | done |
| A8 | Close-out (§3.1 step 7) → separations **rebuild-ready** | after A2–A7 |
#### Dashboard · wire separations {#sep-dash}
status: active
chip: 9 of 9 wired — every square filled (D262 closed the last)

> What the generic surfaces learned about separations, and the two separations-specific things no default covers (the ALWAYS-GATE's ceremonies, the three commit contracts' ledger lines). Built with Track B as the forcing function, so most squares are already filled; the empty ones are wires not yet run — not sloppy surfaces.

builds:
- [x] WIRE run modal — typed start inputs (document number, subject) from the descriptor's `surfaces.inputRun`; the four run-modal rows (D250/D251)
- [x] WIRE queue row — subject title, class, rehearsal hue, linked-run chips, per-row actions, the bulk strip (D230–D235)
- [x] WIRE run detail — the descriptor's declared timeline CATEGORIES (D225), per-step durations, the data rail naming step · direction · bound (D252)
- [x] BOTH gate ceremony — the ALWAYS-GATE's three ceremonies + rejection, server-shaped (D226); the settled decision on the panel (D237)
- [x] WIRE archive — separations' three commit contracts are the first `LEDGER_PRESENTATION_DECLARATIONS` entries (D223)
- [x] WIRE explorer — field census, the declared `when` in words, the descriptor's prose (D227–D229)
- [x] WIRE activity — separations in the per-workflow cross-tab + the write-ledger block (D236)
- [x] WIRE notifications — a park at the ALWAYS-GATE publishes a needs-you row to the durable inbox, by re-derivation over authority; the bell links to the run (D262)
- [x] PROOF connection proof — every surface read against the real composed run, each UI assertion paired with authority (Track C, separations §9.22; five defects found and fixed same-day)

needs:
- dash-defaults

### Platform fixes the live runs forced {#platform-fixes}
status: done
date: 2026-08-14 → 19

builds:
- [x] BE D218 the projector tails the span stream FROM DISK, cross-process
- [x] BE D221 a retry is the ITEM's next attempt
- [x] BOTH D219/D220 workflow roles (composition / chunk-harness / proving)
- [x] BOTH D222 the backup hazard moved from the banner to the durable inbox
- [x] BE D243/D244 Duo's shared signature counter — the browser-profile wedge root-caused
### Smaller operator calls open {#operator-calls}
status: you
chip: needs you

> The gate-age pill (D12 vs your later direction) · D192 re-disposition of `legacy-tool-ops-sanity-check-record` · A6's first live retry as evidence. (The decide-first findings are settled: hours-saved DROPPED by D239; archive tabs and export closed by D223/D240.)

## session: 2026-08-20 | docs-cohesion steps 1–2 | the plan moved to docs/rebuild/14-roadmap.md (0990ebc5); the notation grew doc: · log: · session: (ea7704e0); D263 + D264 ratified; Track D redrawn

## today: 2026-08-20 · HEAD 8eb77ab · separations 8 / 9 · Tracks B+C DONE · parity re-frozen 151/151 · the three commits wait for 08-28

## The remaining migrations {#migrations}
phase: Phase 3 · continued
status: planned
when: next | undated — order, not calendar
chip: 12 workflows · order by risk / reuse
open: yes

> Doc 07 §3.3's risk-proof ordering, kept as-is after the separations entry (order 8 is the migration in flight, under Phase 3 above): reads populate the stores, the OCR service unblocks four consumers, write-heavy lands last. **No workflow after separations is named yet.** Each owes the 12-item §b questionnaire before building, a live dry run, (for writes) a controlled commit on a target you approve — and its own **Dashboard · wire** task on top of the defaults. **Store reality:** only ucpath, crm, kuali, new-kronos have real drivers today; onbase, servicenow, i9, old-kronos, sharepoint are 3-line session declarations with zero tasks.

needs:
- phase-3

note: **Legacy capability register:** 48 open · 20 replaced · 7 native · 3 retired — cutover requires zero open. Every entry advances to native / replaced / retired at its order's migration.
### Order 0 · person-lookup {#order-0}
status: done
size: M
chip: live-proven (Phase 1)

builds:
- [x] BOTH resolve a person by name / EID against real UCPath + CRM

#### Dashboard · wire person-lookup {#order-0-dash}
status: done
chip: the Phase 1 slice

> The first wiring, done in 1i-spine and proven live by D74: the typed Start Run surface, the queue row, run detail + receipt, the Context rail — all four parity surfaces from one projection.

builds:
- [x] WIRE run modal — name / EID typed inputs, the start plan
- [x] WIRE queue row — the person-lookup row, status and timing (D123/D124/D126 fixes from the live run)
- [x] WIRE run detail — timeline, receipt, Context rail; the two-pixel panel found and fixed in 2j (D187)
- [x] WIRE archive · activity · explorer — person-lookup rows appear through the generic surfaces

needs:
- dash-defaults

### Order 1 · person-lookup Search + Match · i9-lookup {#order-1}
status: planned
size: M

> read — HR-Tasks Search/Match; who signed I-9 §2. Two modes prove one descriptor can preserve distinct system surfaces.

builds:
- [ ] BOTH Search + Match modes on person-lookup (D15)
- [ ] BE the `i9` store: driver, login recipe, tasks (zero today)
- [ ] BOTH i9-lookup workflow + its queue/detail surfaces

needs:
- phase-2
- you: §b questionnaire (12 answers) for each workflow

#### Dashboard · wire Search + Match · i9-lookup {#order-1-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about person-lookup's two modes and i9-lookup: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for person-lookup's two modes and i9-lookup (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose

needs:
- dash-defaults

### Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports {#order-2}
status: planned
size: M

> read / download — iDocs PDFs; rosters; Time Detail PDFs. Single-system reads and downloads at low risk.

builds:
- [ ] BE the `sharepoint` and `old-kronos` stores (declaration-only today)
- [ ] BE crm document download on the existing crm driver
- [ ] BOTH downloads land as content-addressed artifacts; the artifact-bytes route

needs:
- phase-2
- you: §b questionnaire for each workflow

#### Dashboard · wire the downloads {#order-2-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about crm-doc-download · sharepoint-download · old-kronos-reports: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for crm-doc-download · sharepoint-download · old-kronos-reports (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH download viewer — the artifact-bytes route + a per-run downloads tile

needs:
- dash-defaults

### Order 3 · the OCR pipeline workflow {#order-3}
status: planned
size: M

> service — PDF → extraction → review → fan-out. No browser, no submit; the 2h service stores are already built.

builds:
- [ ] BE the OCR pipeline workflow over the 2h extraction / normalization / ocr / roster stores
- [ ] BE **D189's byte path**: BFF static handler + `capture.html` + ngrok launcher + the phone-origin guard arm; `--prod` starts meaning what it says
- [ ] WIRE capture → workflow binding (`CAPTURE_INTAKE_BINDINGS` filled for the first honest consumer)

needs:
- p2-2h
- you: §b questionnaire

#### Dashboard · wire the OCR pipeline {#order-3-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about the OCR pipeline workflow: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for the OCR pipeline workflow (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH OCR review UI — expanded page ↔ extracted-text pair, approve / reject / retry page, one atomic correction list
- [ ] WIRE review/approve commands + progressive record patches over the SSE stream

needs:
- dash-defaults

### Order 4 · oath-signature · emergency-contact {#order-4}
status: planned
size: L

> OCR fan-out + light write — oath date rows; emergency-contact fill. Exercises the completion union (D11), approval gates (D5) and operation-member fan-out; the write is a bounded UCPath enter/fill.

builds:
- [ ] BOTH first operation fan-out + approval gates through the real review UI
- [ ] BE oath-signature and emergency-contact workflows
- [ ] PROOF the first non-separations controlled commits on UCPath enter/fill

needs:
- order-3
- you: §b questionnaire; controlled-commit target approval

#### Dashboard · wire oath-signature · emergency-contact {#order-4-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about oath-signature and emergency-contact: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for oath-signature and emergency-contact (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] BOTH gate ceremony — the approval shape this workflow's gate demands, server-computed
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] FE Group People — paged members + rollup + containment over real operation members

needs:
- dash-defaults

### Order 5 · i9-check {#order-5}
status: planned
size: L

> UCPath read + durable roster projection — verify I-9 packet, the master retention workbook. Operation coordinator + member enqueue + display-only rows, no external submit.

builds:
- [ ] BE the operation coordinator at scale
- [ ] BE stable-keyed SQLite outbox + serialized workbook projector
- [ ] BE the first Excel export writer (the master I-9 retention workbook)

needs:
- order-1
- order-4
- you: §b questionnaire

#### Dashboard · wire i9-check {#order-5-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about i9-check: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for i9-check (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] FE member rows with retention status; the workbook export control

needs:
- dash-defaults

### Order 6 · work-study · kronos-pay-rule {#order-6}
status: planned
size: L

> **first real writes** — PayPath pool/comp; UKG pay rules. Small, isolated workflow-specific production commits on the proven transaction kernel.

builds:
- [ ] BE work-study and kronos-pay-rule commit contracts
- [ ] PROOF the canonical-EID audit gate: replay real stored inputs through `Eid` `/^10\d{6}$/`, surface every rejection
- [ ] BE the new-kronos store gains its pay-rule write family

needs:
- sep-1
- p2-proof
- you: §b questionnaire; controlled-commit target approval

#### Dashboard · wire work-study · kronos-pay-rule {#order-6-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about work-study and kronos-pay-rule: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for work-study and kronos-pay-rule (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH intake grid constants entry + unbind arm (`effectiveDate`, D172/D173)

needs:
- dash-defaults

### Order 7 · oath-upload · onbase {#order-7}
status: planned
size: L

> write-heavy — ServiceNow ticket + PDF; OnBase document import. Prove ServiceNow `receipt`; resolve OnBase OQ2 (`upload-verify` vs `unverifiableByPage`); oath-upload ports the born-at-upload fence.

builds:
- [ ] BE the `servicenow` and `onbase` stores (declaration-only today)
- [ ] BE ServiceNow receipt probe; OnBase upload-verify
- [ ] BE oath-upload's born-at-upload fence
- [ ] PROOF rebuild-verified propagation windows for ServiceNow

needs:
- order-6
- you: name a ServiceNow live-probe target
- you: name an OnBase probe target (none exists today)

#### Dashboard · wire oath-upload · onbase {#order-7-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about oath-upload and onbase: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for oath-upload and onbase (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] WIRE ServiceNow ticket receipt + OnBase upload-verify on the run-detail receipt

needs:
- dash-defaults

### Order 9 · onboarding {#order-9}
status: planned
size: XL

> write-heavy — the real hire transaction. The duplicate-person incident; last, highest-stakes, most reuse of everything below it.

builds:
- [ ] BE the hire probe with the no-EID key (`ProbeVerdict`-widened)
- [ ] BE roster ingest
- [ ] BE the onboarding composition over the ucpath / crm / kuali / kronos stores

needs:
- order-8
- order-5
- you: §b questionnaire; a hire canary you approve

#### Dashboard · wire onboarding {#order-9-dash}
status: planned
chip: inherits the defaults — wiring only

> What the generic surfaces must learn about onboarding: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for onboarding (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] BOTH gate ceremony — the approval shape this workflow's gate demands, server-computed
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (doc 03 §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH roster ingest surface; the hire canary's ceremony

needs:
- dash-defaults

### Cross-cutting Phase 3 capabilities (no single order) {#cross-cutting}
status: planned

> Where legacy is still ahead — the honest list, each shaped against a real run corpus rather than invented in planning.

builds:
- [ ] BOTH editable settings — the `apply-settings` command family (read-only today; D169/D184)
- [ ] BOTH cross-date search module
- [ ] BOTH screenshots gallery + the artifact-bytes route
- [ ] BE Excel export writers (3 in legacy)
- [ ] DOCS `test-login` / setup wizard equivalents, or their retirement with evidence

needs:
- phase-3
## The X → Y traceback {#deferred}
phase: Deferred
status: planned
when: comes due | at a named trigger
chip: every deferral names its trigger
chip-tone: never
open: no

> "I want to do X; the plan said build Y; Y is deferred." None is silently dropped, none is "can't ever work"; two have a decided stance instead of a trigger (D193) — they simply do not get built unless you ask.

note: **Never, by design:** unverified silent fallbacks · selector `.or()` chains · per-daemon logs / bespoke polling hooks / secondary count caches · per-action mutation routes · generic retry on a parked write · DSL/codegen workflow authoring (D79a) · LAN/remote operator mode · hosting (D193) · legacy change accounting (D150).

### Photograph a paper form on your phone → it becomes an OCR-backed run {#def-capture-binding}
status: planned

> `CAPTURE_INTAKE_BINDINGS` is deliberately empty — neither current workflow can honestly derive an employee id from a photograph. Comes due with the first OCR-consuming workflow; "close this first": the `run.queued` span from projector-enqueued runs.

needs:
- order-3

### Run the dashboard without the dev server / use the phone page in production {#def-byte-path}
status: planned

> BFF static bytes + `capture.html` + the ngrok launcher + a guard arm that the file handler serves nothing outside the capture allow-list to a phone origin. D189 / D175; "production" here means LOCAL (D193).

needs:
- order-3

### Edit a workflow's presentation / policy without a code change {#def-explorer-edit}
status: planned

> The Workflow Explorer EDIT half. D186: an editor shaped by a sample of one workflow would be wrong.

needs:
- fact: a SECOND production workflow whose policy you want to change

### A record-sanity-check advisory panel {#def-sanity-check}
status: planned

> The one AI tool kept open (run-summary and selector-suggestion are RETIRED, D192). §9.17 flags its deferral condition as materially satisfied by the §14.2 packet's comparisons.

needs:
- order-8
- you: re-disposition D192 (keep open / close the inventory entry)

### Edit settings in the dashboard {#def-settings}
status: planned

> The `apply-settings` command family — rebuild settings are read-only, "nothing here pretends to save" (D169/D184). Phase 3 milestone, no single trigger; listed under cross-cutting above.

needs:
- cross-cutting

### Trust UCPath / ServiceNow wait-before-negative-read windows {#def-propagation}
status: planned

> Rebuild-verified propagation measurements replace ported legacy knowledge at each system's own live probe (doc 07 §3.8).

needs:
- order-7

### Search runs across dates / view screenshots / export Excel {#def-search-export}
status: planned

> No search module, artifact-bytes route or export writers in the BFF yet — capability register open; shaped against a real run corpus.

needs:
- cross-cutting

### Auto-purge diagnostics on the 14/8/5 schedule · reclaim unreferenced artifact bytes {#def-retention}
status: never
chip: won't build unless you ask

> Retention-sweep scheduling (the sweep itself is built and tested) and a content-store refcount — D193: disk growth on one local machine isn't worth a durable reference count.

## One all-at-once authority switch {#cutover}
phase: Cutover
status: planned
when: after Phase 3
size: L
chip: not started
open: no

> D89 / D93. No workflow flips individually, no mixed-engine production, ever. The entire legacy repo is preserved as the rollback asset; nothing in it is deleted until rollback-window closure with separate explicit authorization.

builds:
- [ ] PROOF stop new legacy enqueues → drain / park / reconcile → back up both repos' state
- [ ] BE approved offline one-time imports (`one-time-import-offline` guard activates)
- [ ] PROOF atomically repoint the launcher → smoke gates
- [ ] PROOF rollback bridge verified before the switch

needs:
- order-1
- order-2
- order-3
- order-4
- order-5
- order-6
- order-7
- order-8
- order-9
- cross-cutting
- track-d
- fact: legacy capability register at zero open (48 open today)
- fact: doc 07 §6 definition of done + doc 07 §7.4 / doc 13 §10 integration criteria green in the real built app

### Rollback window, then closure {#rollback-window}
status: planned

> Legacy code, tests and state intact; closure is its own later authorization.

needs:
- cutover

### Later, unplanned {#later-unplanned}
status: never
chip: ideas, not a hosted future

> Package the local app ("web app → real app"); a cooperation / multi-user mode built on top of solo (D193).

<!-- roadmap:end -->

---

## Appendix A · Decision log and future gates (prose, not rendered)

  this graph is still owed as evidence.

### Decided

- **The 08-14→08-15 platform + dashboard delta (D214–D221 and the detail-fidelity wave)** —
  2026-08-14/15. Platform: **D214** — a checkpoint's identity gains `claimGeneration`, because a
  gate park + resume are two executions inside one attempt (schema **v14**, rebuilds
  `run_checkpoints`); **D215** — a dry-run preview runs beat ①'s probe in the real order and
  REPORTS `already-present` instead of failing where the real path succeeds; **D216** — both repos'
  browser profile root is ONE name, `.auth`, distinctness carried by the session namespace;
  **D217** — legacy step-13's two Kuali date write-backs join §4e's one-pass staged set (ten fields
  → twelve, one save, one twelve-field read-back); **D218** — the run/queue projector tails
  `spans/*.jsonl` from disk with byte cursors, the in-process `onEvent` hook deleted, so a
  cross-process worker's runs render their timelines; **D219/D220** — every workflow module
  declares a closed `role` (`standalone`/`composition`/`chunk-harness of`/`proving`), harnesses
  nest under their composition, and the rail lists main workflows only; **D221** — the checkpoint
  key's `attempt` is the ITEM's attempt, so a retry no longer collides with its own checkpoint
  (no migration — the field's MEANING moved, not a byte on disk). Dashboard: queue rows serve and
  draw `liveMessage`/`dryRun`/gate-age/warnings/per-row action descriptors/subject-as-title;
  run-detail timeline events carry each step's own measured duration; archive gained the instance
  filter, computed per-record retention, and the write-ledger read-through; the Activity report
  gained the per-workflow × status cross-tab with the Who column. Findings-ledger policy stands:
  backend problems found in frontend sessions are recorded in `docs/findings/`, never fixed there.
  canary 4510 refused before the gate** — 2026-08-14 (`docs/migrations/separations.md` §9.17). Two
  parts, and **nothing was written by either**: the only write-intent / write-attempt / outbox rows
  in the database are still 2026-08-04's Phase-2 commit on Kuali doc 4489, and no separations
  transaction node has ever written a checkpoint. **(1) The last blocked deliverable is DONE.** With
  the BFF restarted on the current tree, the composed dry run on doc 4502 ran the whole chain live,
  parked at the ALWAYS-GATE, took a real approval through the real command endpoint, resumed, and
  ended at a genuine **preview terminal** — the `transaction.previewed` span, a terminal record bound
  to the PREVIEW schema hash (never the workflow's declared result), and a receipt that says
  `partial` / `unknown` with a load-bearing `DRY_RUN_PREVIEW` warning naming the probe. That also
  proves **D215's `already-present` arm live** for the first time and **D214** across three claim
  generations. **(2) Your canary answered its own question.** The composed `separations` graph, run
  for REAL (not dry) on doc **4510**, refused `NO_ACTIVE_EMPLOYMENT` 17.6 s in, **before the gate
  opened and before any human was asked** — UCPath still shows exactly one employment row for EID
  10001799 and it is `Inactive`. Deleting `T002209631` cleared a *transaction*; it did not change an
  *employment status*, and the already-Approved `T002197996` is why. **For 4510 to move on this graph
  you must make an active terminable employment exist in UCPath** — that is yours, not the code's,
  and doc 4510 remains the best-mapped target for a Kuali finalization commit on the STANDALONE
  graph, which has no such node. **(3) Reaching the preview found a fourth defect**: D215's fourth
  subject verdict (`not-observed`) had been ratified and landed in the kernel but never reached the
  span WIRE schema, so the first preview that ever settled killed the worker one emit short of its
  terminal — the run itself was correct throughout, and the platform's own self-sweep released the
  orphaned claim on the next boot. Fixed with its test. **(4) One correction to the record**: the
  `probeToFenceMaxMs` measurement does **not** ride on the preview terminal — a preview has no fence
  at all — so it moves to the controlled commits, which is the one §3.2 criterion still open.
  **(5) One thing you should know about operating this**: a run that fails at or after the Kronos
  timecard search **cannot be retried** — the retry re-collides on that node's checkpoint — so the
  way to re-run a document today is the explicit re-read affordance, which is what this pass used.

- **Separations 6b completion — §4e's last three unknowns closed, doc 4510 re-observed, and the
  canary you were pointed at is GONE** — 2026-08-14 (`docs/migrations/separations.md` §9.16). A
  read-only pass, nothing submitted or saved anywhere. Five things worth your attention.
  **(1) The two Kuali date write-backs are fully mapped now.** One passive read of Kuali's own
  `ActionPage` query — the one the app issues itself when a document opens — answered all three
  things §9.15 said the next pass owed: the section that owns `Last Day Worked` and `Separation
  Date` is `eTURtLdMM` and it reports `edit` at BOTH live workflow steps, so **one save still
  carries all twelve fields**; both `formKey`s are captured; and both controls are live-verified as
  exactly one EDITABLE node on two open documents. §4e's section caveat is now discharged for twelve
  fields rather than ten.
  **(2) Doc 4524 is no longer available.** Its Kuali action was **completed at 15:45 today** — after
  yesterday's live run read it — and Kuali now serves no form for it at all. So the Kuali
  controlled-commit candidate this program has recorded since chunk 5c is withdrawn on the facts.
  Doc **4510** is the best-mapped open document for a Kuali finalization commit today.
  **(3) Your deletion worked, and it moved a target.** `T002209631` is gone from UCPath for EID
  10001799 — three transactions remain and all three are `Approved`, and the in-progress grid holds
  no row. That clears the canary path as intended. It also means the pending-sweep's *committed* arm
  now has **no live subject at all**: 10001799 was the only mapped subject that had anything to
  sweep.
  **(4) The composed workflow still refuses doc 4510 — and the refusal is OURS, not UCPath's.**
  Person Org shows one employment row and it is `Inactive`, so `match-active-employment` refuses
  before the gate. But UCPath itself would happily stage a termination for that EID: typed on the
  wizard's Page B it resolved the name in **836 ms**. The standalone Kuali-finalization graph has no
  such refusal, which is why 4510 is legal for *that* commit.
  **(5) One deliverable did not run, and it is operational, not a defect.** The composed dry run to
  its preview terminal needs the dashboard to plan and start it, the dashboard is a singleton by
  design, and the one running has been up since before this morning's changes — so it hands out runs
  no current worker will accept. **Restarting it is the entire remedy**, and doc 4502 is the subject
  when it happens.

- **Separations chunk 6b ran the composition LIVE — the whole read chain, a real gate approval, and
  zero writes — and it is blocked one node short of the preview by two PLATFORM items** —
  **D212/D213**, 2026-08-14 (`docs/migrations/separations.md` §9.14). Six runs over four real Kuali
  documents, planned through the real start-plan endpoint, started through the real command endpoint,
  claimed by a real worker. **Nothing was submitted, saved or finalized**, and that is proved from the
  authority database rather than logs: zero write intents, zero write attempts, zero outbox rows, and
  **zero checkpoints for any of the three transaction nodes, ever**. Five things worth your attention.
  **(1) The chain works end to end on a real person.** Thirteen nodes — Kuali document → plan → UCPath
  name search → subject → Job Summary → employment → department option → New Kronos search → timecard
  → reconciled dates → identity packet → gate — in **82 seconds** cold across three browsers, twice,
  on two different subjects.
  **(2) The write plan you approve is real now.** On doc 4524 the gate served the template
  `UC_INVOL_TERM`, reason code `No Longer Student`, department `000412 - Housing/Dining/Hospitality`,
  and a separation date that genuinely **MOVED** — Kuali's `06/18/2026` reconciled forward to
  `07/03/2026` on a holiday — plus two pay codes the classifier declined to count, named rather than
  hidden. That is 6a's write-plan block doing exactly what it was built for, and it was inside the
  digest your approval bound to.
  **(3) Two live defects found and fixed**, each with its own gated commit: a Kronos read that kept a
  stale grid because it trusted the period LABEL over the repainted body (D212), and a UCPath search
  that could not survive a person whose name matched **four** people — the "no results" marker turned
  out to be a result-COUNT banner, so a normal multi-result page crashed the wait (D213). Neither
  could have been caught earlier: every previous live subject matched exactly one person.
  **(4) Two things stop the preview, and neither is a write-safety problem.** A dry run previews the
  pending-sweep's prepare WITHOUT its probe, so it reports a failure the real run would never produce
  for the ordinary subject who has no pending transaction; and a node marked "always re-run" collides
  with its own checkpoint when a gate resume brings it back inside the same attempt, which means the
  composed workflow cannot pass its own gate on the normal path. Both are platform decisions with the
  mechanism written down, and both need an owner.
  **(5) Your controlled commits are untouched.** All three stay OPEN on the §4f2 canary you have not
  named. _(Both platform items in (4) were fixed the same day — **D215** and **D214**. The doc-4524
  recommendation here is superseded: see the 6b-completion entry above.)_

- **Separations chunk 6a landed — THE COMPOSITION, built and test-proven, nothing live yet** —
  **D211**, 2026-08-14 (`docs/migrations/separations.md` §9.13, doc 09 §14.10). One Kuali document
  number in, three systems written, one human decision in the middle: **eighteen nodes, ONE
  ALWAYS-GATE, THREE fenced transactions**, assembled from the tasks the five sub-workflow
  descriptors already made provable. **Zero new store tasks for the browser half** — every page it
  visits was already mapped and live-proved by a chunk. Four things worth your attention.
  **(1) The gate now shows you what the writes will consume.** Chunks 4 and 5 each left the same open
  item; the packet gained a write-plan block carrying the template, the reason code, the department
  option, the payroll titles, the reconciled dates beside the dates the form carried, the exact
  comment text, and the pay codes the classifier declined to count. Because an approval binds to the
  DIGEST of the packet you saw, a reconciled date that moves after you approve now RE-OPENS the gate
  — before this, approving a person and approving a date were the same click.
  **(2) Your "read it again" exists** (the re-run wall, item 2): an explicit `reRead` ordinal makes a
  re-read a NEW logical item with fresh reads and its own gate, and it changes no permanent key, so a
  re-read can never file a second termination. **(3) §4c is asserted in ONE run** — the UCPath
  termination commits for real, the Kuali save lands nothing, and the durable rows afterwards are a
  settled receipt PAIR beside a parked finalization intent, which is the state that used to live only
  in the operator's head. **(4) A Denied UCPath transaction can no longer reach the Kuali document**:
  a refused transaction still carries a well-formed `T…` (D130), and a node between the two writes
  now refuses it by name. **Nothing has touched the live system** — 6b owes the composed live
  pipeline dry run (start-plan → command → worker → preview), and the controlled real commits still
  wait on your named canaries.

- **Chunk 5c's live pass — the prepare arm is proved on a real Kuali document, and §4e's caveat is ANSWERED** — 2026-08-14 (`docs/migrations/separations.md` §9.12). Four live separation documents surveyed at two workflow steps, read-only, behind a route guard that aborts `submitDocumentV2` by name. **Nothing was saved.** Three things you should see. **§4e's one-save model stands** — the ten fields really do span three form sections, and Kuali's own `ActionPage` query reports all three as `edit` at BOTH live steps, so one fence, one save and one reload read-back are correct and nothing is restructured. **The live dry run staged all ten controls on real doc 4524 in 8.06 s, then abandoned by hard reload and re-read the document unchanged** — five blanks, the `- - -` sentinel, two unchecked boxes, no radio — with zero write intents and zero checkpoints. That is S61 proved on real data, against legacy's dry run, which leaves a timekeeper name and a name rewrite on a live draft. **And all ten `formKey`s were captured — which found that §9.10's "filling the table is a one-line change" was wrong.** `submitDocumentV2` sends the document MODEL, and only a Text/Textarea gadget holds the staged string there: a Date holds epoch milliseconds, a Dropdown/Radios holds `{id,label}`, Checkboxes an array of them. Filling the keys without moving the comparison would have turned every landed save into a post-fence park for six of ten fields, so the wire check now asserts five (up from one) and names the five the controlled commit closes by observing the real payload. `probeToFenceMaxMs` is **CONFIRMED at 45 s** on a measured 11.4 s worst leg (~4x headroom). Still open by design: the controlled real commit on your named canary — doc **4524** is recorded as the natural candidate.

- **Separations chunk 5a/5b landed — the Kuali finalization write, built whole and not yet run** — **D207**, 2026-08-14 (`docs/migrations/separations.md` §9.10/§9.11, doc 09 §4.2). §4e's staged-variables model as code: every read lands first as a typed variable, ONE prepare stages all TEN Kuali fields in one pass, ONE save, ONE reload read-back comparing every written field against the exact staged variables — which is also §5 item 1D's answer, since mutations C and D collapse into a single transaction node. Three things worth seeing. **The ALWAYS-GATE is in front of a Kuali write now too**, and the department resolution hangs off the GATE rather than the transaction, so an S55 refusal lands before a human is asked and the department the write stages is data the operator saw. **The department fold matches on the CODE and nothing else** — legacy's two substring tiers do not port, and neither does a normalized-exact description tier, which would be a quieter fuzzy match; UCPath's `HOUSING/DINING/HOSPITALITY` and Kuali's `Housing/Dining/Hospitality` ride side by side on the resolution so you compare them, and the option text comes back verbatim (5c corrected what "verbatim" means here: the DOM carries `000719 -  Supply Chain Services` with a double space, and every read in this pipeline normalizes it consistently). **And D207 states what a measured propagation window is a measurement OF**: the mechanism, not the field — so this write reuses D135's 30 s Kuali window on a named argument, *provisionally*, until 5c's own controlled commit confirms it. **Nothing has touched the live system.** _(That chunk's one known red — the twelve stale explorer parity references — was cleared by chunk 6a's re-freeze, which moved the same twelve for the same mechanical reason.)_

- **Chunk 4's live dry-run pass — the prepare arm is proved live, and the pipeline half is BLOCKED on two named platform gaps** — 2026-08-14 (`docs/migrations/separations.md` §9.9). The whole three-page wizard staged against production for a real employee, through the REAL sequencer and the REAL driver, and **the durable footprint was empty on all five attempts** — no write intent, no checkpoint, no click. It found three more defects, all at the subject binding and all refusing BEFORE the fence: the sweep named an anchor its own staged page cannot render, the JOB effective date turned out to be display-only (so it is now verified rather than written), and the wizard's beat-③ anchor was on Page B while beat ③ observes Page C. What is NOT done, and why: a dry run cannot be STARTED for this workflow at all, because `supportsDryRun` hangs off the paste-a-line input surface this workflow deliberately does not have — and even past that, the interpreter has no dry-run preview arm, so doc 01 §6.2's `transaction.previewed` span has no producer. Both are platform decisions, not chunk 4's to take. **§4f3's 120 s bound is CONFIRMED by live measurement** (≈65 s worst observed probe + prepare on a cold session, ~1.8x headroom); the per-beat decomposition stays open behind the preview arm. **Nothing was submitted** — the controlled real commit still waits on your named canary.

- **Separations chunk 4 landed — the UCPath termination write, and the first live read found a duplicate-filing defect** — **D206**, 2026-08-14 (doc 01 §2.12, `docs/migrations/separations.md` §9.7/§9.8). The tree's second commit-contract family, and its first graph with TWO transaction nodes. Three things you should see. **The wizard persists NOTHING before Save** — verified live and re-confirmed by abandoning two staged wizards, which is why `prepare` stages all three pages and the commit is one click, and why a dry run of a real termination is a genuine no-effect preview. **The pending sweep is its own fenced transaction** — legacy deletes every in-progress termination row as the run's FIRST mutation with no fence, no key and no read-back; here it has all three and runs before the filing. **And the first live probe found a real defect**: the code matched legacy's `Terminat` prefix, but the SS Smart HR grid and detail page render the PeopleSoft code `TER`, so every probe would have answered "no duplicate" about EID 10001799 — who has a Pending `T002209631` effective 06/11/2026. Fixed, and both vocabularies are now accepted. Also settled live: **S48 is conclusive** (an unrecognized Empl ID never renders a name, so the wrong-person check and the bad-EID refusal are the same check — a check legacy has nowhere in this flow, which is why `T002173685` happened), and **`NSE|Never Started Employment` was confirmed first-hand**, so §4a's map line rests on this session's own observation. **NOTHING was submitted** — the controlled real commit still waits on your named canary.

- **Separations chunk 3 landed — the whole UCPath employment grid, and the ALWAYS-GATE is real** — **D201/D202/D203**, 2026-08-12 (doc 01 §2.11, doc 09 §14.9, doc 02 §4, `docs/migrations/separations.md` §9.5/§9.6). One task reads the Person Org detail page's entire *Employment Instances* grid in one visit; "already terminated", "two concurrent jobs" and "unreadable department" are a pure fold over it rather than throws inside a page module. Doc 09 §14's gate is a registered graph with **no branch and no `when`**, so no run mode can skip it, and its packet + digest + schema hash + typed resolutions are served on the wire for a later UI to bind without server changes. Three things you should see: **the first live subject was already terminated in UCPath** — S22's silent-risk scenario found in the wild, the case legacy structurally never checks · **the `T002173685` incident's own name pair classifies `same`** under the ported tier function, so a tier-triggered gate would not have fired on the case it exists for · **the first live gated run found a kernel defect** — a task depending on a gate could not run at all, because a gate's durable record is a `gate_results` row and provenance demanded a checkpoint. Two live runs; the second reached terminal `done` with a `verified-done` receipt in 53.9 s. **Closed 2026-08-12 by D204** (doc 12): the approver now reaches the receipt — a resolved gate emits its payload as `gate-result`-sourced facts carrying authority's own `resolvedBy`/`resolvedAt`, plus a `gate` decision naming the approver, the instant, the resolving command and the bound evidence digest, so §14.6 risk 6 is answered on the trust surface as well as durably.

- **Separations chunk 2 landed — the Kuali separation-document read, and §4a is now settled with real data** — **D197**, 2026-08-12 (doc 01 §2.10, `docs/migrations/separations.md` §9.3/§9.4). One task reads the WHOLE RRSS form in one page visit; the `Type of Termination` dropdown was captured live and the map refuses anything it does not carry, by name. Three findings you should see: **`Death` is not an option on that form at all** (§4a's worked example cannot arise from it) · **`Never Started Employment` is genuinely unmapped and legacy misfiles it** — involuntary template, voluntary default reason code — and it now REFUSES pending your reason code · **S13 was never an optional field**: legacy asks for `"Location  *"` and the live name is `"Location*"`, so it matched zero nodes on every document and its `catch` reported that as absent. Five live runs, all `done`.
- **Read tasks are authored RICH: one task per page visit, one fixed strict output, consumers project downstream — the `read(fields…)` shape is banned** — **D194**, 2026-08-12 (doc 01 §2.8, `STORES.md` §1). Applies to all new tasks; existing tasks are not rewritten, and `crm`'s duplicate record/dates page visit merges the next time that store is touched.
- **Separations questionnaire fully answered (2026-08-12) — READY TO BUILD** — `docs/migrations/separations.md`: unmapped termination type **fails loud** plus a live capture of the whole Kuali dropdown (§4a) · an unavailable or unreadable **Kronos hard-fails the whole run** (§4b) · a UCPath-filed / Kuali-unfinalized run **parks** with the transaction number durable (§4c) · **ALWAYS-GATE in every run mode**, no preset or resume can disable identity approval (§4d) · Kuali writes are **staged from variables, one pass, one save, one reload read-back** (§4e) · **no I-9 packet** in this workflow (§4f1) · production **canary** for the commit proof, target named by you at the time (§4f2) · `probeToFenceMaxMs` **measured**, never guessed (§4f3) · the scenario inventory stays open with a **MAP-EVERYTHING** directive on every build chunk (§4f4) · the final-pay radio stays **hardcoded** as your ratified business assertion (§4g) · scenario variability is served by **lego recomposition**, never by branches inside one workflow (§3.1) · and the last residual, **item 5's freshness values**: **5A** — no automatic freshness refresh in separations, the Kuali document/Job Summary/timecard reads all take the argued-unbounded arm (a saved, stable artifact does not churn; refresh only on an explicit operator re-run, including via Edit Data) while the identity-approval gate result keeps its drafted 4-hour bound (`Infinity` is illegal there, D8) · **5B** — every non-forbidden payload field (dates, department, titles) is `audited`, overridable only by explicit operator confirmation and never automatically; identity/person-selection/idempotency-key/write-proof stay `forbidden` for everyone. **Chunk 1 — the `new-kronos` store + the `separations-kronos-timecard` sub-workflow — starts now.**
- **Scope: solo, local, never hosted; local-app packaging and any cooperation mode are LATER and unplanned** — D193, 2026-08-12 (doc 00 §Non-negotiables, doc 12 §7)
- **Storage is done for this scope: manual `.tracker-rebuild/` folder copies (app stopped) are an acceptable backup; retention-sweep scheduling and the artifact refcount are `wont-build-unless-asked`** — D193, 2026-08-12 (doc 12 §D137, doc 03 §2.5). *Why:* this DB stores records of **completions**, not primary records — the real record of a completed transaction lives in UCPath/Kuali and is checkable there; these rows show *how* and *whether* something completed and mean little once it is completed and approved. (Unchanged: the fence rows are still load-bearing **during** a write.)
- **Phase 3 enters at separations (order 8)** — D193, 2026-08-12 (doc 07 §3.1) — chosen to force the store task libraries into existence; §3.3's ordering is unchanged
- **`test:coverage` becomes the per-commit gate** — D191, 2026-08-12 (doc 10 §3.14)
- **AI advisory tools dispositioned: run-summary and selector-suggestion retire; record-sanity-check stays open, deferred to order-8 separations** — D192, 2026-08-12 (doc 12 §4.4)
- **Production byte path timing confirmed: builds at the first phone-consuming migration (orders 3–4), not earlier, not at cutover** — D189 timing confirmed 2026-08-12 (doc 13 §6.9)

### Named to you at specific future gates

- **ServiceNow live-probe target** — name one before order 7 (doc 07 §3.8).
- **OnBase probe target** — none exists today; blocked until you name one (before order 7).
- **Per-workflow §b questionnaire** — 12 answers before each migration starts (doc 07 §3.4).
- **Order-8 identity approval** — separations runs under the ratified ALWAYS-GATE policy; you approve each identity match (doc 09 §14).
- **Canary/test-instance approval** — every write workflow's controlled commit needs a target you approve; dry-run alone can never prove landing (doc 07 §3.1 step 5). *For separations this is no longer a future gate — it is the current blocker (see "Needed from you right now").*

---

---

## Appendix B · Legacy vs rebuild (prose, not rendered)

### Already built — what the rebuild does differently

| Area | Legacy | Rebuild |
|---|---|---|
| Run kernel | Daemon holds state in memory; crash mid-run leaves the row to be inferred | Authority re-read + CAS before **every** transition; lost claim can never terminalize over another owner; every task races an injected deadline |
| Write safety | No fence; a failed save leaves unknown state; a retry can double-file | Seven beats: probe → prepare → subject binding → **durable fence before the click** → commit → read-back proof → settle; uncertainty **parks** with durable intent; same permanent key re-run answers `already-present` in 2 ms |
| Dry run | A flag the workflow honors | On the run's immutable envelope; `commit` structurally absent; zero durable rows **asserted** |
| Evidence | Reconstructed from log files | `RunEvidenceReceipt` = pure function of authority, byte-identical on re-derivation, per-field declared redaction; CLI and dashboard read the same derivation |
| Failures | `error: string` on a span | Structured `FailureRecord` + auto-captured, capture-time-redacted diagnostic bundle, committed with the terminal state |
| Ledger | None | Ordered, actor-attributed, fsync'd, digest-chained; any corruption stops the partition rather than renumbering history |
| Storage | JSONL + SQLite, no backup, no restore | ONE authority DB, SHA-pinned immutable migrations, live backup cadence, byte-verifying doctor, **drilled** restore |
| Notifications | In-memory React store — reload loses it | Durable inbox row committed **before** any OS toast; repeated triggers fold into a count; no free-text (structurally can't leak form contents) |
| Intake | Parse at enqueue, then gone | Durable session → mapping (suggestions can never auto-bind) → validation → **immutable manifest** + N runs + CAS in one transaction; reruns hash-diff |
| Edit Data | Exists | Resume claim IS the fence; edits become authority only by re-parsing through the producing node's own schema |
| Start | Fire-and-forget enqueue | Plan-then-consume; exact raw JSON retained beside canonical — defaults can never erase what you typed |
| Registries | ~10 hand-maintained parallel registries; a typo compiles | ONE `WORKFLOW_MODULES` tuple; stale fingerprint manifest is a red gate |
| Guards | 31 guards, accepted lint debt | 60 guards, zero debt, every mechanical arm proven against a violating fixture |

### Where legacy is still ahead (the honest list — this IS the Phase 3 surface)

OCR review/approve UI · screenshots gallery + artifact-bytes route · cross-date search · Excel
exports (3 writers incl. the master I-9 retention workbook) · workflow graph editor + data bank ·
editable settings · the record-sanity-check AI tool (deferred to order-8; run-summary and
selector-suggest are **retired**, D192 — not gaps, decided) · production phone-capture delivery
path · LAN mode · setup wizard · `test-login` · **six system drivers** (onbase, servicenow, i9,
new-kronos, old-kronos, sharepoint — declaration-only in the rebuild).

### What the rebuild will never do, by design

- **Unverified silent fallbacks** — the founding rule; enforced by ratchets run against violating fixtures
- **Selector `.or()` fallback chains** — live re-verification at migration replaces them
- **Per-daemon stdout logs / ~30 bespoke polling hooks / secondary count caches** — one projection, one SSE spine; a second data path cannot disagree with the first
- **Per-action mutation routes / fire-and-forget enqueue** — one idempotent actor-stamped command endpoint
- **Generic retry on a parked write** — only proof-of-presence or operator-confirmed-absence releases one
- **DSL/codegen workflow authoring (D79a)** — selectors, schemas, proof, and graph structure stay code, forever
- **LAN/remote operator mode** — loopback only; the token-scoped phone ingress is the one deny-by-default exception
- **Hosting** (D193) — never deployed to a platform; it runs on your machine. A locally-run app package and a cooperation mode over solo are *later, unplanned* ideas, not a hosted future
- **Legacy change accounting (D150)** — replaced by mandatory live re-verification at each migration

---

## Appendix C · Verify any of this yourself

```bash
npm run cli phase        # completedThrough 2j · active 3-workflow-migration
npm run typecheck && npm run lint && npm run test:coverage   # the per-commit gate (D191)
npm run test                     # 1998 across 209 files (verified green 2026-08-16)
npm run test:architecture        # the 61-guard suite — available for a targeted run
npm run test:parity              # 147/147 in ASSERT mode
npm run cli storage doctor
git log --oneline master         # D194–D221 landed 2026-08-12 → 2026-08-15, never pushed
```

Primary references: `docs/rebuild/07-master-plan.md` (plan + exit criteria) ·
`docs/rebuild/04-reconciliation.md` (D1–D221 index) · `docs/migrations/separations.md` (§6 exit
checklist, §9.17 latest as-built) · `docs/findings/` (the open frontend/backend findings ledger) ·
`docs/plans/2026-08-13-detail-fidelity-audit.md` (frontend wave status + remaining tails) ·
