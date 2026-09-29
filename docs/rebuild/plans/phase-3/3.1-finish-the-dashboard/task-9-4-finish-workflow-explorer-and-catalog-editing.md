# Task 3.1.9.4 · Finish Workflow Explorer and catalog editing
<!-- roadmap: dash-explorer -->

**Current delivery: complete — 2026-09-17.** Accepted candidate
`2ec017d992d74190d54a3af0cd052192294c5e7a` is incorporated into local master through
`931e283ab263a26a556aad33ac49c5eeca51a407`. Required focused child/group gates, integration
and owned cleanup are complete; see the [finalizer closure](task-9-8-finalization-dashboard-surfaces.md#accepted-integration-and-group-closure--2026-09-17).
Full acceptance remains 3.1.19. Earlier dated plan/freeze receipts below retain their historical state.

**Current assignment: 3.1.9.4.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. The approved execution brief below binds this child's surface, client and proof paths. Shared registration and generated outputs remain reserved.

- [x] Consume the accepted D337 SQLite authority from [3.1.9](task-9-establish-independent-dashboard-boundaries.md#approved-execution-brief--2026-09-13). Preserve label/icon/category editing, validation, conflicts, preview/diff, exact replay and hot readback through its isolated service ports.

**Operator allocation — 2026-09-13.** The complete persistence conversion, migration, command/audit
transaction, reader/writer cutover, old-protocol retirement and conversion/recovery proof belong to
3.1.9. This child owns the editor and its surface/service acceptance over that accepted authority;
it does not reopen shared SQLite, kernel or composition ownership. Historical Task 9-4 conversion
references describe the earlier allocation.

- [x] Complete graph/catalog reads and validated presentation preview/diff/revision/hot-apply;
  prove invalid, cyclic, stale, manifest-drift, reload, revisioned appearance restore and fresh-context
  existing-workflow cases. Preserve complete source-change briefs without adding new-workflow authoring.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-14

The operator approved the complete 3.1.9.4 proposal with **"approve"** on 2026-09-14 and then directed
planning persistence to continue. This approval covers the assignment below and its documentation
persistence, validation, commit and verified supervisor handoff. It does not start implementation,
dispatch another task, authorize a push, or direct candidate integration into the shared target.

The operator subsequently directed **"merge the plan"** on 2026-09-14, authorizing this planning
session to integrate the documentation into local `master` and remove its temporary branch/worktree.
That direction is limited to planning documentation; product-candidate integration remains with the
operator-directed 3.1.9.8 finalizer below.

### Outcome and scope

Complete the frozen [A08–A10 acceptance rows](task-8-acceptance-matrix.md#a08) over the accepted
Explorer authority. Keep the graph and catalog truthful, preserve the closed label/icon/category
editor, retain the exact applied result across readback, and supply meaningful browser proof through
production Explorer services. The [presentation/edit contract](../../../reference/operator-trust.md#54-compileapply-protocol),
[read-surface contract](../../../reference/frontend-backend-integration.md#515-archive--activity--explorer--the-three-read-surfaces)
and [Settings-hosted catalog contract](../../../reference/dashboard-surfaces.md#d295-2026-09-01--the-catalog-is-a-settings-section-and-catalog-is-subordinate)
remain authoritative; this brief adds no product contract.

The earlier checklist's overlay/rollback/clean-context wording is resolved under those contracts:
overlay means a presentation override; restore is an ordinary reviewed update advancing the current
revision; clean-context proof begins with a fresh browser context and independently usable source
brief. No historical revision picker, filesystem rollback, live-run overlay, guided new-workflow
scaffold, graph editor, DSL or code generator is admitted. Policy and descriptor-allowlisted Edit Data
changes continue to yield the existing strict source-change brief, not a new hot-apply category.

### Prerequisites, allocation and checkout

| Fact | Verified basis / execution rule |
| --- | --- |
| Discovery base | Clean local `master` at `07221394ece638d5de9f38407654ad2b305f1f9f`; no product changes were made during planning. |
| Accepted prerequisite | 3.1.9 B integration `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, verified ancestor of the discovery base. Its [release record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) includes accepted A authority and completed cleanup. |
| Other inputs | The shell integration at `251d471b2` and its closure at the discovery base are present. Settings and Storage have separate worktrees; neither sibling is a prerequisite for this assignment. |
| Supervisor | One GPT-6 Astra supervisor at **medium** reasoning. The editor lifecycle, exact command settlement and browser/service harness are coupled and consequential, but fit one bounded assignment. |
| Worker/reviewer allocation | Zero worker agents and no independent reviewer. The Phase 3.1 execution-cadence exception controls; no nested supervisors or sibling dispatch. |
| UI route | `/ui`: Components lead, local implementation, inherited Operate design. Use existing primitives and both themes. Read dashboard module instructions, `DESIGN.md`, `PARITY.md` and matching lessons; inspect the existing specimen before choosing primitives. |
| Planning checkout | `codex/plan-3.1.9.4`, `/Users/julianhein/Projects/hr-worktree-explorer-plan`, created from the full discovery SHA for this documentation-only persistence. |
| Implementation checkout | Proposed `codex/3.1.9.4-explorer`, `/Users/julianhein/Projects/hr-worktree-explorer`. Create a dedicated worktree from the verified integrated approved-plan commit supplied by the planning handoff. Both names were absent at persistence preflight; this is not a reservation. |
| Start verification | Resolve the full plan SHA from the verified handoff and its named reachable ref. Verify committed contents, prerequisite ancestry, checkout capacity, branch/path ownership and a clean exact target before the first edit. Reuse only a checkout demonstrably owned by this assignment; never reset a colliding ref. |
| Integration target and owner | The operator directs integration into local `master`; **3.1.9.8** owns group intake, focused combined checks and integration/cleanup under that direction. This worker supplies an exact candidate and evidence. It does not merge itself or start the finalizer. |
| Merge condition | Candidate focused gates and E1–E3 proof pass; ownership remains disjoint and prerequisites hold. The finalizer consumes all seven surface candidates, accepts either order, repairs integration defects, runs its assigned typecheck/focused gates, and verifies integration before owned cleanup and roadmap closure. |

The four-auxiliary-worktree ceiling includes unrelated work. At persistence preflight two auxiliary
worktrees existed (Settings and Storage); the planning checkout is the third. Remove the planning
checkout only after its authorized integration is verified. Execution rechecks capacity independently.

### Exact write ownership and exclusions

Production write scope is:

- `src/dashboard/surfaces/explorer.tsx` and `explorer-model.ts`;
- `src/dashboard/surfaces/ui-catalog.tsx` and `ui-catalog-model.ts`;
- `src/dashboard/surfaces/row-catalog.tsx` and `row-catalog-model.ts`;
- `src/dashboard/client/explorer-queries.ts` and `src/dashboard/state/explorer-client.ts`.

Use only necessary edits within that scope. No extraction into another owner's module is authorized.
Settings-hosted catalog props, URL routing and the Version registry callback consume the existing
interfaces. Keyboard help is exercised through its current Settings destination; this task does not
rewrite the shell's shortcut registry or host component.

Proof write scope is the existing `tests/unit/dashboard/explorer-*.test.ts`,
`ui-catalog-model.test.ts`, `ui-catalog-surface.test.ts`, `row-catalog-model.test.ts`;
`tests/parity/helpers/fixture-explorer.ts`, `fixture-explorer-routes.ts`,
`reference-explorer-scenes.ts`; `tests/parity/reference-explorer.spec.ts`; and these new task-owned
files:

- `tests/unit/server/explorer-acceptance.test.ts`;
- `tests/parity/helpers/fixture-explorer-authority.ts`;
- `tests/parity/explorer-authority.spec.ts`.

Existing backend tests and common helpers are read/execute inputs, not shared edit ownership.
The existing reference scene identities `explorer-graph`, `explorer-transaction`, `catalog-search`
and their reference bytes stay unchanged. New interaction screenshots/a11y evidence go to private
test output; no baseline refreeze is approved.

Reserved inputs include A's backend/authority files, SQLite DDL and repositories, kernel, root BFF
composition and command/schema registration; shared client/provider/transport/resource modules;
Settings host and sibling surfaces; shared fixture profiles/default builders/seeded lifecycle and
HTTP composition/reference harness/membership guards; DS/specimen, source-authored workflows,
runtime isolation/configuration and credentials/operator state. Workflow manifest, UI/store catalogs
and combined reference output remain their generator/finalizer owners' responsibility. This task
neither regenerates a catalog to hide a stale artifact nor edits archived facts through a current
descriptor. No HR browser action, migration, live recovery, backup, cutover or external write belongs
to this synthetic-only acceptance assignment.

The sole planning/evidence document is this file. Documentation generation required to validate a
recording commit uses the existing generator; generated bytes are never hand-edited. Do not edit a
shared roadmap source or mark this implementation complete merely to record candidate readiness.

### Feasibility and highest-risk evidence

| Question / requirement | Current mechanism and permitted change | Proof and forbidden outcome |
| --- | --- | --- |
| Does successful readback preserve the operator's result? | `ExplorerEditDialog` includes override revision in `targetIdentity`; its effect clears `review`, `problem` and `applied`. The parent's `onReadback` replaces the workflow prop. E1 owns this lifecycle in `explorer.tsx` and its model. | Planning mounted probe at the discovery base returned `commandCount: 1`, `readbackRevision: 1`, `retainedSuccess: false`, `returnedToDraft: true`, `renderedUnknown: false`. Add a mounted parent/readback regression; success must remain visible for the exact edit until deliberate dismissal. |
| Can graph and catalog proof stay within the accepted boundary? | `buildWorkflowExplorer` derives registered modules, runtime nodes, edges, conditions, source closure and catalog links. `ExplorerQueryDeps` already accepts `buildManifest`, module and scenario-source inputs. `workflow-definition.test.ts` already constructs and refuses a real dependency cycle. | E2 adds leaf-owned acceptance tests using those public seams, valid controls and malformed/stale cases. No fabricated graph, silent stale presentation, invented source, or cyclic workflow is accepted. Empty registry and unknown workflow remain distinct from the impossible zero-node registered workflow. |
| Can edits, conflicts and restore avoid a new authority? | `composeExplorer` exposes real routes/validation and a transaction-bound executor. The command kernel and SQLite repository already enforce exact envelope replay, CAS, atomic audit and restart readback. Existing `explorer-sqlite-authority.test.ts` covers replay, rollback on audit failure and revisioned restore. | E2/E3 consume these services unchanged. Restore advances the current revision; exact replay adds no new effect. Stale version, contract fingerprint or revision refuses, and a subsequent valid command demonstrates usable setup. |
| Can a browser prove the production service boundary without shared fixture edits? | Current reference scenes cover reads. The ordinary fixture has no real edit authority and `startSeededServer` has no Explorer injection port. Exported `registerExplorerRoutes`, `registerCommandsRoutes`, ingress/identity/error functions, `composeExplorer` and command-service/kernel constructors permit a new leaf-owned harness. | E3 owns `fixture-explorer-authority.ts`: real loopback HTTP and production Explorer read/validate/command services over one synthetic SQLite database. Use existing fixture shell/Settings responses only outside the measured service boundary. Preserve production Host/Origin/content-type/actor admission and typed errors. Never substitute a fabricated successful command response for acceptance. |
| What does a source-only draft promise? | The existing validator emits strict, identity-bound policy/Edit Data code briefs; compile attestations say `held` and post-patch obligations say `required`. The presentation UI authors only the three admitted fields. | E2 proves the complete brief at the service boundary: exact files/bases, semantic patch, impacted tasks/scenarios and required checks. Mixed apply levels, no-op/partial-no-op and forbidden kinds refuse without authority effects. No new source-editor UI, scaffold, selector editing or claim that declared scenarios executed. |
| Can catalog/help acceptance avoid a Settings or generator dependency? | `UiCatalogSection` is already registered inside Settings; query/view callbacks are existing ports. The selector view reads the committed artifact and throws when stale. Vocabulary reads schemas; keyboard help uses its existing host. | E3 exercises both views, search/selection/provenance, keyboard/help, catalog links and the Version registry destination. Stale/malformed catalog and unresolved source cases stay explicit; no new catalog takeover, test-only Settings catalog or duplicate close control. |

The mounted planning probe used JSDOM, real read-only validation, synthetic command/readback responses
and a parent component replacing the workflow prop. CSS loading and animation/measurement adapters
were test-environment setup only; two initial probe attempts failed on missing CSS/animation support
before the successful observation. It proves the React lifecycle defect, not HTTP, SQLite, geometry
or end-to-end correctness. No production state was accessed. Planning also passed scoped ESLint for
the editor/model/dialog test. The supervisor must establish the regression through the repository
runner and the real-service browser lane, not reuse this probe as acceptance.

The relevant prior [B delivery assessment](task-9-establish-independent-dashboard-boundaries.md#b-delivery-assessment)
found that mounted surface tests catch focus/feedback failures missed by model tests. Dashboard
lessons also record feedback lost when a parent reread replaces the component holding it. Those
findings support the parent/readback regression and exact reference-membership check here; they
do not authorize a broader refactor.

### Ordered execution and acceptance

| Step | Outcome and implementation responsibility | Required positive/negative proof |
| --- | --- | --- |
| E1 · Retain the exact edit outcome | Fix success retention across parent readback without letting a different target, actor, value, reason or generation reuse a reviewed draft. The supervisor owns coupled state/settlement judgment. | Mounted full lifecycle for label/icon/category; exact command and target/revision/readback matching; draft/actor/target changes, close/reopen and late validation/apply responses; exact edit-door focus return. Keep unknown result separate from acknowledged-but-unverified and from explicit refusal. Neither uncertain outcome enables automatic resubmission. |
| E2 · Establish graph and service acceptance | Prove A08/A09 over the real registration and immutable prerequisite APIs. Add the leaf server acceptance suite; make only E1's permitted surface/client corrections if a consumer violates the contract. | Nodes/edges/conditions, omission/dry-run facts, source/catalog links, empty and unregistered cases; invalid/forbidden drafts, builder cycle rejection, manifest drift, stale descriptor/fingerprint/revision, no-op/mixed source edits, complete source brief, exact replay and new-revision restore. Pair refusal cases with valid reachable controls and no successful override/command side effect. |
| E3 · Exercise browser and catalog journeys | Build the private real-service Explorer HTTP harness and browser spec, then repair remaining owned surface/client defects. UI route is Components/local with inherited design and parity constraints. | Preview → apply → retained success → reload → fresh browser context → reviewed restore; competing edit and failed/mismatched readback. Both catalog views, search, rail keyboard movement, source/provenance/unavailable cases, Settings Help/Keyboard and Version registry navigation. D01/D02 sizes, both themes, resize to 1024×720 and back, keyboard reachability and focus. |
| E4 · Freeze the candidate and record intake | Run the focused release set, fix failures, commit by logical category with exact paths and record evidence here. Finish development without claiming finalizer acceptance or roadmap closure. | Candidate SHA and base, exact commands/exits, tested input identity, proof coverage/limitations, private output paths, unchanged existing reference membership/bytes, pending integration/cleanup and deferred broad gates. Supply 3.1.9.8 with the candidate; stop without merging, pushing or dispatching siblings. |

Read the nearest module instructions before edits. During E1–E3, resolve routine implementation and
test setup locally; do not spawn tactical fix agents. A newly discovered defect in excluded backend,
shared registration, generated authority or a sibling contract stops dependent work for an ownership
amendment. Do not weaken a proof, introduce a fallback or silently broaden ownership. Preserve
independent work that can continue safely. A current prerequisite mismatch, occupied checkout or
unavailable capacity also blocks the dependent operation until resolved.

### Focused gates and private resources

Run these exact existing suites plus the new acceptance suite before freezing the candidate:

```sh
npm run test -- \
  tests/unit/dashboard/explorer-edit-dialog.test.ts \
  tests/unit/dashboard/explorer-edit-review.test.ts \
  tests/unit/dashboard/explorer-client.test.ts \
  tests/unit/dashboard/ui-catalog-surface.test.ts \
  tests/unit/dashboard/ui-catalog-model.test.ts \
  tests/unit/dashboard/row-catalog-model.test.ts \
  tests/unit/dashboard/surface-fixture-boundaries.test.ts \
  tests/unit/server/explorer-query.test.ts \
  tests/unit/server/explorer-edit-service.test.ts \
  tests/unit/server/explorer-sqlite-authority.test.ts \
  tests/unit/server/explorer-acceptance.test.ts \
  tests/unit/domain/explorer-edit-protocol.test.ts \
  tests/unit/workflow-definition.test.ts \
  tests/unit/architecture/workflow-editor-compile-integrity.test.ts

npm run test:parity -- \
  tests/parity/reference-explorer.spec.ts \
  tests/parity/explorer-authority.spec.ts --workers=4

npm run build:manifest:check
git diff --check
```

The new suite must exist and execute; missing/empty selectors are failures. Add directly affected
existing Explorer model/surface regressions to the recorded exact invocation if their code changes.
Run `npx eslint <every changed code/test path> --max-warnings 0`, using an explicit expanded argv
record derived from this assignment's base-to-candidate diff, not a wildcard that omits new files.
Scoped lint failures are task failures. Run meaningful red/green proof for the lifecycle repair.

The repository parity command rebuilds or proves the working-tree bundle through its authoritative
global setup. It preserves exact screenshot/a11y/provenance checks and never silently writes missing
references. Inspect the rendered interaction screenshots as well as assertions. Exercise Graphite
Warm and Paper Ink at 1280×720, 1440×900 and narrow 1024×768; resize the selected graph/editor/catalog
journey to 1024×720 and back without inventing a mobile layout. Keep keyboard decisions and focus
reachable. New interaction evidence must say which services are real and which surrounding fixtures
are synthetic. No actual-target preflight or HR system access is applicable to these proofs.

| Boundary | Gate/reuse rule |
| --- | --- |
| First stable E1/E2 seam | Run the meaningful affected tests and scoped lint; establish a failing regression before the corresponding fix, then pass it. No full suite for each small edit. |
| Logical implementation candidate | Run the complete focused set above, affected added regressions, changed-path ESLint, current-build parity, manifest freshness and whitespace checks. Record exact effective workers, paths, input identity and actual exits. |
| Repaired candidate | Rerun checks invalidated by the correction; reuse unchanged evidence only with an inspected input diff. Never relabel a failing or unrun check as passed. |
| Documentation-only recording | Verify local links/fragments, existing instruction twins and project-chain cap, roadmap binding, roadmap generation/freshness and whitespace. Lint executed test/generator sources. Record that implementation inputs are unchanged. |
| Finalizer 3.1.9.8 | Consume all exact surface candidates and execute the finalizer's typecheck, focused combination/regression, scoped lint and affected generated/build checks. Worker development completion is not group release. |
| Final acceptance 3.1.19 | Full repository typecheck/lint/coverage, architecture, broad parity, production, performance, recovery/live and complete A01–A42/D01–D05 acceptance remain deferred here. This task claims none of those deferred results. |

The private worktree owns its Git index, compiler/evidence files, `dist/dashboard`,
`tests/parity/.output`, synthetic SQLite state, screenshot output and evidence namespace. A read-only
link to installed dependencies is permitted. Use the repository runner's private `/tmp/hrt-<uid>/run-*`
roots and ephemeral loopback ports, never live ports 3938/5174 or copied operator state. At most four
file workers; Playwright's invocation explicitly selects four, and its effective configuration must
be recorded. Do not overlap build/parity writers within this checkout or change root runner config.
Close owned HTTP/SSE/database/browser resources and validate runner-owned cleanup; preserve peer
sessions and unrelated files. Evidence outside the checkout must have its own uniquely created task
namespace and be reported honestly if retained.

### Recording, integration and handoff

At start/resume and after each verified step, send **Done / Now / Remaining** before the next tool
call. Keep E1–E4, the finalizer intake, integration and cleanup visible. Maintain current state here
with the resolved checkout/base/head, accepted test inputs, failures/next action, evidence paths and
deferred proof. Do not create another plan or mark the roadmap task complete before the assigned
integration and cleanup. Use `/handoff` only for interrupted unique implementation state.

The planning session persists and validates this entire approved brief, commits exact paths and
reads it back with `git show`. The plan must be integrated by an authorized shared-target owner and
reachable from the named handoff ref, with prerequisites present, before **READY** is issued. Until
that documentation integration is directed/completed, report **WAITING ON documentation integration**
and provide the verified candidate and checks; do not pass an isolated candidate off as integrated.
The resolved supervisor prompt must name the full approved-plan SHA, actual creation base, branch,
absolute checkout, owning section, E1–E4, focused/no-review cadence and finalizer merge conditions.

### Current planning state

| Item | State |
| --- | --- |
| Approval | Approved by the operator on 2026-09-14; full proposal retained above. |
| Persistence | Full approved content committed as `958018aa2fbce724de176922cfcd8873f355bc96`, integrated into local `master` at `eb5c1fe5f7fc30eabf4b89e4743f78d575583d29`. The verified handoff resolves the subsequent recording-only commit as the final approved-plan SHA and implementation creation base. |
| Implementation | E1–E4 development is recorded below. The checked worker candidate awaits 3.1.9.8 intake, integration and cleanup; task acceptance checkboxes remain open. |
| Shared-target integration | Complete under the operator's explicit "merge the plan" direction. The merged tree exactly equals the validated candidate tree; all product inputs are unchanged. |
| Planning cleanup | Complete: the planning worktree registration, physical path and `codex/plan-3.1.9.4` ref are gone. Only its owned dependency symlink was removed; shared dependencies and Settings/Storage worktrees remain. Planning evidence is retained at the namespace below. |

### Planning validation — 2026-09-14

Evidence namespace: `/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-explorer-plan-evidence-20260914-et13427v`.
This is retained planning evidence, not a second plan or implementation checkout.

| Check | Result / evidence |
| --- | --- |
| Roadmap binding | PASS, 1 suite / 24 tests: `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`; `roadmap-binding.log`. |
| Scoped documentation-tool lint | PASS: `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap/parse-plan.ts scripts/roadmap/scan-docs.ts scripts/roadmap/schema.ts --max-warnings 0`; `documentation-lint.log`. |
| Generated roadmap | `npm run roadmap` then `npm run roadmap:check` passed; generated `docs/roadmap/index.html` bytes remain unchanged. |
| Links and instruction chains | PASS: 14 local links/fragments, nine existing AGENTS/CLAUDE pairs byte-identical, largest complete project instruction chain 18,376 UTF-8 bytes, below 32,768; `document-checks.json`. |
| Approved controls and scope | The approved E1–E4 sequence, medium/zero-worker allocation, no-review cadence, exact owners, proof/gates and finalizer conditions are retained. Only this task owner differs from the discovery base; no implementation, test, configuration or generated input changed. |
| Whitespace and committed-content verification | `git diff --check` and staged whitespace checks are required before the exact-path commit. The planner then reads this file from the resulting SHA and verifies its complete content, ref reachability and prerequisite ancestry before returning the candidate. |
| Product acceptance | Not run or claimed during planning. The mounted lifecycle observation above is discovery evidence only; E1–E4 and finalizer/3.1.19 acceptance remain open. |

### Planning integration and launch release — 2026-09-14

The authorized integration has parents `07221394ece638d5de9f38407654ad2b305f1f9f` and
`958018aa2fbce724de176922cfcd8873f355bc96`. Its tree equals the checked documentation candidate,
so the recorded 24/24 binding tests, scoped lint, generation/freshness, links and instruction checks
retain their exact inputs. `integration-verification.json` records that equality; no broad product
gate is inferred from it. `cleanup-verification.json` records removal of the exact planning checkout
and ref after ancestry, cleanliness, ignored-file and lock checks. No other task was archived.

This closure record changes only the owning plan's authorization and verified state, not E1–E4,
scope, owners, effort, gates or acceptance. Run final roadmap generation/freshness, binding tests,
link/twin/chain and whitespace checks for this record; the scoped lint's source inputs are unchanged.
Commit the exact owner, then verify its complete `git show` content and the accepted prerequisite's
ancestry from local `master`. The resulting full commit is the handoff's approved-plan SHA and
creation base. Before issuing **READY**, also recheck the proposed implementation branch/path are
available and capacity remains within four auxiliary worktrees. Implementation is still unstarted;
the operator opens the fresh Astra medium `/supervise 3.1.9.4` session.

### Worker candidate and finalizer intake — 2026-09-14

The operator opened `/supervise 3.1.9.4` with the exact creation base below and authorized E1–E4
locally through `/ui`, with zero workers and no independent review. Components led the local UI
work using the existing Operate design and primitives. This record supplies a checked worker
candidate; it does not release the parallel group or close the roadmap task.

| Intake fact | Verified value |
| --- | --- |
| Approved plan and exact creation base | `9f9dfe3566084e165bd508ae8b66dc3ebe325010`, reachable from local `master`; its committed owner content was checked before editing. |
| Required prerequisite | `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, verified ancestor of the creation base and candidate. |
| Branch and checkout | `codex/3.1.9.4-explorer`, `/Users/julianhein/Projects/hr-worktree-explorer`; both were available at creation. Two auxiliary worktrees existed before this third checkout, within the four-worktree ceiling. |
| Implementation candidate | `4e7aa2bc9bf16e646c623f669e622d078ce16a31`; tree `e8acf9207371c4a31a89029f3b00f81071ef1797`. The subsequent evidence-only commit changes this owner alone; final intake HEAD is returned in the supervisor's completion message and `final-intake.json`. |
| Exact changed inputs | `src/dashboard/surfaces/explorer.tsx`; `tests/unit/dashboard/explorer-edit-dialog.test.ts`; `tests/unit/server/explorer-acceptance.test.ts`; `tests/parity/helpers/fixture-explorer-authority.ts`; `tests/parity/explorer-authority.spec.ts`. All other production, backend, shared fixture, configuration and reference inputs are unchanged. |
| Accepted evidence identity | `accepted-inputs.json` hashes all 2,353 non-document tracked/added inputs. Hashes were rechecked after gates and before the implementation commit; the evidence-only recording must preserve them. `reference-audit.json` separately covers every existing reference file and scene membership. |
| Remaining owner | Operator-directed 3.1.9.8 intake, combined focused checks/typecheck, integration into local `master`, and branch/worktree cleanup. No push, merge, independent reviewer or sibling dispatch occurred here. |

Evidence is retained at `/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-explorer-evidence-20260914-_eicf9z4`.
This private namespace contains logs, input identities, cleanup records and the browser-output
archive, not another plan. The installed dependency symlink is read-only; this checkout owns its
build and test outputs.

| Step | Verified outcome and proof |
| --- | --- |
| E1 | The mounted real parent reproduced lost success for all three fields: three expected failures before the fix. The editor now retains only its exact verified readback across the parent's revision update, preserves the reviewed basis, and invalidates retired apply responses. Label/icon/category regressions cover exact command/readback identity, actor/value/target changes, close/reopen, late validation/command/readback settlement, no automatic resubmission and focus return to the corresponding edit door. Existing refusal, unknown-result and acknowledged-but-unverified distinctions remain. |
| E2 | The new acceptance suite consumes registered workflows and immutable prerequisite services. It checks graph nodes/dependencies/conditions/replay and dry-run facts, exact source/catalog links, empty versus unknown versus invalid zero-node cases, manifest/source drift, forbidden drafts, no-op/mixed/partial edits, complete policy and Edit Data source briefs, stale bases/revision, exact replay after database reopen and reviewed new-revision restore. Existing builder-cycle and SQLite atomicity/refusal suites are included in the release set. Refusal cases retain valid controls and check authority effects. |
| E3 | Six theme/viewport journeys prove preview, apply, retained success, reload and a fresh browser context restoring all three original values through ordinary reviewed revisions, reaching r6. They exercise selector and row/panel catalogs, search/selection/provenance, rail keyboard movement, unavailable vocabulary, Settings Help/Keyboard and Version registry navigation, resizing graph/editor/catalog to 1024×720 and back, decision-control reachability and exact edit-door focus. Further cases cover a competing edit, failed/mismatched readback, lost command response, empty/unresolved/stale/malformed inputs, unknown workflow recovery, and real HTTP Host/Origin/media/actor admission. |
| E4 | The complete focused release set passed on the implementation candidate inputs. Only the permitted surface and task-owned proofs changed. Existing reference scenes and all reference bytes remain unchanged. The implementation is committed; this evidence record is checked separately before its exact-path commit. Finalizer intake/integration/cleanup and 3.1.19 remain pending. |

The browser harness serves production Explorer/catalog reads, validation, command ingress, command
service/kernel and SQLite authority over ephemeral loopback HTTP. Shell, Settings, Archive and SSE
surroundings use existing synthetic fixture responses. Successful command acceptance is never
fabricated. Fault injection is limited to explicit negative read/catalog/transport cases; uncertain
UI cases verify the actual durable command. This proves the assigned service boundary, not live HR,
full root composition, broad accessibility, executed source-brief obligations or production recovery.

Both `paper-ink` and `graphite-warm` ran at 1280×720, 1440×900 and 1024×768. The 93 private
screenshots and 93 body-backed accessibility snapshots include the additional 1024×720 states;
representative graph, editor and catalog renders were visually inspected. The original
`explorer-graph`, `explorer-transaction` and `catalog-search` scenes are unchanged, as are all 693
files under `tests/parity/references`. Interaction evidence remains in this checkout's
`tests/parity/.output` and the retained `parity-output.tar.gz`, including the JSON report and
attachment identities. No reference refreeze occurred.

### Worker release gates

All commands ran in `/Users/julianhein/Projects/hr-worktree-explorer`. `release-gates.json` records
exact argv, working directory, exit and elapsed time for each check; matching `.log` files retain
output. The exact 14-suite command in **Focused gates and private resources** above was executed
unchanged. Vitest's effective maximum was four file workers; Playwright used four workers, also
asserted in the new journey tests. Build/parity, compiler and lint ran sequentially in this checkout.

| Check | Result |
| --- | --- |
| Exact focused unit/architecture set above | PASS, exit 0: 14 files, 186 tests; `focused-tests.log`. |
| `npm run test:parity -- tests/parity/reference-explorer.spec.ts tests/parity/explorer-authority.spec.ts --workers=4` | PASS, exit 0: 34 cases, comprising 18 unchanged reference cases and 16 new service cases; `parity.log`. |
| `npx eslint src/dashboard/surfaces/explorer.tsx tests/parity/explorer-authority.spec.ts tests/parity/helpers/fixture-explorer-authority.ts tests/unit/dashboard/explorer-edit-dialog.test.ts tests/unit/server/explorer-acceptance.test.ts --max-warnings 0` | PASS, exit 0; `lint.log`. |
| `npx tsc --project /Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-explorer-evidence-20260914-_eicf9z4/iteration/tsconfig.json --noEmit` | PASS, exit 0; scoped check of the four changed test files and their imported production closure, using the repository compiler options and explicit dependency type roots. This is additional scoped evidence, not whole-repository typecheck. |
| `npm run build:manifest:check` | PASS, exit 0; `manifest.log`. No manifest/catalog regeneration or source-authority change. |
| `git diff --check` and `git diff --cached --check` | PASS, exit 0 before the implementation commit. |
| Reference identity and runtime cleanup | PASS: 693 reference hashes and exact membership match the creation base. Successful runner roots were removed by the runner; five owned failed-run roots were archived then removed after exact owner and absent process-group checks. Browser session `explorer-3194`, private ports 61713/62204 and the manual synthetic database were closed/removed; `runner-cleanup.json` and `manual-runtime-cleanup.json`. Peer resources remain untouched. |

The evidence-only recording passed the checks below. Exact argv and exits are retained in
`documentation-gates.json`; `document-checks.json` records the owner hash and unchanged implementation
inputs. Source checks retain the implementation candidate's exact input identity.

| Documentation check | Result |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | PASS, exit 0: 1 file, 24 tests. |
| `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap/parse-plan.ts scripts/roadmap/scan-docs.ts scripts/roadmap/schema.ts --max-warnings 0` | PASS, exit 0. |
| `npm run roadmap` then `npm run roadmap:check` | PASS, both exit 0; generated roadmap bytes unchanged. |
| `sh /Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-explorer-evidence-20260914-_eicf9z4/document-check.sh` | PASS, exit 0: 14 local links/fragments, nine byte-identical existing instruction pairs, largest project chain 18,376 bytes below 32,768, approved controls retained, only this owner differs from the implementation candidate, all 2,353 non-document input hashes unchanged. |
| `git diff --check` and `git diff --cached --check` | PASS, exit 0 before recording commit. |

Full repository typecheck/lint/coverage,
architecture, broad parity, production, performance, recovery/live and complete A01–A42/D01–D05
acceptance are deferred to 3.1.19; none is claimed here. The finalizer's combined checks are also
unrun here.

### Delivery assessment

The approved bounded scope and prerequisite interfaces held. No ownership amendment, new operator
scope, worker dispatch or independent review occurred. The expected lifecycle defect was reproduced
and corrected locally. Proof implementation required repair rounds for the footer Close locator,
strict source/draft fixtures, the catalog's existing selected-row focus semantics, and synthetic SSE
surroundings cleanup. A passing inner browser run initially failed the parity wrapper because the
new captures lacked statically declared body-backed accessibility attachments; the proof now uses
that established contract. The first release run caught command-envelope guard adjacency after
generation capture was inserted between the request and busy state; moving generation capture
before the request preserved the unchanged guard and passed the complete release set. Relocating
the private compiler recipe required an explicit Node type root, after which only compilation and
the remaining unchanged-input gates were rerun. Failed logs and owner records remain in the evidence
namespace; these were implementation/proof setup repairs, not waived acceptance or backend defects.

Earlier inspection of the existing roving-row focus and parity attachment contract could have
prevented those proof repairs. The plan already assigned both outcomes, so the evidence does not
support a scope/planning amendment. The observed context compaction resumed the same assignment without
resizing or delegation. Retained logs establish the listed events, not a complete timing breakdown
or estimated savings. Routine finalizer transfer uses this owner record; no separate handoff plan
or cleanup of the implementation checkout is performed by this worker.

## Branching timeline presentation — 2026-09-26

The operator selected Explorer A and approved implementation with a Sol worker. The default view
becomes the source-derived branching timeline in [operator-trust §5.2.4](../../../reference/operator-trust.md#524-branching-timeline-presentation--2026-09-26).
Existing contract/editing/catalog behavior remains, with secondary detail accessible. This amended
visual assignment permits attributable updates to Explorer's affected reference scenes rather than
retaining their old layout unchanged. It does not admit new execution policies or a live-run overlay.

Candidate: `codex/explorer-timeline` at
`/Users/julianhein/.codex/worktrees/explorer-timeline/hr-automation-rebuild`, from the committed
Settings-derived base `897158ece84471dd86b67ca8d49e73477b1280e8`. Focused Phase 3.1 cadence applies.
The coordinator owns shared contracts and acceptance; the operator retains integration choice.
Evidence: `/Users/julianhein/Projects/hr-automation-rebuild-evidence/archive-explorer-activity-2026-09-26/implementation/explorer/`.
