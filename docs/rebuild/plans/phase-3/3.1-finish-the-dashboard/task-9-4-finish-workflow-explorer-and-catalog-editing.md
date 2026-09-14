# Task 3.1.9.4 · Finish Workflow Explorer and catalog editing
<!-- roadmap: dash-explorer -->

**Current assignment: 3.1.9.4.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. The approved execution brief below binds this child's surface, client and proof paths. Shared registration and generated outputs remain reserved.

- [ ] Consume the accepted D337 SQLite authority from [3.1.9](task-9-establish-independent-dashboard-boundaries.md#approved-execution-brief--2026-09-13). Preserve label/icon/category editing, validation, conflicts, preview/diff, exact replay and hot readback through its isolated service ports.

**Operator allocation — 2026-09-13.** The complete persistence conversion, migration, command/audit
transaction, reader/writer cutover, old-protocol retirement and conversion/recovery proof belong to
3.1.9. This child owns the editor and its surface/service acceptance over that accepted authority;
it does not reopen shared SQLite, kernel or composition ownership. Historical Task 9-4 conversion
references describe the earlier allocation.

- [ ] Complete graph/catalog reads and validated presentation preview/diff/revision/hot-apply;
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
| Persistence | Full approved content persisted in the isolated planning worktree from the verified discovery base. Documentation checks passed as recorded below; the handoff resolves and verifies the exact candidate SHA. |
| Implementation | Not started; all task acceptance checkboxes remain open. |
| Shared-target integration | Awaiting explicit operator direction for this documentation candidate; no integration owner has been appointed by inference. |

### Planning validation — 2026-09-14

Evidence namespace: `/Users/julianhein/Projects/hr-explorer-plan-evidence-20260914-et13427v`.
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
