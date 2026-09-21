# HR Rebuild Roadmap
<!-- `docs/roadmap/roadmap.md` is the plan as written, in the roadmap notation (see docs/roadmap/notation.md): everything between roadmap:start and roadmap:end renders at docs/roadmap/index.html via `npm run roadmap`; appendices after roadmap:end are prose. Per D263 (§Governance below) a node also carries `doc:` — the docs/rebuild sections owning its contracts — and a `log:` block, the append-only history kept in the detail drawer rather than on the phase spine. -->
asOf: 2026-09-19
head: 438bd311f
eyebrow: hr-automation-rebuild · the plan · source: docs/roadmap/roadmap.md
source: Stems from phase docs `docs/rebuild/00`–`06` (§Phases at a glance below, D323 phase hierarchy, `00`'s size model)
source: `9993ab39^:docs/plans/2026-08-18-separations-completion-and-dashboard-generalization.md` (historical Tracks 0/A/B/C)
source: `9993ab39^:docs/plans/2026-08-20-dashboard-architecture-audit.md` (historical Track D) · the phase docs win on any disagreement
footer: Generated from `docs/roadmap/roadmap.md` (the plan, written in the roadmap notation) by `npm run roadmap` — edit the plan, never this file; plan, site and owning docs move together — notation: `docs/roadmap/notation.md`.
> The ground-up rebuild of UCSD's UCPath HR automation, as a tree. Historical Phases 0–2 remain evidenced, but the authority model is deliberately reopened at **0.3** before **1.6** implements it, **2.6** revalidates the tails, and **3.1** completes the dashboard journeys required by admitted workflows (D339 defers optional screens). **3.2** then finishes workflow authoring and freezes one audited candidate, **3.3** accepts Person Lookup and Separations against that exact candidate, **3.4** offers optional document tools and AI assistance, and **3.5** finishes Codex/Claude cooperation. Optional 3.4 never blocks the required sequence. Phase 4 migrates the remaining workflows one part at a time. Phase 5 prepares and performs the all-at-once cutover. Phase 6 ships the desktop application. Legacy stays the sole production authority until Phase 5's switch.

tiles:
- Historical completion | 0.1–0.2 · 1.1–1.5 · 2.1–2.5 | evidence retained; runtime marker still reports `completedThrough: 2j`
- Complete | Phase 2.6 | final candidate independently accepted, integrated locally and cleaned up
- Next | Phase 3.1.9 · dashboard boundaries | 3.1.8 accepted; numbered task order includes each group finalization
- Decisions | D1–D344 | D326 normalizes Phases 0–3 · D327 fixes the one-source run/settings outcomes · D330 fixes the run-record lifecycle contract (0.3 Task 1) · D331 fixes the settings catalog and protected root (0.3 Task 2) · D332 fixes the authority upgrade, adapters and recovery (0.3 Task 3) · D328 renders parallel peers as numeric wave members (`9-1`, `9-2`) · D329 puts authoring/freeze before controlled acceptance · D336/D337 consolidate ordinary settings and appearance overrides in SQLite · D338 gives agents full API capability parity · D339 defers optional release screens · D342 adds optional 3.4 document tools and moves cooperation to 3.5 · D344 uses tangible tasks and explicit Parallel labels from 3.2; full gates at phase exit · D131 retired, never reused
- Gates | current source authority | open the active part for exact completion evidence and remaining gates
- !Critical-path blocker | Separations controlled proof | D329 holds every write behind 3.2's independent candidate audit and 3.3's exact-candidate admission. Historical 4589 remains inspection-only; the bounded authorization must name the candidate, fingerprints, disposable targets, disposition, and sequence, and expires on drift, failure, or UNKNOWN

<!-- roadmap:start -->

## Phase 0 · Design the foundation {#phase-0}
phase: Phase 0
status: done
when: 2026-07-31 historical · reopened 2026-09-03 at 0.3 · 0.3 closed 2026-09-04
size: M
chip: 0.1–0.3 evidenced · closed 2026-09-04
doc: 0 §Phase summary · 5B §Stage summary · ref:charter · ref:decisions
open: yes

> Historical Phase 0 fixed the charter, safety boundary, plan ownership, delivery model, and cutover shape. D326 reopens design only at 0.3 so the run and settings authority model is decided before implementation work can override Phase 1 and Phase 2 foundations.

builds:
- [x] DOCS the plan SSOT — fourteen reconciled design docs, each owning its contracts (the shelf is now `00`–`05` + `reference/`, D263)
- [x] DOCS the decision changelog `reference/decisions` as a pointer index
- [x] DOCS separation identity authority designed (historical D77 ALWAYS-GATE; current D309 source condition; ref write-safety §14)
- [x] DOCS size model + MUST / SHOULD / LATER delivery tiers (D76)
- [x] DOCS two-repo coexistence + one cutover (D88–D94)

log:
- 2026-09-04 | C31da5310 close | 0.3 closed: D330 run-record contract, D331 settings catalog/root, D332 authority upgrade/adapters/recovery, and the 1.6/2.6/3.1 bindings landed by supervisor runs R01–R04; Phase 0 is complete again and 1.6 is the active part
- 2026-09-03 | D326/D327 authority reset | 0.1–0.2 keep their completed evidence. 0.3 is the earliest active subphase and owns the run-record and settings authority contracts, migration boundary, recovery model, and implementation briefs; no runtime code changes until it closes
- 2026-08-25 | test-tiers | Phase 0 remains DONE; of its two later-unbuilt promises, D85 is now built under R10's `cli dry-run-scenario` + `config/test-subjects.json` + durable-result names. D79's scaffold generators are the one remaining promise (new-workflow owned by `def-explorer-edit`, new-task unowned and reported)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

### 0.1 · Product charter and safety boundaries {#phase0-charter}
status: done
date: 2026-07-31
doc: 0 §Phase summary · 0.1 §0.1 · Product charter and safety boundaries · ref:charter · ref:write-safety §1

> Fix the product purpose, fail-loud safety boundary, one-cutover rule, repository isolation, and the identity-authority model before implementation.

builds:
- [x] DOCS product charter and operator non-negotiables
- [x] DOCS fail-loud write-safety boundary and one all-at-once cutover
- [x] DOCS two-repository coexistence and rollback authority
- [x] DOCS separation identity authority

#### 1 · Fix the charter and authority boundary {#phase0-charter-boundary}
status: done
doc: 0 §Phase summary · ref:charter · ref:write-safety §1

builds:
- [x] DOCS name the legacy runtime as sole production authority until cutover
- [x] DOCS require failures and unknown outcomes to remain visible rather than defaulted
- [x] DOCS keep design, implementation, proof, and operator authorization distinct

#### 2 · Design separation identity authority {#phase0-always-gate}
status: done
date: D77 → D309 · ref write-safety §14
doc: 0.1 §Task 2 · Design separation identity authority · ref:write-safety §14 · ref:write-safety §14.1 · ref:write-safety §14.3 · ref:write-safety §14.9 · ref:workflow-model §4

> Current D309: an independently supplied EID proceeds only after exact UCPath read-back; any name-resolved EID requires the real operator gate regardless of similarity. Historical D77 designed the unconditional predecessor.

log:
- 2026-09-02 | D309 | operator correction ratified in ref write-safety §14.12: source-conditioned authority supersedes D77's trigger; machine verification creates no human result, while every name-resolved identity uses the existing typed gate
- 2026-08-21 | docs-cohesion 00 | the design D77 wrote here is BUILT and live-proved (D202, separations chunk 3, first live gated run 2026-08-12) and four decisions have moved it since — D203 a gate row IS a dependency's evidence, D204 the receipt derives from it, D211 the packet carries the write plan so a date that moves re-opens the gate, D226 all three ceremonies exist. §14.7's two deferred values were ANSWERED at the separations questionnaire on 2026-08-12 (freshness 4 hours; the I-9 packet question out of scope) while `ref write-safety` §14.7 still reads as open — a finding for that doc's unit, not fixed here. Left: §14.4's manual-EID arm is built narrower than designed (no second live read in that chunk)

### 0.2 · Delivery governance and plan structure {#phase0-governance}
status: done
date: 2026-07-31 → 2026-09-03
doc: 0.2 §0.2 · Delivery governance and plan structure · ref:task-contract §2.7

needs:
- phase0-charter

> Fix the one-plan rule, ownership boundaries, phase order, delivery tiers, and the unit by which work may be dispatched and proven.

builds:
- [x] DOCS one-plan rule and contract ownership map
- [x] DOCS size model and delivery tiers
- [x] DOCS visible phase/part/task hierarchy and supervisor-sized execution units

#### 1 · Establish the one-plan and ownership rules {#phase0-plan-governance}
status: done
doc: 0.2 §0.2 · Delivery governance and plan structure · ref:decisions

builds:
- [x] DOCS roadmap tree, admitted phase docs, and reference specs have non-overlapping authority
- [x] DOCS decisions land in their owning contract with a pointer in the decision changelog
- [x] DOCS generated roadmap site is checked against its source

#### 2 · Fix the spine order and deferred proof gates {#phase0-build-order}
status: done
doc: 0.2 §0.2 · Delivery governance and plan structure · 0 §Exit criteria · ref:charter §Process

builds:
- [x] DOCS D74's narrow spine plus live exit, with the deferred tails preserved
- [x] DOCS D92's owner, evidence, and resolution-point rule for deferred live probes
- [x] PROOF later phases executed the order without silently dropping a deferred capability

#### 3 · Prove executable feasibility and record the gate baseline {#phase0-feasibility}
status: done
doc: 0 §Exit criteria · ref:guards-and-tests §1

builds:
- [x] PROOF executable feasibility spike over the highest-risk type and storage assumptions
- [x] DOCS keep feasibility evidence distinct from implementation evidence
- [x] DOCS record the honest lint/test baseline and its later dispositions

#### 4 · Fix the size model and delivery tiers {#phase0-size-model}
status: done
date: D76 · doc 00 §Task 4 · Fix the size model and delivery tiers
doc: 0.2 §Task 4 · Fix the size model and delivery tiers · ref:task-contract §2.7

> MUST (the spine) · SHOULD (Phase-2 tails) · LATER (explorer, advisories, catalog) — what may slip without invalidating the base.

log:
- 2026-08-21 | docs-cohesion 00 | D76's model is LIVE, not history — all 24 items it sized carry the same `size:` on their node today, unchanged and never re-estimated, and the five phase-level sizes agree with §Phases at a glance. All three tiers shipped whole (MUST in phases 1–2, SHOULD in 2g/2h, LATER all five in 2i BEFORE Phase 3), so the fallback shape the tiers define has never been exercised. D79's trims all held except its last sentence: the `scaffold` generators the lightweight tier was ratified with do not exist. Five nodes minted since D76 are sized in its unit and were never in its table — `dash-defaults` `duo-lease` `parallel-runs` `observed-logs` `test-tiers`

### 0.3 · Redesign single-source runtime authority {#phase0-authority-reset}
status: done
date: 2026-09-03 → 2026-09-04
size: M
chip: closed 2026-09-04
doc: 0.3 §0.3 · Redesign single-source runtime authority · ref:dashboard-surfaces §2.3 · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4

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
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 (later) | the one product-truth item is ruled (option A) and landed inside D330 as a dated amendment; no NEEDS COORDINATOR item remains open · left: the coordinator's phase roll-up only

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
doc: 0.3 §0.3 · Redesign single-source runtime authority · 1.6 §1.6 · 2.6 §2.6 · 3.1 §Reopened completion tasks · ref:guards-and-tests §5.2

builds:
- [x] PROOF adversarially review run identity, concurrent queue mutation, settings revision conflicts, recovery, and redaction — R04 cross-contract table (twelve scenarios a–l; `reports/r04.md`); fixes in ref dashboard-surfaces §D332.3/§D332.4/§D332.5/§D332.6/§D332.11 M25–M27/§D330.8/§D330.11 #16, ref clock-config-secrets §D331.3/§D331.6/§D331.11 P41, ref guards-and-tests §5.2, ref lessons
- [x] DOCS resolve every open authority decision in its owning reference spec and decision pointer — the resolved-decisions checklist in `reports/r04.md`; no new decision minted; one item (operator `cancel` of a claimed run, §D330.5) deferred to the coordinator as product truth
- [x] DOCS bind each 1.6 task to one implementation seam, gate, integration order, and deletion test — doc 01 §1.6 (serial floor · wave `2-1`/`2-2` · serial 3–7; 94 proofs assigned once each) and roadmap `p1f-floor`, `p1f-*`
- [x] DOCS confirm 2.6 and 3.1 consume the new contracts without redesigning them — dated notes in doc 02 §2.6 (intro + Tasks 1–5) and doc 03.1 (Tasks 9-2, 9-3, 11-1, 11-2, 11-3, 12-1, 12-2); contract citations on the thirteen nodes' `doc:` lines

needs:
- phase0-authority-migration-design

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | closed: cross-contract adversarial review (11 fixes landed, 1 NEEDS COORDINATOR), residue checklist, 1.6 binding with the floor + wave ruling, 2.6/3.1 consumption notes; design gate green in the run worktree · left: the coordinator's `cancel` ruling in §D330.5 before 1.6 Task 4
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 (later) | the twelfth finding (operator `cancel` of a claimed run) ruled option A by the coordinator and landed in §D330.3/§D330.5/§D330.11 #27; 12 of 12 closed · left: nothing

## Phase 1 · Build the platform spine {#phase-1}
phase: Phase 1
status: active
when: 07-31 → 08-04 historical · reopened 2026-09-03 at 1.6
size: XL
chip: 1.1–1.5 evidenced · 1.6 active
doc: 1 §Phase summary · 0.1 §0.1 · Product charter and safety boundaries · ref:operator-trust §0 · ref:frontend-backend-integration §0 · ref:write-safety §1 · ref:write-safety §7 · ref:clock-config-secrets §5
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
doc: 1.1 §1.1 · Guardrails and strict domain · ref:guards-and-tests §2 · ref:guards-and-tests §1.1 · ref:clock-config-secrets §2 · ref:clock-config-secrets §3 · ref:clock-config-secrets §6 · ref:task-contract §2.1.1 · ref:dashboard-surfaces §5 · ref:operator-trust §2 · ref:frontend-backend-integration §3

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
doc: 1.1 §Task 1 · Land guardrails and baselines (COMPLETE 2026-07-31) · ref:guards-and-tests §2

builds:
- [x] BE guard plumbing and reviewed guard inventory
- [x] DOCS capability, provenance, and coverage baselines
- [x] PROOF every guard arm fails on its violating fixture

#### 2 · Build the strict domain leaf {#p1a-domain}
status: done
doc: 1.1 §Task 2 · Build the strict domain leaf (COMPLETE 2026-07-31) · ref:task-contract §2.1.1 · ref:clock-config-secrets §2

builds:
- [x] BE strict schemas and branded ids at every authority boundary
- [x] BE clock, configuration, secrets, paths, and runtime isolation foundations
- [x] PROOF typecheck, lint, unit, architecture, and coverage gates

### 1.2 · Durable authority and workflow model {#p1-authority}
status: done
date: 2026-08-01
size: XL
doc: 1.2 §1.2 · Durable authority and workflow model · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.4 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §4 · ref:operator-trust §1 · ref:task-contract §2 · ref:task-contract §2.7 · ref:workflow-model §3 · ref:operator-trust §1.7 · ref:dashboard-surfaces §2 · ref:write-safety §2 · ref:clock-config-secrets §4 · ref:clock-config-secrets §6.2

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
doc: 1.2 §Task 1 · Build durable storage and recovery (COMPLETE 2026-08-01) · ref:operator-trust §1

builds:
- [x] BE SQLite authority, migrations, backup, doctor, degraded mode, and restore interlock
- [x] BE command and proof union type shells
- [x] PROOF corruption, recovery, and stopped-system constraints

#### 2 · Build store, task, and driver contracts {#p1b-contracts}
status: done
doc: 1.2 §Task 2 · Build store, task, and driver contracts (COMPLETE 2026-08-01) · ref:task-contract §2

builds:
- [x] BE semantic UI registry and typed system drivers
- [x] BE task/store contracts and authoring tiers
- [x] PROOF selector provenance and contract validation

#### 3 · Build the workflow definition model {#p1b-workflow-model}
status: done
doc: 1.2 §Task 3 · Build the workflow definition model (COMPLETE 2026-08-01) · ref:workflow-model §3

builds:
- [x] BE workflow DAG, delegation, completion program, and descriptor
- [x] BE compile-time graph and mini-store checks
- [x] PROOF descriptor fingerprints and type-level workflow cases

### 1.3 · Execution kernel and write safety {#p1-kernel}
status: done
date: 2026-08-02 → 03
size: XL
doc: 1.3 §1.3 · Execution kernel and write safety · ref:workflow-model §1.3 · ref:workflow-model §2 · ref:workflow-model §4 · ref:dashboard-surfaces §2.4 · ref:execution-and-sessions §3 · ref:execution-and-sessions §4 · ref:execution-and-sessions §4.1 · ref:write-safety §3 · ref:operator-trust §2.1 · ref:frontend-backend-integration §3.4 · ref:write-safety §3.3

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
doc: 1.3 §1.3 · Execution kernel and write safety · ref:workflow-model §2 · ref:execution-and-sessions §3

builds:
- [x] BE one workflow-module composition root
- [x] BE queue claim, heartbeat, lease, retry, and terminal transitions
- [x] BE start-plan, provider, and actor admission

#### 2 · Build sequenced write authority {#p1c-write-safety}
status: done
doc: 1.3 §1.3 · Execution kernel and write safety · ref:write-safety §3

builds:
- [x] BE probe, prepare, binding proof, fence, commit, verification, and outbox sequence
- [x] BE content-proven authenticated sessions and Duo handling
- [x] PROOF no write-capable callback can bypass the sequencer

### 1.4 · Projection, BFF, and operator shell {#p1-spine}
status: done
date: 2026-08-04
size: M
doc: 1.4 §1.4 · Projection, BFF, and operator shell · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.2 · ref:dashboard-surfaces §9.5.2 · ref:frontend-backend-integration §3 · ref:frontend-backend-integration §6.2 · ref:frontend-backend-integration §6.3 · ref:frontend-backend-integration §7.1 · ref:dashboard-surfaces §1 · ref:frontend-backend-integration §3 · ref:clock-config-secrets §3

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
doc: 1.4 §Task 1 · Build spans and the shared projection (COMPLETE 2026-08-04) · ref:dashboard-surfaces §1

builds:
- [x] BE append-only span emission and reducer
- [x] BE one day/run projection for every dashboard consumer
- [x] PROOF cross-process replay and resumable cursor behavior

#### 2 · Build the BFF and first operator shell {#p1d-shell}
status: done
doc: 1.4 §Task 2 · Build the BFF and first operator shell (COMPLETE 2026-08-04) · ref:frontend-backend-integration §3

builds:
- [x] BOTH bootstrap, day, run-detail, command, and event routes over one typed client
- [x] FE Person Lookup shell in both themes
- [x] PROOF accessibility and screenshot parity

### 1.5 · Live foundation proof {#p1-exit}
status: done
date: D74 · 2026-08-04
doc: 1.5 §1.5 · Live foundation proof · 1 §Exit criteria · ref:workflow-model §8 · ref:workflow-model §8.1

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
doc: 1.5 §1.5 · Live foundation proof · 1 §Exit criteria

builds:
- [x] PROOF Person Lookup against live UCPath and CRM
- [x] PROOF dead-session recovery and terminal completion at attempt two
- [x] PROOF all four surfaces agree from one projection

### 1.6 · Implement canonical run and settings authorities {#p1-authority-implementation}
status: done
date: 2026-09-08
size: XL
doc: 1.6 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §2.3 · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §9.2 · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2 · ref:frontend-backend-integration §4

> Implement D330/D331/D332 with the operator-approved D336 storage amendment: Task 6 consolidates ordinary settings in SQLite and leaves credential operations independent. Every task is one supervisor seam bound in doc 01 §1.6 to its files, gate, proofs and deletion test. R04 (0.3 Task 4) ruled the original Tasks 1 and 2 NOT independent as written — both add schema steps and would bump `CURRENT` twice — so the part is re-sliced: Task 1 lands the one serial schema floor, and Tasks 2-1 (run-record service) and 2-2 (settings catalog/root) run as a D328 wave from the master that contains Task 1's merge; the 1.6 coordinator records that base SHA and both worktrees before dispatch. Tasks 3–7 run serially in order. No other pair is a wave.

builds:
- [x] BE one canonical SQLite-backed run-record service with typed CRUD/CAS lifecycle operations
- [x] BE one settings catalog with ordinary settings in SQLite, independent credentials (D336), and private canary inputs outside Settings (D341)
- [x] BE migrate lifecycle/configuration writers and core runtime consumers; Phase 2.6 owns downstream read models and Phase 3.1 owns Settings UI behavior
- [x] PROOF upgrade, rollback, recovery and full foundation regression; compatibility isolated with explicit A0/A1/A2/A3 deletion handoff to 2.6

needs:
- phase0-authority-design-close
- p1-exit

log:
- 2026-09-08 | Task 1.6.7 close | complete R3 PASS, no-ff integration `9b12f2e8`, all full integration/live gates passed; settings restored at revision 8 and owned cleanup verified. Phase 1.6 complete; downstream 2.6 unstarted.
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound every task to one seam/gate/order/proof set/deletion test in doc 01 §1.6; re-sliced into serial floor + wave 2 (`2-1`/`2-2`) + serial 3–7 after the cross-contract review proved the schema coupling · left: the coordinator's `cancel`-of-a-running-run ruling before Task 4 (R04 report, NEEDS COORDINATOR)
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 (later) | the `cancel`-of-a-claimed-run ruling landed (option A, §D330.5 request arm, §D330.11 #27); no open ruling remains before Task 4 · left: implementation from Task 1
- 2026-09-04 | phase-1-6 run-record Task 2-1 | canonical service candidate `bc82fe47` accepted, evidence commit `bb98dabc` merged `--no-ff` as `49120609`, and integration gates/cleanup passed; v31 preserves relaunch lineage across archived-source deletion · left: Task 2-2 and serial Tasks 3–7

#### 1 · Land the schema floor {#p1f-floor}
status: done
date: 2026-09-04
doc: 1.6/task-1-land-the-schema-floor · 1.6 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §2.5 · ref:dashboard-surfaces §2.3

builds:
- [x] BE one migration `v30 = floor` carrying every D332 schema step (`deleted_runs` ordinals + `ordinal_source` with the re-created trigger, `checkpoint_payloads_never_deleted`, `protected_settings_current`, `authority_upgrades`) and the frozen D290 27/28/29 literals in the same commit as the `CURRENT` bump
- [x] BE the `#runMigrations` floor gate, the read-only no-migrate open for `storage backup|doctor` and the upgrade preflight, `upgrade-required` on every other door, the `baseline` journal row at D321 regeneration, the `protectedSettingsCurrent` repository
- [x] PROOF M3 (open half), M9, M21, the `baseline` matrix cell; the `planned` `no-lifecycle-sql-outside-the-adapter` entry

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | node created: the serial floor the wave branches from (doc 01 §1.6 Task 1) · left: everything
- 2026-09-04 | phase-1-6-authorities C161eaed0 R01 | merged the v30 floor, no-migrate preflight modes, baseline journal, protected singleton, tombstone forward shape and dashboard lock-release wrapper at `ebc41c45`; integrated typecheck/lint/coverage/manifest gate green, supervisor worktree/ref/task closed · left: wave 2 and serial Tasks 3–7
- 2026-09-04 | execute-phase-1-6-from C858cc3dc R01 | independently verified inherited work and closed M9/M21 proof gaps at `5b1fb626`; 411 files / 5,040 tests and 269 assertion-only parity tests pass with unchanged references; supervisor lifecycle fully closed; receive proof source-pinned at `c77d2b76^:docs/coordinator/execute-phase-1-6-from-c858cc3dc/reports/r01-receive.md` · left: wave 2 and Tasks 3–7

#### 2-1 · Implement the canonical run-record service {#p1f-run-store}
status: done
date: 2026-09-04
doc: 1.6/task-2-1-implement-the-canonical-run-record-service · 1.6 §1.6 · Implement canonical run and settings authorities · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.3 · ref:execution-and-sessions §3

builds:
- [x] BE `src/core/run-record-service.ts` + the lifecycle repositories: the §D330.5 operation set with named refusals, three-way `read`, ordered `list`, the two-source watermark
- [x] BE one-transaction first-eligible claim with the full token, claim fence vs. operator CAS, composite terminalize, D308 tree delete behind the tombstone with gate records and `ordinal_source = tombstone`
- [x] PROOF §D330.11 #1–#23, #25, #26 and P33's claim half over the real service; deletion tests #16 and #25

needs:
- p1f-floor

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | relabelled 2-1 (wave 2 peer) and bound to its seam; owes 25 of §D330.11's 26 proofs (#24 is Task 4's) · left: implementation
- 2026-09-04 | execute-phase-1-6-from C858cc3dc R02 | started the declared wave from common verified base `d2fe05dd`; exact task/worktree/branch and allowance source-pinned at `c77d2b76^:docs/coordinator/execute-phase-1-6-from-c858cc3dc/supervisors.json` · left: implementation, assigned proofs and complete lifecycle
- 2026-09-04 | direct phase plan | prior R02 stopped during intake with no candidate and its temporary evidence was removed; approved one-supervisor focused plan in doc 01 §1.6 Task 2-1: `codex/phase-1-6-run-record` at `/Users/julianhein/Projects/hr-worktree-run-record`; operator-approved feasibility correction adds only `v31` so deleting an archived source retains the live descendant's relaunch lineage; start waits for one recorded common wave SHA containing both approved peer plans · left: implementation from that verified base
- 2026-09-04 | direct supervisor close | accepted candidate `bc82fe47` after independent review and corrections, merged evidence commit `bb98dabc` as `49120609`, then passed typecheck, lint, 5,082 coverage tests, manifest, 745 architecture tests and 269 unchanged parity tests; branch/worktrees removed, no push · left: Task 2-2 integrates next

#### 2-2 · Implement the settings catalog and protected root {#p1f-settings-store}
status: done
date: 2026-09-05
doc: 1.6/task-2-2-implement-the-settings-catalog-and-protected-root · 1.6 §1.6 · Implement canonical run and settings authorities · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2 · ref:frontend-backend-integration §4

builds:
- [x] BE one leaf catalog (`src/domain/config/catalog.ts`) and the revisioned `.tracker/settings/` root with two documents, one lock, two CAS arms and write-only protected values
- [x] BE move username, password, timekeeper identity, local canary inputs, display overrides, timeouts, paths, worker defaults, and all other operator-managed non-provider-key configuration out of `.env`; delete adapters A4 and A5 in this task
- [x] BE leave only provider API keys in `.env`; keep D324's probed host display as the catalogued default when no override exists; expose protected settings as presence/revision, never plaintext; `manifestVersion` 2 backup write shape
- [x] PROOF §D331.11 P1–P15, P17–P19, P21–P32, P33 protected half, P34–P39, P41 and M14's schema half; `settings-catalog` guard active; `npm run test:parity` unchanged (A8)

needs:
- p1f-floor

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | relabelled 2-2 (wave 2 peer) and bound to its seam; never edits `migrations.ts` or `authority-database.ts` (Task 1 landed the singleton) · left: implementation
- 2026-09-04 | execute-phase-1-6-from C858cc3dc R03 | started the declared wave from common verified base `d2fe05dd`; exact task/worktree/branch and allowance source-pinned at `c77d2b76^:docs/coordinator/execute-phase-1-6-from-c858cc3dc/supervisors.json` · left: implementation, assigned proofs and complete lifecycle
- 2026-09-04 | direct phase plan | approved one-supervisor focused plan in doc 01 §1.6 Task 2-2: `codex/phase-1-6-settings` at `/Users/julianhein/Projects/hr-worktree-settings`; the minimal Settings producer adaptation preserves the eight-leaf surface and unchanged parity while implementing D331.5's leaf-operation wire; start waits for one recorded common wave SHA containing both approved peer plans · left: implementation from that verified base
- 2026-09-05 | direct supervisor close | accepted candidate `0e38b82f` after 5 independent review rounds and fixes, merged as `33d6a6e9` / `0a8173e0`, restored to master with full gates passing; Task 2-2 complete · next: Task 3

#### 3 · Cut over executor and worker lifecycle writers {#p1f-run-writers}
status: done
doc: 1.6/task-3-cut-over-executor-and-worker-lifecycle-writers · 1.6 §1.6 · Implement canonical run and settings authorities · ref:workflow-model §4 · ref:execution-and-sessions §3 · ref:frontend-backend-integration §3.4

builds:
- [x] BE route queue claim, heartbeat, executor transition, recovery requeue, cancellation settlement and terminal publication through the run service (`run-record-service`, `worker-loop`, `run-executor`, `write-sequencer`, `worker/compose`); the worker side holds no lifecycle repository mutator
- [x] BE adapt the shared sequenced-settlement helper and its positive-recovery/operator-present callers: worker `advance-running` uses `workerTransition`; `resume-queued` uses a separate command/recovery port backed by existing `transition`, preserving CAS, `writeResolution`, `startAt` and one outer transaction; narrowly wire dashboard composition
- [x] BE preserve stable run/session ids and append-only evidence links; `span.ended` only after the terminal commit
- [x] PROOF #4–#7, #9, #10 and the worker/recovery half of #27 through the real worker composition; D118 attempting-write admission preserved; deletion test `worker-loop-writes-only-through-the-service`
- [x] PROOF both shared-helper arms and their real callers preserve atomic evidence, continuation and exact/divergent replay; outer rollback/refusal publishes nothing; lifecycle command ids cannot collide with kernel commands; deletion oracle also covers both helper arms and admitted continuation adapters

needs:
- p1f-run-store
- p1f-settings-store

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate/deletion test (doc 01 §1.6 Task 3); serial after wave 2 · left: implementation
- 2026-09-05 | operator-approved direct phase plan | reconciled D330.10 ownership: Task 3 keeps the worker lifecycle seam and Task 4 owns command-kernel start/intake/capture creation plus `run.queued`; Task 3 owns the worker/recovery half of #27. Restored Task 2-2 code/evidence and full gates on master; Task 2-2 prerequisite satisfied · left: Task 3 implementation
- 2026-09-05 | operator-approved shared-settlement amendment | Task-3 inspection at `e8d0fd54` found `resume-queued` also serves positive recovery/operator resolution. Admit only the shared helper, its two `write-recovery` continuation callers and narrow dashboard service-port injection; use existing command-owned `transition`, preserve the worker port boundary and full deletion oracle, add atomicity/continuation/replay proofs. Untouched initial worktree/ref removed; no implementation or acceptance claimed · left: implement the amended six-step plan
- 2026-09-05 | direct supervisor close | candidate `a2c37bba` passed fresh independent `sup_review` after resolving cancellation admission, recovery publication and indexed recovery-selection findings; integrated as `2c4e1af6` with typecheck/lint, 5,211 coverage tests, 758 architecture tests, manifest and diff checks passing. Owned worktree/ref removed; Task 3 complete. No push or next-task dispatch.

#### 4 · Cut over operator run commands, Rerun planning, and archive/delete writers {#p1f-run-commands}
status: done
doc: 1.6/task-4-cut-over-operator-run-commands-rerun-planning-and-archive-delete-writers · 1.6 §1.6 · Implement canonical run and settings authorities · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §9.1 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.4 · ref:data-intake-and-edit-data §6 · ref:operator-trust §5.7

builds:
- [x] BE route dashboard/dry-run start, intake fan-out creation, internal retry/restart compatibility, cancel, rename, gate/write continuation, archive, relaunch, terminal-only delete/tombstone, bulk, and evidence retention through the run service (`command-kernel`, `run-fan-out`, `command-service`, and the shared post-commit `run.queued` publication)
- [x] BE make D334 source-bound Rerun plans carry logical entries, selected/omitted steps, submitted values and prefill provenance but no `runId`/`traceId`; Confirm creates the new run and the source stays byte-identical; remove `run.edit-checkpoint`
- [x] BE return one typed settlement/conflict vocabulary, preserving `target-deleted` and actor/version attribution; D335 also admits the strict confirmation-required arm
- [x] BE implement D335 acknowledged repeat occurrences, natural-business-key admission across occurrences, source-bound fresh execution and occurrence-specific recovery without source mutation or DDL
- [x] FE apply only required removed-identity/retired-editor compatibility changes and their reviewed references; full modal defaults/warning UI remains 3.1 Task 11-2
- [x] PROOF plan/confirm identity timing, exact replay, source/value/step customization, idempotence, stale CAS, concurrent-worker, archive/relaunch lineage, and D308 deletion semantics through the real kernel; `no-lifecycle-sql-outside-the-adapter` (#24) and replacement `rerun-prefill-boundary` activate in the same commit

needs:
- p1f-run-writers

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate (doc 01 §1.6 Task 4); needs the coordinator's ruling on operator `cancel` of a claimed/running run in §D330.5 before start · left: that ruling, then implementation
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 (later) | the coordinator ruled option A; the `cancelRequested` arm is in §D330.5 and this task owes §D330.11 #27 — the earlier `left:` is closed · left: implementation
- 2026-09-05 | operator-approved 1.6.3 feasibility correction | D330.10 keeps lifecycle `create` with the command kernel, so Task 4 also owns start/intake/capture fan-out creation and the shared post-commit `run.queued`; Task 3 supplies the worker/recovery half of #27 before this task starts · left: Task 3, then implementation and complete #27 proof
- 2026-09-05 | shared-settlement ownership | Task 3 supplies the service-backed positive-recovery/operator-present `resume-queued` helper and narrow composition injection. Task 4 retains command dispatch/admission, other write-resolution paths and the remaining command cutover; preserve Task 3's atomicity, continuation and replay proofs · left: Task 3, then implementation
- 2026-09-05 | D335 approved planning correction | One Rerun action defaults failed/interrupted sources to remaining steps and successful sources to all steps. Selected previously submitted transactions show Cancel / Confirm; warning Confirm advances to Values without lifecycle effects. Only final modal submission starts the new run with fresh-submission authorization, not receipt reuse. Task 4 explicitly owns strict occurrence JSON, adapter query/fence, execution/recovery and minimum UI/reference compatibility; no DDL/live write/full modal. Producer-consumer/replay feasibility and acceptance are recorded in doc 01 before renewed launch · left: implement and independently review the amended Task-4 plan
- 2026-09-05 | D334 operator-approved focused plan | Task 3 is integrated. Run identities now mint only when Confirm consumes a plan. Rerun is a contextual preset of the ordinary new-run modal; completed-step values are optional editable prefill, submitted values/omissions are authoritative, the source is immutable, and unknown writes remain evidence-resolution only. 1.6.4 removes the Edit Data writer and owns this backend boundary; no Capture or generic CLI surface returns · left: implement the approved Task-4 plan in doc 01
- 2026-09-05 | direct supervisor close | completed the seven-step D334/D335 plan; independent `sup_review` PASS on `03a2f508` after source-eligibility fix `1dd76ecb`. Integrated unchanged as `5d050d3d`; isolated integration typecheck/lint, 5,230 coverage tests, 761 architecture tests, 269 parity tests, manifest/roadmap and diff checks passed. Owned worktree/ref and verified scratch residue removed; Task 4 complete. Full modal remains 3.1.11-2. No push or next-task dispatch.

#### 5 · Cut over settings mutation and runtime resolution {#p1f-settings-consumers}
status: done
doc: 1.6/task-5-cut-over-settings-mutation-and-runtime-resolution · 1.6 §1.6 · Implement canonical run and settings authorities · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4

builds:
- [x] BE route secure bootstrap, worker composition, browser/login, workflow defaults, and preflight inputs through the catalog and the protected store; dashboard presentation remains 3.1 work (the eight-leaf editor inventory stays served, A8)
- [x] BE revision/CAS update, validation, restart-required reporting, and protected write-only inputs reach every composition; the worker spawn environment is value-free
- [x] PROOF P16, P20, P33's composition half, P4 at composition level; deletion test `composition-reads-no-environment-leaf`; `npm run test:parity` passes after approved Start/inspector/provenance changes and preservation of master’s separate D340 desktop changes

needs:
- p1f-settings-store

log:
- 2026-09-06 | direct supervisor close | Steps 1.6.5.1–1.6.5.6 complete; independent `sup_review` PASS on `a93ba1a5` with R1–R5 closed. Integrated as `5f1c6907f002c839b1af95060cdafab9415aff87` against latest local master `3e6a7d1f`; all serial candidate/integration/completion gates pass. Final combined implementation: 5,332 coverage tests, 817 architecture tests, 259 desktop parity cases. Owned browser, synthetic scratch, worktree and branch removed; primary `.env` preserved. Exact review, tree and log provenance in doc 01 Task 5. No push or Task-6 work.
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate/deletion test (doc 01 §1.6 Task 5); serial after Task 4 (shares the composition roots with Task 3) · left: implementation

#### 6 · Consolidate settings in SQLite and prove upgrade/recovery {#p1f-migration-proof}
status: done
doc: 1.6/task-6-consolidate-settings-in-sqlite-and-prove-upgrade-recovery · 1.6 §1.6 · Implement canonical run and settings authorities · ref:clock-config-secrets §3 · ref:dashboard-surfaces §2.5 · ref:guards-and-tests §5.2

> D336 is implemented: ordinary settings share SQLite authority; credentials are independent. The operator rebuild root is upgraded to v32; source-preserving environment cleanup is reported in the task evidence.

builds:
- [x] BE persist ordinary settings values, revision and command/audit in one SQLite transaction; cut readers/writers over together and remove file authority, sidecars and cross-store recovery
- [x] BE keep credential updates and readback independent of SQLite transactions/restores, with sole-reader access, authorization, truthful outcomes and no protected values in ordinary state, backups or child env
- [x] BE retain explicit verified backup and `storage upgrade [--plan] [--json]`; convert verified pre-floor and D331 input formats once, refuse conflicts, preserve data and make credential import separate
- [x] PROOF preserve run/evidence/snapshot identities; prove transaction rollback, interruption, replay, restore, missing credentials and rejection of old sources; map affected P/M proofs and adapters before evidenced guard retirement
- [x] BE after fixture gates, convert the operator's rebuild root and report key-only cleanup requirements; legacy production remains untouched

needs:
- p1f-run-commands
- p1f-settings-consumers

log:
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its seam/gate; the deletion checkbox restated — nothing is deleted in 1.6 Task 6, every adapter's deletion task is named (doc 01 §1.6 Task 6) · left: implementation
- 2026-09-06 | D336 operator-approved simplification | one SQLite authority for runs and ordinary settings, independent credentials; Task 6 owns conversion after Task 5, completed work stays evidenced · left: focused plan, implementation, review and gates
- 2026-09-07 | direct supervisor close | Steps 1.6.6.1–1.6.6.7 complete. Original complete standalone Sol/high PASS plus fresh sup_review R11 PASS; final integration 440013f193d7f3451828cbc740591248139db077. Candidate/integration typecheck, lint, 5,461 coverage tests, 827 architecture tests, 259 desktop parity cases and freshness gates pass. Merged-code backup/plan/upgrade/repeat/doctor converted operator v29/g91 to v32/g94, preserving prior rows, evidence, backup and .env; nine cleanup names reported, no runtime startup. Assigned worktree/ref and 27 dead owned test roots removed; exact review task archived. No push, legacy change, cutover or next-task dispatch.

#### 7 · Close the rebuilt foundation {#p1f-close}
status: done
doc: 1.6/task-7-close-the-rebuilt-foundation · 1.6 §1.6 · Implement canonical run and settings authorities · 2.6 §2.6 · 3.1 §Reopened completion tasks

> D341 prerequisite: the approved test-data foundation detour completed 2026-09-07 (accepted review, `--no-ff` integration `bc6dc9b54`, private conversion; `ref guards-and-tests` §10.5); no new phase number. Use the fresh operator-reset root and shared synthetic recovery fixtures.

builds:
- [x] PROOF typecheck, lint, coverage, architecture, manifest, stores-catalog, parity (only the approved D343 generated-fingerprint refresh), storage-doctor on the fresh root after the D341 detour, and both workflows' T1b live manifests with exact zero write-authority deltas
- [x] PROOF adversarial review finds no second run/settings lifecycle authority or secret-value leak, and the `no-lifecycle-sql` negative control intact
- [x] DOCS record the migration and hand 2.6 only verified contracts, the reproducible synthetic fresh/migrated fixture pair, the named adapter deletions (A0/A1 → 2.6 Task 2; A2 + its unit test and A3 → 2.6 Task 1-3; A8/P40 → 3.1 Task 9-2), residuals, and exact gates

needs:
- p1f-migration-proof

log:
- 2026-09-08 | Task 1.6.7 complete | R3-standalone-complete PASS on frozen `c4fa2ba4`, all 503 paths/1912 inputs; local no-ff merge `9b12f2e8`. Integration typecheck/lint, 5546 coverage tests, 833 architecture checks, 261 unchanged parity cases and freshness/audit gates pass. Both T1b proofs retain 0/0/0 writes. Canonical revision-8 restoration activated defaults; final doctor healthy schema33/g839, zero pending/unresolved/HR outbox. Owned 18 profiles/18 smoke locks/worktree/ref removed; independent review record and failed evidence preserved. No Task-7 deferral, push, production transaction or Phase-2.6 implementation.
- 2026-09-08 | Task 1.6.7 standalone review approved | operator authorized one independent Astra/high review task with checkpoint/resume through compaction. Full candidate/proof scope and complete PASS before integration remain required; R1/R2 have no acceptance credit. Settings restoration remains separately deferred.
- 2026-09-08 | Task 1.6.7 review capacity blocked | frozen evidence `d9ccb0c2`: R1 and R2 complete native reviews stopped after automatic compaction, no confirmed findings and no PASS. R2 used measured bounded retrieval; a resumable standalone complete review is proposed in the owner, awaiting approval. No merge; settings restoration remains separately deferred.
- 2026-09-08 | Task 1.6.7 Step 5 accepted | final candidate gates pass: 5546 coverage tests, 833 architecture checks, 261 unchanged parity cases. Both accepted T1b proofs and the schema-33 handoff are recorded; awaiting complete independent review. Integration gates and cleanup remain, with settings restoration explicitly operator-deferred.
- 2026-09-08 | Task 1.6.7 Step 4 accepted | executable `4a242128`: 5546 coverage tests, 833 architecture checks and 261 unchanged parity cases pass. Both T1b proofs accepted; fresh Separations result `3a1b9d6a-32f3-4ea3-886d-d049c0eec191` met all eight assertions with fifteen current-run checkpoints and exact 0/0/0 writes. Post-doctor healthy schema33/g836, primary master restored. Final recording/review/integration/cleanup remain; settings restoration is operator-deferred.
- 2026-09-08 | Task 1.6.7 fresh reread | combined schema-33 candidate `7eb62eea` passed 5542 coverage tests, 833 architecture checks and 261 parity cases. Person Lookup retained proof is unchanged. Fresh Separations reread failed at pending-set observation/provenance recording after fourteen new checkpoints; exact 0/0/0 writes. Narrow repair and renewed full proof, review, integration and cleanup remain open; settings restoration is operator-deferred.
- 2026-09-07 | Task 1.6.7 current residuals | callback repair `09436a49` passed 5522 coverage tests, 259 desktop parity cases and a production read-only scan; Person Lookup full live-read met with exact 0/0/0 writes. Separations full T1b remains blocked by protected reread identity/admission. Temporary-settings restoration waits for the operator's signal; final review, integration and cleanup remain open.
- 2026-09-07 | Task 1.6.7 Steps 1–3 | source checkpoint `9316abc6` preserves `.env` as reference and admits only `.env.providers` (D343); operator-approved fingerprint-only reference refresh classified. Typecheck/lint, 5513 coverage tests, 833 architecture tests and 259 assertion-mode parity cases pass. Live pair, complete independent review, integration and cleanup remain open.
- 2026-09-07 | D341 detour complete | accepted review (rounds 2–4 + conversion addendum), `--no-ff` merge `bc6dc9b54`, integration gates green, private conversion performed (credentials v2 revision 3, private file 0600, doctor exit 0); person-lookup input and retired-env cleanup remain Task-7 prerequisites.
- 2026-09-07 | D341 approved detour | test-only configuration and complete shared-fixture consolidation precede Task 7; operator database reset verified, credentials preserved; implementation remains pending and the paused Task-7 worktree must consume the new base.
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | bound to its gate and its 2.6 handoff list (doc 01 §1.6 Task 7) · left: implementation

## Phase 2 · Prove writes and build the platform tails {#phase-2}
phase: Phase 2
status: done
when: historical proof retained · 2.6 closed 2026-09-12
size: XL
chip: 2.1–2.6 evidenced · closed 2026-09-12
doc: 2 §Phase summary · ref:write-safety §3.4
open: yes

> **The historical controlled commit remains MET live (D135):** one real Kuali write on doc `4489`, followed by four platform tails. D326 reopens only 2.6, after 1.6, to migrate and re-prove every downstream tail consumer of run or settings authority.

needs:
- p1f-close

log:
- 2026-09-12 | 2.6.9 final acceptance | Phase 2.6 final acceptance closes the reopened Phase 2 boundary; historical D135 retained without another write. Exact evidence and limits: final-validation.md.
- 2026-09-03 | D326/D327 authority reset | 2.1–2.5 keep their evidence; 2.6 waits for 1.6 and owns downstream migration plus regression proof, not another authority redesign
- 2026-08-21 | docs-cohesion 02 | doc 02 rewritten as-built — the phase reads DONE-with-named-residuals: nine mechanisms with no production caller or delivery path, each attributed to the node that owns the fix, plus four test-lane gaps owned by `{#test-tiers}`; the 23 `_phase: 2_` rounds in `reference/decisions.md` all indexed


### 2.1 · Controlled write proof {#p2-proof}
status: done
date: D128–D135 · 2026-08-04
size: L
doc: 2.1 §2.1 · Controlled write proof · ref:write-safety §2.1 · ref:write-safety §3 · ref:write-safety §3.1 · ref:write-safety §5 · ref:guards-and-tests §3.6 · ref:frontend-backend-integration §6.4 · ref:write-safety §3.3 · ref:write-safety §3.4 · ref:clock-config-secrets §4.1 · ref:charter §13

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
doc: 2.1 §2.1 · Controlled write proof · ref:write-safety §3

builds:
- [x] BE one minimal Kuali proving transaction under the write sequencer
- [x] PROOF dry run, pre-fence refusal, commit, reload read-back, and idempotent repeat
- [x] PROOF restore the live test documents after verification

#### 2 · Execute and record the controlled proof {#p2a-proof}
status: done
doc: 2.1 §2.1 · Controlled write proof · ref:write-safety §3.4

builds:
- [x] PROOF dry run, forced mismatch, one controlled commit, reload read-back, and idempotent repeat
- [x] PROOF restore both live test documents and preserve durable evidence ids
- [x] DOCS retain per-workflow controlled proof as a later migration obligation

### 2.2 · Evidence and operator trust {#p2-2g}
status: done
date: D134–D145
size: L
doc: 2.2 §2.2 · Evidence and operator trust · ref:operator-trust §2 · ref:operator-trust §2.2 · ref:operator-trust §2.3 · ref:operator-trust §4 · ref:operator-trust §6 · ref:operator-trust §6.1 · ref:operator-trust §6.3 · ref:dashboard-surfaces §2.6 · ref:write-safety §6.1 · ref:frontend-backend-integration §6.5 · ref:write-safety §3.1

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
doc: 2.2 §2.2 · Evidence and operator trust · ref:operator-trust §2 · ref:dashboard-surfaces §2.6

builds:
- [x] BE redacted diagnostic capture and actor-keyed notification inbox
- [x] BE derived evidence receipts and ordered ledger projection contracts
- [x] BE knowledge/fix admission and its audited zero-authority boundary

#### 2 · Derive receipts and wire trust services {#p2b-services}
status: done
doc: 2.2 §2.2 · Evidence and operator trust · ref:operator-trust §4 · ref:write-safety §6

builds:
- [x] BE derive receipts from authority rather than caller claims
- [x] BE notification, knowledge/fix, and ledger service contracts
- [x] DOCS record missing production producers/projectors under later owners

### 2.3 · Data and intake foundation {#p2-2h}
status: done
date: D146–D167
size: XL
doc: 2.3 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data §1 · ref:data-intake-and-edit-data §2 · ref:data-intake-and-edit-data §3 · ref:data-intake-and-edit-data §4 · ref:data-intake-and-edit-data §5 · ref:data-intake-and-edit-data §6 · ref:frontend-backend-integration §6.6

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
doc: 2.3 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data

builds:
- [x] BE field registry, mappings, validation, immutable manifests, and rerun diff
- [x] BE extraction, OCR, roster, normalization, capture-session, and Edit Data cores
- [x] BOTH production routes and live scanner proof

#### 2 · Build extraction and scanner services {#p2c-services}
status: done
doc: 2.3 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data §3

builds:
- [x] BE extraction, OCR, roster, and normalization stores
- [x] BOTH scanner classification/grouping and real 44-page proof
- [x] PROOF strict producer outputs and artifact identities

#### 3 · Wire providers, artifacts, capture authority, and Edit Data {#p2c-wiring}
status: done
doc: 2.3 §2.3 · Data and intake foundation · ref:data-intake-and-edit-data §5

builds:
- [x] WIRE executor/worker providers and artifact delivery
- [x] BE durable capture sessions and Edit Data core
- [x] PROOF immutable manifests and rerun-diff behavior

### 2.4 · Operator services and read models {#p2-2i}
status: done
date: D168–D180
size: L
doc: 2.4 §2.4 · Operator services and read models · ref:operator-trust §1.3 · ref:data-intake-and-edit-data §2.7 · ref:data-intake-and-edit-data §5.1 · ref:data-intake-and-edit-data §5.2 · ref:frontend-backend-integration §6.7 · ref:dashboard-surfaces §9.5.1 · ref:dashboard-surfaces §9.7.1 · ref:dashboard-surfaces §9.7.2 · ref:dashboard-surfaces §9.5.3 · ref:operator-trust §5.7 · ref:operator-trust §5.8 · ref:data-intake-and-edit-data §6.4.1 · ref:charter §25

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
doc: 2.4 §2.4 · Operator services and read models · ref:operator-trust §1.3 · ref:dashboard-surfaces §9

builds:
- [x] BOTH notification, Edit Data, settings/doctor, intake, Explorer, advisory, archive, version, and Activity services
- [x] DOCS retire mobile Capture Mode without removing diagnostic captures or archive evidence
- [x] PROOF strict schemas and bounded production routes for every delivered service

#### 2 · Build Settings and storage doctor {#p2d-settings-doctor}
status: done
doc: 2.4 §2.4 · Operator services and read models · ref:clock-config-secrets §3 · ref:operator-trust §1

builds:
- [x] BOTH historical settings/preflight and storage-health/doctor services
- [x] DOCS retain later settings-authority gaps under 0.3/1.6/3.1

#### 3 · Build intake and historical Capture surfaces {#p2d-intake-surfaces}
status: done
doc: 2.4 §2.4 · Operator services and read models · ref:data-intake-and-edit-data §2.7

builds:
- [x] BOTH intake surface over schema v12
- [x] DOCS retain phone Capture only as history after D294 retirement

#### 4 · Build Explorer, UI catalog, and advisories {#p2d-explorer}
status: done
doc: 2.4 §2.4 · Operator services and read models · ref:operator-trust §5.9

builds:
- [x] BOTH read-only workflow Explorer and UI catalog
- [x] BOTH redacted, strict-output, exhaustion-bounded, zero-authority advisories

#### 5 · Build archive, version, and Activity surfaces {#p2d-archive-activity}
status: done
doc: 2.4 §2.4 · Operator services and read models · ref:operator-trust §5.7 · ref:operator-trust §5.8

builds:
- [x] BOTH append-only archive model, version bump, and Activity report
- [x] PROOF historical rows remain immutable and attributable

### 2.5 · Closing verification {#p2-2j}
status: done
date: D181–D190 · 2026-08-09
size: M
doc: 2.5 §2.5 · Closing verification · ref:workflow-model §1.6.3 · ref:execution-and-sessions §7.1 · ref:guards-and-tests §3.11 · ref:guards-and-tests §3.15 · ref:operator-trust §3 · ref:operator-trust §3.1 · ref:dashboard-surfaces §2.5

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
doc: 2.5 §2.5 · Closing verification · 2 §Exit criteria

builds:
- [x] PROOF scenario coverage, real-copy restore drill, three-worker soak, and redaction scan
- [x] DOCS validate the capability inventory and reconcile owning specifications
- [x] PROOF repair the four defects found only by the closing gate

#### 2 · Prove restore, concurrency, and redaction {#p2e-recovery-proof}
status: done
doc: 2.5 §2.5 · Closing verification · 2 §Exit criteria

builds:
- [x] PROOF real-copy corrupt/doctor/restore drill
- [x] PROOF three-worker soak and redaction scan

#### 3 · Repair gate-found defects and reconcile owning docs {#p2e-repair}
status: done
doc: 2.5 §2.5 · Closing verification · 2.5 §What 2j found, because that is what a gate is for

builds:
- [x] BE repair the unreachable restore, parity-theme, two-pixel panel, and receipt defects
- [x] DOCS reconcile every owning specification to the repaired behavior

#### 4 · Record explicit dispositions {#phase2-dispositions}
status: done
doc: 2.5 §Task 4 · Record explicit dispositions · ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9

builds:
- [x] DOCS give Explorer authoring and production serving named later owners/triggers
- [x] DOCS retain every residual without mislabeling historical delivery incomplete

### 2.6 · Revalidate tails against canonical authorities {#p2-authority-revalidation}
status: done
date: 2026-09-12
size: L
doc: 2.6 §2.6 · Revalidate tails against canonical authorities · ref:operator-trust · ref:data-intake-and-edit-data · ref:frontend-backend-integration · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5 · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2

> Revalidate downstream consumers after 1.6, then complete the explicitly approved database modernization tasks 2.6.2–7 before the final migration/recovery proof. The 2026-09-09 scoped amendment admits that named redesign only; unrelated contract redesign still returns to its owning authority.

builds:
- [x] BOTH every Phase 2 downstream read model, join, and operator service reads run/settings state only through the 1.6 authorities
- [x] PROOF notification, archive, Activity, Explorer, intake, Edit Data, receipts, captures, doctor, and preflight keep their behavior and evidence
- [x] PROOF delete stale adapters and demonstrate that no displaced lifecycle/configuration source can affect a response
- [x] DOCS hand reopened 3.1 stable contracts, representative fixtures, and exact acceptance gates

needs:
- p1f-close
- p2-2j

log:
- 2026-09-12 | 2.6.9 final acceptance | All development releases through U/H and L retirement accepted by 2.6.9; full gates, independent complete/R5 PASS, local integration and owned cleanup verified. Exact evidence and limits: final-validation.md.
- 2026-09-08 | D344 prerequisite planning | visible prerequisite gates and smaller dashboard groups; operator coordinates launches/merges; existing in-flight 2.6 briefs and all acceptance remain binding
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330/D331/D332 as landed — `ref:dashboard-surfaces` §9.2 and §2.5, `ref:clock-config-secrets` §3, `ref:guards-and-tests` §5.2 (no redesign) · left: a proposed contract change returns to a newly numbered 0.3 task
- 2026-09-04 | 2.6 parallelism ruling | wave 1 is `1-1` trust/evidence ∥ `1-2` intake/data ∥ `1-3` operator read models, each from the same verified 1.6-close base in a dedicated worktree; serial Task 2 converges the migration/recovery proof and Task 3 closes · left: coordinator ledger binds exact paths, gates and peer integration order before dispatch

#### 1-1 · Revalidate trust and evidence consumers {#p2f-trust}
status: done
date: 2026-09-08 · reviewed and integrated locally
doc: 2.6/task-1-1-revalidate-trust-and-evidence-consumers · ref:operator-trust · ref:dashboard-surfaces §2.6 · ref:dashboard-surfaces §9.2

builds:
- [x] BOTH migrate notifications, receipts, failures, captures, logs, gates, and parked-write views
- [x] PROOF every row remains linked to the canonical run id through retry, archive, and tombstone
- [x] PROOF notification delivery never races ahead of the durable run-linked inbox row

needs:
- p1f-close
- p2-2j
- p2f-readers

log:
- 2026-09-08 | 2.6.1-1 complete | candidate 98305e1bc, complete T-R1 PASS after bounded repair; local merge 5a07b329e; 443 files / 5,566 tests, parity 261, typecheck/lint PASS; integration inputs verified and owned worktree/ref removed · peer tasks remain open
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.9 evidence linkage by stable `runId`, §D330.2 existence, §D330.8 tombstone (no redesign) · left: the notification inbox row stays run-linked

##### 1 · Complete shared-reader prerequisite {#p2f-readers}
status: done
date: D344 · operator-coordinated prerequisites
doc: 2.6/task-1-1-revalidate-trust-and-evidence-consumers §P — shared-reader prerequisite

> A separate accepted gate, displayed under its existing in-flight owner to preserve the approved 2026-09-08 P/T execution brief. No trust/data/operator peer implementation starts before this extraction is reviewed and integrated.

builds:
- [x] BOTH separate run query/read ports, trust/data/operator composition and route registration without changing behavior
- [x] PROOF pass the prerequisite candidate and integration gates plus independent review
- [x] DOCS record the exact common integration SHA and exclusive peer ownership in the existing owner; the operator starts the peers

needs:
- p1f-close
- p2-2j

log:
- 2026-09-08 | D344 prerequisite planning | scheduled boundary and ownership; implementation and acceptance remain open
- 2026-09-08 | P C249d96edf P-R1 PASS · integrated 826cae744 | 5,549 tests and 261 parity cases; identical integration code inputs, scoped recording checks; owned worktree/ref removed · trust/data/operator implementation remains open

#### 1-2 · Revalidate data, intake, and prior-run value consumers {#p2f-data}
status: done
date: 2026-09-08 · reviewed and integrated locally
doc: 2.6/task-1-2-revalidate-data-intake-and-prior-run-values · ref:data-intake-and-edit-data · ref:dashboard-surfaces §9.7 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5 · ref:clock-config-secrets §3

builds:
- [x] BOTH migrate intake, OCR, manifests, mappings, and D334's read-only prior-run value/provenance projection; diagnostic capture projection stays with `1-1`
- [x] BOTH serve only descriptor-allowed completed-step values with exact source run/version, step/node, field path and provenance; withhold values the ordinary operator-suppliable schema does not admit
- [x] PROOF existing artifacts remain readable, missing/malformed/deleted/archived source links fail loud, and no intake/prefill path writes run lifecycle, checkpoints, plans, modal values, or settings state

needs:
- p1f-close
- p2-2j
- p2f-readers

log:
- 2026-09-08 | C75e3fb655 · 2.6.1-2-R1 PASS · integrated b2302c057 | canonical read-only prior-run values/provenance and Context admission; typecheck/lint, 446 files / 5,613 tests and 261 desktop parity cases pass; identical integration tree and 2,185 inputs verified; owned worktree/ref removed
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.9, D331 §D331.8 (one source per leaf) and D332 §D332.7 item 4 (no redesign) · left: no intake or Edit Data path writes settings or a lifecycle row
- 2026-09-05 | D334 operator correction | the old `run.edit-checkpoint` consumer retires in 1.6.4. This task owns only completed-value/provenance reads for 3.1 Task 11-2's source-bound Rerun modal; the source remains immutable · left: implementation after 1.6 closes

#### 1-3 · Revalidate operator read models {#p2f-operator}
status: done
date: 2026-09-08 · reviewed and integrated locally
doc: 2.6/task-1-3-revalidate-operator-read-models · ref:frontend-backend-integration §6 · ref:dashboard-surfaces §9 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5 · ref:clock-config-secrets §3 · ref:guards-and-tests §5.2

builds:
- [x] BOTH migrate archive, Activity, Explorer, storage doctor, setup/preflight, and generic read models
- [x] PROOF archive/current/queue counts converge from one run authority under create, update, archive, relaunch, delete, and restore
- [x] PROOF settings status and preflight resolve from one catalog without returning protected values

needs:
- p1f-close
- p2-2j
- p2f-readers

log:
- 2026-09-08 | C9b7365d76 · 2.6.1-3-R2 PASS · integrated 813581124 | canonical operator lifecycle/counts, Cancelling, immutable archive batch snapshots, safe upgrade status and schema-34 runs_view retirement; integration typecheck/lint, 447 files / 5,639 tests and 262 desktop parity cases pass; owned worktree/ref and scratch cleaned
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.5 (`read`/`list` are the only lifecycle reads), D331 §D331.6/§D331.11 P16 and D332 §D332.5/§D332.6 (no redesign) · left: adapters A2 and A3 are deleted here with their tests

#### 2 · Apply approved database renames {#p2db-simple-renames}
status: done
doc: 2.6 §Task 2 · Apply approved database renames

> Naming-only prerequisite before C0. Preserve behavior and released migration history. Phase 2.6 trial: focused tests/lint/freshness here; full gates and independent review at 2.6.9.

builds:
- [x] BE apply seven approved table renames and update current consumers without lifecycle redesign
- [x] PROOF check focused naming/migration behavior and historical-name exceptions; release a committed candidate to C0

needs:
- p2f-trust
- p2f-data
- p2f-operator
- fact(met): timeline T1 integrated at 46930920696ab214b036d5f2681b8ffb4e5620ea with recorded review and gates

log:
- 2026-09-09 | C37ed00d19 · scoped development release | seven table renames at schema39 with floor37/history retained; 342 focused tests, lint and affected freshness pass; candidate released to 2.6.3 C0 on retained codex/database-renames; full gates, independent review, master integration and cleanup remain 2.6.9
- 2026-09-09 | operator rename-first amendment | new 2.6.2 R; current C0 and later tasks shift by one; planning only in this commit

#### 3 · Settle database contracts and task ownership {#p2-db-modernization}
status: done
doc: 2.6 §Task 3 · Settle database contracts and task ownership

> Database modernization now uses visible prerequisite and parallel-child cards, matching 3.1. This planning prerequisite retains the original p2-db-modernization anchor. Scope and exact execution admission remain with the combined folder.

builds:
- [x] DOCS close remaining product decisions and ratify approved table/lifecycle contracts
- [x] DOCS bind exact disjoint files, tests, migration owners, resources and verified execution prompts

needs:
- p2db-simple-renames

log:
- 2026-09-09 | C0010c51c4 · C0 scoped documentation release | R/T1 verified; six contract owners ratified; exact task/test/capacity bindings and resolved T prompt saved; 24 document-binding tests, lint and freshness pass; full runtime gates/review/integration/cleanup remain 2.6.9
- 2026-09-09 | database roadmap expansion | 2.6.2; assignment C0; visible dependency card only; no implementation or launch readiness claimed

#### 4 · Finish database transaction history and retire ledgers {#p2db-timeline-history}
status: done
doc: 2.6 §Task 4 · Finish database transaction history and retire ledgers

> Sequential working prerequisite. Release only complete composed interfaces and focused proof; heavy gates and independent review remain in 2.6.9.

builds:
- [x] BOTH complete pending timeline T2: database history, Activity transaction exports and archive transaction capture
- [x] PROOF preserve confirmed-operation facts, conversion/recovery, deletion and UNKNOWN safety before ledger/outbox retirement

needs:
- p2-db-modernization

log:
- 2026-09-09 | database roadmap expansion | 2.6.3; assignment T; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | T merged development release | candidate 58376a7d7, integration 5e446a90f including repairs; scoped completion and owned cleanup recorded in timeline owner. Complete independent review and inherited performance failures remain 2.6.9; no phase acceptance claimed

#### 5 · Store completion directly on workflow runs {#p2db-run-completion}
status: done
doc: 2.6 §Task 5 · Store completion directly on workflow runs

> Sequential working prerequisite. Release only complete composed interfaces and focused proof; heavy gates and independent review remain in 2.6.9.

builds:
- [x] BE retain canonical completion and run_failures while retiring terminal authorizations and terminal outbox
- [x] PROOF preserve ownership fences, retries, receipts, historical evidence and UNKNOWN refusal

needs:
- p2db-timeline-history

log:
- 2026-09-09 | database roadmap expansion | 2.6.4; assignment C; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | 2.6.5 C plan approved | complete C01–C05 brief; T prerequisite integrated at 5e446a90f; one supervisor, focused checks, local master merge and owned cleanup. Full gates and complete independent review remain 2.6.9; implementation unstarted
- 2026-09-09 | C focused development release | candidate 89d167332; master integration 0dd02a890; 524 unit + 134 focused architecture tests, lint, freshness and four Storage Doctor cases PASS. Cleanup receipt and F prerequisite at C owner; full acceptance/review remain 2.6.9
- 2026-09-09 | C upgrade regression repaired | candidate 47a64d33a, integration e43a8d851; schema39 success/failure upgrade regressions added; 526 units, 134 architecture tests, lint, freshness and four Storage Doctor cases PASS. Repaired prerequisite and closure at C owner; full acceptance/review remain 2.6.9

#### 6 · Prepare independent database domain tasks {#p2db-domain-foundation}
status: done
doc: 2.6 §Task 6 · Prepare independent database domain tasks

> Sequential working prerequisite. Release only complete composed interfaces and focused proof; heavy gates and independent review remain in 2.6.9.

builds:
- [x] BE remove unused SQL spans and consolidate operator_xlsx_exports into generated_artifacts with a working export baseline
- [x] BOTH finish shared schemas, repositories, composition, recovery and populated fixtures; complete imported/extracted artifacts and approved unused-table retirements
- [x] PROOF release working provider, diagnostic, generated-artifact and settings module boundaries; verify all four peer write sets and either merge order

needs:
- p2db-run-completion

log:
- 2026-09-09 | database roadmap expansion | 2.6.5; assignment F; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | C source prerequisite recorded | master 0dd02a890; F remains unlaunched and needs its own committed execution brief
- 2026-09-09 | C prerequisite superseded by repair | use integrated e43a8d851 together with F approved plan; earlier C release alone is insufficient; no F dispatch
- 2026-09-09 | 2.6.6 F plan approved | F01–F07 at foundation owner; verified C ancestry and schema41/floor40. One supervisor, focused checks, local master merge and owned cleanup; full gates and independent review remain 2.6.9. F and its four children remain unimplemented
- 2026-09-09 | F01–F05 implemented | schema47/floor46, composed P/D/G/S baseline and pairwise proof; committed F06 and F07 integration/cleanup pending. Full acceptance/review remain 2.6.9
- 2026-09-09 | F06 focused PASS | candidate e32979d0a; 949 unit, 199 affected architecture and 49 filtered UI cases; lint/freshness PASS. Local integration and cleanup pending; final acceptance/review remain 2.6.9
- 2026-09-09 | F integrated focused release | common P/D/G/S prerequisite 7ec279750817934b7da69ce433e0e5a44fed6a58; 949 unit, 199 guard and 49 filtered UI tests plus lint/freshness PASS. Owned cleanup receipt at F owner; all four children unlaunched; full acceptance/review remain 2.6.9
- 2026-09-09 | F prerequisite repaired | common P/D/G/S prerequisite 51e4c087a0d455619ca93a3bbddc5c8fb5a24a48 supersedes initial F; exact checkpoint replay and shared settings callers repaired. 961 unit, 199 guards, 67 filtered UI plus lint/freshness PASS. Repair cleanup receipt at F owner; children unlaunched; full gates/review remain 2.6.9
- 2026-09-09 | F resolver prerequisite repaired | common P/D/G/S prerequisite 2bb25b6efbe62ca88d64a429f01dc567a76ecfbc; complete resolver result reaches settings application, both composition callers repaired, display-clear host default proved. 1195 focused unit cases across verified runs, 199 guards, 67 filtered UI plus lint/freshness PASS; P/D/G plans preserved, S scope/gates unchanged. Resolver cleanup receipt at F owner; no child launch; full gates/review remain 2.6.9

##### 1 · Track provider requests and usage {#p2db-provider-usage}
status: done
doc: 2.6 §Task 6.1 · Track provider requests and usage

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BE implement provider-neutral accounting, quota windows, all-time usage and remaining allowance without real key/provider wiring
- [x] PROOF prove concurrent admission, replay, uncertainty, retention and unchanged legacy capability behavior

needs:
- p2db-domain-foundation

log:
- 2026-09-09 | database roadmap expansion | 2.6.5.1; assignment P; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | P plan approved | P01–P06 at provider owner; repaired F 51e4c087a prerequisite, narrow reservation-integrity/historical exception, focused checks and local master merge/owned cleanup. Full gates/review stay 2.6.9; implementation unstarted
- 2026-09-09 | P scoped development release | implementation 594490f8e; local integration 4818223c9; 215 selected unit and 183 architecture cases plus lint/freshness PASS. Exact combined-input verification and owned cleanup at P owner; L consumes the release, full gates/review remain 2.6.9

##### 2 · Add diagnostic failure resolution {#p2db-diagnostics}
status: done
doc: 2.6 §Task 6.2 · Add diagnostic failure resolution

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BOTH add explicit live failure resolution with actor/time, commands, audit and usable diagnostic controls
- [x] PROOF preserve failure evidence, concurrency, protected data and read-only archive capture boundaries

needs:
- p2db-domain-foundation

log:
- 2026-09-12 | 2.6.9 final acceptance | D integration 7443100f7 plus final resolution/retention corrections accepted. Exact evidence and limits: final-validation.md.
- 2026-09-09 | database roadmap expansion | 2.6.5.2; assignment D; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | D01–D05 plan approved | repaired F prerequisite 51e4c087a; strict resolution history/live-context/test ownership amendments; one supervisor, focused checks, local merge and owned cleanup. Full gates/review remain 2.6.9; implementation unstarted

##### 3 · Publish and update generated artifacts {#p2db-generated-artifacts}
status: done
doc: 2.6 §Task 6.3 · Publish and update generated artifacts

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BE implement ordered generated-file lifecycle and XLSX exports with request/completion evidence on the same generated-artifact row
- [x] PROOF prove pending/completed updates, fault recovery, idempotency and shared-file retention

needs:
- p2db-domain-foundation

log:
- 2026-09-09 | database roadmap expansion | 2.6.5.3; assignment G; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | G plan approved | G01–G06 consumes repaired F 51e4c087a; six production paths, focused checks, local master merge and owned cleanup. Full gates and independent review remain 2.6.9; implementation unstarted
- 2026-09-09 | G scoped development release | candidate 272b35676; local merge 4328ce56a; 104 unit and 155 focused architecture/document tests, lint/freshness PASS; owned worktree/ref removed. Exact receipt at G owner; full gates and independent review remain 2.6.9

##### 4 · Activate settings for new runs without restart {#p2db-settings-activation}
status: done
doc: 2.6 §Task 6.4 · Activate settings for new runs without restart

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BOTH save and activate app_settings/settings_snapshots for newly created runs without restarting
- [x] PROOF keep existing runs on their snapshots; prove validation, save/claim races and replay

needs:
- p2db-domain-foundation

log:
- 2026-09-09 | database roadmap expansion | 2.6.5.4; assignment S; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | S plan approved | S01–S06 on repaired F 2bb25b6ef; eleven production paths, bounded settings test amendments and isolated desktop proof. Focused checks, local master merge and owned cleanup here; full gates/review remain 2.6.9. Updated parallel protocol, no implementation launched
- 2026-09-09 | S scoped release complete | Atomic current activation, retained-run resources and replay; 350 focused unit tests, 49 guards, lint/freshness and desktop proof PASS. Integrated locally, owned worktree/ref removed; full gates and independent review remain 2.6.9. See the S06 release in the approved brief.

#### 7 · Prepare independent archive and summary tasks {#p2db-lifecycle-foundation}
status: done
doc: 2.6 §Task 7 · Prepare independent archive and summary tasks

> Sequential working prerequisite. Release only complete composed interfaces and focused proof; heavy gates and independent review remain in 2.6.9.

builds:
- [x] BOTH assemble P/D/G/S candidates and fix immediate combination defects with focused checks
- [x] BE finish shared lifecycle contracts, source adapters, archive/version/summary registration, deletion and backup interfaces
- [x] PROOF release working A/Q boundaries and verify either merge order; provider policy is not an additional barrier

needs:
- p2db-provider-usage
- p2db-diagnostics
- p2db-generated-artifacts
- p2db-settings-activation

log:
- 2026-09-09 | database roadmap expansion | 2.6.6; assignment L; visible dependency card only; no implementation or launch readiness claimed
- 2026-09-09 | L scoped release complete | L01–L06; 263 unit tests, 139 architecture tests, lint and freshness PASS. Candidate 08d9f4f53 merged locally as a8ee826dc; owned worktree/ref removed. A/Q remain unlaunched; full gates and independent review remain 2.6.9. Exact contracts and evidence: L06 release in prerequisites.md.
- 2026-09-09 | L shared-boundary repair | Implementation a1d0c4a5; 266 unit tests, 139 architecture tests and lint PASS. A/Q share the repaired release and original ownership. A conversion precedes an explicit L retirement follow-up; combined completion remains blocked on that proof. Full gates/review remain 2.6.9.

##### 1 · Transfer runs into independent archive reports {#p2db-archive-transfer}
status: done
doc: 2.6 §Task 7.1 · Transfer runs into independent archive reports

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BOTH implement version_changes and verified archive.sqlite/archive_records transfer, historical conversion and deletion/recovery
- [x] PROOF preserve report facts and files across crashes; remove relaunch backend and live rows only after verified capture

needs:
- p2db-lifecycle-foundation

log:
- 2026-09-12 | 2.6.9 final acceptance | A integration 7e20edc07, populated conversion proof and L retirement 4591b263e incorporated and accepted. Exact evidence and limits: final-validation.md.
- 2026-09-09 | database roadmap expansion | 2.6.6.1; assignment A; visible dependency card only; no implementation or launch readiness claimed

##### 2 · Build shared run summaries for Queue and Activity {#p2db-run-summaries}
status: done
doc: 2.6 §Task 7.2 · Build shared run summaries for Queue and Activity

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BE derive and incrementally maintain indexed run_summaries with stable rebuild/catch-up and validated aggregate identity counts
- [x] PROOF prove freshness, grouping, archive/delete transitions, correct filters and bounded reads without sibling code

needs:
- p2db-lifecycle-foundation

log:
- 2026-09-12 | 2.6.9 final acceptance | Q integration cb3675770 and final indexed reader corrections accepted; both unchanged benchmarks PASS. Exact evidence and limits: final-validation.md.
- 2026-09-09 | database roadmap expansion | 2.6.6.2; assignment Q; visible dependency card only; no implementation or launch readiness claimed


#### 8 · Prepare independent dashboard consumers {#p2db-served-interfaces}
status: done
doc: 2.6 §Task 8 · Prepare independent dashboard consumers

> Sequential working prerequisite. Release only complete composed interfaces and focused proof; heavy gates and independent review remain in 2.6.9.

builds:
- [x] BOTH assemble A/Q candidates and fix immediate combination defects with focused checks
- [x] BOTH finish real served queries, shared routes/wires, download authorization and shared UI wiring
- [x] PROOF freeze independent Queue/Activity and archive viewer paths, fixtures and references; verify either merge order

needs:
- p2db-archive-transfer
- p2db-run-summaries

log:
- 2026-09-10 | V01–V06 complete | served summaries/exports, generic reports and authorized retained files, retired relaunch, independent U/H baselines; focused PASS, local merge 4c9500bacc99fcccf96254b100a5f009acb666f0 and owned cleanup verified; common release in V receipt · left: U/H and 2.6.9
- 2026-09-09 | database roadmap expansion | 2.6.7; assignment V; visible dependency card only; no implementation or launch readiness claimed

##### 1 · Connect Queue and Activity to shared summaries {#p2db-activity-views}
status: done
doc: 2.6 §Task 8.1 · Connect Queue and Activity to shared summaries

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BOTH use served summary queries for Queue/Activity and existing exports while keeping transaction metrics distinct
- [x] PROOF verify UI behavior, protected counts and measured query/latency/write overhead on isolated fixtures

needs:
- p2db-served-interfaces

log:
- 2026-09-12 | 2.6.9 final acceptance | U integration 1e2981f2e incorporated; served/UI proof and 274 desktop parity cases accepted. Exact evidence and limits: final-validation.md.
- 2026-09-09 | database roadmap expansion | 2.6.7.1; assignment U; visible dependency card only; no implementation or launch readiness claimed

##### 2 · Render saved archive reports without legacy workflows {#p2db-archive-viewer}
status: done
doc: 2.6 §Task 8.2 · Render saved archive reports without legacy workflows

> Independent peer after the named working prerequisite release. Focused tests/lint and fixes here; heavy gates and independent review in 2.6.9.

builds:
- [x] BOTH render generic archive list/detail/filter/download from saved reports and remove archive relaunch UI
- [x] PROOF show version-mismatched historical reports without live schemas; verify missing evidence, authorization and deletion

needs:
- p2db-served-interfaces

log:
- 2026-09-12 | 2.6.9 final acceptance | H integration f8ae34329 incorporated; frozen reports, retained files, deletion and retired relaunch accepted. Exact evidence and limits: final-validation.md.
- 2026-09-09 | database roadmap expansion | 2.6.7.2; assignment H; visible dependency card only; no implementation or launch readiness claimed

#### 9 · Finalization {#p2f-proof}
status: done
doc: 2.6 §Task 9 · Finalization · ref:operator-trust §1 · ref:guards-and-tests · ref:dashboard-surfaces §2.5 · ref:guards-and-tests §5.2

> D336: consume Task 1.6.6's SQLite-settings restore and revised adapter/proof mapping; the old paired-file rollback and settings-pathname target are superseded.

> D341: consume shared fixtures and private-test source identities; recovery uses reproducible synthetic fresh/v29 copies, never the removed operator database/backup. Existing adapter-retirement ownership remains.

builds:
- [x] PROOF incorporate A populated conversion proof and the approved L-owned table/reader retirement follow-up before combined completion
- [x] PROOF combine database development candidates, run required heavy gates, fix remaining defects here and obtain fresh complete independent review
- [x] PROOF run migrated-copy restore, scenario, concurrency, redaction, and direct-authority reconciliation gates
- [x] PROOF cite historical D135 and perform no second controlled write
- [x] PROOF retire obsolete settings imports with named below-floor refusal while preserving supported stopped database/archive recovery; displaced sources cannot affect a response
- [x] DOCS finish stable-contract fixture handover to 3.1 and owned cleanup within this final task

needs:
- p2db-served-interfaces
- p2db-activity-views
- p2db-archive-viewer
- p2f-trust
- p2f-data
- p2f-operator

log:
- 2026-09-12 | 2.6.9 final acceptance | F01–F07 complete: candidate 7a0ae2f89, complete standalone and R5 PASS, 6,299 tests / 274 parity, 37 main / two archive / 51 obsolete-name absence inventory, original recovery preserved, local merge 81bd3e384, fixture/contract handover and owned cleanup verified. No operator application, second controlled write, push or successor dispatch. Exact evidence and limits: final-validation.md.
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D332 §D332.4 with M17/M22 over a migrated copy and §D332.7 item 6 (no redesign) · left: A0/A1 deleted and their two inventory entries flipped to `active` in that commit
- 2026-09-10 | F01–F07 plan approved | integrated prerequisites through 22bf85d3a; recovery separation ratified; one Astra/medium supervisor, four focused Astra/high reviews plus integration review; full gates, local merge, handover and cleanup required. Implementation unstarted; exact brief and verified prompt at final-validation.md/PROMPTS.md

### Historical disposition record after 2E
status: never
doc: 2.5 §Task 4 · Record explicit dispositions · ref:operator-trust §5.3 · ref:frontend-backend-integration §6.9

> Workflow Explorer broad authoring/edit half — D186, trigger: the *second* production workflow whose policy you want to change; D283/DCC4–DCC5 complete existing-workflow authority: label/icon/category hot apply, named unavailable timeline/grouping/notification, strict policy/Edit Data source briefs; new-workflow authoring remains absent · BFF serves no frontend bytes / no working `dashboard:prod` — D189, retained by D294 as an independent local operator-dashboard completion item.

log:
- 2026-08-21 | docs-cohesion 02 | both dispositions written out in doc 02 with their triggers and their shelf owners — D186 → `{#def-explorer-edit}` (04 §Edit a workflow's presentation / policy without a code change), D189 → `{#def-byte-path}` (04 §Run the dashboard without the dev server / use the phone page in production); D79a's trim kept as the standing constraint on whatever the editor becomes
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code


## Phase 3 · Shared platform and acceptance {#phase-3}
phase: Phase 3
status: planned
when: historical work retained · reopened 3.1 after 2.6
size: XL
chip: 3.1 unstarted · 2.6 handover available
doc: 3 §Phase summary · 3.2 §Phase 3 chronology
open: yes

> Phase 3 finishes one shared platform through five parts, with 3.4 entirely optional: **3.1 Shared dashboard**, **3.2 workflow authoring and candidate freeze**, **3.3 controlled acceptance**, **3.4 optional document tools and AI assistance**, and **3.5 Codex and Claude cooperation**. D329 puts workflow authoring and read-only acceptance before the immutable-candidate write proof; D342 leaves optional document features outside that proof and off the required path. It adds no third workflow.

needs:
- p2f-proof

log:
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-09-04 | D329 chronology correction | 3.2 now finishes and freezes workflow authoring before 3.3 performs controlled acceptance; 03a/03b/03c/03d filenames and active 3c-A/3c-B labels are retired
- 2026-09-03 | D326/D327 dashboard reset | 3.1 Tasks 1–7 keep their evidence but no longer close the part; focused Tasks 8 onward own every generic operator journey after 2.6. Parts 3.2–3.4 wait
- 2026-09-03 | D326 decimal hierarchy | 3.1 → 3.2 → 3.3 → 3.4 is now the execution order; one coordinator owns each part, numbered cards are one supervisor session, and parallelism is recorded in the coordinator run plan · left: reopened 3.1, then 3.2–3.4
- 2026-08-20 | docs-cohesion step 5.0 | every node in the tree now carries `doc:` — its phase-doc home section plus the reference specs that own its contracts (`81bf48dd`); `test-tiers` drawn as this phase's testing spine (R10) · left: step 4b's binding guard, then the per-doc rewrites
- 2026-08-20 | docs-cohesion 03b | doc 03b rewritten as-built, all fourteen status blocks filled and the whole separations subtree re-bound to its headings; the phase stands at separations **8 of 9**, step 5 open on a calendar date · left: the three controlled commits from 08-28, then rebuild-ready and close-out
- 2026-08-30 | R2 observed status | supersedes the calendar-only status above: parent `54060ded` passed 341 files / 3,761 tests and 239/239 assert-mode parity; reviewed child `7b05b057` merged `--no-ff` and swept. Assigned `.env`, `.tracker-rebuild` and locks absent; admission smoke exited 1 before runner import or person-field inspection. No fresh subject/S7 observation, rehearsal, exact-run 0/0/0 evidence, approval or write; A2–A5/A8 remain open and R3 obligations remain separate. Evidence source-pinned under `a2b6df38^:docs/coordinator/worktree-completion/reports/` (`r2-gates.md`, `r2-p3.md`, `r2-p4.md`) and retained in `docs/rebuild/migrations/separations.md` §9.32

### 3.1 · Shared dashboard {#dash-defaults}
status: planned
chip: Focused tasks/groups · full gates and repairs at 19 · no independent review
size: XL
doc: 3.1 §Phase summary · ref:frontend-backend-integration §5 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §6.8 · ref:dashboard-surfaces §1.2

> Historical Tasks 1–7 remain evidenced. Remaining work uses standalone prerequisites with independent decimal children. The operator launches separate worktrees after exact prerequisite tasks are accepted and merged. Agents work independently by default and coordinate when necessary under D344 to resolve a blocker, overlap or duplicate effort. Deferred People/Review stays optional. Workflow-specific content and frozen-candidate acceptance remain in 3.2/3.3.

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
- p2f-proof

log:
- 2026-09-13 | final-gates correction | group finalizers 9.8/11.3/14.6 use typecheck, focused integration, scoped lint and affected build/generated checks; 3.1.19 alone runs full repository gates and repairs gate-found defects in the same session; no independent review; all outcome and dependency requirements retained
- 2026-09-13 | execution-order renumbering | former 3.1.23/24/25 move to finalization children 3.1.9.8/11.3/14.6; current headings, filenames and doc bindings agree with numeric order; stable nodes, dependencies, scope, focused checks and no-review cadence unchanged; 3.1.19 remains final mandatory acceptance
- 2026-09-13 | operator execution-cadence amendment | remaining 3.1 tasks and prerequisites use focused tests/scoped lint/affected checks; full gates stay at 3.1.23/24/25 and final 3.1.19 acceptance; no independent review step; Codex subagents Astra/ultra; scope, task IDs and dependency edges unchanged
- 2026-09-08 | D344 prerequisite planning | visible prerequisite gates and smaller dashboard groups; operator coordinates launches/merges; existing in-flight 2.6 briefs and all acceptance remain binding
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
doc: 3.1/task-1-build-the-shared-dashboard-surfaces §Task 1 · Build the shared dashboard surfaces · ref:frontend-backend-integration §3.2 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §9.5.1 · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.3 · ref:write-safety §14.11 · ref:operator-trust §5.9 · ref:operator-trust §2.3.5 · ref:operator-trust §2.3.7

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
doc: 3.1/task-2-prove-the-dashboard-against-a-real-run §Task 2 · Prove the dashboard against a real run · ref:workflow-model §1.1 · ref:dashboard-surfaces §2.3 · ref:frontend-backend-integration §7.1

> One pass: the REAL dashboard drives a REAL composed separations dry run — plan → start → gate parks → approve through the B1 ceremony → resume → preview terminal → archive — every UI assertion paired against a direct authority-database check. Closes with the ONE deliberate parity re-freeze. Re-runs over the real commits as Track A's final evidence. Already found and fixed two projection defects on the real run (D258/D259).

builds:
- [x] PROOF `docs/rebuild/migrations/separations.md` §9.22 — items 1–8 recorded
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
doc: 3.1/task-3-harden-shared-status-commands-and-read-budgets §Task 3 · Harden shared status, commands, and read budgets · ref:frontend-backend-integration §2 · ref:frontend-backend-integration §4 · ref:frontend-backend-integration §5.1 · ref:frontend-backend-integration §7.4 · ref:workflow-model §1.2

> From the source-pinned 2026-08-20 architecture audit (`9993ab39^:docs/plans/2026-08-20-dashboard-architecture-audit.md`). **Verdict: the stack and shape are right; nothing is swapped.** Eleven ordered moves, none a rewrite, sequenced after Track C and before the next workflow leans on the dashboard. **Ruled by D264:** the track sits here under the dashboard defaults; D1–D5 are planned; D6–D10 stay proposed behind one named trigger; and §3.5 is answered — the descriptor registry LEAVES the browser bundle as row D11, amending D251. D4 and D5 double as the FIRST measurement of ref frontend-backend-integration §7.4's performance budgets, whose recorded numbers become the non-regression gates for every later workflow.

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
doc: 3.1/task-4-close-demo-fidelity-and-parity §Task 4 · Close demo fidelity and parity

> The dashboard is a 1:1 detail replica of the legacy rebuild-demo, reviewed glyph by glyph: every element is exact, or a divergence ruled by a D-number / a plan decision / a dated operator call, or unserved by a NAMED producer (a `builds:` line, never a reason to drop the detail), or OPEN in the historical audit — nothing is dismissed or "modified" without a citation. Three source-pinned ledgers audited exactly 1,956 elements/rows at HEAD on 2026-08-21 (`9993ab39^:docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` 489 · `9993ab39^:docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` 348 · `9993ab39^:docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` 1,119); a mechanical recount after the current ports, Activity AC24, Explorer EX5 and shell A46 gives 775 exact rows. The six sheets' 49 choices are ratified as D272–D276; ledger 3's 238 OPEN row marks / 30 groups remain historical audit counts, while their resulting implementations and proofs are current work.

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
doc: 3.1/task-5-serialize-duo-login-ceremonies §Task 5 · Serialize Duo login ceremonies · ref:execution-and-sessions §4.1 · ref:execution-and-sessions §4.2 · ref:execution-and-sessions §10

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
doc: 3.1/task-6-manage-worker-pools-and-run-sessions §Task 6 · Manage worker pools and run sessions · ref:execution-and-sessions §1 · ref:execution-and-sessions §3 · ref:execution-and-sessions §7.1 · ref:execution-and-sessions §11

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
doc: 3.1/task-7-record-observed-page-facts §Task 7 · Record observed page facts · ref:dashboard-surfaces §1.1 · ref:dashboard-surfaces §2.1 · ref:operator-trust §2.3

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
status: done
date: 2026-09-12 · baseline accepted after complete Astra/ultra review, local integration and cleanup
doc: 3.1/task-8-re-baseline-dashboard-truth-and-acceptance §Task 8 · Re-baseline dashboard truth and acceptance · ref:dashboard-surfaces · ref:frontend-backend-integration

builds:
- [x] PROOF inventory every visible control, route, served field, command arm, producer, and current defect against production code
- [x] DOCS map each generic operator journey to one owner, red/green gate, fixture, live proof need, later workflow-specific boundary, and non-overlapping wave file/artifact scope
- [x] DOCS turn every historical unchecked 3.1 line into a current task, explicit disposition, or superseded record
- [x] PROOF publish the acceptance matrix that Task 18 will execute unchanged
- [x] DOCS D340: settle minimum desktop viewport and resize/zoom acceptance in planning; consume the immediate pre-1.6.6 mobile-proof dispositions without losing desktop assertions

log:
- 2026-09-12 | 3.1.8 accepted | candidate `baeed585dcefb3883deffac0e6b725dfb1381b80`, complete R2 Astra/ultra review plus bounded repair PASS; integrated locally as `45df7f7de4bf54c7cee952b3b3909778f74b8b85` including approved plan `e182022edfa0cd05a46a74358cd3296bcade6e79`. 42 I/A pairs, five desktop cases, 52 historical subjects and 224 original obligations frozen; scoped gates PASS, both owned worktrees/refs removed, unrelated edits preserved. Documentation/proof only; remaining tasks unimplemented, no push or successor dispatch.
- 2026-09-08 | D344 prerequisite planning | now 3.1.8.1; former 3.1.8; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | serial prerequisite in `phase-3-1-dashboard-c21194e18-r08-truth-reset`; it must merge before any implementation wave and freeze the file/artifact ownership that makes peers independent · left: execute after 2.6 closes
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.8; standalone prerequisite or individual task; acceptance and historical execution anchor retained
- 2026-09-12 | operator-approved phase plan | B01–B06 reconciles existing 3.1 scope with accepted schema-50, Settings, summaries and saved archives; inventories production controls and freezes remaining owner/proof acceptance. One Astra/medium supervisor, no implementation workers, one independent Astra/high review; documentation/proof only, scoped D191 checks and approved local integration/cleanup. Existing task/finalizer identities remain. Implementation and downstream task admission are unstarted.


needs:
- p2f-proof

#### 9 · Establish independent dashboard boundaries {#dash-boundary-foundation}
status: done
date: 2026-09-13 · A/B focused acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-establish-independent-dashboard-boundaries §Task 3.1.9 · Establish independent dashboard boundaries · ref:operator-trust §5.4

> Complete the shared changes discovered by the acceptance inventory before independent surface writers start. Preserve existing behavior and real production consumers; no mock-only foundation.

builds:
- [x] BOTH isolate shared shell/navigation, query/route/composition registration and fixture entry points required by the selected surface assignments
- [x] BE D337: complete SQLite override conversion, atomic command/audit binding and shared wiring; preserve existing values and retire runtime file authority and prepared-claim recovery
- [x] PROOF verify fresh/supported conversion, rollback, restart/replay, source refusal and backup/restore preservation; old override files cannot influence converted appearance
- [x] PROOF verify unchanged production paths, strict contracts, redaction and behavioral negative controls; pass focused checks and the assigned integration checks
- [x] DOCS publish exact owned paths, exports, generated-artifact ownership, independent gate resources and either-order integration evidence for each admitted task

needs:
- dash-truth-reset

log:
- 2026-09-13 | 3.1.9 accepted | A integration `c990662e91604cfd38baa53e12bfb6e7c60610eb` and B integration `3d4d8c0c64cf2e96096b193966a66741861d6f1c` complete the authority/backend and UI/fixture/release prerequisite. Assigned focused tests/compiler/lint/build and 124 affected desktop parity cases pass; complete membership and 693 reference files are unchanged. Exact candidate-tree reuse and owned cleanup verified; actual child exports, ownership and gate resources published. No independent review, child dispatch or push; broad gates remain 3.1.19.
- 2026-09-08 | D344 prerequisite planning | scheduled boundary and ownership; implementation and acceptance remain open
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9; standalone prerequisite or individual task; acceptance and historical execution anchor retained
- 2026-09-13 | focused plan approved | two sequential Astra ultra sessions A (authority/backend), then B (UI/fixtures/release); complete D337 storage conversion belongs here; focused checks and no independent review; product work unstarted


##### 1 · Finish the shell, navigation, and accessibility baseline {#dash-shell}
status: done
date: 2026-09-13 · shell integration and owned cleanup accepted
doc: 3.1/task-9-1-finish-the-shell-navigation-and-accessibility-baseline §Task 3.1.9.1 · Finish the shell, navigation, and accessibility baseline · ref:dashboard-surfaces §3 · ref:frontend-backend-integration §7

builds:
- [x] FE finish top bar, workflow rail, route state, status/help/theme controls, desktop resize/zoom containment, and empty/error states (D340)
- [x] FE make every action keyboard/pointer reachable with truthful names, focus return, reduced motion, and both-theme contrast
- [x] PROOF component plus production-bundle desktop accessibility and parity coverage; consume the immediate desktop-only baseline while retaining desktop assertions and responsive CSS (D340)

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `9056e236bf73024ab9649a73c5c6915633e23061` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-13 | 3.1.9.1 accepted | Operator-directed local integration `251d471b27dcdb0d32027fc5dd9acffffe3c6449` accepts corrected candidate `9056e236bf73024ab9649a73c5c6915633e23061`. Typecheck, 93 shell tests, 28 architecture checks, focused schema-fixture regression, scoped lint, 34 production-browser cases and actual 125%/200% zoom pass; exact candidate-tree equality and owned worktree/ref cleanup verified. No push or group release; 3.1.9.8 combined acceptance and 3.1.19 full gates remain open.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-1.1; former 3.1.9-1; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 1 frame seam in `phase-3-1-dashboard-c21194e18-r09-shell`, parallel with Tasks 11, 13 and 25 · left: Task 8 ownership freeze
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.1; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 2 · Finish Settings over the canonical settings authority {#dash-settings}
status: done
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-2-finish-settings-over-the-canonical-settings-authority §Task 3.1.9.2 · Finish Settings over the canonical settings authority · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4 · ref:guards-and-tests §5.2

> D336: ordinary settings are SQLite-owned; protected writes/readback are independent credential operations. Keep the catalog, revision/conflict, reset/clear behavior and accepted new-run settings activation.

> D341: consume the application-only 86-row catalog; test subjects, canaries, file paths and test data are excluded from Settings/Setup and credential operations.

builds:
- [x] BOTH render every catalog leaf in one Settings information architecture with source, validity, editability, sensitivity, and current activation scope
- [x] BOTH support revisioned edit/save/conflict/reset flows; protected values are write-only and display presence, never plaintext
- [x] PROOF invalid, stale, partial, interrupted, current/stale-plan, and redaction paths against persisted readback

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `368496e0d55a259e8dd098c81a37bbcc9a966763` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-1.2; former 3.1.9-2; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 1 settings seam in `phase-3-1-dashboard-c21194e18-r11-settings`, parallel with Tasks 9, 13 and 25 · left: Task 8 ownership freeze
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D331 §D331.10 edit contract, §D331.5's two CAS arms and §D331.6 presence readback (no redesign) · left: the deliberate P40/A8 parity re-freeze happens here
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.2; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 3 · Finish basic storage health and recovery access {#dash-storage}
status: done
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-3-finish-basic-storage-health-and-recovery-access §Task 3.1.9.3 · Finish basic storage health and recovery access · ref:operator-trust §1 · ref:frontend-backend-integration §10 · ref:dashboard-surfaces §2.5

> D336 supplies the revised SQLite-settings recovery contract. D339 keeps basic health and access to recovery commands in release scope; new advanced recovery interfaces are deferred until needed.

builds:
- [x] BOTH serve truthful health/doctor findings and actionable access/instructions for supported explicit backup, restore and upgrade commands
- [x] BOTH preserve working controls and stopped-system/revision admission without requiring new interactive restore, migration or repair UI for release
- [x] PROOF cover underlying corruption, interruption, stale, unknown and missing-credential states; show no inert recovery controls and record the advanced-interface deferral

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `1514c27f069765cb62cf5bcf2b461ba5555eca92` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-1.3; former 3.1.9-3; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 1 storage seam in `phase-3-1-dashboard-c21194e18-r13-storage`, parallel with Tasks 9, 11 and 25 · left: Task 8 ownership freeze
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D332 §D332.1 (`cli storage upgrade` as a fourth subcommand), §D332.6 verdicts, §D332.5 journal and §D332.4 restore admission (no redesign) · left: D322 explicit-only backup stands
- 2026-09-06 | D339 approved deferral | basic health/recovery access remains required; new advanced recovery UI waits for a concrete need or explicit post-release request
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.3; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 4 · Finish Workflow Explorer and catalog editing {#dash-explorer}
status: done
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-4-finish-workflow-explorer-and-catalog-editing §Task 3.1.9.4 · Finish Workflow Explorer and catalog editing · ref:operator-trust §5.4

builds:
- [x] BOTH preserve graph/catalog reads and validated presentation preview/diff/revision/hot-apply behavior; workflow code remains source-authored
- [x] BOTH consume 3.1.9's accepted D337 SQLite authority through isolated editor/service ports; preserve label/icon/category editing, conflicts and hot readback
- [x] PROOF validate invalid/cyclic/stale/manifest-drift/reload cases and exact replay through the accepted prerequisite; conversion/recovery and shared DDL/composition proof belong to 3.1.9

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `2ec017d992d74190d54a3af0cd052192294c5e7a` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-4.1; former 3.1.9-4; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 1 Explorer/catalog seam in `phase-3-1-dashboard-c21194e18-r25-explorer`, parallel with Tasks 9, 11 and 13 · left: Task 8 ownership freeze
- 2026-09-06 | D337 approved simplification | same appearance editing, one SQLite commit instead of file/database coordination; implementation remains Task 9-4
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.4; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained
- 2026-09-13 | operator allocation | complete storage conversion/shared wiring moves to 3.1.9; this child retains editor work over its accepted authority; product outcomes and dependencies unchanged


##### 5 · Finish notifications and delivery behavior {#dash-notifications}
status: done
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-5-finish-notifications-and-delivery-behavior §Task 3.1.9.5 · Finish notifications and delivery behavior · ref:operator-trust §6 · ref:dashboard-surfaces §2.6

builds:
- [x] BE publish every declared trigger, including run-failed, subject-mismatch, write-parked, repeating-failure, verified-done, storage, and backfill-gap
- [x] BOTH implement pinned/read/snooze/dismiss/filter/open-target behavior from durable actor-keyed rows
- [x] PROOF row-before-OS-delivery, dedupe, restart, reconnect-gap, permission-denied, stale command, and target-link cases

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `387836885d426db81dac63126adc28aea9f71ddd` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-14 | approved 3.1.9.5 execution brief | N1–N5, durable source identities, all eight production triggers, actionable inbox and explicit browser delivery; narrow shared ownership and contract amendments; focused candidate for 3.1.9.8, full acceptance at 3.1.19; implementation pending
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-4.2; former 3.1.10-3; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 2 notification seam in `phase-3-1-dashboard-c21194e18-r17-notifications`, parallel with Tasks 10, 14 and 26 · left: Task 8 ownership freeze
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.5; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 6 · Finish Intake surfaces {#dash-intake-edit}
status: done
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-6-finish-intake-surfaces §Task 3.1.9.6 · Finish Intake surfaces · ref:data-intake-and-edit-data · ref:frontend-backend-integration §5.1.7

builds:
- [x] BOTH complete spreadsheet upload/map/validate/reject/prepare/manifest/rerun-diff flows over existing services; classification/OCR obligations retain their existing owners
- [x] BOTH show producer progress, records, blocked reasons, mappings, validation, provenance, and exact workflow handoff availability
- [x] PROOF real representative files plus malformed, partial, canceled, stale, redacted, duplicate, and archived cases
- [x] PROOF preserve ordinary Run/Rerun and prior-run values; only the spreadsheet upload extraction/call site and Intake-specific comparison/confirmation changes use the approved narrow shared-file exception

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `45748dae4436537ab86585ffa03b95dbc6843caa` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-14 | operator-approved phase plan | I1–I5 completes spreadsheet Intake, with narrow upload extraction and Intake command/confirmation ownership; one Astra/medium supervisor, no workers/review, focused proof and 3.1.9.8 finalizer intake. Classification/OCR wording corrected; existing owners retained. Plan approval is complete, implementation unstarted; launch requires a free slot within the four-worktree ceiling.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-4.3; former 3.1.10-4; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 2 Intake/Edit Data seam in `phase-3-1-dashboard-c21194e18-r26-intake-edit`, parallel with Tasks 10, 14 and 17 · left: Task 8 ownership freeze
- 2026-09-05 | D334 ownership correction | this task now owns Intake only; Rerun and prior-run value consumption move to Task 11-2, preserving independent wave ownership · left: Task 8 ownership freeze
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.6; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 7 · Finish Archive saved reports, version changes, and deletion {#dash-archive}
status: done
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-7-finish-archive-saved-reports-version-changes-and-deletion §Task 3.1.9.7 · Finish Archive saved reports, version changes, and deletion · ref:dashboard-surfaces §9.5 · ref:operator-trust §5.7 · ref:dashboard-surfaces §9.2 · ref:dashboard-surfaces §2.5

builds:
- [x] BOTH finish indexed saved-report browsing and frozen generic evidence without current descriptors; credit accepted A/H subfeatures only within their proof
- [x] BOTH complete version-change review/apply/resume, report export and exact terminal live/saved-report deletion with canonical disposition and shared-file custody
- [x] PROOF current/missing/corrupt/stale/partial/replay cases, minor-versus-major membership, redaction, truthful labels, storage deltas and convergence
- [x] PROOF archive execution doors remain absent; C0 and accepted 2.6.9 supersede archived_runs, relaunch and archive_relaunches obligations

needs:
- dash-truth-reset
- dash-boundary-foundation

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Candidate `27bbbe74791fab7c4f7ec1485922dc2b485fd688` and its accepted integration are retained in master ancestry. Combined focused gates and owned cleanup are verified in the finalizer owner; child complete. Full acceptance remains 3.1.19.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-4.4; former 3.1.11-3; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 3 Archive seam in `phase-3-1-dashboard-c21194e18-r23-archive`, parallel with Tasks 12 and 15 · left: Task 8 ownership freeze
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.8 (archive, `delete-archived-run` citing `contentDigest`), §D330.7 relaunch as a fresh run with archive lineage, and D332 §D332.7 item 7 (no redesign) · left: archive visibility is unchanged across the upgrade
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.9.7; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained
- 2026-09-16 | approved Archive AR1–AR5 plan | one Astra/medium supervisor, no workers or independent review; narrow interrupted-delete identity/progress repair, saved-report export and focused production-service browser proof admitted; direct committed-ref plan delivery, integration remains operator-controlled through 3.1.9.8; implementation pending


##### 8 · Finalization — dashboard surfaces {#dash-surfaces-finalizer}
status: done
size: M
date: 2026-09-17 · focused group acceptance, directed local integration and owned cleanup
doc: 3.1/task-9-8-finalization-dashboard-surfaces §Task 3.1.9.8 · Finalization — dashboard surfaces · ref:guards-and-tests §3.14

> Combine worker candidates with passing focused checks: 3.1.9.1–3.1.9.7; fix group defects, run typecheck, focused integration tests, scoped lint and affected build/generated checks, defer full repository gates to 3.1.19 and complete accepted integration and cleanup; no independent review step.

builds:
- [x] BOTH resolve combined defects and generated-output drift within the approved group
- [x] PROOF typecheck, focused integration/regression tests, scoped lint and affected build/generated checks; full gates deferred to 3.1.19
- [x] DOCS candidate SHAs, focused group evidence, deferred broad proofs for 3.1.19, development integration and cleanup

needs:
- dash-shell
- dash-settings
- dash-storage
- dash-explorer
- dash-notifications
- dash-intake-edit
- dash-archive

log:
- 2026-09-17 | 3.1.9.8 group release accepted | Frozen delivery `2109cab8fc6481e1aa2a4eceb9052953a76c6254` integrated at `801da4f3d1bfdf0a9ecc81c993289f70699aa140` with exact tree equality. All seven children and finalizer cleanup complete; durable child proof retained. Releases 3.1.10–3.1.12 without dispatch. Documentation checks record unchanged runtime inputs; full acceptance and retained broad-ratchet findings remain 3.1.19.
- 2026-09-16 | operator-approved 3.1.9.8 execution brief | F1–F5 combines seven surface candidates and fixes group interfaces, including narrow Run-dialog focus repair; one Astra/medium supervisor, no workers or independent review, focused group gates and explicit operator integration. Five candidates are already integrated and Intake is frozen; launch waits for Archive's exact frozen candidate and completed focused proof. Full acceptance remains 3.1.19; implementation unstarted.
- 2026-09-17 | 3.1.9.8 prerequisites verified | Archive delivery `27bbbe74791fab7c4f7ec1485922dc2b485fd688` now contains completed AR1–AR5 and passing focused proof, including its approved Settings correction. Exact source/reference/log hashes and ancestry verified; Intake and the five accepted integrations unchanged. The approved finalizer is ready for a fresh supervisor after planning persistence checks; implementation and group release remain open.
- 2026-09-17 | 3.1.9.8 focused candidate frozen | Exact Intake/Archive deliveries combined with five accepted ancestors; Run dismissal focus repaired; required 29-file/522-test selection, 138 browser cases plus exact Start selection, typecheck, scoped lint and generated checks pass. Implementation `752607c69bbfc8c425c7a3e1c9e7890b6cc88e84`; durable evidence and inherited broad-ratchet findings are recorded in the owner. Explicit master integration and cleanup remain pending; no downstream release or full acceptance claim.

#### 10 · Repair date navigation and the date picker {#dash-date-navigation}
status: done
date: D344 · former 3.1.10-1 · independent worktree after named prerequisites
doc: 3.1/task-10-repair-date-navigation-and-the-date-picker §Task 3.1.10 · Repair date navigation and the date picker · ref:clock-config-secrets §1 · ref:dashboard-surfaces §3

builds:
- [x] BOTH make selected date, URL, loaded day snapshot, timezone, Today, next/previous, keyboard input, and browser history one coherent state machine
- [x] FE handle month/year boundaries, invalid input, loading races, disabled dates, focus/escape/outside-click, and desktop resize/zoom geometry
- [x] PROOF timezone/DST matrix plus browser tests for direct links, rapid changes, refresh, Back/Forward, and stale-response rejection

needs:
- dash-shell
- dash-boundary-foundation
- dash-surfaces-finalizer

log:
- 2026-09-19 | 3.1.10 accepted and cleaned | Frozen delivery `4235dbcaf3c48a9e24f435dde5069fd04e51903c` integrated at `517f7319fdcd771aee8356e664f1e8a885032ba0` after explicit operator instruction. Runtime inputs match all focused passing receipts; combined documentation checks pass. Owned worktree registration/folder and implementation/planning refs are removed, evidence retained. Sessions planning/worktree preserved; no push or downstream dispatch. Full acceptance remains 3.1.19.
- 2026-09-18 | 3.1.10 focused candidate frozen | Implementation `7b98ba23dc9f5876dba927ad6cf02498c51e2d8c` completes DN1–DN5 locally. Exact 12-file/74-test gate, 62 focused architecture tests, typecheck, scoped lint, 42 browser cases and both-theme native 125%/200% zoom pass. Durable evidence is in the task owner. Explicit local master integration and cleanup remain pending; checkboxes stay open and full acceptance remains 3.1.19.
- 2026-09-18 | operator-approved DN1–DN5 execution brief | One Astra/medium supervisor, no workers or independent review. Bounded canonical-summary calendar read and narrow shared date/API/fixture ownership; live Today versus pinned dates, visible invalid/future recovery, stale-response identity, accessible picker and production-service browser/zoom proof. Accepted 3.1.9.8 prerequisite verified; direct committed-ref plan delivery, operator-controlled master integration and cleanup. Implementation pending; full acceptance remains 3.1.19.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-1.4; former 3.1.10-1; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 2 date-state seam in `phase-3-1-dashboard-c21194e18-r10-date-navigation`, after the shell contract and parallel with Tasks 14, 17 and 26 · left: Tasks 8 and 9
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.10; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 11 · Finish sessions, worker pools, and browser lifecycle {#dash-sessions}
status: done
date: D344 · former 3.1.10-2 · independent worktree after named prerequisites
doc: 3.1/task-11-finish-sessions-worker-pools-and-browser-lifecycle §Task 3.1.11 · Finish sessions, worker pools, and browser lifecycle · ref:execution-and-sessions §3 · ref:execution-and-sessions §11

builds:
- [x] BOTH make plan/spawn/pause/resume/stop/refresh/reopen controls execute real worker-supervisor effects
- [x] BOTH show durable session membership, worker state, current claim, browser profile instance, health, and refusal reason without inference
- [x] PROOF crash/restart, stale CAS, duplicate ownership, pool resize, orphan cleanup, and two-run parallel dry-run behavior

needs:
- dash-settings
- dash-storage
- dash-boundary-foundation
- dash-surfaces-finalizer

log:
- 2026-09-19 | 3.1.11 accepted and cleaned | Frozen `c0f8c45d8e426dd5c99529c91982d0eb425c740f` integrated locally at `c90da4ffc45ddfe6486192b8df68816dc6fe34a3` after operator instruction. Date imports/body preserved; missing disposable-writer registration repaired with existing negative controls. 746 focused tests, 27 browser journeys, scoped lint/semantic and build/generated checks pass. Branch/worktree and owned runtime/scratch residue removed with evidence retained. Extra broad reference sampling failed 18 manifest-hash expectations; exact failures remain assigned to 3.1.19, not passed or waived. Sessions prerequisite released; no push or child dispatch.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-2.1; former 3.1.10-2; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 2 session/runtime seam in `phase-3-1-dashboard-c21194e18-r14-sessions`, after Tasks 11 and 13 and parallel with Tasks 10, 17 and 26 · left: wave 1 integration
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.11; standalone prerequisite or individual task; acceptance and historical execution anchor retained
- 2026-09-18 | operator-approved 3.1.11 execution brief | Complete S1–S6 plan: worker lifetime/control-revision fencing, strict pool CAS, durable browser command/outcome channel, idle-only Refresh/Reopen, truthful controls and completed shared child APIs. Choices 1 A / 2 A ratified at execution/session and dashboard contracts. One Astra/medium supervisor, no workers or independent review; focused gates now, broad acceptance at 3.1.19. Accepted 3.1.9.8 is available; product implementation and operator-directed integration remain unstarted.
- 2026-09-19 | operator-approved preflight admission ownership amendment | Choice 1 A during 3.1.11.1 planning adds shared descriptor-derived readiness, report/freshness and pre-effect start/enqueue/worker/browser admission hooks to parent S5, with focused positive/refusal proof before child release. Setup owns detectors/corpus/UI; Run/Rerun remains independent. Existing session choices, integration permission and Phase 3.1 gate cadence are unchanged; implementation proof remains open.
- 2026-09-19 | accepted preflight admission amendment | Shared readiness and effect boundaries implemented in 549a70186 and integrated at ef050d0a8. Parent release publishes exact ports, focused positive/refusal proof and baseline-only deferred failures. Operator authorized owned cleanup and launch of 3.1.11.1; complete detector/corpus/UI acceptance remains the child. No push or finalizer dispatch.


##### 1 · Finish Setup and preflight {#dash-setup}
status: done
date: D344 · former 3.1.11-1 · independent worktree after named prerequisites
doc: 3.1/task-11-1-finish-setup-and-preflight §Task 3.1.11.1 · Finish Setup and preflight · ref:frontend-backend-integration §5.1 · ref:operator-trust §3 · ref:clock-config-secrets §3

builds:
- [x] BOTH derive setup state from the settings catalog, storage, workers, browsers, and workflow prerequisites
- [x] BOTH make every fix action real, idempotent, attributable, and followed by authoritative re-check
- [x] PROOF execute the declared preflight fault corpus and restart/recovery cases from a fresh local state root

needs:
- dash-settings
- dash-storage
- dash-sessions
- dash-boundary-foundation
- dash-surfaces-finalizer

log:
- 2026-09-21 | focused release integrated and cleaned | Operator-directed worktree sweep accepted Operations `2c81ebd84` and both complete child histories. Exact merged product tree matches verified candidate; 2,890 file hashes and retained gate evidence checked. Combined typecheck, 819 focused tests, 69 browser cases, scoped lint and affected generated checks reused on unchanged inputs. Closure documentation checked; all three incorporated branches/worktree registrations/folders removed after hash-verified evidence preservation. Full acceptance and retained failures remain 3.1.19; no push or downstream dispatch. Final merge SHA and cleanup receipt are linked from the task owner.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-1.5; former 3.1.11-1; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 3 composed-preflight seam in `phase-3-1-dashboard-c21194e18-r12-setup`, parallel with Tasks 15 and 23 only after settings, storage and sessions merge · left: Tasks 11, 13 and 14
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D331 §D331.10 and §D331.11 P16 (no redesign) · left: the first post-upgrade boot's `migrated-refused { key }` is a setup fault with the `.env` remove-list (§D332.S5)
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.11.1; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained
- 2026-09-19 | operator-approved 3.1.11.1 execution brief | Complete S1–S5 plan: verify accepted parent admission interfaces, complete registry-selected detectors, finish shared-report Setup/doctor presentation, execute all 14 fault manifests plus healthy/dependency controls, and freeze focused proof for 3.1.11.3. One Astra/medium supervisor, zero workers/reviewers; no automatic repair or new CLI doctor/test-login. WAITING ON accepted 3.1.11 including the admission amendment and committed plan availability; no implementation or runtime acceptance claimed.
- 2026-09-19 | Setup launch prerequisite released | Complete approved plan and actual parent admission ports are integrated at ef050d0a8; launch explicitly authorized after verified owned cleanup. Assigned branch/path and exact launch base are in the owning release/receipt. Operator selects supervisor model; zero workers/reviewers remain. Earlier WAITING ON and model assignment are superseded; implementation and finalizer acceptance remain open.


##### 2 · Make Run and Rerun enqueue real work {#dash-run-modal}
status: done
date: D344 · former 3.1.11-2 · independent worktree after named prerequisites
doc: 3.1/task-11-2-make-run-and-rerun-enqueue-real-work §Task 3.1.11.2 · Make Run and Rerun enqueue real work · ref:workflow-model §5.6 · ref:frontend-backend-integration §5.1.1 · ref:data-intake-and-edit-data §6 · ref:dashboard-surfaces §9.1 · ref:dashboard-surfaces §9.2

builds:
- [x] FE use one Rerun action: failed/interrupted sources default to remaining steps plus descriptor-required completed steps with a visible explanation, successful sources to all eligible steps; allow freely changed eligible optional selections. Selected previously submitted transactions show Cancel / Confirm; warning Confirm advances to Values only, and final submission carries 1.6.4's D335 acknowledgment
- [x] BOTH make ordinary Run and Rerun use one modal and one source-bound server plan/confirm/enqueue path; Rerun opens at Steps, optional warning Confirm advances to Values, and only final modal submission consumes the plan and queues work
- [x] BOTH offer descriptor-allowed completed-step values as optional editable prefill and let the operator independently copy/change/clear values and select/omit eligible steps; submitted values/omissions alone are authoritative
- [x] BOTH create and reveal a new queued run identity only on final modal submission; keep the source byte-identical, never replay an unselected step, and never fabricate proof for an omitted transaction
- [x] PROOF ordinary/single/batch/dry-run, Rerun defaults and customization, stale/deleted/archived source, malformed/partial prefill, changed item, unknown-write refusal, conflict, no-worker, delayed-worker, reload, and exactly-once paths

needs:
- dash-sessions
- dash-boundary-foundation

log:
- 2026-09-21 | focused release integrated and cleaned | Operator-directed worktree sweep accepted Operations `2c81ebd84` and both complete child histories. Exact merged product tree matches verified candidate; 2,890 file hashes and retained gate evidence checked. Combined typecheck, 819 focused tests, 69 browser cases, scoped lint and affected generated checks reused on unchanged inputs. Closure documentation checked; all three incorporated branches/worktree registrations/folders removed after hash-verified evidence preservation. Full acceptance and retained failures remain 3.1.19; no push or downstream dispatch. Final merge SHA and cleanup receipt are linked from the task owner.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-2.2; former 3.1.11-2; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 3 run-start seam in `phase-3-1-dashboard-c21194e18-r15-run-start`, parallel with Tasks 12 and 23 after the session supervisor is real · left: Task 14
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.5 `create`, §D330.6 first-eligible claim in one transaction with `runtime-stale`, and §D330.4's served `version` as the one CAS token (no redesign) · left: a bulk start is D235's N children and one vector
- 2026-09-05 | D334 operator correction | Rerun is the launcher for the ordinary Run modal, not direct recovery commands. This task consumes 2.6 Task 1-2's read-only prefill projection; Task 10-4 retains Intake only · left: implementation after 2.6
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.11.2; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained
- 2026-09-19 | operator-approved 3.1.11.2 plan | One operator-opened supervisor, operator-selected model/effort, no workers/reviewer; one source-bound Run/Rerun modal, editable declared prefill, warning-to-Values navigation, exact supersede preview and singular final-submit/reload replay. Decision 1 A includes required completed steps with a visible explanation. Focused child gates; 3.1.11.3 group integration; full acceptance at 3.1.19. Planning approved; accepted Sessions/preflight releases verified and the bounded launch ownership amendment resolves the two gaps. Implementation remains unstarted; no task launch or product integration authorized.
- 2026-09-19 | approved launch ownership amendment | child owns narrow Rerun dispatch and pre-Values warning preview; accepted parent/preflight release verified; planning integration authorized, implementation unstarted


##### 3 · Finalization — run operations {#dash-operations-finalizer}
status: done
size: M
date: D344 · renumbered 2026-09-13 · sequential finalization after all group workers
doc: 3.1/task-11-3-finalization-run-operations §Task 3.1.11.3 · Finalization — run operations · ref:guards-and-tests §3.14

> Combine worker candidates with passing focused checks: 3.1.11.1–3.1.11.2; fix group defects, run typecheck, focused integration tests, scoped lint and affected build/generated checks, defer full repository gates to 3.1.19 and complete accepted integration and cleanup; no independent review step.

builds:
- [x] BOTH resolve combined defects and generated-output drift within the approved group
- [x] PROOF typecheck, focused integration/regression tests, scoped lint and affected build/generated checks; full gates deferred to 3.1.19
- [x] DOCS candidate SHAs, focused group evidence, deferred broad proofs for 3.1.19, development integration and cleanup

needs:
- dash-setup
- dash-run-modal

log:
- 2026-09-21 | focused release integrated and cleaned | Operator-directed worktree sweep accepted Operations `2c81ebd84` and both complete child histories. Exact merged product tree matches verified candidate; 2,890 file hashes and retained gate evidence checked. Combined typecheck, 819 focused tests, 69 browser cases, scoped lint and affected generated checks reused on unchanged inputs. Closure documentation checked; all three incorporated branches/worktree registrations/folders removed after hash-verified evidence preservation. Full acceptance and retained failures remain 3.1.19; no push or downstream dispatch. Final merge SHA and cleanup receipt are linked from the task owner.
- 2026-09-19 | operator-approved 3.1.11.3 execution brief | Complete F1–F6 plan: exact child intake, either-order combination, bounded group repairs, production-service/browser proof, focused gates and operator-directed integration/cleanup. One Astra/medium supervisor, no workers or independent review. Full acceptance remains 3.1.19. Planning persistence is authorized; implementation waits for accepted Sessions and both committed, focused-green child candidates.
- 2026-09-21 | verified finalizer intake | Accepted Sessions/preflight ancestors plus Setup `9ac176dd77198c29c33134de3d43f45f00f18ebb` and Run/Rerun `9e3060d3ef73fba127fc945dd80398e1bc3bd0a0` verified against focused receipts and 2,570/148 committed-input hashes. Disjoint child changes produce the same object tree in either order. Ready for operator-opened 3.1.11.3; combined gates, product integration and cleanup remain unstarted. Current personal instructions reserve model/effort selection to the operator.
- 2026-09-21 | F1–F5 focused candidate frozen | Both full child candidates and approved ownership exceptions consumed from db8433c83; either-order composition verified. Repairs 176c6e0fc and attributed references 46f4d355f pass full typecheck, 819 focused tests, 69 built-browser cases, scoped lint and affected generated checks, with native 125%/200% zoom proof. Exact recording tip, inputs and retained limits are in the owner/evidence receipt. F6 product integration, child/group closure, owned worktree cleanup and downstream release await operator instruction. No workers, independent review, push or successor dispatch; full acceptance remains 3.1.19.

#### 12 · Finish Activity, search, and export {#dash-activity}
status: done
date: 2026-09-21 · integrated focused acceptance; full repository gates remain 3.1.19
doc: 3.1/task-12-finish-activity-search-and-export §Task 3.1.12 · Finish Activity, search, and export · ref:frontend-backend-integration §6.7 · ref:dashboard-surfaces §9.5.2

builds:
- [x] BOTH search/filter across dates, workflows, subjects, statuses, actors, versions, failures, and evidence without scanning unbounded state
- [x] BOTH produce truthful summaries and spreadsheet/diagnostic exports from stable result snapshots
- [x] PROOF pagination, cancellation, stale responses, redaction, large history, empty/error cases, and exported-row reconciliation

needs:
- dash-archive
- dash-boundary-foundation
- dash-surfaces-finalizer

log:
- 2026-09-21 | accepted local 3.1.12 release | Candidate 6d42b66fd133 integrated into local master as b77def9af67b after operator instruction; exact merged tree and all 143 changed-file hashes match the focused-green candidate. Reused unchanged 659-test, 25-browser-case, scoped lint/type, generated and native 125%/200% zoom evidence; fresh recording gates pass. Schema 54 preserves historical compatibility and recovery floor 46. Guard/fixture-only scope amendment completed. Owned worktree, physical folder and branch removed with proof artifacts retained; dirty UI planning and integrated Operations preserved. No push, standing database migration, HR writes or next-task dispatch. Full diagnostic bundles remain 3.1.14.4 and full acceptance remains 3.1.19.
- 2026-09-21 | operator-approved 3.1.12 plan | Full S1–S7 scope and choices 1 A / 2 A / 3 A approved: bounded metadata search across all roadmap dimensions, necessary shared/database contracts and indexed publication/rebuild/compatibility, one Activity/page/export snapshot, spreadsheet-safe CSV and redacted diagnostic metadata manifest; full bundles remain 3.1.14.4. One operator-selected supervisor, zero workers/reviewers; focused proof and gates here, full acceptance 3.1.19. Required releases verified; documentation candidate validated and local integration/cleanup explicitly approved; the owning release receipt binds the verified READY handoff. Product implementation remains unstarted.
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-4.5; former 3.1.12-3; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 4 Activity/search/export seam in `phase-3-1-dashboard-c21194e18-r24-activity`, parallel with Tasks 16, 18 and 30 after Archive freezes history identity · left: Task 23
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.12; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 13 · Finish queue rows, commands, and deletion {#dash-queue}
status: planned
date: D344 · former 3.1.12-1 · independent worktree after named prerequisites
doc: 3.1/task-13-finish-queue-rows-commands-and-deletion §Task 3.1.13 · Finish queue rows, commands, and deletion · ref:dashboard-surfaces §4 · ref:frontend-backend-integration §5.1 · ref:dashboard-surfaces §9.2

builds:
- [ ] BOTH render ordering, status, identity, session, worker, progress, outcome, constraints, evidence, and group/member facts from summary-backed display queries with canonical service enrichment
- [ ] BOTH make cancel/rename/bump/delete/bulk commands real, revision-bound, and reconciled to one response vocabulary; Rerun launchers remain Task 11-2's plan-backed modal
- [ ] BOTH define delete as an idempotent lifecycle/tombstone operation with explicit evidence-retention and visible result
- [ ] PROOF command matrix, stale conflicts, double-clicks, concurrent worker transitions, and queue/current/archive convergence

needs:
- dash-run-modal
- dash-boundary-foundation
- dash-operations-finalizer

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-2.3; former 3.1.12-1; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 4 queue seam in `phase-3-1-dashboard-c21194e18-r16-queue`, parallel with Tasks 18, 24 and 30 after authoritative start exists · left: Task 15
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.5 row facts, §D330.6 `list` order and §D330.8 delete plus tombstone (no redesign) · left: this task owns the two R01 residues — producing the `remove-queue-surface` / `tombstone-queue-surface` wire events, and reconciling the two projector outcome enums that disagree on `skipped`
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.13; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 14 · Establish independent run-detail sections {#dash-detail-foundation}
status: planned
date: D344 · operator-coordinated prerequisites
doc: 3.1/task-14-establish-independent-run-detail-sections §Task 3.1.14 · Establish independent run-detail sections

> Extract the section-boundary obligation from former Task 12-2. Finish this prerequisite before the timeline and evidence-section tasks; those tasks need this accepted boundary, not each other.

builds:
- [ ] BOTH separate production projector/component/test entry points for Context/Data, Logs, Receipts/Failures and Gates with one completed registration owner
- [ ] PROOF preserve the existing live detail path and section behavior, pass focused checks, then integrate the common base
- [ ] DOCS freeze exclusive section and timeline paths plus fixtures; refuse admission while a shared mutable switch/query remains

needs:
- dash-boundary-foundation
- dash-run-modal
- dash-queue
- dash-operations-finalizer

log:
- 2026-09-08 | D344 prerequisite planning | scheduled boundary and ownership; implementation and acceptance remain open
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.14; standalone prerequisite or individual task; acceptance and historical execution anchor retained


##### 1 · Finish run detail and the live timeline {#dash-run-detail}
status: planned
date: D344 · former 3.1.12-2 · independent worktree after named prerequisites
doc: 3.1/task-14-1-finish-run-detail-and-the-live-timeline §Task 3.1.14.1 · Finish run detail and the live timeline · ref:dashboard-surfaces §5 · ref:dashboard-surfaces §9.2

builds:
- [ ] BOTH render task groups, attempts, replay/skipped/blocked arms, live duration, systems, provenance, and focusable timeline segments
- [ ] BOTH follow the selected run live without losing expansion, focus, scroll, or exact attempt identity
- [ ] BOTH consume the accepted detail-section foundation while retaining exclusive timeline ownership; section extraction is owned by 3.1.14
- [ ] PROOF refresh/reconnect, replay, retry, archive, out-of-order patch, and terminal convergence against direct authority checks

needs:
- dash-run-modal
- dash-boundary-foundation
- dash-detail-foundation
- dash-operations-finalizer

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-3.1; former 3.1.12-2; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 4 run-detail foundation in `phase-3-1-dashboard-c21194e18-r18-run-detail`, parallel with Tasks 16, 24 and 30; its exit freezes the four disjoint wave-5 section seams · left: Task 15
- 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 §D330.3's seven states and §D330.4's `version` as `rowRevision`, with D268's one derivation retained and no fold arm (§D330.12 item 1) (no redesign) · left: attempts render as separately selectable rows, never compared (D289 amendment)
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.14.1; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 2 · Finish Context, Data, Attempts, and provenance readback {#dash-context-data}
status: planned
date: D344 · former 3.1.13-1 · independent worktree after named prerequisites
doc: 3.1/task-14-2-finish-context-data-attempts-and-provenance-readback §Task 3.1.14.2 · Finish Context, Data, Attempts, and provenance readback · ref:dashboard-surfaces §5 · ref:data-intake-and-edit-data §6

builds:
- [ ] BOTH render declared inputs, origins, directions, redaction, checkpoint provenance, attempt history, and D334 prior-run value coordinates without a mutable source editor
- [ ] BOTH link eligible rows to Task 11-2's Rerun modal while keeping the Context/Data rail read-only
- [ ] PROOF empty, redacted, malformed, stale, cross-attempt, archived, and prior-run prefill/readback cases

needs:
- dash-queue
- dash-detail-foundation
- dash-boundary-foundation

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-3.2; former 3.1.13-1; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Context/Data section seam in `phase-3-1-dashboard-c21194e18-r19-context-data`, parallel with Tasks 20–22 only through Task 18's frozen section boundary · left: Tasks 16 and 18
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.14.2; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 3 · Finish logs, observations, and captures {#dash-logs}
status: planned
date: D344 · former 3.1.13-2 · independent worktree after named prerequisites
doc: 3.1/task-14-3-finish-logs-observations-and-captures §Task 3.1.14.3 · Finish logs, observations, and captures · ref:operator-trust §2.3 · ref:dashboard-surfaces §5

builds:
- [ ] BE compose the missing production note and line-kind producers without inventing page facts
- [ ] BOTH render bounded searchable note/observed/fence/navigation/pause/event rows plus diagnostic captures and bundles
- [ ] PROOF pagination snapshots, stale-response isolation, archive read-forward, redaction, artifact absence, and large-log behavior

needs:
- dash-queue
- dash-detail-foundation
- dash-boundary-foundation

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-3.3; former 3.1.13-2; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Logs section seam in `phase-3-1-dashboard-c21194e18-r20-logs`, parallel with Tasks 19, 21 and 22 only through Task 18's frozen section boundary · left: Tasks 16 and 18
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.14.3; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 4 · Finish receipts and failure records {#dash-receipts-failures}
status: planned
date: D344 · former 3.1.13-3 · independent worktree after named prerequisites
doc: 3.1/task-14-4-finish-receipts-and-failure-records §Task 3.1.14.4 · Finish receipts and failure records · ref:operator-trust §5 · ref:write-safety §6

builds:
- [ ] BOTH render derived receipt identity, action evidence, write-state proof, failure fingerprint, causal record, recovery, and unknown outcomes
- [ ] BOTH connect explain/open-evidence actions to immutable evidence and eligible Rerun launches to Task 11-2's source-bound Run modal; unknown writes never expose Rerun
- [ ] PROOF success, verified no-op, refusal, failed, unknown-submit, recovered, retried, archived, and tamper cases

needs:
- dash-queue
- dash-detail-foundation
- dash-boundary-foundation

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-3.4; former 3.1.13-3; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Receipt/Failure section seam in `phase-3-1-dashboard-c21194e18-r21-receipts-failures`, parallel with Tasks 19, 20 and 22 only through Task 18's frozen section boundary · left: Tasks 16 and 18
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.14.4; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 5 · Finish gates and parked-write resolution {#dash-gates}
status: planned
date: D344 · former 3.1.13-4 · independent worktree after named prerequisites
doc: 3.1/task-14-5-finish-gates-and-parked-write-resolution §Task 3.1.14.5 · Finish gates and parked-write resolution · ref:write-safety §14 · ref:dashboard-surfaces §5

builds:
- [ ] BOTH render active and settled gate evidence, freshness, actor, command version, write plan, conflict, rejection, and machine-verified absence of gate
- [ ] BOTH make approve/reject/reopen and parked-write resolution real, attributable, revision-bound commands
- [ ] PROOF stale, expired, changed-plan, skipped-condition, resumed, rejected, archived, and unauthorized paths

needs:
- dash-queue
- dash-detail-foundation
- dash-boundary-foundation

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-3.5; former 3.1.13-4; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 5 Gate/Parked-write section seam in `phase-3-1-dashboard-c21194e18-r22-gates`, parallel with Tasks 19–21 only through Task 18's frozen section boundary · left: Tasks 16 and 18
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.14.5; parallel child of its completed parent prerequisite; acceptance and historical execution anchor retained


##### 6 · Finalization — run detail {#dash-detail-finalizer}
status: planned
size: M
date: D344 · renumbered 2026-09-13 · sequential finalization after all group workers
doc: 3.1/task-14-6-finalization-run-detail §Task 3.1.14.6 · Finalization — run detail · ref:guards-and-tests §3.14

> Combine worker candidates with passing focused checks: 3.1.14.1–3.1.14.5; fix group defects, run typecheck, focused integration tests, scoped lint and affected build/generated checks, defer full repository gates to 3.1.19 and complete accepted integration and cleanup; no independent review step.

builds:
- [ ] BOTH resolve combined defects and generated-output drift within the approved group
- [ ] PROOF typecheck, focused integration/regression tests, scoped lint and affected build/generated checks; full gates deferred to 3.1.19
- [ ] DOCS candidate SHAs, focused group evidence, deferred broad proofs for 3.1.19, development integration and cleanup

needs:
- dash-run-detail
- dash-context-data
- dash-logs
- dash-receipts-failures
- dash-gates

#### 15 · Finish production startup, serving, and shutdown {#dash-production-runtime}
status: planned
date: D344 · former 3.1.12-4 · independent worktree after named prerequisites
doc: 3.1/task-15-finish-production-startup-serving-and-shutdown §Task 3.1.15 · Finish production startup, serving, and shutdown · ref:frontend-backend-integration §6.9 · ref:execution-and-sessions

builds:
- [ ] BOTH serve the production bundle, admit one runtime, report startup failures, and expose truthful readiness
- [ ] BE stop signals, workers, browsers, writers, projections, locks, and backups in the declared order without abandoned authority
- [ ] PROOF clean start, duplicate start, missing bundle/settings, signal drain, second signal, crash recovery, and orphan sweep

needs:
- dash-setup
- dash-storage
- dash-sessions
- dash-boundary-foundation
- dash-surfaces-finalizer
- dash-operations-finalizer

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.10.1; former 3.1.12-4; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | wave 4 production-runtime seam in `phase-3-1-dashboard-c21194e18-r30-production-runtime`, parallel with Tasks 16, 18 and 24 after setup/storage/session authority is integrated · left: Tasks 12–14
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.15; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 16 · Prove realtime convergence and reconnect {#dash-realtime}
status: planned
date: D344 · former 3.1.15 · independent worktree after named prerequisites
doc: 3.1/task-16-prove-realtime-convergence-and-reconnect §Task 3.1.16 · Prove realtime convergence and reconnect · ref:frontend-backend-integration §3.5 · ref:dashboard-surfaces §1

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
- dash-surfaces-finalizer
- dash-operations-finalizer
- dash-detail-finalizer

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.10.2; former 3.1.15; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | serial convergence gate in `phase-3-1-dashboard-c21194e18-r28-realtime`; it starts only after every feature worktree through Task 27 is integrated and closed · left: Tasks 9–27
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.16; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 17 · Meet large-data and responsiveness budgets {#dash-performance}
status: planned
date: D344 · former 3.1.16 · independent worktree after named prerequisites
doc: 3.1/task-17-meet-large-data-and-responsiveness-budgets §Task 3.1.17 · Meet large-data and responsiveness budgets · ref:frontend-backend-integration §7.4

builds:
- [ ] BOTH bound database, filesystem, projection, serialization, render, and memory work for large queues, logs, archives, groups, and search
- [ ] FE add shared virtualization/pagination primitives only where measurement crosses the recorded trigger
- [ ] PROOF preserve the recorded performance fixture and fail on structural counter regressions; keep host timing observational

needs:
- dash-realtime

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.10.3; former 3.1.16; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | serial integrated-performance gate in `phase-3-1-dashboard-c21194e18-r29-performance`; it measures the converged tree and cannot run beside feature writers · left: Task 28
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.17; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 18 · Build the complete dashboard proof infrastructure {#dash-proof-infrastructure}
status: planned
date: D344 · former 3.1.17 · independent worktree after named prerequisites
doc: 3.1/task-18-build-the-complete-dashboard-proof-infrastructure §Task 3.1.18 · Build the complete dashboard proof infrastructure · ref:guards-and-tests §3 · ref:frontend-backend-integration §7

builds:
- [ ] PROOF T2 component/feature scenarios cover every generic surface, state arm, command result, and accessibility invariant
- [ ] PROOF T3 production-bundle browser journeys cover every route/control across Task 8's desktop resize/zoom matrix, both themes, keyboard, and reduced motion; consume the desktop-only proof baseline established before 1.6.6 under D340
- [ ] PROOF T4 live dry-run journeys bind assertions to direct SQLite/evidence checks without authorizing writes
- [ ] PROOF parity references include Settings, sessions, setup, dialogs, and the DS specimen; update only through the deliberate lane

needs:
- dash-performance
- dash-production-runtime

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.10.4; former 3.1.17; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | serial proof-corpus gate in `phase-3-1-dashboard-c21194e18-r31-proof-infrastructure`; it owns the shared T2/T3/T4/parity infrastructure only after features, convergence, performance and production runtime settle · left: Tasks 9–30
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.18; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 19 · Final repairs, acceptance, and close Phase 3.1 {#dash-acceptance}
status: planned
date: D344 · former 3.1.18 · independent worktree after named prerequisites
doc: 3.1/task-19-final-acceptance-and-close-phase-3-1 §Task 3.1.19 · Final repairs, acceptance, and close Phase 3.1 · 3.1 §Exit criteria

builds:
- [ ] PROOF execute Task 8's unchanged acceptance matrix across run, queue, settings, setup, session, notification, date, trust, archive, Explorer, intake, and recovery journeys
- [ ] PROOF D340: verify supported desktop sizing/zoom/accessibility and each former mobile obligation's disposition; mobile support is not a completion requirement
- [ ] PROOF typecheck, lint, coverage, architecture, generated checks, parity, production smoke, performance, storage recovery, and live dry-run gates are green together
- [ ] PROOF direct authority reconciliation finds no ghost, duplicate, stale, or orphaned run/settings state and no protected-value exposure
- [ ] BOTH fix gate-found defects in this session, add regression proof and establish every required gate on the final corrected tree before integration and cleanup

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
- dash-realtime
- dash-performance
- dash-production-runtime
- dash-proof-infrastructure
- dash-surfaces-finalizer
- dash-operations-finalizer
- dash-detail-finalizer

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.10.5; former 3.1.18; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | final isolated acceptance in `phase-3-1-dashboard-c21194e18-r32-acceptance`; the 3.1 coordinator dispatches it only after every earlier task worktree, branch and supervisor row is integrated and closed · left: Tasks 8–31
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.19; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 20 · Optional: Prepare dashboard inventory during tail revalidation {#dash-early-inventory}
status: proposed
date: D344 · operator-coordinated prerequisites
doc: 3.1/task-20-prepare-dashboard-inventory-during-tail-revalidation §Task 3.1.20 · Optional: Prepare dashboard inventory during tail revalidation

> Optional read-only preparation while 2.6 recovery and closure continue. This produces a provisional inventory only; it does not freeze acceptance, authorize dashboard implementation or satisfy Task 8.

builds:
- [?] DOCS map verified 2.6 handoffs to current controls, routes and proposed owners without modifying runtime or in-flight 2.6 plans
- [?] DOCS mark volatile observations and unresolved producer changes for recheck after 2.6 closure

needs:
- p2f-readers
- fact: focused preparation scope and exclusive artifact owner approved

log:
- 2026-09-08 | D344 prerequisite planning | scheduled boundary and ownership; implementation and acceptance remain open
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.20; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 21 · Optional: Assess further prerequisite extractions {#dash-smaller-prerequisites}
status: proposed
date: D344 · operator-coordinated prerequisites
doc: 3.1/task-21-assess-further-prerequisite-extractions §Task 3.1.21 · Optional: Assess further prerequisite extractions

> Candidate splits only: shared navigation before date work, configuration/status before sessions, and enqueue/identity before queue/detail. No dependency is shortened until a focused plan proves the replacement boundary.

builds:
- [?] DOCS inspect exact consumers, shared files and independent proof; admit a smaller complete prerequisite only with approved ownership and gates
- [?] DOCS retain existing whole-task dependencies wherever the proposed extraction is unverified; no unfinished-branch consumers

needs:
- dash-truth-reset

log:
- 2026-09-08 | D344 prerequisite planning | scheduled boundary and ownership; implementation and acceptance remain open
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.21; standalone prerequisite or individual task; acceptance and historical execution anchor retained


#### 22 · Optional: Generic Review and People pages — deferred until needed {#dash-review-people}
status: proposed
chip: deferred · not a release blocker
date: D344 · former 3.1.14 · independent worktree after named prerequisites
doc: 3.1/task-22-generic-review-and-people-pages-deferred-until-needed §Task 3.1.22 · Optional: Generic Review and People pages — deferred until needed · ref:frontend-backend-integration §10

> D339 defers generic pages. A required workflow keeps its actual Review/People journey in scope; speculative generic page contracts do not hold the release.

builds:
- [ ] BOTH on admission, bind the actual use case and descriptor-owned fields/actions before building generic pages
- [ ] PROOF validate the admitted routes, accessibility, groups, partials and absence states

needs:
- you: a concrete workflow need or an explicit post-release request

log:
- 2026-09-08 | D344 prerequisite planning | now 3.1.9-4.6; former 3.1.14; stable anchor and acceptance retained; starts after named prerequisites, not whole-wave closure
- 2026-09-03 | 3.1 parallel execution plan | serial section-extension gate in `phase-3-1-dashboard-c21194e18-r27-review-people`; it follows wave 5 so it cannot collide with the four run-detail section writers · left: Tasks 18–22
- 2026-09-06 | D339 approved deferral | removed from 3.1 realtime/acceptance dependencies; the unchecked future feature does not block release
- 2026-09-08 | D344 decimal naming amendment | assignment 3.1.22; standalone prerequisite or individual task; acceptance and historical execution anchor retained


### 3.2 · Workflow authoring and candidate freeze {#workflow-authoring-model}
status: planned
size: XL
chip: revalidate landed work · freeze exact candidate
doc: 3.2 §Phase summary · ref:workflow-model §1.6 · ref:guards-and-tests §10.11
open: yes

> Revalidate every mutable workflow seam at current HEAD, finish transaction-free acceptance for Person Lookup and Separations, then independently freeze one exact candidate. Historical completion is evidence to inspect, not current completion authority.

builds:
- [~] BOTH Tasks 1–3 revalidate the workflow compiler, Separations read substrate, and write-safety mechanics
- [ ] PROOF Tasks 4 and 5 connect the inherited runtime and finish the author guide; Task 5.1 reconciles runnable examples
- [ ] BOTH Tasks 7 and 8 finish Person Lookup and compiled Separations without real writes; Task 8.1 connects dashboard evidence
- [ ] PROOF Task 8.2 records a current-source Separations dry-run preview with exact 0/0/0 write authority
- [ ] PROOF Task 9 independently audits and freezes the exact acceptance candidate

needs:
- dash-defaults

log:
- 2026-09-19 | tangible tasks | concrete deliverables and explicit Parallel labels; focused checks during the phase and full gates at its end; implementation remains open
- 2026-09-04 | D329 chronology correction | the former 03b/03c order is retired; authoring and read-only acceptance now precede every controlled write, with an exact old-to-new crosswalk in doc 03.2

#### 1 · Finish the workflow compiler {#workflow-authoring-core}
status: active
size: M
chip: historical implementation · current proof pending
doc: 3.2 §Task 1 · Finish the workflow compiler · ref:workflow-model §1.6 · ref:guards-and-tests §10.11

> Verify the final `workflow.ts` authoring seam, direct-entry algebra, omissions, recovery, compiled products, four-artifact enforcement, and deletion of the retired descriptor/module/fragment path. Repair only defects contained within this seam.

builds:
- [~] BE D311–D318 implementation and deletion acceptance landed historically through `ab04231c`
- [ ] PROOF current-source inspection, red-capable guards, generated products, and retired-path absence
- [ ] DOCS exact current-HEAD result and any in-seam correction

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.1; previous 3.2.1; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 2 · Finish Separations data reads {#workflow-task-substrate}
status: active
size: M
chip: historical implementation · current proof pending
doc: 3.2 §Task 2 · Finish Separations data reads · ref:task-contract §9 · ref:workflow-model §8

> Reverify Kuali, UCPath, and New Kronos reads plus every Separations mini-store leaf, task registration, selector/provenance boundary, and production provenance-recording point.

builds:
- [~] BE former 3.2 Tasks 1–3 landed historically
- [ ] PROOF strict contracts, source provenance, consumed-leaf recording, and no load-bearing retired authoring path

needs:
- workflow-authoring-core

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.2; previous 3.2.2; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 3 · Finish safe Separations transactions {#workflow-write-mechanics}
status: active
size: L
chip: mechanics landed · no live write here
doc: 3.2 §Task 3 · Finish safe Separations transactions · ref:write-safety §3.2 · ref:write-safety §14.11

> Reprove termination, pending sweep, Kuali finalization, conditional identity authority, exact-set deletion, and filing-survival mechanics against fake external systems. This task creates no controlled-write evidence.

builds:
- [~] BE former 3.2 Tasks 4–5, 9, and the software portion of Task 10 landed historically
- [ ] PROOF prepare/probe/fence/commit/verify contracts, negative controls, no repeat-completed-write path, and no filing deletion before finalization

needs:
- workflow-task-substrate

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.3; previous 3.2.3; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 4 · Connect workflows to the shared runtime {#workflow-runtime-inheritance}
chip: Parallel · authoring
status: planned
date: 2026-09-19 · tangible feature task · shared prerequisite required
size: S
doc: 3.2 §Task 4 · Connect workflows to the shared runtime · ref:workflow-model §1.6 · ref:guards-and-tests §10.11

> Prove that a compiled workflow inherits worker/session acquisition, authentication, checkpoints, semantic logs, screenshots, receipts, notifications, and Archive without workflow-specific glue.

builds:
- [ ] PROOF complete inherited runtime path and one broken-link negative control

needs:
- workflow-write-mechanics

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.4; previous 3.2.3.1; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 5 · Finish the workflow author guide {#workflow-guide-proof}
chip: Parallel · authoring
status: planned
date: 2026-09-19 · tangible feature task · shared prerequisite required
size: S
doc: 3.2 §Task 5 · Finish the workflow author guide · ref:workflow-model §1.6 · ref:guards-and-tests §10.11

> Follow the canonical guide for Person Lookup and Separations with no undocumented step, extra authored file, or escape hatch. Correct and re-prove any mismatch.

builds:
- [ ] PROOF clean-context authoring passes and exact guide/contract reconciliation

needs:
- workflow-write-mechanics

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.5; previous 3.2.3.2; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

##### 1 · Make guide examples reproduce runtime behavior {#workflow-proof-finalizer}
status: planned
size: M
date: 2026-09-19 · sequential feature integration
doc: 3.2 §Task 5.1 · Make guide examples reproduce runtime behavior · ref:guards-and-tests §3.14

> Make author-guide examples reproduce inherited runtime behavior on the combined reviewed candidates. Repair integration mismatches, reconcile generated products and pass focused checks before workflow fixture work.

builds:
- [ ] BOTH runnable guide examples use shared runtime behavior without undocumented wiring; repair combination defects and reconcile generated products
- [ ] PROOF affected tests, lint, static/generated checks and required independent review; full gates deferred to Task 9 at phase exit
- [ ] DOCS exact reviewed candidates, accepted integration, gate evidence and owned cleanup

needs:
- workflow-runtime-inheritance
- workflow-guide-proof

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.5.1; previous 3.2.7; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 6 · Finish shared workflow registration and test fixtures {#workflow-acceptance-foundation}
status: planned
size: S
doc: 3.2 §Task 6 · Finish shared workflow registration and test fixtures

> Deliver reusable workflow registration and test fixtures against the integrated runtime and guide. Complete the shared generated-product and contract changes needed by Person Lookup and Separations.

builds:
- [ ] BOTH shared workflow registration, reusable fixtures and current generated products; independently passing focused checks for both consumers
- [ ] DOCS exact disjoint paths, private runtime/live-session resources, generated-output ownership and either-order merge evidence; targeted coordination when necessary under D344

needs:
- workflow-runtime-inheritance
- workflow-guide-proof
- workflow-proof-finalizer

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.6; previous 3.2.4; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open
- 2026-09-08 | D344 decimal naming amendment | real prerequisite for 3.2.4.1 and 3.2.4.2; no workflow acceptance or candidate freeze claimed here

#### 7 · Finish Person Lookup {#person-lookup-acceptance}
status: active
date: 2026-09-19 · tangible feature task · shared prerequisite required
size: M
chip: Parallel · workflows
doc: 3.2 §Task 7 · Finish Person Lookup · ref:workflow-model §8 · ref:task-contract §9.1

> Reconcile Search/Match, the final compiled definition, generic projections, structural T1, justified T2/T3 cases, and a current transaction-free `live-read` with exact 0/0/0 write-authority deltas.

builds:
- [~] BOTH final conversion and one historical `live-read` result exist
- [ ] PROOF current compiled behavior, acceptance matrix, live-read, migration record, and capability dispositions

needs:
- workflow-acceptance-foundation
- workflow-runtime-inheritance
- workflow-guide-proof
- workflow-proof-finalizer

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.7; previous 3.2.4.1; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 8 · Finish the compiled Separations workflow {#separations-compiled-acceptance}
status: active
date: 2026-09-19 · tangible feature task · shared prerequisite required
size: L
chip: Parallel · workflows
doc: 3.2 §Task 8 · Finish the compiled Separations workflow · ref:workflow-model §8 · ref:write-safety §14.11

> Verify the nineteen-node behavior, omissions, identity authority, transaction fences, checkpoints, diagnostics, receipts, generic projections, structural T1, and only justified T2/T3 cases from the final compiler.

builds:
- [~] BOTH former 3.2 Tasks 6, 11, and 12 plus former 3.3 Task 5 landed historically
- [ ] PROOF current-source compiled acceptance without converting structural proof into controlled-write evidence

needs:
- workflow-acceptance-foundation
- workflow-runtime-inheritance
- workflow-guide-proof
- workflow-proof-finalizer

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.8; previous 3.2.4.2; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

##### 1 · Connect compiled workflows to dashboard evidence {#workflow-acceptance-finalizer}
status: planned
size: M
date: 2026-09-19 · sequential feature integration
doc: 3.2 §Task 8.1 · Connect compiled workflows to dashboard evidence · ref:guards-and-tests §3.14

> Connect the compiled Person Lookup and Separations workflows to shared registration, dashboard projections and durable evidence. Repair integration mismatches and pass focused checks before the live dry-run preview.

builds:
- [ ] BOTH both registered workflows produce their required dashboard projections and evidence; reconcile generated products and repair combination defects
- [ ] PROOF affected tests, lint, static/generated checks and required independent review; full gates deferred to Task 9 at phase exit
- [ ] DOCS exact reviewed candidates, accepted integration, gate evidence and owned cleanup

needs:
- person-lookup-acceptance
- separations-compiled-acceptance

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.8.1; previous 3.2.8; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

##### 2 · Finish the Separations dry-run preview {#separations-readonly-acceptance}
status: planned
size: M
chip: fresh strict T1b required
doc: 3.2 §Task 8.2 · Finish the Separations dry-run preview · ref:guards-and-tests §10.4 · ref:write-safety §14.11

> Reverify the selected closed Kuali document through the integrated compiled workflow and reach the declared dry-run preview terminal with a fresh `met` T1b result and exact-run 0/0/0 intents, attempts, and outbox.

> D341: use the completed shared/private test configuration. Prior runtime data was reset; produce fresh live evidence, not a citation to deleted run rows.

builds:
- [~] PROOF historical previews remain evidence; the 2026-09-03 replacement failed at New Kronos with 0/0/0 write authority and did not meet the strict gate
- [ ] PROOF current live reads, preview terminal, durable result, and exact write-authority deltas

needs:
- separations-compiled-acceptance
- workflow-acceptance-finalizer

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.8.2; previous 3.2.5; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

#### 9 · Freeze the tested acceptance candidate {#workflow-candidate-freeze}
status: planned
size: M
chip: independent · audit only
doc: 3.2 §Task 9 · Freeze the tested acceptance candidate · ref:workflow-model §1.6 · ref:write-safety §14

> Independently verify all prerequisite, parallel and read-only acceptance tasks, run every integrated gate, and freeze the exact commit, generated manifest, workflow fingerprints, runtime/configuration schema, and focused evidence. A failure creates a focused 3.2 remediation task and restarts this audit.

> D341: verify authored workflows consume the completed shared fixture/configuration interface; no deferred fixture-consolidation work remains at freeze.

builds:
- [ ] PROOF current-source audit, complete green gate family, exact candidate record, and no parked write against a closure that will change
- [ ] DOCS close every 3.2 worktree, branch, task, and integration record before 3.3 unlocks

needs:
- person-lookup-acceptance
- separations-readonly-acceptance
- workflow-acceptance-finalizer

log:
- 2026-09-19 | tangible tasks | current assignment 3.2.9; previous 3.2.6; focused checks within the phase, full gates at Task 9; implementation and current acceptance remain open

### 3.3 · Controlled acceptance {#workflow-live-acceptance}
status: planned
size: L
chip: immutable candidate · four serial tasks
doc: 3.3 §Phase summary · ref:write-safety §14 · ref:workflow-model §1.6
open: yes

> Consume one immutable Phase 3.2 candidate: admit it and the exact targets, prove pending sweep independently, perform the coupled UCPath filing and Kuali finalization, then reconcile acceptance and close. This part performs no software development.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
- [ ] PROOF Task 1 admits the candidate, targets, disposition, final rehearsal, and bounded authorization
- [ ] PROOF Task 2 records the independent pending-sweep witness on a disposable target
- [ ] PROOF Task 3 records the coupled UCPath filing and Kuali finalization on the real target
- [ ] DOCS Task 4 reconciles T1–T3 evidence, owning records, integrated gates, and lifecycle close

needs:
- workflow-candidate-freeze
- workflow-authoring-model

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-09-04 | D329 chronology correction | controlled writes can start only after the final authoring candidate freezes; drift, failure, or UNKNOWN expires authorization and returns software defects to a new 3.2 remediation task

#### 1 · Admit the frozen candidate and controlled run {#acceptance-admission}
status: planned
size: M
chip: bounded authorization required
doc: 3.3 §Task 1 · Admit the frozen candidate and controlled run · ref:write-safety §14

> Verify the freeze byte-for-byte, select the exact disposable and real targets, record restoration/retention disposition, repeat the no-write rehearsal, and obtain one bounded authorization naming the candidate, targets, disposition, and sequence.

builds:
- [ ] PROOF exact candidate, target, disposition, external availability, and fresh 0/0/0 rehearsal packet

needs:
- workflow-candidate-freeze
- you: authorize the exact candidate, disposable target, real target, disposition, and ordered controlled sequence after the packet is presented

#### 2 · Prove the independent pending-sweep commit {#pending-sweep-proof}
status: planned
size: M
doc: 3.3 §Task 2 · Prove the independent pending-sweep commit · ref:write-safety §3.2

> Bind the exact eligible/protected stable-transaction set, delete only the selected disposable rows, verify protected rows survive, and execute the recorded restoration/retention disposition. Stop without retry on UNKNOWN.

builds:
- [ ] PROOF committed exact-set witness, reload proof, fence timing, receipt/ledger evidence, and disposition completion

needs:
- acceptance-admission

#### 3 · Prove the UCPath filing and Kuali finalization {#separation-filing-finalization}
status: planned
size: L
doc: 3.3 §Task 3 · Prove the UCPath filing and Kuali finalization · ref:write-safety §3.2 · ref:write-safety §14.11

> File the approved termination, re-read the exact filing, and finalize Kuali only while that surviving filing remains proven. Record all seven payload shapes, fences, reload read-backs, receipts, and ledger effects; never re-file to recover a failed finalization.

builds:
- [ ] PROOF surviving UCPath filing and dependent Kuali finalization against the immutable candidate

needs:
- pending-sweep-proof

#### 4 · Reconcile acceptance and close Phase 3.3 {#workflow-acceptance-close}
status: planned
size: M
doc: 3.3 §Task 4 · Reconcile acceptance and close Phase 3.3 · ref:guards-and-tests §10 · ref:operator-trust §10

> Reconcile Person Lookup and Separations T1–T3 evidence, migration and knowledge records, capability dispositions, regressions, complete gates, and every 3.3 execution row. A failure is never converted into a waiver.

> D341: acceptance consumes public labels/private test configuration and captured input identity from the detour; Settings and environment are not canary sources.

builds:
- [ ] PROOF unchanged candidate, all three controlled proofs, reconciled acceptance, and complete green integrated gates
- [ ] DOCS every owning record updated; worktrees, branches, tasks, and coordinator lifecycle closed; optional 3.4 and required 3.5 unlocked

needs:
- separation-filing-finalization

log:
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion


### 3.4 · Optional document tools and AI assistance {#optional-document-tools}
status: proposed
date: D342 · 2026-09-07
size: L
chip: all features optional
doc: 3.4 §Phase summary

> An opt-in menu for local OCR, PDF tools, search and focused assistance. Every feature can be deferred or skipped; none blocks Phase 3.5, migrations or cutover. Existing mandatory intake obligations remain with their current owners.

builds:
- [?] PROOF for each selected feature batch: focused task/subtask checks, then full gates and repairs at batch completion; unselected features never block release

needs:
- workflow-live-acceptance

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-09-07 | D342 optional documents | recorded optional scope; all implementation remains unselected and unbuilt

#### 1 · Evaluate and serve local OCR {#optional-local-ocr}
status: proposed
chip: optional
doc: 3.4 §Task 1 · Evaluate and serve local OCR

> Compare pretrained local OCR against selected Gemini/Mistral readings on a representative, verified corpus; integrate a private authenticated PC endpoint only if useful.

builds:
- [?] BOTH Measure field accuracy, missed pages, handwriting errors, review time and latency on the operator's 7800X3D / RTX 5080 / 32 GB RAM PC; record software/model versions and hardware limits.
- [?] PROOF Preserve the existing extraction admission and provenance; PC unavailability is explicit, with no silent cloud fallback. No model training or hardware purchase is required.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 2 · Upload and inspect PDF pages {#optional-pdf-viewer}
status: proposed
chip: optional
doc: 3.4 §Task 2 · Upload and inspect PDF pages

> Add a page-preserving PDF viewer and import path using existing embedded text where trustworthy and OCR for scanned pages.

builds:
- [?] BOTH Preserve original artifact identity, page numbers, text provenance and available word coordinates; show page previews and extraction progress.
- [?] PROOF Distinguish unreadable, failed and unprocessed pages from successfully searched pages; no omitted page can appear as a successful empty result.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 3 · Find words and phrases in a PDF {#optional-page-search}
status: proposed
chip: optional
doc: 3.4 §Task 3 · Find words and phrases in a PDF

> Search extracted text locally and open the matching source page with snippets and highlights where coordinates exist.

builds:
- [?] BOTH Support names, words and phrases with explicit matching behavior; exact search needs no embedding model or hosted AI.
- [?] PROOF Retain source-page links and visible coverage gaps; test multiple matches, empty results, OCR errors and missing coordinate data.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 4 · Export selected PDF pages {#optional-page-export}
status: proposed
chip: optional
doc: 3.4 §Task 4 · Export selected PDF pages

> Select pages manually or from search results and export them as a new PDF.

builds:
- [?] BOTH Preserve selected page order and content; keep source-to-output page mapping and original files intact.
- [?] PROOF Use ordinary PDF processing; selection and export require no model or search-by-meaning feature.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 5 · Search across uploaded documents {#optional-document-library}
status: proposed
chip: optional
doc: 3.4 §Task 5 · Search across uploaded documents

> Index retained page text across selected files or a document library, with explicit scope controls.

builds:
- [?] BOTH Scope results to this PDF, selected documents or the authorized library; link every result to its file and page.
- [?] PROOF Honor deletion, retention and permissions in text/index/cache artifacts; avoid duplicate OCR for unchanged documents.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 6 · Classify forms and group packets {#optional-document-classify}
status: proposed
chip: optional
doc: 3.4 §Task 6 · Classify forms and group packets

> Suggest form types and page groupings for mixed HR document stacks.

builds:
- [?] BOTH Recognize declared form types and show unknown, ambiguous, incomplete or mixed-person groups for review.
- [?] PROOF Reuse the form registry and grouping contracts; model confidence never establishes employee identity or admits another workflow.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 7 · Review structured field extraction {#optional-document-extract}
status: proposed
chip: optional
doc: 3.4 §Task 7 · Review structured field extraction

> Display extracted HR fields beside their source pages and accept explicit corrections through the existing intake rules.

builds:
- [?] BOTH Preserve every declared field, typed blank/not-on-form/illegible outcomes, page provenance and ordinary validation.
- [?] PROOF Treat model results as proposed readings; review and downstream workflow gates retain their existing authority.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 8 · Reread difficult fields and compare readings {#optional-document-reread}
status: proposed
chip: optional
doc: 3.4 §Task 8 · Reread difficult fields and compare readings

> Request a second reading of a selected page or field using an eligible local, Gemini or Mistral model.

builds:
- [?] BOTH Show each provider/model and the original source; preserve conflicting readings instead of silently choosing or repairing values.
- [?] PROOF Use cloud only when explicitly configured for the data and operation; retain human correction as a provider-independent route.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 9 · Find pages by meaning {#optional-semantic-search}
status: proposed
chip: optional
doc: 3.4 §Task 9 · Find pages by meaning

> Retrieve passages for concept-based queries such as leaving employment even when the document says separation.

builds:
- [?] BOTH Evaluate a local embedding model and optional Cohere, Cloudflare or Voyage alternatives only against a measured search need.
- [?] PROOF Bind each index and query to compatible versioned embeddings; changing models requires explicit compatible routing or re-indexing, not quota-driven vector mixing.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 10 · Rank search results by relevance {#optional-search-rerank}
status: proposed
chip: optional
doc: 3.4 §Task 10 · Rank search results by relevance

> Optionally rerank retrieved passages to put more useful pages first.

builds:
- [?] BOTH Compare relevance against the existing search baseline; local ranking, Cohere or another tested service are options, not required dependencies.
- [?] PROOF Keep original matches and citations; reranker failure must not fabricate a result or conceal an incomplete search.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 11 · Ask document questions with page citations {#optional-document-questions}
status: proposed
chip: optional
doc: 3.4 §Task 11 · Ask document questions with page citations

> Answer questions from retrieved passages within the selected document scope.

builds:
- [?] BOTH Link substantive answer claims to supporting pages and say when the documents do not contain enough information; evaluate unsupported claims and missed evidence.
- [?] PROOF An eligible local model, Gemini or a tested hosted text provider may compose answers; document text is untrusted content, never instructions granting tools or write authority.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 12 · Evaluate focused failure assistance {#optional-failure-assistance}
status: proposed
chip: optional
doc: 3.4 §Task 12 · Evaluate focused failure assistance

> Assess the existing on-demand failure advice and improve it only if it reduces operator effort.

builds:
- [?] BOTH Reuse redacted failure evidence and existing advisory boundaries; measure useful advice against the deterministic failure display.
- [?] PROOF No autonomous dashboard agent, duplicate AI run summary, AI identity verdict or revived retired sanity-check surface is admitted.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 13 · Control optional providers and view usage {#optional-provider-controls}
status: proposed
chip: optional
doc: 3.4 §Task 13 · Control optional providers and view usage

> Make eligible OCR/search/advisory providers explicit and show observed usage and availability.

builds:
- [?] BOTH Local-first operation, per-capability enablement, server-side credentials, approved data handling, observed quota/reset information and provider/model attribution; unknown quota remains unknown.
- [?] PROOF Honor actual project/account quotas, Retry-After and explicit cost ceilings; no paid spillover, account multiplication assumption or indiscriminate cross-provider document forwarding. All hosted providers can remain disabled.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 14 · Evaluate OCR fine-tuning from verified corrections {#optional-ocr-finetuning}
status: proposed
chip: optional
doc: 3.4 §Task 14 · Evaluate OCR fine-tuning from verified corrections

> Consider a small model adaptation only if a pretrained baseline has persistent, measurable form-reading errors.

builds:
- [?] BOTH Use verified image/answer pairs, synthetic or de-identified examples where suitable, and held-out people/document packets; raw PDFs or unchecked model output are not ground truth.
- [?] PROOF Measure generalization and regressions; verify memory/license/data suitability before training. No automatic learning from corrections, mandatory training or training from scratch.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

#### 15 · Find public instructions with citations {#optional-public-instructions}
status: proposed
chip: optional
doc: 3.4 §Task 15 · Find public instructions with citations

> Optionally search approved public sources alongside the private document library.

builds:
- [?] BOTH Keep web and uploaded-document scopes distinct, label source dates and cite official instructions; Tavily is one candidate only if a public-web feature is selected.
- [?] PROOF Never send employee identifiers or private document content as web queries; external instructions do not change workflow rules or approve actions.

log:
- 2026-09-07 | D342 optional documents | feature recorded as opt-in; focused assignment and implementation remain open

### 3.5 · Codex and Claude cooperation {#claude-operator}
status: planned
date: R15 · 2026-08-21
size: L
chip: not started
doc: 3.5 §Track summary · ref:frontend-backend-integration §3.4 · ref:write-safety §14

> After 3.3 closes, without waiting for optional 3.4, Claude Code becomes the second attributed actor on the one local BFF. Task 1 establishes truthful actor identity with full capability parity; Task 2 makes the existing API usable directly by agents (MCP optional); Tasks 2.1 and 2.2 independently add monitoring and actor-aware clients after Task 2 completes the shared prerequisite; Task 3 records the attributed dry-run/T4 proof and closes Phase 3. Desktop attachment remains Phase 6.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs

needs:
- workflow-live-acceptance

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-09-04 | D329 chronology correction | 3.4 starts after controlled acceptance closes in 3.3; old 03d filename retired in favor of decimal doc 03.4
- 2026-09-03 | D326 decimal hierarchy | 3.4 starts after closed 3.3; Tasks 3 and 4 are parallel-capable only through the coordinator plan, and Task 5 owns the T4 journey plus Phase 3 close · desktop attachment remains Phase 6
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 1 · Derive actor identity and preserve full capability parity {#claude-actor}
status: planned
date: D338 · 2026-09-06
size: M
doc: 3.5 §Task 1 · Derive actor identity and preserve full capability parity · ref:frontend-backend-integration §4 · ref:write-safety §14

> D338: agents can perform every supported human action, including HR approvals, through the same API and safeguards. Identity records who acted; it creates no additional approval step.

builds:
- [ ] BE derive the supported human/agent caller from its own client credential at the existing admission checkpoint; never trust a body claim alone
- [ ] BE preserve full action parity, including live start, gate approval and evidence-qualified write resolution; no agent-only refusal or second confirmer
- [ ] BE record the actual actor throughout commands, audits, gate results, ledger and receipts without rewriting historical actors
- [ ] PROOF same valid requests can settle for either caller; spoofed identity, stale evidence, invalid ceremony and unsafe replay fail under the same rules

needs:
- workflow-live-acceptance

log:
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built
- 2026-09-06 | D338 operator correction | replaces two-actor pending-confirmation/schema work with full API capability parity and truthful attribution

#### 2 · Make the existing API usable by agent clients {#claude-mcp}
status: planned
date: D338 · 2026-09-06
size: M
doc: 3.5 §Task 2 · Make the existing API usable by agent clients · ref:frontend-backend-integration §3.4 · ref:frontend-backend-integration §3.5 · ref:frontend-backend-integration §4

> Use the existing loopback API directly. An MCP wrapper is optional client convenience, not a new server, permission layer or prerequisite.

builds:
- [ ] BOTH document authenticated bootstrap/read/command/stream access and direct HTTP examples for every supported human action
- [ ] BOTH preserve current-version, server-declared ceremony, source-bound Run/Rerun, exact replay and named refusal behavior
- [ ] PROOF read → command → result/monitor through the same routes; no second journal or competing BFF; no-BFF and reconnect failures remain explicit
- [ ] DOCS complete shared interface/fixture changes and bind independent monitoring/client paths, gate resources and either-order integration before either child launches

needs:
- claude-actor
- observed-logs

log:
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built
- 2026-09-06 | D338 operator correction | direct HTTP is sufficient for agent operation and acceptance; MCP is optional, stable node id retained

##### 1 · Add cursor-based monitoring and the actor inbox {#claude-monitor}
chip: Parallel · agent clients
status: planned
date: independent parallel child after its accepted parent prerequisite
size: M
doc: 3.5 §Task 3 · Add cursor-based monitoring and the actor inbox · ref:operator-trust §6 · ref:frontend-backend-integration §3.5

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
- 2026-09-19 | tangible tasks | concrete deliverables and explicit Parallel labels; focused checks during the phase and full gates at its end; implementation remains open
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

##### 2 · Make existing clients actor-aware {#claude-clients}
chip: Parallel · agent clients
status: planned
date: independent parallel child after its accepted parent prerequisite
size: M
doc: 3.5 §Task 4 · Make existing clients actor-aware · ref:frontend-backend-integration §6.9 · ref:clock-config-secrets §3

> "What happens if the user has both open" was answered by D181 before anyone asked it: the `server` role lock is taken before the authority database opens, so there is never more than one BFF on the machine. The web dashboard, the desktop app and direct agent API clients share one port, one journal and one projection; an MCP wrapper is optional.

builds:
- [ ] BE the role lock ELECTS the host; a second app attaches to the running BFF as a client and never starts a second one (doc 06's Electron half)
- [ ] FE every actor-bearing surface renders the actor rather than assuming it — gate `resolvedBy`, `archivedBy`, `plannedBy`, the receipt, the notification row
- [ ] BOTH a client roster the operator can see — who is attached right now and what each last did; live-only, and it says so rather than pretending to be durable
- [ ] WIRE the no-BFF refusal, named, from every client — and never naming npm inside a packaged app (doc 06)
- [ ] PROOF two clients racing on one run version yield one committed change and one named stale-version conflict; neither client reports an uncommitted change as success

needs:
- claude-mcp

log:
- 2026-09-19 | tangible tasks | concrete deliverables and explicit Parallel labels; focused checks during the phase and full gates at its end; implementation remains open
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built

#### 3 · Prove attributed cooperation and close Phase 3 {#claude-proof}
status: planned
date: D338 · 2026-09-06
size: M
doc: 3.5 §Task 5 · Prove attributed cooperation and close Phase 3 · ref:guards-and-tests §10 · ref:write-safety §14

> Finalize the reviewed monitoring/client candidates: combine them, run full gates and deferred proofs, fix failures and obtain independent review of the corrected result. Prove direct API operation with an agent-resolved dry-run gate and full caller capability parity. No second actor must confirm; no new live HR transaction is added to this phase proof.

builds:
- [ ] PROOF an agent drives Separations dry-run start/monitor/gate resolution/resume/terminal preview through the API, with actual caller attribution
- [ ] PROOF equal eligibility for every human/agent command family, including live-start and write-resolution boundaries, using focused tests without another controlled live write
- [ ] PROOF shared rejection of stale/invalid evidence, invalid ceremony, divergent replay, unknown-submit retry and identity spoofing
- [ ] PROOF simultaneous clients, one host/journal, resumable monitoring and actor-keyed inbox behavior
- [ ] DOCS record durable dry-run/T4 evidence, required gates, independent review and cleanup; no optional MCP wrapper blocks acceptance

needs:
- claude-mcp
- claude-monitor
- claude-clients

log:
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-08-21 | docs-cohesion R15 | drawn from the operator's instruction; nothing built
- 2026-09-06 | D338 operator correction | agent approvals settle under the existing guardrails with no human confirmation; prove attribution and full parity

## Phase 4 · Workflow migrations {#migrations}
phase: Phase 4
status: you
when: after Phase 3 closes | one candidate at a time
chip: 4.1 Background Check · new dashboard workflow
doc: 4 §Phase summary · ref:workflow-model §1.6.2 · ref:charter §Migration strategy
open: yes

> Phase 4 is the workflow-migration program. Its subphases use decimal numbering: **4.1 Background Check**, then **4.2**, **4.3**, and onward. The reusable Background Check dashboard workflow and its implementation tasks are planned under 4.1. Migration implementation still requires Phase 3 completion and a verified, operator-approved D319 admission packet.

builds:
- [ ] DOCS Phase 3 stops only after 3.5's attributed cooperation proof (D326)
- [x] DOCS record Background Check as the operator-selected 4.1 candidate; implementation waits for Phase 3 close
- [ ] DOCS verify its complete admission packet with no guessed workflow boundary or hidden open choice
- [ ] DOCS record the operator's approval of the exact workflow definition and scope
- [ ] DOCS define the admitted decimal Phase 4 migration tasks and migration record

needs:
- claude-operator

note: **Legacy capability register at `b1b36349`:** 46 open · 19 replaced · 6 native · 7 retired. Those are real cutover obligations, but they do not make any candidate a Phase 3 task or pre-assign a future phase.

log:
- 2026-09-07 | D342 optional documents | optional 3.4 added; cooperation bindings move to 3.5 with stable IDs and unchanged D338 scope; optional work never blocks required completion
- 2026-09-02 | D319 | retired the assumed remaining-migration sequence as build authority; old rows remain evidence leads until Phase 3 close extracts or deletes them
- 2026-09-02 | prior candidate intake | Person Lookup/I-9 evidence at `b1b36349` is preserved, but only Person Lookup is already admitted; I-9 remains an unnumbered candidate

### 4.1 · Background Check {#workflow-admission}
status: planned
chip: new dashboard workflow · not implemented
doc: 4.1 §Admission · ref:workflow-model §1.6.2
open: yes

> Build a reusable dashboard workflow that selects applicants from a roster, generates a background-check workbook, gates the reviewed request, submits through UCSD Human Resources and retains verified receipt/recovery evidence. Counts, names, dates and request settings belong to each run. The initial path is multiple applicants; Task 4.1.1 resolves remaining scope before implementation.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
- [ ] DOCS approve the workflow contract, request identity and proof targets
- [ ] BOTH deliver roster intake, workbook generation and dashboard review
- [ ] BE deliver verified ServiceNow submission, receipt and no-repeat-write recovery
- [ ] PROOF prove and enable the registered workflow through the dashboard

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-09-08 | Background Check discovery | operator demonstrated the multiple-applicant form and template-copy workflow; reusable requirements captured in the internal workflow resource; manual preparation is not automated acceptance
- 2026-09-08 | Operator scope correction | 4.1 is a new dashboard workflow; replace individual-run tracking with implementation tasks and remove run-specific detail from the roadmap

#### 4.1.1 · Define the workflow contract and admission packet {#background-check-discovery}
status: planned
doc: 4.1 §4.1.1 · Define the workflow contract and admission packet

builds:
- [ ] DOCS define supported request units, inputs, selection rules, settings and terminal result
- [ ] DOCS approve ordered entries, external write boundaries, permanent identity and the nine-field admission packet
- [ ] DOCS bind implementation ownership, prerequisites, controlled targets and proof gates

needs:
- migrations

#### 4.1.2 · Build roster intake and request workbook generation {#background-check-workbook}
status: planned
doc: 4.1 §4.1.2 · Build roster intake and request workbook generation

builds:
- [ ] BE preserve source formatting, validate applicants and freeze deterministic cohort membership
- [ ] BE generate a separate template-based workbook with validated settings and visible service markers
- [ ] PROOF verify membership, artifact integrity and unchanged source/template on synthetic fixtures

needs:
- background-check-discovery

#### 4.1.3 · Build dashboard preview and approval {#background-check-review}
status: planned
doc: 4.1 §4.1.3 · Build dashboard preview and approval

builds:
- [ ] BOTH declare start inputs and project applicant validation, request settings and workbook preview
- [ ] BOTH bind approval to the exact cohort, settings and artifact; edits invalidate approval
- [ ] PROOF exercise review, corrections, cancellation and parked states through dashboard scenarios

needs:
- background-check-workbook

#### 4.1.4 · Implement ServiceNow submission and recovery {#background-check-receipt}
status: planned
doc: 4.1 §4.1.4 · Implement ServiceNow submission and recovery

builds:
- [ ] BE implement verified session, catalog/form navigation and approved-artifact attachment
- [ ] BE implement transaction boundaries, request read-back, permanent identity and UNKNOWN reconciliation
- [ ] PROOF verify live read-only selectors and fixture-backed preview, mismatch refusal and request recovery

needs:
- background-check-review

#### 4.1.5 · Register, prove and enable the dashboard workflow {#background-check-admission}
status: planned
doc: 4.1 §4.1.5 · Register, prove and enable the dashboard workflow · ref:workflow-model §1.6.2

builds:
- [ ] BOTH register the compiled workflow and generic dashboard projections
- [ ] PROOF pass structural, dry-run, dashboard and controlled-write acceptance
- [ ] DOCS refresh the hr-manage workflow resource and record verified migration evidence

needs:
- background-check-receipt
- migrations

#### Shared capabilities awaiting an admitted consumer {#cross-cutting}
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
doc: 5 §Phase summary · 5A §Shelf summary · 0.2 §Task 4 · Fix the size model and delivery tiers · ref:workflow-model §1.6.2 · 5B/risk-register-top-sequencing-risks §Risk register (top sequencing risks)
open: no

> Phase 5 closes every cutover-relevant readiness gap, then performs one all-at-once authority switch. Nothing is silently dropped: every deferred item has a named disposition, and desktop-only update work is carried forward to Phase 6.

log:
- 2026-09-01 | D297 | controlled desktop update added as the ninth named deferral; v1 manual in-place updates remain a the desktop stage packaging acceptance criterion
- 2026-08-20 | docs-cohesion 04 | doc 04 rewritten as-built — eight deferrals, each with its trigger; the sanity check is RETIRED, not deferred, and `def-retention`'s title corrected (no 14/8/5 constant exists)

note: **Never, by design:** unverified silent fallbacks · selector `.or()` chains · per-daemon logs / bespoke polling hooks / secondary count caches · per-action mutation routes · generic retry on a parked write · DSL/codegen workflow authoring (D79a) · LAN/remote operator mode · hosting (D193) · mobile/phone document Capture Mode (D294) · legacy change accounting (D150).

### 5A · Close cutover-readiness gaps {#cutover-readiness}
status: planned
chip: every gap has a disposition
doc: 5A §Shelf summary

> Resolve, retire, or explicitly carry forward each remaining cross-cutting item before the authority switch.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged

#### Run the built dashboard without the dev server {#def-byte-path}
status: planned
doc: 5A/run-the-built-dashboard-without-the-dev-server §Run the built dashboard without the dev server · ref:frontend-backend-integration §6.9

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
doc: 5A/edit-a-workflow-s-presentation-policy-without-a-code-change §Edit a workflow's presentation / policy without a code change · ref:operator-trust §5.1 · ref:operator-trust §5.3 · ref:operator-trust §5.4 · ref:operator-trust §5.5 · ref:operator-trust §5.6

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
doc: 5A/a-record-sanity-check-advisory-panel §A record-sanity-check advisory panel · ref:operator-trust §4.4.2 · ref:guards-and-tests §3.11

> RETIRED by the operator 2026-08-18 — no AI feature. D192's deferral condition ("renders beside the order-8 ALWAYS-GATE") was met DETERMINISTICALLY by the §14.2 packet's server-computed comparisons; the deterministic comparison IS the sanity check. Its two siblings retired with it.

needs:
- fact(met): retired by the operator 2026-08-18 (D192; `config/legacy-capabilities.json` → `legacy-tool-ops-sanity-check-record`, `kind: retired`)

log:
- 2026-08-20 | docs-cohesion 04 | status corrected from `planned` — `ref operator-trust` §4.4.2 and `config/legacy-capabilities.json` have carried the 2026-08-18 retirement since it was ruled; `AdvisorySurfaceIdSchema` stays closed at its D178 two-value shape
- 2026-08-20 | docs-cohesion operator-trust | ref operator-trust rewritten against the code (`e6fb6f37`): as-built deltas folded, 79 tags + 21 status blocks, §9 and §10 rebuilt from `guard-inventory` and the code

#### Edit settings in the dashboard {#def-settings}
status: active
chip: bounded Settings + preflight served
doc: 5A/edit-settings-in-the-dashboard §Edit settings in the dashboard · ref:clock-config-secrets §3 · ref:frontend-backend-integration §3.4 · ref:dashboard-surfaces §2.4

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
doc: 5A/trust-ucpath-servicenow-wait-before-negative-read-windows §Trust UCPath / ServiceNow wait-before-negative-read windows · ref:write-safety §4 · ref:write-safety §4.2 · ref:workflow-model §1.6.2

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
doc: 5A/search-runs-across-dates-view-screenshots-export-excel §Search runs across dates / view screenshots / export Excel · ref:frontend-backend-integration §3.6 · ref:data-intake-and-edit-data §4.1 · ref:operator-trust §2.2 · ref:operator-trust §2.4

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
doc: 5A/auto-purge-diagnostics-on-a-measured-schedule-reclaim-unreferenced-artifact-bytes §Auto-purge diagnostics on a measured schedule · reclaim unreferenced artifact bytes · ref:operator-trust §2.2 · ref:dashboard-surfaces §2.1 · ref:guards-and-tests §3.7

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
doc: 5B §Stage summary · 5B §Exit criteria · 5B/legacy-vs-rebuild-as-of-2026-08-21 §Legacy vs rebuild (as of 2026-08-21) · ref:dashboard-surfaces §5 · ref:frontend-backend-integration §7.4 · ref:frontend-backend-integration §10 · ref:charter §Migration strategy

> D89 / D93. No workflow flips individually, no mixed-engine production, ever. The entire legacy repo is preserved as the rollback asset; nothing in it is deleted until rollback-window closure with separate explicit authorization.

builds:
- [ ] PROOF focused preparation checks; full candidate/readiness gates before the authorized authority switch, then required post-switch observations before closure
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
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-08-21 | docs-cohesion 05 | doc 05 rewritten as-built — the register recount (47, not 48), five build items added for the definition-of-done conditions the tree lacked, and one FINDING: the ledger's serialized writer is built, tested and composed by nothing (`createLedgerProjector` is called only from `tests/`), so exit criterion 6 is open rather than met
- 2026-08-21 | docs-dash-surfaces 5.1d | §9.5–§9.8 written as-built; §4/§5 rewritten in place; §10–§13 folded and deleted (`642fbe2c`)
- 2026-08-21 | docs-cohesion charter | ref charter's 27 items numbered so `ref:charter §N` resolves (`c89957f5`)

#### Rollback window, then closure {#rollback-window}
status: planned
doc: 5B/rollback-window-then-closure §Rollback window, then closure · 5B §Stage summary · 5B §Exit criteria · ref:dashboard-surfaces §5

> Legacy code, tests and state intact; closure is its own later authorization. Nothing flips yet, so no window is open — and re-crossing is asymmetric: a launcher repoint before any native write, intent/ledger reconciliation and dedupe proof after one.

needs:
- cutover
- you: the closure authorization — deletion or retirement of the legacy repo is OUTSIDE this cutover and has no trigger, no elapsed-time rule and no automatic expiry (D89)

log:
- 2026-08-21 | docs-cohesion 05 | the section was a pointer paragraph; it now states what the window IS, what closes it, and why nothing has opened — the rollback bridge stays a `{#cutover}` build item rather than being duplicated here

#### Later, unplanned {#later-unplanned}
status: never
chip: ideas, not a hosted future
doc: 5B/later-unplanned §Later, unplanned · ref:operator-trust §7 · ref:clock-config-secrets §6.1

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
doc: 6 §Stage summary · ref:frontend-backend-integration §6.9 · ref:execution-and-sessions
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
doc: 6A §Controlled desktop updates · 6E §Packaging — signed installers for both operating systems

> D297. One installed machine updates v1 by running the newer signed installer IN PLACE, without uninstalling or clearing app data. A later updater may discover/download a signed release while open, but installation waits behind one fail-loud quiescence verdict and ordered shutdown.

builds:
- [ ] PROOF if the optional updater is selected: focused feature checks, then full gates at its phase exit; initial desktop release remains manual
- [ ] PROOF a signed older→newer manual upgrade on macOS and Windows preserves authority rows, artifacts, browser profiles, settings and OS-keychain credentials
- [ ] BE one desktop quiescence verdict that names active work and refuses, or proves there is no non-terminal run and no active worker/browser child
- [ ] BE ordered shutdown after that verdict — stop workers and browsers, stop the BFF, close storage handles and release locks before installer handoff
- [ ] BE only after those proofs: verify the signed release and apply it on a clean restart; never force-quit active work

needs:
- desk-package
- fact: the signed manual older→newer upgrade is proved on real macOS and Windows installations

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-09-01 | D297 | policy and trigger ratified; the manual upgrade proof and controlled update channel remain unbuilt

### 6B · Application shell {#desk-shell}
status: planned
date: R14 · 2026-08-21 · D297 · 2026-09-01
size: M
doc: 6B §Electron shell — the main process, the window, the single instance · ref:frontend-backend-integration §6.9 · ref:clock-config-secrets §3

> The main process boots the BFF as a managed CHILD process (recommended over in-process: D181's role lock is per-PID and `cli storage restore` composes its stopped-system proof from those files, a BFF crash must not take the window, and `src/cli.ts` is a command entry rather than a library). The window loads `dist/dashboard` from app resources; every runtime root resolves under `app.getPath("userData")` with `runtime-isolation.json`'s NAMES unchanged; a second launch focuses the open window; the app holds a power save blocker while any run is in flight.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
- [ ] BE the Electron main process boots the BFF as a managed child under the single-instance lock, and a BFF that finds D181's `server` role lock held refuses by name
- [ ] BE every runtime root resolved under `app.getPath("userData")` instead of `process.cwd()` — `compose.ts:336-337` computes them repo-relative, and `operational-isolation` pins the names, not the resolution
- [ ] BE the app-version stamp `RunRecord` carries (D179) read from a source that survives packaging — `compose.ts:337-340` reads `join(repoRoot, "package.json")`, which is inside the asar
- [ ] FE the renderer loads `dist/dashboard` from app resources with an EXPLICIT API base — `src/dashboard/app/main.tsx:21` passes `window.location.origin`, which is the string `"null"` under `file://`; the transport already takes a `baseUrl`, so the fix is a decision, not a seam
- [ ] BE an application menu and keep-awake while any run is in flight — a machine that sleeps mid-run leaves a claim to be swept and a browser on a half-staged page
- [ ] DOCS the decision: in-process vs managed child, and how the app lock composes with the role lock

needs:
- desktop-app

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the child-process recommendation and the four obstacles are read out of the code at HEAD (`src/server/dashboard/compose.ts`, `src/domain/config/schema.ts:8`, `src/dashboard/app/main.tsx:21`)

### 6C · Worker lifecycle {#desk-worker}
status: planned
date: R14 · 2026-08-21
size: L
doc: 6C §Worker lifecycle — the pool the app owns · ref:execution-and-sessions §1 · ref:execution-and-sessions §3

> Workers become managed child processes started and stopped from the dashboard, which IS `{#parallel-runs}`' pool rather than a second scheduler. Playwright's full bundled Chromium and the vendored Duo Autopilot extension are shipped with the app or installed on first run into app data; profiles keep doc 05's `(worker, system, instance, configFingerprint)` partition with the root moved under app data; the Windows half is verified on real hardware.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
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
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; this node CONSUMES `{#parallel-runs}`' pool — a second supervisor over one authority table is the shape D200 warned about

### 6D · Credentials and keychain {#desk-secrets}
status: planned
date: R14 · 2026-08-21
size: M
doc: 6D §Credentials — the OS keychain behind the one reader · ref:clock-config-secrets §3

> `.env` becomes the macOS Keychain and the Windows Credential Manager, reached through `src/domain/secrets.ts` and nowhere else — the `secrets-single-source` guard does not move. The open design question is HOW a keychain (async, prompting) reaches a synchronous reader: populate each child's environment block at spawn, or give the reader a source seam. They differ in exposure, so it is a decision with a D-number. A first-run setup screen collects what is missing and names each credential it refuses without.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
- [ ] BE the OS keychain as the credential source for a packaged app — macOS Keychain, Windows Credential Manager
- [ ] BE `src/domain/secrets.ts` stays the ONLY reader; `secrets-single-source.test.ts` unchanged
- [ ] BE the Duo credential (`paths.duoCredential`) moved into the same store, or its file placed under app data with the app's own protection — never plaintext inside the shipped bundle
- [ ] FE a first-run setup screen that names every credential it needs and refuses a workflow start by the name of the missing one
- [ ] BE widen `AbsolutePathSchema` for Windows paths — `src/domain/config/schema.ts:8` refuses anything not starting with `/`, and nine `paths.*` leaves use it, so a Windows build fails config resolution at the schema boundary (read-forward safe: every stored snapshot's POSIX path still parses)
- [ ] DOCS the decision: env-block injection vs a source seam inside the one reader

needs:
- desktop-app

log:
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; the POSIX-only path schema is a verified blocker for the Windows half and is filed here because it is what the keychain and the extension paths both trip over

### 6E · Signed installers {#desk-package}
status: planned
date: R14 · 2026-08-21
size: M
doc: 6E §Packaging — signed installers for both operating systems · ref:frontend-backend-integration §7.4

> electron-builder, with the dashboard bundle and `duo-autopilot/` as app resources. macOS: a signed and NOTARIZED dmg. Windows: a signed nsis or msix installer. The release version is D179's app-version stamp. D297: v1 updates are signed manual installers run IN PLACE; mutable state stays under the stable app-data/keychain roots; controlled update is LATER under `{#def-desktop-update}`.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
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
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
- 2026-09-01 | D297 | Electron and the v1 manual update lane ratified; controlled update indexed at `{#def-desktop-update}`
- 2026-08-21 | docs-cohesion R14 | drawn from the operator's instruction; signing is not optional on either OS because the app launches a second browser with an unpacked extension

### 6F · Packaged-app proof {#desk-proof}
status: planned
date: R14 · 2026-08-21
size: M
doc: 6F §Proof — a dry run from the packaged app on both operating systems · ref:guards-and-tests §10

> R10's T1 tier run from the INSTALLED app — a live `dryRun=true` workflow with its checkpoints asserted over authority — on macOS and on Windows, on real hardware. R10's T3 dashboard conditions attached, driven through the app's own window. The parity corpus re-rendered in the Electron renderer, because the operator's actual pixels are the ones the corpus exists to pin (D187). The recovery drill exercised through the app's own lock files, which are now what D181's stopped-system proof composes from.

> D341: explicitly provision private test inputs per proof machine; consume shared fixtures, ship no private assets/values, and add no test-data controls to user Settings.

builds:
- [ ] PROOF focused task/subtask checks; full typecheck, lint, coverage and applicable acceptance gates at this phase’s final outcome, with required repairs
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
- 2026-09-19 | phase-exit cadence | tangible tasks and focused checks during the phase; full gates and repairs at its final acceptance; existing scope and authorization unchanged
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

<a id="tangible-tasks-and-phase-exit-gates"></a>

### Tangible tasks and phase-exit gates — operator amendment, 2026-09-19

Starting with Phase 3.2, each numbered task delivers one concrete feature or observable outcome.
Name it for what will work when it finishes, such as “Finish the Run modal”, “Build applicant
workbook generation” or “Freeze the tested acceptance candidate”. Subtasks deliver concrete parts
of that outcome. Avoid standalone scheduling wrappers, generic “prepare independent tasks”,
or “finalization” cards when that work can live under the feature it finishes. Required admission,
controlled proof and release/freeze outcomes remain real deliverables; do not invent software
changes for evidence-only phases. Existing feature scope, stable node IDs and dated evidence survive.

Subtasks may be sequential. Decimal nesting does not imply parallel execution. Every admitted
parallel node displays `chip: Parallel · <group>`; the same group label identifies work intended
for concurrent execution once its explicit prerequisites are met. Unlabelled nodes are sequential.
A label is a scheduling instruction, not launch permission or extra capacity. Parallel admission
still requires stable inputs, disjoint ownership, independently passing focused checks, capacity,
and a named integration/cleanup owner. Shared integration is a sequential subtask of the feature
or part of its acceptance, with explicit dependency edges. No automatic sibling dispatch or merge.
Existing Phase 3.1 assignments and their cadence remain unchanged.

**Gate cadence applies to sequential tasks, prerequisites, parallel workers and intermediate
integration alike.** During a phase run affected tests, lint and selected static/generated checks;
repair focused failures before handing off or continuing dependent work. Do not run the whole
suite/full coverage at each task or group. Each delivery phase (3.2, 3.3, a selected 3.4 batch,
3.5, each admitted 4.x, 5A, 5B and each scheduled 6A–6F part) ends with typecheck, lint,
full coverage and all applicable phase-wide acceptance gates. Its final outcome owns gate-found
repairs and invalidated reruns. A focused pass never establishes full phase acceptance.
[Guards and tests §3.14](../rebuild/reference/guards-and-tests.md#phase-exit-gates-from-3-2)
owns exact commands and reuse rules. Existing independent review requirements remain unchanged.

Phase 3.2 runs full gates at its final independent audit/freeze; that audit remains read-only,
returns failures to bounded 3.2 remediation, and restarts on the corrected candidate. Phase 3.3
consumes that candidate unchanged and returns software defects to 3.2. Required target checks,
no-write rehearsals and bounded write authorization still happen before their controlled action.
Cutover readiness gates still pass before the production switch; phase-end testing never means
performing a write or switch first and checking its safety afterward. D319 workflow admission,
D342 optionality, UNKNOWN refusal and Phase 5 cutover authority remain binding.

This amendment supersedes the future-work hierarchy and per-prerequisite/group full-gate rules
in D344/D191 below for Phase 3.2 onward. It changes task shape and verification timing, not product
requirements, completed history, review authority, test membership, assertions, floors or timeouts.
Exact implementation briefs still belong to the operator-opened planning/supervision sessions.


### Phase 4 decimal naming amendment — 2026-09-08

The operator replaced the former 4A placeholder with **4.1 · Background Check** and requested its
concrete tasks beneath that subphase. Phase 4 uses decimal parts and task labels (`4.1.1`, etc.).
Discovery and manual preparation may be recorded before migration admission; they do not bypass
Phase 3 prerequisites, D319's nine-field packet or operator approval of implementation. The stable
`workflow-admission` anchor is retained. Phases 5–6 retain their existing labels.

### The one-plan rule

Per charter §"One master plan": the owning design docs (now `reference/task-contract`,
`reference/workflow-model`, `reference/dashboard-surfaces`, `reference/decisions`,
`reference/execution-and-sessions`, `reference/data-intake-and-edit-data`, and
`reference/write-safety` through `reference/frontend-backend-integration`) are the binding detail;
THE PLAN - this file, the tree, plus the admitted phase docs under `docs/rebuild/plans/` - is the authoritative
build order. No second plan, no per-workflow "alt plan," no execution doc that re-sequences
phases. Operator-selected candidates may have decimal Phase 4 discovery tasks, as in 4.1 Background
Check. Those records do not authorize implementation. After D319/D323 admission, their migration
tasks and workflow migration doc become implementation authority; they answer `ref workflow-model`
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
The tree never invents scope: an unplanned feature is a finding for `docs/rebuild/findings/`, not a roadmap
line. D326 makes the hierarchy uniform: numbered phases are the only spine nodes; Phases 0–3 use
decimal parts; the operator coordinates each part; each immediate numbered task is one supervisor
session; and checklist lines are that task's proof-bearing subtasks. The strict active order is
0.3 → 1.6 → 2.6 → 3.1 → 3.2 → 3.3 → 3.5, with optional 3.4 available after 3.3 (D342). D328 gives admitted parallel peers one shared ordinal
and consecutive numeric members (`N-1`, `N-2`, ...); a serial task remains `N`, and the hyphen is
part of one task identity rather than another hierarchy level. Parallel execution begins only after
each member receives its exact feature branch, absolute worktree, artifact scope, gate and
integration order in the supervising session's working record. D329 makes 3.2 the last mutable workflow part and its
final task an independent exact-candidate freeze; 3.3 performs no development and may exercise
controlled writes only against that unchanged candidate. Session work is recorded only where it happened in
append-only per-node `log:` blocks, so history never competes with the plan on the spine.

### D342 — Optional document features and cooperation renumbering (2026-09-07)

The operator adds Phase 3.4 as an optional feature menu and renumbers Codex/Claude cooperation
from 3.4 to 3.5. The stable `claude-*` node IDs, D338 capability parity and cooperation tasks
remain unchanged. The visible Phase 3 order is 3.1, 3.2, 3.3, optional 3.4, 3.5; the required
dependency chain goes directly from 3.3 to 3.5. No optional feature, provider activation, model
training, or new document workflow is a prerequisite for 3.5, Phase 4 or cutover. Existing mandatory
intake and workflow obligations keep their current owners and gates.

[Phase 3.4](../rebuild/plans/phase-3/3.4-optional-document-tools/README.md) owns the feature scope,
selection rules and per-feature evidence. Every task begins proposed and independently selectable;
implementation requires a focused assignment. Selected work respects prerequisite capabilities
without turning the whole menu into a mandatory sequence. Phase 3.3 still consumes its frozen
candidate unchanged; later feature changes receive their own current-candidate gates and cannot
inherit controlled-write proof for changed code. All optional features may remain unbuilt and disabled.

This amends D326/D329's numbering and required-predecessor rule only at the optional 3.4 slot.
It does not reopen retired AI summaries/sanity checks, authorize autonomous HR actions, alter
D338's operator-directed agent permissions, or waive any existing safety/release requirement.

### Phase plan storage (operator amendment, 2026-09-06)

The [plans index](../rebuild/plans/README.md) maps Phase 0–6 to `plans/phase-N/` folders.
Each existing subphase has its own descriptive folder and `README.md`. Small plans fit entirely
in that overview; large plans split at existing task boundaries into linked task files. Shared
context and exit criteria remain in the overview; task assignments and evidence have one owner.
Existing unnumbered work and supporting evidence may use descriptive topic files without inventing
task numbers. `/phase-plan` reads the overview and persists the approved task at the owner named by
its `doc:` binding (`1.6` for the overview, `1.6/task-1-land-the-schema-floor` for a task file).
New admitted subphases receive their own folder. This reorganizes storage only:
node IDs, phase order, task scope, recorded status, admission rules and evidence remain unchanged.
Frozen and commit-pinned citations resolve through the index's earlier-path table.

### Phase 3.1 full gates and repairs at final acceptance (operator amendment, 2026-09-13)

The operator reserves full repository gates for **3.1.19**. Group finalizers **3.1.9.8, 3.1.11.3
and 3.1.14.6** still combine all group inputs, fix integration defects and release their existing
downstream consumers, but require only typecheck, focused integration/regression tests, scoped
lint and affected build/generated checks. Record a focused development release and all deferred
broad proof at 3.1.19; do not claim full acceptance at a group checkpoint.

**3.1.19 owns final repairs, acceptance and closure in one session.** It consumes the complete
required 3.1 implementation, runs full gates and the frozen A01–A42/D01–D05 matrix, fixes failures
within the approved outcomes across consumed paths, adds regression proof and establishes all
required gates on the final corrected code tree. It inherits this repair ownership after intake;
ordinary gate-found corrections do not require handbacks to earlier sessions. New product scope
or changed contract decisions remain outside this authorization. Integration and cleanup follow
the assigned permission; Phase 3.2 still waits for accepted 3.1.19.

This explicitly supersedes earlier Phase 3.1 per-group full-gate and audit-only/no-repair rules,
including D191/D344 and personal skills. The no-independent-review policy remains; model selection
follows the current operator policy below.
Keep every existing task ID, dependency edge, product outcome, assertion, floor, timeout and live-
write boundary. Reuse valid unchanged evidence; rerun invalidated gates after corrections. Group
numbers and independent-worker ownership remain; other phases keep their gate/freeze policies.
The [phase cadence](../rebuild/plans/phase-3/3.1-finish-the-dashboard/README.md#execution-cadence--operator-amendment-2026-09-13)
and [final session plan](../rebuild/plans/phase-3/3.1-finish-the-dashboard/task-19-final-acceptance-and-close-phase-3-1.md)
own exact verification and repair procedure.

### Phase 3.1 execution-order labels (operator amendment, 2026-09-13)

The operator renumbers former finalizers 3.1.23, 3.1.24 and 3.1.25 to **3.1.9.8**, **3.1.11.3**
and **3.1.14.6** and nests each as **Finalization**, the last child after every worker in its group.
Current task headings, filenames, bindings and the phase identity map follow numeric execution
order. The [current table](../rebuild/plans/phase-3/3.1-finish-the-dashboard/README.md#current-task-identities)
owns the full order and its rename map resolves earlier labels. Stable node IDs and all `needs:`
edges are unchanged; historical logs retain their original numbers. This is the explicit replan
permitted by D344's grandfathered-identity clause for 3.1 only. Other phases keep their task labels.

A parent releases its independent workers after focused acceptance; the finalization child requires
every worker. The former 23/24/25 dependency barriers now appear before their consumers in the tree.
At this renumbering, 3.1.19 was labeled **Final acceptance and close Phase 3.1**, the last required
task; the later final-gates correction above adds same-session repairs. Optional
3.1.20–3.1.22 remain outside the mandatory sequence. Numbering provides a valid sequential path,
without adding dependency edges or serializing independent work. No product scope, acceptance
outcome, gate timing, review policy, completion status, integration permission or live-write boundary
changes. The focused-check/no-independent-review cadence below remains binding.

### Phase 3.1 execution cadence and Codex subagents (operator amendment, 2026-09-13)

**Model-policy update (operator-approved, 2026-09-19).** Codex focused workers use `gpt-5.6-luna`
with `xhigh` reasoning; independent reviewers use `gpt-5.6-sol` with `xhigh`. Native roles retain
their duties, context limits and tool restrictions; the dormant analyst remains explicit-comparison
only. The operator selects planning and supervisor models/effort, without skill or prompt
recommendations. This supersedes older model selections in plans and guidance; historical evidence
keeps the models that actually ran. Claude native worker/reviewer definitions are unchanged.

For **all remaining Phase 3.1 work**, the operator removes the independent-review step and moves
broad gates to final task 3.1.19. The [phase execution cadence](../rebuild/plans/phase-3/3.1-finish-the-dashboard/README.md#execution-cadence--operator-amendment-2026-09-13)
owns the exact task/finalizer map. Prerequisites, standalone tasks and parallel workers complete
assigned behavior with meaningful focused tests, scoped lint and affected quick/generated checks;
no full suite or separate reviewer is required at each step or candidate commit. Fix focused
failures before release, record actual results and defer each broad proof to its named owner.
Prerequisites may release children after their integrated focused acceptance. Worker development
completion is distinct from finalizer acceptance; roadmap completion still records assigned
integration and cleanup. Existing finalizer dependency edges remain binding.

Group finalizers 3.1.9.8, 3.1.11.3 and 3.1.14.6 combine inputs and fix group defects with
typecheck, focused integration/regression tests, scoped lint and affected build/generated checks.
Full repository gates and broad deferred proof belong only to 3.1.19. That final session executes
the whole frozen A01–A42/D01–D05 matrix, repairs gate-found defects itself, and verifies the final
corrected code tree before release. No stage requires independent review.
Preserve product outcomes, test membership/assertions/floors, isolation, timeouts and live-write
boundaries. This supersedes conflicting D191/D344 and skill review/gate cadence for Phase 3.1 only;
it does not reopen completed evidence, remove independent freezes in other phases, authorize push,
launch a successor or change operator integration permission.

### Plan, implement, review (operator amendment, 2026-09-04)

For remaining Phase 3.1 work, the 2026-09-13 exception above replaces this section’s review and gate
cadence. The 2026-09-19 model policy above supersedes older model/effort selections.

The operator opens planning and supervisor sessions for an exact roadmap task and selects their
models and effort. Where review is required, the supervisor dispatches one fresh read-only reviewer
at the end of implementation: Codex `sup_review` (Sol, xhigh) or Claude `sup-review` (Opus, high). Review, fixes and finalization
continue in the same supervisor session. Skills do not switch the current session model or start
the next task. A separately opened review session is an explicit operator option.
Explicit operator overrides take precedence. This rule governs future task execution, not a
retroactive reopening of completed tasks.

**Implementation isolation.** Every phase/task implements on a dedicated non-`master` branch.
Sequential work may check out its task branch in an exclusively available existing directory;
parallel writing tasks each require their own branch/worktree. Shared directories, unrelated dirty
work, uncertain ownership or integration-only checkouts require a worktree even for sequential work.
Preserve stricter admitted phase isolation, including 3.1's integration-only primary checkout. Do
not switch another session's checkout or stash/reset its edits. The planner records exact mode,
branch/path/base, plan availability, scope and target/owner/order/merge conditions for every task.
The supervisor rechecks ownership and creates/checks out the binding before implementation edits;
an absent planned branch is expected. Correct an old `master` implementation binding under this
policy without reopening unchanged scope. Integrate only after independent PASS and required gates;
run integration gates and re-review behavior-changing conflicts before cleanup. Never delete an
active branch or primary checkout; preserve and report unresolved residue. Approved planning and
completion records retain their existing documentation rules. This is local workflow protection,
not a remote branch-protection setting or push authorization.

1. **Plan — `/phase-plan`.** Verify the exact roadmap node, owning phase section, current code and
   prerequisite evidence. Preserve parallel suffixes such as `2-1` and `2-2`. Propose outcome/scope,
   implementation sequence, acceptance tests and required gates in native Plan Mode. After approval
   and leaving Plan Mode, the same planner updates only the owning phase and necessary roadmap or
   explicitly approved contract/index changes, validates and commits them, then stops. Planning is
   not implementation, and an approved implementation plan cannot silently redesign an admitted
   contract. Existing phase boundaries and proof obligations remain binding.
2. **Implement — `/supervise`.** Consume the approved phase-plan commit, verify prerequisites and
   current checkout, implement and test the assigned outcome, and commit the candidate. Supporting
   agents are optional, bounded and governed by native role/isolation rules. The supervisor retains
   the central hard work and consequential judgment. Record `awaiting independent review` with the
   plan reference, candidate base/head, gate evidence and exclusions in the existing phase section;
   leave task completion open. Preserve other sessions' edits and keep the candidate stable during
   review. Do not start another task or create an agent coordinator.
3. **Review — fresh subagent using `/review`.** After committing the candidate and evidence, pause
   owned writers and dispatch the dedicated read-only reviewer with no inherited implementation history.
   Give exact task, approved phase/plan commit, checkout, candidate base/head, authority paths and
   gate evidence. The reviewer must not have implemented this candidate, edit files or delegate.
   Inspect the pinned candidate against contracts, surrounding code and tests. Report PASS, CHANGES
   REQUIRED or BLOCKED with exact commits, findings and evidence limits. The supervisor runs any
   needed write-producing validation on pinned state for the reviewer to assess. Missing mandatory
   proof or an unavailable reviewer is BLOCKED, never self-review or PASS. Wait for the verdict here;
   `awaiting independent review` is not a routine session stop. Standalone `/review` stays inline.
4. **Finalize — original supervisor.** Verify the returned verdict and unchanged reviewed state. Fix required
   findings and obtain renewed review of changed code or consequential requirement changes. Preserve
   unresolved findings; never replace a reviewer to evade them. After
   PASS, integrate locally onto the required target, resolve shared-target drift, run all required
   integration gates and clean up owned worker worktrees/branches. Behavior-changing merge conflict
   resolutions need renewed review. Mark complete in BOTH phase and roadmap only with integrated
   implementation, green required gates, accepted review and verified cleanup. Record candidate and
   integration commits, review provenance and gates; regenerate/check the roadmap and commit the
   completion update. Mechanical evidence-only recording does not invalidate review of unchanged
   implementation. Stop after that task; no automatic phase closure or next-task assignment.

A plain direct task assignment uses its existing approved phase section as the brief; it never
waives prerequisites or authorizes unrelated scope. Retain the repo's local integration policy and
never push without explicit instruction. All mandatory gates, coverage/assertions, phase ordering,
independent candidate freezes, and live-write/cutover approvals remain binding.

Transfer only task, phase path/section, plan commit, checkout/branch, candidate range, gate evidence
bound to tested state, and unresolved issues. The phase record and commits are durable authority;
no coordinator board, dispatch envelope or routine handoff/report file is required. **Progress cadence
(operator amendment 2026-09-17):** planning and supervision send Done (verified completed work), Now
(current action or blocker), and Remaining (unfinished steps) once at session start or genuine resume.
After each verified step, report only newly completed work and concise evidence before proceeding;
do not repeat earlier completions, the plan or remaining list. Keep gates, review, fixes, integration
and cleanup in working state; surface new blockers or decisions promptly. During long steps give a
brief meaningful status at least every 60 seconds using bounded waits. Automatic compaction does not
restart the cadence. Tool output and plan UI do not replace these updates. This cadence supersedes
repeated-summary wording in earlier task briefs without changing completion or acceptance requirements.
Use `/handoff` only for interrupted work whose unique state is not already preserved.
Keep exact ids, scopes, bases, worktrees and integration order for owned workers; historical
coordination records do not enroll new work. This amendment supersedes D325/D326 and older direct-
assignment text only for session orchestration and completion timing.

### Combined database workflow amendment (2026-09-09)

The operator admits the approved database-parallel/database-remaining directions and pending timeline
T2 into Phase 2.6. The owning [combined folder](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md)
contains product owners, multiple prerequisite releases, peer allocations and final-session controls.
This is an explicit scope exception to Phase 2.6's former downstream-only boundary, not general
permission to redesign other authorities. C0 must ratify the approved product changes at their actual
contract owners and close decision/ownership gaps before downstream implementation briefs become READY. R is the separately approved naming-only predecessor.

Completed 2.6.1 and timeline T1 identities/evidence remain unchanged. The operator inserted
**2.6.2 R** for approved naming-only changes before planning prerequisite **2.6.3 C0**.
T/C/F/L/V remain **2.6.4/5/6/7/8** with independent children under F/L/V. The operator's
latest correction removes every intermediate/nested finalization card. **2.6.9 Finalization**
(p2f-proof) is the single last task and includes handover/cleanup; p2f-close is retired and all
current downstream dependency edges use p2f-proof. Completed/in-flight work and Phase 3 IDs stay.

This is a **Phase 2.6-only exception** to the general finalization-child convention below. L
consumes P/D/G/S directly, and V consumes A/Q directly. Each assembles its inputs and repairs
immediate integration failures in its own prerequisite worktree, using focused checks/lint/freshness.
No observer or extra finalizer is launched. Each committed input must pass its assigned focused
checks before consumption; prerequisites publish working interfaces, not promises.

All implementation tasks run focused tests, lint and affected freshness. Full gates and fresh
independent review run only at final 2.6.9, with required reruns after fixes. R preserves released
migration history. No operator database upgrade is assigned. Development-card completion permits
only its explicit downstream work; Phase 2.6 acceptance and master integration wait for final PASS.

The final supervisor is the sole final integration/repair owner, fixes all remaining defects there,
and obtains fresh complete read-only sup_review on Astra/high before operator-assigned master
integration and completion. No repair handbacks, automatic task dispatch, idle coordinator, lowered
gates, or push. D191's matching scoped cadence amendment governs proof timing and evidence. Existing
in-flight tasks retain their original gates and reviews. No implementation is authorized by planning.

**L-specific operator exception, 2026-09-09:** the approved
[L01–L06 brief](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/prerequisites.md#approved-l-execution-brief--2026-09-09)
assigns 2.6.7 local master integration and owned cleanup after focused PASS. Full gates and
complete independent review remain 2.6.9; this is a scoped development release, not phase acceptance.

**C-specific operator exception, 2026-09-09:** the approved 2.6.5 C brief assigns local master
merge and owned cleanup after focused PASS to the same supervisor. This supersedes the generic
retention/final-master-integration timing for C, while full gates and complete independent review
remain in 2.6.9. See [C01–C05](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/run-completion.md#approved-execution-brief--2026-09-09)
and the matching D191 exception. C is now a merged scoped development release; its evidence is at
the same owner. Its completion is not phase acceptance.

**F-specific operator exception, 2026-09-09:** the approved 2.6.6
[F01–F07 brief](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/foundation.md#approved-execution-brief--2026-09-09)
assigns the same supervisor local master merge and owned cleanup after focused PASS and working
four-domain baseline proof. This supersedes generic retained-candidate/final-master timing for F.
Full gates and complete independent review remain in 2.6.9 under D191; F completion means a merged
scoped development release only. P/D/G/S receive distinct checkouts and one actual integrated F
base after its cleanup; no child launch, live database application or push is authorized. F is
planned, not implemented, and planning creates no checkouts.

**D-specific operator exception, 2026-09-09:** the approved 2.6.6.2
[D01–D05 brief](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/diagnostics.md#approved-execution-brief--2026-09-09)
assigns the same supervisor local master merge and owned cleanup after focused PASS. Its three
explicit timeline/live-context/test ownership additions supersede D's former frozen allocation;
other P/G/S ownership stays unchanged. This overrides generic retained-candidate/no-peer-merge timing
for D only. Full gates and complete independent review remain at 2.6.9 under D191. D completion is
a merged focused development release, not phase acceptance; no push, live application or dispatch.

**P-specific operator exception, 2026-09-09:** the approved
[P01–P06 brief](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/provider-usage.md#approved-execution-brief--2026-09-09)
assigns local master merge and owned cleanup after focused PASS. It reserves the named provider
reservation invariant and historical adaptation to P without changing sibling ownership or the
repaired common F prerequisite. This supersedes generic P retention/final-master timing and the
absolute shared-file prohibition for those exact hunks. Full gates and complete independent review
remain 2.6.9 under D191; P completion means a merged scoped development release, not phase acceptance.
No implementation, child launch, live application or push is authorized by planning.

**G-specific operator exception, 2026-09-09:** approved
[G01–G06](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/artifacts.md#approved-execution-brief--2026-09-09)
retains G’s isolated production/test scope after repaired F and assigns its supervisor local master
merge and owned cleanup after focused PASS. Full gates and complete independent review remain in
2.6.9 under D191. This supersedes generic retention/final-master timing for G only; implementation
is unstarted and no sibling launch, push or live database application is authorized.

**S-specific operator exception, 2026-09-09:** approved
[S01–S06](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md#approved-s-execution-brief--2026-09-09)
retains S's eleven production paths on complete repaired F and admits the two bounded settings
test amendments and isolated desktop proof. The same supervisor owns focused checks, local master
merge and verified owned cleanup. This supersedes generic S retention/no-peer-merge timing;
full gates and complete independent review remain 2.6.9 under D191. Default to independent work
and no peer messages, serializing only actual shared mutations and evidenced conflicts. No
implementation, sibling launch, live upgrade or push is authorized by planning.

### Parallel group shape for future plans (2026-09-09)

**Phase 3.2 onward:** the [2026-09-19 amendment](#tangible-tasks-and-phase-exit-gates) takes precedence: tangible tasks and subtasks, explicit Parallel chips, focused checks within a phase and full gates at its exit. Earlier and in-flight Phase 3.1 assignments retain their own cadence.

Except for the explicit Phase 2.6-only single-finalization trial above, for every newly planned
parallel workflow, the **task node is the actual prerequisite**, not a
container. Its independently implementable workers are numbered child nodes. The **last numbered
child is named Finalization** and is sequential: it requires the parent and every worker in that
group. Example: `N` prerequisite → `N.1`, `N.2` workers → `N.3 · Finalization`.
The display may also say “N Finalization,” but keep one stable numbered task and one owner.
Do not add a detached sibling finalizer or a duplicate container just to draw the group.

Workers depend on the completed prerequisite and do not depend on one another. Finalization is
the explicit exception to the no-sibling-dependency rule: it consumes every worker candidate and
owns combining, remaining repairs, required gates/review, acceptance evidence and cleanup. A failed
finalization leaves the group unreleased. Sequential downstream tasks require the finalization
output, not individual unfinished worker APIs. Each next parallel group receives its own actual
prerequisite node and finalization child. Bind working interfaces, independent tests/either merge
order, exact isolated ownership, resources, integration permission and compact handoff as before.

D191 and the assigned plan still own gate timing. A specific approved multi-group final-test
exception may use intermediate development finalization and reserve heavy tests/review for the last
child; label those releases honestly and name the sole final acceptance owner. No gate is dropped.
No idle observers, automatic dispatch/merge or changed model policy follows from the diagram.

Persist this structure in the roadmap, owning task headings, identity maps and launch prompts
together. Existing in-flight groups keep their assigned identities, evidence, scope and schedule;
3.1/3.2/3.5's already admitted standalone finalizers remain until explicitly replanned. This is the
required shape for future planning sessions except the explicit Phase 2.6-only trial above, not an
automatic rewrite of every existing task. Preserve Astra/high planning, supervision and independent review;
authorized supporting workers follow current native role policy.

### D344 — Operator-coordinated prerequisite groups (2026-09-08)

**Phase 3.2 onward:** the [2026-09-19 amendment](#tangible-tasks-and-phase-exit-gates) takes precedence: tangible tasks and subtasks, explicit Parallel chips, focused checks within a phase and full gates at its exit. Earlier and in-flight Phase 3.1 assignments retain their own cadence.

For remaining Phase 3.1 work, apply the [2026-09-13 cadence](#phase-31-execution-cadence-and-codex-subagents-operator-amendment-2026-09-13): focused prerequisites/tasks and group integration, full gates and repairs only at 3.1.19, no independent review.

The operator approves smaller, overlapping dashboard subphases and completed prerequisite tasks.
This changes scheduling and plan organization, not product requirements or acceptance floors.
Phase 3 uses decimal task identities: `3.P.N` names an actual standalone task or prerequisite;
`3.P.N.1`, `3.P.N.2`, etc. name independent parallel tasks unlocked by that completed prerequisite.
A parent closes on its own reviewed, integrated acceptance; it does not wait for its children.
The 2026-09-09 amendment below adds an explicit finalizer after each parallel group and owns its
worker gate schedule and downstream release boundary.
Implementation children explicitly require their parent and never depend on a worker sibling.
The finalization child is sequential and requires every worker, as specified by the newer group-shape rule.
All other required inputs must already be ancestors of the parent. Sequential consumers receive
separate task numbers. Numbering expresses dependency structure, not automatic launch or a promise
that every ready task fits available capacity. Parent prerequisites settle shared ownership and
independent gates before child assignments are admitted. Do not launch a group with unresolved overlap.

The 2026-09-08 naming amendment replaces the six organizational 3.1 containers with actual tasks.
Historical Tasks 1–7 and every execution node ID remain stable. The six container-only IDs are
retired explicitly in the 3.1 identity map; their former owner files remain citation redirects.
Old headings and dated logs remain historical aliases. Phase 3.2 uses the same decimal convention;
3.5 uses the same convention for its existing monitoring/client pair; 3.3 and optional 3.4 retain individual task numbers until a real independent group is approved. Existing Phase
0–2 numbering and in-flight briefs are unchanged. Explicit prerequisite edges, including phase-entry
requirements, determine readiness; never infer a hidden whole-phase or whole-group barrier.

The operator opens tasks and chooses integration. Agents work independently by default and may
message the relevant peer when necessary to clarify a shared contract, flag unexpected overlap,
avoid duplicate work, or resolve a concrete dependency or gate-resource blocker. Coordination is
exception-driven, not routine status polling or a required agent coordinator. Share exact paths,
contract/version, evidence and the requested resolution; continue unaffected owned work. Peers may
clarify and resolve issues within the approved ownership and contracts. A change to ownership, shared
contracts, prerequisite bases, dependencies or merge conditions needs the operator to revise the plan
before affected writes resume. Record consequential resolutions in the owning task. Messaging does
not authorize editing another worktree, consuming an unmerged peer API, weakening gates, dispatching
another task or merging automatically. Each independently assigned writer uses
an exclusive branch/worktree from a verified prerequisite base, owns disjoint code, contracts,
tests and artifacts, and can pass its gates without unmerged peer changes. Before launch, the
focused plan proves both merge orders and specifies exact paths, resource isolation, gate commands,
review and stop boundaries. Separate worktrees alone do not establish independence. Extract any
shared mutable interface, composition/registration file or fixture into a completed prerequisite;
never use a promised API or mock-only frontend as a completed vertical slice. Unexpected ownership
or dependency overlap pauses only affected work while the relevant peers clarify it and the operator
settles any plan change; it does not authorize taking peer files.

For newly approved assignments, the implementation session obtains fresh independent review, fixes
findings, and returns an exact reviewed candidate as **ready for finalizer intake** under the
2026-09-09 cadence (otherwise **ready for operator integration**). That is a
valid task-session stop, not roadmap completion. The operator chooses a merge or explicitly assigns
one integration session. That session serially verifies target/candidate identity, integrates under
repository policy, reconciles shared roadmap/phase records and combined generated output, runs
stage-appropriate integration gates under D191 (full group gates in the finalizer), obtains renewed
review for behavioral conflicts, and verifies cleanup
before marking completion. Candidate-required generated artifacts and guard changes must already
have an exclusive owner and independently passing gates; deferring them cannot hide a red candidate.
No self-review, dropped proof, weakened coverage, push or live-write authorization is implied.

Test/runtime resources also need independent ownership before launch. Isolate supported ports,
roots and outputs, and demonstrate the host worker budget. Where a real shared resource remains,
the operator schedules that gate; agents report the named wait and continue unaffected work.
Do not require an agent coordinator or infer ownership from age/title. The current ceiling remains
four auxiliary worktrees including unrelated work; a fifth requires explicit capacity approval.
Three to five independently assignable tasks is a planning opportunity, not a concurrency promise.

Existing in-flight assignments retain their approved ownership, gates and integration permissions.
The 2.6 shared-reader P stage now has a visible node under its existing 1-1 owner, without moving
its brief or adopting that session. It must close before the three peer implementations. Recovery,
adapter-retirement proof and Phase-2.6 closure remain required. Optional early dashboard inventory
is proposed read-only preparation, not early implementation or a substitute for the final acceptance
freeze. Phase 3.1 implementation still waits for closed 2.6; 3.2 waits for closed 3.1, and 3.3 still
consumes the unchanged 3.2 candidate. Unverified smaller prerequisites remain proposed and remove
no dependency. No optional preparation, extraction study or deferred People/Review task gates release.

D344 supersedes the earlier whole-wave/coordinator wording only for newly planned work and the
newly displayed 3.1 structure. Historical log entries and existing in-flight exceptions remain evidence.
Repository guidance takes precedence over older personal-skill one/two-session sizing and automatic
finalization wording for these explicitly operator-coordinated assignments. Planning is still required:
this roadmap amendment does not declare leaf briefs launch-ready or dispatch any implementation.

<a id="parallel-finalizer-cadence"></a>

#### 2026-09-09 amendment — prerequisite, parallel workers, finalizer

**Phase 3.2 onward:** the [2026-09-19 amendment](#tangible-tasks-and-phase-exit-gates) takes precedence: tangible tasks and subtasks, explicit Parallel chips, focused checks within a phase and full gates at its exit. Earlier and in-flight Phase 3.1 assignments retain their own cadence.

**Phase 3.1 exception:** the 2026-09-13 final-gates correction above removes independent review, uses focused prerequisite/task/group checks and assigns full repository gates plus same-session repairs only to 3.1.19. The general rules below continue to govern other phases.

For Phase 3 and future parallel work, every group has three explicit stages. This amendment
supersedes D344's earlier per-candidate gate/completion wording and any rule that lets a downstream
consumer use a worker candidate before the group's finalizer accepts it. Existing in-flight work
outside Phase 3 retains its approved scope, gates and integration permissions.

1. **Prerequisite.** Finish and accept the common base, shared interfaces/fixtures/registration,
   disjoint ownership, either-order integration and resource isolation. Before releasing workers,
   bind every worker and one separate sequential finalizer in the owning plan: exact task IDs,
   branches/worktrees/base, quick commands, deferred proofs, integration target and merge condition.
2. **Parallel workers.** Implement independently from that accepted base. Add regression coverage
   and run focused tests, scoped lint and selected quick verification under
   [D191](../rebuild/reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
   Obtain independent candidate review and hand over exact SHAs, results and deferred broad gates.
   Stop at **ready for finalizer intake**; no full-suite run per worker and no roadmap completion yet.
3. **Finalizer.** After all assigned workers are ready, accept their reviewed commits into its own
   integration worktree. Resolve combination defects, reconcile shared/generated outputs, run the
   full test/coverage, typecheck and lint gates plus all applicable acceptance checks, and fix
   failures within the approved group. Obtain independent review of fixes and the combined result;
   rerun required gates on the final corrected tree. Publish/integrate only a green reviewed result
   under the operator's assigned integration permission, then record completion and clean up owned
   worktrees/branches. A failure leaves the group open; scope changes return to the operator.

The finalizer is a real sequential assignment with explicit edges from every worker, never a
parallel implementation worker or an unnamed later cleanup. For newly planned groups, place it as
the last numbered child of the prerequisite under the newer group-shape rule. Workers remain mutually independent; their focused
review/readiness satisfies finalizer intake, while downstream implementation waits for finalizer
acceptance. Combining pending candidates inside the finalizer's isolated tree is allowed before
full group gates; publishing that tree as an accepted prerequisite is not. Record pending intake
in the owning task evidence without marking worker roadmap nodes complete. Prerequisites and
standalone tasks retain normal D191 gates. No automatic dispatch, push, live write or cutover is
implied. Existing audit-only/frozen-candidate tasks remain independent: finalizers repair first;
those audits still return later defects to remediation and restart against the corrected candidate.

Phase 3.1 retains its mapped integration nodes. The 2026-09-19 map moves former 3.2.7/3.2.8
into concrete subtasks 3.2.5.1/3.2.8.1 with focused checks; 3.2.9 owns full gates and freeze.
Task 3.5.3 remains that part’s full phase-exit proof.
Numbers preserve existing task identities; `needs:` edges define their actual execution order.
Finalizer intake is the explicit exception to requiring completed dependency nodes: all listed
workers must have independently reviewed, green focused candidates recorded in their owning tasks.
This does not release any downstream consumer before full finalizer acceptance.
Retain reviewed candidate branches and durable evidence until finalization. To respect the existing
worktree ceiling, a stopped worker may release its own clean worktree after verifying that all work
is committed and its review/evidence is durable; do not delete its candidate branch or mark it
complete. Groups may finish workers in capacity-sized batches, and must leave room for the
finalizer. Never remove an active session’s worktree or increase capacity implicitly.
Optional 3.4 groups follow the 2026-09-19 tangible-task and selected-batch exit rules and never block 3.5.
This policy and roadmap scope are approved; exact implementation bindings still belong to the
focused phase plan before launch. No task is launched or declared implemented by this amendment.

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
the phase overviews and subphase folders under `docs/rebuild/plans/phase-N/`, routed by the
[plans index](../rebuild/plans/README.md). Each subphase overview owns shared context and
exit criteria; linked task files, when present, own their assignments and evidence.

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
under `docs/rebuild/plans/`; the tree above is the same set of phases as nodes._

_D326 (2026-09-03) fixes one visible hierarchy for Phases 0–3: numbered phases, decimal parts,
numbered supervisor tasks, and checklist subtasks. D328 (2026-09-04) renders admitted parallel
waves as consecutive numeric task members (`N-1`, `N-2`, ...). Their strict active order is 0.3 → 1.6 → 2.6 →
3.1 → 3.2 → 3.3 → 3.5, with optional 3.4 outside the required path (D342). D319 still requires verification and operator approval before a
candidate receives migration implementation scope in its decimal Phase 4 subphase._

| Phase | Headline deliverable | Gate to exit | Size |
|---|---|---|---|
| **0** | 0.1 charter/safety · 0.2 governance · **0.3 canonical authority design** | 0.1–0.2 historical evidence retained; **0.3 active** until run/settings contracts, migration/recovery and 1.6 briefs close | **M** |
| **1** | 1.1–1.5 historical spine · **1.6 canonical authority implementation** | historical live spine proof remains MET; 1.6 waits for 0.3, then stores/writers/core resolution and compatibility deletion must pass | **XL** |
| **2** | 2.1–2.5 historical write/tails proof · **2.6 downstream revalidation** | D135 remains the controlled-write evidence; 2.6 waits for 1.6, then read models/joins/services must reconcile without rewriting evidence | **XL** |
| **3** | 3.1 shared dashboard · 3.2 authoring and freeze · 3.3 controlled acceptance · optional 3.4 document tools · 3.5 Codex/Claude cooperation | 3.1 waits for 2.6; 3.2 freezes the unchanged 3.3 candidate; 3.5 closes Phase 3 without requiring optional 3.4 | **XL** |
| **4** | Remaining workflow migrations: 4.1 Background Check, then 4.2, 4.3 and onward | each candidate's current behavior and proposed workflow are verified; operator approves the D319 packet before implementation scope is assigned | **per workflow** |
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
| §1 the base's dependency graph · §3 Phase 0 · §3.7 sizes | `docs/rebuild/plans/phase-0/README.md` |
| §2 the phase table | this file, §Phases at a glance above |
| §3 Phase 1 · §7.1–§7.2's Phase-1 rows | `docs/rebuild/plans/phase-1/README.md` |
| §3 Phase 2 · §7.1–§7.2's Phase-2 rows | `docs/rebuild/plans/phase-2/README.md` |
| §7.1's approved-target bullet · §7.3 the integration execution rule | `docs/rebuild/plans/phase-3/3.1-finish-the-dashboard/README.md` |
| §3.1's PHASE 3 ENTRY block + separations' status | `docs/rebuild/plans/phase-3/3.2-finish-workflow-authoring/README.md` and `docs/rebuild/plans/phase-3/3.3-accept-person-lookup-and-separations/README.md`; former layout preserved under `docs/rebuild/history/superseded/` |
| §3.1 the migration loop · §3.2 · §3.3 · §3.4 · §3.6 · §3.8 | ref workflow-model §1.6.2–§1.6.3 and docs 03.2–03.3; former layout preserved under `docs/rebuild/history/superseded/` |
| §3.5 · Phase 0's deferred decisions | `docs/rebuild/plans/phase-5/5A-close-cutover-readiness-gaps/README.md` |
| §4 · §5 · §5.1 · §6 · §7.4 | `docs/rebuild/plans/phase-5/5B-switch-production-authority/README.md` |

The whole as-written file, with a section-by-section table of where every § landed, is preserved at
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`.

This file's own appendices went too:

- **Appendix A (the prose decision log and the "named to you at specific future gates" list)** —
  **deleted.** `docs/rebuild/reference/decisions.md` is the append-only authority for every `D<n>`
  (its round headings carry the date, its rows the owning doc), and every future gate it listed is
  already a `you:` line on the node that owes it in the tree above.
- **Appendix B (legacy vs rebuild)** — `docs/rebuild/plans/phase-5/5B-switch-production-authority/legacy-vs-rebuild-as-of-2026-08-21.md` §Legacy vs rebuild (as of
  2026-08-20), dated because it is an inventory of a moving world.
- **Appendix C (verify any of this yourself)** — the project `CLAUDE.md` §Commands, which already
  carries every command it listed (`phase` and `storage doctor` are subcommands of `npm run cli`).


### Phase 2.6.9 final acceptance allocation (2026-09-10)

The operator approved the [F01–F07 execution brief](../rebuild/plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/final-validation.md#approved-execution-brief--2026-09-10).
One Astra/medium supervisor implements and repairs the combined candidate; zero implementation
workers. Four bounded read-only `sup_review` assignments on Astra/high cover storage/recovery,
archive/lifecycle, execution/domains and served summaries/UI; one fresh Astra/high integration
reviewer follows all four. Maximum three reviewers concurrently. This supersedes the earlier
single-complete-reviewer and Astra/high supervisor allocation for 2.6.9 only. All scopes plus
integration must PASS; no author-only or partial coverage acceptance. The same supervisor owns
local master integration after review and required full gates, handover and owned cleanup.
The [recovery amendment](../rebuild/reference/dashboard-surfaces.md#phase-269-recovery-separation--2026-09-10)
resolves adapter expiry without removing supported database/archive recovery. No Phase 3 work,
operator database application, second controlled HR write, push or next-task dispatch is authorized.
