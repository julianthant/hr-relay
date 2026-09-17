# Task 3.1.9.6 · Finish Intake surfaces
<!-- roadmap: dash-intake-edit -->

**Current delivery: complete — 2026-09-17.** Accepted candidate
`45748dae4436537ab86585ffa03b95dbc6843caa` is incorporated into local master through
`801da4f3d1bfdf0a9ecc81c993289f70699aa140`. Required focused child/group gates, integration
and owned cleanup are complete; see the [finalizer closure](task-9-8-finalization-dashboard-surfaces.md#accepted-integration-and-group-closure--2026-09-17).
Full acceptance remains 3.1.19. Earlier dated plan/freeze receipts below retain their historical state.

**Current assignment: 3.1.9.6.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration, together with its [Intake ownership amendment](task-9-establish-independent-dashboard-boundaries.md#intake-child-ownership-amendment--2026-09-14). The approved execution brief below owns this child's scope and narrow shared-file exceptions. Other shared registration and generated outputs remain reserved.

- [x] Complete upload-to-handoff, mapping, validation, reject review, manifest and rerun-diff flows
  with progress/provenance/refusals; prove real, malformed, partial, canceled, stale, redacted,
  duplicate and archived cases.
- [x] Preserve ordinary Run/Rerun and prior-run value projection ownership in 3.1.11.2. The
  approved exception extracts and repairs only the spreadsheet upload component and replaces its
  Run-modal call site; it does not change ordinary Run/Rerun behavior.

Accepted artifact consolidation stores intake/session/manifest facts in imported_artifacts while retaining independent import identities and immutable handoff semantics. Do not recreate intake_manifests, intake_sessions, artifact_outbox or artifact_sink_heads. Closed rejects, exact counts and changed-file/mapping/schema confirmation remain required.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-14

### Approval, outcome and allocation

The operator selected **1 A** (admit the narrow upload extraction and explicit prior-import
comparison/confirmation changes in this task) and **2 A** (finish spreadsheet Intake; correct stale
classification/OCR wording while retaining existing OCR obligations with their owners), then
approved the complete I1–I5 proposal in `/phase-plan 3.1.9.6` with **"approve"** on 2026-09-14.
This records approval to implement the assignment in a fresh supervisor session, not implemented
behavior or permission to launch that session from planning.

One **GPT-6 Astra / medium** supervisor owns I1–I5. The upload lifecycle, served review binding,
durable comparison identity, enqueue/replay and browser proof are coupled and consequential;
medium fits that scope. There are **zero implementation workers and zero independent reviewers**.
The Phase 3.1 focused/no-review cadence applies. Do not dispatch siblings, another supervisor or
the finalizer. Use `/ui`, **Components lead, local execution**, with the inherited Operate design,
module instructions and desktop parity contract. Routine coding choices belong to the supervisor.

Complete [A13/A14](task-8-acceptance-matrix.md#a13) over the existing spreadsheet services: upload,
map, validate, correct/exclude, prepare, immutable handoff and changed-input comparison. The
normative interaction and identity amendment lives in
[data intake](../../../reference/data-intake-and-edit-data.md#spreadsheet-intake-review-and-comparison-amendment--2026-09-14);
[frontend/backend integration §5.1.7](../../../reference/frontend-backend-integration.md#517-intake-and-prior-run-value-projection)
and [dashboard presentation](../../../reference/dashboard-surfaces.md#971-the-intake-workspace-2i-e3-d173)
remain the linked owners. No duplicate plan is created.

### Checkout, prerequisites and release

| Binding | Approved assignment |
| --- | --- |
| Task / mode | 3.1.9.6; create a dedicated implementation branch and worktree after the capacity check |
| Repository / integration target | `/Users/julianhein/Projects/hr-automation-rebuild`; local `master`, controlled by the operator through 3.1.9.8 |
| Branch | `codex/3.1.9.6-intake` |
| Absolute worktree | `/Users/julianhein/Projects/hr-worktree-intake` |
| Discovery base | `9f9dfe3566084e165bd508ae8b66dc3ebe325010`, clean local `master` |
| Accepted prerequisite | 3.1.9 B integration `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, containing accepted A `c990662e91604cfd38baa53e12bfb6e7c60610eb`; accepted 3.1.8 is in that ancestry. The shell correction accepted at `251d471b27dcdb0d32027fc5dd9acffffe3c6449` is also in the discovery base. |
| Implementation base / plan availability | The full committed plan SHA verified in the planning handoff, reachable from local `master` and descended from the discovery base. The handoff resolves the actual SHA after persistence; a prerequisite SHA alone is not this plan. Create from that exact commit, not an unrelated moving checkout. |
| Availability at approval | Proposed branch/path are unused. Explorer, Notifications, Settings and Storage occupy all four auxiliary worktree slots. Implementation is **WAITING ON one free authorized slot**; an absent proposed branch is expected, not a blocker. |
| Merge condition / owner | Freeze a candidate with I1–I5 and focused gates passing. Operator-controlled 3.1.9.8 consumes the exact candidate and siblings, resolves combined artifacts, proves focused integration and closes resources. No automatic merge, push or downstream release. |

Before the first implementation edit, recheck branch/path ownership, clean starting tree,
prerequisite ancestry, exact committed plan content and the four-worktree ceiling. Create only
the assigned worktree once a slot is available; never remove, switch, reset or repurpose a peer's
checkout. A read-only dependency symlink is allowed. Preserve implementation isolation even if
the primary checkout is clean. If the base or owned interfaces have changed, inspect the actual
diff and resolve material incompatibility before editing.

This task remains independent of 3.1.9.2–3.1.9.5 and 3.1.9.7. Its narrow shared-file allocation
does not overlap their permitted production writes. Other command families and their dispatch
remain unchanged. Shared architecture registration additions are restricted to Intake entries;
the finalizer composes additive peer entries and checks both candidate orders where required.
3.1.11 and 3.1.11.2 consume the extracted upload component only after 3.1.9.8 releases the group.

### Exact ownership and exclusions

Production write scope:

- `src/dashboard/surfaces/intake.tsx`, `intake-model.ts`, new `intake-upload.tsx` and
  `intake-upload-model.ts`, plus task-local `intake-*` helpers;
- `src/dashboard/client/intake-queries.ts` and `src/dashboard/state/intake-client.ts`;
- `src/server/dashboard/commands/intake-service.ts` and the isolated
  `src/server/dashboard/routes/intake.ts` if its existing upload contract needs an affected repair;
- `src/domain/intake/` for served readiness, comparison/confirmation, read-forward session metadata
  and pure derivations. Preserve accepted mapping/projection identity semantics and descriptor import
  closure; changes are limited to I1–I4, not a general domain refactor;
- **Narrow shared exceptions:** extract `SpreadsheetIntake` from
  `src/dashboard/surfaces/run-start.tsx`, update its imports and replace its existing call site;
  extend only Intake payload definitions in `src/domain/commands.ts` and Intake handling in
  `src/core/command-kernel.ts` for explicit comparison selection and final confirmation checks.
  New comparison selection belongs to the existing Intake command family; it does not authorize
  a new shared command framework or ordinary Run/Rerun changes.

Proof write scope is the existing Intake unit suites named below, the new
`tests/unit/server/intake-acceptance.test.ts`,
`tests/unit/dashboard/intake-workspace.test.ts`,
`tests/unit/dashboard/intake-upload.test.ts`,
`tests/parity/helpers/fixture-intake-authority.ts` and `tests/parity/intake-authority.spec.ts`;
the existing Intake fixture/route/reference-scene modules, `reference-intake.spec.ts` and
`intake-accessibility.spec.ts`; and Intake-specific updates to
`tests/fixtures/intake-kernel-seams.ts`, `tests/fixtures/intake-workflow-fixture.ts` and affected
Intake assertions in the named kernel/schema/ingress tests. If new served leaves or exported schemas
require registration, update only their exact entries in the directly affected strict-schema tests
and `tests/unit/architecture/helpers/redaction-surface-audit.ts`. Preserve guards and negative controls;
an added/retired guard also requires the deciding evidence in `docs/rebuild/guard-inventory.json`.

The four existing reference identities are `intake-mapping`, `intake-review`, `intake-manifest`
and `intake-rerun`. Deliberate changes to their PNG/a11y/provenance triples are allowed only for the
approved I1–I4 behavior, with exact attribution and a subsequent assert pass. No blanket refreeze,
shared membership rewrite or changed default surrounding fixture facts is allowed.
`start-run-spreadsheet` is a required regression input; extraction preserves its resting reference
bytes. New interaction evidence stays in the task's private output.

Reserved inputs include ordinary Run/Rerun controls and launchers, prior-run value projection,
start-plan services, sibling surfaces, shared shell/providers/transport/DS/specimen, root BFF
composition, other command families, SQLite DDL and repositories, source-authored workflow activation,
runtime configuration and operator state. Generated manifest/catalog/combined roadmap outputs retain
their generator/finalizer owners; do not hand-edit or regenerate them to hide unexpected identity
drift. No new artifact table, migration, automatic cleanup, OCR/classification surface or retired
phone Capture Mode is admitted. Saved-mapping storage and constant/unbind commands retain their
existing deferred ownership. Removing the duplicate `intake.prepare` envelope parse is not a new
acceptance obligation or permission to alter shared command ingress in this assignment.

The sole implementation plan/evidence owner is this file. Planning persistence also reconciles the
approved amendments at their existing requirement/ownership documents and regenerates the roadmap
through its generator. Implementation candidate readiness does not authorize editing shared roadmap
status or marking this task complete before finalizer acceptance, integration and cleanup.

### Feasibility and proof record

The following evidence was **inspected, not executed**, at the discovery base. There is no unresolved
product-scope decision after the operator's answers. Browser acceptance and implementation gates
are future obligations; available storage or green historical tests do not establish them.

| Question / evidence | Required change and owner | Required proof / forbidden result |
| --- | --- | --- |
| Upload lifecycle: `run-start.tsx`'s `SpreadsheetIntake` sends bytes then calls `onOpened` without guarding a canceled/unmounted or superseded request; a transport error is labeled as never reaching the server. | I1 extracts the component and owns its asynchronous lifecycle. Show actual phase/progress and typed refusals; suppress stale navigation. Client cancellation does not claim rollback of an already-created import. | Delay before file read, during upload and after server acceptance; Cancel and change workflow; lost reply then same-file retry. No late reopening, synthetic session, invented percentage or false absence claim. Valid upload is the positive control. |
| Retry identity: `intake-service.ts` joins an active digest/workflow pair; `imported-artifacts.ts` stores independent whole-import records. | I1 preserves upload retry joining and existing mapping; I3 comparison selection is explicit and revisioned. | Same-file retry joins; independently submitted imports remain distinct. An upload retry never silently replaces an existing comparison or forks duplicate work. |
| Readiness: `OutcomeBand` only blocks unacknowledged rejection history, while `enqueueReadiness` refuses unresolved rows and zero valid rows. `validateIntakeRows` already distinguishes current rejects from history. | I2 serves current readiness/counts and uses them in the UI. Preserve historical review acknowledgement, corrections and exclusions. | Acknowledgement cannot enable unresolved or zero-valid enqueue. Fix/exclude/revalidate reconciles every source row exactly; missing required fields stay visible. Refused commands preserve editor drafts. |
| Comparison: `buildWire` selects a prior manifest only by identical source digest; `RerunStageView` renders differences but has no confirmation. `rerunDiff` already compares file/mapping/projection/contract/schema and membership/input changes. | I3 adds explicit prior-manifest selection to an open import and stores its identity in preparation metadata. Resolve through existing manifest lookup and validate workflow/identity; do not infer an unrelated file's predecessor by name or recency. | Changed-file, mapping and schema comparisons are reachable. Missing, wrong-workflow or ambiguous sources refuse. Changing comparison or any reviewed decision invalidates the confirmation. |
| Final confirmation: Intake enqueue CAS checks session version, but schema/projection drift need not increment that version. Kernel replay is resolved before dispatching new effects. | I3 derives a served binding to the exact current plan and prior comparison, then re-derives and checks it inside the enqueue authority transaction before manifest/member creation. I4 retains replay-first behavior. | Missing/stale/mismatched confirmation refuses with zero manifest/run effects. A schema change after review also refuses. Historical recorded commands replay their existing result; a new request cannot use absence of a new field to bypass confirmation. |
| Historical storage: optional session metadata is retained in `preparationJson`; submitted JSON is immutable, and repository reads use existing session/manifest identities. | I3/I4 use existing `imported_artifacts`, optional read-forward fields and immutable prior references. No DDL or backfill. | Old preparations parse, new ones survive restart, submitted imports and source bytes stay byte-identical. Same-byte independent origins remain separate; no old row resolves to a newer manifest. |
| Handoff: `executeIntake` inserts manifest, fans out and marks the session enqueued inside one transaction; the UI separately rereads after a command. | I4 keeps atomicity, exact result handling and truthful uncertain/applied-but-unread states. | Duplicate click, replay, divergent command, stale session and last-member refusal cannot create partial/duplicate fan-out. After a lost reply or failed reread, recover the exact session/result instead of blindly issuing another enqueue. |
| Archived evidence: terminal imports retain exact manifests independently of member lifecycle; archived-run reports and execution-source policy have separate owners. | I4 proves old manifests and terminal sessions remain immutable/read-only through member archive cases. Comparisons use import evidence, never executable values copied from an archived run. | No archive execution action or reopened terminal import. Fresh uploads retain their own identity, source and explicit comparison. Missing evidence fails loudly rather than substituting current/newest records. |
| Browser proof: existing Intake references use fixture responses; the shared seeded services leave Intake unwired. | I5 adds a private real-Intake HTTP harness using production routes/service/parser/kernel and disposable SQLite/artifact storage. Surrounding fixture services must be identified in evidence. | Actual file bytes pass through the production pipeline and built client; screenshot success alone cannot establish durable effects, and synthetic fixtures cannot be called external HR verification. |

Redaction proof follows [the egress contract](../../../reference/guards-and-tests.md#315-redaction-surface-scantestts--the-redaction-surface-scan-d183-2j):
the authorized loopback operator may see declared captured HR fields, while protected fields and
other egress use their declared transforms. Seed synthetic protected values at the actual source,
prove they reached it, and check the applicable wire/refusal/manifest/evidence outputs. Do not
invent a blanket removal of the operator's permitted samples or write real secrets into test logs.

The order-sensitive negative controls are: canceled upload versus late success; same digest retry
versus separately submitted import; acknowledged history versus unresolved rejection; confirmation
followed by changed session/schema; applied enqueue followed by unreadable response; and a valid
fan-out whose last member refuses. Each needs a valid positive control and assertions at the earliest
stable boundary, including zero forbidden durable effects. A new request identifier does not prove
fresh execution or justify retrying an uncertain transaction.

No migration, deployment, live recovery or external-system target preflight applies. Tests use
synthetic representative CSV/XLSX files with real file encodings and disposable production services.
The supervisor verifies that target identity, private paths and absence of an HR-executing worker
before any enqueue proof. These local gates must never open an external HR transaction.

### Ordered implementation steps

| Step | Outcome and work | Acceptance |
| --- | --- | --- |
| **I1 · Upload lifecycle** | Extract and repair the spreadsheet upload component, preserving the existing Run-modal entry. Show truthful progress/refusals, keep exact retry identity/mapping, and suppress canceled or superseded navigation. | Real CSV/XLSX plus malformed, partial, interrupted, duplicate and delayed response cases; cancel/reopen and reload; lost response does not claim the server received nothing. |
| **I2 · Mapping and review** | Preserve operator mapping decisions and correction drafts. Serve current unresolved rows separately from history; block Start for unresolved rejects, missing required fields or zero valid rows. | Fix/exclude/revalidate, exact row/count/provenance reconciliation, stale responses, refused commands retaining drafts and applicable redaction. |
| **I3 · Compare and confirm** | Add explicit prior-import comparison, including different files, and visible file/mapping/schema/membership changes. Bind the operator's confirmation to the exact current plan and recheck it before enqueue. | Invalid comparison identity/workflow refuses; source-reference/mapping/correction/exclusion/schema changes invalidate confirmation; refusals have no manifest/run effects. |
| **I4 · Immutable handoff** | Preserve atomic manifest/member creation, independent imports, exact command replay and terminal readback. Recover truthful state when enqueue applies but reply/readback fails. | Restart/replay, duplicate click, divergent command identity, last-member refusal, newer same-byte imports, archived members and historical records; old source/manifest bytes remain unchanged. |
| **I5 · Browser acceptance and candidate** | Complete the built-dashboard journey through real Intake services, fix owned failures, commit logical categories and record evidence for 3.1.9.8. | Both themes, existing desktop references, keyboard/focus, actual 125%/200% zoom; inspect screenshots alongside durable-effect assertions. |

I1 establishes the extracted uploader; I2 establishes current readiness; I3 consumes those stable
facts; I4 exercises their complete effect/recovery path; I5 closes the combined candidate. Implement
and prove tactical repairs locally. Do not turn each small green cycle into a new full gated unit.

### Focused gates, reference policy and resources

Run the complete focused set before freezing the candidate:

```sh
npm run typecheck
npm run test -- \
  tests/unit/intake-header-discovery.test.ts \
  tests/unit/intake-mapping.test.ts \
  tests/unit/intake-validation.test.ts \
  tests/unit/intake-session.test.ts \
  tests/unit/intake-command-arms.test.ts \
  tests/unit/server/intake-surface.test.ts \
  tests/unit/server/intake-acceptance.test.ts \
  tests/unit/dashboard/intake-client.test.ts \
  tests/unit/dashboard/intake-model.test.ts \
  tests/unit/dashboard/intake-workspace.test.ts \
  tests/unit/dashboard/intake-upload.test.ts \
  tests/unit/dashboard/surface-fixture-boundaries.test.ts \
  tests/unit/command-kernel.test.ts \
  tests/unit/command-kernel-restart.test.ts \
  tests/unit/architecture/intake-mapping-boundary.test.ts \
  tests/unit/architecture/intake-canonical-field-registry.test.ts \
  tests/unit/architecture/operator-mutation-admission.test.ts \
  tests/unit/architecture/strict-boundary-schemas.test.ts \
  tests/unit/architecture/redaction-surface-scan.test.ts

npm run test:parity -- \
  tests/parity/reference-intake.spec.ts \
  tests/parity/intake-accessibility.spec.ts \
  tests/parity/intake-authority.spec.ts --workers=4

npm run test:parity -- \
  tests/parity/reference-start.spec.ts \
  --grep start-run-spreadsheet --workers=4

npm run build:manifest:check
git diff --check
```

New suites must exist and execute. Run `npx eslint <every changed code/test path> --max-warnings 0`
with the exact expanded argv recorded from the assignment's base-to-candidate diff, including new
files. Lint failure is task failure. Add directly affected regressions if their permitted inputs
change; do not weaken assertions, isolation, membership, coverage floors or timeouts. Unexpected
descriptor-manifest drift requires diagnosis at its owner, not an unapproved generated refreeze.

The parity wrapper builds or proves the current production bundle. Keep each run's report before
the next replaces `tests/parity/.output/results.json`. Deliberate Intake reference updates use
`npm run test:parity:update -- tests/parity/reference-intake.spec.ts --grep <exact affected scene selector> --workers=4`
only after recording the changed behavior and exact affected scene identities; then run the full
assigned assert set. Keep screenshot, a11y and provenance triples together. New interaction evidence
does not require replacing unrelated baselines.

Browser proof covers Graphite Warm and Paper Ink at 1280×720, 1440×900 and 1024×768, keyboard-only
mapping/rejection/comparison decisions and focus restoration. D04 additionally requires actual
125% zoom at 1280×720 and 200% at 1440×900, with browser version, zoom readback, effective CSS viewport,
scrolling and decision reachability recorded. Recreate the
[accepted shell zoom mechanism](task-9-1-finish-the-shell-navigation-and-accessibility-baseline.md#approved-execution-brief--2026-09-13)
in owned scratch: disposable Manifest V3 extension with tab-scoped `chrome.tabs.setZoom/getZoom`,
owned persistent bundled-Chromium profile, `--disable-extensions-except` and `--load-extension`,
through the prescribed `playwright-cli` playbook. Verify actual zoom before assertions; CSS zoom,
device scale factor, pinch scaling or viewport resizing alone is insufficient. Save the extension,
config/argv and proof script with the receipt so the mechanism is reproducible, then close and remove
only the owned live profile/extension/session. Open the repository specimen before choosing primitives.

| Boundary | Gate / evidence rule |
| --- | --- |
| First stable I1–I4 seam | Establish the meaningful failing regression, apply the fix, then pass affected tests and scoped lint. |
| Logical implementation candidate | Complete the exact focused set above, added affected regressions, changed-path lint, current-build browser/parity and actual-zoom proof. Record effective workers, input tree, exits and evidence paths. |
| Repaired candidate | Rerun invalidated checks; reuse unchanged evidence only after inspecting all relevant input diffs. Never turn an unrun or failed check into a pass. |
| Documentation-only recording | Check links/fragments, existing instruction twins and project-chain cap, roadmap binding, roadmap generation/freshness and whitespace; lint executed test/generator sources. Record unchanged product inputs. |
| 3.1.9.8 finalizer | Consume the exact candidate and sibling candidates, resolve combined/shared artifacts and run its typecheck, focused integration/regression, scoped lint and affected generated/build checks. Development readiness is not group release. |
| 3.1.19 final acceptance | Full repository gates, broad architecture/parity, performance, recovery/live and all frozen A/D acceptance remain deferred. No such result is claimed by this task. |

Use at most four file workers and verify effective runner configuration. The private worktree owns
its index, compiler/evidence files, `dist/dashboard`, `tests/parity/.output`, fixture SQLite/artifact
state and screenshot namespace. The repository runner supplies private `/tmp/hrt-<uid>/run-*`
roots; servers use ephemeral loopback ports, never 3938/5174 or copied operator state. Do not overlap
build/parity writers inside this worktree. Independent read-only gates may overlap within verified
host capacity; no root runner configuration change is authorized.

### Stop, recording and cleanup

Stop dependent work for unavailable worktree capacity, incompatible changed prerequisites, a new
shared owner/API requirement beyond the exceptions above, required DDL, changed workflow/OCR scope,
or an incompatible historical-record contract. Record the exact conflict and evidence; routine
implementation details and tactical fixes stay with the supervisor. Never retry an UNKNOWN submit.

At start/resume and after every verified I1–I5 completion, send **Done / Now / Remaining** before
the next tool call. Maintain current state here: checkout/base/head, accepted proof/input identity,
failures and next check, remaining steps, finalizer intake, integration and cleanup. Use `/handoff`
only for interrupted unique state, not a second plan. Commit exact paths by logical category;
no `git add .`, `git add -A`, push, sibling dispatch or automatic merge.

Finish at **ready for finalizer intake** only when I1–I5 and their focused proof pass. Keep roadmap
completion open for 3.1.9.8's accepted integration and cleanup. Close owned HTTP/SSE/database/browser
resources; retain the exact candidate branch for the finalizer. Remove its worktree only through
verified authorized cleanup, preserving the branch while it is still needed. Never remove a peer's
resources to create capacity.

### Planning persistence and current state

Planning is documentation-only. At approval preflight the primary checkout was clean at the
discovery base and the app inventory showed this planning task as the sole active writer; the
Notifications task was idle and other recent repository tasks were not loaded. Sequential
documentation persistence uses this exclusively available primary checkout under repository
documentation rules. No fifth auxiliary worktree or implementation checkout is created.

Approval is complete; product implementation is unstarted. Planning must persist the complete brief
and linked amendments, validate and commit exact paths, read this owning section from the actual
commit, verify local-ref reachability and prerequisite ancestry, then return one resolved supervisor
prompt. Recheck capacity at handoff: four occupied auxiliary worktrees mean **WAITING ON one free
authorized slot**, even when the approved plan and code prerequisites are committed and available.
No cleanup of peer worktrees or capacity increase is implied by plan approval.

### Planning validation — 2026-09-15

Retained evidence: `/Users/julianhein/Projects/hr-intake-plan-evidence-20260915-bkUaFy`.
This directory contains command logs and verification receipts, not another plan or worktree.

| Check | Result / evidence |
| --- | --- |
| Roadmap binding | PASS: `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts`, 1 suite / 24 tests; `roadmap-binding.log`. |
| Scoped documentation-tool lint | PASS: `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap/parse-plan.ts scripts/roadmap/scan-docs.ts scripts/roadmap/schema.ts --max-warnings 0`; `documentation-lint.log`. |
| Generated roadmap | PASS: `npm run roadmap`, then `npm run roadmap:check`; `roadmap-generation.log` and `roadmap-freshness.log`. Generated `docs/roadmap/index.html` changes only through the generator. |
| Links and instructions | PASS: 29 local links/fragments across the complete task owner and added linked amendments; 9 existing AGENTS/CLAUDE pairs byte-identical; largest complete project instruction chain 18,376 UTF-8 bytes, below 32,768. Reproducible `document-check.py` and `document-checks.json` retain scope, controls and hashes. |
| Approval and scope | The complete I1–I5 proposal, both operator answers, medium/zero-worker allocation, no-review cadence, exact owners/exceptions, proof/gates and finalizer conditions are persisted. The nine authored Markdown files plus generated roadmap are the exact documentation write set. No implementation, test, configuration, dependency or instruction source changed. |
| Prerequisites and capacity | Discovery base and accepted A/B/shell ancestry verified. Proposed implementation branch/path unused; four auxiliary worktrees remain registered. Handoff status is WAITING ON one free authorized worktree slot. |
| Whitespace / persistence | `git diff --check` passed. Final recording-only checks and staged whitespace run before the exact-path commit. The planner then reads the actual committed owner, verifies its full content and local-master reachability, prerequisite ancestry, clean tree and capacity, retaining `commit-verification.json`. |
| Product acceptance | Not run or claimed during planning. The earlier source inspection is feasibility evidence only; I1–I5 and 3.1.9.8/3.1.19 acceptance remain open. |

This receipt adds no implementation scope. Recheck document bindings/freshness and links for the
recording text; reuse the lint result because its exact source/configuration inputs are unchanged.
The full committed plan SHA returned by the verified handoff is also the implementation creation
base. No future or prerequisite-only SHA substitutes for that committed plan.

### Implementation receipt — 2026-09-16

**Ready for 3.1.9.8 finalizer intake.** I1–I5 are implemented and their focused proof is complete.
This is candidate readiness, not roadmap completion or group release. Both approved scope decisions
(**1 A**, **2 A**) remain in force: spreadsheet intake and its explicit prior-import comparison,
with ordinary Run/Rerun and workflow activation reserved to their existing owners.

| Identity | Verified value |
| --- | --- |
| Checkout / branch | `/Users/julianhein/Projects/hr-worktree-intake` · `codex/3.1.9.6-intake` |
| Exact creation base | `ff73cf0c97a589f44bb20075b0278f28a463b016`; committed owner SHA-256 `072f7a5531fd2fb86fb0806f6861d407d62784815c9073921edfdbe131815d45` |
| Accepted prerequisite | `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, verified ancestor before edits |
| Implementation commit | `2a518d007695437697663dc36960dead783d4a01` |
| Verified input identity | `d8bfce41b44f80a5c601b7815fae9ef67ba54cb2fb6d339491055613e2dfbfd0`, SHA-256 of the sorted path→content-hash map retained with each gate |
| Evidence | `/Users/julianhein/Projects/hr-intake-evidence-20260915-r4bjbjka`; exact commands, exits, input hashes, browser reports and reproduction scripts retained there |
| Execution | Local supervisor; zero implementation workers and zero independent reviewers under the Phase 3.1 cadence |

The separately authorized worktree sweep integrated and cleaned the four existing candidates before
Intake creation, leaving zero occupied auxiliary slots. Its primary-checkout tip is
`ac8c620b72ec47d9788909a4a52941a4c741f42a`; evidence is
`/Users/julianhein/Projects/hr-sweep-evidence-20260915-5xbxjnap`. The Intake worktree was then created
from the exact approved base above, not the sweep tip. No Intake-owned production drift was present
in that tip. Intake has not been merged or pushed.

#### Completed steps

| Step | Result and proving boundary |
| --- | --- |
| I1 | Extracted uploader keeps the existing resting Run-modal rendering. Reading/uploading phases are truthful; canceled, unmounted and superseded attempts cannot reopen a workspace. Duplicate selection is fenced synchronously. A lost reply preserves uncertain delivery and same-file recovery. Documented malformed/partial CSV/XLSX errors receive typed refusals before session creation; unexpected infrastructure defects still propagate. |
| I2 | Current unresolved rows are served separately from rejection evidence. Missing bindings, unresolved rows and zero valid rows block Start; acknowledging history cannot bypass readiness. Corrections/exclusions revalidate actual source rows; refused edits retain drafts. Source-backed synthetic EID rejection evidence uses its declared transform while authorized operator samples remain visible. |
| I3 | An open import can select an exact earlier manifest, including a different file, with revision and workflow checks. File, mapping, schema and membership differences are browser reachable. Confirmation binds the current session, derived manifest and exact prior evidence; the kernel re-derives it inside the authority transaction before manifest/member creation. Missing, stale and mismatched bindings refuse; mapping, correction, exclusion, comparison and schema drift invalidate prior review. |
| I4 | Recovery retains the exact command envelope after uncertain delivery. An applied answer followed by unreadable state retries only the exact session read. Historical commands replay before missing-source preparation. Restart, divergent replay, duplicate click, existing last-member rollback, separate same-byte imports and actual member archive transfer preserve immutable source/manifest evidence and terminal read-only behavior. |
| I5 | Built-dashboard CSV/XLSX journeys passed through production Intake routes/service/parser/kernel with disposable SQLite/artifact roots and ephemeral loopback ports. Both themes and 1280×720, 1440×900 and 1024×768 passed, including keyboard decisions, correction/popover focus, explicit comparison and lost-enqueue-reply recovery. Surrounding bootstrap/day/SSE services are explicitly fixtures. No executing worker or external HR action was started. |

#### Focused proof

| Check | Result / retained receipt |
| --- | --- |
| Exact focused unit/architecture set | PASS: **19 suites / 344 tests**, effective maximum four file workers; `focused-tests.log/json`, including all three new suites. |
| Typecheck | PASS: `final-typecheck.log/json`. |
| Changed-path lint | PASS: all **24 changed TypeScript/TSX paths**, including new files, with `--max-warnings 0`; exact argv in `final-scoped-lint.json`. |
| Assigned Intake parity | PASS: **38 cases**, four browser workers; `focused-parity.log/json`, complete report retained in `parity-focused-pass/`. Includes 24 reference scenes, one reference a11y receipt, four accessibility cases and nine production-service interaction cases. |
| Start spreadsheet regression | PASS: both existing theme cases plus one Intake a11y receipt, **3 cases**; `start-parity-verified.log/json`, `parity-start-pass/`. All existing `start-run-spreadsheet` reference bytes remain unchanged. |
| Generated manifest / whitespace | PASS: `manifest-check.log/json`; `git diff --check` and staged whitespace checks. No manifest regeneration, DDL, repository or shared composition change. |
| Actual browser zoom | PASS: Chromium **149.0.7827.55**, tab-scoped zoom readback **1.25** at 1280×720 (CSS 1024×576), **2** at 1440×900 (CSS 720×450), both themes. Confirmation and Start were keyboard reachable and wholly visible after document scrolling; 200% required horizontal scrolling within the inherited 1024×720 canvas. See `zoom-receipts.json`, `i5-zoom-native.log/json`, native screenshots, extension source/config and proof script. |
| Durable effects / isolation | `zoom-authority-effects.json` proves two synthetic queued runs, zero run operations/attempts and zero worker/auth/pool records. Browser journeys assert exact source digests, terminal manifests and member counts; the private harness throws if any external worker or HR execution seam is called. |
| Documentation recording | PASS: roadmap binding **24 tests**, scoped test/generator lint, roadmap freshness, **14 owner links/fragments**, **9** identical instruction pairs and maximum chain **18,376 bytes**; `documentation-binding`, `documentation-lint`, `roadmap-freshness` and `documentation-checks.json`. Product/proof inputs are unchanged. |
| Evidence reuse | `gate-input-comparison.json` proves focused tests, final lint/typecheck, parity, manifest and native zoom used the same product/proof input tree. This receipt changes only its owning Markdown file; broad gates are not inferred from focused results. |

Reference attribution is retained in `reference-attribution.json` and `references-before/`. Only the
four approved Intake scene identities changed for readiness/blocker rendering and explicit comparison
copy/control. PNG/a11y/provenance triples remain present; metadata bytes retain their unchanged fixture,
viewport and source-date identities. Selected real-service and reference screenshots were inspected.
Playwright's ordinary screenshot path misframed native 200% zoom; the final visual evidence uses
`Page.captureScreenshot` through the owned `playwright-cli` session, with actual zoom readback unchanged.
Failed exploratory captures remain identified as failures, not acceptance evidence.

Two existing proof/shell facts were resolved or retained explicitly:

- The plan's literal `--grep start-run-spreadsheet` finds **zero tests**, because the existing test title
  is `start-run spreadsheet handoff`. `start-parity-exact-selector.log` retains that failure. The
  corrected assertion command was `npm run test:parity -- tests/parity/reference-start.spec.ts
  tests/parity/reference-intake.spec.ts --grep 'start-run spreadsheet handoff|intake-review accessibility receipt'
  --workers=4`. The extra Intake receipt satisfies the parity wrapper's required body-backed a11y
  evidence; neither the Start test nor its references were edited. Reference updates likewise gained
  an Intake-owned accessibility receipt and then passed the original exact scene selector (25 cases).
- The existing ordinary Run modal's Cancel does not automatically return focus to its external
  `Start a run` button, even with that button focused before opening. That behavior belongs to the
  reserved modal/DS owner, beyond the permitted component extraction. It is retained for the finalizer
  in `parity-expanded-failure/` and `parity-live-clock-failure/`. The Intake cancellation acceptance
  proves the dialog closes, late accepted replies cannot reopen Intake, and keyboard reopening joins
  the exact persisted import; it does not claim the ordinary modal's focus return was repaired.

#### Finalizer intake and resource state

Consume the implementation commit plus this documentation receipt from `codex/3.1.9.6-intake`.
The branch and worktree remain retained and unmerged. 3.1.9.8 owns operator-controlled integration,
combined gates and eventual branch/worktree cleanup; 3.1.19 owns full repository coverage, broad
architecture/parity and final acceptance. No independent review, automatic merge, push or sibling
dispatch occurred. The task remains unchecked until accepted integration and cleanup.

Owned `intake-proof`/`intake-zoom` browser sessions, specimen preview and disposable zoom HTTP/SSE/SQLite
services are closed. The owned live zoom profile/extension and its authority root were removed;
reproducible extension source, config/argv, server/proof scripts and receipts remain in evidence.
`resource-cleanup.json` records exact resources; peer processes and worktrees were preserved. The
worktree's ignored build/parity artifacts and dependency symlink remain available for the finalizer.
