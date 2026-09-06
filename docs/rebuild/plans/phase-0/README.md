# Phase 0 · Design the foundation

This doc is the dedicated home of **Phase 0**, tree node `{#phase-0}`: what historical Parts 0.1–0.2
designed, which contracts no longer bind, and the reopened 0.3 authority-design work. Phase 0 writes
no runtime code by policy — its product is the design every later phase implements — so the contracts themselves live in
`reference/` and this doc is the record of the design ACT, never a second copy of them.

## Phase summary
<!-- roadmap: phase-0 -->

<!-- roadmap-status: phase-0 -->
- [x] every reference spec reconciled through **Round 12** — D1–D94 over twelve rounds (there is no round 6), each marked `_phase: 0_` in `reference/decisions.md`
- [x] the ownership matrix (**D1**) — one owning doc per concept, referenced and never redefined; the map is `roadmap` §Governance and it still resolves
- [x] **D74** cut Phase 1 from ten base work items built against synthetic fixtures to **1a–1f plus two thin slices**, with a LIVE workflow as the exit test — executed exactly as designed, exit MET 2026-08-04
- [x] the **identity-approval gate designed here rather than at order 8** (**D77**) — this phase's one priority inversion, found and corrected inside it (§ALWAYS-GATE identity approval)
- [x] the **size model + MUST / SHOULD / LATER delivery tiers** (**D76**), which the tree's `size:` attribute still carries item for item (§Size model + delivery tiers)
- [x] the operator ratified isolated coexistence (**D88**), **ONE all-at-once cutover** (**D89**), legacy change accounting (**D90**/**D94**), the testing policy (**D91**) and the deferred probe gates (**D92**)
- [x] the rebuild's ADDRESS settled (**D93**): its own repository, seeded 2026-07-31 from `hr-automation@5879004`
- [x] historical Parts **0.1–0.2** are complete; their evidence and later amendments remain intact
- [x] **0.3** is reopened by D326/D327: design one run-record authority, one settings catalog/root, their migration and recovery rules, and exact implementation briefs before 1.6 changes code — CLOSED 2026-09-04: D330 · D331 · D332 and the §0.3 Task 4 bindings (coordination C31da5310, merges `1a04d565` `63f6da4f` `ff4e08b9` `5dcdd112`)
> 2026-09-03 | D326/D327 authority reset | 0.3 is the earliest active part. This planning reconciliation did not implement either authority; the runtime phase marker therefore remains historical until the 0.3→1.6→2.6→3.1 chain completes
> 2026-08-21 | docs-cohesion 00 | verified against reference/decisions.md rounds 1–12, reference/charter.md items 1–27, reference/write-safety.md §14, src/cli.ts, vitest.config.ts:39-43, config/legacy-capabilities.json (78 entries) and every size attribute in docs/roadmap/roadmap.md; left: nothing in Phase 0 itself — the amendments and the two unbuilt promises are recorded below and every one of them is owned elsewhere
<!-- /roadmap-status -->

### What Phase 0 was

**The goal, stated as a rule rather than a milestone.** Every foundational contract is designed,
adversarially reviewed and operator-approved **before** any rebuild code is built. That is charter
§Process in its own words — *"Nothing in the rebuild repo gets built before its design part is
operator-approved"* — which makes Phase 0 the only phase whose deliverable is entirely prose and
the only one that produced no `src/`.

**What it produced.** The design set, the decision ledger, and the build order the next three
phases executed without re-sequencing. Twelve reconciliation rounds (`reference/decisions.md`,
rounds 1–12, D1–D94) folded three adversarial doc reviews, an external plan review, a whole-plan +
legacy-code review, an executable feasibility spike and eleven operator ratification sessions into
the docs that own each contract. The docs were fourteen numbered files then; they are the eight
phase docs `00`–`05` plus thirteen specs under `reference/` now (**D263**, 2026-08-20) — that
reorganization moved files and citations, never contracts.

**Its four load-bearing acts**, in the order a reader needs them:

1. **The ownership matrix (D1).** Every concept has exactly ONE owning doc; another doc may
   reference that contract and may never redefine it. Everything else in this program — the ratified
   ledger, the two-way plan binding, "a decision is not ratified until it lands in its owning doc" —
   is machinery for keeping that one rule true. The map itself lives in `roadmap` §Governance.
2. **The spine restructure (D74, operator ACCEPTED 2026-07-23).** The plan as first written built
   ten base work items against synthetic fixtures with no consumer, then ran a workflow. Phase 0
   cut it to **1a–1f plus two thin slices**, with a LIVE workflow as the exit test, and deferred the
   rest to Phase-2 tails built against a proven spine. Nothing was deleted, only reordered — and the
   call is retrospectively justified: every defect Phase 1's exit criteria record was found by the
   live run and by nothing else (`01-build-the-spine.md` §Exit criteria).
3. **The identity gate, pulled forward (D77).** See §ALWAYS-GATE identity approval — the phase found
   that ~60 KB specified a fence that admittedly cannot prevent the wrong-PERSON incident, while the
   control that can was one deferred line, and fixed the inversion inside the phase.
4. **The two-repo model and the ONE cutover (D88–D94).** Legacy stays the sole production authority,
   live and maintainable, until a single all-at-once switch; the rebuild proves capabilities and
   flips nothing per workflow. `05-cut-over.md` owns the switch itself.

### How it ended

**COMPLETE 2026-07-31.** Every reference spec and the build order were approved; every deferred
question carried an owner, the evidence it needs, and the milestone that resolves it (**D92**). The
same day, **D93** moved the rebuild out of the legacy checkout's `temp_src/` into this repository,
seeded from `hr-automation@5879004` (branch `feature/rebuild-phase1b`, which stays in the legacy repo
as the pre-split record).

**What happened next, which is the only real test of a design phase.** Phases **1a–1e** completed
2026-08-01, **1f / 1g-spine / 1i-spine** on 2026-08-04 with D74's live exit test, **Phase 2** on
2026-08-09, and Phase 3 entered at separations. No phase was re-sequenced and no Phase-0 contract
was withdrawn. What DID move is listed next, because a reader deciding whether a Phase-0 sentence
still binds cannot be asked to diff the ledger themselves.

### What no longer binds

Six Phase-0 contracts have been amended by a later decision. None is a waiver and none re-opens the
phase; each names the decision that moved it.

| Phase-0 contract | Set by | What amended it |
|---|---|---|
| **Legacy change accounting** — every legacy maintenance commit mapped to affected capabilities, fail-closed, with a clean legacy `src`/`tests` worktree required | **D90** (round 10), mechanized by **D94** (round 12) | **RETIRED — D150 (2026-08-05).** The two repositories touch each other in neither direction; `config/legacy-change-accounting.json` is a frozen historical record and must not be extended. The risk it covered (a ported selector going stale after legacy fixed it) is covered instead by **live re-verification at each workflow's migration**, which the charter already makes mandatory and pre-authorizes. A selector checked against the live system beats one diffed against legacy's copy of it |
| **The gate family** — `typecheck` / `lint` / `test` / `test:architecture`, the last two as the per-commit pair | **D91** (floors), **D93** (the plain names) | **D191 (2026-08-09)**: `test:coverage` REPLACES the pair as the per-commit gate — a strict superset, measured faster. D91's FLOORS are untouched and still 60 % global / 80 % safety-critical (`vitest.config.ts:39-43`); R10's raise of the global floor to 80 is now owned by `{#workflow-authoring-core}` and has not landed |
| **A command's NAME is an isolation resource** — the rebuild's launch commands carried a `rebuild:` prefix so a mistyped command could not start the wrong runtime | **D88**'s isolation list, carried forward by **D93** | **D247 (2026-08-20)**: names may coincide. A muscle-memory `npm run dashboard` in the wrong checkout starts THAT checkout's dashboard, on its own port, under its own roots and locks — which is legible and harmless. Isolation is the VALUES, not the names. **D216 (2026-08-14)** is the same correction one row down: both repos name the browser-profile root `.auth`, because a repo-relative root cannot collide and `browserSessionNamespace` is the half that actually protects browser state |
| **One master plan, one file** | charter §One master plan (operator directive 2026-07-17) | **D263 (2026-08-20)**: the plan keeps one identity and gains a machine-readable FORM — `docs/roadmap/roadmap.md` in the roadmap notation, bound to the docs BOTH ways (`doc:` refs on every node, `<!-- roadmap: id -->` tags on every describing section, the `roadmap-doc-binding` guard refusing either that resolves to nothing). The single file itself was dissolved into the eight phase docs the same day; the prose still wins on any disagreement, and the disagreement is now CAUGHT rather than argued |
| **Phase 3 begins at migration order 0** | **D84** (round 8) — the order optimizes total time-to-resume-all, so separations and onboarding come last | **D193(c) (2026-08-12)** moves the ENTRY to **separations (order 8)**: a big multi-system workflow forces the store task libraries into existence, so one migration mints what every later one reuses instead of trickling stores in through small reads. D84's ORDER is explicitly not re-sequenced — it stays the risk-proof ordering |
| **The D58 capability-closure inventory gates cutover** | **D58** (round 5), mechanized by **D90** | **D184 (2026-08-09)**: the guard proved coverage and never read a DISPOSITION, so 73 of 78 entries sat `open` and 53 of those named a milestone that had already shipped — an inventory nobody could act on. The guard now refuses an entry `open` at or before the runtime's own `completedThrough`, a target that does not resolve, and evidence that only says "the legacy file still exists". At HEAD `config/legacy-capabilities.json` holds 78 entries — 20 `replaced` · 7 `native` · 4 `retired` · **47 `open`** against real later milestones |

### Two Phase-0 promises are still unbuilt

Both were ratified here, neither is a contract anything depends on, and each is recorded so a reader
does not have to discover it in Phase 3.

| Promise | Where it was made | State at HEAD |
|---|---|---|
| **`scaffold new-task` / `scaffold new-workflow` are part of the base** — contract skeleton, impl stub, example, scenario stubs and store registration, each with `TODO` markers that fail their guards until filled, because *"the declaration toil is only acceptable if the boilerplate is generated"* | **D79**'s ratified trims; normative text `ref:task-contract` §2.7 | **Not built.** No scaffold command, generator or flow exists in this tree — `src/cli.ts` registers exactly five composers (dashboard · worker · explain · ocr · storage) and there is no code-emitting path anywhere else. The **`new-workflow`** half IS owned: the operator's 2026-08-20 ruling folds the authoring path into `{#def-explorer-edit}` (`04-close-the-deferrals.md`). The **`new-task`** half has **no node owner today** — reported here, not assigned by this doc |
| **`cli test workflow <id> --dry-run` through the real kernel, plus a typed `TestTargetRegistry`** of test employees, files and sacrificial documents with usage rules | **D85** (round 8); normative text `ref:guards-and-tests` §10 | **Built under R10's ratified names.** `config/test-subjects.json` is the typed label registry (sensitive EIDs resolve only through `src/domain/secrets.ts`), `dry_run_scenario_results` is the insert-only authority evidence, and `npm run cli -- dry-run-scenario <workflow> --subject <label>` is the real-kernel entry point. A gone/unknown subject records `blocked` before browser composition; the first honest finalization canary is date-blocked until 2026-08-28 |

## Decisions this phase ratified

_Indexed from `reference/decisions.md`'s round headings and their `_phase: 0_` markers. The
ratification act and the normative pointer stay in the ledger; this is the phase index. **Every
round 1–12 is marked `_phase: 0_`, and there is no round 6** — the numbering skips it._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 1 (the D1–D16 block) | 2026-07-17/18 | D1–D16 | the ownership matrix (D1), task identity/contract split, gates as run-state (D5), `dryRun` on the envelope (D6), checkpoint freshness (D8), the one event schema (D10), the SQLite role (D14), the two label layers (D16) |
| 2 | 2026-07-18 | D17–D22 | write-safety after the skeptic review: probe-then-park (D17), the same-key fence (D18), schema-validated backfill (D19) |
| 3 | 2026-07-18 | D23–D25 | the Step-0 spike — recorded as historical and already superseded by the rounds that follow it |
| 4 | 2026-07-21 | D26–D45 | the external plan review: the three task effects (D26), the workflow as a typed DAG (D27), descriptor exhaustiveness (D28), checkpoint-freshness amendment (D34) |
| 5 | 2026-07-22 | D46–D68 | the whole-plan + legacy-code review: the permanent-key/proof family (D48/D64), the D58 capability-closure inventory, the typed gate result (D46/D67), the bidirectional dependency registry (D68) |
| 7 | 2026-07-22 | D69–D72 | executable feasibility + the honest gate baseline (D70/D71); pre-propagation negative evidence closed (D69) |
| 8 | 2026-07-23 → 07-26 | D73–D86 | **the load-bearing round for this phase**: D74 the spine + a live exit test, D76 the size model and MUST/SHOULD/LATER tiers, D77 the ALWAYS-GATE designed here rather than at order 8, D79 the trims (DSL mode cut), D80 the archive model, D81 the ONE projection, D82 the receipt's acceptance bar, D84 the reuse-leverage ordering, D85 the testing standard, D86 notifications/retention/knowledge |
| 9 | 2026-07-30 | D87 | one item per worker; parallelism IS worker count — executor lanes and cross-workflow pools retired |
| 10 | 2026-07-31 | D88–D92 | isolated coexistence (D88), ONE all-at-once cutover (D89), legacy change accounting (D90), the testing policy (D91), the probe gates (D92) |
| 11 | 2026-07-31 | D93 | the standalone rebuild repository — the in-tree half of D88 superseded, D89/D90 mechanics amended, only the ADDRESS moves |
| 12 | 2026-07-31 | D94 | D93's accounting made commit-centred and fail-closed |

**Six of these no longer bind as written** — D84's entry point, D88/D93's command names and profile
root, D90/D94 entirely, D91's gate family (not its floors), and D58's inventory guard. Each is named
with its amending decision in §What no longer binds. Everything else on this list is still the
contract the code implements.

**D131 is a retired gap — never reuse it.**

## Exit criteria

**MET 2026-07-31**, on three criteria that were all satisfiable inside the phase. Each carries its
evidence below; where a later phase found a criterion was met more narrowly than it read, the
correction is stated inline rather than left for a reader to discover.

### 1 — Every reference spec and the build order are approved. MET

Rounds 1–12 (D1–D94) reconciled the whole design set: three adversarial doc reviews, an external
rebuild-plan review, a whole-plan + legacy-code review, an executable feasibility spike, and eleven
operator ratification sessions, each folded into the doc that owns the contract in the same commit
that recorded it (charter standing rule, added 2026-07-26 after the 07-23/24 ratifications sat four
days in a review file while three docs still specified the world they replaced).

_The proof this criterion was really met is what came after it, and it is not in this doc:_ Phase 1
executed the approved order and its exit criteria are all MET (`01-build-the-spine.md`), Phase 2
proved the write half and built the four tails (`02-prove-writes-build-the-tails.md`), and no phase
was re-sequenced.

### 2 — Every deferred question has an owner, the evidence it needs, and a resolution point. MET

**D92** is the rule: live write-proof probes are mandatory at their named LATER gates and are not
Phase-1 blockers — UCPath receipt proof before the Phase-2 controlled commit that consumes it,
ServiceNow receipt proof and OnBase upload verification before their order-7 migration evidence.
_As built, that rule is now a shelf rather than a sentence:_ `04-close-the-deferrals.md` holds eight
deferrals, each with its trigger, and each admitted Phase 4 packet under `ref workflow-model` §1.6.2
tracks its own live probes. The two-item test — an owner and a trigger, never silence — is what
D186 and D189 were later held to.

### 3 — Executable feasibility, recorded as feasibility and not as implementation. MET

Disposable files **outside the repository** were compiled and run against the project's actual
Node 26, TypeScript 5.9 and Zod 4 dependencies. The spike proved effect-specific contract overloads
and negative type controls, provider-client narrowing, canonical-input transform-once/revalidate-many
behaviour, strict command arms, target-field mappings, typed child results, proof unions, a 40-node
typed chain, post-write settlement, SQLite permanent-key/atomic-outbox behaviour, and native online
backup/read-only verification. The 40-node compile completed in **0.68 s at about 212 MB**. One
adversarial case initially failed — pre-propagation negative evidence could contribute a vote — and
was closed by **D69**.

**This establishes feasibility only**, which is why **D71** requires the same controls against the
real API as committed Phase-1 tests. _As built:_ the committed proof exists — `tests/types/`
(`flow-graph.typecheck.ts`, `task-contracts.typecheck.ts`), a 21-node graph inside the one `tsc`
program with `@ts-expect-error` negative controls — but its **5 s / 1 GiB budget is unmeasured**:
nothing runs `tsc --extendedDiagnostics` against it, so the recorded 0.47 s / 215 MiB is history and
not a gate. Owner `ref:guards-and-tests` §3.12, tracked in `01-build-the-spine.md` §Phase summary.

### The gate baseline this phase recorded, and what happened to it

**Measured 2026-07-31 in the legacy repo:** `typecheck:all`, source lint, dashboard build, 479 unit
files / 4,619 tests, 11 serial files / 20 tests, and 23 architecture files / 129 tests all passed;
test lint was red at **1,344 errors + 2 warnings**. D70 made the asymmetry explicit — new rebuild
source and tests are zero-warning from their first file, while legacy test diagnostics are
fingerprinted, no-new-debt coexistence debt that may remain non-zero through initial cutover.

_As built, the legacy half of this baseline is retired._ **D93** made isolation physical and **D150**
retired legacy change accounting altogether, so no rebuild gate reads legacy's working tree and no
plan milestone owes a `lint:tests` verdict. The rebuild half stands and is stronger than the
baseline promised: `--max-warnings 0` with no debt manifest and no per-file allowlist, from the first
file (`01-build-the-spine.md` §1a).

### What this phase leaves open

**Nothing in Phase 0's own scope.** Its three exit criteria are MET, its build order was executed
without re-sequencing, and no Phase-0 contract has been withdrawn. What a reader still needs from
this doc is in §Phase summary: **six** contracts amended by a later decision, and **one** promise
ratified here that is still unbuilt — the `scaffold` generators (the `new-workflow` half owned by
`{#def-explorer-edit}`, the `new-task` half **unowned and reported**). D85's dry-run command and
test-target registry later landed under R10's names; D329 routes its remaining mutable work through
`{#workflow-authoring-core}` and its final proof through `{#workflow-candidate-freeze}`.

## Subphase plans

- [Phase 0.1 · Product charter and safety boundaries](0.1-product-charter-and-safety-boundaries/README.md)
- [Phase 0.2 · Delivery governance and plan structure](0.2-delivery-governance-and-plan-structure/README.md)
- [Phase 0.3 · Redesign single-source runtime authority](0.3-redesign-single-source-runtime-authority/README.md)
