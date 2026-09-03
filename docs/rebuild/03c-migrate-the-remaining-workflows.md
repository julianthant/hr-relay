# 03c · Phase 3c - finish workflow authoring and acceptance

This doc is the dedicated home of **Phase 3c**, tree node `{#migrations}`. It finishes the shared
workflow-authoring platform and proves it with the two workflows already admitted to Phase 3:
**Person Lookup** and **Separations**. It does not authorize or schedule another legacy workflow.
The old order 1-7 and 9 material later in this file is retained only as unverified candidate evidence
until it is extracted or deleted during Phase 3 close; it is not Phase 3 scope.

Phase 3 has three delivery parts: **3a** finished the shared dashboard, **3b** finishes Separations,
and **3c** finishes workflow authoring plus Person Lookup/Separations acceptance. The file named
`03d` is a separately triggered second-actor track, not another Phase 3 workflow. Contracts live in
`reference/`. This doc also hosts **§Testing tiers**, whose normative spec is
`reference/guards-and-tests.md`.

**Phase 3c has two internal gates, not two additional numbered phases.** **3c-A** builds and proves
the workflow-authoring platform. **3c-B** finishes Person Lookup/Separations acceptance, reconciles
their evidence, and closes Phase 3. It then stops. No other workflow implementation starts from this
doc. “Pantry and recipe” may explain the idea in
conversation, but the target API and plan use the domain terms **task store**, **task**, **workflow
definition**, **worker**, **browser session**, **compiled workflow**, and **workflow run** (D317).
The bounded compiler increment landed before D317 and still uses transitional `recipe` identifiers;
renaming that API and deleting the transitional files are explicit remaining 3c-A work, not a reason
to call the model complete.

## Phase summary
<!-- roadmap: migrations -->

<!-- roadmap-status: migrations -->
- [x] D84/D193 explain why Separations entered first; D319 supersedes their old promise of an already-scheduled remainder
- [x] Person Lookup is migrated and live-proven (D74, run `4ebf7275-0158-49af-a78f-1f37948efb27`); final compiled-workflow acceptance remains in 3c-B
- [x] D311/D317 ratify the workflow definition and compiler as the new authoring seam; person lookup and separations are its acceptance workflows; “recipe” is analogy only
- [x] D318 resolves read-only T1 evidence: a zero-transaction graph uses the distinct `live-read` arm, never a fake transaction or `dryRun=true`; implementation remains in 3c-A
- [x] 3c-A bounded compiler increment — compatibility fixtures, the transitional compiler, compiler-backed Person Lookup and Separations descriptors/modules, registry-wide generic projection conformance and full gates landed through merge `a40276b6`
- [x] pre-D319 intake — Person Lookup Search/Match and I-9 lookup evidence landed through merge `b1b36349`; Search/Match moved into Phase 3 acceptance and I-9 remains an unnumbered candidate
- [ ] `{#workflow-authoring-model}` — finish D312–D318: final workflow naming/API, direct entry algebra, omissions, recovery, `live-read`, four-artifact enforcement, author documentation, T1 proof and deletion of redundant authoring declarations
- [ ] 3c-A exit — author guide and agent rules landed, task reuse is discoverable, both acceptance conversions are green, and the old authoring path is deleted
- [ ] 3c-B exit — Person Lookup and Separations acceptance reconciled, Phase 3 authorities current, integrated gates green and Phase 3 worktree/task residue closed
- [x] D319 removes every not-yet-admitted workflow from Phase 3 implementation scope; old order labels are candidate evidence only
- [ ] `{#workflow-admission}` — after Phase 3, verify one candidate's complete admission packet with the operator before creating Phase 4
- [ ] the legacy capability register — **46 open · 19 replaced · 6 native · 7 retired** of 78 (recounted from `config/legacy-capabilities.json`, 2026-09-02); open entries remain backlog obligations, not Phase 3 completion criteria
- [x] generic workflow-to-dashboard conformance for the two transitional compiler-backed workflows; the same registry-wide suite must admit each later migration
- [ ] the T1 proof for each admitted workflow, plus T2/T3 only when that admitted phase introduces a new dashboard behavior
- [x] R1 compiler and R2 intake worktrees/branches were removed after verified integration; no Phase 3c worker residue remains from those runs
- [ ] R3 and R4 close with the full worktree sweep: verify integration/gates, remove registered and physical worktrees, delete local branches and archive only exact recorded tasks
> 2026-08-20 | docs-cohesion 03c | verified against `src/control/workflow-registry.ts:38-47`, `src/workflows/*/descriptor.ts` (8 files), `src/stores/*` and `config/legacy-capabilities.json` (recount 47/20/7/4 matches the tree's note); left: every order after 0, minus 8
> 2026-08-25 | D266 | the test-only Kuali annotation workflow retired; the registry now holds seven modules and the Kuali finalization T1 pair carries its reusable proof shape
> 2026-09-02 | D317 execution plan | 3c split internally into blocking 3c-A authoring-platform proof and a later migration batch; D319 supersedes only that later-batch assignment
> 2026-09-02 | baseline `b1b36349` verification | bounded D311 compiler and candidate intake are integrated; D312–D318 final authoring/runtime acceptance remains; R1/R2 owned worktrees are closed
> 2026-09-02 | D319 | Phase 3 now stops after Person Lookup/Separations acceptance; every other workflow requires admission verification and operator approval before receiving the next phase number
<!-- /roadmap-status -->

**Phase 3c is the end of Phase 3, not the rest of the migration program.** Phase 3a built the
dashboard every workflow inherits, 3b takes Separations through the safety loop, and 3c builds one
workflow-definition/compiler seam so Person Lookup and Separations can prove the complete authoring
model. Phase 3 then closes. Later workflow phases are created one at a time through D319 admission.

**What it reads as met before it starts.** From **03a**: the generic surfaces — run modal, queue
row, run detail + timeline, gate ceremony, notifications, archive · activity · explorer, intake and
capture — exist and answer for a workflow they were not written for (Track C proved that once
against a real composed run). D311 makes them compiler projections; a migration builds one only when
it introduces a new capability. From **03b**: the store
task libraries the entry was chosen to force into existence (`ucpath` 12 tasks, `kuali` 6,
`new-kronos` 2, `crm` 2, `separations` 9 service tasks), the ALWAYS-GATE identity approval, the
typed start door (D250/D251/D261), and the behavior the D311 compiler must preserve.

**The honest state at verified implementation baseline `b1b36349`.** The two Phase 3 acceptance
workflows exist, but neither has completed the final D312-D318 conversion and acceptance.
`src/control/workflow-registry.ts` still registers seven modules: `person-lookup` (order 0) and the
six separations composition/harness modules (order 8, doc 03b). The new registry-derived compiled
population contains two workflows, Person Lookup and Separations. Their descriptors/modules now
come through `src/base/workflow-recipe.ts`, and equivalence plus generic start/timeline/Explorer
conformance are green. That is the completed bounded D311 increment—not the D312–D318 exit state:
the code still exposes `defineWorkflowRecipe`/`compileWorkflowRecipe`, consumes fragment adapters,
retains authored descriptor/module files, implements neither direct `parallel`/`delegate` entries
nor D313/D314 omission/restart behavior, and has no workflow-authoring guide.

> 2026-09-02 | 3c-A R3/R3c | Superseded as a description of the tree: `src/base/workflow-definition.ts`
> carries the D317 names and the direct entry algebra (R3); every registered workflow authors exactly
> one `workflow.ts`, the per-step `node-ids`/`nodes`/`step`/`omission` files, the last hand-authored
> `descriptor.ts`/`module.ts` pair (`separations-identity-check`) and the flow node-fragment API are
> deleted, and the registry/Explorer/`workflow-layout` "not yet converted" arm is retired (R3c). The
> paragraph stays as the recorded baseline; the guide is still unwritten (R3d).

The earlier Order 1 intake and live I-9 evidence are integrated, but they do not admit I-9 Lookup or
authorize runtime work. **The old order 1, 2, 3, 4, 5, 6, 7 and 9 labels remain unverified candidate
leads.**
`config/pending-impl-bindings.json` remains the checked-in empty set, so no candidate is half-bound.
D266 retired the former D135 proof workflow into the Kuali finalization T1 pair rather than treating
testing machinery as an order row.

**The rule every future admitted phase inherits.** A migration is not done when its workflow runs. It carries
its **T1 behavior proof**: a structural fixture scenario and T1b live manifest, plus controlled
evidence for every write. The workflow compiler supplies already-built generic dashboard surfaces and
the registry-wide conformance suite proves that mapping. A workflow owns a separate dashboard
feature task and T2/T3 proof only when it introduces a genuinely new interaction or wire arm
(`ref guards-and-tests` §10.11/§10.12; `ref frontend-backend-integration` §6.8).

## Workflow authoring model - Phase 3 acceptance foundation

<!-- roadmap: workflow-authoring-model -->

<!-- roadmap-status: workflow-authoring-model -->
- [x] DOCS D311 ratified in `ref workflow-model` §1.6, with the dashboard, Explorer and test consequences in their owning references
- [x] DOCS D312–D316 ratify the four-artifact budget, complete pre-start omissions, two recovery choices, explicit workflow-entry algebra and deletion acceptance
- [x] DOCS D317 reserves `workflow` for the authored model: `workflow.ts` + `defineWorkflow` + `WorkflowDefinition`; “recipe” remains analogy only
- [x] PROOF freeze Person Lookup and Separations compatibility targets in red-capable equivalence fixtures (`2e563240`, merged by `6d30d75a`)
- [x] BE land the bounded transitional compiler: tuple groups, typed task references, duplicate/unresolved/cycle refusals, descriptor/module/store/build-manifest derivation and no second runtime (`ebfde1c6`)
- [x] BE route Person Lookup and Separations through that transitional compiler while preserving their existing public descriptor/module behavior (`ebfde1c6`, `d4204106`)
- [x] PROOF derive the compiler-backed registry population and prove current bootstrap/run modal, timeline/detail and Explorer projections for both workflows (`246daab2`, `4555341f`)
- [x] BE make the existing task-store catalog sufficient to find a task by system, capability, effect, inputs and outputs before an author creates one (R3 `acd7ed1b` — `npm run stores:catalog` generates `ref stores` §2 with store kind/browser system, Effect, Verb, Session, Capability, Inputs, Outputs, Freshness and Status per contract; `npm run stores:catalog:check` current)
- [x] BE replace the transitional `workflow-recipe.ts`/`defineWorkflowRecipe`/`compileWorkflowRecipe` names with D317's `workflow.ts`/`defineWorkflow`/`compileWorkflow`/`WorkflowDefinition`/`CompiledWorkflow`; do not leave aliases or a second authoring seam (R3 `8a931cc6`; the fragment API and every per-step declaration file deleted in R3c)
- [x] PROOF enforce the exact four authored artifacts for a reuse-only workflow; reject descriptor/module/registry/dashboard glue outside `workflow.ts` (R3c `db7bbd5c`, `44f74d54` — the `workflow-authoring-budget` guard + inventory entry: four arms, 24 violating fixtures with positive controls, closed decision-cited allowlists)
- [x] BE replace fragment adapters with the closed direct `task | parallel | delegate | gate | transaction` entry algebra, including stable entry/leaf ids, explicit parallel join/failure policy and independent leaf retry (R3 `51ec6253`, `2527c149` — every kind proved to compile, project and retry a failed parallel leaf alone; the fragment adapters themselves deleted in R3c `06eb7494`)
- [x] BE finish derivation of store/session requirements, graph/result, registry/build-manifest and all generic surfaces from the final workflow definition; retain the already-green transitional derivations as compatibility proof (R3 `8a931cc6` D317 seam + `51ec6253`, `2527c149` entries→runtime nodes; R3c `ab04231c` serializes every public identifier of all seven registered workflows — node graph, timeline, projections, module role/stores/intake — byte-identical before/after except the manifest fingerprint and the one stated `separations-identity-check` timeline change; R1's `tests/unit/workflow-definition-equivalence.test.ts` unmodified and green)
- [ ] PROOF pin automatic runtime inheritance—worker/session acquisition, authentication, checkpoints, semantic logs, screenshots, receipts, notifications and Archive—without workflow-specific glue
- [x] BOTH finish Person Lookup as the smallest four-artifact equivalence proof: final API/file, no authored descriptor/module path and its missing canonical T1 structural/live pair (R3c `ab04231c`; four-artifact inventory at `db7bbd5c` shows nothing beyond the four; T1b `live-read` **met** on a fresh isolated root — result `66ea3863-2951-4ad9-92b7-4e444eff4959`, run `3bf3d260…`, attempt 1, 0/0/0 write-authority deltas)
- [x] BOTH finish Separations as the completeness proof: final API/file, direct entries, no redundant descriptor/module/node-fragment authoring path, and preserved gates, screenshots, logs, write safety and public wire (R3c `ab04231c` — every step identity folded into `src/workflows/separations/workflow.ts`, the five harnesses import them, `separations-identity-check` converted, 22 files / 657 lines deleted, public equivalence per identifier green)
- [x] BOTH make the run modal the complete omission authority: whole-step skip, all custom values schema-valid before start, no mid-run value request, separate mandatory verifiers remain selected (D313; R3 u17 `b35572cf`, `df40ce18` — definition/plan/executor admission with the refusal + provenance matrix)
- [x] BOTH expose Resume from checkpoints and Restart from start; fresh restart reruns reads/computes but never re-executes a completed write (D314; R3 u18 `7dd401bb`…`46606feb` — kernel/executor/sequencer mutation proofs; queued-span `recovery` projection proved red by `f3079fb1`)
- [x] BOTH project the current tuple groups through the existing run modal/timeline/detail and Explorer paths; re-run this conformance after the final D317 conversion
- [x] PROOF extend the landed registry-wide conformance suite to every direct entry kind, then remove superseded declarations and only genuinely duplicate generic-dashboard tests (R3 `51ec6253`, `2527c149`; superseded declarations removed across R3c `06eb7494`, `6db1766e`, `877894cf`, `ab04231c`, with the equivalence/grouping proofs green at `ab04231c` — 11 files / 108 tests, fixtures unmodified)
- [x] DOCS write `docs/guides/workflow-authoring.md`, add the concise authoring rules to the paired root `AGENTS.md`/`CLAUDE.md`, and add one internal agent reference that points to the guide rather than redefining it (R3d `9ec2e269` guide, `b61d12c6` root twins, `eec628aa` agent reference)
- [ ] PROOF follow the finished author guide to author both acceptance workflows; any undocumented step or required legacy escape hatch fails 3c-A
- [x] BE implement D318's exclusive T1b result/admission arms: `dry-run-preview` for transaction-bearing graphs and `live-read` for zero-transaction graphs, with graph refusal and exact zero write-authority deltas (R3 u18 `7dd401bb`…`46606feb`; explicit arm-switch refusals `766632db`, `1823608a`; exercised by Person Lookup's **met** `live-read` result `66ea3863…` and Separations' typed `blocked`/`not-started` arm `c36b2b6b…`)
- [x] DOCS re-scope each remaining `Dashboard · wire` row to the capability delta that order actually introduces; generic rows inherit compiler conformance
> 2026-09-02 | D311 bounded implementation | `a40276b6` integrates compatibility fixtures, a transitional compiler, two descriptor/module conversions and generic conformance; R1's report explicitly carries D312–D318 completion into the next run
> 2026-09-02 | remaining 3c-A | task discovery, D317 rename/final API, direct entry algebra, four-artifact guard, D313 omission, D314 recovery, D318 `live-read`, final acceptance deletion/T1 and author docs remain open
> 2026-09-02 | R3d docs package | R3/R3b/R3c/R3d closed every 3c-A box above except two: `PROOF pin automatic runtime inheritance` (no report names a test or commit that pins worker/session acquisition, authentication, checkpoints, logs, screenshots, receipts, notifications and Archive as inherited without per-workflow glue) and `PROOF follow the finished author guide` (the guide landed at `9ec2e269`; the clean-context follow-through is the next unit). `ref workflow-model` §1.6/§1.1/§1.2.2/§5.6.1/§5.8, `ref stores` §1/§2/§2b/§3 and `docs/migrations/person-lookup.md` reconciled to the as-built tree in this run
<!-- /roadmap-status -->

The implementation order is deliberate: pin the current public descriptor/module/wire behavior;
add the compiler behind that seam; convert person lookup; convert separations; expose the same tuple
projection in Explorer; then delete the old authoring path before migrating another workflow. The
deletion step is an acceptance criterion, because a convenience layer that leaves every old file
mandatory would make setup harder, not easier.

The alternatives rejected by D311 are (A) leave the current setup process and improve its docs,
which does not remove duplicate declarations, and (B) replace the executor with a selector-script
engine, which discards proven gates, receipts, replay and write safety to solve an authoring problem.
The selected path keeps the current dashboard and worker behavior and changes where workflow authors
express it.

D312–D317 make “simpler” measurable. A reuse-only workflow authors exactly its `workflow.ts`, structural
scenario, dry-run declaration and migration record. Workflow entries explicitly say task, parallel,
delegate, gate or transaction; the compiler may infer data dependencies but not those control
semantics. Every omission and all replacement values are settled in the run modal before start.
After failure, the operator may resume from checkpoints or restart reads/computations from the root;
neither path may execute a completed external write again. The design is accepted only when Person
Lookup and Separations preserve their current public behavior and the superseded authoring path is
deleted. D317 removes “recipe” as a technical layer: the authored value is a workflow definition,
the generated value is a compiled workflow, and a worker executes one workflow run.

### 3c-A authoring model — what each thing owns

The authoring model is intentionally smaller than the runtime. The analogy discussed with the
operator is useful for orientation, but these are the exact technical boundaries an implementation
and its documentation must teach:

| Concept | Owns | Does not own |
|---|---|---|
| **Task store** | reusable tasks for one system/service/domain; task discovery by capability and contract | workflow order, dashboard layout, or one workflow's private orchestration |
| **Task** | one typed operation: strict input/output, effect, errors, retry/provenance policy and implementation binding | timeline placement, another task's input, worker lifecycle, or generic evidence plumbing |
| **Workflow definition** | identity, typed input/result, ordered `[timeline group, tasks[]]` tuples, explicit control entries, run options and omission value schemas | hand-written descriptor/module/registry projections, browser login, checkpoints, screenshots or Archive |
| **Workflow compiler** | validates the definition and derives the executable graph plus every generic runtime/dashboard projection | browser behavior or a second execution engine |
| **Worker** | claims a run and executes its compiled workflow through authority | defining the workflow or sharing mutable data with another worker |
| **Browser session** | one authenticated system connection acquired for a task under the worker/session policy | deciding workflow order or acting as the worker itself |
| **Workflow run** | one admitted execution, its immutable options, lineage, checkpoints, evidence and terminal result | changing its input or omission bundle during execution |

The author sees task stores and the workflow definition. The compiler and runtime own the machinery
below that boundary. If a normal workflow author must understand or edit a generated descriptor,
module, node fragment, registry row, dashboard adapter, checkpoint writer, screenshot hook or
session bootstrap, 3c-A has failed even if the workflow runs.

### 3c-A reuse decision — choose the smallest truthful path

An author searches the task-store catalog before creating code, then classifies each needed
operation through this table. “Similar” is not permission to copy a task: the system interaction and
output contract determine whether reuse is honest.

| Need | Author action | Additional proof |
|---|---|---|
| Existing operation, same contract | import the exact task into `workflow.ts` | none beyond this workflow's T1 pair |
| Existing operation with an already-declared option | pass the typed option from the workflow definition | option behavior is already task-owned |
| Same browser operation, legitimate new variant, same output meaning | extend the shared task with a typed option; update that task's tests once | task contract/implementation proof plus affected workflow T1 |
| Pure workflow-specific calculation | add or reuse a pure task in the workflow mini-store | pure task tests plus workflow T1 |
| New page operation or different output meaning | add one reusable task contract and driver operation to the owning task store | contract/driver tests and live selector verification |
| New external write | add an explicit `transaction(...)` backed by prepare/probe/commit/verify | full controlled-write evidence; dry run alone is insufficient |
| New dashboard interaction or wire arm | extend the generic capability once | one T2/T3 proof; later workflows inherit it |

The reuse-only fast path has exactly four workflow-specific artifacts: `workflow.ts`, the structural
scenario, the dry-run declaration and the migration record. New shared capability files are allowed
only for a row above that genuinely requires them; they never smuggle the retired workflow assembly
back under another name.

### 3c-A change routing — one reason, one owner

This table is the maintenance promise the conversion must prove. It tells the next session where a
future fix belongs before that session opens the tree.

| Change | One primary owner |
|---|---|
| reorder or rename timeline groups | `src/workflows/<id>/workflow.ts` |
| add/change a run option or omission form | `src/workflows/<id>/workflow.ts` |
| connect one task's output to another task's input | `src/workflows/<id>/workflow.ts` |
| change a selector or page-state interpretation | the owning system driver/UI registry |
| change one operation's input/output/effect | the owning task contract + implementation and its direct consumers |
| add shared authentication behavior | the owning session provider/login declaration |
| change retry/checkpoint execution mechanics | the shared executor/recovery services |
| change logs, screenshots, receipts, Archive or generic dashboard rendering | the shared runtime/projection surface |
| change only workflow grouping/options | **no file besides `workflow.ts`** |

### 3c-A implementation run — verified progress and remaining order

A fresh session does not repeat the bounded compiler work. It starts at the first unfinished part
of unit 2, preserves the green evidence from units 1/3/4, and closes each remaining unit with its
named proof before moving to 3c-B. These are implementation units, not invitations to redesign the
runtime.

1. **DONE — Freeze the compatibility targets.** Person Lookup and Separations' current public
   descriptor, module requirements, run-modal wire, graph, timeline/detail, Explorer, receipt and
   result behavior are captured by red-capable fixtures. Evidence: `2e563240`, merged in
   `6d30d75a`.
2. **DONE — Finish the authored types and terminology.** The D317 names, the direct explicit
   `parallel`, `delegate`, `gate` and `transaction` entries and their by-name refusals landed in R3
   (`8a931cc6`, `51ec6253`, `2527c149`); R3c removed fragment-adapter authoring entirely — the flow
   node-fragment API, every per-step `node-ids`/`nodes`/`step`/`omission` file and the last
   hand-authored descriptor/module pair are deleted, and every registered workflow authors one
   `workflow.ts`. No old alias remains.
3. **DONE, REVERIFY AFTER UNIT 2 — Build the compiler core.** The transitional compiler derives
   graph nodes/edges, result dependencies,
   required task stores/sessions, descriptor compatibility output, registry value and build-manifest
   closure without a second runtime. Evidence: `ebfde1c6`; final gate reruns after unit 2 removes the
   transitional seam.
4. **DONE, REVERIFY AFTER UNIT 2 — Build generic projections.** The current tuple groups reach
   bootstrap/start, run modal, timeline/detail and Explorer through one registry-derived conformance
   suite. Evidence: `246daab2` and `4555341f`; extend it to every final direct entry kind.
5. **DONE (D313; R3 u17 `b35572cf`, `df40ce18`) — Finish omission admission.** A whole omitted timeline group executes no entry; its complete
   replacement values are schema-valid before start; no worker asks for values mid-run; any
   mandatory verifier is a separate selected entry. Gate: D313's refusal and provenance matrix.
6. **DONE (D314; R3 u18 `7dd401bb`…`46606feb`, queued-span `recovery` red-proof `f3079fb1`) — Finish recovery choices.** Expose Resume from checkpoints and Restart from start. Root restart
   reruns reads/computations, reuses validated completed-write proof without prepare/commit, probes
   unfinished writes first and refuses a fresh-fact mismatch. Gate: mutation proof that a completed
   external write cannot execute twice.
7. **DONE (R3c `ab04231c`; four-artifact inventory `db7bbd5c`; T1b `live-read` met, result
   `66ea3863-2951-4ad9-92b7-4e444eff4959`, run `3bf3d260…`, 0/0/0) — Finish Person Lookup.**
   Authorship is the final `src/workflows/person-lookup/workflow.ts`; no authored descriptor/module
   glue remains; the canonical T1 structural/live pair exists and the four-artifact budget is
   guard-enforced.
8. **DONE (R3c `ab04231c`) — Finish Separations.** The complete timeline, D313 omissions, conditional
   gate, transactions, screenshots/logs and result are expressed through one `workflow.ts` that also
   authors every step identity the five harnesses import; public equivalence is stated per identifier
   and green. This conversion does NOT discharge Phase 3b's still-open controlled writes.
9. **DONE (R3c `06eb7494`, `6db1766e`, `877894cf`, `ab04231c`; guard `db7bbd5c`, `44f74d54`) — Delete
   the old authoring path.** The remaining authored descriptors, modules, fragment adapters,
   transitional registry wiring and duplicate generic-dashboard tests are gone (22 files / 657 lines),
   and the `workflow-authoring-budget` guard fails if the retired path or an “advanced escape hatch”
   returns.
10. **PARTIAL — Prove the author experience.** The grouping/options-only fixture proof is DONE
    (R3 `e2cfdc39`, re-run green at R3c `ab04231c` — `workflow-definition-mutation-proof`: one
    grouping/options-only change in `workflow.ts` compiles and no other authored workflow file
    changes). REMAINS: follow the finished author guide (`9ec2e269`) from a clean context for both
    acceptance workflows; any undocumented required step is a defect.
11. **OPEN FOR R3, R4 AND EACH LATER ADMITTED PHASE — Close the worktree lifecycle.** After verified integration and the
    integrated gate, run the worktree sweep: remove each registered and physical run/worker
    worktree, prune, delete its local feature branch, archive only the exact recorded task, and
    record any residue. R1 and R2 already passed this close; every later run and the final phase must
    pass it independently.

**Next runnable supervisor scope (3c-A finish).** Items (1)–(6) of the previous scope are LANDED by
R3/R3b (task-store catalog, D317 final names/API, direct entry algebra, D313 omission admission, D314
recovery, D318 `live-read`), R3c (four-artifact boundary guard, deletion acceptance, Person Lookup and
Separations T1/equivalence) and R3d (the author guide, the root twins, the agent reference and this
reference reconciliation) — each with the evidence cited in the checklist above. What REMAINS to close
3c-A is exactly two things: (a) the clean-context proof that following `docs/guides/workflow-authoring.md`
authors both acceptance workflows with no undocumented step and no escape hatch, together with the still-open
`PROOF pin automatic runtime inheritance` box; and (b) the integrated sweep — manifest, typecheck, lint,
coverage, architecture, parity and the workflow proofs on the integration branch, then the exact worktree
lifecycle close of item 11. Do not start a third workflow inside this run.

**Worktree-capacity preflight.** The 2026-09-02 read-only audit found the Phase 3c R1/R2 branches and
worktrees closed, but eight registered auxiliary `feature/test-*` worktrees owned by the separate
test-suite-rationalization program still occupy the shared repository. One currently carries an
untracked `node_modules`. They are not Phase 3c cleanup targets and must not be removed or
repurposed. Before dispatching writable 3c-A workers, re-audit the shared worktree budget and wait
for that owning program to close enough slots; a coordinator may continue read-only planning while
capacity is unavailable.

### 3c-A documentation package — required before future admitted workflow work

The implementation is not ready for other agents merely because the compiler passes. It must leave
one canonical practical path:

| Document | Required content and authority |
|---|---|
| `ref workflow-model` §1.6 | normative types, compiler products, invariants and refusal behavior |
| `docs/guides/workflow-authoring.md` | practical guide: find/reuse/build decision, complete API examples, omissions, parallel/delegate/gate/transaction examples, testing and debugging |
| paired root `AGENTS.md` / `CLAUDE.md` | concise mandatory rules and a pointer to the practical guide; no duplicated tutorial |
| `.agents/skill-library/workflow-authoring/REFERENCE.md` | internal agent checklist that points to the canonical guide/spec; no new operator command and no independent policy |
| generated task-store catalog (`ref stores`) | discoverable tasks with system, capability, effect, input/output and implementation status |

The guide must contain a minimal Person Lookup example, a complete Separations excerpt, a
reuse-only example, a new-task example and a “what file do I change?” table matching the routing
table above. It must state what the compiler/runtime generate automatically and what an author must
never hand-maintain.

### 3c-A exit gate - when acceptance may close

3c-B remains blocked until all of the following are true together: the compiler and generic
projections are built; omission and both recovery choices are built; Person Lookup and Separations
are equivalent; their redundant authoring declarations are deleted; the four-artifact guard is
green; the practical guide and agent pointers are landed; and the integrated typecheck, lint,
coverage, architecture, parity and both workflow T1b proofs are green. Passing unit tests
while retaining a second authoring path does not close 3c-A. The run closes only after its integrated
worktree sweep proves no 3c-A worktree, local feature branch or exact task residue remains.

**D320 (operator answer 2026-09-03): keep the strict T1b gate.** Separations must record a fresh
`met` result against a newly vetted closed Kuali document; its existing typed
`blocked/not-started` result does not satisfy this exit. The operator selected this path but did not
identify the replacement document in the answer, so the target remains an outstanding input and no
substitute may be inferred.

## 3c-B · Accept Person Lookup and Separations, then close Phase 3

3c-B does not start before 3c-A and does not start a third workflow. D320 records the operator's
2026-09-03 authorization to start it as soon as every 3c-A exit condition is green; no second start
approval is required. It reconciles the final 3c-A proof with Person Lookup's
migration record and the as-built Separations authority in doc 03b, confirms that the generic
dashboard and Explorer projections describe both compiled workflows, runs the integrated gates,
updates the canonical Phase 3 status, performs the exact worktree/task sweep and stops. Unfinished
controlled-live Separations proof remains owned by doc 03b; 3c-A uses Separations as a compiler
acceptance case and does not convert that structural proof into a completed external-write claim.

The earlier coordinator's R4-R12 workflow implementation rows are withdrawn by D319. They were
never dispatched and confer no implementation authority. The Order 1 intake remains useful evidence:
its Person Lookup facts may support 3c-B, while its I-9 material returns to the admission backlog.

## Workflow admission after Phase 3

<!-- roadmap: workflow-admission -->

After Phase 3 closes, the operator selects one candidate for admission verification. No candidate
has a reserved position, assumed boundary or phase number. Its admission packet must verify the
current legacy and live behavior, then propose the exact workflow definition required by
`ref workflow-model` §1.6.2:

- operator-visible outcome and workflow boundary;
- run-modal inputs, omissions and required replacement values;
- ordered `[(timeline group, [entries])]` structure and explicit entry kinds;
- task-store reuse, customization and new tasks;
- systems, page states, selectors, reads, writes and gates;
- screenshots, semantic logs, returned values, receipts and Archive evidence;
- checkpoint/restart behavior and no-repeat-write obligations; and
- structural/live proof plus an approved controlled-commit target for each write.

The operator reviews that packet. Approval creates the next numbered phase and its phase doc,
migration doc and coordinator plan. Rejection or missing evidence leaves the candidate unnumbered.
Only the approved workflow or explicitly approved workflow family enters that phase. Shared task-store
or dashboard work belongs there only when it is the first verified consumer.

## The seven-step migration playbook

This is the safety loop an agent follows only after D319 admission creates a numbered workflow phase.
Separations
ran its pre-D311 form; the business and safety obligations remain, while workflow compilation replaces
the manual descriptor/module/dashboard assembly described by the older wording. Steps run in order;
each names the artefact it produces and the gate that proves it. A red gate is not passed with a note.

**1 · Record only the workflow-specific decisions before code.** Create
`docs/migrations/<workflow>.md` and use the §b questionnaire as a completeness checklist. Cite
inherited platform answers instead of copying or re-asking them; record only this workflow's facts,
deltas, real operator choices and unresolved `you:` lines. `docs/migrations/separations.md` remains
the worked full-risk example, not the minimum prose every read workflow must reproduce.
**Artefact:** the migration doc's decision/delta section. **Gate:** every real unresolved choice is
named; settled generic policy is referenced, not reopened.

**2 · Author the workflow.** Reuse store tasks peer-to-peer (charter §1); add new ones as reusable bases and
name the workflow-specific customization (charter §3/§8); reuse or add canonical UI ids and typed
driver operations FIRST, then write strict contracts → scenarios → impls → pure-logic unit tests
(`fakeCtx`) → descriptor/result/delegation policies, in `ref guards-and-tests` §6's red→green order.
Classify every task REUSE / CUSTOMIZE / BUILD against ref stores before writing one — the store
catalog is the reuse ledger, and a task that already exists under another name is the single
cheapest thing to get wrong. **Layout (D265, `ref workflow-model` §1.2.2):** a rail workflow is a
top-level folder `src/workflows/<id>/`; child step folders remain organization/audit homes for any
genuinely step-specific implementation or chunk harness, but D311/D312 make them neither timeline
order nor mandatory node-fragment glue. There is no `src/workflows/proving/`. The `workflow-layout`
guard pins any files that do exist to their declared roles. Author one ordered array of
`[timeline group, tasks[]]` tuples; typed task input references derive execution dependencies, and
the compiler derives the descriptor, module requirements, registry value and generic dashboard
projections. **Artefacts:** `src/workflows/<id>/workflow.ts` plus any genuinely new
`src/stores/<system>/tasks/*.ts`; a contract
no store implements yet goes into `config/pending-impl-bindings.json` in the SAME commit (D107,
checked both directions). **Gate:** `npm run build:manifest` then `descriptor-coverage`.

**3 · The guards fire.** Strict boundary schemas, the task/driver boundary, scenario coverage,
transaction pairing, subject-before-fence, dry-run-commit-free, write safety + mutation capability,
permanent-key dedupe, command/delegation, provenance, graph/result typing, evidence, stable
identity. **Gate:** `npm run typecheck && npm run lint && npm run test:coverage` (D191 — the
per-commit gate; `test:coverage` is a strict superset of the old `test` + `test:architecture` pair).
`ref guards-and-tests` §9 is the worked example of adding one submit-bearing workflow through this
guard set.

**4 · Live selector re-verification, then the T1b live run.** Live access is pre-authorized and
always available (CLAUDE.md's standing authorization) — never ask. Legacy change accounting is
RETIRED (D150): the protection against a stale ported selector is re-verifying it against the LIVE
page at this migration, not diffing legacy's copy. Then run the workflow against every real system
it touches through D318's graph-derived T1b arm: a transaction-bearing graph uses
`dry-run-preview` with `dryRun=true`; a zero-transaction graph uses `live-read` with
`dryRun=false`. Both prove exact zero deltas in `write_intents`, `write_attempts` and
`durable_outbox`; a no-op transaction is forbidden. Write the live proof down as a scenario rather
than typing it again: `tests/scenario/workflows/<id>/dry-run.scenario.ts` is the T1b checkpoint manifest
(`ref guards-and-tests` §10.4) — nodes reached and nodes excluded, the `run_checkpoints` rows keyed
`(workflow, item, node, attempt, claimGeneration?)` (D214/D221), the `gate_results` row if it gates,
`write_intents` / `write_attempts` / `durable_outbox` deltas of **zero**, the receipt shape, the
arm-specific terminal/result. Register its canary subjects by LABEL in `config/test-subjects.json`
(`ref guards-and-tests` §10.5) — sensitive values stay in `.env` behind `src/domain/secrets.ts`, and
a missing subject reports `blocked: needs <label>`, never `failed`, because a canary decays
(separations §9.16: doc 4524's action was completed between two passes and the read that made it a
candidate stopped working). **Gate:** the T1b live case green, its manifest committed, its result recorded.

**5 · The controlled-commit proof — write workflows only.** Exercise each new commit / probe /
verify against a configured test instance or a deliberately harmless, operator-approved canary,
under `ref write-safety` §3.2's contract: dry-run preview with zero write-authority deltas, a forced subject mismatch
refused with zero fence and zero click, ONE controlled commit whose proof is a reload read-back plus
the outbox rows plus the terminal span, and an idempotent re-run answering `already-present` with no
browser. **If no safe target exists, rebuild-ready is BLOCKED** — dry run alone cannot prove
landing, recovery or dedupe, and converting a green dry run into a write-safety claim is the one
substitution this program forbids. The §b questionnaire recorded the target, the cleanup /
reversibility, the expected proof and the stop condition before this step ran. **Gate:** the
recorded proof in the migration doc, with the real document / transaction ids and the restore.

**6 · Mark rebuild-ready — do NOT go live (D89).** Record the workflow's native evidence and its
capability closure; leave production routing on legacy `src`. There is no workflow-scoped flip, no
legacy proxy, no engine generation and no mixed-engine production: all workflows switch together at
the single cutover gate (doc 05). **Artefacts:** the order node's `builds:` squares ticked with
commits cited; the affected `config/legacy-capabilities.json` entries advanced from `open` to
`native` / `replaced` / `retired` **with evidence** (a wrong `native` is worse than an honest
`open` — D184). **Gate:** `legacy-capability-disposition`.

**7 · Prove the generic projection, add only real UI deltas, then close the loop.** The workflow must
pass registry-wide start/run-modal, queue, timeline/detail, gate, archive/activity, notifications and
Explorer conformance. There is no `Dashboard · wire <workflow>` implementation task for a workflow
that uses those surfaces as already defined. If this workflow introduces a new interaction or wire
arm, extend the generic surface once and add its T2/T3 scenario; later workflows inherit it. Then
close out: any failure discovered becomes a
regression scenario plus a structured knowledge/fix record (stale knowledge is SUPERSEDED, never
appended beside the correction); the status blocks in this doc are ticked with commits cited; a
`log:` line lands on the tree node; the dated line goes into `docs/migrations/<workflow>.md` — and
that line, not a green suite, is what a `PROOF` tick on the tree is allowed to cite
(`ref guards-and-tests` §10.6). Update the nearest `CLAUDE.md` and the owning reference doc.
Finally run the exact worktree sweep for this migration: independently verify its branch/commits and
integrated gate, remove the registered and physical worktree, prune, delete the integrated local
feature branch, archive the exact recorded Codex task when applicable, and record any residue. A
merge without this cleanup is not a closed order row.

## Unverified candidate evidence - not a phase order

_Historical design input from the dissolved master plan's §3.3. D319 retires this table as build
order. Its labels and dependency theories are leads to verify, not approved workflow boundaries,
phase assignments or authorization to implement. Its order-8 prerequisite block lives in
`00-design-the-foundation.md` §ALWAYS-GATE identity approval, because D77 pulled that design into
Phase 0. Each future admission may reuse, correct, split or reject this evidence._

**The former ordering objective, made explicit (D84, amended by D88/D89).** Production availability does
not vary by migration order because legacy automation remains authoritative until one final
cutover. The order optimizes **total rebuild delivery time** by maximizing reuse leverage—each
migration must make the next cheaper — which is what the risk-ordered sequence below already does
(reads populate the stores every later workflow draws from; the OCR service pipeline unblocks four
consumers; the write-heavy workflows land last on top of everything).

**The trade the historical proposal made.** Onboarding and Separations migrated last (orders 8-9).
That is deliberate: they are the highest-stakes writes, they reuse the most, and doing
them early would mean proving the write-safety contract on the two workflows least able to absorb
a contract flaw. The existing workflows continue serving production while this sequence runs, and
the separations identity-approval gate (doc
ref write-safety §14) is designed in Phase 0 rather than at order 8, so nothing about that workflow is
discovered late. If a dependency or evidence target becomes the binding constraint, this order is
the thing to revisit.

**Read this table only as candidate evidence.** The operator entered Phase 3 at
**order 8, separations** — see §3.1's entry block for the store-population reasoning. The table is
deliberately **not** re-sequenced: it is the risk-proof ordering and its argument above still holds,
so the entry buys the deepest proof first rather than making it cheaper. Nothing here is waived —
Separations owes every §3.2 criterion. D319 supersedes the claim that remaining candidates keep this
relative sequence. The next candidate is chosen by the operator and verified before promotion.

Read-only and simple first (populate the read stores, low blast radius); OCR/approval flows next
(exercise the completion union + gates); write-heavy last (the write-safety contract's real test),
with the two **incident** workflows (onboarding duplicate-person, separations wrong-person) dead
last as the highest-stakes proofs.

| Historical order | Candidate label(s) | Suspected class | Evidence lead to verify |
|---|---|---|---|
| 0 | **person-lookup** | read | Phase 1 spine proof; runs live before any later migration |
| 1 | **person-lookup** (Search + Match modes), **i9-lookup** | read | Both Person Lookup questions and the signer lookup are pure UCPath reads; the two modes prove one workflow descriptor can preserve distinct system surfaces without a second workflow identity |
| 2 | **crm-doc-download**, **sharepoint-download**, **old-kronos-reports** | read/download | Single-system reads/downloads; stand up crm/sharepoint/old-kronos stores at low risk |
| 3 | **ocr** pipeline workflow (consumes the Phase-2h service stores) | service | No browser, no submit; the `extraction`/`normalization`/`ocr`/`roster` service stores are already built in **Phase 2h** (§3.5) — this order migrates the pipeline *workflow* on top of them, unblocking every OCR/contact/roster-dependent workflow below |
| 4 | **oath-signature**, **emergency-contact** | OCR fan-out + light write | Exercise the completion union (D11) + approval gates (D5) + operation-member fan-out; the write is a bounded UCPath enter/fill |
| 5 | **i9-check** | UCPath read + durable roster projection | Operation coordinator + member enqueue + display-only rows, but **no external submit**; its stable-keyed SQLite outbox + serialized workbook projector must prove retry-safe local materialization |
| 6 | **work-study**, **kronos-pay-rule** | single write | First workflow-specific production commits—small, isolated; validate receipt/save proof on the proven transaction kernel |
| 7 | **oath-upload**, **onbase** | write-heavy (ServiceNow + OnBase) | Prove ServiceNow `receipt`; resolve only OnBase OQ2 (`upload-verify` vs `unverifiableByPage`); oath-upload ports the born-at-upload fence |
| 8 | **separations** | write-heavy (UCPath term + Kuali) | Wrong-person incident (`T002173685`); needs UCPath `receipt` probe + pending-sweep + Kuali `save-verify` + identity-approval gate — the deepest write-safety proof |
| 9 | **onboarding** | write-heavy (UCPath hire) | Duplicate-person incident; the hire probe (no-EID key, `ProbeVerdict`-widened) + roster ingest — last, highest-stakes, most reuse of everything below it |

**OCR review UI lands WITH the OCR workflow (orders 3–4).** The OCR review/approve surface belongs
to the OCR workflow's own surface set and is built native together with the OCR pipeline (order 3)
and its first approval consumers (order 4), so the completion union + approval gates are exercised
by the real review UI. Per the 2026-07-24 layout ratification it renders as an **expanded page ↔
extracted-text pair** — each PDF page beside the fields extracted from it, never a collapsed
table. Production continues using the isolated legacy OCR surface until the single cutover.


**Order-6 canonical-EID audit gate.** The base decision is already made: `Eid` is
`/^10\d{6}$/`; there is no `legacyEid`. Before work-study/separations rebuild-ready status, replay their real
stored/fixture inputs through the canonical schema and surface every rejection. If evidence reveals
a genuinely different source identifier, model it under a specific domain name/brand with an
explicit verified conversion to `Eid`; do not widen the canonical type. This is an evidence gate,
not an unresolved architecture choice.

## The §b migration questionnaire (reusable template)

_Origin: the dissolved master plan's §3.4. Re-verified 2026-08-20 — the twelve items still name
live contracts, and `docs/migrations/separations.md` §1 is the worked example of all twelve answered._

Embed in **every** workflow's migration plan doc; answer with the operator BEFORE building
(charter §b). Grounded in ref write-safety (write-safety) + 11 (freshness/instance) + 02 (gates).

1. **Real commits** — which actions mutate the external system? For each, define a prepare contract,
   commit contract, one transaction lease scope, stable idempotency key, expected subject,
   post-prepare semantic observation, normalizer/matcher, and mismatch/unknown evidence.
2. **Completion check per submit** — receipt (UCPath/ServiceNow: source of the confirmation/ticket
   number + its schema) | save-verify (Kuali: the read-back task) | upload-verify (OnBase: the
   positive read-back, OR an argued `unverifiableByPage`→always-park)? (Ref write-safety §2.)
3. **Double-submit probe policy and age budget per transaction** — `"always"` or
   `"retries-and-recovery-only"` (may miss only an older external write on an unseen durable key)? Required, no default
   (ref write-safety §5 / D17). What justified `probeToFenceMaxMs` bounds preparation after the live probe?
4. **Dry-run preview** — confirm what prepare evidence is shown and whether the run stops there;
   commit is structurally absent.
5. **Freshness maxAges — justify the *value*, not just its presence.** For each read whose output
   feeds a write, state default/field freshness limits, whether each non-identity field is
   `forbidden|audited` for override, and **why each is right**
   for this data's staleness risk — the guard only checks the field is *present*, never that the
   value is *correct*, so the operator owns justifying it (a too-large window silently reuses stale
   data into a live write). Identity, match/item, idempotency, and proof fields are never overridable;
   `Infinity` must be argued in a comment.
6. **Workflow-specific gates/data** — identity-approval gate? OCR approval gate? EID re-match?
   roster column mapping/intake manifest, or normalization approval (ref data-intake-and-edit-data)?
   per-run test/prod instance need (ref clock-config-secrets §4)?
7. **Reuse map** — which store tasks reused (peer-to-peer), which new, and for each new task: its
   reusable-base design + the workflow-specific customization (charter §3/§8). Which canonical
   UI element/page-state/observation ids and typed driver methods are reused or added? Are any names
   copied search terms or migrations rather than new concepts?
8. **Local artifact effects** — does a read download immutable bytes (content-addressed writer), or
   does the workflow update a mutable local file? Mutable targets require a stable-keyed blocking
   outbox projection, idempotent upsert semantics, and expected-version concurrent-edit policy—not a task
   append.
9. **Scenario inventory** — enumerate happy, no-match/empty, ambiguous, schema error, transient,
   permanent, every branch/gate/delegation/control path, subject mismatch, proof unknown, crash,
   retry, and discovered real-world variants that apply. Name truly impossible variants and why.
10. **Delegation and queue policy** — enqueue policy; standard actions; for every child edge: stable
    item id, typed result, cardinality/join, child failure, cancel, child retry/parent resume, and
    visibility. Include two-edge behavior when the workflow delegates more than once.
11. **Trust contract** — what evidence makes each terminal outcome `verified|partial|unknown`? What
    artifacts/screenshots/proofs are required, what is redacted, which failures/notifications fire,
    and how does `explain run` answer “what happened?”
12. **Authoring boundary** — workflows remain source-authored; DSL/codegen is cut. Which closed
    presentation/policy edits may the editor apply, and which requests must become a code-change
    brief? Selectors, schemas, bindings, proof, and graph structure always remain code work.

## Non-workflow capability closure inventory (D58)

**The register, recounted at baseline `b1b36349` (2026-09-02).**
`config/legacy-capabilities.json` holds **78** entries: **46 open · 19 replaced · 6 native · 7
retired** (`status` projects the same split as `open 46 / implemented 25 / retired 7`, since
`native` and `replaced` both project to `implemented`). **Every one of the 46 open entries names
owner milestone `workflow-admission-backlog`** —
there is no open entry owned by a phase that has already shipped, which is what D184's sweep fixed
and what the guard now refuses to let rot again. Cutover requires zero open
(`cutoverRequiresZeroOpen: true` in the file's own header), so this table IS the phase's finish line.

| Kind | Open | What closes them |
|---|---|---|
| `service` | 16 | 15 are `legacy-workflow-*` — one per order row below, closing at that row's migration — plus `legacy-service-llm` |
| `route` | 14 | the byte/search/screenshot/settings/static families; several close together because they share the artifact-bytes route |
| `dashboard` | 6 | OCR review (order 3), oath-upload (order 7), settings, navigation, log panel, workflow modifier |
| `export` | 3 | the Excel writers — order 5's retention workbook is the first |
| `maintenance` | 3 | `clean`, `compact`, `setup` — CLI work with behavioural fixtures required before cutover |
| `codegen` | 2 | schema export, the workflow-design data bank |
| `cli` | 1 | `legacy-cli-main` — the rebuild CLI covers help/phase/dashboard/worker/explain/ocr/storage today |
| `dev-tool` | 1 | `legacy-tool-debug-kronos`, a NAMED supported diagnostic in legacy |

**The 15 workflow entries are the order rows.** They close one at a time as each order is migrated,
and one of them shows why an honest `open` matters: `legacy-workflow-person-lookup` is still open
even though order 0 shipped and ran live, because legacy's `crm-search.ts` / `match.ts` /
`outcome.ts` have no rebuild counterpart — those are order 1's Search + Match modes. A migrated
workflow does not automatically close its legacy directory; the DIRECTORY closes when nothing in it
is unanswered.

**Three of the open route entries are cutover blockers, not conveniences.** `legacy-route-static`
is the sharpest: the production BFF serves no frontend bytes, so a cutover that flips the operator
onto this runtime would hand them a runtime with no operator surface at all — and it strands the
phone capture page, which `api.ts` allow-lists and nothing serves. `legacy-route-files` (no
artifact-bytes endpoint) and `legacy-route-settings` (DCC1–DCC3 close only the resolver-owned
atomic edit/preflight/doctor slice while broader legacy settings remain open) are the other two.
Orders 2 and 3 and the §Cross-cutting section below own them.

Workflow directories are only part of the old program. The rebuild repo's
`config/legacy-capabilities.json` is created in 1a from a legacy source inventory and maintained
through rebuild, cutover, and any later retirement. Every entry has a stable
capability id, non-empty source paths, kind (`service|route|dashboard|cli|export|codegen|maintenance|
dev-tool`), known consumers, one strict disposition, owner milestone, verification evidence, and
status. Dispositions are a discriminated union:

- `native { milestone, targetIds }` — equivalent/improved native capability exists;
- `replaced { milestone, replacement, differencesAccepted }` — intentionally solved another way;
- `retired { milestone, evidence, reason }` — proven unused/unwanted; “seems dead” is insufficient;
- `candidateForRetirement { evidence, requiresOperatorAuthorization: true }` — replacement proof is
  complete, but legacy source remains preserved until a later explicit retirement decision.

**D88/D93 boundary:** `proxy` is not a disposition. The rebuild never calls a legacy endpoint and the
legacy runtime never calls the rebuild. A capability is implemented native/replaced inside the
rebuild repo, deliberately retired in the target, or remains open; completed replacements may
be marked `candidateForRetirement` without deleting the production/rollback source.

The initial grouped decisions are:

| Legacy capability family | Binding disposition and milestone |
|---|---|
| `services/capture` + capture routes/components/ngrok | native durable capture foundation in 2h/2i; legacy route/service/UI preserved through cutover |
| `services/address` + `llm/normalize-contact` | replaced by `normalization` service contracts in 2h; OCR order 3 proves real contact normalization/approval parity |
| OCR vision provider pool/rate limits/key status | generic admission/budget core in 1f; production pool/key-status adapters + OCR store in 2h; OCR workflow/order 3 closes legacy provider consumers |
| LLM triage/sanity/selector/summarize routes + ops scripts | native optional advisory adapters in 2i after trust surfaces; deterministic explain/rules/catalog remain primary; no authority edge |
| `services/matching` | roster/domain identity contracts in 2h; each real consumer closes during orders 3–9; no hardcoded header matcher survives |
| `services/timecard` | pure Clock-injected domain range logic + semantic common driver helper in 1d; Old Kronos adapter closes at order 2, New Kronos at order 8 after its last separations consumer |
| queue/task/dependency/worker/browser/daemon control routes | native command/worker/session protocol in 1f and operator UI in 2i; legacy routes remain isolated rollback code |
| files, screenshots, search/failures, SSE/projection routes | native projection spine in 1g, then artifact/evidence/query UI in 2g/2i; no cross-runtime imports or route forwarding |
| settings, preflight, credentials reference | native strict config/secrets foundation in 1b, storage-health UI in 2i, and DCC's resolver-owned settings edit/preflight controls; credentials/reference and other unowned legacy settings remain open; no legacy proxy ships |
| workflow presentation/design/data-bank/modifier | Explorer's complete existing-workflow boundary: label/icon/category hot apply; timeline/grouping and notification unavailable without owners; policy and descriptor-allowlisted Edit Data yield strict source briefs. Broader design, data-bank and new-workflow authoring remain open; old generated design briefs remain preserved with `src`, while useful history may be copied with provenance and never becomes runtime authority |
| OCR review/approve/retry/research/discard routes | native OCR workflow/gates/commands at orders 3–4; legacy routes remain isolated and production-authoritative until cutover |
| oath-upload/sharepoint and other workflow-special routes | absorbed into descriptor start surfaces and standard commands at that workflow's migration; legacy routes remain rollback code |
| export to xlsx, setup, test-login, tracker clean/compact, schema/catalog/search codegen | native CLI/maintenance work items attached to 1b/1d/1g/2i as appropriate; behavioral CLI fixtures and help output required before cutover |
| one-off debug/dev helpers (for example Kronos debug and dashboard dev components) | port only if a named supported diagnostic remains; otherwise retire with zero-consumer search plus accepted replacement/evidence |
| general `utils`/infra helpers | no bulk copy; each consumer-driven port maps to domain/infra/store ownership, and the capability guard blocks an orphan at cutover |

**Entry semantics as-built (D184, 2026-08-09).** The union above is unchanged in intent; three
things are now pinned by `legacy-capability-disposition` rather than left to prose.

- **`open` carries a required `reason`.** `{kind:"open", milestone}` alone is how 73 of 78 entries
  came to name milestones that had already shipped — nothing in the record contradicted them. An
  entry that moves to a later milestone must say why it moved.
- **`status` is the disposition's projection, not a second opinion.** It is
  `open | implemented | retired | retirement-candidate`, mapped one-to-one from the disposition
  kind (`native`/`replaced` → `implemented`). A two-valued flag would have had to call a
  retirement "implemented".
- **Every disposition arm carries `milestone`,** including `candidateForRetirement`, so
  `ownerMilestone` has something exact to agree with.

And the rule the sweep is applied under: **a wrong `native` claim is worse than an honest `open`.**
A family whose core landed but whose operator-visible half did not stays `open` and names what is
missing; only an evidenced, resolvable target closes an entry.

At every workflow rebuild-ready milestone, the commit updates affected capability entries. D150
froze legacy change accounting; live selector/page-state re-verification at each migration replaced
it. Before cutover, the guard requires zero undecided/missing entries,
every `retired` target decision has evidence, every native/replaced target resolves, every old
route/service/script/component path is covered exactly once, and the final CLI/help/dashboard
inventories match. Nothing in this inventory authorizes legacy deletion.

## Live probe status (the design assumptions still unproven)

_Origin: the dissolved master plan's §3.8. Re-verified 2026-08-25 — Kuali and UCPath are settled and
BUILT (`src/stores/kuali/tasks/verify-separation-finalization.ts`, `src/stores/ucpath/tasks/verify-termination.ts`);
ServiceNow and OnBase are unchanged and both are `you:` lines on `{#order-7}`._

Ref write-safety's write-safety contract requires each system to produce a typed completion proof. For two
of four systems that is still an *assumption*. The Kuali probe showed how cheap it is to settle:
half a day of pre-authorized live access resolved a years-deep open question **and** produced four
design constraints (save is UI-silent so reload read-back is mandatory; date values render as
child text nodes; DOM refs change every reload so anchor on role + exact label; ~8–10s per
fill→save→reload→verify cycle) that would otherwise have been discovered mid-migration.

**D92 gate placement is ratified:** these probes are mandatory at the milestones below and are not
Phase-1 blockers. Deferral changes timing only; it does not waive proof.

| System | Completion arm | Status | Gate |
|---|---|---|---|
| **Kuali** | `save-verify` | ✅ **RESOLVED buildable** (live probe 2026-07-23, docs 4444/4453; read-only + a full write round-trip restored byte-identically). The annotation-only verifier was retired by D266; the current write family is `kuali/verify-separation-finalization`, built from the same reload-read-back mechanism and carrying D207's obligation to confirm or move the inherited window | — |
| **UCPath** | `receipt` (`T…` transaction number) | ✅ **RESOLVED buildable — and the arm as specified was WRONG** (live probe 2026-08-04, D130; **read-only, no transaction created**, so the authorized submit was not spent). The `T…` lives on SS Smart HR's transaction detail (`UC_EXTENSIONS.UC_SS_TBH.GBL`), NOT on the submit and NOT on the Transaction Status dashboard, which has no Transaction ID column at all. **A Denied transaction carries a well-formed `T…`** (`T002204014`; 300 Denied rows live), so the proof is the PAIR `(transactionNumber, approvalStatus)` — ref write-safety §2.2's number-only schema is corrected. Six constraints in ref write-safety §13.6 | residual submit-side questions before Phase 2's controlled commit |
| **ServiceNow** | `receipt` (`HRC0…` from the post-submit redirect) | ⏳ operator naming a target | before order 7 |
| **OnBase** | `upload-verify` or `unverifiableByPage`→always-park | ⏸ **blocked — no probe target exists today**; gated on the next real document upload | before order 7 |

**A fifth Kuali constraint, found on the 2026-08-04 read-only re-verification (D122):** an
`actionId` is **not stable across workflow steps**. Doc 4453's 2026-07-23 action id no longer
resolved to a form — it silently redirected to the Action List. A deep link is reload-safe *within*
a step and nothing more, so a run carries the action id AND the document number, and the driver
proves the opened document's number from its level-1 heading before touching anything. The three
ported anchors (`EID*`, `Timekeeper Name:*`, `Save`) each resolved to exactly one live node, and
`Save` sits in one action group with `Send Back` and `Mark Complete` — which is why its port drops
legacy's three-deep `.or()` chain and keeps only the exact role+name branch.

**The UCPath probe changed what "settling a probe" costs (D130, 2026-08-04).** It was authorized to
create one real transaction and did not need to, because **an already-FAILED transaction is a better
witness than a fresh one**. A new submit can only ever show the `Pending` shape; the live system
already held 300 Denied and 300 Pending transactions, so reading a Denied one answered the probe's
deepest question — *is "submitted" distinguishable from "looked submitted"?* — strictly better than
writing would have, and it answered it in the direction nobody had assumed: **it is not**, because a
refused transaction carries a perfectly well-formed `T…`. Before spending a write on a probe, look
for a real record already in the state you are trying to manufacture. Two of UCPath's six
constraints (submit-side receipt silence, propagation window) genuinely need a submit and remain
ported-from-legacy rather than rebuild-verified; that is the honest residual, and it is much smaller
than the whole question was.

Each probe is read-only-plus-restorable in the Kuali shape: read the completion surface, confirm a
deterministic anchor, and where a write is authorized, write → verify → restore. If OnBase lands
on `unverifiableByPage`, order-7 automation degrades to "operator manually confirms every upload"
— which changes the rebuilt workflow contract, so it must be settled at order 7 before readiness.

## Testing tiers
<!-- roadmap: test-tiers -->

<!-- roadmap-status: test-tiers -->
- [x] DOCS the spec — `ref guards-and-tests` §10 is written as-built: the no-dry-run / dry-run split, T1a/T1b/T2/T3/T4, the subject registry, the durable result, layout, naming, the vitest project per tier and the run policy (landed in d5b0f8f2, as of dc2901de; R10)
- [ ] BE T1 layout — `tests/scenario/workflows/<id>/` with ONE `structural.scenario.test.ts` per workflow plus its `dry-run.scenario.ts` manifest; the pretending fixture scenarios rewritten
- [ ] BE T2 dashboard / non-run scenarios per feature, seeded from `tests/unit/dashboard/*` that are scenarios in disguise (moved, not duplicated)
- [ ] BE T3 the first combined pair — `docs/migrations/separations.md` §9.22's hand-run double-entry as a file
- [x] BE the subject registry `config/test-subjects.json` + the insert-only `dry_run_scenario_results` row + `cli dry-run-scenario`
- [ ] PROOF T4 the agent-operated parallel e2e runner + the first journey, recorded
- [ ] BE the coverage floor at 80/80/80 global (measured 84.23 / 82.15 / 84.74 at the spec's writing)
- [x] BE the FIRST T1 pair — `separations-kuali-finalization`, seeded from the valid proof shape of the dismantled `kuali-timekeeper-annotation` workflow (D266, doc 03b §The workflow tree)
> 2026-08-20 | docs-cohesion 03c | the DOCS line is landed at HEAD (`ref guards-and-tests` §10.1–§10.12, landed in d5b0f8f2, as of dc2901de); the six code lines are 5.2b–5.2d and no workflow in this doc has a T1 pair yet — left: everything below DOCS
> 2026-08-25 | test-tiers | the first T1 pair and shared subject/runner/result machinery exist; the general T1 layout migration remains open, and this pair's live green waits for its 2026-08-28 subject
<!-- /roadmap-status -->

`tests/` is organized by **what a test needs**, and this is what every migration below adds its
tests to. The **no-dry-run** tests — unit, the architecture guards, ONE honest structural fixture
scenario per workflow, the dashboard feature scenarios, and parity — run per commit, per workflow
update, and all of them on a dashboard update. Every test that must RUN a workflow is built on a
**live dry run** of it (`dryRun=true`), declared as a scenario with **checkpoints asserted over
authority** (nodes reached, checkpoints, gate results, write intents, receipt shapes — Track C's
`docs/migrations/separations.md` §9.22 double-entry, as a file), **subject-parameterized** against
a canary registry per workflow (labels live in the repo, sensitive values — EIDs — stay in `.env`
and are referenced by label; a missing subject reports `blocked: needs <subject>`, never
`failed`), with **dashboard conditions attachable** (drive the real ceremony while the run is
parked, assert the timeline while it is running) and the result **recorded durably** — an evidence
row plus a dated line in the workflow's migration record, which is what a `PROOF` tick on a
migration node cites. The **end-to-end tier** is an agent-operated run of MANY dry-run scenarios in
parallel, across workflows and across two runs of the same workflow (`{#parallel-runs}`). Fixture
scenarios that pretend are rewritten into the honest structural one or into a dry-run scenario.
The coverage floor moves to **80 %** lines/statements/functions global. Under D311 every migration
owes its T1 pair (the structural fixture scenario and T1b live manifest). T2/T3 are added only when
that workflow introduces a new dashboard interaction or wire arm; reused generic projections are
covered once by registry-wide workflow/compiler conformance. The normative spec — folder layout, file naming,
the vitest project per tier, the run policy, the subject registry, the durable result row — is
`reference/guards-and-tests.md` (R10, 2026-08-20).

## Phase 3 acceptance · Person Lookup
<!-- roadmap: order-0 -->

<!-- roadmap-status: order-0 -->
- [x] the workflow exists and is registered — `src/workflows/person-lookup/descriptor.ts` + `module.ts`, tuple entry in `src/control/workflow-registry.ts`
- [x] it ran LIVE against real UCPath + CRM (D74, 2026-08-04): run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, recovered a dead CRM session mid-run and terminalized `done` at attempt 2
- [x] the store tasks it forced into existence — `ucpath/search-person-org`, `crm/read-onboarding-record`, `crm/read-onboarding-dates`, `person-lookup/read-active-status`
- [ ] Search + Match as modes on this existing workflow, preserving one workflow identity and two run-modal choices
- [ ] PROOF T1 — no `tests/scenario/workflows/person-lookup/` exists; the structural fixture scenario and D318 `live-read` manifest are both unwritten (`ref guards-and-tests` §10.11)
- [ ] the legacy capability entry `legacy-workflow-person-lookup` stays **open** until Search + Match and the canonical T1 pair close in Phase 3c-B
> 2026-08-20 | docs-cohesion 03c | verified against `src/workflows/person-lookup/descriptor.ts`, `src/control/workflow-registry.ts:39` and `config/legacy-capabilities.json`; left: the T1 pair, and the capability entry closes only at order 1
<!-- /roadmap-status -->

The Phase-1 spine proof, and the only order row that is migrated. It resolves a person by name or
EID against real UCPath and real CRM. It is here as the WORKED EXAMPLE of the loop, not as work:
`ref workflow-model` §8/§8.1 is its descriptor and the five deltas the live run forced,
`ref task-contract` §9.1/§9.1.1 are its two canonical task contracts.

**What its live run bought the rest of this doc.** D74's argument is that a real run falsifies
contracts a fixture cannot, and it did: the `skipped` timeline arm (D123), the terminal-duration
defect (D124), the accessible-name collision (D126), the `(runId, attempt, spanPath)` fold key, and
`timeouts.sessionAcquireMs` (D125 — the dead CRM session cost 262.9 s of a ~14.5-minute run). Every
order below budgets for the failure path on that evidence, not the happy path.

**What it still owes.** Its T1 pair, like every other workflow, plus the already-verified Search +
Match mode boundary. Both now close in Phase 3c-B; they are not bundled with I-9 Lookup.

### Dashboard · wire person-lookup
<!-- roadmap: order-0-dash -->

<!-- roadmap-status: order-0-dash -->
- [x] run modal — name / EID typed inputs and the start plan (`ref frontend-backend-integration` §5.1.1)
- [x] queue row — the person-lookup row with status and timing, after D123/D124/D126 (§5.1.2)
- [x] run detail — timeline, receipt, Context rail; the two-pixel panel D187 found and fixed (§5.1.3)
- [x] archive · activity · explorer — person-lookup rows appear through the generic surfaces (§5.1.5)
- [x] D311 bounded acceptance — the transitional compiler reaches these projections and registry-wide comparison is green (`ebfde1c6`, `246daab2`, `4555341f`)
- [ ] D312–D318 final acceptance — final `workflow.ts`, no authored descriptor/module glue, four-artifact guard and canonical T1 pair using the graph-valid T1b arm
> 2026-09-02 | D311 | retained as historical acceptance evidence; no duplicate generic-surface T2 is required
<!-- /roadmap-status -->

The first wiring, done in 1i-spine before the `Dashboard · wire` template existed — which is why it
has four squares rather than seven: person-lookup does not gate, raises no park notification and
consumes no intake, so §5.1.4, §5.1.6 and §5.1.7 have nothing to declare. That is the template
working, not a gap: a square is absent when the workflow has nothing to put in it, and present-but-
empty when the wire has not been run.

## Unverified candidate evidence · former order 1 · I-9 Lookup

- [x] draft I-9 Lookup intake evidence — `docs/migrations/i9-lookup.md`, plus the REUSE/CUSTOMIZE/BUILD and live I-9 map, integrated by `b1b36349`; D319 does not treat this as admission
- [ ] the `i9` store — `src/stores/i9/index.ts` is 4 lines: `defineBrowserStore("i9", declareDriver("i9", "unwired"), i9Session, {})`. No driver, no login recipe, **zero tasks**
- [ ] D319 admission packet and operator approval before any `i9-lookup` implementation or phase assignment
- [ ] the capability entry `legacy-workflow-i9-lookup` remains open until an approved future phase closes it
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/i9/index.ts:4` (unwired, `{}` tasks) and `src/workflows/person-lookup/descriptor.ts` (no mode); nothing is built — this row is a plan
> 2026-09-02 | former Order 1 intake | exact task/driver leads, provenance and current live login/search evidence integrated by `b1b36349`; D319 returns I-9 Lookup to the unnumbered admission backlog

**What it is.** Both HR-Tasks questions in one workflow — *search* for a person and *match* an
existing record — plus `i9-lookup`, which answers who signed a Form I-9 section 2. All three are
pure reads. **Systems:** UCPath (already driven), and the I-9 system (undriven).

**Store tasks.** REUSE `ucpath/search-person-org` and `ucpath/read-job-summary` unchanged. BUILD the
whole `i9` store — its driver, its `defineVerifiedLoginRecipe` (two independent content facts, never
a URL, D120), its UI catalog, and its read tasks. `ref task-contract` §3.1 is the layout it lands in.

**The specific hazard.** Two modes on ONE descriptor is the point of this row, and D15 (`ref
dashboard-surfaces` §9) is the contract: one workflow identity, two distinct system surfaces
preserved. The tempting shape — a second workflow id per mode — makes the queue, the archive and
the explorer show two workflows where the operator has one, and it doubles every wire square below.
The second hazard is the login: `i9` is the first store since 1d to need a verified login recipe
written from scratch, and D120's lesson is that a URL predicate passes on a sign-in page.

**Why it is first after 0.** It costs the least and it pays into everything: `i9` is also order 5's
store, and Search + Match is the mode mechanism orders 3-9 reuse whenever one workflow needs two
faces.

### Dashboard capability delta · Search + Match · i9-lookup

- [ ] BOTH generic workflow-declared mode chooser — Search and Match are two run-modal options of one workflow without a second workflow identity
- [ ] PROOF T2/T3 only for that mode interaction; i9-lookup's ordinary start/queue/detail/archive projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped from six repeated wires to the one new mode capability

The surfaces exist. The one capability delta must get the **mode** right: the
run modal has to offer Search and Match as two rows of one workflow, and the queue row has to name
the subject differently per mode without minting a second workflow class.

## Unverified candidate evidence · former order 2 · downloads

- [ ] the §b completeness pass for all three workflows — inherited answers cited and workflow-specific deltas recorded
- [ ] the `sharepoint` and `old-kronos` stores — 9 lines each, `declareDriver(…, "unwired")`, zero tasks
- [ ] CRM document download on the EXISTING crm driver — `src/stores/crm/tasks/` holds two read tasks and no download
- [ ] downloads land as content-addressed immutable artifacts (`artifact-effect-boundary`, `ref guards-and-tests` §3.7)
- [ ] the artifact-bytes route — there is **no** endpoint serving artifact bytes today; the only byte-serving route in the tree is the phone's own `GET /api/v1/capture/phone/photos/:photoId/bytes` (`legacy-route-files`, still open)
- [ ] PROOF T1 per workflow; T3 only for the download viewer capability
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/sharepoint/index.ts`, `src/stores/old-kronos/index.ts` (both unwired, `{}` tasks), `src/stores/crm/tasks/` (2 read tasks) and `config/legacy-capabilities.json`'s `legacy-route-files` reason; nothing built

**What it is.** Three single-system reads that end in a FILE: CRM iDocs PDFs, SharePoint rosters,
and Old Kronos Time Detail PDFs. **Systems:** CRM (driven), SharePoint (undriven), Old Kronos
(undriven).

**Store tasks.** REUSE the `crm` driver and its session provider; BUILD one download task on it, and
BUILD the `sharepoint` and `old-kronos` stores whole. Neither has a login recipe yet.

**The specific hazard, and it is not the download.** This row is the first to produce BYTES an
operator wants to see, and the byte path does not exist: `ArtifactRefWireSchema` describes artifacts
and run detail lists them, but nothing serves them. So order 2 owns two things at once — the
immutable content-addressed WRITE (which `artifact-effect-boundary` already enforces: a download is
immutable, a mutable local file is a projection with a stable-keyed outbox, never a task append) and
the READ route (`ref frontend-backend-integration` §3.6) that three later orders also need. Do the
route here or orders 3, 5 and 7 each rediscover it.

**Why it is this early.** Blast radius: nothing is written to any HR system, and standing up two
stores at zero write risk is the cheapest way to learn each system's login and page shape before a
later order has to write to it.

### Dashboard capability delta · downloads

- [ ] the download viewer — the artifact-bytes route plus a per-run downloads tile (`ref frontend-backend-integration` §3.6)
- [ ] PROOF T2/T3 for download availability, verified bytes and refusal; ordinary projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped from six repeated wires plus viewer to the viewer capability alone

The extra square here is a real build, not a wire: the run-detail `captures` section is schema'd
and DECLARED-UNSERVED today — `config/pending-wire-bindings.json` carries
`RunDetailSectionResponseSchema#captures` as `declared-unserved` (D184), `availableSections` cannot
return it, and the bytes behind it are unrouted (03a's finding). This capability is where a downloaded
document becomes something the operator can open.

## Unverified candidate evidence · former order 3 · OCR pipeline

- [ ] the §b completeness pass for the OCR pipeline — inherited answers cited and workflow-specific deltas recorded
- [x] the four service stores it consumes are BUILT (2h) — `extraction` (`extract-pdf-pages`, `extract-spreadsheet`), `ocr` (`extract-form-page`), `normalization` (`read-contact-advice`), `roster` (`match-spreadsheet`)
- [ ] the OCR pipeline WORKFLOW over them — no descriptor exists; this order migrates the pipeline on top of stores that already work
- [ ] D189/D294's byte path — the production BFF serves **no frontend bytes**: `src/server/dashboard/http-server.ts` has no static handler and `dashboard:prod` names a mode the runtime never parsed
- [ ] PROOF T1; T3 only for the Review capability
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/{extraction,ocr,normalization,roster}/tasks/`, `src/control/workflow-registry.ts:194` and `config/legacy-capabilities.json`'s `legacy-route-static` reason; the stores are real, the workflow is not

**What it is.** PDF → extraction → review → fan-out, with no browser and no submit. It is the only
row whose STORES already exist: 2h built them and 2j closed over them, so this order migrates the
pipeline *workflow*, which is a different and much smaller job than the ones around it.

**Why it unblocks four consumers.** Orders 4, 5, 7 and 9 all read extracted or normalized data.
Until the pipeline workflow exists they each have to invent their own way in, which is exactly the
reuse leverage the ordering exists to protect.

**Three specific hazards, none of them OCR.**

1. **The byte path is a HARD cutover blocker, and it lands here.** `legacy-route-static` records it
   plainly: cutover flips the operator onto this runtime, and a runtime that cannot deliver its own
   frontend has no operator surface at all. It also strands 2i-F's phone capture page — the page is
   built, the host gate allow-lists it, and nothing serves it. Doc 04 `{#def-byte-path}` carries the
   deferral; this order is its named trigger.
2. **The capture binding has no honest consumer yet.** `CAPTURE_INTAKE_BINDINGS` being empty is
   correct today — no workflow can turn a photograph into an employee id, and D174's rule is that
   such a workflow refuses BY NAME rather than fabricating a binding. The OCR pipeline is the first
   workflow that genuinely can consume a capture bundle, so this is where the registry gets its
   first entry.
3. **The `operation` run shape exists and nothing mints one.** `RunShapeSchema` and
   `RowShapeSchema` both carry `operation` / `operation-member`, and `src/dashboard/surfaces/queue.tsx`
   renders group rows for them — but no descriptor declares one, so the whole fan-out presentation is
   drawn against a shape no run has ever had. Order 3 produces the first fan-out source and order 4
   is the first to consume it; the risk is D187's shape (a surface reviewed but never seen) and the
   answer is the T3 pair, not another read of the code.

**Store tasks.** REUSE all four service stores. BUILD the pipeline descriptor, the byte route, and
the capture binding.

### Dashboard capability delta · OCR pipeline

- [ ] the OCR review UI — the expanded page ↔ extracted-text pair, approve / reject / retry page, ONE atomic correction list (never a collapsed table; the 2026-07-24 layout ratification)
- [ ] the review/approve commands + progressive record patches over the SSE stream
- [ ] the run-detail **Review** panel BODY — `review` is in `TAB_ORDER` but `availableSections` can never return it, so the tab is structurally unreachable and `UnservedTab` is dead code (03a's finding)
- [ ] PROOF T2/T3 for Review; start/queue/timeline/intake/archive projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped to the first real Review capability and its commands

The largest dashboard capability delta in the doc is mostly a build. The OCR review
surface is not a generic surface a migration inherits: `ref data-intake-and-edit-data` §4.3's three
producers admit identically, and `ref dashboard-surfaces` §9's D7/D8/D10 shape the review row
(extracted count while still at review, approval only after Review, depth-2 delegated lookups
visible only from the review row). It lands WITH this workflow, by the ordering's own argument —
building it earlier would shape a review UI against no corpus.

## Unverified candidate evidence · former order 4 · oath signature · emergency contact

- [ ] the §b completeness pass for oath-signature and emergency-contact — inherited answers cited and workflow-specific deltas recorded; both still need an operator-approved controlled-commit target
- [ ] the first operation FAN-OUT and its approval gates, exercised through the real OCR review UI
- [ ] the `oath-signature` and `emergency-contact` descriptors + modules + tuple entries
- [ ] the first non-separations controlled commits — a bounded UCPath enter/fill, under `ref write-safety` §3.2
- [ ] PROOF T1 per workflow; T3 only for the new gate/Group People capability
> 2026-08-20 | docs-cohesion 03c | nothing built; `RunShapeSchema`'s `operation` / `operation-member` arms still have no producer, so every group surface below is drawn against a shape no run has had

**What it is.** Oath date rows and emergency-contact fills — OCR fan-out with a light write at the
end. **Systems:** UCPath (driven), consuming order 3's extraction output.

**Store tasks.** REUSE `ucpath`'s driver, session and search tasks and order 3's extraction /
normalization outputs. BUILD the enter/fill commit contracts, each with its prepare contract, its
transaction lease scope, its stable idempotency key, its expected subject, its post-prepare semantic
observation and its mismatch evidence — the §b questionnaire's item 1, answered per commit.

**Why this row is where fan-out becomes real.** `ref dashboard-surfaces` §4 is the unified
completion contract — §4.1's typed staged completion program, §4.2's refusal to let one spec borrow
another's shape, §4.3's intent-derived child shape and stage consumption, §4.4's durable approval
manifest. All of it is designed and none of it has ever run: the `operation` run shape has no
producer, the Group People panel body says it is not served, and the D5/D9/D11/D14/D16 row-model
decisions (`ref dashboard-surfaces` §9) describe rows nobody has seen. This order produces the first
real ones.

**The specific hazard: two firsts in one row.** It is simultaneously the first fan-out AND the first
non-separations controlled commit. Those are independent proofs and they must not be collapsed — a
green fan-out says nothing about a landed write, and the write proof is `ref write-safety` §3.2's
full shape (dry run with zero durable rows, a forced subject mismatch refused with zero fence and
zero click, ONE commit whose proof is a read-back plus the outbox rows plus the terminal span, an
idempotent re-run answering `already-present`). Take them in that order: prove the fan-out with the
write still dry, then prove the write on a single member.

**The second hazard: the write is small, which makes it tempting.** A bounded enter/fill is the
easiest real write in the program, and that is exactly the argument for running the whole §3.2
contract over it rather than an abbreviated version — the contract is being proved here for every
row after it.

### Dashboard capability delta · oath-signature · emergency-contact

- [ ] the generalized server-declared gate packet this workflow's approval requires (`ref write-safety` §14.11)
- [ ] Group People — paged members, rollup and containment over REAL operation members
- [ ] the group People panel BODY — declared in `TAB_ORDER`, never servable (03a's finding, same shape as order 3's Review tab)
- [ ] PROOF T2/T3 for the new gate shape and Group People; ordinary projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped to two new capabilities: generalized gate packet and Group People

The gate square is not optional here and it is not separations' gate: `ref write-safety` §14.11's
rule is that the approval SHAPE is computed by the server, never chosen by the frontend, because a
frontend free to choose it can quietly turn every gate into one click — which is §14.6's
rubber-stamping risk manufactured by accident. Group People is the other real build: D11 says one
member presentation at every count, D14 says a group of one still renders as a group row, D9 says
rejected members never count toward done, and D16 says cancelling a group is tree-scoped and final.

## Unverified candidate evidence · former order 5 · I-9 check

- [ ] the §b completeness pass for i9-check — inherited answers cited and workflow-specific deltas recorded
- [ ] the operation coordinator AT SCALE — member enqueue, display-only rows, the join; `ref dashboard-surfaces` §7 and `ref execution-and-sessions` §8 are the same worked example from two sides
- [x] the stable-keyed idempotent workbook SINK exists — `src/infra/artifacts/xlsx-retention-sink.ts` proves `ref data-intake-and-edit-data` §4.1's contract (duplicate key is a verified no-op, changed record is an in-place update, rows sorted by stable key, atomic replace)
- [ ] the sink is NOT composed in production (D164) — no descriptor declares a projection, so nothing writes a workbook today
- [ ] the operator-facing workbook layout — the sink's four columns (`stableKey`, `keyValues`, `record`, `projectedAt`) are deliberately the DURABILITY layout; the real column set belongs to this migration, which knows the real fields
- [ ] the first Excel EXPORT writer (`legacy-export-i9-check-tracker`, open)
- [ ] PROOF T1; T3 only for retention/export behavior
> 2026-08-20 | docs-cohesion 03c | verified against `src/infra/artifacts/xlsx-retention-sink.ts`'s own header (it names this migration as the owner of the display layout) and `config/legacy-capabilities.json`; the durability half is built, the workflow and the display half are not

**What it is.** Verify an I-9 packet across a group of people and maintain the master retention
workbook. A UCPath read plus a durable roster projection — operation coordinator, member enqueue,
display-only rows, and **no external submit**. **Systems:** UCPath (driven), `i9` (built at order 1).

**Store tasks.** REUSE `ucpath/search-person-org` and `read-job-summary`, order 1's `i9` read tasks,
`roster/match-spreadsheet`, and the xlsx retention sink. BUILD the coordinator's own service tasks
and the export writer.

**Why it is here and not earlier.** It needs order 1's `i9` store and order 4's fan-out. It is the
first row to run the coordinator at real member counts, and it does that with no write to any HR
system — which is the point: a scale proof and a write proof are separate, and this one is free.

**The specific hazard: a mutable local file is not a task append.** The §b questionnaire's item 8
exists for this row. A workflow that updates a mutable local file needs a stable-keyed blocking
outbox projection, idempotent upsert semantics and an expected-version concurrent-edit policy. The
sink already implements that and records the rule the hard way — its recorded head hash is the ONLY
authority on what it last wrote, and a workbook whose bytes hash differently was changed by someone
else, which is a conflict rather than something to overwrite. The migration's job is the display
layout and the export, not a second durability model.

**The second hazard: retention.** The master workbook is a retention record about real people. Its
column set is a redaction decision as much as a layout one, and it should be answered in the
questionnaire's item 11 (trust contract) before a column exists.

### Dashboard capability delta · i9-check

- [ ] member rows carrying retention status, and the workbook export control
- [ ] PROOF T2/T3 for retention status and export; Group People and ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to retention status and workbook export

This capability delta reuses order 4's group surfaces and adds two things: a member row that
shows RETENTION status (which is a fact about a document's lifecycle, not about the run), and the
export control. D17 — per-member confirmation numbers inline on the packet receipt — is the receipt
detail this row is the first to need.

## Unverified candidate evidence · former order 6 · work-study · Kronos pay rule

- [ ] the §b completeness pass for work-study and kronos-pay-rule — inherited answers cited and workflow-specific deltas recorded; both still need an approved controlled-commit target
- [x] the `new-kronos` store exists with a driver, a session provider and two READ tasks — `read-separation-timecard`, `search-employee` (D196, `ref task-contract` §2.9); separations chunk 1 built it
- [ ] the new-kronos WRITE family — the pay-rule commit contracts; the store has no write path today
- [ ] the `work-study` and `kronos-pay-rule` descriptors + modules + tuple entries
- [ ] the canonical-EID audit gate — replay real stored / fixture inputs through `EidSchema` (`src/domain/ids.ts:184`, `/^10\d{6}$/`) and surface every rejection
- [ ] PROOF T1 per workflow; T3 only for the run-constant interaction
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/new-kronos/tasks/` (two read tasks, no write) and `src/domain/ids.ts:184`; the store is half-built by separations and the write half is this order

**What it is.** PayPath pool / comp entries and UKG pay rules — the first workflow-specific
production commits that are not separations. Small, isolated, on a transaction kernel that has
already been proven twice. **Systems:** UCPath PayPath (driven), New Kronos / UKG (driven for reads).

**Store tasks.** REUSE the whole `new-kronos` store — separations chunk 1 built its driver, its
session provider and its two read tasks, which is the reuse leverage the ordering was designed to
produce. BUILD its write family: each pay-rule commit needs `ref write-safety` §2.2's per-system
instantiation (which of the three shapes it is) and §5's double-submit prevention (the permanent key,
the probe, the probe policy and its age budget — item 3 of the questionnaire, required, no default).

**The specific hazard: the canonical-EID audit gate.** This is an EVIDENCE gate, not an open
architecture question. `Eid` is `/^10\d{6}$/` and there is no `legacyEid`. Before either workflow
is marked rebuild-ready, replay its real stored and fixture inputs through the canonical schema
through `ref data-intake-and-edit-data` §1's registry and surface EVERY rejection. If the evidence
shows a genuinely different source identifier, model it under its own domain name with an explicit
verified conversion to `Eid` — do not widen the canonical type. Widening is the silent-wrong-value
failure with a schema's blessing: a malformed identifier that parses is a wrong person who looks
right.

**The second hazard: a spreadsheet is the start surface.** Work-study arrives as a spreadsheet
(`ref data-intake-and-edit-data` §8 is the end-to-end worked example), so this row is where intake
meets a WRITE for the first time. The column mapping, the validation and the immutable intake
manifest all already exist from 2h; what is new is that a mapping mistake now reaches UCPath.

### Dashboard capability delta · work-study · kronos-pay-rule

- [ ] the intake grid's constants entry + its unbind arm (`effectiveDate`, D172/D173)
- [ ] PROOF T2/T3 for bind/unbind of the run constant; intake and ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to the constants interaction alone

The intake workspace exists (2i-E3, `ref dashboard-surfaces` §9.7.1) and this sub-task adds the one
thing a write workflow needs from it: a CONSTANT the operator supplies once for a whole sheet — an
effective date — rather than per row, and an unbind arm that takes it back off. `ref
data-intake-and-edit-data` §2.8 is D172/D173's as-built union resolution behind it.

## Unverified candidate evidence · former order 7 · oath upload · OnBase

- [ ] the §b completeness pass for oath-upload and onbase — inherited answers cited and workflow-specific deltas recorded
- [ ] the `servicenow` and `onbase` stores — 9 lines each, `declareDriver(…, "unwired")`, zero tasks, no login recipe
- [!] the ServiceNow `receipt` probe — **the operator must name a live probe target**; §Live probe status has carried this as ⏳ since D92
- [!] OnBase `upload-verify` **or** an argued `unverifiableByPage` → always-park — **blocked: no probe target exists today**, and it is gated on the next real document upload
- [ ] oath-upload's born-at-upload fence (`ref dashboard-surfaces` §4.5)
- [ ] PROOF rebuild-verified propagation windows for ServiceNow (`ref write-safety` §4.2; doc 04 `{#def-propagation}` carries the deferral)
- [ ] PROOF T1 per workflow; T3 only for the receipt capability delta
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/servicenow/index.ts`, `src/stores/onbase/index.ts` (both unwired, `{}` tasks) and §Live probe status; TWO of this row's blockers need the operator, not an agent

**What it is.** A ServiceNow ticket with a PDF attached, and an OnBase document import. The two
write-heavy rows that are not incidents. **Systems:** ServiceNow (undriven), OnBase (undriven).

**Store tasks.** BUILD both stores whole — driver, verified login recipe, UI catalog, read tasks,
and the write family. `ref task-contract` §9.2 is the OnBase import contract's shape.

**This row is gated on the operator twice, and that is the honest state.** Two of the four systems
in the write-safety contract still have their completion arm as an ASSUMPTION rather than a proof
(§Live probe status). ServiceNow needs someone to name a target; OnBase has no target that exists.
Both are `you:` lines on the tree node, and neither is something a migration agent can resolve by
reading code. Settling them is cheap when a target exists — the Kuali probe took half a day and
produced five design constraints that would otherwise have surfaced mid-migration.

**The specific hazard: `unverifiableByPage` changes the WORKFLOW, not just the test.** If OnBase
lands there, order 7's automation degrades to *the operator manually confirms every upload* — a
different product, not a weaker assertion. `ref guards-and-tests` §3.5 is D22's closure of that
escape hatch: an `unverifiableByPage` claim needs an allowlist entry AND a reason, so it cannot be
reached by omission. Decide it BEFORE rebuild-ready, because a workflow whose completion arm is
"a human looks" needs its park path, its notification and its receipt designed for that.

**The second hazard: `linked` is not `member`.** oath-upload's signers are `linked` children (D6),
and a failed `linked` child makes the PARENT failed (D13) — which is the opposite of a group member,
where a rejection is a member-level outcome. Getting that backwards produces a parent that reports
success over a signer who never signed.

**The third: the born-at-upload fence.** `ref dashboard-surfaces` §4.5 — oath-upload's owner
consumes through a sibling task born at the upload, which is how the fence gets a permanent key for
a document that did not exist when the run started.

### Dashboard capability delta · oath-upload · onbase

- [ ] the ServiceNow ticket receipt and the OnBase upload-verify on the run-detail receipt (`ref operator-trust` §2.3)
- [ ] PROOF T2/T3 for those receipt arms or the explicit always-park arm; ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to the two new completion-proof presentations

The receipt square is the one that carries this row's risk onto the screen. `ref operator-trust`
§2.3 is the receipt contract: a `HRC0…` ticket number is a real completion proof and an unverified
upload is not, and the panel has to say which of the two it is holding. D237/D238's rule applies
directly — a label and a derived verdict describing the same run must not be derived twice.

## Unverified candidate evidence · former order 9 · onboarding

- [ ] the §b completeness pass for onboarding — inherited answers cited and workflow-specific deltas recorded; it still needs an operator-approved HIRE canary
- [ ] the hire probe with the **no-EID key** — `probeVerdictSchema` today has four arms (`present` · `absent` · `ambiguous` · `unknown`, `src/domain/write-safety-primitives.ts:50`) and every permanent key in the tree is EID-derived; a hire has no EID until it lands
- [ ] roster ingest (`ref data-intake-and-edit-data` §4; the `roster` store's `match-spreadsheet` exists, the ingest workflow does not)
- [ ] the onboarding composition over the `ucpath` / `crm` / `kuali` / `new-kronos` stores
- [ ] PROOF T1; T3 only for roster ingest or a new hire-gate arm
> 2026-08-20 | docs-cohesion 03c | verified against `src/domain/write-safety-primitives.ts:50-63` and `src/stores/roster/tasks/`; nothing built, and this row's canary is a `you:` line that has no cheap answer

**What it is.** The real hire transaction — the duplicate-person incident's workflow. Last by
design: highest stakes, and it reuses more of everything below it than any other row.
**Systems:** UCPath (driven), CRM (driven), Kuali (driven), New Kronos (driven by order 6's write
family). By the time this runs, every store it needs exists.

**Store tasks.** REUSE essentially everything. BUILD the hire commit contract, the no-EID probe, and
the roster ingest workflow.

**The specific hazard: the permanent key has no subject yet.** Every write this program has proven
is keyed on a person who already exists. A hire is the opposite — the transaction CREATES the
identity, so the idempotency key cannot be derived from an EID and the probe cannot ask *does this
person have a pending X*. That is what "`ProbeVerdict`-widened" means, and it is a real schema
question, not a naming one: the probe must be able to say *a hire matching this natural key is
already pending* over a key made of the facts the hire itself supplies. Answer it in the
questionnaire's items 1 and 3 before a contract is written; `ref write-safety` §5 is the double-
submit contract it has to satisfy.

**The second hazard: this is the duplicate-person incident.** The same argument that put an
ALWAYS-GATE on separations applies here from the other direction, and harder. D77's gate is designed
in Phase 0 (doc 00) precisely so it is not discovered at order 9 — a tier-triggered gate would not
have caught the separations incident (`classifyNameSimilarity("Hernandez, Jose Santos", "Santos
Hernandez")` returns `same`), and a duplicate hire is a wrong person created rather than a wrong
person terminated. `ref write-safety` §14 is the gate; the packet leads with DISCONFIRMING evidence
and the approval shape is computed server-side.

**The third: a hire canary is genuinely hard.** Every other row can find a harmless target. There is
no harmless real hire. Expect the controlled-commit proof here to need a configured test instance
(the questionnaire's item 6, `ref clock-config-secrets` §4) rather than a canary, and expect naming
it to be the long pole.

### Dashboard capability delta · onboarding

- [ ] 5.1.7 the roster-ingest surface, and the hire canary's ceremony
- [ ] the server-declared hire gate packet where it differs from the generalized gate capability
- [ ] PROOF T2/T3 for roster ingest and any new gate arm; ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to roster ingest and the genuinely new hire-gate evidence shape

Onboarding reuses every ordinary compiled projection. Its real deltas are roster ingest and, only if
the generalized gate cannot express it, the hire evidence shape: *this person may already exist*
rather than Separations' *this may be the wrong person*. The shape remains the server's to compute,
not the panel's to choose.

## Unassigned shared-capability backlog
<!-- roadmap: cross-cutting -->

<!-- roadmap-status: cross-cutting -->
- [ ] broader legacy settings — DCC1–DCC3 serve and consume only the resolver-owned atomic edit, persisted readback, preflight rerun and read-only doctor; credentials, AI assist, delete/recover and resolver-unowned values remain open (`legacy-route-settings` + `legacy-dashboard-settings`). Doc 04 `{#def-settings}` carries the narrowed deferral
- [x] DCR3 cross-date search authority + transport — the measured current separations corpus has a strict bounded `GET /api/v1/search` route and typed query/page client contract
- [x] DCR4 Separations search surface — the Top Bar defaults to the durable corpus, retains the explicit served-day scope, and renders server order without substituting day rows
- [ ] the screenshots gallery + the artifact-bytes route — no `/api/screenshots`, no `/screenshots/:filename`, no `/api/prep/pdf-page`; the bytes need the same route order 2 builds (`legacy-route-screenshots` + `legacy-route-files`)
- [ ] the three legacy-specific Excel export writers remain. DCR5 separately serves an evidenced operator workbook for an exact DCR3 search snapshot or Activity range; `src/infra/artifacts/xlsx-retention-sink.ts` remains a distinct DURABILITY sink (`legacy-export-export-excel`, `legacy-export-i9-check-tracker`, `legacy-export-spreadsheet`)
- [ ] `test-login` / the setup wizard — no `npm run setup` and no first-run script exists; a fresh checkout is configured by copying `.env.example`. Either build the equivalents with behavioural CLI fixtures and help output, or retire them with evidence (`legacy-tool-ops-setup`, and the `clean` / `compact` pair beside it)
> 2026-08-28 | DCR receive | verified DCR3 search authority/transport, DCR4's Separations Top Bar surface and DCR5's evidenced operator workbook; remaining cross-cutting absences are broader legacy settings, artifact bytes/screenshots, the three legacy-specific exports and setup/test-login
<!-- /roadmap-status -->

**What this section is.** The open capability entries that belong to no single order row. They are
the honest list of where legacy is still ahead, and each is shaped against a real run corpus rather
than invented in planning — which is why two of them are deliberately NOT built yet rather than
merely unfinished.

**The distinction that matters here.** Broader settings, the three legacy-specific exports and the
setup family remain ordinary work waiting for a turn. DCR3–DCR5 deliver search authority/transport,
the Separations Top Bar surface and one evidenced operator workbook against the measured current
corpus. The screenshots gallery still needs the byte route order-2 builds. A deliberate wait carries
a trigger; an ordinary wait carries an owner. Both are named above, and neither is a waiver — cutover
requires zero open entries, so every line here has to end somewhere.

**Where the deferrals live.** Editable settings is doc 04 `{#def-settings}`; the byte path is
`{#def-byte-path}`; cross-date search and the exports are `{#def-search-export}`. This section is
the Phase-3 view of the same facts — what has to CLOSE before cutover — while doc 04 is the
traceback that names each one's trigger.

## Decisions this phase ratified

**D311-D320 are this phase's workflow-authoring, proof and boundary decisions.** D311-D318 ratify
the workflow/compiler and its measurable simplicity, omission, recovery, entry-algebra and deletion
boundaries. D319 ends Phase 3 after Person Lookup/Separations acceptance and requires a verified,
operator-approved admission packet before another workflow receives a numbered phase. D320 keeps
the strict Separations T1b exit and conditionally authorizes 3c-B. The bounded compiler is integrated
and final acceptance remains open at `{#workflow-authoring-model}`.

| D | Where it binds in this doc |
|---|---|
| D58 (round 5, 2026-07-22) | the non-workflow capability closure inventory each migration advances |
| D84 (round 8, 2026-07-23 → 07-26) | the reuse-leverage ordering §Recommended migration order encodes |
| D89 (round 10, 2026-07-31) | step 6 of the playbook — rebuild-ready is not a production flip; one all-at-once cutover |
| D92 (round 10, 2026-07-31) | the live probes are mandatory at the milestones §Live probe status names |
| D150 (2026-08-05) | legacy change accounting is RETIRED — step 4's live selector re-verification is what replaced it |
| D184 (2026-08-09, 2j) | `open` carries a required reason, `status` is the disposition's projection, and a wrong `native` is worse than an honest `open` |
| D191 (round 46, 2026-08-12) | the per-commit gate every step-3 run uses (`test:coverage`) |
| D193 (round 47, 2026-08-12) | the entry point — separations first, the table deliberately NOT re-sequenced |
| D311 (round 121, 2026-09-02) | one tuple workflow/compiler authoring seam; generic dashboard conformance once; T2/T3 only for new capability deltas |
| D312–D316 (round 122, 2026-09-02) | exactly four reuse-only artifacts; complete run-modal omissions; checkpoint resume or root restart; explicit entry algebra; Person Lookup/Separations equivalence followed by deletion |
| D317 (round 123, 2026-09-02) | `workflow` is the authored technical model; `recipe` is analogy only; `workflow.ts` + `defineWorkflow` compile to `CompiledWorkflow` |
| D318 (round 124, 2026-09-02) | transaction-free workflows satisfy T1b through the explicit `live-read` arm with `dryRun=false`, zero transaction nodes and exact zero write-authority deltas; D209 preview semantics remain unchanged |
| D319 (round 125, 2026-09-02) | Phase 3 stops after Person Lookup/Separations acceptance; every other workflow stays unnumbered until its admission packet is verified and operator-approved |
| D320 (round 126, 2026-09-03) | Separations still needs a fresh `met` T1b result on a newly vetted closed Kuali document; once every 3c-A exit condition is green, 3c-B is already authorized to reconcile and close Phase 3 |
| R10 (operator, 2026-08-20; amended D311) | T1 behavior per workflow, T2/T3 per new dashboard capability, the 80 % floor |

A round ratified by a future migration is added here in the same commit that records it, with its
`_phase: 3c_` marker in the ledger.

## Exit criteria

_Origin: the dissolved master plan's §3.2. D319 narrows this phase's checklist to the shared
authoring platform, Person Lookup and Separations. The reusable per-workflow completion contract
remains below for phases created after admission._

### The phase's exit — read this to decide whether 3c is done

| # | Criterion | State at verified baseline `b1b36349` (2026-09-02) |
|---|---|---|
| 1 | D311-D318's workflow/compiler seam is built and equivalent on Person Lookup and Separations | **partial** - the bounded transitional compiler and conformance are integrated; final naming, direct entries, omissions, recovery, `live-read`, four-artifact deletion, guide and T1 acceptance remain |
| 2 | Person Lookup carries its canonical structural and `live-read` T1 pair and its migration record matches the compiled workflow | **open** - D318 resolves the proof contract; R3 owns implementation and evidence |
| 3 | Separations compiles through the same authoring seam without weakening its existing gates, transactions, receipts or recovery contracts | **partial** - transitional equivalence is green; R3 owns final conversion. Unfinished controlled-live proof remains doc 03b work |
| 4 | Generic dashboard and Explorer conformance is green for both acceptance workflows; T2/T3 is added only for a genuinely new behavior | **partial** - transitional conformance is green; final entry kinds and omission/recovery surfaces remain |
| 5 | The author guide, paired root instructions and internal agent pointer all describe the one final authoring path | **open** - R3 work |
| 6 | D319 admission is visible in the roadmap: no unverified workflow is a numbered phase or authorized implementation run | **MET in docs when this change lands** - the former rows remain evidence-only until Phase 3 close removes or extracts them |
| 7 | Nothing in the legacy repository has been deleted, and Person Lookup/Separations legacy paths remain runnable | **MET, and standing** - the legacy repository remains the D89 rollback asset |
| 8 | Every Phase 3c run is integrated and closed: gates green, worktrees removed, local branches deleted, exact tasks archived and residue recorded | **partial** - R1/R2 are closed; R3 and final reconciliation/close remain |

No capability-register zero-open claim, ServiceNow/OnBase probe or unadmitted workflow blocks Phase
3c. Those obligations remain real and move with the first approved phase that requires them or the
final cutover gate. Phase 3c closes only the platform and its two acceptance workflows.

### What "rebuild-ready" means for ONE workflow

Every admitted workflow phase answers all of these before its node goes `[x]`. This is the contract
the playbook's seven steps produce after D319 admission.

- §b completeness checklist applied, with inherited answers cited and only workflow-specific facts,
  deltas and real operator decisions recorded in the migration doc.
- the rebuild repo's `typecheck` + `lint` + `test:coverage` green (D191 — `test:coverage` REPLACED
  the earlier `test` + `test:architecture` pair as the per-commit gate); the workflow's descriptor
  passes `descriptor-coverage`; every commit contract passes `write-safety-contract` (its completion arm +
  probe + probe-policy) and transaction pairing.
- the workflow definition compiles without duplicate authority and passes registry-wide descriptor,
  module, run-modal, timeline/detail and Explorer conformance.
- Workflow/task inputs, outputs, results, commands, details, and evidence parse strict; every UI id,
  scenario id, child result/policy, and subject observation resolves. No raw Page/Locator/selector
  appears outside the system driver.
- **Live dry-run** green against every real system it touches (submit-free).
- Every commit/probe/verify has controlled live evidence on the configured target; unavailable safe
  evidence blocks rebuild-ready status rather than converting dry-run success into a write-safety claim.
- A T2/T3 dashboard scenario exists only for a new interaction or wire arm this workflow introduces;
  reuse of a generic surface is covered by compiler conformance rather than a copied workflow test.
- Old per-system `src` code and tests remain runnable and preserved through initial cutover. A
  capability may become `candidate-for-later-retirement`, but deletion requires separate explicit
  operator authorization after cutover and rollback-window closure.
- Every old service/route/dashboard/CLI/tool capability touched by the workflow has an updated D58
  disposition; every native replacement has evidence. Under D93 the rebuild repo cannot import
  legacy source at all — the old runtime-isolation guard is retired because the property is
  structural. Preserved legacy paths are not deleted by this migration.
- The migration's exact integration row is closed after its green integrated gate: registered and
  physical worktree absent, local feature branch deleted, exact task archived when applicable, and
  any cleanup failure recorded as residue rather than hidden behind the rebuild-ready label.
