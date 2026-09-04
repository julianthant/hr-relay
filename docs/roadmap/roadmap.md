# HR Rebuild Roadmap
<!-- `docs/roadmap/roadmap.md` is the plan as written, in the roadmap notation (see docs/roadmap/notation.md): everything between roadmap:start and roadmap:end renders at docs/roadmap/index.html via `npm run roadmap`; appendices after roadmap:end are prose. Per D263 (§Governance below) a node also carries `doc:` — the docs/rebuild sections owning its contracts — and a `log:` block, the append-only history kept in the detail drawer rather than on the phase spine. -->
asOf: 2026-09-04
head: ff4e08b9
eyebrow: hr-automation-rebuild · the plan · source: docs/roadmap/roadmap.md
source: Stems from phase docs `docs/rebuild/00`–`06` (§Phases at a glance below, D323 phase hierarchy, `00`'s size model)
source: `docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` (Tracks 0/A/B/C)
source: `docs/plans/2026-08-20-dashboard-architecture-audit.md` (Track D) · the phase docs win on any disagreement
footer: Generated from `docs/roadmap/roadmap.md` (the plan, written in the roadmap notation) by `npm run roadmap` — edit the plan, never this file; plan, site and owning docs move together — notation: `docs/roadmap/notation.md`.
> The ground-up rebuild of UCSD's UCPath HR automation, as a tree. Historical Phases 0–2 remain evidenced, but the authority model is deliberately reopened at **0.3** before **1.6** implements it, **2.6** revalidates the tails, and **3.1** completes every generic dashboard function. **3.2** then finishes workflow authoring and freezes one audited candidate, **3.3** accepts Person Lookup and Separations against that exact candidate, and **3.4** finishes Codex/Claude cooperation. Phase 4 migrates the remaining workflows one part at a time. Phase 5 prepares and performs the all-at-once cutover. Phase 6 ships the desktop application. Legacy stays the sole production authority until Phase 5's switch.

tiles:
- Historical completion | 0.1–0.2 · 1.1–1.5 · 2.1–2.5 | evidence retained; runtime marker still reports `completedThrough: 2j`
- Active | Phase 0.3 | redesign run and settings authority before implementation starts in 1.6
- Next | Phase 1.6 | implement the run/settings authority designed by 0.3, then revalidate it through 2.6 and 3.1
- Decisions | D1–D332 | D326 normalizes Phases 0–3 · D327 fixes the one-source run/settings outcomes · D330 fixes the run-record lifecycle contract (0.3 Task 1) · D331 fixes the settings catalog and protected root (0.3 Task 2) · D332 fixes the authority upgrade, adapters and recovery (0.3 Task 3) · D328 renders parallel peers as numeric wave members (`9-1`, `9-2`) · D329 puts authoring/freeze before controlled acceptance · D131 retired, never reused
- Gates | current source authority | open the active part for exact completion evidence and remaining gates
- !Critical-path blocker | Separations controlled proof | D329 holds every write behind 3.2's independent candidate audit and 3.3's exact-candidate admission. Historical 4589 remains inspection-only; the bounded authorization must name the candidate, fingerprints, disposable targets, disposition, and sequence, and expires on drift, failure, or UNKNOWN

<!-- roadmap:start -->

## Phase 0 · Design the foundation {#phase-0}
phase: Phase 0
status: active
when: 2026-07-31 historical · reopened 2026-09-03 at 0.3
size: M
chip: 0.1–0.2 evidenced · 0.3 active
doc: 00 §Phase summary · 05 §Stage summary · ref:charter · ref:decisions
open: yes

> Historical Phase 0 fixed the charter, safety boundary, plan ownership, delivery model, and cutover shape. D326 reopens design only at 0.3 so the run and settings authority model is decided before implementation work can override Phase 1 and Phase 2 foundations.

builds:
- [x] DOCS the plan SSOT — fourteen reconciled design docs, each owning its contracts (the shelf is now `00`–`05` + `reference/`, D263)
- [x] DOCS the decision changelog `reference/decisions` as a pointer index
- [x] DOCS separation identity authority designed (historical D77 ALWAYS-GATE; current D309 source condition; ref write-safety §14)
- [x] DOCS size model + MUST / SHOULD / LATER delivery tiers (D76)
- [x] DOCS two-repo coexistence + one cutover (D88–D94)

log:
- 2026-09-03 | D326/D327 authority reset | 0.1–0.2 keep their completed evidence. 0.3 is the earliest active subphase and owns the run-record and settings authority contracts, migration boundary, recovery model, and implementation briefs; no runtime code changes until it closes
- 2026-08-25 | test-tiers | Phase 0 remains DONE; of its two later-unbuilt promises, D85 is now built under R10's `cli dry-run-scenario` + `config/test-subjects.json` + durable-result names. D79's scaffold generators are the one remaining promise (new-workflow owned by `def-explorer-edit`, new-task unowned and reported)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

### 0.1 · Product charter and safety boundaries {#phase0-charter}
status: done
date: 2026-07-31
doc: 00 §Phase summary · 00 §0.1 · Product charter and safety boundaries · ref:charter · ref:write-safety §1

> Fix the product purpose, fail-loud safety boundary, one-cutover rule, repository isolation, and the identity-authority model before implementation.

builds:
- [x] DOCS product charter and operator non-negotiables
- [x] DOCS fail-loud write-safety boundary and one all-at-once cutover
- [x] DOCS two-repository coexistence and rollback authority
- [x] DOCS separation identity authority

#### 1 · Fix the charter and authority boundary {#phase0-charter-boundary}
status: done
doc: 00 §Phase summary · ref:charter · ref:write-safety §1

builds:
- [x] DOCS name the legacy runtime as sole production authority until cutover
- [x] DOCS require failures and unknown outcomes to remain visible rather than defaulted
- [x] DOCS keep design, implementation, proof, and operator authorization distinct

#### 2 · Design separation identity authority {#phase0-always-gate}
status: done
date: D77 → D309 · ref write-safety §14
doc: 00 §Task 2 · Design separation identity authority · ref:write-safety §14 · ref:write-safety §14.1 · ref:write-safety §14.3 · ref:write-safety §14.9 · ref:workflow-model §4

> Current D309: an independently supplied EID proceeds only after exact UCPath read-back; any name-resolved EID requires the real operator gate regardless of similarity. Historical D77 designed the unconditional predecessor.

log:
- 2026-09-02 | D309 | operator correction ratified in ref write-safety §14.12: source-conditioned authority supersedes D77's trigger; machine verification creates no human result, while every name-resolved identity uses the existing typed gate
- 2026-08-21 | docs-cohesion 00 | the design D77 wrote here is BUILT and live-proved (D202, separations chunk 3, first live gated run 2026-08-12) and four decisions have moved it since — D203 a gate row IS a dependency's evidence, D204 the receipt derives from it, D211 the packet carries the write plan so a date that moves re-opens the gate, D226 all three ceremonies exist. §14.7's two deferred values were ANSWERED at the separations questionnaire on 2026-08-12 (freshness 4 hours; the I-9 packet question out of scope) while `ref write-safety` §14.7 still reads as open — a finding for that doc's unit, not fixed here. Left: §14.4's manual-EID arm is built narrower than designed (no second live read in that chunk)

### 0.2 · Delivery governance and plan structure {#phase0-governance}
status: done
date: 2026-07-31 → 2026-09-03
doc: 00 §0.2 · Delivery governance and plan structure · ref:task-contract §2.7

needs:
- phase0-charter

> Fix the one-plan rule, ownership boundaries, phase order, delivery tiers, and the unit by which work may be dispatched and proven.

builds:
- [x] DOCS one-plan rule and contract ownership map
- [x] DOCS size model and delivery tiers
- [x] DOCS visible phase/part/task hierarchy and supervisor-sized execution units

#### 1 · Establish the one-plan and ownership rules {#phase0-plan-governance}
status: done
doc: 00 §0.2 · Delivery governance and plan structure · ref:decisions

builds:
- [x] DOCS roadmap tree, admitted phase docs, and reference specs have non-overlapping authority
- [x] DOCS decisions land in their owning contract with a pointer in the decision changelog
- [x] DOCS generated roadmap site is checked against its source

#### 2 · Fix the spine order and deferred proof gates {#phase0-build-order}
status: done
doc: 00 §0.2 · Delivery governance and plan structure · 00 §Exit criteria · ref:charter §Process

builds:
- [x] DOCS D74's narrow spine plus live exit, with the deferred tails preserved
- [x] DOCS D92's owner, evidence, and resolution-point rule for deferred live probes
- [x] PROOF later phases executed the order without silently dropping a deferred capability

#### 3 · Prove executable feasibility and record the gate baseline {#phase0-feasibility}
status: done
doc: 00 §Exit criteria · ref:guards-and-tests §1

builds:
- [x] PROOF executable feasibility spike over the highest-risk type and storage assumptions
- [x] DOCS keep feasibility evidence distinct from implementation evidence
- [x] DOCS record the honest lint/test baseline and its later dispositions

#### 4 · Fix the size model and delivery tiers {#phase0-size-model}
status: done
date: D76 · doc 00 §Task 4 · Fix the size model and delivery tiers
doc: 00 §Task 4 · Fix the size model and delivery tiers · ref:task-contract §2.7

> MUST (the spine) · SHOULD (Phase-2 tails) · LATER (explorer, advisories, catalog) — what may slip without invalidating the base.

log:
- 2026-08-21 | docs-cohesion 00 | D76's model is LIVE, not history — all 24 items it sized carry the same `size:` on their node today, unchanged and never re-estimated, and the five phase-level sizes agree with §Phases at a glance. All three tiers shipped whole (MUST in phases 1–2, SHOULD in 2g/2h, LATER all five in 2i BEFORE Phase 3), so the fallback shape the tiers define has never been exercised. D79's trims all held except its last sentence: the `scaffold` generators the lightweight tier was ratified with do not exist. Five nodes minted since D76 are sized in its unit and were never in its table — `dash-defaults` `duo-lease` `parallel-runs` `observed-logs` `test-tiers`

### 0.3 · Redesign single-source runtime authority {#phase0-authority-reset}
status: done
date: 2026-09-03 → 2026-09-04
size: M
chip: closed 2026-09-04
doc: 00 §0.3 · Redesign single-source runtime authority · ref:dashboard-surfaces §2.3 · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4

> Design, but do not yet implement, one CRUD-capable run-record authority for every current, queued, terminal, archived, and deleted run, plus one settings catalog and protected local settings root for every non-provider-key setting. The design must make existing authorities migratable without erasing evidence.

builds:
- [x] DOCS canonical run-record identity, lifecycle, typed CRUD/CAS operations, deletion semantics, and projection contract — D330 (0.3 Task 1)
- [x] DOCS one settings catalog/root, leaf classification, validation, revision/CAS, secret-return policy, and UI edit contract — D331 (0.3 Task 2)
- [x] DOCS migration/read-forward/rollback/recovery rules for the existing SQLite, span, environment, and settings authorities — D332 (0.3 Task 3)
- [x] DOCS deletion tests, proof ladder, implementation seams, and exact 1.6/2.6/3.1 handoff briefs — R04 (0.3 Task 4): doc 01 §1.6 binding, docs 02 §2.6 / 03.1 notes, ref guards-and-tests §5.2 as amended

needs:
- phase0-governance

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | 0.3 closed: D330/D331/D332 adversarially reviewed as one system (eleven fixes landed in the owning specs, one product-truth item to the coordinator), every residue dispositioned, 1.6 bound task by task with the floor + wave 2 ruling, 2.6/3.1 consumption cited · left: the coordinator's phase roll-up and the `cancel` ruling; 1.6 starts at Task 1 (the floor)

#### 1 · Define the canonical run-record authority {#phase0-run-authority-design}
status: done
doc: ref:dashboard-surfaces §2.3 · ref:execution-and-sessions §3 · ref:operator-trust §1

builds:
- [x] DOCS make one SQLite-backed run-record service the existence and lifecycle authority for queue, current, terminal, archive, and tombstone states — D330 §D330.2–§D330.3
- [x] DOCS expose typed create/read/update/delete and compare-and-swap transitions; keep tables private to adapters — D330 §D330.4–§D330.5, §D330.10
- [x] DOCS retain spans, logs, receipts, and artifacts as append-only evidence linked to the run, never competing lifecycle authorities — D330 §D330.9
- [x] DOCS specify queue ordering, first-eligible claim, retry/relaunch, archive, purge, and D308's terminal-only physical deletion behind an insert-only tombstone — D330 §D330.6–§D330.8

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R01 | D330 landed in ref dashboard-surfaces §D327 → §D330.1–§D330.12 (4e65270f + follow-ups); D268 fold arms, `runs_view` and §2.4 purge-run superseded by dated notes · left: 0.3 Tasks 2–4; 1.6 implements the service, 2.6 migrates readers

#### 2 · Define the canonical settings catalog and root {#phase0-settings-authority-design}
status: done
doc: ref:clock-config-secrets §3 · ref:frontend-backend-integration §4

builds:
- [x] DOCS enumerate every setting once with schema, default, editability, sensitivity, restart scope, and owning consumer — D331 §D331.1 (row schema), §D331.9 (the 88-row catalog)
- [x] DOCS place all operator-managed local configuration under one gitignored `.tracker/settings/` root; provider API keys alone remain in `.env`, while runtime observations such as the host-derived display remain catalogued defaults rather than competing persisted settings — D331 §D331.2 (five source classes), §D331.3 (the root), §D331.4 (journal coupling)
- [x] DOCS give Settings one revisioned update API and never return protected values after write — D331 §D331.5 (two CAS arms, refusals, wire), §D331.6 (write-only policy), §D331.10 (edit contract)
- [x] DOCS remove environment precedence for migrated non-provider-key leaves and forbid duplicate fallback authorities — D331 §D331.7 (restart scope, claim-token provenance), §D331.8 (one source per leaf), §D331.11 (proofs), §D331.12 (supersessions)

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R02 | D331 landed in ref clock-config-secrets §D327 → §D331.1–§D331.12 (7869ad1e + follow-ups); §3 precedence/binding sentences, DCC3's eight-leaf boundary, D321's layout sentence, §6's `source: environment` and D300's `.env` source superseded by dated notes · left: 0.3 Tasks 3–4; 1.6 implements the catalog/root, 2.6 migrates consumers, 3.1 builds the surface

#### 3 · Design migration, compatibility, and recovery {#phase0-authority-migration-design}
status: done
doc: ref:dashboard-surfaces §2.3 · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4 · ref:guards-and-tests

builds:
- [x] DOCS define an idempotent upgrade from existing rows/files with preflight, backup, journal, rollback, and mixed-generation refusal — D332 §D332.1 (one stopped-system command, never at boot), §D332.2 (the ordered preflight incl. the generation-bound D322 backup), §D332.3 (prepare → one exclusive transaction → settle), §D332.4 (rollback), §D332.5 (journal, idempotence, replay), §D332.6 (the closed mixed-generation boot matrix)
- [x] DOCS preserve historical run evidence, stable run ids, and archive visibility through migration — D332 §D332.7 (identity and bytes untouched, ordinal backfill with provenance, tallies read forward, evidence/snapshots never rewritten, exposure recorded, `authority-unknown` never re-admitted, archive digests unchanged), §D332.8 (read-forward table)
- [x] DOCS specify settings import from current `.env`/`settings.json` and local canary inputs without copying provider API keys — D332 settings half in ref clock-config-secrets (§D332.S1–§D332.S6: what imports where, the `settings.json` carry, the seven dual-source tie-breaks, canary references, the `migrated-refused` first boot, what is never claimed)
- [x] DOCS name compatibility adapters and their deletion tests so transitional paths cannot become permanent authorities — D332 §D332.9 (the five-rule expiry policy and roster A0–A8), ref guards-and-tests §5.2 (per-adapter deletion test and intended inventory entries), §D332.11 (24 migration proofs)

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R03 | D332 landed in ref dashboard-surfaces §2.5 (ea6985b9 + follow-ups): `cli storage upgrade`, preflight, journal, rollback, the boot matrix, preservation, read-forward, adapter policy; settings half in ref clock-config-secrets §D332; adapter roster in ref guards-and-tests §5.2; §2.5 items 3–4/6, D181, D330.8 and §4.1 superseded by dated notes · left: 0.3 Task 4; 1.6 implements the command and proofs, 2.6 deletes A0–A3

needs:
- phase0-run-authority-design
- phase0-settings-authority-design

#### 4 · Close design and issue implementation briefs {#phase0-authority-design-close}
status: done
doc: 00 §0.3 · Redesign single-source runtime authority · 01 §1.6 · 02 §2.6 · 03.1 §Reopened completion tasks · ref:guards-and-tests §5.2

builds:
- [x] PROOF adversarially review run identity, concurrent queue mutation, settings revision conflicts, recovery, and redaction — R04 cross-contract table (twelve scenarios a–l; `reports/r04.md`); fixes in ref dashboard-surfaces §D332.3/§D332.4/§D332.5/§D332.6/§D332.11 M25–M27/§D330.8/§D330.11 #16, ref clock-config-secrets §D331.3/§D331.6/§D331.11 P41, ref guards-and-tests §5.2, ref lessons
- [x] DOCS resolve every open authority decision in its owning reference spec and decision pointer — the resolved-decisions checklist in `reports/r04.md`; no new decision minted; one item (operator `cancel` of a claimed run, §D330.5) deferred to the coordinator as product truth
- [x] DOCS bind each 1.6 task to one implementation seam, gate, integration order, and deletion test — doc 01 §1.6 (serial floor · wave `2-1`/`2-2` · serial 3–7; 94 proofs assigned once each) and roadmap `p1f-floor`, `p1f-*`
- [x] DOCS confirm 2.6 and 3.1 consume the new contracts without redesigning them — dated notes in doc 02 §2.6 (intro + Tasks 1–5) and doc 03.1 (Tasks 9-2, 9-3, 11-1, 11-2, 11-3, 12-1, 12-2); contract citations on the thirteen nodes' `doc:` lines

needs:
- phase0-authority-migration-design

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | closed: cross-contract adversarial review (11 fixes landed, 1 NEEDS COORDINATOR), residue checklist, 1.6 binding with the floor + wave ruling, 2.6/3.1 consumption notes; design gate green in the run worktree · left: the coordinator's `cancel` ruling in §D330.5 before 1.6 Task 4

## Phase 1 · Build the platform spine {#phase-1}
phase: Phase 1
status: planned
when: 07-31 → 08-04 historical · reopened 2026-09-03 at 1.6
size: XL
chip: 1.1–1.5 evidenced · 1.6 waits for 0.3
doc: 01 §Phase summary · 00 §0.1 · Product charter and safety boundaries · ref:operator-trust §0 · ref:frontend-backend-integration §0 · ref:write-safety §1 · ref:write-safety §7 · ref:clock-config-secrets §5
open: yes

> The minimum base that carries one workflow end to end. **Historical exit (D74): person-lookup ran LIVE** against real UCPath + CRM on the new executor. D326 reopens only the foundation boundary: after 0.3 closes, 1.6 gives runs and settings one authority each before later tails and dashboard work continue.

needs:
- phase-0

log:
- 2026-09-03 | D326/D327 authority reset | 1.1–1.5 keep their completed evidence; 1.6 waits for 0.3. It owns one canonical CRUD-capable run-record authority and one settings catalog/root, then proves migration and recovery before 2.6 starts
- 2026-08-29 | D75 authority close | the former unowned `requestedBy` residual is closed by one BFF admission checkpoint, strict configured solo derivation and pre-effect command-claim matching; the cooperation track still owns only the future second actor and credential extension
- 2026-08-21 | docs-cohesion 01 | doc 01 rewritten as-built and all six status blocks filled; every `[x]` in this subtree re-verified against the code and NONE had to be corrected — the phase is DONE and stayed done. What the rewrite adds is a residuals table: five findings that trace back to a spine contract and are owned in LATER nodes (`track-c`, `observed-logs`, Track D rows D6 and D11, `def-byte-path`, `test-tiers`) plus ONE with no owner — `requestedBy` is stamped on every command envelope and never checked, with no D-number and no `pending-wire-bindings` entry, reported rather than assigned
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §0
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

### 1.1 · Guardrails and strict domain {#p1-base}
status: done
date: 2026-07-31
size: L
doc: 01 §1.1 · Guardrails and strict domain · ref:guards-and-tests §2 · ref:guards-and-tests §1.1 · ref:clock-config-secrets §2 · ref:clock-config-secrets §3 · ref:clock-config-secrets §6 · ref:task-contract §2.1.1 · ref:dashboard-surfaces §5 · ref:operator-trust §2 · ref:frontend-backend-integration §3

builds:
- [x] BE guard plumbing + the reviewed guard inventory
- [x] DOCS honest legacy baselines + the D58 capability inventory
- [x] BE strict domain leaf (zod at every boundary)
- [x] BE clock / config / secrets single-sourced (ref clock-config-secrets)
- [x] BE runtime isolation pinned (`.tracker-rebuild`, 3938/5174, locks)

log:
- 2026-08-21 | docs-cohesion 01 | verified at HEAD: nine executable ratchet arms, 75 inventory entries (65 active · 8 retired · 2 planned), the coverage floor still 60/80 at `vitest.config.ts:40-41`. Two of 1a's legacy-lane pieces are RETIRED with successors named (D93 the cross-tree guard family, D150 legacy-change-accounting), and two later decisions amended a 1b contract without re-opening it (D121 moved `paths` to a server-only module, D133 made a required config leaf a read-forward generation) · left: `cancel-mechanism` and `tracker-row-emission` are named in the ratchet port map and held by nothing, and R10's raise of the global floor to 80 has not landed
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §2
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

#### 1 · Land guardrails and baselines {#p1a-guards}
status: done
doc: 01 §Task 1 · Land guardrails and baselines (COMPLETE 2026-07-31) · ref:guards-and-tests §2

builds:
- [x] BE guard plumbing and reviewed guard inventory
- [x] DOCS capability, provenance, and coverage baselines
- [x] PROOF every guard arm fails on its violating fixture

#### 2 · Build the strict domain leaf {#p1a-domain}
status: done
doc: 01 §Task 2 · Build the strict domain leaf (COMPLETE 2026-07-31) · ref:task-contract §2.1.1 · ref:clock-config-secrets §2

builds:
- [x] BE strict schemas and branded ids at every authority boundary
- [x] BE clock, configuration, secrets, paths, and runtime isolation foundations
- [x] PROOF typecheck, lint, unit, architecture, and coverage gates

### 1.2 · Durable authority and workflow model {#p1-authority}
status: done
date: 2026-08-01
size: XL
doc: 01 §1.2 · Durable authority and workflow model · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.4 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §4 · ref:operator-trust §1 · ref:task-contract §2 · ref:task-contract §2.7 · ref:workflow-model §3 · ref:operator-trust §1.7 · ref:dashboard-surfaces §2 · ref:write-safety §2 · ref:clock-config-secrets §4 · ref:clock-config-secrets §6.2

builds:
- [x] BE authority SQLite + backup / doctor / degraded mode / restore interlock
- [x] BE the command family + proof union type shells
- [x] BE semantic UI registry (406 ported selector keys, provenance-pinned) + ucpath / crm / kuali drivers
- [x] BE task contracts (ref task-contract) and the three authoring tiers
- [x] BE workflow DAG, delegation, the completion program (ref workflow-model)
- [ ] BE the builder's `.auth()` override — neither `eager` nor `on-first-use` exists (ref workflow-model §3; needs `duo-lease`)
- [ ] BE `cli stop <workflow>` (ref workflow-model §1.2)
- [ ] FE the `Record<IconName, LucideIcon>` map — nothing renders `descriptor.icon` outside the Explorer wire (ref workflow-model §1.3)
- [ ] BOTH the layer-1 `config/workflow-presentation/` override (ref workflow-model §1.5)
- [ ] BE delete the unreachable `TransactionDryRunPreviewSchema` subject-mismatch arm (ref write-safety §2.1)

needs:
- p1-base

log:
- 2026-08-21 | docs-cohesion 01 | verified at HEAD: migrations pinned by literal digest v1→v15, four branded semantic ids at `src/domain/ids.ts:43-46`, the 21-node type proof present in `tests/types/`. Two corrections the code forced — 1c's OFFLINE restore path was complete, tested and UNREACHABLE from its first day because nothing recorded the runtime-lock snapshot its stopped-system proof derives from (D181, found in 2j, fixed there, recorded here because it is 1c's contract); and 1e's type proof survives while its 5 s / 1 GiB BUDGET does not, so the recorded 0.47 s / 215 MiB is history and not a gate. D144, D214 and D221 amended 1e's checkpoint identity without moving a stored byte · left: §3.2's three unimplemented declaration shapes, the Kuali audit call site, D71's unmeasured budget, D208 rule 1
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §1
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §2 rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

#### 1 · Build durable storage and recovery {#p1b-storage}
status: done
doc: 01 §Task 1 · Build durable storage and recovery (COMPLETE 2026-08-01) · ref:operator-trust §1

builds:
- [x] BE SQLite authority, migrations, backup, doctor, degraded mode, and restore interlock
- [x] BE command and proof union type shells
- [x] PROOF corruption, recovery, and stopped-system constraints

#### 2 · Build store, task, and driver contracts {#p1b-contracts}
status: done
doc: 01 §Task 2 · Build store, task, and driver contracts (COMPLETE 2026-08-01) · ref:task-contract §2

builds:
- [x] BE semantic UI registry and typed system drivers
- [x] BE task/store contracts and authoring tiers
- [x] PROOF selector provenance and contract validation

#### 3 · Build the workflow definition model {#p1b-workflow-model}
status: done
doc: 01 §Task 3 · Build the workflow definition model (COMPLETE 2026-08-01) · ref:workflow-model §3

builds:
- [x] BE workflow DAG, delegation, completion program, and descriptor
- [x] BE compile-time graph and mini-store checks
- [x] PROOF descriptor fingerprints and type-level workflow cases

### 1.3 · Execution kernel and write safety {#p1-kernel}
status: done
date: 2026-08-02 → 03
size: XL
doc: 01 §1.3 · Execution kernel and write safety · ref:workflow-model §1.3 · ref:workflow-model §2 · ref:workflow-model §4 · ref:dashboard-surfaces §2.4 · ref:execution-and-sessions §3 · ref:execution-and-sessions §4 · ref:execution-and-sessions §4.1 · ref:write-safety §3 · ref:operator-trust §2.1 · ref:frontend-backend-integration §3.4 · ref:write-safety §3.3

builds:
- [x] BE the ONE `WORKFLOW_MODULES` composition root
- [x] BE worker loop with claim / heartbeat / CAS, worker-owned browser sessions
- [x] BE start-plan ingress authority (D109), terminal authority (D110/D114), provider admission (D112)
- [x] BE the write sequencer: probe → prepare → binding proof → fence → commit → proof → atomic outbox
- [x] BE login proven by CONTENT, never URL (D120); Duo Autopilot hands-off

needs:
- p1-authority

log:
- 2026-08-29 | D75 authority close | one BFF request-identity checkpoint now derives only the configured solo actor and rejects schema-valid command mismatches before effects; left here: bulk `all-or-none` (D235) and `supersede-active`'s divergent sites
- 2026-08-21 | docs-cohesion 01 | verified at HEAD against `src/control/workflow-registry.ts` and `src/core/{command-kernel,run-executor,worker-loop,write-sequencer,write-recovery}.ts`; all five `[x]` stand. Folded in the two post-Phase-1 decisions that fixed the recovery half without re-opening the contract — D200 (the LEASE is the evidence: a sweep living inside a running worker cannot recover that worker) and a pointer to D218, which is 1g-spine's · left: `requestedBy` stamped and never checked (UNOWNED — no D-number, no `pending-wire-bindings` entry, reachable only with a second actor), the bulk `all-or-none` mode (D235), and `supersede-active`'s three sites giving two answers
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`); this node's status block filled at §2.1
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §2.4 rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 1 · Build registry, workers, and command admission {#p1c-execution}
status: done
doc: 01 §1.3 · Execution kernel and write safety · ref:workflow-model §2 · ref:execution-and-sessions §3

builds:
- [x] BE one workflow-module composition root
- [x] BE queue claim, heartbeat, lease, retry, and terminal transitions
- [x] BE start-plan, provider, and actor admission

#### 2 · Build sequenced write authority {#p1c-write-safety}
status: done
doc: 01 §1.3 · Execution kernel and write safety · ref:write-safety §3

builds:
- [x] BE probe, prepare, binding proof, fence, commit, verification, and outbox sequence
- [x] BE content-proven authenticated sessions and Duo handling
- [x] PROOF no write-capable callback can bypass the sequencer

### 1.4 · Projection, BFF, and operator shell {#p1-spine}
status: done
date: 2026-08-04
size: M
doc: 01 §1.4 · Projection, BFF, and operator shell · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.2 · ref:dashboard-surfaces §9.5.2 · ref:frontend-backend-integration §3 · ref:frontend-backend-integration §6.2 · ref:frontend-backend-integration §6.3 · ref:frontend-backend-integration §7.1 · ref:dashboard-surfaces §1 · ref:frontend-backend-integration §3 · ref:clock-config-secrets §3

builds:
- [x] BE span emission + the one run/queue projection
- [x] BOTH in-process Hono BFF: bootstrap / day / run-detail queries, one typed client, resumable SSE
- [x] FE the exact Person Lookup shell in the approved design system, both themes
- [x] PROOF the Playwright parity lane (a11y + screenshot, ASSERT mode)

needs:
- p1-kernel

log:
- 2026-08-21 | docs-cohesion 01 | all four `[x]` stand, and the parity line stands only BECAUSE of two later fixes recorded in doc 01: D132 (the lane asserted the `.png` and rewrote every `.a11y.yml` unconditionally, so a re-freeze was green by construction, and it served a bundle it never rebuilt) and D187 (every `paper-ink` reference photographed dark since the corpus existed, and the run-detail panel — where the failure record and the receipt live — two pixels wide at every viewport since this item, while the a11y tree reported every word). D218 corrected how the projection is FED: the in-process `onEvent` hook was a single-process assumption, so every run enqueued after the dashboard booted served an empty timeline · left: the notes stream has no emitter, five of six topics have no producer, `span.ended` carries no `verdict`, `src/dashboard/state/` has no cache half, the artifact schemas have no route — each owned in a later node
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §1 rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

#### 1 · Build spans and the shared projection {#p1d-projection}
status: done
doc: 01 §Task 1 · Build spans and the shared projection (COMPLETE 2026-08-04) · ref:dashboard-surfaces §1

builds:
- [x] BE append-only span emission and reducer
- [x] BE one day/run projection for every dashboard consumer
- [x] PROOF cross-process replay and resumable cursor behavior

#### 2 · Build the BFF and first operator shell {#p1d-shell}
status: done
doc: 01 §Task 2 · Build the BFF and first operator shell (COMPLETE 2026-08-04) · ref:frontend-backend-integration §3

builds:
- [x] BOTH bootstrap, day, run-detail, command, and event routes over one typed client
- [x] FE Person Lookup shell in both themes
- [x] PROOF accessibility and screenshot parity

### 1.5 · Live foundation proof {#p1-exit}
status: done
date: D74 · 2026-08-04
doc: 01 §1.5 · Live foundation proof · 01 §Exit criteria · ref:workflow-model §8 · ref:workflow-model §8.1

> Found three presentation defects no fixture could — skipped-arm (D123), terminal duration (D124), accessible-name collision (D126) — all fixed the same day. Open item it left: a dead CRM session cost **262.9 s** to surface → `sessionAcquireMs` (D125).

builds:
- [x] PROOF person-lookup live against real UCPath + CRM, dead-session recovery mid-run, all four parity surfaces from one projection

needs:
- p1-spine

log:
- 2026-08-21 | docs-cohesion 01 | the proof stands and its full record is doc 01 §Exit criteria — run `4ebf7275-0158-49af-a78f-1f37948efb27`, EID `10873698`, terminal `done` at attempt 2, `sleepMs` absent on every task span, projection counts agreeing across all four surfaces. The node's own residual became a decision: 262.9 s to surface a dead CRM session → D125's separate `sessionAcquireMs`. A later correction worth carrying — `describeStalledLanding` is unreachable at the shipped defaults (180 s Duo bound inside a 60 s acquisition envelope), which D244 answers by refusing on Duo's own content in 9.52 s · left: nothing on this node
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

#### 1 · Prove one real workflow on the spine {#p1e-live-proof}
status: done
doc: 01 §1.5 · Live foundation proof · 01 §Exit criteria

builds:
- [x] PROOF Person Lookup against live UCPath and CRM
- [x] PROOF dead-session recovery and terminal completion at attempt two
- [x] PROOF all four surfaces agree from one projection

### 1.6 · Implement canonical run and settings authorities {#p1-authority-implementation}
status: planned
date: after 0.3 (closed 2026-09-04)
size: XL
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §9.2 · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2 · ref:frontend-backend-integration §4

> Implement the exact 0.3 contracts — D330, D331, D332 — without redesigning them. Every task is one supervisor seam bound in doc 01 §1.6 to its files, gate, proofs and deletion test. R04 (0.3 Task 4) ruled the original Tasks 1 and 2 NOT independent as written — both add schema steps and would bump `CURRENT` twice — so the part is re-sliced: Task 1 lands the one serial schema floor, and Tasks 2-1 (run-record service) and 2-2 (settings catalog/root) run as a D328 wave from the master that contains Task 1's merge; the 1.6 coordinator records that base SHA and both worktrees before dispatch. Tasks 3–7 run serially in order. No other pair is a wave.

builds:
- [ ] BE one canonical SQLite-backed run-record service with typed CRUD/CAS lifecycle operations
- [ ] BE one settings catalog and protected `.tracker/settings/` root for every non-provider-key setting
- [ ] BE migrate lifecycle/configuration writers and core runtime consumers; Phase 2.6 owns downstream read models and Phase 3.1 owns Settings UI behavior
- [ ] PROOF upgrade, rollback, recovery, compatibility deletion, and full foundation regression

needs:
- phase0-authority-design-close
- p1-exit

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound every task to one seam/gate/order/proof set/deletion test in doc 01 §1.6; re-sliced into serial floor + wave 2 (`2-1`/`2-2`) + serial 3–7 after the cross-contract review proved the schema coupling · left: the coordinator's `cancel`-of-a-running-run ruling before Task 4 (R04 report, NEEDS COORDINATOR)

#### 1 · Land the schema floor {#p1f-floor}
status: planned
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §2.3

builds:
- [ ] BE one migration `v30 = floor` carrying every D332 schema step (`deleted_runs` ordinals + `ordinal_source` with the re-created trigger, `checkpoint_payloads_never_deleted`, `protected_settings_current`, `authority_upgrades`) and the frozen D290 27/28/29 literals in the same commit as the `CURRENT` bump
- [ ] BE the `#runMigrations` floor gate, the read-only no-migrate open for `storage backup|doctor` and the upgrade preflight, `upgrade-required` on every other door, the `baseline` journal row at D321 regeneration, the `protectedSettingsCurrent` repository
- [ ] PROOF M3 (open half), M9, M21, the `baseline` matrix cell; the `planned` `no-lifecycle-sql-outside-the-adapter` entry

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | node created: the serial floor the wave branches from (doc 01 §1.6 Task 1) · left: everything

#### 2-1 · Implement the canonical run-record service {#p1f-run-store}
status: planned
date: wave 2 peer · branches from the master holding Task 1's merge
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.3 · ref:execution-and-sessions §3

builds:
- [ ] BE `src/core/run-record-service.ts` + the lifecycle repositories: the §D330.5 operation set with named refusals, three-way `read`, ordered `list`, the two-source watermark
- [ ] BE one-transaction first-eligible claim with the full token, claim fence vs. operator CAS, composite terminalize, D308 tree delete behind the tombstone with gate records and `ordinal_source = tombstone`
- [ ] PROOF §D330.11 #1–#23, #25, #26 and P33's claim half over the real service; deletion tests #16 and #25

needs:
- p1f-floor

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | relabelled 2-1 (wave 2 peer) and bound to its seam; owes 25 of §D330.11's 26 proofs (#24 is Task 4's) · left: implementation

#### 2-2 · Implement the settings catalog and protected root {#p1f-settings-store}
status: planned
date: wave 2 peer · branches from the master holding Task 1's merge
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2 · ref:frontend-backend-integration §4

builds:
- [ ] BE one leaf catalog (`src/domain/config/catalog.ts`) and the revisioned `.tracker/settings/` root with two documents, one lock, two CAS arms and write-only protected values
- [ ] BE move username, password, timekeeper identity, local canary inputs, display overrides, timeouts, paths, worker defaults, and all other operator-managed non-provider-key configuration out of `.env`; delete adapters A4 and A5 in this task
- [ ] BE leave only provider API keys in `.env`; keep D324's probed host display as the catalogued default when no override exists; expose protected settings as presence/revision, never plaintext; `manifestVersion` 2 backup write shape
- [ ] PROOF §D331.11 P1–P15, P17–P19, P21–P32, P33 protected half, P34–P39, P41 and M14's schema half; `settings-catalog` guard active; `npm run test:parity` unchanged (A8)

needs:
- p1f-floor

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | relabelled 2-2 (wave 2 peer) and bound to its seam; never edits `migrations.ts` or `authority-database.ts` (Task 1 landed the singleton) · left: implementation

#### 3 · Cut over executor and worker lifecycle writers {#p1f-run-writers}
status: planned
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:workflow-model §4 · ref:execution-and-sessions §3 · ref:frontend-backend-integration §3.4

builds:
- [ ] BE route start/fan-out publication, queue claim, heartbeat, executor transition, retry scheduling, and terminal publication through the run service (`worker-loop`, `worker-sessions`, `worker/compose`, the start surfaces)
- [ ] BE preserve stable run/session ids and append-only evidence links; `span.ended` only after the terminal commit
- [ ] PROOF #4–#7, #9, #10 through the real worker composition; deletion test `worker-loop-writes-only-through-the-service`

needs:
- p1f-run-store

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate/deletion test (doc 01 §1.6 Task 3); serial after wave 2 · left: implementation

#### 4 · Cut over operator run commands and archive/delete writers {#p1f-run-commands}
status: planned
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.3 · ref:operator-trust §5.7

builds:
- [ ] BE route CLI/dashboard start, retry, cancel, rename, archive, relaunch, terminal-only delete/tombstone, bulk, and purge commands through the run service (`command-kernel`, `command-service`, the `cli` run verbs)
- [ ] BE return one typed settlement/conflict vocabulary (`target-deleted` is the one new code) and preserve command actor/version attribution
- [ ] PROOF idempotence, stale CAS, concurrent-worker, archive/relaunch lineage, and D308 deletion semantics through the real kernel; `no-lifecycle-sql-outside-the-adapter` (#24) activated with its `runs-view-has-no-reader` arm in the same commit

needs:
- p1f-run-writers

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate (doc 01 §1.6 Task 4); needs the coordinator's ruling on operator `cancel` of a claimed/running run in §D330.5 before start · left: that ruling, then implementation

#### 5 · Cut over settings mutation and runtime resolution {#p1f-settings-consumers}
status: planned
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4

builds:
- [ ] BE route secure bootstrap, worker composition, browser/login, workflow defaults, and preflight inputs through the catalog and the protected store; dashboard presentation remains 3.1 work (the eight-leaf editor inventory stays served, A8)
- [ ] BE revision/CAS update, validation, restart-required reporting, and protected write-only inputs reach every composition; the worker spawn environment is value-free
- [ ] PROOF P16, P20, P33's composition half, P4 at composition level; deletion test `composition-reads-no-environment-leaf`; `npm run test:parity` unchanged

needs:
- p1f-settings-store

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate/deletion test (doc 01 §1.6 Task 5); serial after Task 4 (shares the composition roots with Task 3) · left: implementation

#### 6 · Prove upgrade, rollback, recovery, and compatibility deletion {#p1f-migration-proof}
status: planned
doc: 01 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §2.5 · ref:operator-trust §1 · ref:guards-and-tests §5.2 · ref:clock-config-secrets §3

builds:
- [ ] BE `cli storage upgrade [--plan] [--json]`: the 15-step preflight requiring an explicit verified `cli storage backup`, prepare/rollback files under the private-file protocol, one exclusive transaction with the journaled settings rewrite and marked protected import, settle, the `authority_upgrades` arms, the closed boot matrix and its `storage-authority` preflight check; no automatic backup cadence
- [ ] PROOF migrate representative current, terminal, archived, and malformed authorities without losing evidence (M1–M27; ordinals backfilled with provenance, orphan gate records journaled, evidence and snapshots byte-identical)
- [ ] PROOF import operator-managed non-provider-key configuration once, retain provider keys in `.env`, preserve derived defaults, and refuse ambiguous duplicates (§D332.S1–S6); the backup READ path widened and the WRITE path recording the observed version
- [ ] BE land A0/A1 with `authority-upgrade-adapters-isolated` active and `authority-upgrade-adapters-retired` + `settings-root-single-pathname` planned for 2.6; delete nothing here — A4/A5 left in 2-2, A0–A3 expire at 2.6, A8 at 3.1; then run the upgrade on the operator's root and announce the `migrated-refused` remove-list

needs:
- p1f-run-commands
- p1f-settings-consumers

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate; the deletion checkbox restated — nothing is deleted in 1.6 Task 6, every adapter's deletion task is named (doc 01 §1.6 Task 6) · left: implementation

#### 7 · Close the rebuilt foundation {#p1f-close}
status: planned
doc: 01 §1.6 · Implement canonical run and settings authorities · 02 §2.6 · 03.1 §Reopened completion tasks

builds:
- [ ] PROOF typecheck, lint, coverage, architecture, manifest, stores-catalog, parity (unchanged), storage-doctor on the upgraded root, and both workflows' T1b live manifests with exact zero write-authority deltas
- [ ] PROOF adversarial review finds no second run/settings lifecycle authority or secret-value leak, and the `no-lifecycle-sql` negative control intact
- [ ] DOCS record the migration and hand 2.6 only verified contracts, the migrated fixture pair, the named adapter deletions (A0/A1 → 2.6 Task 4; A2 + its unit test and A3 → 2.6 Task 3; A8/P40 → 3.1 Task 9-2), residuals, and exact gates

needs:
- p1f-migration-proof

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its gate and its 2.6 handoff list (doc 01 §1.6 Task 7) · left: implementation

## Phase 2 · Prove writes and build the platform tails {#phase-2}
phase: Phase 2
status: planned
when: 08-04 → 08-09 historical · reopened after 1.6 at 2.6
size: XL
chip: 2.1–2.5 evidenced · 2.6 waits for 1.6
doc: 02 §Phase summary · ref:write-safety §3.4
open: yes

> **The historical controlled commit remains MET live (D135):** one real Kuali write on doc `4489`, followed by four platform tails. D326 reopens only 2.6, after 1.6, to migrate and re-prove every downstream tail consumer of run or settings authority.

needs:
- p1f-close

log:
- 2026-09-03 | D326/D327 authority reset | 2.1–2.5 keep their evidence; 2.6 waits for 1.6 and owns downstream migration plus regression proof, not another authority redesign
- 2026-08-21 | docs-cohesion 02 | doc 02 rewritten as-built — the phase reads DONE-with-named-residuals: nine mechanisms with no production caller or delivery path, each attributed to the node that owns the fix, plus four test-lane gaps owned by `{#test-tiers}`; the 23 `_phase: 2_` rounds in `reference/decisions.md` all indexed


### 2.1 · Controlled write proof {#p2-proof}
status: done
date: D128–D135 · 2026-08-04
size: L
doc: 02 §2.1 · Controlled write proof · ref:write-safety §2.1 · ref:write-safety §3 · ref:write-safety §3.1 · ref:write-safety §5 · ref:guards-and-tests §3.6 · ref:frontend-backend-integration §6.4 · ref:write-safety §3.3 · ref:write-safety §3.4 · ref:clock-config-secrets §4.1 · ref:charter §13

> Same-day withdrawal of the wrong D128 conclusion: the two real causes were driver defects in THIS tree (a ~700 ms gadget debounce, a `commit` returning at request time). Write-heavy migration unblocked.

builds:
- [x] BE `kuali/save-timekeeper-annotation` — the one-transaction-node proving workflow
- [x] PROOF fence durable before the click, reload read-back, propagation window measured (`recoveryAbsence: stabilized` — THIS contract only; both UCPath contracts stay `operator-only`, unmeasured)
- [x] BE mutation-capability registry; `write-sequencer.ts` the only mint
- [x] BOTH preview / binding / fenced write / read-back / parked-write resolution through the production client

needs:
- p1-exit

log:
- 2026-08-21 | docs-cohesion 02 | re-verified in the contract file: `recoveryAbsence: stabilized` is `minSinceFenceMs: 30_000` / 2 reads / 5 s apart and is scoped to THIS contract — both UCPath contracts stay `operator-only` because no UCPath window was ever measured, so the `builds:` line is corrected
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)


#### 1 · Build the proving transaction {#p2a-transaction}
status: done
doc: 02 §2.1 · Controlled write proof · ref:write-safety §3

builds:
- [x] BE one minimal Kuali proving transaction under the write sequencer
- [x] PROOF dry run, pre-fence refusal, commit, reload read-back, and idempotent repeat
- [x] PROOF restore the live test documents after verification

#### 2 · Execute and record the controlled proof {#p2a-proof}
status: done
doc: 02 §2.1 · Controlled write proof · ref:write-safety §3.4

builds:
- [x] PROOF dry run, forced mismatch, one controlled commit, reload read-back, and idempotent repeat
- [x] PROOF restore both live test documents and preserve durable evidence ids
- [x] DOCS retain per-workflow controlled proof as a later migration obligation

### 2.2 · Evidence and operator trust {#p2-2g}
status: done
date: D134–D145
size: L
doc: 02 §2.2 · Evidence and operator trust · ref:operator-trust §2 · ref:operator-trust §2.2 · ref:operator-trust §2.3 · ref:operator-trust §4 · ref:operator-trust §6 · ref:operator-trust §6.1 · ref:operator-trust §6.3 · ref:dashboard-surfaces §2.6 · ref:write-safety §6.1 · ref:frontend-backend-integration §6.5 · ref:write-safety §3.1

builds:
- [x] BE schema v10
- [x] BE automatic redacted diagnostic capture
- [x] BE durable actor-keyed notification inbox (row commits before any OS delivery) — 3 of the 8 trigger arms have publishers (D222/D262/A46); five do not
- [x] BE knowledge / fix admission — admission is durable and audited; the PROJECTION has no caller, so no `KNOWLEDGE.md` exists
- [x] BE ordered fsync'd ledger projector — unit-proven and guarded; `createLedgerProjector` has NO production caller, so nothing drains the durable outbox to a file
- [x] BE D82's evidence receipt DERIVED from authority

needs:
- p2-proof

log:
- 2026-08-21 | docs-cohesion 02 | three `[x]` lines sharpened against the code — the ledger projector has no production caller, the knowledge PROJECTION has no caller, and five of seven notification arms have no publisher; `ref:operator-trust §2` and `§6.3` added, `ref:dashboard-surfaces §2.6` already cited and now carries its own status block
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (e6fb6f37) — §2 / §4 / §6 as-built, with the three unreachable halves named in place: `explain failure <fingerprint>` unbuilt, the knowledge projection uncalled, the retention sweep uncalled
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate


#### 1 · Build diagnostics, notifications, and receipts {#p2b-evidence}
status: done
doc: 02 §2.2 · Evidence and operator trust · ref:operator-trust §2 · ref:dashboard-surfaces §2.6

builds:
- [x] BE redacted diagnostic capture and actor-keyed notification inbox
- [x] BE derived evidence receipts and ordered ledger projection contracts
- [x] BE knowledge/fix admission and its audited zero-authority boundary

#### 2 · Derive receipts and wire trust services {#p2b-services}
status: done
doc: 02 §2.2 · Evidence and operator trust · ref:operator-trust §4 · ref:write-safety §6

builds:
- [x] BE derive receipts from authority rather than caller claims
- [x] BE notification, knowledge/fix, and ledger service contracts
- [x] DOCS record missing production producers/projectors under later owners

### 2.3 · Data and intake foundation {#p2-2h}
status: done
date: D146–D167
size: XL
doc: 02 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data §1 · ref:data-intake-and-edit-data §2 · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §6 · ref:frontend-backend-integration §6.6

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
- p2-2g

log:
- 2026-08-21 | docs-cohesion 02 | doc 02 §2h separates unwired-BY-DESIGN (the retention projection, D164) from unwired-by-omission (the saved-mapping store, an artifact-projection-declaring descriptor — both unowned and reported) and from waiting-on-an-admitted-workflow (the start-method kinds and Review surface → `{#migrations}`)
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)


#### 1 · Build canonical intake and Edit Data services {#p2c-intake}
status: done
doc: 02 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data

builds:
- [x] BE field registry, mappings, validation, immutable manifests, and rerun diff
- [x] BE extraction, OCR, roster, normalization, capture-session, and Edit Data cores
- [x] BOTH production routes and live scanner proof

#### 2 · Build extraction and scanner services {#p2c-services}
status: done
doc: 02 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data §3

builds:
- [x] BE extraction, OCR, roster, and normalization stores
- [x] BOTH scanner classification/grouping and real 44-page proof
- [x] PROOF strict producer outputs and artifact identities

#### 3 · Wire providers, artifacts, capture authority, and Edit Data {#p2c-wiring}
status: done
doc: 02 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data §5

builds:
- [x] WIRE executor/worker providers and artifact delivery
- [x] BE durable capture sessions and Edit Data core
- [x] PROOF immutable manifests and rerun-diff behavior

### 2.4 · Operator services and read models {#p2-2i}
status: done
date: D168–D180
size: L
doc: 02 §2.4 · Operator services and read models · ref:operator-trust §1.3 · ref:data-intake-and-edit-data §2.7 · ref:data-intake-and-edit-data §5.1 · ref:data-intake-and-edit-data §5.2 · ref:frontend-backend-integration §6.7 · ref:dashboard-surfaces §9.5.1 · ref:dashboard-surfaces §9.7.1 · ref:dashboard-surfaces §9.7.2 · ref:dashboard-surfaces §9.5.3 · ref:operator-trust §5.7 · ref:operator-trust §5.8 · ref:data-intake-and-edit-data §6.4.1 · ref:charter §25

builds:
- [x] BOTH trust surfaces + notification bell over the durable inbox
- [x] BOTH Edit Data rail (D168)
- [x] BOTH Settings + storage doctor + live backup cadence (D169) — the phase delivered health/doctor; DCC1–DCC3 later added the bounded resolver-owned edit/readback/preflight path — D322 (2026-09-03) retired the automatic cadence: backups are written only by `cli storage backup`
- [x] BOTH intake surface over schema v12 (D170–D173)
- [x] DOCS Mobile/phone Capture Mode was built in this historical phase and is retired by D294; diagnostic screenshots, run Capture tiles, and Archive evidence remain
- [x] BOTH read-only Workflow Explorer + UI catalog
- [x] BOTH AI advisories (redaction / strict-output / exhaustion / zero-authority pinned)
- [x] BOTH archive model (schema v13, UPDATE/DELETE aborted in SQL) + version bump + Activity report (D176–D180)

needs:
- p2-2g
- p2-2h

log:
- 2026-08-21 | docs-cohesion 02 | two `[x]` lines sharpened — Settings is READ-ONLY and the phone capture surface has no delivery path and no declared binding; `ref:operator-trust §1.3` and `ref:data-intake-and-edit-data §2.7 / §5.1 / §5.2` added; the Explorer's overlay and coverage-claims exclusions recorded as DECISIONS, distinct from D186's reassignment
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code (82c8550c) — §2.7 / §5.1 / §5.2 as-built; the phone surface has no production delivery path and `CAPTURE_INTAKE_BINDINGS` is empty, so no workflow can receive a handoff
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)


#### 1 · Build trust, configuration, intake, and archive surfaces {#p2d-operator-services}
status: done
doc: 02 §2.4 · Operator services and read models · ref:operator-trust §1.3 · ref:dashboard-surfaces §9

builds:
- [x] BOTH notification, Edit Data, settings/doctor, intake, Explorer, advisory, archive, version, and Activity services
- [x] DOCS retire mobile Capture Mode without removing diagnostic captures or archive evidence
- [x] PROOF strict schemas and bounded production routes for every delivered service

#### 2 · Build Settings and storage doctor {#p2d-settings-doctor}
status: done
doc: 02 §2.4 · Operator services and read models · ref:clock-config-secrets §3 · ref:operator-trust §1

builds:
- [x] BOTH historical settings/preflight and storage-health/doctor services
- [x] DOCS retain later settings-authority gaps under 0.3/1.6/3.1

#### 3 · Build intake and historical Capture surfaces {#p2d-intake-surfaces}
status: done
doc: 02 §2.4 · Operator services and read models · ref:data-intake-and-edit-data §2.7

builds:
- [x] BOTH intake surface over schema v12
- [x] DOCS retain phone Capture only as history after D294 retirement

#### 4 · Build Explorer, UI catalog, and advisories {#p2d-explorer}
status: done
doc: 02 §2.4 · Operator services and read models · ref:operator-trust §5.9

builds:
- [x] BOTH read-only workflow Explorer and UI catalog
- [x] BOTH redacted, strict-output, exhaustion-bounded, zero-authority advisories

#### 5 · Build archive, version, and Activity surfaces {#p2d-archive-activity}
status: done
doc: 02 §2.4 · Operator services and read models · ref:operator-trust §5.7 · ref:operator-trust §5.8

builds:
- [x] BOTH append-only archive model, version bump, and Activity report
- [x] PROOF historical rows remain immutable and attributable

### 2.5 · Closing verification {#p2-2j}
status: done
date: D181–D190 · 2026-08-09
size: M
doc: 02 §2.5 · Closing verification · ref:workflow-model §1.6.3 · ref:execution-and-sessions §7.1 · ref:guards-and-tests §3.11 · ref:guards-and-tests §3.15 · ref:operator-trust §3 · ref:operator-trust §3.1 · ref:dashboard-surfaces §2.5

> **Found four real defects every earlier green gate missed:** `cli storage restore` could never have worked (D181); every `paper-ink` parity reference had been photographed dark; the run-detail trust panel was **2 px wide** since 1i-spine (D187); the receipt builder 500'd on a reachable path.

builds:
- [x] PROOF scenario corpus + `scenario-coverage` audit — DCC2 composes six dashboard preflight runners, but the declared preflight fault corpus has no executor, so `preflight-coverage` stays `planned` (D188)
- [x] PROOF restore drill on a copy of the real authority DB (corrupt → doctor refuses 0.92 s → restore 0.99 s)
- [x] PROOF 3-worker soak, concurrency matrix, redaction scan
- [x] DOCS capability-inventory validation (D184/D188)
- [x] DOCS every owning doc to as-built

needs:
- p2-2i

log:
- 2026-08-28 | DCC6 closure | DCC2 composes six dashboard preflight runners; the declared fault corpus still has no executor, so `preflight-coverage` remains planned while the component/parity lane, D91 branch half and D85 parts 2–3 stay separately open
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces §2.5 rewritten as-built; status block filled (632ce168)
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code


#### 1 · Run the closing proof ladder {#p2e-close}
status: done
doc: 02 §2.5 · Closing verification · 02 §Exit criteria

builds:
- [x] PROOF scenario coverage, real-copy restore drill, three-worker soak, and redaction scan
- [x] DOCS validate the capability inventory and reconcile owning specifications
- [x] PROOF repair the four defects found only by the closing gate

#### 2 · Prove restore, concurrency, and redaction {#p2e-recovery-proof}
status: done
doc: 02 §2.5 · Closing verification · 02 §Exit criteria

builds:
- [x] PROOF real-copy corrupt/doctor/restore drill
- [x] PROOF three-worker soak and redaction scan

#### 3 · Repair gate-found defects and reconcile owning docs {#p2e-repair}
status: done
doc: 02 §2.5 · Closing verification · 02 §What 2j found, because that is what a gate is for

builds:
- [x] BE repair the unreachable restore, parity-theme, two-pixel panel, and receipt defects
- [x] DOCS reconcile every owning specification to the repaired behavior

#### 4 · Record explicit dispositions {#phase2-dispositions}
status: done
doc: 02 §Task 4 · Record explicit dispositions · ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9

builds:
- [x] DOCS give Explorer authoring and production serving named later owners/triggers
- [x] DOCS retain every residual without mislabeling historical delivery incomplete

### 2.6 · Revalidate tails against canonical authorities {#p2-authority-revalidation}
status: planned
date: after 1.6
size: L
doc: 02 §2.6 · Revalidate tails against canonical authorities · ref:operator-trust · ref:data-intake-and-edit-data · ref:frontend-backend-integration · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5 · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2

> Migrate and prove the downstream read models, joins, and operator services after 1.6 has changed the stores and core writers. This part may expose implementation defects, but any proposed contract redesign returns to 0.3 authority rather than being improvised here.

builds:
- [ ] BOTH every Phase 2 downstream read model, join, and operator service reads run/settings state only through the 1.6 authorities
- [ ] PROOF notification, archive, Activity, Explorer, intake, Edit Data, receipts, captures, doctor, and preflight keep their behavior and evidence
- [ ] PROOF delete stale adapters and demonstrate that no displaced lifecycle/configuration source can affect a response
- [ ] DOCS hand reopened 3.1 stable contracts, representative fixtures, and exact acceptance gates

needs:
- p1f-close
- p2-2j

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330/D331/D332 as landed — `ref:dashboard-surfaces` §9.2 and §2.5, `ref:clock-config-secrets` §3, `ref:guards-and-tests` §5.2 (no redesign) · left: a proposed contract change returns to a newly numbered 0.3 task

#### 1 · Revalidate trust and evidence consumers {#p2f-trust}
status: planned
doc: ref:operator-trust · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.2

builds:
- [ ] BOTH migrate notifications, receipts, failures, captures, logs, gates, and parked-write views
- [ ] PROOF every row remains linked to the canonical run id through retry, archive, and tombstone
- [ ] PROOF notification delivery never races ahead of the durable run-linked inbox row

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.9 evidence linkage by stable `runId`, §D330.2 existence, §D330.8 tombstone (no redesign) · left: the notification inbox row stays run-linked

#### 2 · Revalidate data, intake, and Edit Data consumers {#p2f-data}
status: planned
doc: ref:data-intake-and-edit-data · ref:dashboard-surfaces §9.7 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5 · ref:clock-config-secrets §3

builds:
- [ ] BOTH migrate intake, OCR, Edit Data, manifests, mappings, and capture evidence
- [ ] PROOF existing artifacts remain readable across authority migration and missing links fail loud
- [ ] PROOF no intake/edit path writes run lifecycle or settings state directly

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.9, D331 §D331.8 (one source per leaf) and D332 §D332.7 item 4 (no redesign) · left: no intake or Edit Data path writes settings or a lifecycle row

#### 3 · Revalidate operator read models {#p2f-operator}
status: planned
doc: ref:frontend-backend-integration §6 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5 · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2

builds:
- [ ] BOTH migrate archive, Activity, Explorer, storage doctor, setup/preflight, and generic read models
- [ ] PROOF archive/current/queue counts converge from one run authority under create, update, archive, relaunch, delete, and restore
- [ ] PROOF settings status and preflight resolve from one catalog without returning protected values

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.5 (`read`/`list` are the only lifecycle reads), D331 §D331.6/§D331.11 P16 and D332 §D332.5/§D332.6 (no redesign) · left: adapters A2 and A3 are deleted here with their tests

#### 4 · Run the non-mutating migration and recovery proof {#p2f-proof}
status: planned
doc: 02 §2.6 · Revalidate tails against canonical authorities · ref:operator-trust §1 · ref:guards-and-tests · ref:dashboard-surfaces §2.5 · ref:guards-and-tests §5.2

builds:
- [ ] PROOF run migrated-copy restore, scenario, concurrency, redaction, and direct-authority reconciliation gates
- [ ] PROOF cite historical D135 and perform no second controlled write
- [ ] PROOF displaced sources and compatibility adapters cannot affect a response

needs:
- p2f-trust
- p2f-data
- p2f-operator

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D332 §D332.4 with M17/M22 over a migrated copy and §D332.7 item 6 (no redesign) · left: A0/A1 deleted and their two inventory entries flipped to `active` in that commit

#### 5 · Close tail revalidation and hand fixtures to 3.1 {#p2f-close}
status: planned
doc: 02 §2.6 · Revalidate tails against canonical authorities · 03.1 §Reopened completion tasks · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2

builds:
- [ ] PROOF run targeted suites, full coverage/lint/typecheck, architecture guards, generated checks, and production-route smoke
- [ ] PROOF adversarial review and deletion tests find no stale authority path
- [ ] DOCS issue the 3.1 stable-contract fixture matrix and unresolved-defect ledger; do not silently absorb dashboard work

needs:
- p2f-proof

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D331 §D331.10 and the §D331.5 wire for the handover fixtures (no redesign) · left: P40/A8's eleven parity references are re-frozen at 3.1, not here

### Historical disposition record after 2E
status: never
doc: 02 §Task 4 · Record explicit dispositions · ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9

> Workflow Explorer broad authoring/edit half — D186, trigger: the *second* production workflow whose policy you want to change; D283/DCC4–DCC5 complete existing-workflow authority: label/icon/category hot apply, named unavailable timeline/grouping/notification, strict policy/Edit Data source briefs; new-workflow authoring remains absent · BFF serves no frontend bytes / no working `dashboard:prod` — D189, retained by D294 as an independent local operator-dashboard completion item.

log:
- 2026-08-21 | docs-cohesion 02 | both dispositions written out in doc 02 with their triggers and their shelf owners — D186 → `{#def-explorer-edit}` (04 §Edit a workflow's presentation / policy without a code change), D189 → `{#def-byte-path}` (04 §Run the dashboard without the dev server / use the phone page in production); D79a's trim kept as the standing constraint on whatever the editor becomes
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code


## Phase 3 · Shared platform and acceptance {#phase-3}
phase: Phase 3
status: planned
when: historical work retained · reopened 3.1 after 2.6
size: XL
chip: 3.1 reopened · waits for 2.6
doc: 03.2 §Phase 3 chronology
open: yes

> Phase 3 finishes one shared platform through four ordered parts: **3.1 Shared dashboard**, **3.2 workflow authoring and candidate freeze**, **3.3 controlled acceptance**, and **3.4 Codex and Claude cooperation**. D329 puts every code-changing and read-only acceptance activity before the immutable-candidate write proof. It adds no third workflow.

needs:
- p2f-close

log:
- 2026-09-04 | D329 chronology correction | 3.2 now finishes and freezes workflow authoring before 3.3 performs controlled acceptance; 03a/03b/03c/03d filenames and active 3c-A/3c-B labels are retired
- 2026-09-03 | D326/D327 dashboard reset | 3.1 Tasks 1–7 keep their evidence but no longer close the part; focused Tasks 8 onward own every generic operator journey after 2.6. Parts 3.2–3.4 wait
- 2026-09-03 | D326 decimal hierarchy | 3.1 → 3.2 → 3.3 → 3.4 is now the execution order; one coordinator owns each part, numbered cards are one supervisor session, and parallelism is recorded in the coordinator run plan · left: reopened 3.1, then 3.2–3.4
- 2026-08-20 | docs-cohesion step 5.0 | every node in the tree now carries `doc:` — its phase-doc home section plus the reference specs that own its contracts (`81bf48dd`); `test-tiers` drawn as this phase's testing spine (R10) · left: step 4b's binding guard, then the per-doc rewrites
- 2026-08-20 | docs-cohesion 03b | doc 03b rewritten as-built, all fourteen status blocks filled and the whole separations subtree re-bound to its headings; the phase stands at separations **8 of 9**, step 5 open on a calendar date · left: the three controlled commits from 08-28, then rebuild-ready and close-out
- 2026-08-30 | R2 observed status | supersedes the calendar-only status above: parent `54060ded` passed 341 files / 3,761 tests and 239/239 assert-mode parity; reviewed child `7b05b057` merged `--no-ff` and swept. Assigned `.env`, `.tracker-rebuild` and locks absent; admission smoke exited 1 before runner import or person-field inspection. No fresh subject/S7 observation, rehearsal, exact-run 0/0/0 evidence, approval or write; A2–A5/A8 remain open and R3 obligations remain separate. Evidence: `docs/coordinator/worktree-completion/reports/r2-gates.md`, `r2-p3.md`, `r2-p4.md`, and `docs/migrations/separations.md` §9.32

### 3.1 · Shared dashboard {#dash-defaults}
status: planned
chip: Tasks 1–7 evidenced · Task 8, waves 9–13, Tasks 14–18 wait for 2.6
size: XL
doc: 03.1 §Phase summary · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §6.8 · ref:dashboard-surfaces §1.2

> Historical Tasks 1–7 built and proved important shared seams, but operator review found incomplete and broken generic journeys. Task 8, parallel waves 9–13, and serial Tasks 14–18 reopen the part around those journeys: a real modal-to-queue-to-worker path, one CRUD run authority, one settings authority, reliable date/session/notification/queue controls, and complete logs/archive/explorer/intake/trust surfaces. Workflow-specific content still belongs to 3.2/3.3.

builds:
- [ ] BE the per-run stream topics — five of six declared TopicKeys have no producer, so run detail, logs, review, people and artifact updates arrive by re-read, not by patch (ref frontend-backend-integration §3.5)
- [ ] FE the Session Panel's six unbuilt controls — plan/spawn/pause/resume/refresh/reopen have kernel arms and no button; only Stop is composed
- [ ] BOTH the Review panel kind and the Group People page — both §5 matrix rows have no surface and both section arms are declared-unserved (D184)
- [ ] PROOF the parity corpus reaches Settings and the Session Panel — neither is routable from the lane's AppRoute; keyboard and reduced-motion exist in ONE theme
- [ ] BE producers for the five declared notification triggers that have none — run-failed · subject-mismatch · write-parked · repeating-failure · verified-done (audit C4)
- [ ] BE the `operation` run shape is minted by SOME enqueue path — today every path stamps `single`, so §9's group model (member well, rollup, containment) is presentation over fixtures (audit C2)
- [ ] PROOF T2 dashboard feature scenarios over the DEFAULT surfaces (R10)
- [x] BOTH a backfill-gap notification trigger — the one record that says WE DO NOT KNOW what you missed; an unreplayable historical SSE cursor commits it before replacement snapshot, and the pinned Refusal cannot be filtered/read/snoozed/dismissed (`68dea43a`, fidelity-1 A46)
- [ ] BOTH member-outcome vocabulary on the member wire — the typed outcome word and the Outcome / Detail column-heading switch (fidelity-1 B83, B89)
- [ ] BE per-status member counts on `memberRollup` — the well's six-status tally and a group's `△ N` fold (fidelity-1 B56, B77)
- [ ] BOTH a declared `identifierProjection` so a member line can carry its EID column (fidelity-1 B75, B82)
- [ ] BOTH the row-variant naming layer — per-row doing / why / constraint sentences and the row-type word behind the ⓘ (fidelity-1 B43–B48, B51; Track F's vocabulary-surface question decides whether the catalog is a surface too)
- [ ] BE `facts[]` gains `arrowTo`, `warn` and `fullRow` so a fact chip can show direction, hazard and a full-width line (fidelity-1 B114–B116)
- [ ] BOTH the served roster / People section — `View full list`, the workflow-specific `View all signers` label and the whole drill-in triage table (fidelity-1 B97, B98, B130–B135; the queue half of the Group People page line above)
- [ ] BE the `records[]` extraction stream on the queue wire — the record well, `N of M read`, `N blocked`, per-record glyphs and the arriving line (fidelity-1 B100–B104)
- [ ] BE `reviewRunId` so a packet can chip `OCR Review · {status} ↗` (fidelity-1 B110)
- [ ] BE `extractedCount` so a row can chip `N people` (fidelity-1 B111)
- [ ] BE `groupNoun` so the member-preview line reads as a counted anchor (fidelity-1 B68)
- [ ] BE `StartPlanResponse.planned[]` grows the row's role, destination panel, containment, born-as status and note — the demo's whole `PlanRowCard` anatomy, and the same fields the applied banner's created-rows list reads (fidelity-1 C56, C65)
- [ ] BE `StartPlanResponse` grows the plan's headline, its `warnings[]` and the ratified `decisions[]` its shape obeys — the modal counts `planned.length` because there is nothing else to print (fidelity-1 C55, C58, C59)
- [ ] BOTH the descriptor start-capability projection — operator-variable sub-selections with their option lists, per-option unavailability reasons and visibility conditions; today the only declared sub-selection is a parser CONSTANT, which is locked by definition (fidelity-1 C50, C51)
- [ ] BOTH a human label on `SurfaceField`, so a locked sub-selection names the choice instead of printing the field identifier (`keepNonHdh`) at the operator (fidelity-1 C49)
- [ ] BOTH a declared run-flag list on the descriptor's start surface — each flag with its label and its note — beyond the single DERIVED `supportsDryRun` one hardcoded checkbox stands for (fidelity-1 C85, C86)
- [ ] BE `CommandResult`'s `applied` and `rejected` arms grow a served headline and detail sentence, the settlement clock and the requesting actor; every title on the result banner is client-authored today (fidelity-1 C64, C66, C70)
- [ ] BE the command `conflict` arm grows the contract pair — what the form was built against and what the server now serves — the fact the operator needs to know what moved (fidelity-1 C68)
- [ ] BE the resolved host per `(system, instance)` on `SystemInstancePrimitive`, so Destination names the machine the run is about to touch instead of reassuring the operator (fidelity-1 C91)

needs:
- p2f-close

log:
- 2026-09-04 | D328 parallel task identities | remaining 3.1 work is Task 8, parallel waves 9–13 with numeric members, then serial Tasks 14–18. A label such as `3.1.9-1` is one supervisor task in wave 9; exact branches/worktrees remain bound in doc 03a · left: 2.6 closure, then Task 8
- 2026-09-03 | 3.1 parallel execution plan | coordination `C21194e18` makes `master` integration-only for Tasks 8–32, fixes five dependency-gated parallel waves under the four-worktree limit, and names every task worktree/branch in doc 03a · left: 2.6 closure, then Task 8's ownership matrix before wave 1 dispatch
- 2026-09-03 | D326/D327 reopened scope | Tasks 8–32 supersede the false part closure without invalidating Tasks 1–7 evidence. Each new task is one supervisor session; the final acceptance task audits only and opens focused remediation tasks rather than absorbing broad fixes
- 2026-09-03 | D326 decimal hierarchy | historical 3.1 work is expressed as seven chronological supervisor tasks; `test-tiers` lives in 3.3 where its T1–T3 acceptance work belongs · later workflow-specific Review/People and fidelity deltas remain assigned by D279/D283
- 2026-08-20 | docs-cohesion step 5.0 | `duo-lease` · `parallel-runs` · `observed-logs` drawn under this node (R11/R12 and the operator's observed-logs ruling), each with its own section in doc 03a · left: 5.3a builds the lease, 5.3b the pool and the session view
- 2026-08-20 | docs-cohesion 03a | doc 03a written to the phase-doc contract — every surface verified against `src/dashboard/**` and `src/server/dashboard/**`, four of nine exit criteria MET; two honest gaps recorded rather than assumed built: the run-detail Review and People bodies have no producer (`availableSections` cannot return them) and belong to the OCR and group migrations
- 2026-08-20 | docs-cohesion frontend-backend-integration | ref frontend-backend-integration rewritten as-built; §5.1 split into seven wire squares (5.1.1 run modal … 5.1.7 intake/capture/Edit Data), each separately citable and tagged; §1.1 and §5 gained a Built column · left: the per-run stream topics, the Review and People panel kinds, six Session-Panel controls
- 2026-08-20 | docs-cohesion dashboard-surfaces audit | 109 sections classified (49 done · 32 needs-attention · 15 to-build · 8 superseded · 5 reference); C1–C4 booked as builds: lines; rewrite split into 5.1b/c/d
- 2026-08-21 | docs-cohesion 03a fidelity fold | Track F drawn under this node (the demo-fidelity bar; ~150 OPEN questions as you-lines) and the nineteen `unserved:` wire gaps ledger 1 named booked here as `builds:` lines (A46; B43–B48, B51, B56, B68, B75, B77, B82, B83, B89, B97, B98, B100–B104, B110, B111, B114–B116, B130–B135; C49–C51, C55, C56, C58, C59, C64–C66, C68, C70, C85, C86, C91) — the preflight/doctor pair (A39/A42) already sits on `{#def-settings}`; ledger 3's dash-defaults proposals are all subsumed by Track F's lines · left: the rulings, then the builds
- 2026-08-25 | track-f A46 | `68dea43a` closes fidelity-1 A46: the historical-cursor replay seam commits one deduped backfill-gap row before replacement snapshot; its strict pinned wire arm is filter-immune and command-refused, and reconnect/resnapshot never falsely clears it · left: any future resolved state requires Track F to ratify independent reconciliation evidence
- 2026-08-25 | observed-logs live proof | §9.25 records the already-collected dashboard/composed separations dry run: document 4502, plan `479f9f1e-83b3-4157-915b-2794bcf61ab0`, run `25d90c9d-72bf-4fa4-bcea-116665f22790` / `sp-143516-25d9`, `parked-gate` v52; 13 observed rows (0..12), no notes and 0 / 0 / 0 run-scoped write evidence. The service origin at `separations-2026-08-25.jsonl:12` has no browser system; `17468e60` repaired the resulting false 500 invariant, API 200 and UI omission. `dash-defaults` remains active for its other builds and Track F.

#### 1 · Build the shared dashboard surfaces {#track-b}
status: done
chip: B1–B8 all landed · 08-19 → 20
doc: 03.1 §Task 1 · Build the shared dashboard surfaces · ref:frontend-backend-integration §3.2 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §9.5.1 · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.3 · ref:write-safety §14.11 · ref:operator-trust §5.9 · ref:operator-trust §2.3.5 · ref:operator-trust §2.3.7

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
- [ ] PROOF the per-archived-run storage delta, on the first real sweep (ref dashboard-surfaces §9.5.1)

log:
- 2026-08-20 | docs-cohesion 03a | all eight re-verified present in the tree for doc 03a's status block; the ledger's own README records five open records across two files and zero undecided ones, which is what makes "frontend done" checkable
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### 2 · Prove the dashboard against a real run {#track-c}
status: done
chip: done 08-20 — §9.22 + the five same-day fixes + the ONE re-freeze
doc: 03.1 §Task 2 · Prove the dashboard against a real run · ref:workflow-model §1.1 · ref:dashboard-surfaces §2.3 · ref:frontend-backend-integration §7.1

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
- 2026-08-21 | docs-dash-surfaces 5.1c | §9.1–§9.4, §9.9, §9.10 written as-built (`bbdf59b3`)
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)

#### 3 · Harden shared status, commands, and read budgets {#track-d}
status: done
date: D264 · audit 2026-08-20
chip: D1–D5 + D11 landed · D4/D5 measured · D6–D10 proposed
doc: 03.1 §Task 3 · Harden shared status, commands, and read budgets · ref:frontend-backend-integration §2 · ref:frontend-backend-integration §4 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §7.4 · ref:workflow-model §1.2

> From the 2026-08-20 architecture audit (`docs/plans/2026-08-20-dashboard-architecture-audit.md`). **Verdict: the stack and shape are right; nothing is swapped.** Eleven ordered moves, none a rewrite, sequenced after Track C and before the next workflow leans on the dashboard. **Ruled by D264:** the track sits here under the dashboard defaults; D1–D5 are planned; D6–D10 stay proposed behind one named trigger; and §3.5 is answered — the descriptor registry LEAVES the browser bundle as row D11, amending D251. D4 and D5 double as the FIRST measurement of ref frontend-backend-integration §7.4's performance budgets, whose recorded numbers become the non-regression gates for every later workflow.

builds:
- [x] BE D1 one status/outcome derivation — exported `deriveRunStatus`, ONE task-outcome vocabulary, ONE `panelKindOf`; the detail panel stops disagreeing with the queue row (D268, `81bfed73`; closes C1/C2, part of M3)
- [x] BOTH D2 hygiene — the HTTP status is the error's KIND not its wording (`f39b2e95`), the phone-host gate is WIRED from `capture.ingress: "forwarded"` with a producer guard (`47eeb44e`), two dead hooks and ten dead exports gone (`69102aaf`), the TEST-instance hazard / `plural` / `shortHash` one each (`6d44bb1e`) (closes C3/C4/M7/M8; the D253-sentence half landed with D3, `1b13115f`)
- [x] FE D3 every command settlement folds through `settleCommandResult` — all NINE command-issuing surfaces fold; the guard's second arm requires any module calling `.executeCommand(` to import it (closes C5)
- [x] BOTH D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; MEASURED against the seeded 1,240-row / 108-member fixture and recorded as ref frontend-backend-integration §7.4's first D4 numbers — one SSE row patch `22.30 → 0.02 ms`, `dayWireSchemaParses 1 → 0` (closes P1)
- [x] BE D5 bound the read scans — the member preview slices ids before joining and a row reads its receipt once, the notes reader opens only its run's own `(workflow, date)` partitions, the archive freeze scans once per page walk; measured and recorded in ref frontend-backend-integration §7.4's AFTER table (closes P2/P3/P4)
- [?] FE D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate and `state/` becomes what ref frontend-backend-integration §2 says it is (closes M2)
- [?] FE D7 split `LoadedApp` along its own seams — `useDayRoute`/`useRunDetailState`/`useBulkSelection` into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx` (closes M1)
- [?] BOTH D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, and ONE `foldTaskExecutions(row)` for pipeline / timeline / archive (closes M3/M5/M6)
- [?] FE D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured (closes P5) — still behind its trigger; observed-logs pins the current exact 200-row page without claiming virtualization
- [?] BOTH D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped (closes M4)
- [x] BOTH D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads (`summary`, `enqueue`, `surfaces.inputRun`) on `WorkflowStartWireSchema`, `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import, and `dashboard-wire-boundary` arm (15) refuses any dashboard entry whose closure reaches `src/workflows/**` or `src/control/**` (amends D251; ref frontend-backend-integration §4)
- [ ] BE the write ledger has NO production writer — `createLedgerProjector` is composed nowhere while `createLedgerReadThrough` is composed at two roots; `ledger/` has never been written (ref dashboard-surfaces §9.5.2 · ref write-safety §6.1)
- [ ] BE a production tick that leases and drains the ledger outbox (ref write-safety §6.1)
- [ ] BOTH ledger health as a storage notification per D222, not a banner (ref write-safety §6.1)
- [ ] BE `remove-queue-surface` / `tombstone-queue-surface` have no producer (`src/domain/dashboard/subscription.ts`)
- [ ] BE the stale `SpanPatched` comment in `src/domain/workflow/presentation.ts`
- [ ] BOTH `supersede-active` — kernel implements, planner checks only `reject-active`, the run modal says unimplemented (ref dashboard-surfaces §2.4)
- [ ] BE nothing reads a gate's `subscribes` — a children-terminal / external gate parks forever (`src/base/flow.ts` vs `run-executor.ts`)
- [ ] FE the intake Dropzone's accept list + size cap are client literals; `INTAKE_UPLOAD_MAX_BYTES` / `INTAKE_UPLOAD_MEDIA_TYPES` unimported (ref dashboard-surfaces §9.7.1)
- [ ] FE inspect and upload carry no spinning control (ref dashboard-surfaces §9.7.1)
- [ ] BE the captures wire section is served and placed nowhere; context-evidence fetched and handed to nothing (doc 03.1 finding)

needs:
- track-c
- fact(met): operator ruling 2026-08-20 — D1–D5 planned, D6–D10 proposed, §3.5 → move (D264)

note: D6–D10 are the maintainability slice and carry ONE trigger — they start before the second migration's `Dashboard · wire` task does, and until then they stay proposed; once D1–D5 land they can be dispatched as independent worktree units.

log:
- 2026-08-20 | docs-cohesion step 4a | ratified by D264 — D1–D5 planned, D6–D10 proposed, D11 added (77a0be76)
- 2026-08-20 | docs-cohesion 03a | every one of the eleven rows re-verified UNLANDED at HEAD rather than carried on the audit's say-so, with the file:line of each finding recorded in doc 03a's Track D table (no exported `deriveRunStatus`, two `TASK_OUTCOME` vocabularies, two `panelKindOf` copies, `settleCommandResult` imported by two surfaces, zero `React.memo`, `WORKFLOW_DESCRIPTORS` at `dashboard-app.tsx:25`)
- 2026-08-20 | docs-cohesion frontend-backend-integration | all eleven rows tick in ONE place — ref frontend-backend-integration §7.4's status block, with a per-row map of where each lands; §7.4 records that NOTHING in src/ or tests/ measures any budget it names
- 2026-08-21 | docs-cohesion workflow-model | ref workflow-model rewritten as-built, status blocks filled (`40088de6`)
- 2026-08-21 | track-d D2 | D2 DONE (`f39b2e95`, `47eeb44e`, `69102aaf`, `6d44bb1e`) — the BFF's status mapper stopped reading its own error MESSAGES (three declared kinds in `src/server/failures.ts`, every reachable producer converted, a plain `Error` wearing each retired phrase now a 500 rather than a 404); the phone-host gate is WIRED rather than deleted, because `capture.ingress: "forwarded"` is a producer an operator can set today and deleting the gate would put the scope check in the very slice that opens the door (`capture-durability-and-scope` §2b pins the producer). Two deliberate keeps against the audit's reading: `GET /api/v1/dashboard` (two tests drive it, one the only proof a composed BFF serves a day) and `INTAKE_UPLOAD_MEDIA_TYPES` (a named open wire task). ONE operator-visible change: the receipt's TEST banner no longer uppercases its system names
- 2026-08-21 | track-d5 | D5 DONE (`d6d6c758`, `c1fa129b`, `c74efcca`, `c547f65a`; bounds pinned `4d3247d8`) — all four read scans bounded and BEHAVIOUR-PRESERVING, verified byte-identical over the perf fixture's whole day wire, three neighbouring days, six run details, six logs pages and five archive freezes. Measured against the same seed: day wire 6,718 → 5,568 SQLite statements (the −1,150 decomposes exactly into 940 saved receipt reads + 210 saved preview joins), member-preview delta 216 → 6 and no longer scaling with the member count, logs scope 4 → 2 partitions. The logs row moves only 15 % in LINES because 78 % of this fixture's corpus is on the measured run's own day — what changed is that the read stopped growing with the corpus, which is the bound P3 names. The tests pin the BOUND, not a duration, and the notes reader is proved bounded by a tripwire (unparsable bytes planted in out-of-scope partitions)
- 2026-08-21 | track-d11 | D11 DONE (`149bc5f8` the wire block + server projection + a test driving `buildBootstrap` over the whole registry; `0911becd` the frontend drop + guard arm 15, proved to bite by re-adding the deleted import). The audit's "49 modules for three plain fields" undercounted the cost: the production bundle fell **1,114,214 → 753,197 bytes (32 %)**, `separations` string occurrences 259 → 7. `run-start.tsx` needed no edit — the composed `RunStartWorkflow` is identical field for field, so the whole frontend delta is one deleted import and one read site, and the modal's `?? "reject-active"` default retired with it (it stood in for a fact the server always had). ref frontend-backend-integration §4's ONE named divergence is closed and its §7.4 exit-criterion 2 is MET
- 2026-08-21 | track-d4 | D4 DONE (`345475bf` splice + tests, `bb406615` memo + stable props + guard) — a single-row SSE patch no longer re-validates the whole day: `22.30 → 0.02 ms` median and `dayWireSchemaParses` 1 → 0 over three runs against the same seed, with rows 1/3/4/5 held as an unchanged control so the delta is the change and not the loaded machine. Dropping the parse also gives every untouched row back its REFERENCE, which is the only reason `memo` on `LogPanel` can skip a 2,000-line subtree during a bulk run — the two halves are one change. New guard `dashboard-memo-prop-stability` refuses the five provably-fresh prop shapes, because a `memo` beaten by one fresh prop re-renders as often as before with every gate green. Honest bound recorded in §7.4: the D256 live clock is a prop of all three panels and ticks 1 Hz, so `memo` buys the re-renders BETWEEN ticks; the browser render count is deliberately not taken on a contended laptop and belongs to D9
- 2026-08-21 | track-d3 | D3 DONE (`1b13115f`) — the seven hand-enumerating sites fold; the fold carries the server's own per-arm facts (`message`/`code`/`currentVersion`) beside the composed sentence, so a surface drawing a refusal in its own components stops taking the union apart, and ZERO operator-visible text moved (the parity corpus photographs identity-approve's conflict alert). The guard gains a second arm + fixture (`5c36a82d`): posting through `executeCommand` without importing the fold is now a failure, which the first arm could not see
- 2026-08-25 | 03a reconciliation | Track D's exit scope is DONE: D1–D5 + D11 are landed and held by tests/guards; D4/D5 are measured, and ref frontend-backend-integration §7.4 carries their shared-fixture BEFORE/AFTER numbers. D6–D10 remain proposed behind their trigger and are outside this gate; the additional unchecked findings on this node remain explicitly booked work rather than false completion claims

#### 4 · Close demo fidelity and parity {#track-f}
status: done
date: fidelity re-audit 2026-08-21 · ratified 2026-08-26
size: L
chip: D272–D276 ratified · implementations/proofs open
doc: 03.1 §Task 4 · Close demo fidelity and parity

> The dashboard is a 1:1 detail replica of the legacy rebuild-demo, reviewed glyph by glyph: every element is exact, or a divergence ruled by a D-number / a plan decision / a dated operator call, or unserved by a NAMED producer (a `builds:` line, never a reason to drop the detail), or OPEN in the historical audit — nothing is dismissed or "modified" without a citation. Three ledgers audited exactly 1,956 elements/rows at HEAD on 2026-08-21 (`docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` 489 · `…-2-run-detail.md` 348 · `…-3-standing-surfaces.md` 1,119); a mechanical recount after the current ports, Activity AC24, Explorer EX5 and shell A46 gives 775 exact rows. The six sheets' 49 choices are ratified as D272–D276; ledger 3's 238 OPEN row marks / 30 groups remain historical audit counts, while their resulting implementations and proofs are current work.

builds:
- [x] DOCS D272 ratifies the shell / queue / run-start choices (ledger 1's 37 OPEN rows / 28 questions remain the exact historical audit count)
- [x] DOCS D273 ratifies the run-detail choices (ledger 2's 54 OPEN questions remain the exact historical audit count)
- [x] DOCS D274–D276 ratify the 30 standing-surface groups (ledger 3's 238 OPEN row marks remain the exact historical audit count)
- [x] FE the served-and-dropped facts — receipt/failure, intake, archive, the queue gate age, the run-modal descriptor version, Activity AC24 and Explorer EX5 are complete (doc 03.1 §Served-and-dropped)
- [ ] FE the structural run-detail ports — the failure-record disclosure + write-state block, the focusable timeline segment, the step-group Well, one-owner `dataExpanded`, the grouped log stream
- [ ] FE the vocabulary sweep — implement D272–D276's required demo wording and named truthful exceptions (ledgers 1–3)
- [x] DOCS the stale claims in code and docs corrected (`receipt.tsx` header, `archive.tsx` comments, `findings/queue-rows.md:221`, `ref operator-trust` §5.7, `explorer.tsx:8-10`, `DESIGN.md`)
- [x] BOTH A46's exact-generation unreplayable-history trigger, stable no-churn permanent fact, authority-immutable Refusal and reachable 6+ pin mobile lane (`68dea43a`, `e108ff3f`, `a2d2a8e8`; fidelity ledger 1 A46)
- [ ] BE the receipt's action evidence carries what proved the write (ledger 2 D16–D22)
- [x] BOTH a diagnostic bundle is readable — exact-id D137 readback plus `BundleDialog` and server manifest download (ledger 2 E28/E29)
- [x] BOTH the intake manifest + rerun-diff surface — terminal and preflight identities, manifest projection and rerun diff are fixture-rendered in exact local pages with full compact values keyboard/touch reachable; this does not claim D9, D274/D276's IN137/IN138/IN144 presentation ports remain open, and no parity reference was re-frozen (ledger 3 IN123–IN143)
- [ ] PROOF the parity corpus re-frozen once over every change, with the three missing scenes (Settings · the version-bump dialog · a DS specimen page)

needs:
- track-d

log:
- 2026-08-21 | docs-cohesion 03a fidelity fold | node drawn from the three 2026-08-21 ledgers; doc 03a §Demo fidelity carries the per-region table, every OPEN question as one line, the served-and-dropped list and the stale-claims table · left: the operator's rulings, then every FE / BE / BOTH / PROOF line above
- 2026-08-25 | track-f archive UI + Activity AC24 | `3d461962` served frozen list warnings/rehearsal state; `d1f87916` drew those and the already-served archive identity, priority, bump-kind, relaunch and enum facts through total folds; `4da19fd7` closes Activity's raw `blocked` caveat with the shared wire→display status fold. Ledger 3 remains 346/1,119 exact with 248 OPEN marks. Before/after screenshots were taken without `PARITY_UPDATE` · left in this unit: Explorer EX5 and every other non-archive served-and-dropped fact
- 2026-08-25 | track-f Explorer EX5 | `4e09fb49` restores the demo's ghost `Version registry` action with its `Eye` icon; it clears the Explorer takeover and opens Archive's actual `Versions & bumps` view through `?archive=&archiveView=versions`. The browser test proves the exact search state, direct deep-link and Back/Forward restoration against the pressed view and real `Workflow version registry` table; no parity reference was re-frozen. A mechanical recount of ledger 3's current rows gives 353/1,119 exact with 238 OPEN marks · left: every non-archive served-and-dropped fact
- 2026-08-25 | track-f A46 adversarial correction | `e108ff3f` separates cross-generation restart/rebuild from real missed history, stabilises interval identity across reason aging/head movement and process restart, single-flights concurrent clients, refuses every authority mutation/fold, and restarts an atomically captured handshake if publication moves the projection; `a2d2a8e8` keeps 6+ pins, ordinary rows and fixed filters reachable at 390×844 with truthful Pings counts and a 44px bell. A46 stays exact, so ledger 1 remains 132/178 and the three-ledger total remains 775/1,956 exact. Production-bundle mobile proof passed; no parity reference was re-frozen.
- 2026-08-26 | track-f ratification | D272–D276 answer all 49 choices; this node is implementation-owned. Left: the resulting FE / BE / BOTH / PROOF rows and one deliberate parity re-freeze; no operator decision remains.

#### 5 · Serialize Duo login ceremonies {#duo-lease}
status: done
date: R12 · 2026-08-20
size: S
chip: D267 landed · live generations 3 → 4 serialized
doc: 03.1 §Task 5 · Serialize Duo login ceremonies · ref:execution-and-sessions §4.1 · ref:execution-and-sessions §4.2 · ref:execution-and-sessions §10

> A durable per-credential lease in authority serializes EVERY Duo ceremony — from "navigate to SSO" until the content verifier proves the session — across every worker and every system. TTL is `sessionAcquireMs` + grace; waiters are bounded and refuse loud naming the holder; a refused assertion poison-closes and retries ONCE under the same lease on a FRESH profile, then fails naming the profile; `defineVerifiedLoginRecipe` takes a lease token only the lease store mints, pinned by a guard with a violating fixture. The hazard exists TODAY — two workflows' workers cold-starting together share one credential's server-side counter (D243).

builds:
- [x] BE `duo_ceremony_leases` in authority + the lease token `defineVerifiedLoginRecipe` requires + the grace config leaf `timeouts.duoCeremonyLeaseGraceMs` (D267, `bfc7d318`, `cb7f17f8`)
- [x] BE bounded waiters + the fresh-profile-once recovery, both failing by name (`cb7f17f8`)
- [x] BE the guard: no login path without the lease, with a violating fixture (`37e747f0`)
- [x] PROOF two workers' cold starts serialize — unit (`1c244a40`) + the LIVE two-worker cold start (2026-08-21) + the ref execution-and-sessions §7.1 concurrency-matrix row
- [x] DOCS the decision in `reference/execution-and-sessions` + `reference/decisions` (D267)

needs:
- track-f

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Duo ceremony lease written; verified UNBUILT at HEAD — nothing named `duo_ceremony_leases` exists in `src/` and `defineVerifiedLoginRecipe` (`src/infra/browser/authenticated-application.ts:159`) takes system + verify + flow and no lease token; `doc:` tightened to ref execution-and-sessions §4.1 and §4.2
- 2026-08-21 | docs-cohesion execution-and-sessions | §10 (the lease) and §11 (sessions) are the owning contracts (`fed795e1`)
- 2026-08-21 | duo-lease E2 | PROOF closed live: two cold workers (`live-a` / `live-b`) on ONE credential serialized their Duo ceremonies — generation 3 released 20:49:58.033Z, generation 4 acquired 20:49:58.261Z, both `logged-in`, zero waiter refusals; ref execution-and-sessions §10 §Live proof is the record. The four BE / DOCS lines above landed in E1 (`bfc7d318` · `cb7f17f8` · `37e747f0` · `1c244a40`) and are ticked in doc 03a and ref execution-and-sessions §10; ticking them HERE and moving this node's `status:` is the plan owner's pass

#### 6 · Manage worker pools and run sessions {#parallel-runs}
status: done
date: R11 · 2026-08-20
size: L
doc: 03.1 §Task 6 · Manage worker pools and run sessions · ref:execution-and-sessions §1 · ref:execution-and-sessions §3 · ref:execution-and-sessions §7.1 · ref:execution-and-sessions §11

> A SESSION is a dashboard-started group of N runs. Every workflow follows the same browser-profile recipe and every worker owns its own profile INSTANCE (doc 05's `(worker, system, instance, configFingerprint)` partition); N workers per workflow, spawned and stopped from the dashboard. Sessions never share information and workers never message each other — they know what the others are doing through AUTHORITY only: run claims, session leases, write fences, the concurrency matrix. The dashboard shows the session and what each of its workers is doing.

builds:
- [ ] BE worker pool — N workers per workflow, spawned and stopped from the dashboard (the kernel command arms exist and are validated; `createDashboardWorkerSupervisor` refuses spawn BY NAME today)
- [x] BE the projection serves a worker-POOL version — `worker_pools` (schema v17) is the CAS basis `spawn-worker`/`plan-worker-count` cite (`expectedVersion` = the pool row's version, 0 for an unplanned workflow), refused by name when stale; the day wire serves `workerPools[]` (`93b7b18e` · `b4f30ea0` · `24b04dfa`, D269)
- [x] BE durable session record + grouping — `run_sessions` (insert-only, member-less) written by every fan-out before its first member; membership is the run row's `sessionId`; a retry inherits; the queue row serves `session` (`93b7b18e` · `57f2bb9c` · `24b04dfa`, D269)
- [x] FE session view — worker cards show authority membership and what each worker is doing; groups exact queue-row session ids, joins the claiming card by exact `runId`, preserves absent reasons and distinguishes declared pool size from non-terminal authority worker cards (`97a55b07`)
- [ ] PROOF two separations dry-run scenarios in parallel, recorded
- [x] BE pool-indexed worker ids — required CLI positive pool index → stable `<workflow>-worker-<index>` identity → authority lease; distinct indices retain distinct leases and duplicate ownership is refused (`src/core/worker-loop.ts`, `src/server/worker/compose.ts`)

needs:
- duo-lease

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Parallel runs written; one `builds:` line ADDED from reading the code — the pool version is a prerequisite of the spawn control, not a detail of it (`src/dashboard/surfaces/shell.tsx:1036` states the CAS reason the demo's `+` is absent); `doc:` tightened to ref execution-and-sessions §1, §3 and §7.1
- 2026-08-21 | docs-cohesion execution-and-sessions | §10 (the lease) and §11 (sessions) are the owning contracts (`fed795e1`)
- 2026-08-21 | parallel-runs P12 | the AUTHORITY half built (D269): schema v17 `worker_pools` + `run_sessions` + `tasks.session_id` (`93b7b18e`), the pool CAS in the kernel (`b4f30ea0`), the session written at every fan-out and inherited by retry (`57f2bb9c`), the wire's `workerPools[]` + row `session` (`24b04dfa`); left: the pool PROCESS (spawn + pool-indexed ids), the FE session view, the parallel PROOF
- 2026-08-25 | parallel-runs P3 | pool-indexed identity built: `worker <workflow> --pool-index N` requires and validates a positive N, then composition carries the derived id through the loop and authority lease. Index 2 retains its own lease; duplicate N hits the existing lease collision. Left: the real dashboard process supervisor, FE session view and parallel proof
- 2026-08-25 | parallel-runs P3 review | worker admission is per-start and strictly aggregated into D181's restore arm; singleton admission is atomic (16 synchronized processes admit one), ownership binds PID to OS process birth, and exclusive restore admission spans staged-byte verification through swap. Pool supervision, FE and parallel proof remain unbuilt
- 2026-08-25 | parallel-runs P4 | the FE session view reads only the D269 day wire (`97a55b07`): exact present `QueueSurface.session.sessionId` groups membership, exact `WorkerCard.currentRun.runId` joins a worker, and the absent arm preserves its served reason; the add-workers control remains absent because the supervisor refuses its process effect, not because the pool CAS version is unavailable

#### 7 · Record observed page facts {#observed-logs}
status: done
date: operator 2026-08-20
size: M
doc: 03.1 §Task 7 · Record observed page facts · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.1 · ref:operator-trust §2.3

> The log stream quotes the facts each task RECORDED — the provenance points: field, value, direction, observed-at, with the SYSTEM resolved through `dataOrigins` rather than carried on the point (D252/D106) — redacted by the declared evidence classification, and never a second scrape. Transaction roles preserve each call's observation instant; probe/prepare/verify stream synchronously, while commit flushes after callback settlement so instrumentation cannot interrupt fence→click. The log emission path and the log structure are rebuilt around recorded observations; the scope may widen when the operator reviews phase 3a.

builds:
- [ ] BE the notes stream gets a production emitter — `emitNote` is composed and never called; `.tracker-rebuild/notes/` does not exist, while the Logs section re-reads it per request and a failed run opens on it (audit C1)
- [x] BE provenance points captured at record time and redacted by declaration; commit delivery is deferred past callback settlement for fence→click safety (an unclassified leaf fails loud) — D270
- [x] BE transaction beats stream their observations (probe → stage → fence → click → read-back)
- [x] BE L3 strict Logs row wire/query — bounded note partitions + append-time per-run span index, immutable combined snapshots, exact `(nodeId,taskId)` system resolution and archive read-forward
- [x] FE the log panel renders combined note / observed / authority-fence rows per producer, in the Context rail's vocabulary; immutable cursor pages are owned by exact run+cursor+snapshot, stale responses cannot disturb the current request, and a fence carries no invented observation facts
- [x] PROOF a separations dry run reads as a ledger of page facts — document 4502, plan `479f9f1e-83b3-4157-915b-2794bcf61ab0`, run `25d90c9d-72bf-4fa4-bcea-116665f22790` / `sp-143516-25d9`; 13 observed rows (0..12), no notes and zero write evidence (doc 03a / separations §9.25)
- [ ] BOTH the demo's unserved general line kinds and duration (fidelity-2 B69–B75): observed facts, attempts and pill search are rendered, but `pause`/nav/search/ok/event and duration have no producer
- [ ] FE the `pause` line's own row tint, once a line carries its kind (fidelity-2 B71)
- [ ] BE the timeline hover card's `System` row and its key lines — the same provenance points this node emits, read one level up (fidelity-2 B52, B54)

needs:
- parallel-runs

log:
- 2026-08-20 | docs-cohesion 03a | doc 03a §Observed logs written; the emission is a real build, not a re-read — `finalizeRead` validates the recorded points and the executor stores only `provenance` plus the parsed output (`src/core/task-provenance.ts:264`, `src/core/run-executor.ts:1052`), and `DataPoint` carries `direction` natively but NO system, which the store's declaration owns (D252/D106)
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion 03a fidelity fold | the demo's log-line anatomy booked here from ledger 2 (B52, B54, B69–B75, B78) — the line carries its own facts, which is what this node emits; the stream's GROUPING by step (B65) is a pure FE port today and sits on `{#track-f}` · left: all of it
- 2026-08-21 | D270 | the EMISSION half landed — a twelfth span arm `data.observed`, one event per `ctx.recordData` call, redacted per leaf through the receipt's own declared table, an undeclared leaf failing the recording task by name, and the queue projection ignoring the arm by name (`ef090ea4` `68954117` `4d074886` `aabd46f4`). The channel is the SPAN stream, so the notes-emitter row is untouched · left: the transaction beats, the FE rows, the proof
- 2026-08-25 | observed-logs L2 | transaction probe/prepare/commit/verify roles now own explicit spans and declared observations; `transaction.fenced` is a strict kernel arm, commit call-time batches flush fence-first after callback settlement to keep fallible emission out of fence→click, and dry-run reports only probe + prepare · left: the FE rows and proof
- 2026-08-25 | observed-logs L3 repair | notes retain the shared bounded producer scope; observed/fenced spans are indexed by the append-time disk-tail projection with source file/line, authority-bound workflow/trace/attempt, and immutable `lc:` page snapshots. Real transaction origins cover probe/prepare/commit/verify; generation 5 requires combined logs while 1–4 read forward. §7.4 measures 7,662 rejected-scope span parses → 0 per GET · left: FE rendering and live proof
- 2026-08-25 | observed-logs FE | strict note / observed / fence rows now fold in server sequence order under contiguous producer headings; observations use the Context rail’s system/direction vocabulary and redacted value pills, while authority fences deliberately draw no system, direction or page fact. Cursor pages append immutably; targeted production-bundle desktop/mobile proof covers grouping, search/focus, pagination, fence absence and containment · left: live separations proof
- 2026-08-25 | observed-logs FE adversarial repair | exact run+cursor+snapshot ownership ignores a delayed stale continuation without changing current rows/loading/error; live notes-only pages fail with run+cursor; ARIA names served observation system/directions and no fence defaults; computed read/write token assertions, named server errors, 44×44 mobile continuation geometry and the complete/searchable/no-eager-fetch 200-row bound are pinned. D9 still owns the triggered shared queue/log/archive virtualization primitive; this node claims none · left: live separations proof
- 2026-08-25 | observed-logs live proof | §9.25 records the dashboard/composed run: document 4502, plan `479f9f1e-83b3-4157-915b-2794bcf61ab0`, run `25d90c9d-72bf-4fa4-bcea-116665f22790` / `sp-143516-25d9`, `parked-gate` v52; 13 observed rows in sequences 0..12, no notes and 0 / 0 / 0 run-scoped write evidence. The service-origin row at `separations-2026-08-25.jsonl:12` has no browser-system declaration; `17468e60` repaired the false API-500 invariant, so the API answered 200 and UI omitted the system claim. Processes and browser sessions stopped after collection · left: notes emitter and fidelity extras

#### 8 · Re-baseline dashboard truth and acceptance {#dash-truth-reset}
status: planned
date: serial gate 0 · worktree r08-truth-reset
doc: 03.1 §Task 8 · Re-baseline dashboard truth and acceptance · ref:dashboard-surfaces · ref:frontend-backend-integration

builds:
- [ ] PROOF inventory every visible control, route, served field, command arm, producer, and current defect against production code
- [ ] DOCS map each generic operator journey to one owner, red/green gate, fixture, live proof need, later workflow-specific boundary, and non-overlapping wave file/artifact scope
- [ ] DOCS turn every historical unchecked 3.1 line into a current task, explicit disposition, or superseded record
- [ ] PROOF publish the acceptance matrix that Task 18 will execute unchanged

log:
- 2026-09-03 | 3.1 parallel execution plan | serial prerequisite in `phase-3-1-dashboard-c21194e18-r08-truth-reset`; it must merge before any implementation wave and freeze the file/artifact ownership that makes peers independent · left: execute after 2.6 closes

#### 9-1 · Finish the shell, navigation, and accessibility baseline {#dash-shell}
status: planned
date: parallel wave 9 · worktree r09-1-shell
doc: 03.1 §Task 9-1 · Finish the shell, navigation, and accessibility baseline · ref:dashboard-surfaces §3 · ref:frontend-backend-integration §7

builds:
- [ ] FE finish top bar, workflow rail, route state, status/help/theme controls, responsive containment, and empty/error states
- [ ] FE make every action keyboard/touch reachable with truthful names, focus return, reduced motion, and both-theme contrast
- [ ] PROOF component plus production-bundle desktop/mobile accessibility and parity coverage

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 1 frame seam in `phase-3-1-dashboard-c21194e18-r09-shell`, parallel with Tasks 11, 13 and 25 · left: Task 8 ownership freeze

#### 9-2 · Finish Settings over the canonical settings authority {#dash-settings}
status: planned
date: parallel wave 9 · worktree r09-2-settings
doc: 03.1 §Task 9-2 · Finish Settings over the canonical settings authority · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4 · ref:guards-and-tests §5.2

builds:
- [ ] BOTH render every catalog leaf in one Settings information architecture with source, validity, editability, sensitivity, and restart scope
- [ ] BOTH support revisioned edit/save/conflict/reset flows; protected values are write-only and display presence, never plaintext
- [ ] PROOF invalid, stale, partial, interrupted, restart-required, and redaction paths against persisted readback

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 1 settings seam in `phase-3-1-dashboard-c21194e18-r11-settings`, parallel with Tasks 9, 13 and 25 · left: Task 8 ownership freeze
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D331 §D331.10 edit contract, §D331.5's two CAS arms and §D331.6 presence readback (no redesign) · left: the deliberate P40/A8 parity re-freeze happens here

#### 9-3 · Finish storage doctor, backup, and recovery controls {#dash-storage}
status: planned
date: parallel wave 9 · worktree r09-3-storage
doc: 03.1 §Task 9-3 · Finish storage doctor, backup, and recovery controls · ref:operator-trust §1 · ref:frontend-backend-integration §6 · ref:dashboard-surfaces §2.5

builds:
- [ ] BOTH expose health, doctor evidence, backup creation, restore admission, degradation, and actionable refusals without overstating safety
- [ ] BOTH keep destructive/recovery commands revision-bound and stopped-system gated
- [ ] PROOF corrupt-copy doctor, verified backup/restore, interrupted recovery, stale command, and settings/run consistency cases

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 1 storage seam in `phase-3-1-dashboard-c21194e18-r13-storage`, parallel with Tasks 9, 11 and 25 · left: Task 8 ownership freeze
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D332 §D332.1 (`cli storage upgrade` as a fourth subcommand), §D332.6 verdicts, §D332.5 journal and §D332.4 restore admission (no redesign) · left: D322 explicit-only backup stands

#### 9-4 · Finish Workflow Explorer and catalog editing {#dash-explorer}
status: planned
date: parallel wave 9 · worktree r09-4-explorer
doc: 03.1 §Task 9-4 · Finish Workflow Explorer and catalog editing · ref:workflow-model §1 · ref:operator-trust §5.9

builds:
- [ ] BOTH show the compiled graph, tasks, stores, fields, origins, selectors, conditions, omissions, presentation, versions, and scenario source authority
- [ ] BOTH support allowed presentation/policy edits through validated overlays with preview, diff, versioning, hot-apply/restart truth, and rollback
- [ ] PROOF invalid/cyclic/stale overlays, generated-manifest drift, version bump, reload, and clean-context authoring guidance

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 1 Explorer/catalog seam in `phase-3-1-dashboard-c21194e18-r25-explorer`, parallel with Tasks 9, 11 and 13 · left: Task 8 ownership freeze

#### 10-1 · Repair date navigation and the date picker {#dash-date-navigation}
status: planned
date: parallel wave 10 · worktree r10-1-date-navigation
doc: 03.1 §Task 10-1 · Repair date navigation and the date picker · ref:clock-config-secrets §1 · ref:dashboard-surfaces §3

builds:
- [ ] BOTH make selected date, URL, loaded day snapshot, timezone, Today, next/previous, keyboard input, and browser history one coherent state machine
- [ ] FE handle month/year boundaries, invalid input, loading races, disabled dates, focus/escape/outside-click, and mobile geometry
- [ ] PROOF timezone/DST matrix plus browser tests for direct links, rapid changes, refresh, Back/Forward, and stale-response rejection

needs:
- dash-shell

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 2 date-state seam in `phase-3-1-dashboard-c21194e18-r10-date-navigation`, after the shell contract and parallel with Tasks 14, 17 and 26 · left: Tasks 8 and 9

#### 10-2 · Finish sessions, worker pools, and browser lifecycle {#dash-sessions}
status: planned
date: parallel wave 10 · worktree r10-2-sessions
doc: 03.1 §Task 10-2 · Finish sessions, worker pools, and browser lifecycle · ref:execution-and-sessions §3 · ref:execution-and-sessions §11

builds:
- [ ] BOTH make plan/spawn/pause/resume/stop/refresh/reopen controls execute real worker-supervisor effects
- [ ] BOTH show durable session membership, worker state, current claim, browser profile instance, health, and refusal reason without inference
- [ ] PROOF crash/restart, stale CAS, duplicate ownership, pool resize, orphan cleanup, and two-run parallel dry-run behavior

needs:
- dash-settings
- dash-storage

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 2 session/runtime seam in `phase-3-1-dashboard-c21194e18-r14-sessions`, after Tasks 11 and 13 and parallel with Tasks 10, 17 and 26 · left: wave 1 integration

#### 10-3 · Finish notifications and delivery behavior {#dash-notifications}
status: planned
date: parallel wave 10 · worktree r10-3-notifications
doc: 03.1 §Task 10-3 · Finish notifications and delivery behavior · ref:operator-trust §4 · ref:dashboard-surfaces §2.6

builds:
- [ ] BE publish every declared trigger, including run-failed, subject-mismatch, write-parked, repeating-failure, verified-done, storage, and backfill-gap
- [ ] BOTH implement pinned/read/snooze/dismiss/filter/open-target behavior from durable actor-keyed rows
- [ ] PROOF row-before-OS-delivery, dedupe, restart, reconnect-gap, permission-denied, stale command, and target-link cases

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 2 notification seam in `phase-3-1-dashboard-c21194e18-r17-notifications`, parallel with Tasks 10, 14 and 26 · left: Task 8 ownership freeze

#### 10-4 · Finish Intake and Edit Data surfaces {#dash-intake-edit}
status: planned
date: parallel wave 10 · worktree r10-4-intake-edit
doc: 03.1 §Task 10-4 · Finish Intake and Edit Data surfaces · ref:data-intake-and-edit-data · ref:frontend-backend-integration §5.1

builds:
- [ ] BOTH complete upload/classify/OCR/map/validate/reject/prepare/manifest/rerun-diff and Edit Data flows over existing services
- [ ] BOTH show producer progress, records, blocked reasons, mappings, validation, provenance, and exact workflow handoff availability
- [ ] PROOF real representative files plus malformed, partial, canceled, stale, redacted, duplicate, and archived cases

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 2 Intake/Edit Data seam in `phase-3-1-dashboard-c21194e18-r26-intake-edit`, parallel with Tasks 10, 14 and 17 · left: Task 8 ownership freeze

#### 11-1 · Finish Setup and preflight {#dash-setup}
status: planned
date: parallel wave 11 · worktree r11-1-setup
doc: 03.1 §Task 11-1 · Finish Setup and preflight · ref:frontend-backend-integration §5.1 · ref:operator-trust §3 · ref:clock-config-secrets §3

builds:
- [ ] BOTH derive setup state from the settings catalog, storage, workers, browsers, and workflow prerequisites
- [ ] BOTH make every fix action real, idempotent, attributable, and followed by authoritative re-check
- [ ] PROOF execute the declared preflight fault corpus and restart/recovery cases from a fresh local state root

needs:
- dash-settings
- dash-storage
- dash-sessions

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 3 composed-preflight seam in `phase-3-1-dashboard-c21194e18-r12-setup`, parallel with Tasks 15 and 23 only after settings, storage and sessions merge · left: Tasks 11, 13 and 14
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D331 §D331.10 and §D331.11 P16 (no redesign) · left: the first post-upgrade boot's `migrated-refused { key }` is a setup fault with the `.env` remove-list (§D332.S5)

#### 11-2 · Make the Run modal enqueue and start real work {#dash-run-modal}
status: planned
date: parallel wave 11 · worktree r11-2-run-start
doc: 03.1 §Task 11-2 · Make the Run modal enqueue and start real work · ref:workflow-model §4 · ref:frontend-backend-integration §5.1.1 · ref:dashboard-surfaces §9.2

builds:
- [ ] BOTH plan against the served descriptor, validate exact inputs/options, and submit one authoritative start command
- [ ] BOTH create rows in the selected workflow's queue and let the first eligible row be claimed automatically when an eligible worker is available
- [ ] BOTH show created rows, warnings, decisions, conflicts, actor, settlement time, and unavailable-worker state from the server response
- [ ] PROOF single, batch, dry-run, validation, conflict, no-worker, delayed-worker, reload, and exactly-once enqueue/claim paths

needs:
- dash-sessions

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 3 run-start seam in `phase-3-1-dashboard-c21194e18-r15-run-start`, parallel with Tasks 12 and 23 after the session supervisor is real · left: Task 14
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.5 `create`, §D330.6 first-eligible claim in one transaction with `runtime-stale`, and §D330.4's served `version` as the one CAS token (no redesign) · left: a bulk start is D235's N children and one vector

#### 11-3 · Finish Archive, versions, relaunch, and deletion {#dash-archive}
status: planned
date: parallel wave 11 · worktree r11-3-archive
doc: 03.1 §Task 11-3 · Finish Archive, versions, relaunch, and deletion · ref:dashboard-surfaces §9.5 · ref:operator-trust §5.7 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5

builds:
- [ ] BOTH derive terminal/archive/tombstone lists and frozen sections from the same canonical run authority
- [ ] BOTH implement view, compare, version bump, export, relaunch, archive, and delete with explicit evidence-retention results
- [ ] PROOF historical-generation read-forward, stale commands, relaunch lineage, storage delta, delete idempotence, and current/archive convergence

needs:
- dash-truth-reset

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 3 Archive seam in `phase-3-1-dashboard-c21194e18-r23-archive`, parallel with Tasks 12 and 15 · left: Task 8 ownership freeze
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.8 (archive, `delete-archived-run` citing `contentDigest`), §D330.7 relaunch as a fresh run with archive lineage, and D332 §D332.7 item 7 (no redesign) · left: archive visibility is unchanged across the upgrade

#### 12-1 · Finish queue rows, commands, and deletion {#dash-queue}
status: planned
date: parallel wave 12 · worktree r12-1-queue
doc: 03.1 §Task 12-1 · Finish queue rows, commands, and deletion · ref:dashboard-surfaces §4 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §9.2

builds:
- [ ] BOTH render ordering, status, identity, session, worker, progress, outcome, constraints, evidence, and group/member facts from the canonical run record
- [ ] BOTH make retry/cancel/rename/archive/relaunch/delete/bulk commands real, revision-bound, and reconciled to one response vocabulary
- [ ] BOTH define delete as an idempotent lifecycle/tombstone operation with explicit evidence-retention and visible result
- [ ] PROOF command matrix, stale conflicts, double-clicks, concurrent worker transitions, and queue/current/archive convergence

needs:
- dash-run-modal

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 4 queue seam in `phase-3-1-dashboard-c21194e18-r16-queue`, parallel with Tasks 18, 24 and 30 after authoritative start exists · left: Task 15
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.5 row facts, §D330.6 `list` order and §D330.8 delete plus tombstone (no redesign) · left: this task owns the two R01 residues — producing the `remove-queue-surface` / `tombstone-queue-surface` wire events, and reconciling the two projector outcome enums that disagree on `skipped`

#### 12-2 · Finish run detail and the live timeline {#dash-run-detail}
status: planned
date: parallel wave 12 · worktree r12-2-run-detail
doc: 03.1 §Task 12-2 · Finish run detail and the live timeline · ref:dashboard-surfaces §5 · ref:dashboard-surfaces §9.2

builds:
- [ ] BOTH render task groups, attempts, replay/skipped/blocked arms, live duration, systems, provenance, and focusable timeline segments
- [ ] BOTH follow the selected run live without losing expansion, focus, scroll, or exact attempt identity
- [ ] BOTH freeze separate section projector/component/test seams so Tasks 13-1–13-4 need no shared mutable switch or query file
- [ ] PROOF refresh/reconnect, replay, retry, archive, out-of-order patch, and terminal convergence against direct authority checks

needs:
- dash-run-modal

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 4 run-detail foundation in `phase-3-1-dashboard-c21194e18-r18-run-detail`, parallel with Tasks 16, 24 and 30; its exit freezes the four disjoint wave-5 section seams · left: Task 15
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.3's seven states and §D330.4's `version` as `rowRevision`, with D268's one derivation retained and no fold arm (§D330.12 item 1) (no redesign) · left: attempts render as separately selectable rows, never compared (D289 amendment)

#### 12-3 · Finish Activity, search, and export {#dash-activity}
status: planned
date: parallel wave 12 · worktree r12-3-activity
doc: 03.1 §Task 12-3 · Finish Activity, search, and export · ref:operator-trust §5.8 · ref:dashboard-surfaces §9.8

builds:
- [ ] BOTH search/filter across dates, workflows, subjects, statuses, actors, versions, failures, and evidence without scanning unbounded state
- [ ] BOTH produce truthful summaries and spreadsheet/diagnostic exports from stable result snapshots
- [ ] PROOF pagination, cancellation, stale responses, redaction, large history, empty/error cases, and exported-row reconciliation

needs:
- dash-archive

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 4 Activity/search/export seam in `phase-3-1-dashboard-c21194e18-r24-activity`, parallel with Tasks 16, 18 and 30 after Archive freezes history identity · left: Task 23

#### 12-4 · Finish production startup, serving, and shutdown {#dash-production-runtime}
status: planned
date: parallel wave 12 · worktree r12-4-production-runtime
doc: 03.1 §Task 12-4 · Finish production startup, serving, and shutdown · ref:frontend-backend-integration §6.9 · ref:execution-and-sessions

builds:
- [ ] BOTH serve the production bundle, admit one runtime, report startup failures, and expose truthful readiness
- [ ] BE stop signals, workers, browsers, writers, projections, locks, and backups in the declared order without abandoned authority
- [ ] PROOF clean start, duplicate start, missing bundle/settings, signal drain, second signal, crash recovery, and orphan sweep

needs:
- dash-setup
- dash-storage
- dash-sessions

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 4 production-runtime seam in `phase-3-1-dashboard-c21194e18-r30-production-runtime`, parallel with Tasks 16, 18 and 24 after setup/storage/session authority is integrated · left: Tasks 12–14

#### 13-1 · Finish Context, Data, Attempts, and Edit readback {#dash-context-data}
status: planned
date: parallel wave 13 · worktree r13-1-context-data
doc: 03.1 §Task 13-1 · Finish Context, Data, Attempts, and Edit readback · ref:dashboard-surfaces §5 · ref:data-intake-and-edit-data §6

builds:
- [ ] BOTH render declared inputs, origins, directions, redaction, checkpoint provenance, attempt history, edits, and validation state
- [ ] BOTH submit edits through the authoritative command path and show exact persisted readback/conflict results
- [ ] PROOF empty, redacted, malformed, stale, cross-attempt, archived, and edit-rerun cases

needs:
- dash-queue
- dash-run-detail

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Context/Data section seam in `phase-3-1-dashboard-c21194e18-r19-context-data`, parallel with Tasks 20–22 only through Task 18's frozen section boundary · left: Tasks 16 and 18

#### 13-2 · Finish logs, observations, and captures {#dash-logs}
status: planned
date: parallel wave 13 · worktree r13-2-logs
doc: 03.1 §Task 13-2 · Finish logs, observations, and captures · ref:operator-trust §2.3 · ref:dashboard-surfaces §5

builds:
- [ ] BE compose the missing production note and line-kind producers without inventing page facts
- [ ] BOTH render bounded searchable note/observed/fence/navigation/pause/event rows plus diagnostic captures and bundles
- [ ] PROOF pagination snapshots, stale-response isolation, archive read-forward, redaction, artifact absence, and large-log behavior

needs:
- dash-queue
- dash-run-detail

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Logs section seam in `phase-3-1-dashboard-c21194e18-r20-logs`, parallel with Tasks 19, 21 and 22 only through Task 18's frozen section boundary · left: Tasks 16 and 18

#### 13-3 · Finish receipts and failure records {#dash-receipts-failures}
status: planned
date: parallel wave 13 · worktree r13-3-receipts-failures
doc: 03.1 §Task 13-3 · Finish receipts and failure records · ref:operator-trust §5 · ref:write-safety §6

builds:
- [ ] BOTH render derived receipt identity, action evidence, write-state proof, failure fingerprint, causal record, recovery, and unknown outcomes
- [ ] BOTH connect explain/retry/open-evidence actions to authoritative commands and immutable evidence
- [ ] PROOF success, verified no-op, refusal, failed, unknown-submit, recovered, retried, archived, and tamper cases

needs:
- dash-queue
- dash-run-detail

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Receipt/Failure section seam in `phase-3-1-dashboard-c21194e18-r21-receipts-failures`, parallel with Tasks 19, 20 and 22 only through Task 18's frozen section boundary · left: Tasks 16 and 18

#### 13-4 · Finish gates and parked-write resolution {#dash-gates}
status: planned
date: parallel wave 13 · worktree r13-4-gates
doc: 03.1 §Task 13-4 · Finish gates and parked-write resolution · ref:write-safety §14 · ref:dashboard-surfaces §5

builds:
- [ ] BOTH render active and settled gate evidence, freshness, actor, command version, write plan, conflict, rejection, and machine-verified absence of gate
- [ ] BOTH make approve/reject/reopen and parked-write resolution real, attributable, revision-bound commands
- [ ] PROOF stale, expired, changed-plan, skipped-condition, resumed, rejected, archived, and unauthorized paths

needs:
- dash-queue
- dash-run-detail

log:
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Gate/Parked-write section seam in `phase-3-1-dashboard-c21194e18-r22-gates`, parallel with Tasks 19–21 only through Task 18's frozen section boundary · left: Tasks 16 and 18

#### 14 · Finish generic Review and People contracts {#dash-review-people}
status: planned
date: serial gate 14 · worktree r14-review-people
doc: 03.1 §Task 14 · Finish generic Review and People contracts · ref:dashboard-surfaces §5 · ref:frontend-backend-integration §5

builds:
- [ ] BOTH implement the generic panel/page kinds, routing, empty/error/loading states, group rollups, member outcomes, and declared labels
- [ ] BOTH require workflow descriptors to provide workflow-specific fields/actions later; 3.1 supplies no invented Separations/OCR policy
- [ ] PROOF generic fixtures, direct/deep links, accessibility, large groups, partial members, and unavailable workflow-specific content

needs:
- dash-context-data
- dash-logs
- dash-receipts-failures
- dash-gates

log:
- 2026-09-03 | 3.1 parallel execution plan | serial section-extension gate in `phase-3-1-dashboard-c21194e18-r27-review-people`; it follows wave 5 so it cannot collide with the four run-detail section writers · left: Tasks 18–22

#### 15 · Prove realtime convergence and reconnect {#dash-realtime}
status: planned
date: serial gate 15 · worktree r15-realtime
doc: 03.1 §Task 15 · Prove realtime convergence and reconnect · ref:frontend-backend-integration §3.5 · ref:dashboard-surfaces §1

builds:
- [ ] BE publish every declared run-detail/log/review/people/artifact topic or remove the false declaration
- [ ] BOTH converge create/update/archive/delete and settings/worker changes without full-day reparsing or stale UI state
- [ ] PROOF ordering, duplicate, missed cursor, restart generation, offline/reconnect, selected-run switch, and permanent backfill-gap behavior

needs:
- dash-shell
- dash-date-navigation
- dash-settings
- dash-setup
- dash-storage
- dash-sessions
- dash-run-modal
- dash-queue
- dash-notifications
- dash-run-detail
- dash-context-data
- dash-logs
- dash-receipts-failures
- dash-gates
- dash-archive
- dash-activity
- dash-explorer
- dash-intake-edit
- dash-review-people

log:
- 2026-09-03 | 3.1 parallel execution plan | serial convergence gate in `phase-3-1-dashboard-c21194e18-r28-realtime`; it starts only after every feature worktree through Task 27 is integrated and closed · left: Tasks 9–27

#### 16 · Meet large-data and responsiveness budgets {#dash-performance}
status: planned
date: serial gate 16 · worktree r16-performance
doc: 03.1 §Task 16 · Meet large-data and responsiveness budgets · ref:frontend-backend-integration §7.4

builds:
- [ ] BOTH bound database, filesystem, projection, serialization, render, and memory work for large queues, logs, archives, groups, and search
- [ ] FE add shared virtualization/pagination primitives only where measurement crosses the recorded trigger
- [ ] PROOF preserve the recorded performance fixture and fail on structural counter regressions; keep host timing observational

needs:
- dash-realtime

log:
- 2026-09-03 | 3.1 parallel execution plan | serial integrated-performance gate in `phase-3-1-dashboard-c21194e18-r29-performance`; it measures the converged tree and cannot run beside feature writers · left: Task 28

#### 17 · Build the complete dashboard proof infrastructure {#dash-proof-infrastructure}
status: planned
date: serial gate 17 · worktree r17-proof-infrastructure
doc: 03.1 §Task 17 · Build the complete dashboard proof infrastructure · ref:guards-and-tests §3 · ref:frontend-backend-integration §7

builds:
- [ ] PROOF T2 component/feature scenarios cover every generic surface, state arm, command result, and accessibility invariant
- [ ] PROOF T3 production-bundle browser journeys cover every route/control on desktop/mobile, both themes, keyboard, and reduced motion
- [ ] PROOF T4 live dry-run journeys bind assertions to direct SQLite/evidence checks without authorizing writes
- [ ] PROOF parity references include Settings, sessions, setup, dialogs, and the DS specimen; update only through the deliberate lane

needs:
- dash-performance
- dash-production-runtime

log:
- 2026-09-03 | 3.1 parallel execution plan | serial proof-corpus gate in `phase-3-1-dashboard-c21194e18-r31-proof-infrastructure`; it owns the shared T2/T3/T4/parity infrastructure only after features, convergence, performance and production runtime settle · left: Tasks 9–30

#### 18 · Execute integrated dashboard acceptance and close 3.1 {#dash-acceptance}
status: planned
date: serial gate 18 · worktree r18-acceptance
doc: 03.1 §Task 18 · Execute integrated dashboard acceptance and close 3.1 · 03.1 §Exit criteria

builds:
- [ ] PROOF execute Task 8's unchanged acceptance matrix across run, queue, settings, setup, session, notification, date, trust, archive, Explorer, intake, and recovery journeys
- [ ] PROOF typecheck, lint, coverage, architecture, generated checks, parity, production smoke, performance, storage recovery, and live dry-run gates are green together
- [ ] PROOF direct authority reconciliation finds no ghost, duplicate, stale, or orphaned run/settings state and no protected-value exposure
- [ ] DOCS open focused remediation tasks for any failure; this supervisor audits and closes only after every row has independent evidence

needs:
- dash-shell
- dash-date-navigation
- dash-settings
- dash-setup
- dash-storage
- dash-sessions
- dash-run-modal
- dash-queue
- dash-notifications
- dash-run-detail
- dash-context-data
- dash-logs
- dash-receipts-failures
- dash-gates
- dash-archive
- dash-activity
- dash-explorer
- dash-intake-edit
- dash-review-people
- dash-realtime
- dash-performance
- dash-production-runtime
- dash-proof-infrastructure

log:
- 2026-09-03 | 3.1 parallel execution plan | final isolated acceptance in `phase-3-1-dashboard-c21194e18-r32-acceptance`; the 3.1 coordinator dispatches it only after every earlier task worktree, branch and supervisor row is integrated and closed · left: Tasks 8–31

### 3.2 · Workflow authoring and candidate freeze {#workflow-authoring-model}
status: planned
size: XL
chip: revalidate landed work · freeze exact candidate
doc: 03.2 §Phase summary · ref:workflow-model §1.6 · ref:guards-and-tests §10.11
open: yes

> Revalidate every mutable workflow seam at current HEAD, finish transaction-free acceptance for Person Lookup and Separations, then independently freeze one exact candidate. Historical completion is evidence to inspect, not current completion authority.

builds:
- [~] BOTH Tasks 1–3 revalidate the workflow compiler, Separations read substrate, and write-safety mechanics
- [ ] PROOF wave 4 proves runtime inheritance and the clean-context author guide
- [ ] BOTH wave 5 accepts Person Lookup and the final compiled Separations workflow without real writes
- [ ] PROOF Task 6 records a current-source Separations dry-run preview with exact 0/0/0 write authority
- [ ] PROOF Task 7 independently audits and freezes the exact acceptance candidate

needs:
- dash-defaults

log:
- 2026-09-04 | D329 chronology correction | the former 03b/03c order is retired; authoring and read-only acceptance now precede every controlled write, with an exact old-to-new crosswalk in doc 03.2

#### 1 · Verify the workflow-definition platform {#workflow-authoring-core}
status: active
size: M
chip: historical implementation · current proof pending
doc: 03.2 §Task 1 · Verify the workflow-definition platform · ref:workflow-model §1.6 · ref:guards-and-tests §10.11

> Verify the final `workflow.ts` authoring seam, direct-entry algebra, omissions, recovery, compiled products, four-artifact enforcement, and deletion of the retired descriptor/module/fragment path. Repair only defects contained within this seam.

builds:
- [~] BE D311–D318 implementation and deletion acceptance landed historically through `ab04231c`
- [ ] PROOF current-source inspection, red-capable guards, generated products, and retired-path absence
- [ ] DOCS exact current-HEAD result and any in-seam correction

#### 2 · Revalidate the Separations read and task-store substrate {#workflow-task-substrate}
status: active
size: M
chip: historical implementation · current proof pending
doc: 03.2 §Task 2 · Revalidate the Separations read and task-store substrate · ref:task-contract §9 · ref:workflow-model §8

> Reverify Kuali, UCPath, and New Kronos reads plus every Separations mini-store leaf, task registration, selector/provenance boundary, and production provenance-recording point.

builds:
- [~] BE former 3.2 Tasks 1–3 landed historically
- [ ] PROOF strict contracts, source provenance, consumed-leaf recording, and no load-bearing retired authoring path

needs:
- workflow-authoring-core

#### 3 · Revalidate Separations transaction and safety mechanics {#workflow-write-mechanics}
status: active
size: L
chip: mechanics landed · no live write here
doc: 03.2 §Task 3 · Revalidate Separations transaction and safety mechanics · ref:write-safety §3.2 · ref:write-safety §14.11

> Reprove termination, pending sweep, Kuali finalization, conditional identity authority, exact-set deletion, and filing-survival mechanics against fake external systems. This task creates no controlled-write evidence.

builds:
- [~] BE former 3.2 Tasks 4–5, 9, and the software portion of Task 10 landed historically
- [ ] PROOF prepare/probe/fence/commit/verify contracts, negative controls, no repeat-completed-write path, and no filing deletion before finalization

needs:
- workflow-task-substrate

#### 4-1 · Prove automatic runtime inheritance {#workflow-runtime-inheritance}
status: planned
date: parallel wave 4 · dedicated worktree
size: S
doc: 03.2 §Task 4-1 · Prove automatic runtime inheritance · ref:workflow-model §1.6 · ref:guards-and-tests §10.11

> Prove that a compiled workflow inherits worker/session acquisition, authentication, checkpoints, semantic logs, screenshots, receipts, notifications, and Archive without workflow-specific glue.

builds:
- [ ] PROOF complete inherited runtime path and one broken-link negative control

needs:
- workflow-write-mechanics

#### 4-2 · Prove the workflow-author guide from clean contexts {#workflow-guide-proof}
status: planned
date: parallel wave 4 · dedicated worktree
size: S
doc: 03.2 §Task 4-2 · Prove the workflow-author guide from clean contexts · ref:workflow-model §1.6 · ref:guards-and-tests §10.11

> Follow the canonical guide for Person Lookup and Separations with no undocumented step, extra authored file, or escape hatch. Correct and re-prove any mismatch.

builds:
- [ ] PROOF clean-context authoring passes and exact guide/contract reconciliation

needs:
- workflow-write-mechanics

#### 5-1 · Complete and accept Person Lookup {#person-lookup-acceptance}
status: active
date: parallel wave 5 · dedicated worktree
size: M
chip: conversion landed · current live-read pending
doc: 03.2 §Task 5-1 · Complete and accept Person Lookup · ref:workflow-model §8 · ref:task-contract §9.1

> Reconcile Search/Match, the final compiled definition, generic projections, structural T1, justified T2/T3 cases, and a current transaction-free `live-read` with exact 0/0/0 write-authority deltas.

builds:
- [~] BOTH final conversion and one historical `live-read` result exist
- [ ] PROOF current compiled behavior, acceptance matrix, live-read, migration record, and capability dispositions

needs:
- workflow-runtime-inheritance
- workflow-guide-proof

#### 5-2 · Accept the final compiled Separations workflow without writes {#separations-compiled-acceptance}
status: active
date: parallel wave 5 · dedicated worktree
size: L
chip: composition landed · current proof pending
doc: 03.2 §Task 5-2 · Accept the final compiled Separations workflow without writes · ref:workflow-model §8 · ref:write-safety §14.11

> Verify the nineteen-node behavior, omissions, identity authority, transaction fences, checkpoints, diagnostics, receipts, generic projections, structural T1, and only justified T2/T3 cases from the final compiler.

builds:
- [~] BOTH former 3.2 Tasks 6, 11, and 12 plus former 3.3 Task 5 landed historically
- [ ] PROOF current-source compiled acceptance without converting structural proof into controlled-write evidence

needs:
- workflow-runtime-inheritance
- workflow-guide-proof

#### 6 · Record current-source Separations read-only acceptance {#separations-readonly-acceptance}
status: planned
size: M
chip: fresh strict T1b required
doc: 03.2 §Task 6 · Record current-source Separations read-only acceptance · ref:guards-and-tests §10.4 · ref:write-safety §14.11

> Reverify the selected closed Kuali document through the integrated compiled workflow and reach the declared dry-run preview terminal with a fresh `met` T1b result and exact-run 0/0/0 intents, attempts, and outbox.

builds:
- [~] PROOF historical previews remain evidence; the 2026-09-03 replacement failed at New Kronos with 0/0/0 write authority and did not meet the strict gate
- [ ] PROOF current live reads, preview terminal, durable result, and exact write-authority deltas

needs:
- separations-compiled-acceptance

#### 7 · Audit and freeze the acceptance candidate {#workflow-candidate-freeze}
status: planned
size: M
chip: independent · audit only
doc: 03.2 §Task 7 · Audit and freeze the acceptance candidate · ref:workflow-model §1.6 · ref:write-safety §14

> Independently verify Tasks 1–6, run every integrated gate, and freeze the exact commit, generated manifest, workflow fingerprints, runtime/configuration schema, and focused evidence. A failure creates a focused 3.2 remediation task and restarts this audit.

builds:
- [ ] PROOF current-source audit, complete green gate family, exact candidate record, and no parked write against a closure that will change
- [ ] DOCS close every 3.2 worktree, branch, task, and coordinator row before 3.3 unlocks

needs:
- person-lookup-acceptance
- separations-readonly-acceptance

### 3.3 · Controlled acceptance {#workflow-live-acceptance}
status: planned
size: L
chip: immutable candidate · four serial tasks
doc: 03.3 §Phase summary · ref:write-safety §14 · ref:workflow-model §1.6
open: yes

> Consume one immutable Phase 3.2 candidate: admit it and the exact targets, prove pending sweep independently, perform the coupled UCPath filing and Kuali finalization, then reconcile acceptance and close. This part performs no software development.

builds:
- [ ] PROOF Task 1 admits the candidate, targets, disposition, final rehearsal, and bounded authorization
- [ ] PROOF Task 2 records the independent pending-sweep witness on a disposable target
- [ ] PROOF Task 3 records the coupled UCPath filing and Kuali finalization on the real target
- [ ] DOCS Task 4 reconciles T1–T3 evidence, owning records, integrated gates, and lifecycle close

needs:
- workflow-candidate-freeze
- workflow-authoring-model

log:
- 2026-09-04 | D329 chronology correction | controlled writes can start only after the final authoring candidate freezes; drift, failure, or UNKNOWN expires authorization and returns software defects to a new 3.2 remediation task

#### 1 · Admit the frozen candidate and controlled run {#acceptance-admission}
status: planned
size: M
chip: bounded authorization required
doc: 03.3 §Task 1 · Admit the frozen candidate and controlled run · ref:write-safety §14

> Verify the freeze byte-for-byte, select the exact disposable and real targets, record restoration/retention disposition, repeat the no-write rehearsal, and obtain one bounded authorization naming the candidate, targets, disposition, and sequence.

builds:
- [ ] PROOF exact candidate, target, disposition, external availability, and fresh 0/0/0 rehearsal packet

needs:
- workflow-candidate-freeze
- you: authorize the exact candidate, disposable target, real target, disposition, and ordered controlled sequence after the packet is presented

#### 2 · Prove the independent pending-sweep commit {#pending-sweep-proof}
status: planned
size: M
doc: 03.3 §Task 2 · Prove the independent pending-sweep commit · ref:write-safety §3.2

> Bind the exact eligible/protected stable-transaction set, delete only the selected disposable rows, verify protected rows survive, and execute the recorded restoration/retention disposition. Stop without retry on UNKNOWN.

builds:
- [ ] PROOF committed exact-set witness, reload proof, fence timing, receipt/ledger evidence, and disposition completion

needs:
- acceptance-admission

#### 3 · Prove the UCPath filing and Kuali finalization {#separation-filing-finalization}
status: planned
size: L
doc: 03.3 §Task 3 · Prove the UCPath filing and Kuali finalization · ref:write-safety §3.2 · ref:write-safety §14.11

> File the approved termination, re-read the exact filing, and finalize Kuali only while that surviving filing remains proven. Record all seven payload shapes, fences, reload read-backs, receipts, and ledger effects; never re-file to recover a failed finalization.

builds:
- [ ] PROOF surviving UCPath filing and dependent Kuali finalization against the immutable candidate

needs:
- pending-sweep-proof

#### 4 · Reconcile acceptance and close Phase 3.3 {#workflow-acceptance-close}
status: planned
size: M
doc: 03.3 §Task 4 · Reconcile acceptance and close Phase 3.3 · ref:guards-and-tests §10 · ref:operator-trust §10

> Reconcile Person Lookup and Separations T1–T3 evidence, migration and knowledge records, capability dispositions, regressions, complete gates, and every 3.3 execution row. A failure is never converted into a waiver.

builds:
- [ ] PROOF unchanged candidate, all three controlled proofs, reconciled acceptance, and complete green integrated gates
- [ ] DOCS every owning record updated; worktrees, branches, tasks, and coordinator lifecycle closed; 3.4 unlocked

needs:
- separation-filing-finalization


### 3.4 · Codex and Claude cooperation {#claude-operator}
status: planned
date: R15 · 2026-08-21
size: L
chip: not started
doc: 03.4 §Track summary · ref:frontend-backend-integration §3.4 · ref:write-safety §14

> After 3.3 closes, Claude Code becomes the second attributed actor on the one local BFF. Task 1 establishes derived actor identity and the two-actor rule; Task 2 adds the loopback MCP client surface; Tasks 3 and 4 add monitoring and actor-aware clients and may run in parallel under the coordinator plan; Task 5 records the attributed dry-run/T4 proof and closes Phase 3. Desktop attachment remains Phase 6.

needs:
- workflow-live-acceptance

log:
- 2026-09-04 | D329 chronology correction | 3.4 starts after controlled acceptance closes in 3.3; old 03d filename retired in favor of decimal doc 03.4
- 2026-09-03 | D326 decimal hierarchy | 3.4 starts after closed 3.3; Tasks 3 and 4 are parallel-capable only through the coordinator plan, and Task 5 owns the T4 journey plus Phase 3 close · desktop attachment remains Phase 6
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 1 · Derive actor identity and enforce the two-actor rule {#claude-actor}
status: planned
date: R15 · 2026-08-21
size: M
doc: 03.4 §Task 1 · Derive actor identity and enforce the two-actor rule · ref:frontend-backend-integration §3.4 · ref:write-safety §14

> The actor stops being a literal and becomes a derived fact. A closed union of two ids, a server that DERIVES the acting actor from the caller's own credential instead of trusting a request body, and a per-family policy table: parity everywhere, two-actor on the four arms that authorize a real HR write. This is first because an MCP server built before it would stamp `local-operator` on everything Claude does, and ref operator-trust already says why that cannot be repaired later — an immutable ledger's old rows have no honest answer.

builds:
- [ ] BE a closed actor union — `local-operator` and `claude` — replacing the `z.literal` in `src/domain/ids.ts:136` and the config `actor` default
- [ ] BE extend D75's checkpoint to derive the closed second actor from the caller's credential and stamp that authoritative value; strict solo mismatch refusal is already built
- [ ] BE the per-family parity table — two-actor for `gate/resolve-gate`, `run/resolve-write-present`, `run/resolve-write-absent` and a `start-run` with `dryRun: false`; parity everywhere else
- [ ] BE a `pending-confirmation` resolution with NO effect until a DIFFERENT actor confirms it, re-binding the same evidence digest (a schema version; read-forward, since every existing row is a settled single-actor resolution)
- [ ] WIRE attribution rendered wherever an actor is already durable — gate `resolvedBy`, `plannedBy`/`appliedBy`/`archivedBy`, the D82 evidence receipt
- [ ] BE a guard: no command path stamps an actor the request did not authenticate, and no two-actor arm settles with one — with a violating fixture

needs:
- workflow-authoring-model

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 2 · Build the local MCP client surface {#claude-mcp}
status: planned
date: R15 · 2026-08-21
size: L
doc: 03.4 §Task 2 · Build the local MCP client surface · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.5 · ref:frontend-backend-integration §3.6

> A loopback MCP server that is a CLIENT of the BFF, never a second server and never a second wire — it reuses `src/dashboard/client/transport.ts` rather than re-implementing it. A write tool per command family, a read tool per read model, and a tail over the one stream. The local port is not the new thing: the listener already binds `127.0.0.1` and refuses anything else. What is missing is a client Claude Code can speak to.

builds:
- [ ] BE the loopback MCP server over `/api/v1/**`, started from the CLI and registered in a project-scoped `.mcp.json` so the capability travels with the checkout
- [ ] BE a write tool per command family — start plan + confirm, gate resolve, run retry/cancel/bump/rename, edit data, archive, settings, intake, notifications, capture, bulk
- [ ] BE a read tool per read model — bootstrap, the day wire, run detail and every lazy section, the evidence receipt, archive, explorer, the activity report, the storage doctor, the UI catalog
- [ ] BE a `tail` tool over the SSE stream — `Last-Event-ID` resume, `reset-required` reported rather than swallowed
- [ ] BE actor `claude`, and the CAS `expectedVersion` passed through from the read that produced it — never cached across turns
- [ ] BE both refusal arms surfaced verbatim (D253), only actions the served descriptors declare, and D226's ceremony obligations honoured by an agent surface too
- [ ] BE a refusal BY NAME when no BFF answers — the MCP server never starts one, because D181 admits exactly one `server` holder

needs:
- claude-actor

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 3 · Add cursor-based monitoring and the actor inbox {#claude-monitor}
status: planned
date: parallel wave 3 · dedicated worktree
size: M
doc: 03.4 §Task 3 · Add cursor-based monitoring and the actor inbox · ref:operator-trust §6 · ref:frontend-backend-integration §3.5

> The stream is already cursor-resumable and the projector is already fed by a disk tail, so a second reader is nearly free. The hole is per-actor: the inbox is read for ONE hardcoded id and rides the day wire with no route of its own. And a log of step names teaches an agent nothing — `{#observed-logs}` is what turns monitoring into something worth handing to a second watcher.

builds:
- [ ] BE the notification inbox served PER ACTOR — `run-queue-projection.ts:1518` reads one hardcoded id today
- [ ] BE read / unread / snooze scoped to the acting actor's own rows — a notification is owned by an actor, not broadcast
- [ ] BE a durable per-actor stream cursor, so a terminal session that ended resumes instead of re-reading the day
- [ ] BE a "what changed since `<cursor>`" read that answers in one call
- [ ] WIRE the observed log as a read tool — `{#observed-logs}`' provenance points, redacted by the declared evidence classification
- [ ] PROOF a tail that reports its own degradation — `reset-required` and the health transitions surfaced, never a silent re-snapshot

needs:
- claude-mcp
- observed-logs

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 4 · Make existing clients actor-aware {#claude-clients}
status: planned
date: parallel wave 3 · dedicated worktree
size: M
doc: 03.4 §Task 4 · Make existing clients actor-aware · ref:frontend-backend-integration §6.9 · ref:clock-config-secrets §3

> "What happens if the user has both open" was answered by D181 before anyone asked it: the `server` role lock is taken before the authority database opens, so there is never more than one BFF on the machine. The web dashboard, the desktop app and Claude's MCP server are three clients of one port, one journal and one projection — which is what makes two actors safe rather than merely convenient.

builds:
- [ ] BE the role lock ELECTS the host; a second app attaches to the running BFF as a client and never starts a second one (doc 06's Electron half)
- [ ] FE every actor-bearing surface renders the actor rather than assuming it — gate `resolvedBy`, `archivedBy`, `plannedBy`, the receipt, the notification row
- [ ] BOTH a client roster the operator can see — who is attached right now and what each last did; live-only, and it says so rather than pretending to be durable
- [ ] WIRE the no-BFF refusal, named, from every client — and never naming npm inside a packaged app (doc 06)
- [ ] PROOF the conflict path as ORDINARY traffic — two clients on one run version, both refused by name with the server's `currentVersion`, neither reporting success

needs:
- claude-mcp

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 5 · Prove attributed cooperation and close Phase 3 {#claude-proof}
status: planned
date: R15 · 2026-08-21
size: M
doc: 03.4 §Task 5 · Prove attributed cooperation and close Phase 3 · ref:guards-and-tests §10

> R10's T1 shape driven from a different client. Separations is the subject because its name-resolved arm carries the identity gate and a transaction node, so the two-actor rule is exercised on the arm it was written for. One agent, one scenario — the parallel T4 tier comes later, after `{#parallel-runs}` and `{#duo-lease}`.

builds:
- [ ] PROOF a Claude Code session drives a separations dry run end to end through the MCP tools — start, watch, gate, settle — with no dashboard click
- [ ] PROOF every action attributed to `claude` in the command journal, the spans and the evidence receipt
- [ ] PROOF one identity gate proposed by claude and confirmed by the operator, plus the decline, the stale-digest re-open and the refused self-confirmation
- [ ] PROOF both apps open during the run, one BFF, one journal, proved from the lock files
- [ ] PROOF the result recorded durably the way every dry-run scenario is (R10), written as T4's first journey rather than as a transcript

needs:
- claude-mcp
- claude-monitor
- claude-clients

log:
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

## Phase 4 · Workflow migrations {#migrations}
phase: Phase 4
status: you
when: after Phase 3 closes | one candidate at a time
chip: 4A is the next admitted workflow
doc: ref:workflow-model §1.6.2 · ref:charter §Migration strategy
open: yes

> Phase 4 is the workflow-migration program. Each approved workflow becomes one lettered part: **4A**, then **4B**, **4C**, and so on. The next letter is created only after that workflow's current behavior, proposed definition, proof target, and migration boundary are verified and approved.

builds:
- [ ] DOCS Phase 3 stops only after 3.4's attributed cooperation proof (D326)
- [ ] DOCS record the operator's selected candidate after Phase 3 closes
- [ ] DOCS verify its complete admission packet with no guessed workflow boundary or hidden open choice
- [ ] DOCS record the operator's approval of the exact workflow definition and scope
- [ ] DOCS create the next lettered Phase 4 part, migration doc and coordinator plan

needs:
- claude-operator

note: **Legacy capability register at `b1b36349`:** 46 open · 19 replaced · 6 native · 7 retired. Those are real cutover obligations, but they do not make any candidate a Phase 3 task or pre-assign a future phase.

log:
- 2026-09-02 | D319 | retired the assumed remaining-migration sequence as build authority; old rows remain evidence leads until Phase 3 close extracts or deletes them
- 2026-09-02 | prior candidate intake | Person Lookup/I-9 evidence at `b1b36349` is preserved, but only Person Lookup is already admitted; I-9 remains an unnumbered candidate

### 4A · Next approved workflow {#workflow-admission}
status: you
chip: one candidate only · operator approval required
doc: ref:workflow-model §1.6.2

> This is the only next workflow shown in the plan. Its task list expands only after the current behavior and proposed workflow packet are verified and approved. Later approved workflows become 4B, 4C, and onward.

builds:
- [ ] DOCS record one selected candidate and its complete verified admission packet
- [ ] DOCS record operator approval and define the 4A migration tasks

needs:
- migrations

#### Shared capabilities assigned with 4A {#cross-cutting}
status: planned
doc: ref:workflow-model §1.6.3 · ref:clock-config-secrets §3 · ref:clock-config-secrets §6.2 · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §8

> Where legacy is still ahead — the honest list, each shaped against a real run corpus rather than invented in planning.

builds:
- [x] BOTH resolver-owned editable settings — server inventory, atomic command/readback, preflight rerun and read-only doctor are live (D169/D184/D282); broader legacy settings remain open below
- [x] BOTH DCR3 cross-date search authority + transport — strict bounded route and typed client over the measured current separations corpus
- [x] FE DCR4 Separations search surface — the Top Bar defaults to corpus search and retains an explicit served-day scope
- [ ] BOTH screenshots gallery + the artifact-bytes route
- [ ] BE the three legacy-specific Excel export writers; DCR5's evidenced search/Activity workbook is delivered separately
- [ ] DOCS `test-login` / setup wizard equivalents, or their retirement with evidence
- [ ] BE `explain failure <fingerprint>` — the indexed column and `listByFingerprint` exist; the command does not (ref operator-trust §4.2)
- [ ] BE an OS delivery channel — `OsNotificationDelivery` has no production implementation, every publish settles `no-channel` (ref operator-trust §6.3)
- [ ] BE the enqueue-time instance / URL check — `resolveInstances` has only a test caller (ref clock-config-secrets §4)
- [ ] BE `requires: SecretName[]` on task contracts + the enqueue check; `validateBootSecrets` / `validateDescriptorSecrets` have no caller (ref clock-config-secrets §6)
- [ ] BOTH finish the remaining preflight runners and consumers — the dashboard-selected authority, strict rerun route and typed Settings caller are live; non-dashboard capability runners plus broad `cli doctor` / `test-login` remain (ref clock-config-secrets §6.2)
- [ ] DOCS a refreshed `.env.example` bound to the secrets registry (ref clock-config-secrets §6)

needs:
- phase-3

log:
- 2026-08-28 | DCR receive | DCR3–DCR5 delivered current-corpus search authority/transport, its Separations surface and evidenced XLSX; screenshots/artifact bytes, legacy-specific exports and setup remain open
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

## Phase 5 · Cutover readiness and authority switch {#deferred}
phase: Phase 5
status: planned
when: after Phase 4 | readiness before the one authority switch
chip: close readiness, then switch once
doc: 04 §Shelf summary · 00 §Task 4 · Fix the size model and delivery tiers · ref:workflow-model §1.6.2 · 05 §Risk register (top sequencing risks)
open: no

> Phase 5 closes every cutover-relevant readiness gap, then performs one all-at-once authority switch. Nothing is silently dropped: every deferred item has a named disposition, and desktop-only update work is carried forward to Phase 6.

log:
- 2026-09-01 | D297 | controlled desktop update added as the ninth named deferral; v1 manual in-place updates remain a the desktop stage packaging acceptance criterion
- 2026-08-20 | docs-cohesion 04 | doc 04 rewritten as-built — eight deferrals, each with its trigger; the sanity check is RETIRED, not deferred, and `def-retention`'s title corrected (no 14/8/5 constant exists)

note: **Never, by design:** unverified silent fallbacks · selector `.or()` chains · per-daemon logs / bespoke polling hooks / secondary count caches · per-action mutation routes · generic retry on a parked write · DSL/codegen workflow authoring (D79a) · LAN/remote operator mode · hosting (D193) · mobile/phone document Capture Mode (D294) · legacy change accounting (D150).

### 5A · Close cutover-readiness gaps {#cutover-readiness}
status: planned
chip: every gap has a disposition
doc: 04 §Shelf summary

> Resolve, retire, or explicitly carry forward each remaining cross-cutting item before the authority switch.

#### Run the built dashboard without the dev server {#def-byte-path}
status: planned
doc: 04 §Run the built dashboard without the dev server · ref:frontend-backend-integration §6.9

> BFF static bytes for the ordinary local operator dashboard. D189, amended D294; "production" here means LOCAL (D193).

builds:
- [ ] BE the BFF static handler — port the parity fixture's traversal-checked, content-typed serveStatic; every unrouted path 404s today
- [ ] BE `--prod` parsed by `startRebuildRuntime` — `package.json:12` passes the flag and `src/core/runtime-composition.ts:162` dispatches on `args[0]` alone, so `npm run dashboard:prod` is byte-identical to `npm run cli -- dashboard`

needs:
- migrations

log:
- 2026-08-20 | docs-cohesion 04 | six build items re-verified unlanded at HEAD; two read as done and are not — `--prod` reaches nothing, and the Host gate has never evaluated a request
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion 03a fidelity fold | the capture WIRE gaps booked from ledger 3 §7 — an operator-scoped session read, the photo facts, the phone's retake; the operator SURFACE itself (CP3–CP5, CP17, CP18, CP59) is `{#track-f}`'s BOTH line · left: all of it

#### Edit a workflow's presentation / policy without a code change {#def-explorer-edit}
status: planned
doc: 04 §Edit a workflow's presentation / policy without a code change · ref:operator-trust §5.1 · ref:operator-trust §5.3 · ref:operator-trust §5.4 · ref:operator-trust §5.5 · ref:operator-trust §5.6

> D283/DCC4–DCC5 complete existing-workflow authority: label/icon/category hot apply; timeline/grouping and notification are named unavailable without owners; policy and Edit Data yield strict source briefs. D186 still governs new-workflow authoring and broader design work: an editor shaped by a sample of one workflow would be wrong.

needs:
- fact: a SECOND production workflow whose policy you want to change

log:
- 2026-08-28 | DCC6 closure | D283's complete existing-workflow boundary is recorded as built (strict label/icon/category validate/apply/readback; named unavailable timeline/grouping/notification; policy/Edit Data source briefs); the node remains planned for new-workflow authoring and broader design authority, with its D186 trigger unchanged
- 2026-08-20 | docs-cohesion 04 | the new-workflow authoring path (`ref operator-trust` §5.5) travels with this node by the operator's ruling; Phase A proves its own boundary — the wire has nowhere to send a mutation
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)

#### A record-sanity-check advisory panel {#def-sanity-check}
status: never
chip: retired 2026-08-18 (D192)
doc: 04 §A record-sanity-check advisory panel · ref:operator-trust §4.4.2 · ref:guards-and-tests §3.11

> RETIRED by the operator 2026-08-18 — no AI feature. D192's deferral condition ("renders beside the order-8 ALWAYS-GATE") was met DETERMINISTICALLY by the §14.2 packet's server-computed comparisons; the deterministic comparison IS the sanity check. Its two siblings retired with it.

needs:
- fact(met): retired by the operator 2026-08-18 (D192; `config/legacy-capabilities.json` → `legacy-tool-ops-sanity-check-record`, `kind: retired`)

log:
- 2026-08-20 | docs-cohesion 04 | status corrected from `planned` — `ref operator-trust` §4.4.2 and `config/legacy-capabilities.json` have carried the 2026-08-18 retirement since it was ruled; `AdvisorySurfaceIdSchema` stays closed at its D178 two-value shape
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code

#### Edit settings in the dashboard {#def-settings}
status: active
chip: bounded Settings + preflight served
doc: 04 §Edit settings in the dashboard · ref:clock-config-secrets §3 · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §2.4

> The `apply-settings` authority and the Settings surface are live: the browser consumes a server-listed resolver-owned editable inventory and emits one revision/schema/patch-bound atomic command. Environment-owned values remain locked, persisted readback names restart-required, and rerun preflight binds the active runtime identity. Phase 3 milestone, no single trigger; listed under cross-cutting above.

builds:
- [x] BE `apply-settings` is active with exact revision/schema/patch binding and atomic whole-file persistence
- [x] BE the registry-derived preflight/doctor service — `buildBootstrap` serves its retained strict report and `POST /api/v1/preflight/rerun` returns exact readback
- [x] FE the Settings write path, persisted readback, preflight rerun and read-only doctor controls
- [x] BE `mergeSettings` applies every `ConfigSchema` group through a compiler-exhaustive map, including `browser` (ref clock-config-secrets §3)
- [x] BE both composition roots read the strict revisioned `.tracker/settings.json` authority (D321 moved it from `config/` into the state root) beside its writer (ref clock-config-secrets §3)
- [ ] FE Settings → Help → Keyboard, or a global `?` — the top bar's keyboard glyph was deleted on the operator's instruction "we already have help in settings" and the destination was never built, so `ShortcutsPopover` (`top-bar.tsx:912`) has ZERO callers and `surfaces/shortcuts.tsx` is reachable from nowhere (fidelity-3 SE7, SE43, SE44; a Track F question)
- [ ] BE `settingsSections` lists the status sections whose data is already served — System hosts reads `systemInstances` off the bootstrap, Workflow capabilities is descriptor-derived; neither needs new authority (fidelity-3 SE40–SE42; a Track F question)
- [ ] FE the storage section's at-rest half — the three stat cards (authority generation, rows on disk, newest backup) and the `Backups` table with Size / Verdict / Note (fidelity-3 SE45, SE46, SE48, SE49)
- [ ] WIRE `rowsOnDisk`, and a backup's `sizeLabel` and `note`, so those cards and that table have something true to print (fidelity-3 SE48, SE49)
- [ ] FE any remaining Settings fidelity anatomy must stay within the server-listed resolver-owned inventory: provenance stack, source badges, hazard escalation, dirty marker and one action bar; it must not add legacy-only groups/leaves (fidelity-3 SE9–SE36)

needs:
- cross-cutting

log:
- 2026-08-28 | DCC3 | strict server-listed Settings UI landed with page-wide atomic draft/save, provenance locks, persisted readback, restart/preflight refusal and the typed rerun caller
- 2026-08-28 | DCC2 correction | preflight timeouts now abort through the injected monotonic scheduler while awaiting actual detector settlement; bootstrap imports only the browser-safe preflight contract; the frontend identity probe is an owned HTTP seam whose transport failure propagates
- 2026-08-20 | docs-cohesion 04 | the family, target and atomic N-leaf payload are contracted; `apply-settings` is the ONE entry in `PHASE1_DEFERRED` (`src/core/command-kernel.ts:141-148`), so the executor is the absence
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`
- 2026-08-21 | docs-cohesion 03a fidelity fold | five lines booked from ledger 3 §5 — the keyboard legend's destination, the two status sections already served, the storage at-rest half and its wire, the write half's full anatomy; the CONTAINER question (takeover vs dialog, SE1–SE4, SE8) is `{#track-f}`'s, not a build · left: all of it
- 2026-08-30 | DCC2 reconciliation | domain preflight remains the sole actual-settlement authority; loopback/body/rate admission, retained command identities, nonce-owned Vite and bounded descriptor-relative storage diagnosis are retained alongside DCC1–DCC3 Settings and Top Bar integration; no new UI completion claim

#### Trust UCPath / ServiceNow wait-before-negative-read windows {#def-propagation}
status: planned
doc: 04 §Trust UCPath / ServiceNow wait-before-negative-read windows · ref:write-safety §4 · ref:write-safety §4.2 · ref:workflow-model §1.6.2

> Rebuild-verified propagation measurements replace ported legacy knowledge at each system's own admitted live probe (`ref workflow-model` §1.6.2).

builds:
- [x] PROOF Kuali measured — four write/restore cycles on doc 4490, worst fence→trustworthy-negative ≈ 3.3 s; both Kuali contracts carry `stabilized` at `minSinceFenceMs: 30_000` (D135/D207)
- [ ] PROOF UCPath's Smart HR submit → SS Smart HR search window — both termination contracts stay `operator-only` and say why in the contract text
- [ ] PROOF ServiceNow's window — no commit contract exists for it yet
- [ ] PROOF the separations finalization's own controlled commit, which turns D207's provisional mechanism transfer into a measurement

needs:
- migrations

log:
- 2026-08-20 | docs-cohesion 04 | per system, not global: Kuali is closed, UCPath and ServiceNow are open; the direction-of-error argument is why the transfer stops at Kuali
- 2026-08-21 | docs-cohesion write-safety | ref write-safety rewritten as-built (`def314f3`); §3.2 the per-workflow proof criterion, §3.3/§3.4 the folded proofs, §14 the gate

#### Search runs across dates / view screenshots / export Excel {#def-search-export}
status: planned
doc: 04 §Search runs across dates / view screenshots / export Excel · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §2.2 · ref:operator-trust §2.4

> DCR3–DCR5 deliver current-corpus search authority/transport, its Separations Top Bar surface,
> and actor-attributed evidenced XLSX. DCR6's automatic receipt comparison was delivered historically
> and retired by the 2026-09-03 D289 amendment. D291/D292
> serve verified run/Archive capture bytes, and D306 adds selected browser-lease screenshots plus
> the shared Logs/Receipt viewer; only the broader generic resource/gallery family remains open.

builds:
- [x] BOTH verified run/Archive screenshot evidence — D291/D292 serve diagnostic-index-authorized bytes; D306 persists selected browser-lease screenshots and mounts one verified collection in Logs and Receipt. The broader generic resource-status/gallery family remains open by name
- [ ] FE the archive's `Change records` section — the record rides `ArchiveSweepWire.changeRecord` today, so this is buildable with no wire change (fidelity-3 AR234)
- [x] BOTH the DCR3 cross-date search authority + transport — strict bounded route and typed client over the measured current separations corpus
- [x] FE the DCR4 cross-date search surface — the Top Bar defaults to durable Separations corpus search and retains an explicit served-day scope
- [x] BE the DCR5 operator xlsx export — one dedicated command persists and verifies attachment evidence for an exact DCR3 snapshot or Activity range; D164's retention sink remains distinct
- [x] BOTH D289 amendment — each retry remains a separately inspectable attempt under the same logical queue item; the dashboard performs no automatic receipt comparison (ref:operator-trust §2.4)
- [ ] BOTH fold one logical item's runs into one queue row with separately selectable attempt numbers; the current projection emits one top-level row per run

needs:
- cross-cutting

log:
- 2026-09-03 | D289 amendment | retired the comparison registry, wire, endpoint and Receipt panel; ordinary per-attempt facts and `retryOf` lineage remain
- 2026-09-01 | D306 browser evidence | new/reset dashboard starts default to Headed with screenshot capture on; per-run Headless/Headed and capture policy are immutable start/run authority, and the same verified restricted capture collection renders in Logs and Receipt
- 2026-08-29 | R-DCR close | DCR1 and DCR3–DCR6 closed: D288 serves honest unavailable for the seven current ineligible Separations rows while strict fixtures prove the populated arm; D289's exact receipt comparison is built; D75's solo request checkpoint attributes new XLSX v2 evidence; artifact bytes/screenshots remain open
- 2026-08-28 | DCR receive | DCR3–DCR5 search authority/transport, Separations surface and evidenced XLSX delivered; artifact bytes and D289 comparison implementation remain open
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion data-intake-and-edit-data | reference doc verified against the code, subsections reordered, status block filled (`82c8550c`)
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion 03a fidelity fold | the artifact-bytes line now names the archive's evidence tiles as a consumer and the `Change records` section is booked (ledger 3 AR188–AR190, AR234, AR249); the intake manifest / rerun-diff surface and its wire fields are `{#track-f}`'s BOTH line, and the unbooked findings (22 intake · 5 capture · 3 explorer) are in doc 03a §Stale and false claims · left: all of it

#### Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes {#def-retention}
status: never
chip: won't build unless you ask
doc: 04 §Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes · ref:operator-trust §2.2 · ref:dashboard-surfaces §2.1 · ref:guards-and-tests §3.7

> Retention-sweep SCHEDULING (the sweep itself is built and tested and nothing calls it) and a content-store refcount — D193: disk growth on one local machine isn't worth a durable reference count. There is no "14/8/5" constant in this tree; the shipped number is 30 days from the bundle's own capture instant (D86's notes floor).

builds:
- [ ] BE a caller for `createDiagnosticRetentionSweep` — built and tested at `src/services/trust/diagnostic-retention.ts:45-85`, called by nothing, so no bundle has ever been purged here
- [ ] BE the content-store reference count that would let the sweep's reported unreferenced artifact ids actually be reclaimed (D137)

log:
- 2026-08-20 | docs-cohesion 04 | title corrected — no constant implements a 14/8/5 schedule; `DIAGNOSTIC_ORDINARY_RETENTION_DAYS` is 30 (`src/domain/trust/diagnostic-capture.ts:44`). Both items stay `wont-build-unless-asked` (D193b)
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-20 | docs-dash-surfaces 5.1b | ref dashboard-surfaces rewritten as-built; status block filled (`632ce168`)

### 5B · One all-at-once authority switch {#cutover}
status: planned
size: L
chip: not started
doc: 05 §Stage summary · 05 §Exit criteria · 05 §Legacy vs rebuild (as of 2026-08-21) · ref:dashboard-surfaces §5 · ref:frontend-backend-integration §7.4 · ref:frontend-backend-integration §10 · ref:charter §Migration strategy

> D89 / D93. No workflow flips individually, no mixed-engine production, ever. The entire legacy repo is preserved as the rollback asset; nothing in it is deleted until rollback-window closure with separate explicit authorization.

builds:
- [ ] BE the ledger's serialized writer composed in production — `createLedgerProjector` has no caller outside `tests/` while the read-through IS composed, so the dashboard reads a corpus nothing writes (doc 05 §Exit criteria 6)
- [ ] PROOF the §7.4 performance and resilience budgets MEASURED on the local production build, and the numbers adopted as the non-regression gates (Track D D4/D5, D264)
- [ ] PROOF the recovery drill rehearsed against the REAL authority database — the unit lane drills a real-shaped copy every commit, and D181 is what made `cli storage restore` reachable at all
- [ ] PROOF T4 green — the agent-operated parallel end-to-end tier, which may not be scheduled before `{#parallel-runs}` and `{#duo-lease}` (ref guards-and-tests §10.8)
- [ ] PROOF the cutover REHEARSAL — ref frontend-backend-integration §10 criterion 11; the isolation half is proven by `operational-isolation`, the rehearsal has never run
- [ ] PROOF stop new legacy enqueues → drain / park / reconcile → back up both repos' state
- [ ] BE approved offline one-time imports (`one-time-import-offline` guard activates)
- [ ] PROOF atomically repoint the launcher → smoke gates, with the legacy launch verified DISABLED as part of the same atomic unit (D89 step 4)
- [ ] PROOF rollback bridge verified before the switch

needs:
- workflow-live-acceptance
- migrations
- cross-cutting
- track-d
- fact: legacy capability register at zero open (46 open at `b1b36349`, all owned by `workflow-admission-backlog`)
- fact: doc 05 §Exit criteria — the definition of done + the program-wide integration criteria (ref frontend-backend-integration §10) green in the real built app

log:
- 2026-08-21 | docs-cohesion 05 | doc 05 rewritten as-built — the register recount (47, not 48), five build items added for the definition-of-done conditions the tree lacked, and one FINDING: the ledger's serialized writer is built, tested and composed by nothing (`createLedgerProjector` is called only from `tests/`), so exit criterion 6 is open rather than met
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

#### Rollback window, then closure {#rollback-window}
status: planned
doc: 05 §Rollback window, then closure · 05 §Stage summary · 05 §Exit criteria · ref:dashboard-surfaces §5

> Legacy code, tests and state intact; closure is its own later authorization. Nothing flips yet, so no window is open — and re-crossing is asymmetric: a launcher repoint before any native write, intent/ledger reconciliation and dedupe proof after one.

needs:
- cutover
- you: the closure authorization — deletion or retirement of the legacy repo is OUTSIDE this cutover and has no trigger, no elapsed-time rule and no automatic expiry (D89)

log:
- 2026-08-21 | docs-cohesion 05 | the section was a pointer paragraph; it now states what the window IS, what closes it, and why nothing has opened — the rollback bridge stays a `{#cutover}` build item rather than being duplicated here

#### Later, unplanned {#later-unplanned}
status: never
chip: ideas, not a hosted future
doc: 05 §Later, unplanned · ref:operator-trust §7 · ref:clock-config-secrets §6.1

> A cooperation / multi-user mode built on top of solo (D193) — the tier's one remaining item; the PACKAGING half ("web app → real app") LEFT this tier on 2026-08-21, when the operator made it the desktop stage (`{#desktop-app}`, R14). The LATER tier of D76's MUST / SHOULD / LATER sizing — what the stop-loss cuts FIRST — and it never blocks the cutover: doc 05 §Exit criteria names none of it.

log:
- 2026-08-21 | docs-cohesion 05 | filled as-built — the two D193(a) items carry no owner and no design (which is what separates them from a doc 04 deferral), the four D75 seams that keep them possible are built, and hosting is a decided refusal rather than a LATER item
- 2026-08-21 | docs-cohesion R14 | the packaging half is no longer LATER — the operator promoted it to `{#desktop-app}` / doc 06, which gives it the owner and the design a LATER item by definition lacks; the cooperation / multi-user item and the hosting refusal are untouched
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code
- 2026-08-21 | docs-cohesion clock-config-secrets | ref clock-config-secrets rewritten as-built (`80b03f1b`); `settings.json` has no producer; `mergeSettings` drops `override.browser`

## Phase 6 · Ship the desktop app {#desktop-app}
phase: Phase 6
status: planned
when: after the cutover | the operator may pull it earlier
size: L
chip: not started
doc: 06 §Stage summary · ref:frontend-backend-integration §6.9 · ref:execution-and-sessions
open: no

> R14/D297. The rebuild is DELIVERED as a Mac and Windows desktop app: Electron remains the shell because the installed product must own the BFF, workers, full Playwright Chromium, Duo extension, keychain boundary and ordered shutdown. V1 updates are signed, manual and in place; a controlled updater is deferred behind `{#def-desktop-update}`. What it INHERITS: D181's `server` role lock → single instance; `runtime-isolation.json`'s roots → app-data dirs (they are repo-relative off `process.cwd()` today); D189's byte path → the desktop loads the bundle from app RESOURCES; `{#parallel-runs}`' worker pool → the app's worker lifecycle; `{#duo-lease}`, because the desktop is where several workers on one machine become the ordinary case. Nothing is built: there is no Electron dependency at HEAD.

needs:
- cutover
- parallel-runs
- duo-lease

note: The order is "at the end" — but the operator may pull this stage IN FRONT of `{#cutover}` if the cutover should run on the packaged app. Until they do, `needs: cutover` stands.

log:
- 2026-09-01 | D297 | Electron retained; v1 signed manual in-place update and later controlled-updater boundary ratified
- 2026-08-21 | docs-cohesion R14 | phase drawn from the operator's instruction; nothing built

### 6A · Controlled desktop updates {#def-desktop-update}
status: planned
chip: v1 stays manual
doc: 04 §Controlled desktop updates · 06 §Packaging — signed installers for both operating systems

> D297. One installed machine updates v1 by running the newer signed installer IN PLACE, without uninstalling or clearing app data. A later updater may discover/download a signed release while open, but installation waits behind one fail-loud quiescence verdict and ordered shutdown.

builds:
- [ ] PROOF a signed older→newer manual upgrade on macOS and Windows preserves authority rows, artifacts, browser profiles, settings and OS-keychain credentials
- [ ] BE one desktop quiescence verdict that names active work and refuses, or proves there is no non-terminal run and no active worker/browser child
- [ ] BE ordered shutdown after that verdict — stop workers and browsers, stop the BFF, close storage handles and release locks before installer handoff
- [ ] BE only after those proofs: verify the signed release and apply it on a clean restart; never force-quit active work

needs:
- desk-package
- fact: the signed manual older→newer upgrade is proved on real macOS and Windows installations

log:
- 2026-09-01 | D297 | policy and trigger ratified; the manual upgrade proof and controlled update channel remain unbuilt

### 6B · Application shell {#desk-shell}
status: planned
date: R14 · 2026-08-21 · D297 · 2026-09-01
size: M
doc: 06 §Electron shell — the main process, the window, the single instance · ref:frontend-backend-integration §6.9 · ref:clock-config-secrets §3

> The main process boots the BFF as a managed CHILD process (recommended over in-process: D181's role lock is per-PID and `cli storage restore` composes its stopped-system proof from those files, a BFF crash must not take the window, and `src/cli.ts` is a command entry rather than a library). The window loads `dist/dashboard` from app resources; every runtime root resolves under `app.getPath("userData")` with `runtime-isolation.json`'s NAMES unchanged; a second launch focuses the open window; the app holds a power save blocker while any run is in flight.

builds:
- [ ] BE the Electron main process boots the BFF as a managed child under the single-instance lock, and a BFF that finds D181's `server` role lock held refuses by name
- [ ] BE every runtime root resolved under `app.getPath("userData")` instead of `process.cwd()` — `compose.ts:336-337` computes them repo-relative, and `operational-isolation` pins the names, not the resolution
- [ ] BE the app-version stamp `RunRecord` carries (D179) read from a source that survives packaging — `compose.ts:337-340` reads `join(repoRoot, "package.json")`, which is inside the asar
- [ ] FE the renderer loads `dist/dashboard` from app resources with an EXPLICIT API base — `src/dashboard/app/main.tsx:21` passes `window.location.origin`, which is the string `"null"` under `file://`; the transport already takes a `baseUrl`, so the fix is a decision, not a seam
- [ ] BE an application menu and keep-awake while any run is in flight — a machine that sleeps mid-run leaves a claim to be swept and a browser on a half-staged page
- [ ] DOCS the decision: in-process vs managed child, and how the app lock composes with the role lock

needs:
- desktop-app

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the child-process recommendation and the four obstacles are read out of the code at HEAD (`src/server/dashboard/compose.ts`, `src/domain/config/schema.ts:8`, `src/dashboard/app/main.tsx:21`)

### 6C · Worker lifecycle {#desk-worker}
status: planned
date: R14 · 2026-08-21
size: L
doc: 06 §Worker lifecycle — the pool the app owns · ref:execution-and-sessions §1 · ref:execution-and-sessions §3

> Workers become managed child processes started and stopped from the dashboard, which IS `{#parallel-runs}`' pool rather than a second scheduler. Playwright's full bundled Chromium and the vendored Duo Autopilot extension are shipped with the app or installed on first run into app data; profiles keep doc 05's `(worker, system, instance, configFingerprint)` partition with the root moved under app data; the Windows half is verified on real hardware.

builds:
- [ ] BE workers as managed child processes, started and stopped from the dashboard — `createDashboardWorkerSupervisor` refuses spawn by name today and tells the operator to run `npm run cli worker` (`src/server/dashboard/compose.ts:322-331`), which a packaged app cannot offer
- [ ] BE Playwright's FULL bundled Chromium available to a packaged app — shipped inside the installer or installed on first run into app data (the headless shell cannot load an extension, so there is no smaller option)
- [ ] BE the vendored `duo-autopilot/` extension placed under app data with `paths.duoExtensionDir` pointed at it — a hard runtime dependency of every authenticated login (D244)
- [ ] BE browser profiles under app data, keeping the `(worker, system, instance, configFingerprint)` partition
- [ ] PROOF Windows — the extension path, the profile root and the Chromium launch verified on a real Windows machine, not a VM
- [ ] BE a worker that dies is reported with its exit reason and its claim released through D200's lease-as-evidence sweep, never by guessing

needs:
- desktop-app
- parallel-runs

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; this node CONSUMES `{#parallel-runs}`' pool — a second supervisor over one authority table is the shape D200 warned about

### 6D · Credentials and keychain {#desk-secrets}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Credentials — the OS keychain behind the one reader · ref:clock-config-secrets §3

> `.env` becomes the macOS Keychain and the Windows Credential Manager, reached through `src/domain/secrets.ts` and nowhere else — the `secrets-single-source` guard does not move. The open design question is HOW a keychain (async, prompting) reaches a synchronous reader: populate each child's environment block at spawn, or give the reader a source seam. They differ in exposure, so it is a decision with a D-number. A first-run setup screen collects what is missing and names each credential it refuses without.

builds:
- [ ] BE the OS keychain as the credential source for a packaged app — macOS Keychain, Windows Credential Manager
- [ ] BE `src/domain/secrets.ts` stays the ONLY reader; `secrets-single-source.test.ts` unchanged
- [ ] BE the Duo credential (`paths.duoCredential`) moved into the same store, or its file placed under app data with the app's own protection — never plaintext inside the shipped bundle
- [ ] FE a first-run setup screen that names every credential it needs and refuses a workflow start by the name of the missing one
- [ ] BE widen `AbsolutePathSchema` for Windows paths — `src/domain/config/schema.ts:8` refuses anything not starting with `/`, and nine `paths.*` leaves use it, so a Windows build fails config resolution at the schema boundary (read-forward safe: every stored snapshot's POSIX path still parses)
- [ ] DOCS the decision: env-block injection vs a source seam inside the one reader

needs:
- desktop-app

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the POSIX-only path schema is a verified blocker for the Windows half and is filed here because it is what the keychain and the extension paths both trip over

### 6E · Signed installers {#desk-package}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Packaging — signed installers for both operating systems · ref:frontend-backend-integration §7.4

> electron-builder, with the dashboard bundle and `duo-autopilot/` as app resources. macOS: a signed and NOTARIZED dmg. Windows: a signed nsis or msix installer. The release version is D179's app-version stamp. D297: v1 updates are signed manual installers run IN PLACE; mutable state stays under the stable app-data/keychain roots; controlled update is LATER under `{#def-desktop-update}`.

builds:
- [ ] BE electron-builder configured, with `dist/dashboard` and `duo-autopilot/` as app resources
- [ ] BE macOS — a signed and notarized dmg
- [ ] BE Windows — a signed installer (nsis or msix)
- [ ] BE the release version IS D179's app-version stamp, not a second identity
- [ ] PROOF both installers upgrade an older installed version in place without uninstalling or losing authority rows, artifacts, profiles, settings or keychain credentials
- [x] DOCS D297 update boundary — v1 manual in-place; later discovery/download permitted while open; install/restart forbidden until the quiescence verdict and ordered shutdown complete
- [ ] PROOF the installer builds from a clean checkout by one command, and the gate family still runs against the source tree unchanged

needs:
- desktop-app
- desk-shell
- desk-worker
- desk-secrets

log:
- 2026-09-01 | D297 | Electron and the v1 manual update lane ratified; controlled update indexed at `{#def-desktop-update}`
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; signing is not optional on either OS because the app launches a second browser with an unpacked extension

### 6F · Packaged-app proof {#desk-proof}
status: planned
date: R14 · 2026-08-21
size: M
doc: 06 §Proof — a dry run from the packaged app on both operating systems · ref:guards-and-tests §10

> R10's T1 tier run from the INSTALLED app — a live `dryRun=true` workflow with its checkpoints asserted over authority — on macOS and on Windows, on real hardware. R10's T3 dashboard conditions attached, driven through the app's own window. The parity corpus re-rendered in the Electron renderer, because the operator's actual pixels are the ones the corpus exists to pin (D187). The recovery drill exercised through the app's own lock files, which are now what D181's stopped-system proof composes from.

builds:
- [ ] PROOF T1 — a full workflow dry run driven from the installed app on macOS, checkpoints asserted over authority and the result recorded durably
- [ ] PROOF T1 — the same on Windows, on real hardware
- [ ] PROOF T3 — a dashboard condition attached to that dry run and driven through the app's own window
- [ ] PROOF the parity corpus rendered in the Electron renderer (D187: a corpus photographed against the wrong surface records defects instead of catching them)
- [ ] PROOF `cli storage restore` drilled through the app's own runtime lock files (D181)

needs:
- desktop-app
- desk-package
- workflow-acceptance-close

log:
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; D329 routes the former `{#test-tiers}` dependency through `{#workflow-acceptance-close}` before packaged-app proof

<!-- roadmap:end -->

---

## Governance (the plan's own rules)

_Lifted from the master plan's §0 on 2026-08-20 (cohesion step 3a) — verbatim except
where a name moved: the design docs are now cited by slug under `docs/rebuild/reference/`. D323
restores one stable Phase 0–6 hierarchy;
D326 supersedes D323/D325's split lettered phase grammar with one decimal execution hierarchy for
Phases 0–3. D328 makes an admitted parallel wave visible through numeric task members.
D329 aligns Phase 3's active filenames to that decimal hierarchy and places all mutable authoring
and read-only acceptance before the immutable-candidate controlled proof.
The master plan itself was dissolved into those docs on the same day
(step 3b); its as-written record, with a section-by-section table of where everything went, is
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`._

### The one-plan rule

Per charter §"One master plan": the owning design docs (now `reference/task-contract`,
`reference/workflow-model`, `reference/dashboard-surfaces`, `reference/decisions`,
`reference/execution-and-sessions`, `reference/data-intake-and-edit-data`, and
`reference/write-safety` through `reference/frontend-backend-integration`) are the binding detail;
THE PLAN - this file, the tree, plus the admitted phase docs under `docs/rebuild/` - is the authoritative
build order. No second plan, no per-workflow "alt plan," no execution doc that re-sequences
phases. A candidate has no Phase 4 letter or migration plan. After D319/D323 admission, its lettered
Phase 4 part and workflow migration doc become children of this plan; they answer `ref workflow-model`
§1.6.2's admission packet and record what the workflow reuses/adds.

**D263 (2026-08-20) — the plan has a machine-readable form, and it is bound to the docs both ways.**
`docs/roadmap/roadmap.md`, written in the roadmap notation
(`docs/roadmap/notation.md`), is that form and the operator tracking view;
`docs/roadmap/index.html` is GENERATED from it by `npm run roadmap` and is never hand-edited. It is a
second VIEW of this plan, never a second plan — **the plan's prose wins on any disagreement**, and the
disagreement is CAUGHT rather than argued, because the binding is two-way and mechanical: every node
carries a `doc:` line naming the sections that own its contracts, every doc
section that describes a node carries `<!-- roadmap: <id> -->` under its heading, and the
`roadmap-doc-binding` guard refuses a ref or a tag that resolves to nothing — so a rename on either
side fails the gate instead of rotting. Three rules bind the tree itself. A `builds:` box is `[x]`
**only** for what is landed at HEAD, with its commit or D-number cited in the line — never pre-marked.
The tree never invents scope: an unplanned feature is a finding for `docs/findings/`, not a roadmap
line. D326 makes the hierarchy uniform: numbered phases are the only spine nodes; Phases 0–3 use
decimal parts; each part has one coordinator; each immediate numbered task is one supervisor
session; and checklist lines are that task's proof-bearing subtasks. The strict active order is
0.3 → 1.6 → 2.6 → 3.1 → 3.2 → 3.3 → 3.4. D328 gives admitted parallel peers one shared ordinal
and consecutive numeric members (`N-1`, `N-2`, ...); a serial task remains `N`, and the hyphen is
part of one task identity rather than another hierarchy level. Parallel execution begins only after
each member receives its exact feature branch, absolute worktree, artifact scope, gate and
integration order in the coordinator ledger. D329 makes 3.2 the last mutable workflow part and its
final task an independent exact-candidate freeze; 3.3 performs no development and may exercise
controlled writes only against that unchanged candidate. Session work is recorded only where it happened in
append-only per-node `log:` blocks, so history never competes with the plan on the spine.

### D1 ownership map — the quick index (concept → owning doc)

Every concept has exactly one owner (`reference/decisions` D1). Reference the owner; never redefine.
The rows below are the same map the master plan's §0.2 carried, re-pointed to the shelf's new names.

| Concept | Owner |
|---|---|
| Task contract (`defineTaskContract`/`defineTask`), contract/impl split (D3), task-namespace grammar + closed `SystemId` union (D2), error taxonomy, three effects/dry-run mechanics, retry, decoration, system/service stores + pure workflow mini-stores, session providers + login signature, `stores/common/` leaf homes | **`reference/task-contract`** (was doc 01) |
| Workflow builder API (single), descriptor shape, `RunEnvelope`, run-state machine incl. gates/parks (D5), checkpoint/resume + freshness walk (D8), label precedence (D16) | **`reference/workflow-model`** (was doc 02) |
| Span/event wire schema (D10), notes stream, storage layout, SQLite projection role (D14), SSE wire shapes, completion (fan-out/approval) union (D11), cross-repo runtime boundary + one-time import rules (D88/D89/D93), the ONE run lifecycle authority and run/queue projection every count reads (D81/D327), run versioning + major-only archive-on-bump (D80/D274), run display names (D83) | **`reference/dashboard-surfaces`** (was doc 03) |
| Binding cross-doc reconciliation (D1–D118, through 2026-08-02 Round 18) | **`reference/decisions`** (was doc 04) |
| One-item workers, queue dispatch/backpressure, explicit browser-session boundaries + driver leases, speed/sleep-tax contract, page/subject-isolation invariant | **`reference/execution-and-sessions`** (was doc 05) |
| Data-service systems: CSV/PDF extraction, typed contact/address normalization, roster matching, operator column mapping, immutable intake manifest/rerun, Edit Data checkpoint UI | **`reference/data-intake-and-edit-data`** (was doc 06) |
| Cross-cutting gap findings memo (owns nothing — a design input) | **`reference/foundation-gap-audit`** (was doc 08) |
| Write-safety contract, permanent-key intents, typed proof, atomic outboxes/recovery, serialized anchored ledger | **`reference/write-safety`** (was doc 09) |
| Guard/test architecture suite: ratchet port map, safety guards, descriptor-coverage crosswalk, guard-of-guards manifest, TDD tiers, stub + live lanes | **`reference/guards-and-tests`** (was doc 10) |
| The Clock (sole time source), config/settings/source catalog and protected local root (D327; exact design active in 0.3), per-run prod/test instance (D6-adjacent), fiscal-year rollover, secrets accessor, environment/preflight registry | **`reference/clock-config-secrets`** (was doc 11) |
| Semantic UI vocabulary + typed drivers, failures/diagnostic bundles/evidence receipts, scenario corpus, structured knowledge/fix history, durable trust/explain surfaces, workflow explorer/editor, local-first seams/safety floor, base capability inventory | **`reference/operator-trust`** (was doc 12) |
| Production dashboard composition boundary: bootstrap/day/detail resources, one typed client, cursor-based SSE, product command-family coverage, surface-to-authority matrix, visual-parity harness | **`reference/frontend-backend-integration`** (was doc 13) |

The operator's vision and the non-negotiables stay `reference/charter` (was doc 00). The PLAN half —
phases, tasks, exit criteria, the migration order, the deferrals and the cutover — is this file plus
the phase docs under `docs/rebuild/`, one per tree phase: `00-design-the-foundation` ·
`01-build-the-spine` · `02-prove-writes-build-the-tails` · `03.1-finish-the-dashboard` ·
`03.2-finish-workflow-authoring` · `03.3-accept-person-lookup-and-separations` · `03.4-co-operate-with-claude` ·
`04-close-the-deferrals` · `05-cut-over` · `06-ship-the-desktop-app`.

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

_D326 (2026-09-03) fixes one visible hierarchy for Phases 0–3: numbered phases, decimal parts,
numbered supervisor tasks, and checklist subtasks. D328 (2026-09-04) renders admitted parallel
waves as consecutive numeric task members (`N-1`, `N-2`, ...). Their strict active order is 0.3 → 1.6 → 2.6 →
3.1 → 3.2 → 3.3 → 3.4. D319 still requires verification and operator approval before a
candidate receives its next Phase 4 letter._

| Phase | Headline deliverable | Gate to exit | Size |
|---|---|---|---|
| **0** | 0.1 charter/safety · 0.2 governance · **0.3 canonical authority design** | 0.1–0.2 historical evidence retained; **0.3 active** until run/settings contracts, migration/recovery and 1.6 briefs close | **M** |
| **1** | 1.1–1.5 historical spine · **1.6 canonical authority implementation** | historical live spine proof remains MET; 1.6 waits for 0.3, then stores/writers/core resolution and compatibility deletion must pass | **XL** |
| **2** | 2.1–2.5 historical write/tails proof · **2.6 downstream revalidation** | D135 remains the controlled-write evidence; 2.6 waits for 1.6, then read models/joins/services must reconcile without rewriting evidence | **XL** |
| **3** | 3.1 shared dashboard · 3.2 Separations · 3.3 workflow authoring and acceptance · 3.4 Codex/Claude cooperation | 3.1 waits for 2.6 and closes every generic journey; each later part closes/reconciles before the next; 3.4 closes Phase 3 | **XL** |
| **4** | Remaining workflow migrations, one verified workflow per lettered part: 4A, 4B, 4C and onward | each candidate's current behavior and proposed workflow are verified; operator approves the D319 packet before implementation scope is assigned | **per workflow** |
| **5** | 5A cutover readiness · 5B one all-at-once production authority switch (D89) | every admitted workflow/shared capability ready; legacy enqueues stopped; active/uncertain work reconciled; both states backed up; launcher switches atomically; rollback verified | **L** |
| **6** | Ship the rebuild as a Mac and Windows desktop application (`doc 06`) | installable on both systems; signed upgrade preserves state; installed-app live proof; credentials remain protected | **L** |

**Reading the Size column.** These are relative build sizes, not calendar — the calendar depends
on session cadence, which the plan does not own. The unit is *work sessions of the kind this
program actually runs in*: **S** ≈ 1, **M** ≈ 2–4, **L** ≈ 5–10, **XL** ≈ 10+. They expose
delivery risk and help keep a long coexistence program tractable. Per-item sizes are in `doc 00` §Size model + delivery tiers; they are estimates
offered for correction, not commitments. A Phase 4 part carries no size until its workflow boundary
has passed admission. Phase 5A readiness items remain sized individually.

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
| §7.1's approved-target bullet · §7.3 the integration execution rule | `docs/rebuild/03.1-finish-the-dashboard.md` |
| §3.1's PHASE 3 ENTRY block + separations' status | `docs/rebuild/03.2-finish-workflow-authoring.md` and `docs/rebuild/03.3-accept-person-lookup-and-separations.md`; former layout preserved under `docs/rebuild/history/superseded/` |
| §3.1 the migration loop · §3.2 · §3.3 · §3.4 · §3.6 · §3.8 | ref workflow-model §1.6.2–§1.6.3 and docs 03.2–03.3; former layout preserved under `docs/rebuild/history/superseded/` |
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
