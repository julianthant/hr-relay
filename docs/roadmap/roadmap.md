# HR Rebuild Roadmap
<!-- `docs/roadmap/roadmap.md` is the plan as written, in the roadmap notation (see .claude/skills/custom-update-plan/SKILL.md §Notation): everything between roadmap:start and roadmap:end renders at docs/roadmap/index.html via `npm run roadmap`; appendices after roadmap:end are prose. Per D263 (§Governance below) a node also carries `doc:` — the docs/rebuild sections owning its contracts — and a `log:` block, the append-only per-session journal the `## session:` spine markers summarise. -->
asOf: 2026-08-20
head: bf41158
eyebrow: hr-automation-rebuild · the plan · source: docs/roadmap/roadmap.md
source: Stems from the phase docs `docs/rebuild/00`–`05` (§Phases at a glance below, `03c`'s migration order, `00`'s size model)
source: `docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` (Tracks 0/A/B/C)
source: `docs/plans/2026-08-20-dashboard-architecture-audit.md` (Track D) · the phase docs win on any disagreement
footer: Generated from `docs/roadmap/roadmap.md` (the plan, written in the roadmap notation) by `npm run roadmap` — edit the plan, never this file; `/custom-update-plan` keeps plan, site and owning docs in step. The normative plan is the phase docs `docs/rebuild/00`–`05`; the decision changelog `docs/rebuild/reference/decisions.md`. Sizes are relative build sizes (doc 00 §Size model + delivery tiers), not calendar.
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
doc: 00 §Phase summary · 05 §Phase summary
open: no

> Every reference spec reconciled through Round 12 (D1–D94); testing policy ratified; the all-at-once cutover (D89/D93) and the two-repo model ratified; the separations identity gate designed here, not at order 8 (D77).

builds:
- [x] DOCS the plan SSOT `docs/rebuild/00–13`, each doc owning its contracts
- [x] DOCS the decision changelog `reference/decisions` as a pointer index
- [x] DOCS ALWAYS-GATE identity approval designed (ref write-safety §14)
- [x] DOCS size model + MUST / SHOULD / LATER delivery tiers (D76)
- [x] DOCS two-repo coexistence + one cutover (D88–D94)

### ALWAYS-GATE identity approval {#phase0-always-gate}
status: done
date: D77 · ref write-safety §14
doc: 00 §ALWAYS-GATE identity approval · ref:write-safety §14 · ref:write-safety §14.1 · ref:write-safety §14.3

> Manual approval on every separation, both types, no auto-approve-on-match — the control that defends against the `T002173685` wrong-person incident, pulled forward from order 8.

### Size model + delivery tiers {#phase0-size-model}
status: done
date: D76 · doc 00 §Size model + delivery tiers
doc: 00 §Size model + delivery tiers

> MUST (the spine) · SHOULD (Phase-2 tails) · LATER (explorer, advisories, catalog) — what may slip without invalidating the base.

## The SPINE {#phase-1}
phase: Phase 1
status: done
when: 07-31 → 08-04 | five days
size: XL
chip: complete 2026-08-04
doc: 01 §Phase summary · 00 §The base's dependency graph
open: no

> The minimum base that carries one workflow end to end. **Exit (D74): person-lookup ran LIVE** against real UCPath + CRM on the new executor — run `4ebf7275` / trace `pl-000619-4ebf`, recovered a dead CRM session mid-run, terminal `done` at attempt 2, all four parity surfaces from the ONE projection.

needs:
- phase-0

### 1a · 1b — guards, baselines, the strict domain leaf {#p1-base}
status: done
date: 2026-07-31
size: L
doc: 01 §1a · 1b — guards, baselines, the strict domain leaf · ref:guards-and-tests §2 · ref:guards-and-tests §1.1 · ref:clock-config-secrets §2 · ref:clock-config-secrets §3 · ref:clock-config-secrets §6 · ref:task-contract §2.1.1 · ref:dashboard-surfaces §5

builds:
- [x] BE guard plumbing + the reviewed guard inventory
- [x] DOCS honest legacy baselines + the D58 capability inventory
- [x] BE strict domain leaf (zod at every boundary)
- [x] BE clock / config / secrets single-sourced (ref clock-config-secrets)
- [x] BE runtime isolation pinned (`.tracker-rebuild`, 3938/5174, locks)

### 1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG {#p1-authority}
status: done
date: 2026-08-01
size: XL
doc: 01 §1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.4 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §4 · ref:operator-trust §1 · ref:task-contract §2 · ref:task-contract §2.7 · ref:workflow-model §3

builds:
- [x] BE authority SQLite + backup / doctor / degraded mode / restore interlock
- [x] BE the command family + proof union type shells
- [x] BE semantic UI registry (406 ported selector keys, provenance-pinned) + ucpath / crm / kuali drivers
- [x] BE task contracts (ref task-contract) and the three authoring tiers
- [x] BE workflow DAG, delegation, the completion program (ref workflow-model)

needs:
- p1-base

### 1f — registry, workers, commands, the write sequencer {#p1-kernel}
status: done
date: 2026-08-02 → 03
size: XL
doc: 01 §1f — registry, workers, commands, the write sequencer · ref:workflow-model §1.3 · ref:workflow-model §2 · ref:workflow-model §4 · ref:dashboard-surfaces §2.4 · ref:execution-and-sessions §3 · ref:execution-and-sessions §4 · ref:execution-and-sessions §4.1 · ref:write-safety §3

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
doc: 01 §1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.2 · ref:dashboard-surfaces §10.1 · ref:frontend-backend-integration §3 · ref:frontend-backend-integration §6.2 · ref:frontend-backend-integration §6.3 · ref:frontend-backend-integration §7.1

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
doc: 01 §Phase 1 exit — the live run · 01 §Exit criteria · ref:workflow-model §8 · ref:workflow-model §8.1

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
doc: 02 §Phase summary
open: no

> **The controlled commit is MET live (D135):** one real Kuali write on doc `4489` — dry run zero durable rows · forced mismatch refused pre-fence · commit 16.45 s with reload read-back proof · idempotent re-run `already-present` in 2 ms · both docs restored. Then four tails landed against a proven spine.

needs:
- p1-exit

### Transaction proof — the first real write {#p2-proof}
status: done
date: D128–D135 · 2026-08-04
size: L
doc: 02 §Transaction proof — the first real write · ref:write-safety §2.1 · ref:write-safety §3 · ref:write-safety §3.1 · ref:write-safety §5 · ref:guards-and-tests §3.6 · ref:frontend-backend-integration §6.4

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
doc: 02 §2g — event / trust layer · ref:operator-trust §2.2 · ref:operator-trust §2.3 · ref:operator-trust §4 · ref:operator-trust §6 · ref:operator-trust §6.1 · ref:dashboard-surfaces §2.6 · ref:write-safety §6.1 · ref:frontend-backend-integration §6.5

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
doc: 02 §2h — data / intake foundation · ref:data-intake-and-edit-data §1 · ref:data-intake-and-edit-data §2 · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §6 · ref:frontend-backend-integration §6.6

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
doc: 02 §2i — the operator surface (A–G) · ref:frontend-backend-integration §6.7 · ref:dashboard-surfaces §10.2 · ref:dashboard-surfaces §11 · ref:dashboard-surfaces §12 · ref:dashboard-surfaces §13 · ref:operator-trust §5.7 · ref:operator-trust §5.8 · ref:data-intake-and-edit-data §6.4.1

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
doc: 02 §2j — the closing gate · 03c §Non-workflow capability closure inventory (D58) · ref:execution-and-sessions §7.1 · ref:guards-and-tests §3.11 · ref:guards-and-tests §3.15 · ref:operator-trust §3 · ref:dashboard-surfaces §2.5

> **Found four real defects every earlier green gate missed:** `cli storage restore` could never have worked (D181); every `paper-ink` parity reference had been photographed dark; the run-detail trust panel was **2 px wide** since 1i-spine (D187); the receipt builder 500'd on a reachable path.

builds:
- [x] PROOF scenario corpus + `scenario-coverage` audit
- [x] PROOF restore drill on a copy of the real authority DB (corrupt → doctor refuses 0.92 s → restore 0.99 s)
- [x] PROOF 3-worker soak, concurrency matrix, redaction scan
- [x] DOCS capability-inventory validation (D184/D188)
- [x] DOCS every owning doc to as-built

needs:
- p2-2i

### Left Phase 2 by explicit disposition {#phase2-dispositions}
status: never
doc: 02 §Left Phase 2 by explicit disposition · ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9

> Workflow Explorer EDIT half — D186, trigger: the *second* production workflow whose policy you want to change · BFF serves no frontend bytes / no `dashboard:prod` — D189, builds at the first phone-consuming migration (orders 3–4), confirmed 2026-08-12.

## flag: 2026-08-12 | **D193 — scope and entry.** Solo, local, never hosted. Phase 3 enters at **separations (order 8)**, chosen to force the store task libraries into existence; the §3.3 ordering is NOT re-sequenced. Separations questionnaire fully answered → READY TO BUILD. `test:coverage` becomes the per-commit gate (D191).

## Per-workflow migration — separations first {#phase-3}
phase: Phase 3
status: active
when: 08-12 → today | nine days so far
size: XL
chip: active
doc: 03b §Phase summary · 03c §Phase summary · 03c §Recommended migration order (by risk / complexity / reuse)
open: yes

> One workflow at a time through the seven-step loop (doc 03c §Phase summary): questionnaire → author → guards → **live dry run** → **controlled commit** → rebuild-ready → close-out. The order of work inside the phase: **the dashboard defaults first** (the generic surfaces every workflow inherits), then each workflow as ONE migration node — its store chunks, its live proofs, its controlled commits, and its own **dashboard wiring** on top of the defaults. Separations went first and forced the defaults into existence; they are now a prerequisite every later migration reads.

needs:
- p2-2j

log:
- 2026-08-20 | docs-cohesion step 5.0 | every node in the tree now carries `doc:` — its phase-doc home section plus the reference specs that own its contracts (`81bf48dd`); `test-tiers` drawn as this phase's testing spine (R10) · left: step 4b's binding guard, then the per-doc rewrites

### Dashboard defaults — the generic surfaces every workflow inherits {#dash-defaults}
status: active
chip: B+C done · D ratified (D264)
size: L
doc: 03a §Phase summary · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §6.8 · ref:dashboard-surfaces §1.2

> Built ONCE so a migration only wires it: the run modal, queue rows, run detail + timeline, gate ceremonies, notifications, archive, activity, explorer. Track B finished the surfaces with separations as the forcing function; Track C is proving the connection against a real run; Track D hardens the stack before cutover. A workflow's own "Dashboard · wire" task sits under that workflow and reads this node as its prerequisite.

builds:
- [ ] BE the per-run stream topics — five of six declared TopicKeys have no producer, so run detail, logs, review, people and artifact updates arrive by re-read, not by patch (ref frontend-backend-integration §3.5)
- [ ] FE the Session Panel's six unbuilt controls — plan/spawn/pause/resume/refresh/reopen have kernel arms and no button; only Stop is composed
- [ ] BOTH the Review panel kind and the Group People page — both §5 matrix rows have no surface and both section arms are declared-unserved (D184)
- [ ] PROOF the parity corpus reaches Settings and the Session Panel — neither is routable from the lane's AppRoute; keyboard and reduced-motion exist in ONE theme
- [ ] BE producers for the five declared notification triggers that have none — run-failed · subject-mismatch · write-parked · repeating-failure · verified-done (audit C4)
- [ ] BE the `operation` run shape is minted by SOME enqueue path — today every path stamps `single`, so §9's group model (member well, rollup, containment) is presentation over fixtures (audit C2)

needs:
- p2-2i

log:
- 2026-08-20 | docs-cohesion step 5.0 | `duo-lease` · `parallel-runs` · `observed-logs` drawn under this node (R11/R12 and the operator's observed-logs ruling), each with its own section in doc 03a · left: 5.3a builds the lease, 5.3b the pool and the session view
- 2026-08-20 | docs-cohesion 03a | doc 03a written to the phase-doc contract — every surface verified against `src/dashboard/**` and `src/server/dashboard/**`, four of nine exit criteria MET; two honest gaps recorded rather than assumed built: the run-detail Review and People bodies have no producer (`availableSections` cannot return them) and belong to the OCR and group migrations
- 2026-08-20 | docs-cohesion frontend-backend-integration | ref frontend-backend-integration rewritten as-built; §5.1 split into seven wire squares (5.1.1 run modal … 5.1.7 intake/capture/Edit Data), each separately citable and tagged; §1.1 and §5 gained a Built column · left: the per-run stream topics, the Review and People panel kinds, six Session-Panel controls
- 2026-08-20 | docs-cohesion dashboard-surfaces audit | 109 sections classified (49 done · 32 needs-attention · 15 to-build · 8 superseded · 5 reference); C1–C4 booked as builds: lines; rewrite split into 5.1b/c/d

#### Track B · dashboard completion {#track-b}
status: done
chip: B1–B8 all landed · 08-19 → 20
doc: 03a §Track B · dashboard completion · ref:frontend-backend-integration §3.2 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §10.2 · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.3 · ref:write-safety §14.11 · ref:operator-trust §5.9

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

log:
- 2026-08-20 | docs-cohesion 03a | all eight re-verified present in the tree for doc 03a's status block; the ledger's own README records five open records across two files and zero undecided ones, which is what makes "frontend done" checkable

#### Track C · connection proof {#track-c}
status: done
chip: done 08-20 — §9.22 + the five same-day fixes + the ONE re-freeze
doc: 03a §Track C · connection proof · ref:workflow-model §1.1 · ref:dashboard-surfaces §2.3 · ref:frontend-backend-integration §7.1

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

log:
- 2026-08-20 | docs-cohesion 03a | evidence pinned in doc 03a — separations §9.22 items 1–8 plus §9.24's live `sp-105225-1e0b`, and the re-freeze commit's own numbers: 139 references, 151 assert-mode cases green (`81287bb1`)

#### Track D · dashboard hardening, pre-cutover budgets {#track-d}
status: planned
date: D264 · audit 2026-08-20
chip: ratified 2026-08-20 (D264) · D1–D5 planned · D6–D10 proposed
doc: 03a §Track D · dashboard hardening, pre-cutover budgets · ref:frontend-backend-integration §2 · ref:frontend-backend-integration §4 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §7.4

> From the 2026-08-20 architecture audit (`docs/plans/2026-08-20-dashboard-architecture-audit.md`). **Verdict: the stack and shape are right; nothing is swapped.** Eleven ordered moves, none a rewrite, sequenced after Track C and before the next workflow leans on the dashboard. **Ruled by D264:** the track sits here under the dashboard defaults; D1–D5 are planned; D6–D10 stay proposed behind one named trigger; and §3.5 is answered — the descriptor registry LEAVES the browser bundle as row D11, amending D251. D4 and D5 double as the FIRST measurement of ref frontend-backend-integration §7.4's performance budgets, whose recorded numbers become the non-regression gates for every later workflow.

builds:
- [ ] BE D1 one status/outcome derivation — exported `deriveRunStatus`, ONE `TASK_OUTCOME` vocabulary, ONE `panelKindOf`; the detail panel stops disagreeing with the queue row (closes C1/C2, part of M3)
- [ ] BOTH D2 hygiene — dead hooks and exports deleted, a typed not-found error instead of message-sniffing, the inert phone-host gate wired or deleted with its D189 note, `testSystemsOf`/`plural`/`shortHash` unified, the D253 sentence corrected (closes C3/C4/M7/M8)
- [ ] FE D3 every command settlement folds through `settleCommandResult` — 7 sites still enumerate both refusal arms by hand (closes C5)
- [ ] BOTH D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; then MEASURED against a seeded 1,240-row / 108-member fixture and recorded as ref frontend-backend-integration §7.4's first numbers (closes P1)
- [ ] BE D5 bound the read scans — the member preview slices ids before joining, one receipt read per row, the notes reader scoped by workflow and day range, the archive freeze reads the corpus once; measured and recorded (closes P2/P3/P4)
- [?] FE D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate and `state/` becomes what ref frontend-backend-integration §2 says it is (closes M2)
- [?] FE D7 split `LoadedApp` along its own seams — `useDayRoute`/`useRunDetailState`/`useBulkSelection` into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx` (closes M1)
- [?] BOTH D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, and ONE `foldTaskExecutions(row)` for pipeline / timeline / archive (closes M3/M5/M6)
- [?] FE D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured (closes P5)
- [?] BOTH D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped (closes M4)
- [ ] BOTH D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads (`summary`, `enqueue`, `surfaces.inputRun`) and `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import (amends D251; ref frontend-backend-integration §4)

needs:
- track-c
- fact(met): operator ruling 2026-08-20 — D1–D5 planned, D6–D10 proposed, §3.5 → move (D264)

note: D6–D10 are the maintainability slice and carry ONE trigger — they start before the second migration's `Dashboard · wire` task does, and until then they stay proposed; once D1–D5 land they can be dispatched as independent worktree units.

log:
- 2026-08-20 | docs-cohesion step 4a | ratified by D264 — D1–D5 planned, D6–D10 proposed, D11 added (77a0be76)
- 2026-08-20 | docs-cohesion 03a | every one of the eleven rows re-verified UNLANDED at HEAD rather than carried on the audit's say-so, with the file:line of each finding recorded in doc 03a's Track D table (no exported `deriveRunStatus`, two `TASK_OUTCOME` vocabularies, two `panelKindOf` copies, `settleCommandResult` imported by two surfaces, zero `React.memo`, `WORKFLOW_DESCRIPTORS` at `dashboard-app.tsx:25`)
- 2026-08-20 | docs-cohesion frontend-backend-integration | all eleven rows tick in ONE place — ref frontend-backend-integration §7.4's status block, with a per-row map of where each lands; §7.4 records that NOTHING in src/ or tests/ measures any budget it names

#### Duo ceremony lease — one login at a time per credential {#duo-lease}
status: planned
date: R12 · 2026-08-20
size: S
doc: 03a §Duo ceremony lease — one login at a time per credential · ref:execution-and-sessions §4.1 · ref:execution-and-sessions §4.2

> A durable per-credential lease in authority serializes EVERY Duo ceremony — from "navigate to SSO" until the content verifier proves the session — across every worker and every system. TTL is `sessionAcquireMs` + grace; waiters are bounded and refuse loud naming the holder; a refused assertion poison-closes and retries ONCE under the same lease on a FRESH profile, then fails naming the profile; `defineVerifiedLoginRecipe` takes a lease token only the lease store mints, pinned by a guard with a violating fixture. The hazard exists TODAY — two workflows' workers cold-starting together share one credential's server-side counter (D243).

builds:
- [ ] BE `duo_ceremony_leases` in authority + the lease token `defineVerifiedLoginRecipe` requires
- [ ] BE bounded waiters + the fresh-profile-once recovery, both failing by name
- [ ] BE the guard: no login path without the lease, with a violating fixture
- [ ] PROOF two workers' cold starts serialize (unit) + a live two-worker cold start
- [ ] DOCS the decision in `reference/execution-and-sessions` + `reference/decisions`

needs:
- track-d

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Duo ceremony lease written; verified UNBUILT at HEAD — nothing named `duo_ceremony_leases` exists in `src/` and `defineVerifiedLoginRecipe` (`src/infra/browser/authenticated-application.ts:159`) takes system + verify + flow and no lease token; `doc:` tightened to ref execution-and-sessions §4.1 and §4.2

#### Parallel runs — sessions and the worker pool {#parallel-runs}
status: planned
date: R11 · 2026-08-20
size: L
doc: 03a §Parallel runs — sessions and the worker pool · ref:execution-and-sessions §1 · ref:execution-and-sessions §3 · ref:execution-and-sessions §7.1

> A SESSION is a dashboard-started group of N runs. Every workflow follows the same browser-profile recipe and every worker owns its own profile INSTANCE (doc 05's `(worker, system, instance, configFingerprint)` partition); N workers per workflow, spawned and stopped from the dashboard. Sessions never share information and workers never message each other — they know what the others are doing through AUTHORITY only: run claims, session leases, write fences, the concurrency matrix. The dashboard shows the session and what each of its workers is doing.

builds:
- [ ] BE worker pool — N workers per workflow, spawned and stopped from the dashboard (the kernel command arms exist and are validated; `createDashboardWorkerSupervisor` refuses spawn BY NAME today)
- [ ] BE the projection serves a worker-POOL version — `spawn-worker`/`plan-worker-count` target `{workflowId, expectedVersion}` and `WorkerCardWire.revision` is ONE worker's row, so the FE control has no honest CAS basis until this lands
- [ ] BE durable session record + grouping (B4's bulk dispatch is the seed)
- [ ] FE session view — worker cards show membership and what each worker is doing, from authority
- [ ] PROOF two separations dry-run scenarios in parallel, recorded

needs:
- track-d
- duo-lease

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Parallel runs written; one `builds:` line ADDED from reading the code — the pool version is a prerequisite of the spawn control, not a detail of it (`src/dashboard/surfaces/shell.tsx:1036` states the CAS reason the demo's `+` is absent); `doc:` tightened to ref execution-and-sessions §1, §3 and §7.1

#### Observed logs — the log carries what the page said {#observed-logs}
status: planned
date: operator 2026-08-20
size: M
doc: 03a §Observed logs — the log carries what the page said · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.1 · ref:operator-trust §2.3

> The log stream quotes the facts each task RECORDED — the provenance points: field, value, system, observed-at — redacted by the declared evidence classification, and never a second scrape. A transaction node's beats stream their observations while the step is still running, so the operator watches the page's own words rather than a step name. The log emission path and the log structure are rebuilt around recorded observations; the scope may widen when the operator reviews phase 3a.

builds:
- [ ] BE the notes stream gets a production emitter — `emitNote` is composed and never called; `.tracker-rebuild/notes/` does not exist, while the Logs section re-reads it per request and a failed run opens on it (audit C1)
- [ ] BE provenance points emitted on the span at record time, redacted by declaration (an unclassified leaf fails loud)
- [ ] BE transaction beats stream their observations (probe → stage → fence → click → read-back)
- [ ] FE the log panel renders observed rows per step, in the Context rail's vocabulary
- [ ] PROOF a separations dry run reads as a ledger of page facts

needs:
- track-d

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Observed logs written; the emission is a real build, not a re-read — `finalizeRead` validates the recorded points and the executor stores only `provenance` plus the parsed output (`src/core/task-provenance.ts:264`, `src/core/run-executor.ts:1052`), and `DataPoint` carries `direction` natively but NO system, which the store's declaration owns (D252/D106)

### Testing tiers — the suite organized by what a test needs {#test-tiers}
status: planned
date: R10 · 2026-08-20
size: L
doc: 03c §Testing tiers · ref:guards-and-tests §10

> The no-dry-run tests — unit, architecture guards, ONE honest structural fixture scenario per workflow, dashboard feature scenarios, parity — run per commit, per workflow update, and all of them on a dashboard update. Every test that must RUN a workflow is built on a LIVE dry run of it, declared as a scenario with checkpoints asserted over authority, subject-parameterized against a canary registry (sensitive values outside git, referenced by label; a missing subject reports `blocked`, never `failed`), with dashboard conditions attachable and the result recorded durably. The end-to-end tier is an agent-operated run of MANY dry-run scenarios in parallel. Coverage floor 80 %.

builds:
- [x] DOCS the spec — `reference/guards-and-tests` §10 rewritten: tiers, layout, naming, run policy, subject registry, durable results (R10, dc2901de)
- [ ] BE T1 layout — one structural fixture scenario per workflow + its dry-run scenario manifest (checkpoints + subject labels), the pretending scenarios rewritten
- [ ] BE T2 dashboard / non-run scenarios per feature, seeded from `tests/unit/dashboard`
- [ ] BE T3 dashboard conditions attachable to a dry-run scenario — the first: separations §9.22 as a file
- [ ] BE the subject registry (labels in config, values outside git) + the durable `dry_run_scenario_results` row + `cli dry-run-scenario`
- [ ] PROOF T4 the agent-operated parallel e2e runner + the first journey, recorded
- [ ] BE coverage floor 80/80/80 global

needs:
- dash-defaults
- fact: a named canary subject per workflow the dry-run scenarios run against (03b's registry first)

log:
- 2026-08-20 | docs-cohesion ref guards-and-tests | §10 written as-built against vitest.config.ts, run-executor/write-sequencer, tests/scenario, tests/parity and separations §9.22 (dc2901de); §7's stub lane verified NEVER PORTED → history; measured 84.23/82.15/84.74/71.76 · left: 5.2b–5.2d
- 2026-08-20 | docs-cohesion 03c | doc 03c §Testing tiers filled against §10: the DOCS line ticks (dc2901de), the six code lines stay open. Confirmed NO workflow in the tree has a T1 pair yet — `tests/scenario/workflows/` does not exist, including for the migrated person-lookup

### Separations — order 8, the first migration {#order-8}
status: planned
size: XL
chip: 8 of 9 — the three commits wait for 08-28 (S7)
doc: 03b §Separations — order 8, the first migration · 03c §Phase summary · 03c §Exit criteria · 03c §Recommended migration order (by risk / complexity / reuse)

> write-heavy — UCPath termination + Kuali finalization. The wrong-person incident (`T002173685`); the deepest write-safety proof, entered first by your choice (D193). Built bottom-up: store tasks first, one small provable sub-workflow per system interaction, then composed — lego recomposition, never conditional branches inside one monolith (§3.1/§3.2 directives). What remains is the calendar: canary 4537 is named and mapped, and S7 admits it on 2026-08-28.

needs:
- dash-defaults
- track-a

#### 1 · new-kronos timecard read {#sep-1}
status: done
date: D196 · D205 live 08-13
doc: 03b §1 · new-kronos timecard read · ref:task-contract §2.8 · ref:task-contract §2.9

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
doc: 03b §2 · Kuali separation-document read · ref:task-contract §2.8 · ref:task-contract §2.10

> Five real runs `done`, three with `verified` receipts over real documents.

builds:
- [x] BE a READ family on the existing `kuali` driver (14 more selectors live-re-verified)
- [x] BE the `separations` pure mini-store
- [x] PROOF §4a termination-type map captured live: 16 options + blank sentinel, exact-match-only, no default arm

#### 3 · UCPath employment grid + the ALWAYS-GATE {#sep-3}
status: done
date: D201–D203 · live 08-12
doc: 03b §3 · UCPath employment grid + the ALWAYS-GATE · ref:task-contract §2.11 · ref:write-safety §14.3 · ref:write-safety §14.9 · ref:workflow-model §5.5

> The first live gated run: parked, a real approval through the real command endpoint, resumed — and it found that a gate's durable record is not a checkpoint (D203).

builds:
- [x] BE rich whole-grid UCPath read, classified by a pure fold (D201)
- [x] BE the identity-approval gate node, server-computed approval shape
- [x] BE gate results as dependency evidence (D203) and in the receipt (D204)
- [x] PROOF first live gated run — parked, real approval through the real command endpoint, resumed

#### 4 · UCPath termination WRITE {#sep-4}
status: done
date: D206 · prepare live 08-14
doc: 03b §4 · UCPath termination WRITE · ref:task-contract §2.12 · ref:write-safety §3 · ref:write-safety §5

builds:
- [x] BE two fenced transactions: the pending sweep + the filing
- [x] PROOF Smart HR wizard prepare arm live-proven
- [x] PROOF a duplicate-filing defect caught by the first live read

needs:
- sep-3

#### 5a/b/c · Kuali finalization WRITE {#sep-5}
status: done
date: D207 · D217 · prepare live on doc 4524
doc: 03b §5a/b/c · Kuali finalization WRITE · ref:write-safety §2.2 · ref:write-safety §3 · ref:write-safety §4.2

builds:
- [x] BE ONE transaction node behind the same gate
- [x] PROOF all ten `submitDocumentV2` formKeys captured passively off Kuali's `ActionPage`
- [x] BE the step-13 date write-backs folded into the one-pass staged set (D217)

needs:
- sep-2

#### 6a · THE COMPOSITION {#sep-6a}
status: done
date: D211
doc: 03b §6a · THE COMPOSITION · ref:workflow-model §3 · ref:write-safety §14.10

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
doc: 03b §6b · composed LIVE pass · ref:workflow-model §5.7 · ref:task-contract §6.2 · ref:write-safety §3

builds:
- [x] PROOF whole read chain on two real subjects in 82 s, parked, approved, resumed — zero durable write rows
- [x] BE checkpoint key gains `claimGeneration` (D214, schema v14)
- [x] BE a dry run probes in the real order and REPORTS `already-present` (D215)

needs:
- sep-6a

#### 6c · PREVIEW TERMINAL reached {#sep-6c}
status: done
date: doc 4502 · canary 4510 refused pre-gate
doc: 03b §6c · PREVIEW TERMINAL reached · ref:workflow-model §2.1 · ref:operator-trust §2.3

> Still zero write rows beyond 2026-08-04's proof.

builds:
- [x] PROOF a real `transaction.previewed` terminal with a `partial`/`unknown` receipt
- [x] PROOF the real run on 4510 refused `NO_ACTIVE_EMPLOYMENT` before the gate

needs:
- sep-6b
#### Track A · separations backend completion {#track-a}
status: planned
chip: canary 4537 named — S7 unblocks 08-28
doc: 03b §Track A · separations backend completion · ref:write-safety §3 · ref:write-safety §4.2 · ref:write-safety §5 · 03c §Exit criteria · 03c §Non-workflow capability closure inventory (D58) · ref:operator-trust §3.2 · ref:operator-trust §4

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
| A8 | Close-out (doc 03c's loop, step 7) → separations **rebuild-ready** | after A2–A7 |
#### Dashboard · wire separations {#sep-dash}
status: active
chip: 9 of 9 wired — every square filled (D262 closed the last)
doc: 03b §Dashboard · wire separations · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.4 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9 · ref:write-safety §14.11

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
- [ ] PROOF T1 scenario tests for separations (structural fixture + dry-run scenario) and its T3 pair (R10)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

### Platform fixes the live runs forced {#platform-fixes}
status: done
date: 2026-08-14 → 19
doc: 03b §Platform fixes the live runs forced · ref:workflow-model §1.2.1 · ref:workflow-model §4 · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.6 · ref:execution-and-sessions §4.2

builds:
- [x] BE D218 the projector tails the span stream FROM DISK, cross-process
- [x] BE D221 a retry is the ITEM's next attempt
- [x] BOTH D219/D220 workflow roles (composition / chunk-harness / proving)
- [x] BOTH D222 the backup hazard moved from the banner to the durable inbox
- [x] BE D243/D244 Duo's shared signature counter — the browser-profile wedge root-caused
### Smaller operator calls open {#operator-calls}
status: you
chip: needs you
doc: 03b §Smaller operator calls open · ref:dashboard-surfaces §9 · 03c §Non-workflow capability closure inventory (D58) · ref:guards-and-tests §3.11

> The gate-age pill (D12 vs your later direction) · D192 re-disposition of `legacy-tool-ops-sanity-check-record` · A6's first live retry as evidence. (The decide-first findings are settled: hours-saved DROPPED by D239; archive tabs and export closed by D223/D240.)

## session: 2026-08-20 | docs-cohesion steps 1–2 | the plan moved out of the repo root (0990ebc5) and now sits at docs/roadmap/roadmap.md; the notation grew doc: · log: · session: (ea7704e0); D263 + D264 ratified; Track D redrawn

## session: 2026-08-20 | docs-cohesion step 5.0 | doc: on every node; test-tiers · duo-lease · parallel-runs · observed-logs drawn (R10–R12)

## today: 2026-08-20 · HEAD bf41158 · separations 8 / 9 · Tracks B+C DONE · docs rewrite batch 1 merged (03a · frontend-backend-integration · dashboard-surfaces audit) · the three commits wait for 08-28

## The remaining migrations {#migrations}
phase: Phase 3 · continued
status: planned
when: next | undated — order, not calendar
chip: 13 workflows · 9 order rows
doc: 03c §Phase summary · 03c §Recommended migration order (by risk / complexity / reuse) · 04 §Phase summary · ref:guards-and-tests §10
open: yes

> Doc 03c §Recommended migration order's risk-proof ordering, kept as-is after the separations entry (order 8 is the migration in flight, under Phase 3 above): reads populate the stores, the OCR service unblocks four consumers, write-heavy lands last. **No workflow after separations is named yet.** Each owes the 12-item §b questionnaire before building, a live dry run, (for writes) a controlled commit on a target you approve — and its own **Dashboard · wire** task on top of the defaults. **Store reality:** only ucpath, crm, kuali, new-kronos have real drivers today; onbase, servicenow, i9, old-kronos, sharepoint are 3-line session declarations with zero tasks.

needs:
- phase-3

note: **Legacy capability register:** 47 open · 20 replaced · 7 native · 4 retired — cutover requires zero open. Every entry advances to native / replaced / retired at its order's migration.

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c written as-built: the seven-step playbook, all nine order rows, the recounted closure inventory. Chip corrected 12 → 13 workflows (15 `legacy-workflow-*` entries minus separations and person-lookup); the register recount CONFIRMS 47/20/7/4 and every open entry names `phase-3-workflow-migration`. Registry reality re-verified — only person-lookup and the six separations descriptors are registered, so orders 1-7 and 9 have no descriptor at all
### Order 0 · person-lookup {#order-0}
status: done
size: M
chip: live-proven (Phase 1)
doc: 03c §Order 0 · person-lookup · 03c §Recommended migration order (by risk / complexity / reuse) · ref:workflow-model §8 · ref:workflow-model §8.1 · ref:task-contract §9.1 · ref:task-contract §9.1.1

builds:
- [x] BOTH resolve a person by name / EID against real UCPath + CRM
- [ ] PROOF T1 scenario tests for person-lookup (structural fixture + dry-run scenario) and its T3 pair (R10)

log:
- 2026-08-20 | docs-cohesion 03c | verified as-built: `src/workflows/person-lookup/descriptor.ts` + `module.ts` registered at `src/control/workflow-registry.ts:39`, live-proven by D74. Its `legacy-workflow-person-lookup` capability entry stays OPEN correctly — legacy's crm-search/match/outcome are order 1. No T1 pair exists

#### Dashboard · wire person-lookup {#order-0-dash}
status: done
chip: the Phase 1 slice
doc: 03c §Dashboard · wire person-lookup · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §6.3

> The first wiring, done in 1i-spine and proven live by D74: the typed Start Run surface, the queue row, run detail + receipt, the Context rail — all four parity surfaces from one projection.

builds:
- [x] WIRE run modal — name / EID typed inputs, the start plan
- [x] WIRE queue row — the person-lookup row, status and timing (D123/D124/D126 fixes from the live run)
- [x] WIRE run detail — timeline, receipt, Context rail; the two-pixel panel found and fixed in 2j (D187)
- [x] WIRE archive · activity · explorer — person-lookup rows appear through the generic surfaces
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | verified: four squares, and four is right — person-lookup does not gate, raises no park notification and consumes no intake, so §5.1.4/§5.1.6/§5.1.7 have nothing to declare. Left: the T2 scenario

### Order 1 · person-lookup Search + Match · i9-lookup {#order-1}
status: planned
size: M
doc: 03c §Order 1 · person-lookup Search + Match · i9-lookup · 03c §Recommended migration order (by risk / complexity / reuse) · ref:dashboard-surfaces §9 · ref:task-contract §3.1

> read — HR-Tasks Search/Match; who signed I-9 §2. Two modes prove one descriptor can preserve distinct system surfaces.

builds:
- [ ] BOTH Search + Match modes on person-lookup (D15)
- [ ] BE the `i9` store: driver, login recipe, tasks (zero today)
- [ ] BOTH i9-lookup workflow + its queue/detail surfaces
- [ ] PROOF T1 scenario tests for person-lookup Search + Match · i9-lookup (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- phase-2
- you: §b questionnaire (12 answers) for each workflow

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 1 written: `src/stores/i9/` is a 7-line `declareDriver("i9", "unwired")` with `{}` tasks, and `person-lookup/descriptor.ts` carries no mode. The row's hazard is one descriptor with two modes (D15) plus the first login recipe written from scratch since 1d (D120)

#### Dashboard · wire Search + Match · i9-lookup {#order-1-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire Search + Match · i9-lookup · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about person-lookup's two modes and i9-lookup: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for person-lookup's two modes and i9-lookup (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | six squares, not seven — no gate and no intake; both workflows are reads with typed inputs

### Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports {#order-2}
status: planned
size: M
doc: 03c §Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports · 03c §Recommended migration order (by risk / complexity / reuse) · 04 §Phase summary · ref:task-contract §3.1 · ref:guards-and-tests §3.7 · ref:frontend-backend-integration §3.6

> read / download — iDocs PDFs; rosters; Time Detail PDFs. Single-system reads and downloads at low risk.

builds:
- [ ] BE the `sharepoint` and `old-kronos` stores (declaration-only today)
- [ ] BE crm document download on the existing crm driver
- [ ] BOTH downloads land as content-addressed artifacts; the artifact-bytes route
- [ ] PROOF T1 scenario tests for crm-doc-download · sharepoint-download · old-kronos-reports (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- phase-2
- you: §b questionnaire for each workflow

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 2 written: `sharepoint` and `old-kronos` are 12-line unwired declarations with zero tasks; `crm` has two read tasks and no download. This row also owns the artifact-bytes ROUTE, which does not exist (`legacy-route-files`) and which orders 3, 5 and 7 also need

#### Dashboard · wire the downloads {#order-2-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire the downloads · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:frontend-backend-integration §3.6 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about crm-doc-download · sharepoint-download · old-kronos-reports: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for crm-doc-download · sharepoint-download · old-kronos-reports (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH download viewer — the artifact-bytes route + a per-run downloads tile
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | seven squares — the download viewer is this order's extra and it is a BUILD, not a wire: run detail's `captures` section is served by the BFF and placed by no panel

### Order 3 · the OCR pipeline workflow {#order-3}
status: planned
size: M
doc: 03c §Order 3 · the OCR pipeline workflow · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §5.1 · ref:frontend-backend-integration §6.9 · ref:dashboard-surfaces §12

> service — PDF → extraction → review → fan-out. No browser, no submit; the 2h service stores are already built.

builds:
- [ ] BE the OCR pipeline workflow over the 2h extraction / normalization / ocr / roster stores
- [ ] BE **D189's byte path**: BFF static handler + `capture.html` + ngrok launcher + the phone-origin guard arm; `--prod` starts meaning what it says
- [ ] WIRE capture → workflow binding (`CAPTURE_INTAKE_BINDINGS` filled for the first honest consumer)
- [ ] PROOF T1 scenario tests for the OCR pipeline workflow (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- p2-2h
- you: §b questionnaire

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 3 written: the four 2h service stores are REAL (`extraction` 2 tasks, `ocr` 1, `normalization` 1, `roster` 1) and the pipeline workflow is not. Three hazards recorded — D189's byte path as a HARD cutover blocker, `CAPTURE_INTAKE_BINDINGS` empty because no module declares one (`workflow-registry.ts:194`), and `RunShapeSchema`'s `operation` arm that nothing mints

#### Dashboard · wire the OCR pipeline {#order-3-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire the OCR pipeline · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:frontend-backend-integration §5.1.7 · ref:data-intake-and-edit-data §4.3 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about the OCR pipeline workflow: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for the OCR pipeline workflow (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH OCR review UI — expanded page ↔ extracted-text pair, approve / reject / retry page, one atomic correction list
- [ ] WIRE review/approve commands + progressive record patches over the SSE stream
- [ ] BOTH the OCR Review panel body — `review` is declared in TAB_ORDER but `availableSections` can never return it (03a finding)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | the heaviest wire sub-task and mostly a BUILD; `review` is in TAB_ORDER and `sectionsCompatible` (`domain/dashboard/run-detail.ts:309`) means `availableSections` can never return it, so the tab is structurally unreachable today

### Order 4 · oath-signature · emergency-contact {#order-4}
status: planned
size: L
doc: 03c §Order 4 · oath-signature · emergency-contact · 03c §Recommended migration order (by risk / complexity / reuse) · ref:dashboard-surfaces §4 · ref:dashboard-surfaces §4.3 · ref:write-safety §3 · ref:write-safety §14

> OCR fan-out + light write — oath date rows; emergency-contact fill. Exercises the completion union (D11), approval gates (D5) and operation-member fan-out; the write is a bounded UCPath enter/fill.

builds:
- [ ] BOTH first operation fan-out + approval gates through the real review UI
- [ ] BE oath-signature and emergency-contact workflows
- [ ] PROOF the first non-separations controlled commits on UCPath enter/fill
- [ ] PROOF T1 scenario tests for oath-signature · emergency-contact (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- order-3
- you: §b questionnaire; controlled-commit target approval

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 4 written: two independent firsts in one row — the first operation fan-out and the first non-separations controlled commit. The doc says not to collapse them: prove the fan-out with the write still dry, then prove the write on one member under ref write-safety §3.2's full contract

#### Dashboard · wire oath-signature · emergency-contact {#order-4-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire oath-signature · emergency-contact · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.4 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:write-safety §14.11 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about oath-signature and emergency-contact: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for oath-signature and emergency-contact (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] BOTH gate ceremony — the approval shape this workflow's gate demands, server-computed
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] FE Group People — paged members + rollup + containment over real operation members
- [ ] BOTH the group People panel body — declared, never servable (03a finding)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | nine squares — the standard seven minus intake, plus Group People and its unservable panel body; the gate square carries §14.11's server-computed shape

### Order 5 · i9-check {#order-5}
status: planned
size: L
doc: 03c §Order 5 · i9-check · 03c §Recommended migration order (by risk / complexity / reuse) · ref:dashboard-surfaces §4 · ref:dashboard-surfaces §7 · ref:execution-and-sessions §8 · ref:data-intake-and-edit-data §4.1

> UCPath read + durable roster projection — verify I-9 packet, the master retention workbook. Operation coordinator + member enqueue + display-only rows, no external submit.

builds:
- [ ] BE the operation coordinator at scale
- [ ] BE stable-keyed SQLite outbox + serialized workbook projector
- [ ] BE the first Excel export writer (the master I-9 retention workbook)
- [ ] PROOF T1 scenario tests for i9-check (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- order-1
- order-4
- you: §b questionnaire

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 5 written: `src/infra/artifacts/xlsx-retention-sink.ts` already proves ref data-intake-and-edit-data §4.1's contract, D164 leaves it uncomposed, and its own header names THIS migration as the owner of the operator-facing column layout. A scale proof with no external submit

#### Dashboard · wire i9-check {#order-5-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire i9-check · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:data-intake-and-edit-data §4.1 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about i9-check: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for i9-check (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] FE member rows with retention status; the workbook export control
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | seven squares — six standard (no gate, no intake) plus retention status and the export control; it reuses order 4's Group People rather than rebuilding it

### Order 6 · work-study · kronos-pay-rule {#order-6}
status: planned
size: L
doc: 03c §Order 6 · work-study · kronos-pay-rule · 03c §Recommended migration order (by risk / complexity / reuse) · ref:write-safety §2.2 · ref:write-safety §5 · ref:task-contract §2.9 · ref:data-intake-and-edit-data §1

> **first real writes** — PayPath pool/comp; UKG pay rules. Small, isolated workflow-specific production commits on the proven transaction kernel.

builds:
- [ ] BE work-study and kronos-pay-rule commit contracts
- [ ] PROOF the canonical-EID audit gate: replay real stored inputs through `Eid` `/^10\d{6}$/`, surface every rejection
- [ ] BE the new-kronos store gains its pay-rule write family
- [ ] PROOF T1 scenario tests for work-study · kronos-pay-rule (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- sep-1
- p2-proof
- you: §b questionnaire; controlled-commit target approval

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 6 written: `new-kronos` has a driver, a session provider and two READ tasks from separations chunk 1 (D196) and no write path. The canonical-EID gate is EVIDENCE — `EidSchema` is `/^10\d{6}$/` at `src/domain/ids.ts:184` and widening it is a wrong person who looks right

#### Dashboard · wire work-study · kronos-pay-rule {#order-6-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire work-study · kronos-pay-rule · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:data-intake-and-edit-data §2.8 · ref:dashboard-surfaces §11 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about work-study and kronos-pay-rule: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for work-study and kronos-pay-rule (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH intake grid constants entry + unbind arm (`effectiveDate`, D172/D173)
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | eight squares — seven standard minus the gate, plus the intake grid's constants entry and unbind arm (D172/D173); the intake workspace itself is 2i-E3 and built

### Order 7 · oath-upload · onbase {#order-7}
status: planned
size: L
doc: 03c §Order 7 · oath-upload · onbase · 03c §Recommended migration order (by risk / complexity / reuse) · 03c §Live probe status (the design assumptions still unproven) · ref:write-safety §2.2 · ref:write-safety §4.2 · ref:dashboard-surfaces §4.5 · ref:guards-and-tests §3.5 · ref:task-contract §9.2

> write-heavy — ServiceNow ticket + PDF; OnBase document import. Prove ServiceNow `receipt`; resolve OnBase OQ2 (`upload-verify` vs `unverifiableByPage`); oath-upload ports the born-at-upload fence.

builds:
- [ ] BE the `servicenow` and `onbase` stores (declaration-only today)
- [ ] BE ServiceNow receipt probe; OnBase upload-verify
- [ ] BE oath-upload's born-at-upload fence
- [ ] PROOF rebuild-verified propagation windows for ServiceNow
- [ ] PROOF T1 scenario tests for oath-upload · onbase (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- order-6
- you: name a ServiceNow live-probe target
- you: name an OnBase probe target (none exists today)

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 7 written: `servicenow` and `onbase` are 12-line unwired declarations with zero tasks, and TWO of this row's blockers need the operator, not an agent. `unverifiableByPage` would change the WORKFLOW (the operator confirms every upload), not just the assertion

#### Dashboard · wire oath-upload · onbase {#order-7-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire oath-upload · onbase · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:operator-trust §2.3 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about oath-upload and onbase: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for oath-upload and onbase (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] WIRE ServiceNow ticket receipt + OnBase upload-verify on the run-detail receipt
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | seven squares — six standard plus the two new receipt arms; if OnBase lands on `unverifiableByPage` the receipt square grows an always-park presentation instead of a verify

### Order 9 · onboarding {#order-9}
status: planned
size: XL
doc: 03c §Order 9 · onboarding · 03c §Recommended migration order (by risk / complexity / reuse) · ref:workflow-model §3 · ref:data-intake-and-edit-data §4 · ref:write-safety §5 · ref:write-safety §14

> write-heavy — the real hire transaction. The duplicate-person incident; last, highest-stakes, most reuse of everything below it.

builds:
- [ ] BE the hire probe with the no-EID key (`ProbeVerdict`-widened)
- [ ] BE roster ingest
- [ ] BE the onboarding composition over the ucpath / crm / kuali / kronos stores
- [ ] PROOF T1 scenario tests for onboarding (structural fixture + dry-run scenario) and its T3 pair (R10)

needs:
- order-8
- order-5
- you: §b questionnaire; a hire canary you approve

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Order 9 written: `probeVerdictSchema` has four arms at `src/domain/write-safety-primitives.ts:50` and every permanent key in the tree is EID-derived — a hire CREATES the identity, so the widening is a real schema question, not a naming one. Its canary is the hardest target in the program

#### Dashboard · wire onboarding {#order-9-dash}
status: planned
chip: inherits the defaults — wiring only
doc: 03c §Dashboard · wire onboarding · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1.1 · ref:frontend-backend-integration §5.1.2 · ref:frontend-backend-integration §5.1.3 · ref:frontend-backend-integration §5.1.4 · ref:frontend-backend-integration §5.1.5 · ref:frontend-backend-integration §5.1.6 · ref:frontend-backend-integration §5.1.7 · ref:data-intake-and-edit-data §4 · ref:write-safety §14.11 · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §10.1 · ref:dashboard-surfaces §10.2 · ref:operator-trust §5.9

> What the generic surfaces must learn about onboarding: its typed start inputs, how a row names its subject, which timeline categories its descriptor declares, what its receipt and ledger lines say. Everything here is wiring — the surfaces exist; a missing square means the wire is not run yet, not that the surface is sloppy.

builds:
- [ ] WIRE run modal — typed start inputs + start plan for onboarding (descriptor `surfaces.inputRun`)
- [ ] WIRE queue row — subject title, workflow class, linked-run chips, per-row actions
- [ ] WIRE run detail — the descriptor's timeline categories, receipt, data rail (step · direction · bound)
- [ ] BOTH gate ceremony — the approval shape this workflow's gate demands, server-computed
- [ ] WIRE notifications — park / needs-you triggers into the durable inbox (ref dashboard-surfaces §2.6)
- [ ] WIRE archive · activity · explorer — ledger presentation declarations for its commits, its cross-tab category, its descriptor prose
- [ ] BOTH roster ingest surface; the hire canary's ceremony
- [ ] PROOF T2 dashboard scenario for the wired surfaces (R10)

needs:
- dash-defaults

log:
- 2026-08-20 | docs-cohesion 03c | eight squares — the only sub-task that fills every square in the template, which makes it `{#dash-defaults}`'s own proof

### Cross-cutting Phase 3 capabilities (no single order) {#cross-cutting}
status: planned
doc: 03c §Cross-cutting Phase 3 capabilities (no single order) · 03c §Non-workflow capability closure inventory (D58) · ref:clock-config-secrets §3 · ref:clock-config-secrets §6.2 · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §8

> Where legacy is still ahead — the honest list, each shaped against a real run corpus rather than invented in planning.

builds:
- [ ] BOTH editable settings — the `apply-settings` command family (read-only today; D169/D184)
- [ ] BOTH cross-date search module
- [ ] BOTH screenshots gallery + the artifact-bytes route
- [ ] BE Excel export writers (3 in legacy)
- [ ] DOCS `test-login` / setup wizard equivalents, or their retirement with evidence

needs:
- phase-3

log:
- 2026-08-20 | docs-cohesion 03c | doc 03c §Cross-cutting written against the code and the five capability reasons: `settings.tsx` is read-only while the command union already carries `apply-settings`; no `/api/search` (deliberate — two runs is not a corpus); no screenshots routes and no artifact-bytes route; three legacy Excel writers and zero here; no setup script. None of the five is started

## The X → Y traceback {#deferred}
phase: Deferred
status: planned
when: comes due | at a named trigger
chip: every deferral names its trigger
chip-tone: never
doc: 04 §Phase summary · 00 §Size model + delivery tiers · 03c §Live probe status (the design assumptions still unproven) · 05 §Risk register (top sequencing risks)
open: no

> "I want to do X; the plan said build Y; Y is deferred." None is silently dropped, none is "can't ever work"; two have a decided stance instead of a trigger (D193) — they simply do not get built unless you ask.

note: **Never, by design:** unverified silent fallbacks · selector `.or()` chains · per-daemon logs / bespoke polling hooks / secondary count caches · per-action mutation routes · generic retry on a parked write · DSL/codegen workflow authoring (D79a) · LAN/remote operator mode · hosting (D193) · legacy change accounting (D150).

### Photograph a paper form on your phone → it becomes an OCR-backed run {#def-capture-binding}
status: planned
doc: 04 §Photograph a paper form on your phone → it becomes an OCR-backed run · ref:data-intake-and-edit-data §5.1 · ref:dashboard-surfaces §12

> `CAPTURE_INTAKE_BINDINGS` is deliberately empty — neither current workflow can honestly derive an employee id from a photograph. Comes due with the first OCR-consuming workflow; "close this first": the `run.queued` span from projector-enqueued runs.

needs:
- order-3

### Run the dashboard without the dev server / use the phone page in production {#def-byte-path}
status: planned
doc: 04 §Run the dashboard without the dev server / use the phone page in production · ref:frontend-backend-integration §6.9 · ref:frontend-backend-integration §8 · ref:dashboard-surfaces §12.6

> BFF static bytes + `capture.html` + the ngrok launcher + a guard arm that the file handler serves nothing outside the capture allow-list to a phone origin. D189 / D175; "production" here means LOCAL (D193).

builds:
- [ ] BE the BFF static handler — port the parity fixture's traversal-checked, content-typed serveStatic; every unrouted path 404s today
- [ ] BE `--prod` parsed by `startRebuildRuntime` — the flag is read by nothing, so `npm run dashboard:prod` is byte-identical to `npm run cli -- dashboard`
- [ ] BE `/capture.html` delivered, so 2i-F's token-scoped phone surface is reachable from a phone
- [ ] BE the on-demand ngrok tunnel launcher (D175)
- [ ] BE the guard arm — a phone-origin request may be served nothing outside the capture allow-list
- [ ] BE wire or delete the INERT capture-ingress host gate: `deps.capturePhoneHost` is never supplied, so the middleware compiles and can never fire (also Track D row D2)

needs:
- order-3

### Edit a workflow's presentation / policy without a code change {#def-explorer-edit}
status: planned
doc: 04 §Edit a workflow's presentation / policy without a code change · ref:operator-trust §5.1 · ref:operator-trust §5.3 · ref:operator-trust §5.4

> The Workflow Explorer EDIT half. D186: an editor shaped by a sample of one workflow would be wrong.

needs:
- fact: a SECOND production workflow whose policy you want to change

### A record-sanity-check advisory panel {#def-sanity-check}
status: planned
doc: 04 §A record-sanity-check advisory panel · ref:operator-trust §4.4 · ref:guards-and-tests §3.11

> The one AI tool kept open (run-summary and selector-suggestion are RETIRED, D192). §9.17 flags its deferral condition as materially satisfied by the §14.2 packet's comparisons.

needs:
- order-8
- you: re-disposition D192 (keep open / close the inventory entry)

### Edit settings in the dashboard {#def-settings}
status: planned
doc: 04 §Edit settings in the dashboard · ref:clock-config-secrets §3 · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §2.4

> The `apply-settings` command family — rebuild settings are read-only, "nothing here pretends to save" (D169/D184). Phase 3 milestone, no single trigger; listed under cross-cutting above.

builds:
- [ ] BE `apply-settings` stops answering `capability-unavailable` — the kernel's ONE `PHASE1_DEFERRED` arm; family, target and atomic N-leaf payload are already contracted
- [ ] BE the preflight/doctor service `buildBootstrap` composes none of — `FrontendBootstrapWireSchema#preflight` is declared-unserved (D184), so the stethoscope popover never mounts
- [ ] FE the Settings write path and the doctor-rerun command control

needs:
- cross-cutting

### Trust UCPath / ServiceNow wait-before-negative-read windows {#def-propagation}
status: planned
doc: 04 §Trust UCPath / ServiceNow wait-before-negative-read windows · ref:write-safety §4 · ref:write-safety §4.2 · 03c §Live probe status (the design assumptions still unproven)

> Rebuild-verified propagation measurements replace ported legacy knowledge at each system's own live probe (doc 03c §Live probe status).

needs:
- order-7

### Search runs across dates / view screenshots / export Excel {#def-search-export}
status: planned
doc: 04 §Search runs across dates / view screenshots / export Excel · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §2.2

> No search module, artifact-bytes route or export writers in the BFF yet — capability register open; shaped against a real run corpus.

builds:
- [ ] BE the artifact-bytes route — the ref/resource schemas are complete and nothing serves bytes; it also unblocks the `captures` run-detail section and the screenshot gallery
- [ ] BOTH the cross-date run search route + surface — the Top Bar filters the served day only (`legacy-route-search`)
- [ ] BE the operator xlsx export — the xlsx sink is a retention sink, uncomposed in production (D164); the Activity CSV (D240) is the only export served

needs:
- cross-cutting

### Auto-purge diagnostics on the 14/8/5 schedule · reclaim unreferenced artifact bytes {#def-retention}
status: never
chip: won't build unless you ask
doc: 04 §Auto-purge diagnostics on the 14/8/5 schedule · reclaim unreferenced artifact bytes · ref:operator-trust §2.2 · ref:dashboard-surfaces §2.1 · ref:guards-and-tests §3.7

> Retention-sweep scheduling (the sweep itself is built and tested) and a content-store refcount — D193: disk growth on one local machine isn't worth a durable reference count.

## One all-at-once authority switch {#cutover}
phase: Cutover
status: planned
when: after Phase 3
size: L
chip: not started
doc: 05 §Phase summary · 05 §Exit criteria · ref:dashboard-surfaces §5 · ref:dashboard-surfaces §5.4 · ref:frontend-backend-integration §10
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
- fact: doc 05 §Exit criteria — the definition of done + the program-wide integration criteria (ref frontend-backend-integration §10) green in the real built app

### Rollback window, then closure {#rollback-window}
status: planned
doc: 05 §Rollback window, then closure · 05 §Phase summary · ref:dashboard-surfaces §5

> Legacy code, tests and state intact; closure is its own later authorization.

needs:
- cutover

### Later, unplanned {#later-unplanned}
status: never
chip: ideas, not a hosted future
doc: 05 §Later, unplanned · ref:operator-trust §7

> Package the local app ("web app → real app"); a cooperation / multi-user mode built on top of solo (D193).

<!-- roadmap:end -->

---

## Governance (the plan's own rules)

_Lifted from the master plan's §0 on 2026-08-20 (cohesion step 3a) — verbatim except
where a name moved: the design docs are now cited by slug under `docs/rebuild/reference/`, and the
plan's own numbers are the phase docs `docs/rebuild/00`–`05` (the number IS the phase; phase 3 is
three docs, `03a`/`03b`/`03c`). The master plan itself was dissolved into those docs on the same day
(step 3b); its as-written record, with a section-by-section table of where everything went, is
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`._

### The one-plan rule

Per charter §"One master plan": the owning design docs (now `reference/task-contract`,
`reference/workflow-model`, `reference/dashboard-surfaces`, `reference/decisions`,
`reference/execution-and-sessions`, `reference/data-intake-and-edit-data`, and
`reference/write-safety` through `reference/frontend-backend-integration`) are the binding detail;
THE PLAN — this file, the tree, plus the phase docs `docs/rebuild/00`–`05` — is the authoritative
build order. No second plan, no per-workflow "alt plan," no execution doc that re-sequences
phases. Per-workflow *migration plan docs* (Phase 3+) are **children** of this plan — they answer the §b questionnaire
(`doc 03c` §The §b migration questionnaire) and record what a workflow reuses/adds; they never re-order the
program.

**D263 (2026-08-20) — the plan has a machine-readable form, and it is bound to the docs both ways.**
`docs/roadmap/roadmap.md`, written in the roadmap notation
(`.claude/skills/custom-update-plan/SKILL.md` §Notation), is that form and the operator tracking view;
`docs/roadmap/index.html` is GENERATED from it by `npm run roadmap` and is never hand-edited. It is a
second VIEW of this plan, never a second plan — **the plan's prose wins on any disagreement**, and the
disagreement is CAUGHT rather than argued, because the binding is two-way and mechanical: every node
carries a `doc:` line naming the sections that own its contracts, every doc
section that describes a node carries `<!-- roadmap: <id> -->` under its heading, and the
`roadmap-doc-binding` guard refuses a ref or a tag that resolves to nothing — so a rename on either
side fails the gate instead of rotting. Three rules bind the tree itself. A `builds:` box is `[x]`
**only** for what is landed at HEAD, with its commit or D-number cited in the line — never pre-marked.
The tree never invents scope: an unplanned feature is a finding for `docs/findings/`, not a roadmap
line. And session work is RECORDED where it happened — append-only per-node `log:` blocks plus one
`## session:` spine marker per working session, written through `/custom-update-plan`'s `session`
class, so the next agent reads a node's own history rather than re-deriving it from `git log`.

### D1 ownership map — the quick index (concept → owning doc)

Every concept has exactly one owner (`reference/decisions` D1). Reference the owner; never redefine.
The rows below are the same map the master plan's §0.2 carried, re-pointed to the shelf's new names.

| Concept | Owner |
|---|---|
| Task contract (`defineTaskContract`/`defineTask`), contract/impl split (D3), task-namespace grammar + closed `SystemId` union (D2), error taxonomy, three effects/dry-run mechanics, retry, decoration, system/service stores + pure workflow mini-stores, session providers + login signature, `stores/common/` leaf homes | **`reference/task-contract`** (was doc 01) |
| Workflow builder API (single), descriptor shape, `RunEnvelope`, run-state machine incl. gates/parks (D5), checkpoint/resume + freshness walk (D8), label precedence (D16) | **`reference/workflow-model`** (was doc 02) |
| Span/event wire schema (D10), notes stream, storage layout, SQLite projection role (D14), SSE wire shapes, completion (fan-out/approval) union (D11), cross-repo runtime boundary + one-time import rules (D88/D89/D93), the ONE run/queue projection every count reads (D81), run versioning + archive-on-bump (D80), run display names (D83) | **`reference/dashboard-surfaces`** (was doc 03) |
| Binding cross-doc reconciliation (D1–D118, through 2026-08-02 Round 18) | **`reference/decisions`** (was doc 04) |
| One-item workers, queue dispatch/backpressure, explicit browser-session boundaries + driver leases, speed/sleep-tax contract, page/subject-isolation invariant | **`reference/execution-and-sessions`** (was doc 05) |
| Data-service systems: CSV/PDF extraction, typed contact/address normalization, roster matching, durable mobile capture, operator column mapping, immutable intake manifest/rerun, Edit Data checkpoint UI | **`reference/data-intake-and-edit-data`** (was doc 06) |
| Cross-cutting gap findings memo (owns nothing — a design input) | **`reference/foundation-gap-audit`** (was doc 08) |
| Write-safety contract, permanent-key intents, typed proof, atomic outboxes/recovery, serialized anchored ledger | **`reference/write-safety`** (was doc 09) |
| Guard/test architecture suite: ratchet port map, safety guards, descriptor-coverage crosswalk, guard-of-guards manifest, TDD tiers, stub + live lanes | **`reference/guards-and-tests`** (was doc 10) |
| The Clock (sole time source), config resolver (env>settings>default), per-run prod/test instance (D6-adjacent), fiscal-year rollover, secrets accessor, environment/preflight registry | **`reference/clock-config-secrets`** (was doc 11) |
| Semantic UI vocabulary + typed drivers, failures/diagnostic bundles/evidence receipts, scenario corpus, structured knowledge/fix history, durable trust/explain surfaces, workflow explorer/editor, local-first seams/safety floor, base capability inventory | **`reference/operator-trust`** (was doc 12) |
| Production dashboard composition boundary: bootstrap/day/detail resources, one typed client, cursor-based SSE, product command-family coverage, surface-to-authority matrix, visual-parity harness | **`reference/frontend-backend-integration`** (was doc 13) |

The operator's vision and the non-negotiables stay `reference/charter` (was doc 00). The PLAN half —
phases, tasks, exit criteria, the migration order, the deferrals and the cutover — is this file plus
the phase docs under `docs/rebuild/`, one per tree phase: `00-design-the-foundation` ·
`01-build-the-spine` · `02-prove-writes-build-the-tails` · `03a-finish-the-dashboard` ·
`03b-finish-separations` · `03c-migrate-the-remaining-workflows` · `04-close-the-deferrals` ·
`05-cut-over`.

### Standing rule — each completed phase documents itself

Charter §"One master plan": *the foundation's documentation is part of the foundation.* When a phase
completes, its owning docs are updated to describe **as-built** reality (not just design intent), and
this plan's phase table is checked off. A phase is not "done" until its doc delta is written. New
sub-systems get new docs or amend existing ones; stale prose is corrected, never layered. Per D263
(above) a phase's close-out also ticks its node in `docs/roadmap/roadmap.md` and leaves a `log:`
line there naming what landed and what is left.

---

## Phases at a glance

_Moved from `docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md` §2 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite
re-verifies it, and its four internal §-refs are repointed to the phase docs that now own those
sections. Each phase's detail — its work items, what is done, its exit criteria — is its own doc
under `docs/rebuild/`; the tree above is the same set of phases as nodes._

| Phase | Headline deliverable | Gate to exit | Size |
|---|---|---|---|
| **0** | Corrected foundation design approved; empty rebuild repo | **COMPLETE 2026-07-31:** decisions reconciled through Round 12; testing policy ratified; executable feasibility + honest gate baseline recorded; write-proof probes carry explicit later milestone gates (`doc 03c` §Live probe status) | **M** |
| **1** | **The SPINE** — the minimum base that can carry one workflow end to end (1a–1f + the span/projection slice + the queue-surface slice) | **COMPLETE 2026-08-04.** 1a + 1b COMPLETE 2026-07-31; 1c + 1d + 1e COMPLETE 2026-08-01; **1f + 1g-spine + 1i-spine COMPLETE 2026-08-04**. The phase exit — **person-lookup ran LIVE on the spine** (D74) against real UCPath + CRM, run `4ebf7275-0158-49af-a78f-1f37948efb27` / trace `pl-000619-4ebf` — is **MET**; full gates green; strict/subject/control/delegation/recovery/scenario fixtures pinned. Evidence and the carried-forward presentation defects are recorded under §Phase 1's exit criteria | **XL** |
| **2** | **Transaction proof, then the deferred base tails** — controlled real commit + crash/recovery, *then* trust tails, data services/intake/capture, explorer | subject-bound dry-run and controlled commit/crash/outbox/ledger proof green; then evidence/notification/knowledge, intake/capture/Edit-Data, and read-only explorer land against a proven spine | **XL** |
| **3+** | Per-workflow rebuild migration, one at a time (order: `doc 03c` §Recommended migration order), plus explicit non-workflow capability closure (`doc 03c` §Non-workflow capability closure inventory) | each: §b questionnaire answered; isolated live dry-run + controlled write evidence where applicable; every capability inventory entry advances to native/replaced/retired; docs updated; legacy production remains authoritative until the final gate | **XL** |
| **Cutover** | One all-at-once production authority switch (D89) | every workflow/shared capability ready; legacy enqueues stopped; active/uncertain work reconciled; both states backed up; imports versioned/idempotent; launcher switches atomically; rollback bridge verified; legacy code/tests preserved | **L** |

**Reading the Size column.** These are relative build sizes, not calendar — the calendar depends
on session cadence, which the plan does not own. The unit is *work sessions of the kind this
program actually runs in*: **S** ≈ 1, **M** ≈ 2–4, **L** ≈ 5–10, **XL** ≈ 10+. They expose
delivery risk and help keep a long coexistence program tractable. Per-item sizes are in `ref charter` §Size model + delivery tiers; they are estimates
offered for correction, not commitments.

---

## Where things went

The master plan (`07-master-plan.md`) was dissolved on 2026-08-20 and no longer exists as a doc. Its
sections are now:

| Was | Is |
|---|---|
| §0 governance | this file, §Governance above (lifted 3a) |
| §1 the base's dependency graph · §3 Phase 0 · §3.7 sizes | `docs/rebuild/00-design-the-foundation.md` |
| §2 the phase table | this file, §Phases at a glance above |
| §3 Phase 1 · §7.1–§7.2's Phase-1 rows | `docs/rebuild/01-build-the-spine.md` |
| §3 Phase 2 · §7.1–§7.2's Phase-2 rows | `docs/rebuild/02-prove-writes-build-the-tails.md` |
| §7.1's approved-target bullet · §7.3 the integration execution rule | `docs/rebuild/03a-finish-the-dashboard.md` |
| §3.1's PHASE 3 ENTRY block + separations' status | `docs/rebuild/03b-finish-separations.md` |
| §3.1 the migration loop · §3.2 · §3.3 · §3.4 · §3.6 · §3.8 | `docs/rebuild/03c-migrate-the-remaining-workflows.md` |
| §3.5 · Phase 0's deferred decisions | `docs/rebuild/04-close-the-deferrals.md` |
| §4 · §5 · §5.1 · §6 · §7.4 | `docs/rebuild/05-cut-over.md` |

The whole as-written file, with a section-by-section table of where every § landed, is preserved at
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`.

This file's own appendices went too:

- **Appendix A (the prose decision log and the "named to you at specific future gates" list)** —
  **deleted.** `docs/rebuild/reference/decisions.md` is the append-only authority for every `D<n>`
  (its round headings carry the date, its rows the owning doc), and every future gate it listed is
  already a `you:` line on the node that owes it in the tree above.
- **Appendix B (legacy vs rebuild)** — `docs/rebuild/05-cut-over.md` §Legacy vs rebuild (as of
  2026-08-20), dated because it is an inventory of a moving world.
- **Appendix C (verify any of this yourself)** — the project `CLAUDE.md` §Commands, which already
  carries every command it listed (`phase` and `storage doctor` are subcommands of `npm run cli`).
