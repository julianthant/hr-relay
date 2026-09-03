# 03c · Phase 3c — migrate the remaining workflows

This doc is the dedicated home of **Phase 3c**, tree node `{#migrations}` — the **thirteen**
workflow migrations remaining after separations, spread over **nine order rows** (0–9, minus 8,
which is doc 03b's). The count is recounted here rather than inherited: `config/legacy-capabilities.json`
holds 15 `legacy-workflow-*` entries, and removing separations (order 8) and person-lookup (order 0,
migrated — though its directory stays open until order 1) leaves 13 workflow directories this phase
has to close. Order 1 also puts two MODES on the already-migrated person-lookup, which is a change to
an existing workflow rather than a fourteenth. Phase 3 is four docs: **3a** finishes the dashboard
(`03a`), **3b** finishes separations (`03b`), **3c** is this one, **3d** puts Claude on the same
dashboard as a second actor (`03d`). It holds those tasks, what is done
and what is left, and its exit criteria; contracts it built live in `reference/`. It also hosts
**§Testing tiers** — the shape every migration below adds its tests to — because the tiers are a
property of migrating a workflow, not of any one workflow; the tiers' own normative spec is
`reference/guards-and-tests.md`.

**Phase 3c has two internal gates, not two additional numbered phases.** **3c-A** builds and proves
the workflow-authoring platform. **3c-B** migrates the remaining workflows through it. No order
1–7 or 9 implementation starts until 3c-A closes. “Pantry and recipe” may explain the idea in
conversation, but the target API and plan use the domain terms **task store**, **task**, **workflow
definition**, **worker**, **browser session**, **compiled workflow**, and **workflow run** (D317).
The bounded compiler increment landed before D317 and still uses transitional `recipe` identifiers;
renaming that API and deleting the transitional files are explicit remaining 3c-A work, not a reason
to call the model complete.

## Phase summary
<!-- roadmap: migrations -->

<!-- roadmap-status: migrations -->
- [x] the risk-proof order is fixed and its entry point is chosen — separations (order 8) first, the table deliberately NOT re-sequenced (D84/D193)
- [x] order 0 · person-lookup is migrated and live-proven (D74, run `4ebf7275-0158-49af-a78f-1f37948efb27`); `src/workflows/person-lookup/descriptor.ts` is registered
- [x] D311/D317 ratify the workflow definition and compiler as the new authoring seam; person lookup and separations are its acceptance workflows; “recipe” is analogy only
- [x] 3c-A bounded compiler increment — compatibility fixtures, the transitional compiler, compiler-backed Person Lookup and Separations descriptors/modules, registry-wide generic projection conformance and full gates landed through merge `a40276b6`
- [x] order 1 intake — Person Lookup Search/Match and I-9 lookup migration records, reuse/provenance map and live I-9 login/search evidence landed through merge `b1b36349`; this is intake only, not an implemented order row
- [ ] `{#workflow-authoring-model}` — finish D312–D317: final workflow naming/API, direct entry algebra, omissions, recovery, four-artifact enforcement, author documentation, T1 proof and deletion of redundant authoring declarations
- [ ] 3c-A exit — author guide and agent rules landed, task reuse is discoverable, both acceptance conversions are green, and the old authoring path is deleted
- [ ] 3c-B exit — orders 1 · 2 · 3 · 4 · 5 · 6 · 7 · 9 migrated through that single authoring path
- [ ] orders 1 · 2 · 3 · 4 · 5 · 6 · 7 · 9 — **no descriptor exists for any of them**; `src/control/workflow-registry.ts` registers 7 modules and every one is person-lookup or a separations composition/harness
- [ ] the five declaration-only stores — `i9`, `old-kronos`, `onbase`, `servicenow`, `sharepoint` are `declareDriver(…, "unwired")` with `{}` tasks (`i9` is 4 lines, the other four 9); orders 1, 2 and 7 build them
- [ ] the legacy capability register — **47 open · 20 replaced · 7 native · 4 retired** of 78 (recounted from `config/legacy-capabilities.json`, 2026-08-20); all 47 open name milestone `phase-3-workflow-migration`, and cutover requires zero open
- [x] generic workflow-to-dashboard conformance for the two transitional compiler-backed workflows; the same registry-wide suite must admit each later migration
- [ ] the T1 PROOF lines on every order node, plus T2/T3 only for the first workflow to introduce a new dashboard behavior
- [x] R1 compiler and R2 intake worktrees/branches were removed after verified integration; no Phase 3c worker residue remains from those runs
- [ ] every later run and final Phase 3c close performs the full worktree sweep: verify integration/gates, remove registered and physical worktrees, delete local branches and archive only exact recorded tasks
> 2026-08-20 | docs-cohesion 03c | verified against `src/control/workflow-registry.ts:38-47`, `src/workflows/*/descriptor.ts` (8 files), `src/stores/*` and `config/legacy-capabilities.json` (recount 47/20/7/4 matches the tree's note); left: every order after 0, minus 8
> 2026-08-25 | D266 | the test-only Kuali annotation workflow retired; the registry now holds seven modules and the Kuali finalization T1 pair carries its reusable proof shape
> 2026-09-02 | D317 execution plan | 3c split internally into blocking 3c-A authoring-platform proof and 3c-B migrations; exact ownership, reuse paths, change routing, ten implementation units, documentation package and exit gate recorded; this decision entry itself claimed no implementation
> 2026-09-02 | HEAD `b1b36349` verification | bounded D311 compiler and Order 1 intake are integrated; D312–D317 final authoring/runtime acceptance and all Order 1–7/9 implementations remain open; R1/R2 owned worktrees are closed
<!-- /roadmap-status -->

**Phase 3c is the rest of the program.** Phase 3a built the dashboard every workflow inherits and
3b takes separations — the deepest write — through the safety loop once. Before 3c authors the
**thirteen remaining workflows**, D311/D317 build one workflow-definition/compiler seam so later migrations describe
their business steps without reassembling descriptor, module and dashboard projections by hand.
The phase then migrates the remaining workflows in the order below until the legacy capability
register has no open entry left and the cutover gate (doc 05) can be read.

**What it reads as met before it starts.** From **03a**: the generic surfaces — run modal, queue
row, run detail + timeline, gate ceremony, notifications, archive · activity · explorer, intake and
capture — exist and answer for a workflow they were not written for (Track C proved that once
against a real composed run). D311 makes them compiler projections; a migration builds one only when
it introduces a new capability. From **03b**: the store
task libraries the entry was chosen to force into existence (`ucpath` 10 tasks, `kuali` 10,
`new-kronos` 2, `crm` 2, `separations` 9 service tasks), the ALWAYS-GATE identity approval, the
typed start door (D250/D251/D261), and the behavior the D311 compiler must preserve.

**The honest state at HEAD `b1b36349`.** One of the nine order rows this phase owns is migrated.
`src/control/workflow-registry.ts` still registers seven modules: `person-lookup` (order 0) and the
six separations composition/harness modules (order 8, doc 03b). The new registry-derived compiled
population contains two workflows, Person Lookup and Separations. Their descriptors/modules now
come through `src/base/workflow-recipe.ts`, and equivalence plus generic start/timeline/Explorer
conformance are green. That is the completed bounded D311 increment—not the D312–D317 exit state:
the code still exposes `defineWorkflowRecipe`/`compileWorkflowRecipe`, consumes fragment adapters,
retains authored descriptor/module files, implements neither direct `parallel`/`delegate` entries
nor D313/D314 omission/restart behavior, and has no workflow-authoring guide.

Order 1's migration documents and live I-9 intake evidence are integrated, but its runtime code is
not. **Orders 1, 2, 3, 4, 5, 6, 7 and 9 still have no new descriptor/module/compiled workflow.**
`config/pending-impl-bindings.json` remains the checked-in empty set, so no order is half-bound.
D266 retired the former D135 proof workflow into the Kuali finalization T1 pair rather than treating
testing machinery as an order row.

**The rule every order below inherits.** A migration is not done when its workflow runs. It carries
its **T1 behavior proof**: a structural fixture scenario and live dry-run manifest, plus controlled
evidence for every write. The workflow compiler supplies already-built generic dashboard surfaces and
the registry-wide conformance suite proves that mapping. A workflow owns a separate dashboard
feature task and T2/T3 proof only when it introduces a genuinely new interaction or wire arm
(`ref guards-and-tests` §10.11/§10.12; `ref frontend-backend-integration` §6.8).

## Workflow authoring model — prerequisite to orders 1–7 and 9

<!-- roadmap: workflow-authoring-model -->

<!-- roadmap-status: workflow-authoring-model -->
- [x] DOCS D311 ratified in `ref workflow-model` §1.6, with the dashboard, Explorer and test consequences in their owning references
- [x] DOCS D312–D316 ratify the four-artifact budget, complete pre-start omissions, two recovery choices, explicit workflow-entry algebra and deletion acceptance
- [x] DOCS D317 reserves `workflow` for the authored model: `workflow.ts` + `defineWorkflow` + `WorkflowDefinition`; “recipe” remains analogy only
- [x] PROOF freeze Person Lookup and Separations compatibility targets in red-capable equivalence fixtures (`2e563240`, merged by `6d30d75a`)
- [x] BE land the bounded transitional compiler: tuple groups, typed task references, duplicate/unresolved/cycle refusals, descriptor/module/store/build-manifest derivation and no second runtime (`ebfde1c6`)
- [x] BE route Person Lookup and Separations through that transitional compiler while preserving their existing public descriptor/module behavior (`ebfde1c6`, `d4204106`)
- [x] PROOF derive the compiler-backed registry population and prove current bootstrap/run modal, timeline/detail and Explorer projections for both workflows (`246daab2`, `4555341f`)
- [ ] BE make the existing task-store catalog sufficient to find a task by system, capability, effect, inputs and outputs before an author creates one
- [ ] BE replace the transitional `workflow-recipe.ts`/`defineWorkflowRecipe`/`compileWorkflowRecipe` names with D317's `workflow.ts`/`defineWorkflow`/`compileWorkflow`/`WorkflowDefinition`/`CompiledWorkflow`; do not leave aliases or a second authoring seam
- [ ] PROOF enforce the exact four authored artifacts for a reuse-only workflow; reject descriptor/module/registry/dashboard glue outside `workflow.ts`
- [ ] BE replace fragment adapters with the closed direct `task | parallel | delegate | gate | transaction` entry algebra, including stable entry/leaf ids, explicit parallel join/failure policy and independent leaf retry
- [ ] BE finish derivation of store/session requirements, graph/result, registry/build-manifest and all generic surfaces from the final workflow definition; retain the already-green transitional derivations as compatibility proof
- [ ] PROOF pin automatic runtime inheritance—worker/session acquisition, authentication, checkpoints, semantic logs, screenshots, receipts, notifications and Archive—without workflow-specific glue
- [ ] BOTH finish Person Lookup as the smallest four-artifact equivalence proof: final API/file, no authored descriptor/module path and its missing canonical T1 structural/live pair
- [ ] BOTH finish Separations as the completeness proof: final API/file, direct entries, no redundant descriptor/module/node-fragment authoring path, and preserved gates, screenshots, logs, write safety and public wire
- [ ] BOTH make the run modal the complete omission authority: whole-step skip, all custom values schema-valid before start, no mid-run value request, separate mandatory verifiers remain selected
- [ ] BOTH expose Resume from checkpoints and Restart from start; fresh restart reruns reads/computes but never re-executes a completed write
- [x] BOTH project the current tuple groups through the existing run modal/timeline/detail and Explorer paths; re-run this conformance after the final D317 conversion
- [ ] PROOF extend the landed registry-wide conformance suite to every direct entry kind, then remove superseded declarations and only genuinely duplicate generic-dashboard tests
- [ ] DOCS write `docs/guides/workflow-authoring.md`, add the concise authoring rules to the paired root `AGENTS.md`/`CLAUDE.md`, and add one internal agent reference that points to the guide rather than redefining it
- [ ] PROOF follow the finished author guide to author both acceptance workflows; any undocumented step or required legacy escape hatch fails 3c-A
- [x] DOCS re-scope each remaining `Dashboard · wire` row to the capability delta that order actually introduces; generic rows inherit compiler conformance
> 2026-09-02 | D311 bounded implementation | `a40276b6` integrates compatibility fixtures, a transitional compiler, two descriptor/module conversions and generic conformance; R1's report explicitly carries D312–D317 completion into the next run
> 2026-09-02 | remaining 3c-A | task discovery, D317 rename/final API, direct entry algebra, four-artifact guard, D313 omission, D314 recovery, final acceptance deletion/T1 and author docs remain open
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
2. **PARTIAL — Finish the authored types and terminology.** The transitional API already validates
   tuple/group ids, typed task references, duplicate ids/tasks, unresolved references and cycles.
   Replace its `recipe` names with D317's final workflow names, add direct explicit `parallel`,
   `delegate`, `gate` and `transaction` entries, and remove fragment-adapter authoring. Gate: every
   entry kind compiles and its implicit/invalid control shapes fail by name; no old alias remains.
3. **DONE, REVERIFY AFTER UNIT 2 — Build the compiler core.** The transitional compiler derives
   graph nodes/edges, result dependencies,
   required task stores/sessions, descriptor compatibility output, registry value and build-manifest
   closure without a second runtime. Evidence: `ebfde1c6`; final gate reruns after unit 2 removes the
   transitional seam.
4. **DONE, REVERIFY AFTER UNIT 2 — Build generic projections.** The current tuple groups reach
   bootstrap/start, run modal, timeline/detail and Explorer through one registry-derived conformance
   suite. Evidence: `246daab2` and `4555341f`; extend it to every final direct entry kind.
5. **NEXT — Finish omission admission.** A whole omitted timeline group executes no entry; its complete
   replacement values are schema-valid before start; no worker asks for values mid-run; any
   mandatory verifier is a separate selected entry. Gate: D313's refusal and provenance matrix.
6. **OPEN — Finish recovery choices.** Expose Resume from checkpoints and Restart from start. Root restart
   reruns reads/computations, reuses validated completed-write proof without prepare/commit, probes
   unfinished writes first and refuses a fresh-fact mismatch. Gate: mutation proof that a completed
   external write cannot execute twice.
7. **PARTIAL — Finish Person Lookup.** Its descriptor/module are transitional compiler products and
   public equivalence is green. Move authorship to final `workflow.ts`, delete authored
   descriptor/module glue, add the missing canonical T1 structural/live pair and prove the
   four-artifact budget.
8. **PARTIAL — Finish Separations.** Its descriptor/module are transitional compiler products and
   public equivalence is green. Express the complete timeline, D313 omissions, conditional gate, transactions,
   screenshots/logs and result through `workflow.ts`; prove exact compatibility. Gate: its existing
   public behavior and safety evidence remain green—this conversion does not discharge Phase 3b's
   still-open controlled writes.
9. **PARTIAL — Delete the old authoring path.** The bounded increment removed manual timeline/flow
   assembly and six redundant step-category exports. Remove the remaining authored descriptors,
   modules, fragment adapters,
   registry wiring and duplicate generic-dashboard tests for both acceptance workflows. Gate: an
   architecture guard fails if the retired path or an “advanced escape hatch” returns.
10. **OPEN — Prove the author experience.** Make one grouping/options-only fixture change in `workflow.ts`,
    compile it, and prove no other authored workflow file changes. Follow the finished author guide
    from a clean context for both acceptance workflows; any undocumented required step is a defect.
11. **OPEN FOR EACH FUTURE RUN — Close the worktree lifecycle.** After verified integration and the
    integrated gate, run the worktree sweep: remove each registered and physical run/worker
    worktree, prune, delete its local feature branch, archive only the exact recorded task, and
    record any residue. R1 and R2 already passed this close; every later run and the final phase must
    pass it independently.

**Next runnable supervisor scope (3c-A finish).** Begin from integration HEAD `b1b36349` plus this
plan update. In order: (1) reconcile the task-store catalog and D317 final names/API; (2) enforce the
four-artifact boundary and finish the direct entry algebra; (3) implement D313 omission admission;
(4) implement D314 recovery; (5) finish Person Lookup and Separations deletion/T1/guide acceptance;
(6) run manifest, typecheck, lint, coverage, architecture, parity and workflow proofs; (7) integrate
and perform the exact worktree sweep. Do not start Order 1 implementation inside this run.

**Worktree-capacity preflight.** The 2026-09-02 read-only audit found the Phase 3c R1/R2 branches and
worktrees closed, but eight registered auxiliary `feature/test-*` worktrees owned by the separate
test-suite-rationalization program still occupy the shared repository. One currently carries an
untracked `node_modules`. They are not Phase 3c cleanup targets and must not be removed or
repurposed. Before dispatching writable 3c-A workers, re-audit the shared worktree budget and wait
for that owning program to close enough slots; a coordinator may continue read-only planning while
capacity is unavailable.

### 3c-A documentation package — required before migration work

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

### 3c-A exit gate — when 3c-B may start

3c-B remains blocked until all of the following are true together: the compiler and generic
projections are built; omission and both recovery choices are built; Person Lookup and Separations
are equivalent; their redundant authoring declarations are deleted; the four-artifact guard is
green; the practical guide and agent pointers are landed; and the integrated typecheck, lint,
coverage, architecture, parity and both workflow T1/live-dry-run proofs are green. Passing unit tests
while retaining a second authoring path does not close 3c-A. The run closes only after its integrated
worktree sweep proves no 3c-A worktree, local feature branch or exact task residue remains.

## 3c-B · Migrate the remaining workflows

## The seven-step migration playbook

This is the safety loop an agent follows for one workflow after the D311 compiler exists. Separations
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

**4 · Live selector re-verification, then the live dry run.** Live access is pre-authorized and
always available (CLAUDE.md's standing authorization) — never ask. Legacy change accounting is
RETIRED (D150): the protection against a stale ported selector is re-verifying it against the LIVE
page at this migration, not diffing legacy's copy. Then run the workflow with `dryRun=true` against
every real system it touches and assert that prepare previews exist while commit spans, write
intents and mutation helpers are ABSENT. Write the dry run down as a scenario rather than typing it
again: `tests/scenario/workflows/<id>/dry-run.scenario.ts` is the checkpoint manifest
(`ref guards-and-tests` §10.4) — nodes reached and nodes excluded, the `run_checkpoints` rows keyed
`(workflow, item, node, attempt, claimGeneration?)` (D214/D221), the `gate_results` row if it gates,
`write_intents` / `write_attempts` / `durable_outbox` deltas of **zero**, the receipt shape, the
preview terminal. Register its canary subjects by LABEL in `config/test-subjects.json`
(`ref guards-and-tests` §10.5) — sensitive values stay in `.env` behind `src/domain/secrets.ts`, and
a missing subject reports `blocked: needs <label>`, never `failed`, because a canary decays
(separations §9.16: doc 4524's action was completed between two passes and the read that made it a
candidate stopped working). **Gate:** the dry run green, its manifest committed, its result recorded.

**5 · The controlled-commit proof — write workflows only.** Exercise each new commit / probe /
verify against a configured test instance or a deliberately harmless, operator-approved canary,
under `ref write-safety` §3.2's contract: dry run with zero durable rows, a forced subject mismatch
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

## Recommended migration order (by risk / complexity / reuse)

_Origin: the dissolved master plan's §3.3; its order-8 prerequisite block lives in
`00-design-the-foundation.md` §ALWAYS-GATE identity approval, because D77 pulled that design into
Phase 0. Re-verified against the code on 2026-08-20 — the ordering and its argument stand, and the
per-row detail is in the §Order N sections below._

**The ordering objective, made explicit (D84, amended by D88/D89).** Production availability does
not vary by migration order because legacy automation remains authoritative until one final
cutover. The order optimizes **total rebuild delivery time** by maximizing reuse leverage—each
migration must make the next cheaper — which is what the risk-ordered sequence below already does
(reads populate the stores every later workflow draws from; the OCR service pipeline unblocks four
consumers; the write-heavy workflows land last on top of everything).

**The trade this makes, stated plainly.** Onboarding and separations migrate last (orders 8–9).
That is deliberate: they are the highest-stakes writes, they reuse the most, and doing
them early would mean proving the write-safety contract on the two workflows least able to absorb
a contract flaw. The existing workflows continue serving production while this sequence runs, and
the separations identity-approval gate (doc
ref write-safety §14) is designed in Phase 0 rather than at order 8, so nothing about that workflow is
discovered late. If a dependency or evidence target becomes the binding constraint, this order is
the thing to revisit.

**Read this table beside the entry choice (D193, 2026-08-12).** The operator entered Phase 3 at
**order 8, separations** — see §3.1's entry block for the store-population reasoning. The table is
deliberately **not** re-sequenced: it is the risk-proof ordering and its argument above still holds,
so the entry buys the deepest proof first rather than making it cheaper. Nothing here is waived —
separations owes every §3.2 criterion, and the remaining orders keep their relative sequence for
whatever is taken up next.

Read-only and simple first (populate the read stores, low blast radius); OCR/approval flows next
(exercise the completion union + gates); write-heavy last (the write-safety contract's real test),
with the two **incident** workflows (onboarding duplicate-person, separations wrong-person) dead
last as the highest-stakes proofs.

| Order | Workflow(s) | Class | One-line justification |
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

**The register, recounted at HEAD (2026-08-20).** `config/legacy-capabilities.json` holds **78**
entries: **47 open · 20 replaced · 7 native · 4 retired** (`status` projects the same split as
`open 47 / implemented 27 / retired 4`, since `native` and `replaced` both project to
`implemented`). **Every one of the 47 open entries names milestone `phase-3-workflow-migration`** —
there is no open entry owned by a phase that has already shipped, which is what D184's sweep fixed
and what the guard now refuses to let rot again. Cutover requires zero open
(`cutoverRequiresZeroOpen: true` in the file's own header), so this table IS the phase's finish line.

| Kind | Open | What closes them |
|---|---|---|
| `service` | 16 | 15 are `legacy-workflow-*` — one per order row below, closing at that row's migration — plus `legacy-service-llm` |
| `route` | 14 | the byte/search/screenshot/settings/static families; several close together because they share the artifact-bytes route |
| `dashboard` | 7 | OCR review (order 3), oath-upload (order 7), settings, navigation, capture, log panel, workflow modifier |
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
owes its T1 pair (the structural fixture scenario and dry-run manifest). T2/T3 are added only when
that workflow introduces a new dashboard interaction or wire arm; reused generic projections are
covered once by registry-wide workflow/compiler conformance. The normative spec — folder layout, file naming,
the vitest project per tier, the run policy, the subject registry, the durable result row — is
`reference/guards-and-tests.md` (R10, 2026-08-20).

## Order 0 · person-lookup
<!-- roadmap: order-0 -->

<!-- roadmap-status: order-0 -->
- [x] the workflow exists and is registered — `src/workflows/person-lookup/descriptor.ts` + `module.ts`, tuple entry in `src/control/workflow-registry.ts`
- [x] it ran LIVE against real UCPath + CRM (D74, 2026-08-04): run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, recovered a dead CRM session mid-run and terminalized `done` at attempt 2
- [x] the store tasks it forced into existence — `ucpath/search-person-org`, `crm/read-onboarding-record`, `crm/read-onboarding-dates`, `person-lookup/read-active-status`
- [ ] PROOF T1 — no `tests/scenario/workflows/person-lookup/` exists; the structural fixture scenario and the dry-run manifest are both unwritten (`ref guards-and-tests` §10.11)
- [ ] the legacy capability entry `legacy-workflow-person-lookup` stays **open**, correctly: legacy's `crm-search.ts` / `match.ts` / `outcome.ts` have no rebuild counterpart, and those are order 1's Search + Match modes
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

**What it still owes.** Its T1 pair, like every other workflow — the tiers were specified after it
shipped. And its legacy directory does not close here: order 1 is what closes it.

### Dashboard · wire person-lookup
<!-- roadmap: order-0-dash -->

<!-- roadmap-status: order-0-dash -->
- [x] run modal — name / EID typed inputs and the start plan (`ref frontend-backend-integration` §5.1.1)
- [x] queue row — the person-lookup row with status and timing, after D123/D124/D126 (§5.1.2)
- [x] run detail — timeline, receipt, Context rail; the two-pixel panel D187 found and fixed (§5.1.3)
- [x] archive · activity · explorer — person-lookup rows appear through the generic surfaces (§5.1.5)
- [x] D311 bounded acceptance — the transitional compiler reaches these projections and registry-wide comparison is green (`ebfde1c6`, `246daab2`, `4555341f`)
- [ ] D312–D317 final acceptance — final `workflow.ts`, no authored descriptor/module glue, four-artifact guard and canonical T1 pair
> 2026-09-02 | D311 | retained as historical acceptance evidence; no duplicate generic-surface T2 is required
<!-- /roadmap-status -->

The first wiring, done in 1i-spine before the `Dashboard · wire` template existed — which is why it
has four squares rather than seven: person-lookup does not gate, raises no park notification and
consumes no intake, so §5.1.4, §5.1.6 and §5.1.7 have nothing to declare. That is the template
working, not a gap: a square is absent when the workflow has nothing to put in it, and present-but-
empty when the wire has not been run.

## Order 1 · person-lookup Search + Match · i9-lookup
<!-- roadmap: order-1 -->

<!-- roadmap-status: order-1 -->
- [x] the §b completeness pass for person-lookup Search + Match and i9-lookup — `docs/migrations/person-lookup.md` and `docs/migrations/i9-lookup.md`, plus the REUSE/CUSTOMIZE/BUILD and live I-9 map, integrated by `b1b36349`
- [ ] Search + Match as MODES on the existing person-lookup descriptor (D15, `ref dashboard-surfaces` §9) — nothing in `src/workflows/person-lookup/descriptor.ts` carries a mode today
- [ ] the `i9` store — `src/stores/i9/index.ts` is 4 lines: `defineBrowserStore("i9", declareDriver("i9", "unwired"), i9Session, {})`. No driver, no login recipe, **zero tasks**
- [ ] the `i9-lookup` workflow descriptor + module + registry tuple entry
- [ ] PROOF T1 — structural fixture scenario + dry-run manifest per workflow; T3 only for the new mode interaction
- [ ] the capability entries `legacy-workflow-i9-lookup` and `legacy-workflow-person-lookup` both close here
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/i9/index.ts:4` (unwired, `{}` tasks) and `src/workflows/person-lookup/descriptor.ts` (no mode); nothing is built — this row is a plan
> 2026-09-02 | Order 1 intake | migration decisions, exact task/driver seams, provenance and current live login/search evidence integrated by `b1b36349`; runtime implementation and T1 remain open behind 3c-A
<!-- /roadmap-status -->

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
<!-- roadmap: order-1-dash -->

<!-- roadmap-status: order-1-dash -->
- [ ] BOTH generic workflow-declared mode chooser — Search and Match are two run-modal options of one workflow without a second workflow identity
- [ ] PROOF T2/T3 only for that mode interaction; i9-lookup's ordinary start/queue/detail/archive projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped from six repeated wires to the one new mode capability
<!-- /roadmap-status -->

The surfaces exist. The one capability delta must get the **mode** right: the
run modal has to offer Search and Match as two rows of one workflow, and the queue row has to name
the subject differently per mode without minting a second workflow class.

## Order 2 · crm-doc-download · sharepoint-download · old-kronos-reports
<!-- roadmap: order-2 -->

<!-- roadmap-status: order-2 -->
- [ ] the §b completeness pass for all three workflows — inherited answers cited and workflow-specific deltas recorded
- [ ] the `sharepoint` and `old-kronos` stores — 9 lines each, `declareDriver(…, "unwired")`, zero tasks
- [ ] CRM document download on the EXISTING crm driver — `src/stores/crm/tasks/` holds two read tasks and no download
- [ ] downloads land as content-addressed immutable artifacts (`artifact-effect-boundary`, `ref guards-and-tests` §3.7)
- [ ] the artifact-bytes route — there is **no** endpoint serving artifact bytes today; the only byte-serving route in the tree is the phone's own `GET /api/v1/capture/phone/photos/:photoId/bytes` (`legacy-route-files`, still open)
- [ ] PROOF T1 per workflow; T3 only for the download viewer capability
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/sharepoint/index.ts`, `src/stores/old-kronos/index.ts` (both unwired, `{}` tasks), `src/stores/crm/tasks/` (2 read tasks) and `config/legacy-capabilities.json`'s `legacy-route-files` reason; nothing built
<!-- /roadmap-status -->

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
<!-- roadmap: order-2-dash -->

<!-- roadmap-status: order-2-dash -->
- [ ] the download viewer — the artifact-bytes route plus a per-run downloads tile (`ref frontend-backend-integration` §3.6)
- [ ] PROOF T2/T3 for download availability, verified bytes and refusal; ordinary projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped from six repeated wires plus viewer to the viewer capability alone
<!-- /roadmap-status -->

The extra square here is a real build, not a wire: the run-detail `captures` section is schema'd
and DECLARED-UNSERVED today — `config/pending-wire-bindings.json` carries
`RunDetailSectionResponseSchema#captures` as `declared-unserved` (D184), `availableSections` cannot
return it, and the bytes behind it are unrouted (03a's finding). This capability is where a downloaded
document becomes something the operator can open.

## Order 3 · the OCR pipeline workflow
<!-- roadmap: order-3 -->

<!-- roadmap-status: order-3 -->
- [ ] the §b completeness pass for the OCR pipeline — inherited answers cited and workflow-specific deltas recorded
- [x] the four service stores it consumes are BUILT (2h) — `extraction` (`extract-pdf-pages`, `extract-spreadsheet`), `ocr` (`extract-form-page`), `normalization` (`read-contact-advice`), `roster` (`match-spreadsheet`)
- [ ] the OCR pipeline WORKFLOW over them — no descriptor exists; this order migrates the pipeline on top of stores that already work
- [ ] D189/D294's byte path — the production BFF serves **no frontend bytes**: `src/server/dashboard/http-server.ts` has no static handler and `dashboard:prod` names a mode the runtime never parsed
- [ ] PROOF T1; T3 only for the Review capability
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/{extraction,ocr,normalization,roster}/tasks/`, `src/control/workflow-registry.ts:194` and `config/legacy-capabilities.json`'s `legacy-route-static` reason; the stores are real, the workflow is not
<!-- /roadmap-status -->

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
<!-- roadmap: order-3-dash -->

<!-- roadmap-status: order-3-dash -->
- [ ] the OCR review UI — the expanded page ↔ extracted-text pair, approve / reject / retry page, ONE atomic correction list (never a collapsed table; the 2026-07-24 layout ratification)
- [ ] the review/approve commands + progressive record patches over the SSE stream
- [ ] the run-detail **Review** panel BODY — `review` is in `TAB_ORDER` but `availableSections` can never return it, so the tab is structurally unreachable and `UnservedTab` is dead code (03a's finding)
- [ ] PROOF T2/T3 for Review; start/queue/timeline/intake/archive projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped to the first real Review capability and its commands
<!-- /roadmap-status -->

The largest dashboard capability delta in the doc is mostly a build. The OCR review
surface is not a generic surface a migration inherits: `ref data-intake-and-edit-data` §4.3's three
producers admit identically, and `ref dashboard-surfaces` §9's D7/D8/D10 shape the review row
(extracted count while still at review, approval only after Review, depth-2 delegated lookups
visible only from the review row). It lands WITH this workflow, by the ordering's own argument —
building it earlier would shape a review UI against no corpus.

## Order 4 · oath-signature · emergency-contact
<!-- roadmap: order-4 -->

<!-- roadmap-status: order-4 -->
- [ ] the §b completeness pass for oath-signature and emergency-contact — inherited answers cited and workflow-specific deltas recorded; both still need an operator-approved controlled-commit target
- [ ] the first operation FAN-OUT and its approval gates, exercised through the real OCR review UI
- [ ] the `oath-signature` and `emergency-contact` descriptors + modules + tuple entries
- [ ] the first non-separations controlled commits — a bounded UCPath enter/fill, under `ref write-safety` §3.2
- [ ] PROOF T1 per workflow; T3 only for the new gate/Group People capability
> 2026-08-20 | docs-cohesion 03c | nothing built; `RunShapeSchema`'s `operation` / `operation-member` arms still have no producer, so every group surface below is drawn against a shape no run has had
<!-- /roadmap-status -->

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
<!-- roadmap: order-4-dash -->

<!-- roadmap-status: order-4-dash -->
- [ ] the generalized server-declared gate packet this workflow's approval requires (`ref write-safety` §14.11)
- [ ] Group People — paged members, rollup and containment over REAL operation members
- [ ] the group People panel BODY — declared in `TAB_ORDER`, never servable (03a's finding, same shape as order 3's Review tab)
- [ ] PROOF T2/T3 for the new gate shape and Group People; ordinary projections ride compiler conformance
> 2026-09-02 | D311 | re-scoped to two new capabilities: generalized gate packet and Group People
<!-- /roadmap-status -->

The gate square is not optional here and it is not separations' gate: `ref write-safety` §14.11's
rule is that the approval SHAPE is computed by the server, never chosen by the frontend, because a
frontend free to choose it can quietly turn every gate into one click — which is §14.6's
rubber-stamping risk manufactured by accident. Group People is the other real build: D11 says one
member presentation at every count, D14 says a group of one still renders as a group row, D9 says
rejected members never count toward done, and D16 says cancelling a group is tree-scoped and final.

## Order 5 · i9-check
<!-- roadmap: order-5 -->

<!-- roadmap-status: order-5 -->
- [ ] the §b completeness pass for i9-check — inherited answers cited and workflow-specific deltas recorded
- [ ] the operation coordinator AT SCALE — member enqueue, display-only rows, the join; `ref dashboard-surfaces` §7 and `ref execution-and-sessions` §8 are the same worked example from two sides
- [x] the stable-keyed idempotent workbook SINK exists — `src/infra/artifacts/xlsx-retention-sink.ts` proves `ref data-intake-and-edit-data` §4.1's contract (duplicate key is a verified no-op, changed record is an in-place update, rows sorted by stable key, atomic replace)
- [ ] the sink is NOT composed in production (D164) — no descriptor declares a projection, so nothing writes a workbook today
- [ ] the operator-facing workbook layout — the sink's four columns (`stableKey`, `keyValues`, `record`, `projectedAt`) are deliberately the DURABILITY layout; the real column set belongs to this migration, which knows the real fields
- [ ] the first Excel EXPORT writer (`legacy-export-i9-check-tracker`, open)
- [ ] PROOF T1; T3 only for retention/export behavior
> 2026-08-20 | docs-cohesion 03c | verified against `src/infra/artifacts/xlsx-retention-sink.ts`'s own header (it names this migration as the owner of the display layout) and `config/legacy-capabilities.json`; the durability half is built, the workflow and the display half are not
<!-- /roadmap-status -->

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
<!-- roadmap: order-5-dash -->

<!-- roadmap-status: order-5-dash -->
- [ ] member rows carrying retention status, and the workbook export control
- [ ] PROOF T2/T3 for retention status and export; Group People and ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to retention status and workbook export
<!-- /roadmap-status -->

This capability delta reuses order 4's group surfaces and adds two things: a member row that
shows RETENTION status (which is a fact about a document's lifecycle, not about the run), and the
export control. D17 — per-member confirmation numbers inline on the packet receipt — is the receipt
detail this row is the first to need.

## Order 6 · work-study · kronos-pay-rule
<!-- roadmap: order-6 -->

<!-- roadmap-status: order-6 -->
- [ ] the §b completeness pass for work-study and kronos-pay-rule — inherited answers cited and workflow-specific deltas recorded; both still need an approved controlled-commit target
- [x] the `new-kronos` store exists with a driver, a session provider and two READ tasks — `read-separation-timecard`, `search-employee` (D196, `ref task-contract` §2.9); separations chunk 1 built it
- [ ] the new-kronos WRITE family — the pay-rule commit contracts; the store has no write path today
- [ ] the `work-study` and `kronos-pay-rule` descriptors + modules + tuple entries
- [ ] the canonical-EID audit gate — replay real stored / fixture inputs through `EidSchema` (`src/domain/ids.ts:184`, `/^10\d{6}$/`) and surface every rejection
- [ ] PROOF T1 per workflow; T3 only for the run-constant interaction
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/new-kronos/tasks/` (two read tasks, no write) and `src/domain/ids.ts:184`; the store is half-built by separations and the write half is this order
<!-- /roadmap-status -->

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
<!-- roadmap: order-6-dash -->

<!-- roadmap-status: order-6-dash -->
- [ ] the intake grid's constants entry + its unbind arm (`effectiveDate`, D172/D173)
- [ ] PROOF T2/T3 for bind/unbind of the run constant; intake and ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to the constants interaction alone
<!-- /roadmap-status -->

The intake workspace exists (2i-E3, `ref dashboard-surfaces` §9.7.1) and this sub-task adds the one
thing a write workflow needs from it: a CONSTANT the operator supplies once for a whole sheet — an
effective date — rather than per row, and an unbind arm that takes it back off. `ref
data-intake-and-edit-data` §2.8 is D172/D173's as-built union resolution behind it.

## Order 7 · oath-upload · onbase
<!-- roadmap: order-7 -->

<!-- roadmap-status: order-7 -->
- [ ] the §b completeness pass for oath-upload and onbase — inherited answers cited and workflow-specific deltas recorded
- [ ] the `servicenow` and `onbase` stores — 9 lines each, `declareDriver(…, "unwired")`, zero tasks, no login recipe
- [!] the ServiceNow `receipt` probe — **the operator must name a live probe target**; §Live probe status has carried this as ⏳ since D92
- [!] OnBase `upload-verify` **or** an argued `unverifiableByPage` → always-park — **blocked: no probe target exists today**, and it is gated on the next real document upload
- [ ] oath-upload's born-at-upload fence (`ref dashboard-surfaces` §4.5)
- [ ] PROOF rebuild-verified propagation windows for ServiceNow (`ref write-safety` §4.2; doc 04 `{#def-propagation}` carries the deferral)
- [ ] PROOF T1 per workflow; T3 only for the receipt capability delta
> 2026-08-20 | docs-cohesion 03c | verified against `src/stores/servicenow/index.ts`, `src/stores/onbase/index.ts` (both unwired, `{}` tasks) and §Live probe status; TWO of this row's blockers need the operator, not an agent
<!-- /roadmap-status -->

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
<!-- roadmap: order-7-dash -->

<!-- roadmap-status: order-7-dash -->
- [ ] the ServiceNow ticket receipt and the OnBase upload-verify on the run-detail receipt (`ref operator-trust` §2.3)
- [ ] PROOF T2/T3 for those receipt arms or the explicit always-park arm; ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to the two new completion-proof presentations
<!-- /roadmap-status -->

The receipt square is the one that carries this row's risk onto the screen. `ref operator-trust`
§2.3 is the receipt contract: a `HRC0…` ticket number is a real completion proof and an unverified
upload is not, and the panel has to say which of the two it is holding. D237/D238's rule applies
directly — a label and a derived verdict describing the same run must not be derived twice.

## Order 9 · onboarding
<!-- roadmap: order-9 -->

<!-- roadmap-status: order-9 -->
- [ ] the §b completeness pass for onboarding — inherited answers cited and workflow-specific deltas recorded; it still needs an operator-approved HIRE canary
- [ ] the hire probe with the **no-EID key** — `probeVerdictSchema` today has four arms (`present` · `absent` · `ambiguous` · `unknown`, `src/domain/write-safety-primitives.ts:50`) and every permanent key in the tree is EID-derived; a hire has no EID until it lands
- [ ] roster ingest (`ref data-intake-and-edit-data` §4; the `roster` store's `match-spreadsheet` exists, the ingest workflow does not)
- [ ] the onboarding composition over the `ucpath` / `crm` / `kuali` / `new-kronos` stores
- [ ] PROOF T1; T3 only for roster ingest or a new hire-gate arm
> 2026-08-20 | docs-cohesion 03c | verified against `src/domain/write-safety-primitives.ts:50-63` and `src/stores/roster/tasks/`; nothing built, and this row's canary is a `you:` line that has no cheap answer
<!-- /roadmap-status -->

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
<!-- roadmap: order-9-dash -->

<!-- roadmap-status: order-9-dash -->
- [ ] 5.1.7 the roster-ingest surface, and the hire canary's ceremony
- [ ] the server-declared hire gate packet where it differs from the generalized gate capability
- [ ] PROOF T2/T3 for roster ingest and any new gate arm; ordinary projections are reused
> 2026-09-02 | D311 | re-scoped to roster ingest and the genuinely new hire-gate evidence shape
<!-- /roadmap-status -->

Onboarding reuses every ordinary compiled projection. Its real deltas are roster ingest and, only if
the generalized gate cannot express it, the hire evidence shape: *this person may already exist*
rather than Separations' *this may be the wrong person*. The shape remains the server's to compute,
not the panel's to choose.

## Cross-cutting Phase 3 capabilities (no single order)
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

**D311–D317 are this phase's workflow-authoring decisions.** They ratify the workflow/compiler and its
measurable simplicity, omission, recovery, entry-algebra and deletion boundaries before another
migration starts; the bounded compiler is integrated and the final acceptance work remains open at
`{#workflow-authoring-model}`. The rest of the
table is the standing set ratified elsewhere that still binds every order row.

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
| R10 (operator, 2026-08-20; amended D311) | T1 behavior per workflow, T2/T3 per new dashboard capability, the 80 % floor |

A round ratified by a future migration is added here in the same commit that records it, with its
`_phase: 3c_` marker in the ledger.

## Exit criteria

_Origin: the dissolved master plan's §3.2 — the per-workflow criteria every migration answers,
separations included. Re-verified and re-stated below as the PHASE's own checklist first, with each
line's MET/open state at HEAD, then the per-workflow contract each order row is held to._

### The phase's exit — read this to decide whether 3c is done

| # | Criterion | State at HEAD `b1b36349` (2026-09-02) |
|---|---|---|
| 1 | D311–D317's workflow/compiler seam is built, equivalent on person lookup and separations, and every remaining order row has been through the resulting migration loop | **partial** — the bounded transitional compiler, two compiler-backed descriptors/modules and equivalence are integrated; final workflow naming, direct entries, omissions, recovery, four-artifact deletion/guide/T1 acceptance and orders 1–7/9 remain open |
| 2 | Every migrated workflow is marked **rebuild-ready** with its live dry run green and, for writes, its `ref write-safety` §3.2 controlled-commit proof recorded | **open** — order 0 is a read and predates the tiers; no other row has run |
| 3 | Every workflow definition passes generic dashboard/Explorer conformance; every genuinely new surface capability has its one feature task and T2/T3 proof | **partial** — registry-derived conformance is green for transitional compiler-backed Person Lookup and Separations; final entry kinds and every later workflow/capability remain |
| 4 | Every order row carries its **T1** pair (structural fixture scenario + dry-run manifest), with T2/T3 only for dashboard behavior it introduces | **open** — Separations has its pair; Person Lookup's canonical pair was deliberately deferred, the read-only T1 live-proof contract is unresolved, and orders 1–7/9 have none |
| 5 | The four live probes are settled: each system produces a typed completion proof or an argued `unverifiableByPage` | **open** — 2 of 4. Kuali and UCPath are RESOLVED and BUILT; ServiceNow needs a named target and OnBase has none |
| 6 | `config/legacy-capabilities.json` has **zero open entries** — every one advanced to `native` / `replaced` / `retired` with evidence | **open** — 47 of 78 open, all owned by this phase |
| 7 | The §Cross-cutting capabilities are built or retired with evidence | **open** — none of the five is started |
| 8 | Nothing in the legacy repository has been deleted, and every preserved path is still runnable | **MET, and standing** — it is the D89 rollback asset for the whole phase |
| 9 | Every Phase 3c run is integrated and closed: integrated gate green, registered/physical worktrees removed, local feature branches deleted, exact tasks archived, residue recorded | **partial** — R1 compiler and R2 intake are closed; the phase integration branch and all future runs remain. Eight unrelated `feature/test-*` worktrees are preserved for their owning program and are not Phase 3c residue |

Criterion 8 is fully met. Criteria 1, 3 and 9 are partial; every other criterion remains open. The
bounded compiler and Order 1 intake reduce the remaining work, but no new order row is rebuild-ready.

### What "rebuild-ready" means for ONE workflow

Every order row answers all of these before its node goes `[x]`. This is the contract the playbook's
seven steps produce, restated as the thing to check at the end.

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
