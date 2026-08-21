# 00 · Phase 0 — design the foundation

This doc is the dedicated home of **Phase 0**, tree node `{#phase-0}`: what it designed, how it
ended, and which of its contracts no longer bind. Phase 0 wrote no runtime code by policy — its
product is the design every later phase implements — so the contracts themselves live in
`reference/` and this doc is the record of the design ACT, never a second copy of them.

## Phase summary
<!-- roadmap: phase-0 -->

<!-- roadmap-status: phase-0 -->
- [x] every reference spec reconciled through **Round 12** — D1–D94 over twelve rounds (there is no round 6), each marked `_phase: 0_` in `reference/decisions.md`
- [x] the ownership matrix (**D1**) — one owning doc per concept, referenced and never redefined; the map is `roadmap` §Governance and it still resolves
- [x] **D74** cut Phase 1 to a SPINE whose exit test is a LIVE workflow, deferring six work items behind that first real proof — executed exactly as designed, exit MET 2026-08-04
- [x] the **identity-approval gate designed here rather than at order 8** (**D77**) — this phase's one priority inversion, found and corrected inside it (§ALWAYS-GATE identity approval)
- [x] the **size model + MUST / SHOULD / LATER delivery tiers** (**D76**), which the tree's `size:` attribute still carries item for item (§Size model + delivery tiers)
- [x] the operator ratified isolated coexistence (**D88**), **ONE all-at-once cutover** (**D89**), legacy change accounting (**D90**/**D94**), the testing policy (**D91**) and the deferred probe gates (**D92**)
- [x] the rebuild's ADDRESS settled (**D93**): its own repository, seeded 2026-07-31 from `hr-automation@5879004`
- [x] Phase 0 is DONE and nothing inside it is open; **six** of its contracts have since been amended and **two** of its promises are still unbuilt — both lists are below, with owners
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
| **The gate family** — `typecheck` / `lint` / `test` / `test:architecture`, the last two as the per-commit pair | **D91** (floors), **D93** (the plain names) | **D191 (2026-08-09)**: `test:coverage` REPLACES the pair as the per-commit gate — a strict superset, measured faster. D91's FLOORS are untouched and still 60 % global / 80 % safety-critical (`vitest.config.ts:39-43`); R10's raise of the global floor to 80 is owned by `{#test-tiers}` and has not landed |
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
| **`cli test workflow <id> --dry-run` through the real kernel, plus a typed `TestTargetRegistry`** of test employees, files and sacrificial documents with usage rules | **D85** (round 8); normative text `ref:guards-and-tests` §7 | **Half built, and not as named.** The everyday scenario corpus exists (`tests/scenario/`, audited against the graph by `scenario-coverage`), and `executeDryRun` is the kernel's real preview arm — but there is no `test` CLI subcommand and no `TestTargetRegistry` in the tree. **R10** reassigns both to `{#test-tiers}`: `config/test-subjects.json` for the subjects (sensitive values outside git, referenced by label) and `npm run cli -- dry-run-scenario <workflow> --subject <label>` for the entry point |

## The base's dependency graph

This section is a **design artifact**, not a node: it is the picture Phase 0 drew of the build
order, and it carries no `<!-- roadmap: -->` tag because no single tree node owns it. `{#phase-1}`
cites it, and the map from its boxes to the tree's nodes is below. The graph is preserved as
drawn — what has since been learned is recorded beside it rather than painted over it.

The base/kernel is built along one critical path. Guard plumbing lands before the tree; the first
real rebuild `src/` leaf and every applicable type/lint/architecture arm activate in the same commit
(charter: "same quality umbrella from day one").

```mermaid
flowchart TD
  A["<b>1a</b> guard scaffold<br/><i>lands before the tree exists</i>"]
  B["<b>1b</b> strict domain + canonical input<br/>+ clock / config / secrets / dependency registry"]
  C["<b>1c</b> authority DB + backup / restore / doctor<br/>+ command &amp; write TYPE SHELL"]
  D["<b>1d</b> semantic UI registry + typed drivers<br/>+ task / provider contracts, stores, sessions"]
  E["<b>1e</b> typed workflow DAG<br/>+ results / delegation / completion / gates / scenarios"]
  F["<b>1f</b> core registry (composition root)<br/>+ executor / checkpoints / commands / write sequencer"]
  G["<b>1g-spine</b> spans + THE one projection"]
  H["<b>1i-spine</b> the four parity surfaces"]
  EXIT{{"<b>PHASE 1 EXIT</b><br/>person-lookup runs LIVE"}}

  TX["<b>Phase 2</b> controlled transaction proof<br/>dry-run · subject mismatch · commit · crash · recovery"]
  T1["<b>2g</b> evidence · failures · notifications · knowledge · ledger services"]
  T2["<b>2h</b> data services · intake mapping · manifests · capture · Edit Data"]
  T3["<b>2i</b> explorer · AI advisories · storage health · catalog UI"]
  T4["<b>2j</b> soak · restore drill · capability inventory · doc gate"]
  M(["<b>Phase 3+</b> per-workflow migration<br/>orders 0-9"])

  A --> B --> C --> D --> E --> F
  F --> G --> H --> EXIT
  EXIT --> TX --> T1 --> T2 --> T3 --> T4 --> M

  G -.->|"D81: every count reads<br/>this one projection"| H

  classDef spine stroke:#2980b9,stroke-width:2px,fill:#00000000;
  classDef tail stroke:#7f8c8d,stroke-dasharray:4 3,fill:#00000000;
  classDef gate stroke:#27ae60,stroke-width:2px,fill:#00000000;
  class A,B,C,D,E,F,G,H spine;
  class T1,T2,T3,T4 tail;
  class EXIT,TX gate;
```

**Blue = the spine** (Phase 1, D74): the minimum that can carry one workflow. **Green = the two
proofs** that falsify the design against reality — a live read, then a controlled write. **Grey
dashed = the tails**, deferred behind the first live proof so they are built against a proven base
and a real consumer rather than against fixtures.

### The boxes, as they were built

Every box was built and every edge held. The graph's eight spine boxes are **four** tree nodes
today, because the work items landed in those groupings; three names differ from what the graph
drew, and one edge turned out to be an ordering the program chose not to follow.

| Graph box | Tree node | As built |
|---|---|---|
| `A` 1a · `B` 1b | `{#p1-base}` | 2026-07-31 |
| `C` 1c · `D` 1d · `E` 1e | `{#p1-authority}` | 2026-08-01 |
| `F` 1f | `{#p1-kernel}` | 2026-08-02 → 03. **The name moved**: the composition root is `src/control/workflow-registry.ts`, in the `control` layer — not `core/`, which the graph and the justification below both spell. `src/core/` holds the executor, the command kernel and the write sequencer; the ONE `WORKFLOW_MODULES` tuple sits above them |
| `G` 1g-spine · `H` 1i-spine | `{#p1-spine}` | 2026-08-04 |
| `EXIT` | `{#p1-exit}` | MET 2026-08-04 — run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf` |
| `TX` | `{#p2-proof}` | MET live 2026-08-04 (D135) on Kuali doc **4489** — the graph draws it after the exit, and it landed the same day |
| `T1`–`T4` 2g–2j | `{#p2-2g}` … `{#p2-2j}` | 2026-08-04 → 08-09 |
| `M` Phase 3+, "orders 0-9" | `{#phase-3}` / `{#migrations}` | **The entry moved.** The graph draws the migration sequence starting at order 0; **D193(c)** enters Phase 3 at **separations, order 8**, because a big multi-system workflow forces the store task libraries into existence and one migration then mints what every later one reuses. D84's ORDER is unchanged — only where the program steps into it |

Two labels inside the boxes are worth naming precisely, because a reader will search for them:
1b's *"dependency registry"* is `src/domain/runtime-dependencies.ts` (D68's bidirectional registry),
and 1d's *"semantic UI registry"* is `src/domain/ui/` plus the generated `generated/ui-catalog.json`.

### Why the order is the order

**Critical path: guard → strict domain/config → authority/recovery → semantic driver/task store →
workflow graph/delegation → registry/executor/commands/events → trust services/dashboard.**
Justification:

- **`ref:clock-config-secrets` is the root.** Every timestamp (spans, checkpoints, trace ids, fence),
  every URL/timeout/fiscal date, and every credential reads through it. Building anything above it on
  raw `new Date()`/`process.env` would require re-threading later; the `clock-single-source` and
  `secrets-single-source` guards must be green from the rebuild repo's first source file.
- **Write-safety types/storage precede commit task contracts.** `CommitTaskContract` cannot refer to
  a later-owned placeholder. The dependency-free `WriteSafety`/proof types and SQLite authority/
  outbox schema land first; sequencing behavior lands with the executor later.
- **Authority recovery precedes authority use.** Claims/checkpoints/dependencies/write intents are
  not rebuildable; creating them before backup/doctor/degraded-mode contracts would make Phase 1
  green on a database it cannot safely recover. _(2j found the one hole this argument leaves: the
  OFFLINE restore path was complete, tested and UNREACHABLE because nothing recorded the runtime-lock
  snapshot its stopped-system proof derives from — D181. The ordering was right; the wiring was
  missing, and `01-build-the-spine.md` §1c owns the record.)_
- **Semantic UI ids and typed drivers precede browser tasks.** Tasks must be authored against one
  canonical element/page-state/observation vocabulary from their first line; raw Page/selector debt
  is not ported into task implementations and "cleaned up later."
- **`ref:task-contract` before `ref:workflow-model`** — the descriptor composes task contracts; the
  builder's `Steps` type map (D15) is typed against contracts.
- **The completion seam lands together in 1e.** `ref:dashboard-surfaces` owns the bundle-safe
  completion-program union while `ref:workflow-model` owns the descriptor/gate graph that contains
  it; both domain types land in the same work item. The event/storage/projection implementation
  waits until 1g, so neither side forward-declares a later contract.
- **Registry is above workflows.** `src/control/workflow-registry.ts` imports descriptors/stores;
  domain never imports workflows. The dashboard receives generated/server projections, never workflow
  modules.
- **Executor, command service, and events co-evolve after the graph.** The executor emits events and
  owns transaction sequencing; the command service owns every queue mutation/dependency target;
  durable authority/outbox contracts already exist, so no layer forward-declares another.
- **Trust records are base data, not dashboard decoration.** Failure/evidence/scenario/notification/
  knowledge schemas land before the UI that projects them. The read-only Workflow Explorer landed in
  Phase-2 tail 2i as drawn; the closed presentation/policy EDITING beside it did not — **D186**
  reassigned that half out of Phase 2 with a named trigger (`{#def-explorer-edit}`).
- **`ref:guards-and-tests` is orthogonal, not sequential** — it is built alongside every step (guards
  land as their target concepts appear), never "at the end." Its own meta-guard (`guard-manifest`) is
  what stops the umbrella silently shrinking.

The **data-service stores** (`ref:data-intake-and-edit-data`'s `extraction`/`normalization`/`ocr`/
`roster` contract+impl, D4) land in Phase-2 tail `2h`, after the live spine and controlled
transaction proof. Their column mapping, durable mobile capture, intake manifest/rerun, progressive
Review, and Edit Data surfaces land in the same end-to-end slice, so Phase 3 workflows consume a
proven ingest contract rather than inventing one mid-migration. _As built: all four stores exist at
`src/stores/{extraction,normalization,ocr,roster}/` and 2h closed 2026-08-09._

## ALWAYS-GATE identity approval
<!-- roadmap: phase0-always-gate -->

<!-- roadmap-status: phase0-always-gate -->
<!-- /roadmap-status -->

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.3 (the order-8 prerequisite block — the gate was pulled into Phase 0 by D77, so it is filed here rather than with the migration order) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Order-8 prerequisite — RESOLVED, and pulled into Phase 0 (D77).** This slot previously read "the
separations identity-approval GATE-NODE has no design yet." That was the sharpest priority
inversion in the plan: the single control that actually defends against the `T002173685`
**wrong-person** incident was undesigned and deferred to order 8, while the fence — which by its
own admission prevents a double-**file** and never a wrong-**person** (risk #4, D20) — had a full
design doc. The operator ratified the policy on 2026-07-24 (**ALWAYS-GATE**: manual approval on
every separation, both separation types, no auto-approve-on-match), and the gate is now designed
in **ref write-safety §14** during Phase 0, with its node mechanism owned by ref workflow-model §4. Order 8 inherits a
designed gate instead of owing one.

## Size model + delivery tiers
<!-- roadmap: phase0-size-model -->

<!-- roadmap-status: phase0-size-model -->
<!-- /roadmap-status -->

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3.7 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

This plan previously contained **no sizing of any kind**. Sizing keeps the isolated coexistence
program reviewable and exposes overruns before they compound integration risk.

**Sizes are relative build sizes, not calendar** (unit and scale defined under the §2 phase
table: S ≈ 1 session, M ≈ 2–4, L ≈ 5–10, XL ≈ 10+). They are estimates offered for correction.

| Item | Size | What dominates it |
|---|---|---|
| 1a guard plumbing + honest baselines | **L** | not the guards—the D58 capability inventory, D90 isolation/change-accounting/preservation manifests, coverage activation, and diagnostic fingerprints over 1,344 test-lint errors + 2 warnings |
| 1b strict domain leaf + coverage activation | **L** | the exhaustive **bidirectional** runtime-dependency registry (D68 — every system endpoint, provider key, secret, feature flag, legacy env name, in both directions) |
| 1c authority storage + recovery + type shell | **XL** | backup/doctor/degraded-mode/**restore drill** is a subsystem, not a table; plus the full command family + proof union types |
| 1d semantic UI registry + drivers + task contracts | **XL** | inventorying every legacy selector key into one canonical-id registry with search terms and explicit `supersedes` links, then the driver boundary + effect overloads + capability + provider narrowing |
| 1e workflow DAG + delegation + completion | **XL** | starts with the real-scale type proof (below); delegation policy matrix + completion program are each substantial on their own |
| 1f registry + workers + commands + write sequencer | **XL** | the write sequence (probe→prepare→binding proof→fence→commit→proof→atomic outbox) plus one-item worker/session ownership and evidence-qualified negative recovery |
| 1g-spine spans + the one projection | **M** | thin by design — emission + one projection, no services |
| 1i-spine exact Person Lookup surface slice | **M** | thin by capability, exact by presentation — the target is already ratified and demoed (`?view=rebuild-demo`) |
| **Phase 1 total** | **XL** | four XL items on the critical path; this is the program's centre of mass |
| Phase 2 transaction proof | **L** | mostly protocol + crash matrix; needs a named live target (§3.8) |
| Phase 2 tails 2g / 2h / 2i / 2j | **L / XL / L / M** | 2h is the largest tail (four service stores + mapping + manifests + capture + Edit Data) |
| Migration orders 0–3 (reads, downloads, OCR pipeline) | **M** each | store population; high reuse payoff, low risk |
| Migration orders 4–7 (OCR fan-out, i9, single writes, ServiceNow/OnBase) | **L** each | first gates, first workflow-specific commits, first upload-verify |
| Migration orders 8–9 (separations, onboarding) | **XL** each | deepest write-safety proofs + the identity gate + roster ingest |

**Delivery tiers — what may slip without invalidating the base.** The charter lists 27
non-negotiables and every one is currently mandatory, with no articulated reduced-scope fallback
behind the stop-loss (§5.1). These tiers give a paused/reassessed rebuild a defined shape:

- **MUST (the spine — never cut).** Write-safety contract and the transaction sequence; authority
  storage + recovery; fail-loud/strict schemas; task/descriptor contracts; executor + command
  protocol; spans + the one projection; the four parity surfaces; the identity-approval gate. These
  are what the program exists for; cutting any of them makes the rebuild pointless or unsafe.
- **SHOULD (Phase-2 tails — build before the first migration, may reorder).** Evidence receipts +
  `explain run`; structured failures + diagnostic bundles; notification inbox; intake mapping +
  manifests; Edit Data; durable capture. Slipping one of these past order 0–2 costs operator
  convenience, not correctness.
- **LATER (may reorder within Phase 2, but must land before Phase 3).** Read-only Workflow Explorer;
  AI advisories; generated UI catalog UI; knowledge/fix-record tooling; activity-report demo.
  Nothing in the write path depends on any of them, but Phase 3 does not begin until 2i closes.

**Already-ratified trims folded in (D79).** DSL graph-authoring mode — cut (§Phase 2). Notification
lifecycle — read/unread + snooze, actor-keyed inbox, not a five-state lifecycle. Commands — keep
`version` + `actor` wire fields everywhere (multi-user seam, D75), enforce CAS only where a real
race exists (cancel-tree, edit-vs-resume, gate resolution, write-recovery). Capture crash-proofing
— durable sessions + one durable finalize outbox, not a restart-between-every-state matrix. Ledger
hash-chain — deferred until multi-user is real; the never-pruned ledger, atomic outbox, single
projector, and actor attribution all stay. Task authoring — a **lightweight tier** exists
(**ref task-contract §2.7** owns the three tiers, and the tier is *derived* from effect + store kind, never
self-declared): a `workflow:` mini-store pure read needs schemas + example only; browser reads add
freshness/provenance/subject; commits pay full fare. A **`scaffold new-task` / `scaffold new-workflow`
generator** is part of the base — the declaration toil is only acceptable if it is generated.

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 1 (the D1–D16 block) | 2026-07-17/18 | D1–D16 | the ownership matrix (D1), task identity/contract split, gates as run-state (D5), `dryRun` on the envelope (D6), checkpoint freshness (D8), the one event schema (D10), the SQLite role (D14) |
| 2–3 | 2026-07-18 | D17–D25 | write-safety after the skeptic review: probe-then-park (D17), the same-key fence (D18), schema-validated backfill (D19) |
| 4 | 2026-07-21 | D26–D45 | the three task effects (D26), the workflow as a typed DAG (D27), descriptor exhaustiveness (D28) |
| 5 | 2026-07-22 | D46–D68 | the permanent-key/proof family (D48/D64), the D58 capability-closure inventory, the bidirectional dependency registry (D68) |
| 7 | 2026-07-22 | D69–D72 | executable feasibility + the honest gate baseline (D70/D71); pre-propagation negative evidence closed (D69) |
| 8 | 2026-07-23 → 07-26 | D73–D86 | **the load-bearing round for this phase**: D74 the spine + a live exit test, D76 the size model and MUST/SHOULD/LATER tiers, D77 the ALWAYS-GATE designed here rather than at order 8, D79 the trims (DSL mode cut), D80 the archive model, D81 the ONE projection, D82 the receipt's acceptance bar, D84 the reuse-leverage ordering |
| 9 | 2026-07-30 | D87 | the worker/session model |
| 10–12 | 2026-07-31 | D88–D94 | isolated coexistence (D88), ONE all-at-once cutover (D89), change accounting (D90/D94), the testing policy (D91), the probe gates (D92), and the two-repository address (D93) |

**D131 is a retired gap — never reuse it.**

## Exit criteria

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3 (Phase 0's exit criteria) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Exit criteria.** **MET 2026-07-31.** Every reference spec and this build order are approved; every deferred
question has an owner, evidence needed, and resolution point.
