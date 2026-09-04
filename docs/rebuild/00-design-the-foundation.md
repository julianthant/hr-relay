# 00 · Phase 0 — design the foundation

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
- [ ] **0.3** is reopened by D326/D327: design one run-record authority, one settings catalog/root, their migration and recovery rules, and exact implementation briefs before 1.6 changes code
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

## 0.1 · Product charter and safety boundaries
<!-- roadmap: phase0-charter -->

### Task 1 · Fix the charter and authority boundary
<!-- roadmap: phase0-charter-boundary -->

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

### Task 2 · Design separation identity authority
<!-- roadmap: phase0-always-gate -->

<!-- roadmap-status: phase0-always-gate -->
- [x] the POLICY — manual approval on **every** separation, both separation types (Kuali and I-9), **no auto-approve-on-match** (**D77**, operator ratification 2026-07-24, designed 2026-07-26)
- [x] the DESIGN is where D77 put it and still binds: `ref:write-safety` §14, with the gate-node mechanism owned by `ref:workflow-model` §4 — order 8 inherited a designed gate instead of owing one
- [x] BUILT and live-proved at separations chunk 3 as `separations-identity-check` — two UCPath reads, a pure comparison producing the packet, the operator gate, a post-gate check; terminal `done` over a real person through the real command endpoint (**D202**, 2026-08-12)
- [x] the gate dominates the run's OUTPUT, not only its decision — `identity-gate-before-commit` audits every transaction node AND the terminal result, and it caught the descriptor's first draft reading its product off the pre-gate node (D202)
- [x] who approved is durable AND reaches the operator's evidence: `gate_results` carries the kernel's own `resolvedBy`/`resolvedAt` (D202), the kernel reads a gate row as a dependency's evidence rather than demanding a checkpoint (**D203**), and the receipt derives from it (**D204**) — §14.6 risk 6 closed on both halves
- [x] the approval binds the WRITE PLAN, not only the person — the reconciled dates, the template and the department sit INSIDE the packet digest, so a value that moves after approval re-opens the gate (**D211**, 2026-08-14)
- [x] all three approval ceremonies exist and an unknown shape refuses (**D226**, 2026-08-19) — until then the frontend implemented one of three, so an ambiguous packet had no answer available in the dashboard at all
- [x] §14.7's two deferred values were answered where it said they would be, at the separations §b questionnaire (2026-08-12): freshness limit **4 hours**, and the I-9-packet question resolves out of scope because separations does not involve the I-9 packet (`docs/migrations/separations.md` §4b, residual 5A)
- [x] D127's one ratified exemption was named and checkable while its annotation proof workflow existed; D266 retired both the workflow and the exemption, so every current separation-class commit remains under D77's identity gate (`ref:write-safety` §14.8)
- [ ] §14.4's manual-entry arm is built NARROWER than designed: an EID the packet never SHOWED is refused by name (`identity-approval-eid-not-shown`) because chunk 3 performs no second live read. Narrow in the safe direction, and the widening belongs to a chunk that can perform one — owner `ref:write-safety` §14.9
- [ ] the honest residual D77 never claimed to close: the gate makes a wrong-person termination require a human to approve the wrong person **while looking at the disconfirming evidence**; it cannot make the class impossible, because the operator is the authority on which person is correct (`ref:write-safety` §14.6)
> 2026-08-21 | docs-cohesion 00 | verified against reference/write-safety.md §14–§14.11, src/dashboard/app/identity-ceremony.ts, src/dashboard/surfaces/identity-approve.tsx, tests/unit/architecture/identity-gate-before-commit.test.ts and docs/migrations/separations.md §4b; left: the manual-EID widening and the standing residual, both owned in ref:write-safety

<!-- /roadmap-status -->

**What Phase 0 decided, and why it is filed here rather than at order 8.** This slot in the
migration order previously read *"the separations identity-approval GATE-NODE has no design yet."*
That was the sharpest priority inversion in the whole plan: roughly 60 KB specified the permanent-key
fence, which by its own admission prevents a double-**file** and never a wrong-**person** (risk #4,
D20), while the single control that defends against the `T002173685` wrong-person incident was one
deferred line. The operator ratified the policy on 2026-07-24 — **ALWAYS-GATE**, both separation
types, no auto-approve-on-match — which made the design cheap, so it was written **in Phase 0**.
Order 8 inherited a designed gate instead of owing one.

**The incident, and the one fact that settles the design.** `T002173685` was a wrong-DATA error: a
name-search override date-matched a different career employee and filed a real termination against
him. A permanent-key fence would have fenced that write perfectly and filed it anyway, because the
key derived from the wrong person; the probe would have found no prior termination for that person,
correctly, and authorized the click. The tempting cheaper design — gate only when the names look
different — is falsified by the incident itself:
`classifyNameSimilarity("Hernandez, Jose Santos", "Santos Hernandez")` returns **`same`**, because
the token alignment tolerates extra tokens on the longer side, and legacy fires its wrong-person
control only on `different`. **The incident would not have tripped a tier-triggered gate.** That is
the argument for ALWAYS-GATE in one line, and it is why the packet leads with DISCONFIRMING evidence
and computes its `approvalShape` on the SERVER — a frontend free to choose the control could quietly
turn every gate into one click, which is `ref:write-safety` §14.6's rubber-stamping risk manufactured
by accident.

**Two layers, two different questions, neither substituting for the other.** The identity-approval
gate answers *is this the right person to act on?* and is an operator decision; fresh subject binding
answers *is the page I am about to click on showing that person?* and is a machine observation. A run
must pass both: the gate produces an **approved subject**, and the binding proof asserts the staged
page equals that subject at the instant of the fence. Neither is inferable from the other.

**Where it is built, and what building it changed.** The normative design is `ref:write-safety` §14
(gate mechanism `ref:workflow-model` §4); the as-built record is §14.9–§14.11 of the same doc, and
the first live gated run was 2026-08-12. Three things landed differently from the design and each is
stronger: the result payload carries **no** actor and **no** instant because authority does
(a caller-supplied `approvedBy` would be a claim sitting next to authority); a manually typed EID the
packet never showed is **refused**; and `chosenFrom` is **checked** against the packet rather than
recorded. Two platform defects the same run found belong to the kernel and not to this design — a
gate has no checkpoint, so a task declaring one as a dependency was structurally unrunnable until
**D203** taught the reader to resolve a `gate_results` row, and the receipt kept saying `unknown`
until **D204** did the same one surface further out.

## 0.2 · Delivery governance and plan structure
<!-- roadmap: phase0-governance -->

### Task 1 · Establish the one-plan and ownership rules
<!-- roadmap: phase0-plan-governance -->

The roadmap tree, admitted phase docs, reference specs, and decision pointer form one plan with
non-overlapping ownership. A decision lands in its owning contract in the same commit as its pointer,
and `npm run roadmap:check` proves the generated site is not a second editable plan.

### Task 2 · Fix the spine order and deferred proof gates
<!-- roadmap: phase0-build-order -->

D74 narrowed the spine to the minimum base plus a real live exit and retained the omitted work as
Phase-2 tails. D92 requires every deferred live probe to keep an owner, its required evidence, and
the point that resolves it.

### Task 3 · Prove executable feasibility and record the gate baseline
<!-- roadmap: phase0-feasibility -->

The feasibility spike tested the highest-risk type/storage assumptions without pretending to be
implementation. The historical gate baseline recorded every failure honestly and later decisions
name each changed gate.

### Task 4 · Fix the size model and delivery tiers
<!-- roadmap: phase0-size-model -->

<!-- roadmap-status: phase0-size-model -->
- [x] the model itself (**D76**): relative build sizes in **S ≈ 1 session · M ≈ 2–4 · L ≈ 5–10 · XL ≈ 10+**, offered for correction, never calendar
- [x] the model is LIVE, not history — the tree's `size:` attribute carries D76's estimate for **every item this table sized**, item for item and unchanged, and `roadmap` §Phases at a glance carries the five phase-level ones
- [x] the estimates held where they mattered: four XL items on Phase 1's critical path (`{#p1-authority}` for 1c·1d·1e, `{#p1-kernel}` for 1f), and Phase 1's own XL total, with the phase landing 07-31 → 08-04
- [x] **MUST** — every spine item shipped: the write-safety contract and transaction sequence, authority storage + recovery, fail-loud/strict schemas, task/descriptor contracts, executor + command protocol, spans + the ONE projection, the four parity surfaces, and the identity-approval gate
- [x] **SHOULD** — every Phase-2-tail item shipped in 2g/2h (D134–D167): evidence receipts + `explain run`, structured failures + diagnostic bundles, the notification inbox, intake mapping + manifests, Edit Data, durable capture
- [x] **LATER** — all five shipped in **2i** before Phase 3 began, which is exactly what the tier required: the read-only Workflow Explorer, AI advisories, the generated UI catalog UI, knowledge/fix-record tooling, the activity report (D168–D180)
- [x] D79's ratified trims all held — DSL graph-authoring cut and still cut; notification lifecycle is read/unread + snooze on an actor-keyed inbox; commands carry `version` + `actor` everywhere and enforce CAS only where a real race exists; capture is durable sessions + one finalize outbox; the ledger hash-chain is still deferred while the never-pruned ledger, atomic outbox, single projector and actor attribution all stand; the three authoring tiers are DERIVED from effect + store kind (`ref:task-contract` §2.7)
- [x] the tiers were never exercised: nothing slipped, so the fallback shape they define for a paused rebuild is untested — which is the outcome the model wanted and not evidence that the model works
- [ ] D79's one unbuilt trim-condition — the `scaffold new-task` / `scaffold new-workflow` generators the lightweight tier was ratified WITH (§Phase summary, "Two Phase-0 promises are still unbuilt")
> 2026-08-21 | docs-cohesion 00 | verified every size attribute in docs/roadmap/roadmap.md against this table (all 24 sized items agree), the tier contents against 02-prove-writes-build-the-tails.md §2g/§2h/§2i, and D79's trims against src/domain/notifications.ts, src/domain/commands.ts and reference/task-contract.md §2.7; left: the scaffold generators, and five later nodes carry sizes this table never estimated

<!-- /roadmap-status -->

**What D76 added, and why sizing is in a design phase at all.** The plan as first written contained
**no sizing of any kind**. Sizes keep a long coexistence program reviewable and expose an overrun
before it compounds into integration risk — and the tie-breaker D76 ratified beside them
(*between two correct, equally safe designs the sooner one wins; never overriding write-safety,
identity or fail-loud*) is only usable if "sooner" is something the plan can say out loud.

**Sizes are relative build sizes, not calendar.** The unit is work sessions of the kind this program
actually runs in: **S** ≈ 1, **M** ≈ 2–4, **L** ≈ 5–10, **XL** ≈ 10+. They are estimates offered for
correction, not commitments. The same unit and the same scale are restated in `roadmap`
§Phases at a glance, which sizes the five phases; this table sizes the items inside them.

| Item | Size | What dominates it |
|---|---|---|
| 1a guard plumbing + honest baselines | **L** | not the guards — the D58 capability inventory, D90 isolation/change-accounting/preservation manifests, coverage activation, and diagnostic fingerprints over 1,344 test-lint errors + 2 warnings |
| 1b strict domain leaf + coverage activation | **L** | the exhaustive **bidirectional** runtime-dependency registry (D68 — every system endpoint, provider key, secret, feature flag, legacy env name, in both directions) |
| 1c authority storage + recovery + type shell | **XL** | backup/doctor/degraded-mode/**restore drill** is a subsystem, not a table; plus the full command family + proof union types |
| 1d semantic UI registry + drivers + task contracts | **XL** | inventorying every legacy selector key into one canonical-id registry with search terms and explicit `supersedes` links, then the driver boundary + effect overloads + capability + provider narrowing |
| 1e workflow DAG + delegation + completion | **XL** | starts with the real-scale type proof (§Exit criteria); delegation policy matrix + completion program are each substantial on their own |
| 1f registry + workers + commands + write sequencer | **XL** | the write sequence (probe → prepare → binding proof → fence → commit → proof → atomic outbox) plus one-item worker/session ownership and evidence-qualified negative recovery |
| 1g-spine spans + the one projection | **M** | thin by design — emission + one projection, no services |
| 1i-spine exact Person Lookup surface slice | **M** | thin by capability, exact by presentation — the target is already ratified and demoed |
| **Phase 1 total** | **XL** | four XL items on the critical path; this is the program's centre of mass |
| Phase 2 transaction proof | **L** | mostly protocol + crash matrix; needs a named live target |
| Phase 2 tails 2g / 2h / 2i / 2j | **L / XL / L / M** | 2h is the largest tail (four service stores + mapping + manifests + capture + Edit Data) |
| Migration orders 0–3 (reads, downloads, OCR pipeline) | **M** each | store population; high reuse payoff, low risk |
| Migration orders 4–7 (OCR fan-out, i9, single writes, ServiceNow/OnBase) | **L** each | first gates, first workflow-specific commits, first upload-verify |
| Migration orders 8–9 (separations, onboarding) | **XL** each | deepest write-safety proofs + the identity gate + roster ingest |

**As built, this table is the tree.** Every row above is the `size:` attribute on its node today —
`{#p1-base}` L, `{#p1-authority}` XL, `{#p1-kernel}` XL, `{#p1-spine}` M, `{#p2-proof}` L,
`{#p2-2g}` L, `{#p2-2h}` XL, `{#p2-2i}` L, and `{#p2-2j}` M. D319 retired the candidate
migration-order nodes before admission; their M/L/XL estimates remain historical planning evidence,
not active node bindings. Separations' former XL estimate is now represented by the bounded 3.2
authoring/acceptance tasks and 3.3 controlled-proof tasks that actually remain.

**The table is no longer the whole inventory.** Five nodes minted since D76 are sized in its unit
and were never in it — `{#dash-defaults}` L, `{#duo-lease}` S, `{#parallel-runs}` L,
`{#observed-logs}` M, plus the L-sized former test-tier close now distributed across
`{#workflow-authoring-core}`, the two workflow-acceptance tasks, `{#workflow-candidate-freeze}` and
`{#workflow-acceptance-close}`. That is the model being applied rather than a gap: a new
node gets a size because the notation asks for one. It is recorded here so a reader does not read
this table as a closed list.

**Delivery tiers — what may slip without invalidating the base.** The charter's numbered target
architecture is **items 1–27**, and every one of them is mandatory, with no articulated
reduced-scope fallback behind the program stop-loss (`05-cut-over.md` §Program stop-loss / abort
gate). These tiers give a paused or reassessed rebuild a defined shape:

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

_As built, the tiers were never used as a fallback — every item in all three shipped, and 2i closed
before Phase 3 began. Two things did leave Phase 2, and neither is a tier slip: the Workflow
Explorer's **EDIT** half was REASSIGNED by **D186** (the read-only half, which is what the LATER tier
names, shipped), and the production byte path was deferred by **D189**. Both carry named triggers in
`04-close-the-deferrals.md`, and the LATER tier's own rule — nothing in the write path depends on
these — is why deferring them cost no correctness._

**Already-ratified trims folded in (D79).** DSL graph-authoring mode — cut. Notification lifecycle —
read/unread + snooze, actor-keyed inbox, not a five-state lifecycle. Commands — keep `version` +
`actor` wire fields everywhere (multi-user seam, D75), enforce CAS only where a real race exists
(cancel-tree, edit-vs-resume, gate resolution, write-recovery). Capture crash-proofing — durable
sessions + one durable finalize outbox, not a restart-between-every-state matrix. Ledger hash-chain
— deferred until multi-user is real; the never-pruned ledger, atomic outbox, single projector, and
actor attribution all stay. Task authoring — a **lightweight tier** exists (**`ref:task-contract`
§2.7** owns the three tiers, and the tier is *derived* from effect + store kind, never
self-declared): a `workflow:` mini-store pure read needs schemas + example only; browser reads add
freshness/provenance/subject; commits pay full fare. A **`scaffold new-task` / `scaffold
new-workflow` generator** is part of the base — the declaration toil is only acceptable if it is
generated.

_As built: every trim above held, and the last sentence did not. The generators do not exist
(§Phase summary), so the lightweight tier is carrying the authoring cost on its own. D79's DSL cut
also outlived its own phase — **D186** reassigned the workflow editor's edit half on D79a's argument
one level down, and `{#deferred}`'s standing "never, by design" list still names DSL/codegen workflow
authoring._

## 0.3 · Redesign single-source runtime authority
<!-- roadmap: phase0-authority-reset -->

This is the reopened design part and the next-session starting point. It changes no runtime code.
Its job is to finish the contracts that 1.6 will implement: one SQLite-backed run-record service is
the lifecycle authority for queued, current, terminal, archived, and tombstoned runs; one catalog
and one protected `.tracker/settings/` root own operator-managed local configuration. Provider API
keys remain the sole `.env` class. Host observations such as D324's primary-display probe remain
catalogued defaults rather than being copied into a second persisted authority.

### Task 1 · Define the canonical run-record authority
<!-- roadmap: phase0-run-authority-design -->

- [x] Define stable run identity and typed create/read/update/delete, claim, retry, archive, relaunch,
  purge, and compare-and-swap transitions. — D330 §D330.1, §D330.3–§D330.5, §D330.7
- [x] Keep spans, logs, receipts, captures, and artifacts append-only evidence linked to the run;
  none may decide whether the run exists or what lifecycle state it occupies. — D330 §D330.2, §D330.9
- [x] Adopt D308's terminal-only physical deletion behind an insert-only tombstone; define queue
  ordering, first-eligible claim, evidence retention, and direct-table adapter boundaries. — D330 §D330.6, §D330.8, §D330.10–§D330.11
> 2026-09-04 | phase-0-3-authority-design C31da5310 R01 | Task 1 designed as D330 in ref dashboard-surfaces §D327; no runtime code changed (D326). Tasks 2–4 open.

### Task 2 · Define the canonical settings catalog and root
<!-- roadmap: phase0-settings-authority-design -->

- [x] Enumerate every leaf once with schema, default, editability, sensitivity, restart scope, and
  owning consumer. — D331 §D331.1 (the closed row schema and its pairing refusals), §D331.9 (the
  88-row catalog: 59 ordinary, 7 protected, 5 provider-key families, 1 derived host fact, 16 code-fixed)
- [x] Supersede D321's single-file layout with one protected `.tracker/settings/` directory while
  retaining its state-root/database-journal coupling; move username, password, timekeeper identity,
  local canary inputs, overrides, timeouts, paths, and worker defaults there. — D331 §D331.2
  (source classes), §D331.3 (the directory: 0700, one lock, two 0600 documents, prepare/rollback per
  target, backups copy the ordinary half only), §D331.4 (two SQLite singletons; "outlives its
  database" refuses per document), §D331.12 items 3–4
- [x] Keep only provider API keys in `.env`; preserve D324's host-derived display as a catalogued
  default; expose protected values through write-only inputs and presence/revision readback. — D331
  §D331.5 (`apply-settings` + `apply-protected-settings`, marked-envelope journal), §D331.6
  (`{present, valueId, updatedAt}` readback; never in Config, fingerprint, snapshot, token, wire,
  evidence, backup or child environment), §D331.7 (`generation`/`next-use`/`next-start`/`process`;
  protected revision is not a claim-token field), §D331.8 (`settings > default`; retired keys refuse
  by name; `.env` allowlist = provider families)
> 2026-09-04 | phase-0-3-authority-design C31da5310 R02 | Task 2 designed as D331 in ref clock-config-secrets §D327; no runtime code changed (D326). Tasks 3–4 open.

### Task 3 · Design migration, compatibility, and recovery
<!-- roadmap: phase0-authority-migration-design -->

- [x] Define an idempotent upgrade from existing SQLite rows, `settings.json` sidecars, `.env`
  leaves, and local canary inputs without copying provider API keys or erasing run evidence. — D332
  §D332.1 (`cli storage upgrade`, stopped system, never at boot), §D332.3 (prepare → one exclusive
  transaction → settle), §D332.5 (`upgradeId`, `already-upgraded`, the resume arms), §D332.7
  (evidence, snapshots, spans and archive digests byte-identical; ordinals backfilled with
  provenance), ref clock-config-secrets §D332 settings half (provider families classified by name,
  never read)
- [x] Require an explicit verified `cli storage backup` before the upgrade, then use a transactional
  migration journal and rollback; do not restore the automatic backup cadence retired by D322. —
  D332 §D332.2 step 10 (the newest verified manifest must re-verify and match the live generation;
  the command writes no backup), §D332.5 (`authority_upgrades`, one journal inside the database),
  §D332.4 (transactional vs operator rollback; the pre-upgrade backup plus `upgrades/<id>.rollback.json`);
  §2.5 items 3–4 carry dated notes and no cadence returns
- [x] Name temporary adapters, mixed-generation refusals, read-forward rules, and deletion tests. —
  D332 §D332.9 (policy and roster A0–A8 with expiry phases), ref guards-and-tests §5.2 (each
  deletion test and intended inventory entries), §D332.6 (the closed boot matrix), §D332.8
  (read-forward table), §D332.11 (24 proofs)
> 2026-09-04 | phase-0-3-authority-design C31da5310 R03 | Task 3 designed as D332 in ref dashboard-surfaces §2.5 (primary), ref clock-config-secrets §D332 (settings half) and ref guards-and-tests §5.2 (adapters); no runtime code changed (D326). Task 4 open.

### Task 4 · Close design and issue implementation briefs
<!-- roadmap: phase0-authority-design-close -->

- [ ] Adversarially review identity, concurrency, recovery, redaction, permissions, and migration.
- [ ] Land every decision in its owning reference contract and `reference/decisions.md` pointer.
- [ ] Bind each 1.6 task to one implementation seam and gate; prove 2.6 and 3.1 consume the contracts
  without redesigning them.

0.3 closes only when every checkbox above has durable evidence. The execution order after it is
**1.6 implementation → 2.6 downstream revalidation → reopened 3.1 dashboard completion**.

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
