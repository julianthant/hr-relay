# Task 3.1.9.8 · Finalization — dashboard surfaces
<!-- roadmap: dash-surfaces-finalizer -->

**Current assignment: 3.1.9.8.** Intake: candidates with passing focused checks from 3.1.9.1–3.1.9.7.

- [x] combine every assigned worker candidate and verify the integrated group with focused checks
- [x] fix group defects; pass typecheck, focused integration tests, scoped lint and affected build/generated checks
- [x] record broad gates as deferred to 3.1.19; integrate the focused release, close worker/group records and clean up owned resources

Accepted output releases 3.1.10 Date, 3.1.11 Sessions and 3.1.12 Activity. Full repository gates and final repairs remain at 3.1.19; this is a focused development release.

Read [the group map](README.md#parallel-execution-and-worktree-contract),
[D344](../../../../roadmap/roadmap.md#parallel-finalizer-cadence) and
[D191](../../../reference/guards-and-tests.md#d191--the-recommendation-is-adopted-testcoverage-becomes-the-per-commit-gate-operator-decision-2026-08-12).
These are separate sequential repair/integration assignments, not independent parallel siblings.
The operator launches each finalizer after every listed worker has a committed candidate and green
focused checks. Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13). No independent review
step is required; worker development completion is distinct from the group release.

Before finalizer launch, the focused plan binds the finalizer's exact branch/worktree/base, target,
merge permission, quick worker commands, deferred acceptance checks and resource ownership.
In an isolated integration worktree, combine the exact committed candidates and reconcile generated
output. Run `npm run typecheck`, focused integration/regression tests over the changed interfaces,
scoped lint and affected build/generated checks. The focused brief names exact test/lint paths and
commands. Fix group defects, add regression proof and rerun invalidated checks on the corrected tree.
Pass this scoped verification before releasing downstream consumers; do not claim full acceptance.

Defer full coverage, whole-repository lint/architecture, broad desktop parity, production smoke,
performance, recovery and the complete acceptance matrix to 3.1.19. Retain fixtures, proof commands,
missing broad evidence and exact candidate/integration SHAs for that task. Group-specific targeted
proof remains required where it establishes a changed interface. No full suite is required just
for a group release or documentation-only recording. Preserve coverage floors, assertions, test
membership, timeouts and live-write boundaries. No independent reviewer is required.
Shared contract/scope changes require a revised plan. Other groups' files remain outside ownership.

Current baseline and acceptance: [inventory](task-8-dashboard-inventory.md) and
[frozen matrix](task-8-acceptance-matrix.md). Historical subfeature credit does not close this finalization.

## Approved execution brief — 2026-09-16

The operator replied **approve** to the complete F1–F5 proposal, including F3's narrow Run-dialog
focus repair. This is approval of the plan, not acceptance of unimplemented behavior or permission
to integrate into `master`. All completion checkboxes above remain open.

**Allocation:** one operator-opened GPT-6 Astra supervisor at **medium** reasoning, zero implementation
workers and zero independent reviewers. Combined command schemas, lifecycle custody, notification
identity, shell focus and source-bound proof are a coupled integration assignment. Five surface
candidates are already integrated; splitting the remaining repair and verification would introduce
a dependency on an unfinished combined tree. The Phase 3.1 focused/no-independent-review cadence
applies, with full acceptance at 3.1.19. Execute routine coding and proof repairs locally.

Use `/ui`, Components lead, local execution, with the existing Operate design. Read the nearest
module instructions, relevant DESIGN/PARITY rules, lessons for the actual seam and the specimen
before changing UI behavior. Manual browser work uses the prescribed `playwright-cli` reference.
This assignment adds no redesign or external-system verification.

### Checkout, prerequisites and permission

| Binding | Approved assignment |
| --- | --- |
| Task / mode | 3.1.9.8; one dedicated implementation branch and worktree |
| Implementation branch | `codex/3.1.9.8-surfaces` |
| Absolute implementation checkout | `/Users/julianhein/Projects/hr-worktree-surfaces` |
| Discovery and documentation base | `ac8c620b72ec47d9788909a4a52941a4c741f42a`; clean local `master` at discovery and persistence preflight |
| Accepted parent | `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, with accepted A and 3.1.8 in its ancestry; verified ancestor of the base |
| Approved plan custody / creation base | Retained ref `codex/plan-3.1.9.8`; the planning handoff supplies the full verified commit containing this entire brief. Create the implementation checkout from that exact commit, not a moving branch or prerequisite-only SHA. |
| Planning isolation | `/Users/julianhein/Projects/hr-worktree-surfaces-plan`, branch `codex/plan-3.1.9.8`, for approved documentation only. Remove this owned checkout after verifying the commit; retain its ref. Direct committed-ref delivery requires no planning merge into `master`. |
| Capacity | Intake and Archive occupied two auxiliary worktrees at preflight; this planning checkout is the third. Recheck the four-auxiliary-worktree ceiling, physical paths, refs and ownership before creation. Both proposed implementation names were absent. |
| Integration target / owner | Local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`; the finalizer prepares the focused release. Merge only after passing focused gates and the operator's explicit integration instruction. Plan approval alone grants no merge or push. |
| Start condition | Every surface has an exact committed frozen candidate and passing assigned focused proof. The five accepted integrations are present; Intake and Archive are frozen and verified by the 2026-09-17 launch release below. Recheck their exact identities before implementation. |

Before the first implementation edit, verify checkout, attached branch, approved-plan bytes, base
ancestry, input receipts and clean owned starting state. Create an absent assigned checkout without
re-asking; do not reset a colliding ref or repurpose another session's checkout. A read-only
dependency symlink is permitted; indexes, build output, fixtures and evidence must be private.

### Candidate intake and verified discovery

| Surface | Exact observed input | Availability / evidence |
| --- | --- | --- |
| 3.1.9.1 Shell | `9056e236bf73024ab9649a73c5c6915633e23061` | Accepted through `251d471b27dcdb0d32027fc5dd9acffffe3c6449`; ancestor of the discovery base. See the [Shell owner](task-9-1-finish-the-shell-navigation-and-accessibility-baseline.md). |
| 3.1.9.2 Settings | `368496e0d55a259e8dd098c81a37bbcc9a966763` | Integrated by `c634e900f9858cf63e6ffb093581141a92dd1ecd`. See the [Settings owner](task-9-2-finish-settings-over-the-canonical-settings-authority.md). |
| 3.1.9.3 Storage | `1514c27f069765cb62cf5bcf2b461ba5555eca92` | Integrated by `b3f5904e28ca7c23f11a2a4d8d217cbdecafa5a8`. See the [Storage owner](task-9-3-finish-basic-storage-health-and-recovery-access.md). |
| 3.1.9.4 Explorer | `2ec017d992d74190d54a3af0cd052192294c5e7a` | Integrated by `931e283ab263a26a556aad33ac49c5eeca51a407`. See the [Explorer owner](task-9-4-finish-workflow-explorer-and-catalog-editing.md). |
| 3.1.9.5 Notifications | `387836885d426db81dac63126adc28aea9f71ddd` | Integrated by `ac8c620b72ec47d9788909a4a52941a4c741f42a`. See the [Notifications owner](task-9-5-finish-notifications-and-delivery-behavior.md). |
| 3.1.9.6 Intake | `45748dae4436537ab86585ffa03b95dbc6843caa`, including implementation `2a518d007695437697663dc36960dead783d4a01` | Frozen, unmerged, retained on `codex/3.1.9.6-intake`. Its committed [Intake owner](task-9-6-finish-intake-surfaces.md) contains the 2026-09-16 implementation receipt. Evidence: `/Users/julianhein/Projects/hr-intake-evidence-20260915-r4bjbjka`. |
| 3.1.9.7 Archive | Frozen delivery `27bbbe74791fab7c4f7ec1485922dc2b485fd688`, including implementation `96771ec69511da58e1b79f5b274795fa97c44621` | Unmerged on `codex/3.1.9.7-archive`; AR1–AR5 and assigned focused proof are complete. Its approved plan is `76b2e1fc7809907010b2a1d0f7e117737815902c`, available on `codex/plan-3.1.9.7`. Read the delivery commit's [Archive owner](task-9-7-finish-archive-saved-reports-version-changes-and-deletion.md), including its approved narrow Settings amendment. Evidence: `/Users/julianhein/Projects/hr-worktree-archive/.artifacts/3.1.9.7/resume/`. |

The first five full candidate SHAs exist and are ancestors of the discovery base. Intake and
Archive observed SHAs exist but are not ancestors of `master`. Do not remerge, recreate or reopen
the accepted five merely because their original delivery prose predates the separately authorized
sweep. Preserve those commits, their corrections and cleanup evidence.

The sweep evidence at `/Users/julianhein/Projects/hr-sweep-evidence-20260915-5xbxjnap` includes
`settings-storage-either-order.json`, `storage-reference-resolution.json`, `combined-tests.json`,
`combined-parity.json` and `repository-cleanup.json`. It resolved the Settings/Storage and Catalog
reference overlap, proved either-order production-source equality, and recorded the final combined
41-suite/822-test and 90-case browser selection. It also repaired schema-52 historical fingerprint
and exact-registration compatibility. These are inspected historical receipts, not new planner-run
gates or whole-group acceptance. Reuse only after verifying their relevant input identities.

**Readiness history:** at approval, Archive was still observed at `d971e598987f3eee2512f2ac3d5a08bd9d6cad93`
without a committed AR5 receipt; that observation was **not a frozen intake claim**. The 2026-09-17
launch release below supersedes the WAITING state with the exact verified delivery above. Any later
replacement candidate must carry its changed-input evidence; no moving ref is frozen implicitly.
Archive's untracked `.artifacts/` is owned evidence, not cleanup permission.

### Feasibility, ownership and proof

Requirements remain in the [frozen matrix](task-8-acceptance-matrix.md), the seven child owners,
[dashboard surfaces](../../../reference/dashboard-surfaces.md),
[frontend/backend integration](../../../reference/frontend-backend-integration.md),
[data intake](../../../reference/data-intake-and-edit-data.md),
[operator trust](../../../reference/operator-trust.md) and the phase execution cadence.

| Consequential seam / inspected mechanism | Required outcome and permitted owner | Earliest proof / forbidden result |
| --- | --- | --- |
| Intake extends its request payloads in `src/domain/commands.ts`; Archive extends the lifecycle record and its Archive-delete request. Their inspected changes occupy separate sections. | F1/F2 preserve both strict schemas and their real kernel/service consumers. Combine the remaining exact candidates in either admitted order, resolving additive plan/generated changes without discarding either contract. | Combined strict-schema, command-kernel/restart, command-authority and ingress tests; source comparison for both orders. No lost comparison/review binding or unauthenticated Archive recovery. |
| Intake's `server/intake-acceptance` already transfers a member to Archive and rechecks immutable terminal evidence after restart. | F2 consumes both implementations and repairs integration defects in those owned services/fixtures. | Exact replay, historical request, refusal with zero effects, immutable source/manifest and member-transfer regressions. A new request ID is not proof of fresh execution. |
| Archive retains the accepted deletion request before separate cleanup and final audit. Notification producer tests transfer real reports, preserve source identity, then delete owned publication metadata. | F2 preserves authenticated delayed retry, pending-versus-complete deletion, permanent keys, shared-file custody and notification publication identity across the combined lifecycle storage/composition. | Archive recovery, notification producer/publication, paired-store and custody tests with valid replay and changed-identity negative controls. Reads cause no cleanup; no duplicate publication/deletion, report resurrection or false completed tally. |
| The prior sweep already reconciled Settings/Storage references and schema-52 storage/notification registration. | Preserve accepted source/reference corrections. F2 owns only new group defects; F4 owns combined generation/reference attribution. | Revalidate relevant storage, Settings, Explorer and schema/fingerprint checks against the combined tree; reuse unchanged-input receipts where permitted. Do not choose one leaf's images to erase another's behavior. |
| `RunStartButton` is outside the Radix dialog root; `RunStartSurfaces` receives `setStartOpen`; the current dialog wrapper exposes no close-focus hook. Intake's receipt records Cancel leaving focus without restoring the external door. | F3 narrowly owns `src/dashboard/app/dashboard-app.tsx`, relevant existing app focus models, `src/dashboard/ds/primitives-overlay.tsx`, and focus-only hookup in `src/dashboard/surfaces/run-start.tsx`. Preserve the extracted uploader and ordinary Run/Rerun business behavior. | New `tests/unit/dashboard/run-start-focus.test.ts`, affected shell/Intake browser cases: Cancel/Escape/close restore the launch control; successful takeover retains Intake focus; canceled/superseded uploads cannot reopen it. Include external-button and keyboard launch, both themes and actual browser zoom. |

F1/F2 may repair the union of the seven consumed children's approved source/test paths and their
directly affected shared BFF composition, pure schemas, strict registration, fixtures and generated
sources. Read the exact child amendments from their committed candidates, including Archive's
approved recovery extension, before combining. The existing pure lifecycle-ID extraction may be
retained with its identical identity algorithm; it does not authorize changing lifecycle identities.
F3's shared-file allowance is only the focus behavior above. Tests may extend existing owned suites
and browser cases to expose a combined defect; the new focus suite must contain meaningful cases.
Guard additions/retirements require deciding evidence in `docs/rebuild/guard-inventory.json`.

Ordinary Run/Rerun planning, warning, prior-value and enqueue semantics remain 3.1.11.2. Queue
deletion controls remain 3.1.13; broad cross-surface convergence remains 3.1.16. Do not acquire other
groups' feature scope through a failing test. No schema-floor change, new migration, advanced
recovery UI, external HR transaction, operator-state conversion, automatic backup, legacy runtime
dependency, UNKNOWN-submit retry, push or cutover. New material contracts/ownership return for an
amendment; routine corrections within the admitted outcomes stay with this supervisor.

No deployment or actual operator-state recovery is assigned. Browser proof uses built candidate
assets and disposable synthetic production services. Verify their paths/ports and absence of an
executing HR worker before enqueue or lifecycle tests. Name fixture-only surrounding services; do
not claim a route-stubbed scene proves production command effects.

### Ordered steps

| Step | Required result |
| --- | --- |
| **F1 — Admit inputs** | Verify all seven exact candidates, approvals and proof receipts. Preserve the five accepted integrations; combine frozen Intake and Archive in the finalizer worktree. Retain both command-schema additions and every approved ownership amendment. Record candidate ancestry, either-order source evidence, actual conflicts and their resolutions. |
| **F2 — Repair combined behavior** | Fix group defects across consumed surfaces/services and shared composition, schemas, fixtures and registration. Preserve immutable Intake evidence, authenticated Archive recovery, notification identity and shared-file custody. Add regression proof at the earliest stable affected boundary. |
| **F3 — Close focus gap** | Reproduce the documented dismissal failure, then repair shell/dialog/Run-modal focus hookup. Cancel, Escape and close return focus to the launch control; successful Intake handoff keeps focus in Intake; late canceled upload replies cannot reopen it. Preserve ordinary Run/Rerun semantics. |
| **F4 — Verify release** | Establish combined typecheck, focused tests, scoped lint, targeted browser checks and affected generation. Inspect source-bound references, both themes and actual 125%/200% browser zoom. Repair failures and rerun invalidated checks on the corrected tree; no full-suite ritual after each small change. |
| **F5 — Deliver and close** | Commit exact paths by logical category; record candidate, input, bundle, fixture, reference and proof identities, commands/exits and deferred gates. Await explicit operator integration instruction if absent. After accepted integration, verify target content, preserve durable evidence, clean only accepted inactive resources and close worker/group records. Release 3.1.10–3.1.12 without dispatching them. |

### Focused gates and schedule

During F1–F3, run discriminating affected selectors and their scoped lint. Before F4 release, run
the following on the final combined implementation. The 28 existing unit/architecture paths and
12 browser spec paths were verified across the discovery base and retained candidates. The new
focus suite is an assigned output and must exist and execute before this selection can pass.

```sh
npm run typecheck

npm run test -- \
  tests/unit/{command-kernel,command-kernel-restart,commands-authority,intake-command-arms,notification-publication,sqlite-authority-database,storage-supported-conversion,storage-recovery-status}.test.ts \
  tests/unit/dashboard/{shell-navigation,shell-controls,takeover-frame-focus,settings-catalog-surface,settings-protected-surface,settings-storage-doctor,surface-fixture-boundaries,run-start-focus}.test.ts \
  tests/unit/server/{explorer-acceptance,intake-acceptance,archive-deletion-recovery,notification-producers}.test.ts \
  tests/unit/lifecycle-foundation/two-store-recovery.test.ts \
  tests/unit/archive-transfer/custody-recovery.test.ts \
  tests/unit/architecture/{dashboard-wire-boundary,strict-boundary-schemas,control-command-single-path,command-result-exhaustive,redaction-surface-scan,migration-history-immutability,parity-reference-authority}.test.ts

npm run test:parity -- \
  tests/parity/{shell-navigation,settings-catalog,storage-recovery,explorer-authority,notifications,intake-authority,archive-authority,reference-intake,reference-archive,reference-storage,reference-explorer}.spec.ts \
  --workers=4

npm run test:parity -- \
  tests/parity/reference-start.spec.ts tests/parity/reference-intake.spec.ts \
  --grep 'start-run spreadsheet handoff|intake-review accessibility receipt' \
  --workers=4

npm run build:manifest:check
npm run stores:catalog:check
npm run roadmap:check
git diff --check
```

The brace-expanded commands use zsh/bash. The Start selector is the corrected title recorded by
Intake; `--grep start-run-spreadsheet` selects zero tests and is not acceptance. Keep the Intake
body-backed accessibility receipt required by the parity wrapper. Browser selections use the
authoritative build/global setup and preserve existing membership, assertions, timeouts and pixel
tolerances. Inspect meaningful screenshots; do not refreeze to conceal a failure.

Run ESLint with `--max-warnings 0` over every changed production/test/script/config file, including
new files. Stage only exact owned paths before the candidate lint census so new files cannot be
omitted. This recipe selects changes since the accepted common parent, including consumed workers
and finalizer repairs, and records the expanded argv:

```sh
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
const base = '3d4d8c0c64cf2e96096b193966a66741861d6f1c';
const files = execFileSync('git', [
  'diff', '--name-only', '--diff-filter=ACMR', '-z', base, '--',
  'src', 'tests', 'scripts', 'vitest.config.ts', 'vite.dashboard.config.ts',
  'playwright.parity.config.ts', 'eslint.config.mjs',
], { encoding: 'utf8' }).split('\0').filter(p => /\.(?:[cm]?js|tsx?)$/.test(p));
if (!files.length) throw new Error('implementation-lint-selection-empty');
const args = ['eslint', ...files, '--max-warnings', '0'];
console.log(JSON.stringify(['npx', ...args]));
execFileSync('npx', args, { stdio: 'inherit' });
JS
```

When consumed source changes affect generated output, diagnose attribution, run the relevant
`npm run build:manifest`, `npm run stores:catalog` or `npm run roadmap`, then its freshness check.
Do not hand-edit generated output. For a necessary approved group reference change, use
`npm run test:parity:update --` with the exact affected spec/test selector and `--workers=4`, record
each filename/before-after hash/reason, inspect PNG/a11y/provenance together, then rerun its assert
selection. Preserve accepted Settings/Storage resolutions unless changed inputs invalidate them.

Real zoom proof uses the mandated playwright-cli route with actual browser zoom readback 1.25/2,
both themes and keyboard launch/dismissal/handoff at desktop sizes. Preserve the 1024×720 minimum
canvas and document scrolling; CSS zoom or device scaling is not browser zoom. Bind captures,
focus targets, viewport/zoom and current production bundle identity in durable evidence. Existing
child zoom recipes are reusable inputs, not proof of the new F3 behavior.

Use private disposable authorities, fixture roots, build/parity output and evidence; never operator
ports 3938/5174 or copied authority/credentials. Vitest currently caps file workers at four in the
authoritative configuration; parity needs the explicit `--workers=4` override. Record effective
workers. At most four file workers; serialize build/reference writers sharing one checkout and
generators before their freshness checks. Do not alter root concurrency or gate policy for this task.

Evidence for F1–F5 lives outside removable worktrees under an owned
`/Users/julianhein/Projects/hr-surfaces-evidence-<date>-<unique>` directory, whose resolved absolute
path is recorded here at execution. Retain full command/exit/input records and reports before a
later parity run replaces its output. Preserve Intake/Archive child evidence before any cleanup.

F4 runs combined typecheck once, then repeats only invalidated checks after repairs. Required
focused release checks are not replaced by earlier leaf passes. Other unchanged child/sweep proof
may be reused only with original command/result, tested tree, current candidate and inspected
code/test/config/dependency/reference input equality. New failures remain failures. After authorized
integration, verify the accepted tree and rerun checks invalidated by target movement or conflict
resolution; a byte-identical tested implementation does not require a duplicate broad run.

Documentation-only planning/recording runs roadmap binding, scoped test/generator lint, touched
links/fragments, existing instruction-twin equality and the 32,768-byte chain cap, generated roadmap
freshness and whitespace checks. Inspect unchanged product inputs before reusing code evidence;
these documentation checks never establish new runtime behavior.

### Deferred acceptance, stops and completion

Full coverage, whole-repository lint/architecture, broad desktop parity, production smoke,
performance, recovery/live acceptance and the complete A01–A42/D01–D05 matrix remain **3.1.19**.
The targeted storage/custody/browser regressions above still run; that deferral does not waive a
changed interface's assigned proof. No independent review applies to this Phase 3.1 assignment.
Preserve coverage floors, membership, assertions, isolation, deadlines and live-write boundaries.

Send **Done / Now / Remaining** at start/resume and after each verified F step, before the next
tool call. Keep uncompleted steps, failures, integration permission and cleanup visible. Maintain
one current-state/evidence record here. If interrupted with unique recovery state, use `/handoff`;
normal completed-stage transfer uses this owner.

Pause dependent work for changed/missing prerequisites, failed candidate intake, an actual ownership
collision, or a material scope/contract choice. Do not re-ask approved F3 ownership or routine
implementation choices. The supervisor fixes admitted group defects itself; it does not dispatch
siblings, another finalizer or nested repair tasks.

Freeze a passing committed focused release before requesting any still-missing integration
instruction. After authorization, integrate into the named target, verify ancestry and accepted
content, then clean only incorporated, inactive, clean owned branches/worktrees and exact owned
processes. Preserve durable evidence and unrelated work, including unknown/untracked artifacts.
Close worker/group records only after their required integration and cleanup. No downstream release
before that boundary, no push, no cutover and no automatic next-task dispatch.

### Planning verification — 2026-09-16

The complete approved F1–F5 brief and its narrow allocation pointers are persisted in six
documentation/generated paths only. No product source, test, configuration, dependency, instruction,
migration or completion checkbox changes. The focus correction implements the existing frozen
navigation/accessibility outcome; its allocation does not introduce a new product contract.

Evidence is retained at `/Users/julianhein/Projects/hr-surfaces-plan-evidence-20260916-3pjtz1gt/`.
The final full plan SHA is supplied externally after commit verification, avoiding a self-reference.

| Check | Result and retained evidence |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | Exit 0; one suite, 24 tests. `roadmap-binding.log`; repeated after this recording before commit. |
| Scoped test/generator ESLint | Exit 0 with `--max-warnings 0`; exact command in `planning-gates.json`, output in `lint.log`. This recording changes no lint input, so that result is reused after verifying input equality. |
| `npm run roadmap` then `npm run roadmap:check` | Exit 0; `roadmap-generation.log` and `roadmap-freshness.log`. Regenerated and rechecked after this receipt. |
| `python3 /Users/julianhein/Projects/hr-surfaces-plan-evidence-20260916-3pjtz1gt/check-plan.py` | Exit 0; exact six-document scope, 15 introduced local links/fragments, nine existing instruction pairs equal, maximum complete chain 18,376 bytes, 74 approval controls, 40 existing proof paths and the one assigned new focus suite. All seven observed commits exist; accepted five and parent ancestry verified. Product checkboxes, roadmap graph/status and product inputs remain unchanged. `document-checks.json` binds final document hashes. |
| `git diff --check` | Exit 0; repeated with staged whitespace before the exact-path commit. |
| Product verification | Not run or claimed during planning. Earlier leaf/sweep evidence was inspected for feasibility; it does not establish this group's acceptance. |

Before handoff, the planner reads the actual committed owner, verifies all six committed files
against their checked hashes and the complete approved controls, verifies retained-ref and parent
availability, then removes only the clean owned planning checkout and dependency symlink. The plan
ref remains available as the implementation creation base; `master` and peer worktrees stay unchanged.
`commit-verification.json` and `planning-cleanup.json` record those facts and the final readiness.
At that verification, readiness was **WAITING ON Archive's exact frozen candidate and completed
focused proof**. The release below records the subsequently completed prerequisite. No launch
prompt or implementation is authorized by a merely observed unfinished candidate tip.

### Verified launch release — 2026-09-17

**READY for one fresh Astra/medium supervisor session.** Existing F1–F5 approval is unchanged;
no product implementation, integration permission or broader gate claim is added. The final plan
commit returned by this planner, on `codex/plan-3.1.9.8`, is the exact implementation creation base.
It descends from approved plan `d95292814cbc05494dff4055899aa7ea36a0df3d` and the accepted primary
base `ac8c620b72ec47d9788909a4a52941a4c741f42a`. Create the assigned implementation branch/worktree
from that final plan commit, then F1 combines the exact Intake and Archive deliveries above.

Archive's delivery commit `27bbbe74791fab7c4f7ec1485922dc2b485fd688` contains the committed AR1–AR5
completion receipt. Its only change from implementation `96771ec69511da58e1b79f5b274795fa97c44621`
is its owning Markdown evidence record. The planner verified its approved-plan/parent ancestry,
all 70 changed source/reference hashes, seven runtime-log hashes and the committed delivery-owner
hash against `candidate-inputs.json`, `document-checks.json` and `freeze-verification.json`.

| Required Archive evidence | Verified result |
| --- | --- |
| Assigned service/report/storage selectors | 15 files / 135 tests, exit 0; `gate-1-final.log` |
| Assigned delete/version/SQLite selectors | 4 files / 99 tests, exit 0; `gate-2.log` |
| Assigned architecture selectors | 6 files / 62 tests, exit 0; `gate-3-final.log` |
| Archive parity assert | 45 cases / four workers, exit 0; `parity-final.log` |
| Approved Settings repair checks | 3 files / 35 tests and 22 browser cases, exit 0; `settings-fix.log`, `settings-parity.log` |
| Scoped lint and delivery documentation | 28 changed TypeScript paths; committed receipt records exit 0 and expanded argv in `lint-final.log`. Roadmap binding passed 24 tests; freshness and document audit passed. |
| Visual/reference and cleanup custody | Actual browser zoom 1.25, both themes, reference attribution and stopped owned resources are recorded in the child owner and retained evidence. The tracked checkout is clean; private untracked proof stays with Archive until accepted finalizer cleanup. |

The Archive operator explicitly approved focused fixes in `settings-feedback.tsx`,
`settings-protected-model.ts` and their tests to satisfy the required command-result architecture
gate. Consume that child amendment and preserve its unchanged Settings semantics. This remains
inside the finalizer's approved union of child scopes; the F4 selection already includes Settings
protected/catalog and command-result checks. Reuse the child's additional Settings browser proof
only with verified unchanged inputs, or rerun it when combination invalidates it.

The five accepted surface candidates remain ancestors of the primary base. Intake remains frozen
at `45748dae4436537ab86585ffa03b95dbc6843caa`; its implementation and evidence are unchanged.
Two auxiliary worktrees remain before this planner temporarily reopens its own third checkout;
the planned implementation branch/path remain absent. Recheck volatile ownership/capacity before
creation. This verification grants no merge into `master`; F5's explicit operator integration
condition still applies.

Readiness evidence is retained at
`/Users/julianhein/Projects/hr-surfaces-plan-ready-20260917-mlj4f315/`. `prerequisites.json` records
the input verification; the documentation checks, exact committed-content verification and planning
checkout cleanup are recorded there before the launch prompt is issued. Only this owner and the
roadmap journal/generated page change. No runtime gates are rerun or claimed by the planner.


### Focused candidate delivery — 2026-09-17

**Current state: F1–F5 complete.** The operator authorized integration after the passing candidate
was frozen. Local master accepted the exact delivery tree, and owned cleanup is verified.
The [closure below](#accepted-integration-and-group-closure--2026-09-17) completes the seven children
and releases 3.1.10–3.1.12 for operator-controlled planning/launch; no task was dispatched.
There were zero workers and zero independent reviewers, as approved.

The implementation was frozen at `752607c69bbfc8c425c7a3e1c9e7890b6cc88e84` on
`codex/3.1.9.8-surfaces` in `/Users/julianhein/Projects/hr-worktree-surfaces`. The frozen delivery
is `2109cab8fc6481e1aa2a4eceb9052953a76c6254`; both commits remain in master ancestry after
removing the incorporated branch and worktree. The creation base was exactly
`e7c722c687bc035e083841fbea9c339af75a8453`, verified against the committed owner and retained
`codex/plan-3.1.9.8`. At freeze, master remained `ac8c620b72ec47d9788909a4a52941a4c741f42a`.

Durable evidence is `/Users/julianhein/Projects/hr-surfaces-evidence-20260917-qy8rqtwg/`.
Each gate has a `.json` command/exit/timing record, `.inputs.json` file hashes and full `.log`.
`candidate-inputs.json` binds the implementation/tree, all 390 changed files since the accepted
common parent, final proof/log hashes, 161-file lint census, bundle and effective browser workers.
Child proof is preserved in `intake-child-evidence/` and `archive-child-evidence/`; original child
locations were retained until accepted cleanup, which preserved their private files outside the worktrees. `intake-input-verification.json` independently
matches 2,300 product/proof/configuration inputs to its frozen delivery. Archive's 70 source/reference
and seven runtime-log hashes were reverified at intake.

| Step | Verified result |
| --- | --- |
| F1 | Preserved all five accepted candidate ancestors and their reference/schema corrections. Merged exact Intake `45748dae4436537ab86585ffa03b95dbc6843caa` at `8fd2bd3`, then exact Archive `27bbbe74791fab7c4f7ec1485922dc2b485fd688` at `0537903`. `src/domain/commands.ts` combined without a source conflict. Alternate-order merge-tree proof yields identical source/test/configuration/generated inputs. |
| F1 conflicts | The acceptance matrix retains Archive's extended recovery row and the finalizer's focus row. The boundary owner retains both complete approved ownership amendments. `docs/roadmap/index.html` was regenerated from their union. No intent was dropped. `f1-combination.json` retains both trees and the exact resolutions. |
| F2 | Combined command/restart/ingress, immutable Intake, notification publication, paired-store and shared-file custody checks passed: 16 files/369 cases. The final focused selection repeats these boundaries. Archive's approved Settings feedback/protected-command correction remains byte-identical to its delivery. |
| F3 | `fb81c3f24` exposes Radix's close-focus callback through the existing DS/Run wrappers. The shell restores the external Run door on dismissal and suppresses that restoration for successful Intake handoff. The extracted uploader and ordinary Run/Rerun business logic remain unchanged. Six mounted red cases reproduced Cancel/Escape/Close failures for button and `r` launch; ten new mounted cases pass, including handoff, reopening after handoff and late accepted upload replies after each dismissal. |
| F4 repairs | `752607c` captures the already-created Archive shell URL outside its restart closure, resolving TS18048 without changing its host behavior. The existing parity writer guard now registers five inspected disposable authority/evidence writers and pins their exact destinations, with redirected-reference and extra-write negative controls for each. Both directions of the writer inventory and the reference-update gate remain enforced. The guard inventory records the deciding evidence. |

#### Focused verification

Commands are the exact selections in the approved brief unless an additional focused selector is
explicitly named below. Results describe actual executions; broad acceptance is not implied.

| Gate | Result and evidence |
| --- | --- |
| `npm run typecheck` | Exit 0; `f4-typecheck-final.log`. Initial failure identified the Archive closure narrowing defect; corrected before freeze. |
| Exact 29-path unit/architecture selection | Exit 0; **29 files / 522 tests**, `f4-focused-final.log`. Initial selection found the missing disposable-writer registrations; final complete selection passes after repair. |
| Expanded scoped ESLint | Exit 0, zero warnings; **161 changed production/test/script/configuration files** since `3d4d8c0c64cf2e96096b193966a66741861d6f1c`; full argv in `f4-lint-final.log`. New focus and guard files were staged before the census. |
| Exact 11-spec main browser selection | Exit 0; **138 cases / 4 workers**, `f4-parity.log`; report and attachments preserved in `f4-parity-output/`. |
| Exact Start/Intake receipt selection | Exit 0; **3 cases**, three effective workers under the four-worker cap, `f4-start-parity.log`; `f4-start-output/`. The selector is `start-run spreadsheet handoff|intake-review accessibility receipt`. |
| Archive fixture repair recheck | Exit 0; **7 cases / 4 workers**, `f4-archive-fixture-parity.log`; `f4-archive-fixture-output/`. This replaces the main selection's Archive helper inputs. All other main-selection production/reference/test/configuration/dependency inputs are unchanged, as recorded in `candidate-inputs.json`. |
| F3 neighboring interactions | Exit 0; **4 mounted files / 60 cases** including ordinary Run dialog, uploader and takeover focus; `f3-expanded.log`. **10 browser cases** cover both themes, production spreadsheet journeys, dismissal and canceled accepted upload recovery; `f3-browser.log` and `f3-browser-output/`. |
| Writer guard / inventory metadata | All 15 parity-reference-authority cases pass with live negative controls (`f4-registration-green.log`). The exact retirement/registration metadata selector passes two cases (`f4-inventory-metadata.log`); its other four cases are outside that selector. No guard was added or retired. |
| Manifest, store catalog, roadmap freshness | All exit 0; `f4-manifest.log`, `f4-stores.log`, `f4-roadmap.log`. Manifest/catalog require no regeneration. Roadmap was regenerated after combination and after this recording. |
| Whitespace | `git diff --check` and `git diff --cached --check`, exit 0 before exact-path commits. |

Vitest retains the authoritative four-file-worker cap. Browser reports bind configured and observed
worker identities. Builds/reference writers were serialized within this checkout. The only shared
checkout dependency is the read-only `node_modules` symlink; build output, reports, fixtures and
indexes are private. No whole-repository lint, coverage or broad parity pass is claimed.

Documentation-only delivery checks passed: roadmap binding (24 tests), scoped test/generator
ESLint with zero warnings, roadmap generation/freshness, whitespace, unchanged product inputs and
completion controls, nine existing instruction twins and an 18,376-byte maximum instruction chain.
`document-checks.json` binds the checked document hashes; `freeze-verification.json` verifies those
same bytes after commit. These documentation checks reuse the unchanged runtime proof above.

#### Visual, bundle and resource custody

The built specimen and settled Run/Intake captures were inspected with `/ui` and `playwright-cli`.
`zoom-receipts.json` records actual Chromium `chrome.tabs.getZoom` readback **1.25 and 2** for both
themes, 24 button/shortcut dismissal checks and four successful Intake handoffs. At 125%, the
1280×900 viewport yields the 1024×720 CSS canvas; at 200%, 1440×900 yields 720×450 CSS pixels
while the application preserves its 1024×720 canvas and document scrolling. CSS zoom remains 1.
Restored launch controls remain visible; Intake owns arrival focus and Tab reaches its Close control.
Eight settled native PNGs and their accessibility trees are retained as `zoom-*.png` / `.a11y.yml`.
Additional combined Explorer catalog, Archive image and Notification inbox captures were inspected.
No reference triple changed after combining the approved children; their attribution files remain
with their copied evidence. No reference update or tolerance change was needed.

The production bundle stamp is input digest `b56dfadc453d3573587426d6c25b0b9305335172d16cfd069779912333fe90ec`,
output digest `4df0ffa05447a76079b885614ddc873c9ef53055a41fce1d63ff212ac9b7ebc8`.
Manual proof uses the real Intake routes/services over a fresh synthetic authority; surrounding
shell/SSE services are explicitly `fixture-bff`. No HR worker executes. `manual-server.json`, proof
scripts, native zoom extension source/configuration, source CSV/hash and bundle identity are retained.
An initial native capture caught entry transitions; it was retained diagnostically and replaced
by captures after finite animations and two rendered frames. CLI sandbox `Buffer`/`URL` diagnostic
errors were repaired in the external proof script; neither changed production code.

`resource-cleanup.json` verifies both owned browser sessions closed, the exact manual server exited,
its ephemeral port closed, synthetic authority removed and owned zoom profile removed. Operator
ports 3938/5174, authority, credentials and peer processes were untouched. At candidate freeze, child/finalizer worktrees,
branches and ignored proof outputs remained for operator-authorized integration and cleanup; their
verified final disposition is recorded below.

#### Delivery assessment and deferred acceptance

Two within-scope proof defects were discovered by the required finalizer gates: Archive fixture
TypeScript narrowing and unregistered disposable writers from consumed children. Both are inherited
implementation/proof defects under the approved F1/F2 union, repaired together without a scope
amendment or changed product contract. Earlier execution of the assigned combined checks would have
exposed them; no additional review stage or broader child gate is inferred. The focus defect was
already planned and reproduced before repair. A failed first red-test diagnostic compared DOM objects;
using boolean identity preserved the assertion and produced six specific failures instead of a
worker inspection failure. No independent review, worker, sibling or next-task dispatch occurred.

One extra inventory invocation unintentionally selected the broad rebuild ratchet. It **failed** on
13 `fail-loud-catch-default` findings across nine files, all verified byte-identical to combined child
input `0537903`. This is not a passed or waived check. `deferred-broad-findings.json` and
`f4-guard-inventory.log` retain exact paths and hashes for **3.1.19**, the already assigned broad
architecture/acceptance owner. Only the inventory metadata selector was needed for this record.
No broad assertion, guard exemption or inherited source was changed to hide those findings.

Full coverage, whole-repository lint/architecture, broad desktop parity, production smoke,
performance, recovery/live acceptance and the complete A01–A42/D01–D05 matrix remain **3.1.19**.
The required focused release gates above pass. At candidate freeze, explicit operator integration instruction was still required. The accepted
integration and cleanup below satisfy that boundary. No push or downstream launch occurred.


### Accepted integration and group closure — 2026-09-17

After frozen delivery `2109cab8fc6481e1aa2a4eceb9052953a76c6254` was reported, the operator
instructed **“do it”** at the explicit master-integration boundary. Master was reverified clean and
unchanged at `ac8c620b72ec47d9788909a4a52941a4c741f42a`; candidate hashes, plan and child ancestry
were rechecked before merging. Integration `801da4f3d1bfdf0a9ecc81c993289f70699aa140` has parents
that master tip and the exact frozen delivery. Its complete tree is
`27ef19a58b43235e13ff79842ff05a9e39932486`, identical to the frozen delivery. There were no merge
conflicts or invalidated runtime inputs. The focused gate results above therefore remain applicable;
no duplicate broad gate was run or claimed.

| Child | Accepted candidate | Local integration and cleanup |
| --- | --- | --- |
| 3.1.9.1 Shell | `9056e236bf73024ab9649a73c5c6915633e23061` | `251d471b27dcdb0d32027fc5dd9acffffe3c6449`; prior accepted cleanup preserved. |
| 3.1.9.2 Settings | `368496e0d55a259e8dd098c81a37bbcc9a966763` | `c634e900f9858cf63e6ffb093581141a92dd1ecd`; prior sweep cleanup preserved, including subsequent approved Archive correction. |
| 3.1.9.3 Storage | `1514c27f069765cb62cf5bcf2b461ba5555eca92` | `b3f5904e28ca7c23f11a2a4d8d217cbdecafa5a8`; prior sweep cleanup/reference resolution preserved. |
| 3.1.9.4 Explorer | `2ec017d992d74190d54a3af0cd052192294c5e7a` | `931e283ab263a26a556aad33ac49c5eeca51a407`; prior sweep cleanup preserved. |
| 3.1.9.5 Notifications | `387836885d426db81dac63126adc28aea9f71ddd` | `ac8c620b72ec47d9788909a4a52941a4c741f42a`; prior sweep cleanup preserved. |
| 3.1.9.6 Intake | `45748dae4436537ab86585ffa03b95dbc6843caa` | `801da4f3d1bfdf0a9ecc81c993289f70699aa140`; worktree and implementation branch removed after incorporation/custody verification. |
| 3.1.9.7 Archive | `27bbbe74791fab7c4f7ec1485922dc2b485fd688` | `801da4f3d1bfdf0a9ecc81c993289f70699aa140`; worktree and implementation branch removed after incorporation/custody verification. |

`integration-verification.json` binds the accepted tree and parents. `worktree-custody.json` records
353 private files moved without loss from Intake, Archive and Surfaces into
`retained-worktree-files/` under the durable evidence directory above; every file hash and symlink
identity was checked after moving. This includes all untracked Archive proof and ignored browser,
bundle, tracker and parity outputs. Existing `intake-child-evidence/`, `archive-child-evidence/`,
`frozen-dashboard-bundle/` and the original external Intake evidence remain available.

Before removal, all three incorporated worktrees were clean including untracked/ignored files,
unlocked and inactive. The dependency symlinks were unlinked without touching the primary
`node_modules`. Ordinary `git worktree remove` and `git branch -d` removed exactly
`hr-worktree-intake` / `codex/3.1.9.6-intake`, `hr-worktree-archive` / `codex/3.1.9.7-archive`, and
`hr-worktree-surfaces` / `codex/3.1.9.8-surfaces`. `repository-cleanup.json` verifies registrations,
physical paths and refs absent, with only the primary worktree remaining and all unrelated/planning
refs unchanged, including `codex/plan-3.1.9.8`. No exact separate task/host association was recorded;
no task was guessed or archived. No owned repository resource remains to clean.

This completion-only record changes no product, proof, dependency, configuration or acceptance
contract input. The documentation gates cover roadmap binding, scoped test/generator lint,
roadmap generation/freshness, touched links/fragments, instruction twins/chain limits and whitespace.
Their exact command/exit/input receipts use the `f5-closure-` prefix; `closure-document-checks.json`
and `completion-verification.json` bind the committed record and unchanged runtime inputs.

**3.1.9.1–3.1.9.8 are complete under the approved focused cadence.** This releases 3.1.10 Date,
3.1.11 Sessions and 3.1.12 Activity for operator-controlled planning/launch. Full acceptance and the
retained 13 broad-ratchet findings remain assigned to **3.1.19**; they are neither passed nor waived.
No push, sibling dispatch, next-task launch, production cutover or independent review occurred.
