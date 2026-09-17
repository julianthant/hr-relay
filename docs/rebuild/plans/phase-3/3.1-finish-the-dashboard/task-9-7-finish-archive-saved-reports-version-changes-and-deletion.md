# Task 3.1.9.7 · Finish Archive saved reports, version changes, and deletion
<!-- roadmap: dash-archive -->

**Current assignment: 3.1.9.7.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. The approved execution brief below and the [Archive ownership amendment](task-9-establish-independent-dashboard-boundaries.md#archive-child-ownership-amendment-2026-09-16) add the narrow deletion-recovery repair. Other shared registration and generated outputs remain reserved.

- [ ] Finish saved-report browsing, frozen values, version-change review/apply, report export,
  terminal-only live deletion and exact saved-report deletion, with idempotence, honest storage
  deltas, shared-file custody and convergence.
- [ ] Consume the separate `archive.sqlite` / `archive_records` authority without current workflow
  descriptors or live failure/settings parsers. Version changes use `version_changes`; deletion
  retains canonical disposition, progress and permanent-key warning semantics.
- [ ] Credit accepted indexed filters, safe attachment downloads and reference-aware deletion only
  within the 2.6 A/H proof. Complete the remaining UI/production-browser cases and whole-report
  export; test missing/corrupt bytes, stale selection/filter response, partial transfer/deletion,
  exact replay, changed review membership and truthful generic-outcome labels.
- [ ] Verify Archive has no Relaunch/Rerun/Retry/Restart execution door. The C0 archive amendment
  and 2.6.9 relaunch-history retirement supersede the former `archived_runs`, archive relaunch and
  `archive_relaunches` requirements; do not restore those tables or commands.

The historical filename remains a citation alias. Original 2026-09-04 requirements named D330.7/.8
and D332.7; the later C0/final 2.6.9 amendments above are the current requirements. Frozen report
identity and source digest survive supported recovery; they are not reconstructed from current code.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-16

The operator selected **1 A** to include the narrow backend deletion-recovery repair, then replied
**approve** to the complete AR1–AR5 proposal. This records approved implementation scope, not
completed product behavior. All product checkboxes above remain open.

**Allocation:** one operator-opened GPT-6 Astra supervisor at **medium** reasoning; zero workers,
zero independent reviewers. Request retention, canonical deletion, recovery projection and the
mounted UI form one coupled acceptance unit. Splitting it would make one assignment consume an
unfinished recovery interface. The Phase 3.1 focused/no-independent-review cadence applies.
Use `/ui`, Components lead, local execution, inherited Operate design. Read dashboard instructions,
the relevant DESIGN/PARITY rules and the specimen before implementation choices; use the prescribed
playwright-cli playbook for manual browser inspection. Routine implementation choices stay with the
supervisor. Do not dispatch siblings or the finalizer.

### Checkout, prerequisites and release

| Binding | Approved assignment |
| --- | --- |
| Repository / target | `/Users/julianhein/Projects/hr-automation-rebuild`; local `master`, integration controlled by the operator through 3.1.9.8 |
| Task / mode | 3.1.9.7; create a dedicated implementation branch and worktree from the verified planning commit |
| Implementation branch | `codex/3.1.9.7-archive` |
| Absolute implementation checkout | `/Users/julianhein/Projects/hr-worktree-archive` |
| Discovery and documentation base | `ac8c620b72ec47d9788909a4a52941a4c741f42a`; clean local master at discovery and persistence preflight |
| Accepted prerequisite | 3.1.9 B integration `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, with accepted A and 3.1.8 in its ancestry; verified ancestor of the discovery base |
| Approved plan custody | Retained ref `codex/plan-3.1.9.7`; the planning handoff supplies the full verified commit containing this entire brief. Create implementation from that commit, not an inferred prerequisite SHA or moving master. |
| Planning isolation | `/Users/julianhein/Projects/hr-worktree-archive-plan`, branch `codex/plan-3.1.9.7`, used only for approved documentation persistence; remove this owned checkout after commit verification, preserving the ref. Direct committed-ref delivery requires no planning merge into master. |
| Available capacity | At preflight only the Intake implementation worktree was registered beside the primary checkout; Archive branch/path were absent. Recheck the four-auxiliary-worktree ceiling, refs, physical paths and ownership before creation. |
| Merge condition / owner | Freeze AR1–AR5 with passing focused gates and exact evidence. Operator-controlled 3.1.9.8 combines candidates, resolves shared/generated/reference output, performs focused integration, and owns accepted candidate cleanup. This task grants no self-merge, push or downstream release. |

Before the first product edit, verify the actual checkout/branch, clean starting tree, exact approved
plan, base ancestry and current resource ownership. An absent planned branch is expected; create it
without re-asking. Never reset, switch, stash or remove a peer's checkout. A read-only dependency
symlink is allowed; Git index, build output, fixtures and evidence must be private.

Intake owns Intake payload definitions in `src/domain/commands.ts`; Archive owns only the lifecycle
record's Archive-delete recovery metadata. Neither requires the other's unmerged implementation.
Preserve the existing Intake allocation and merge order. Both candidates must work against their
own committed bases. 3.1.9.8 combines these separate shared-file additions in either admitted order
and runs the relevant combined schema/command checks. Follow the focused-sessions Parallel
coordination reference: no routine peer check-ins, index reservation queue or reassignment.

### Requirements, feasibility and inspected evidence

The normative owners are [A15–A18](task-8-acceptance-matrix.md#a15),
[C0 Archive](../../../reference/dashboard-surfaces.md#c0-archive-summary-and-surface-contract--2026-09-09),
[the approved recovery/export amendment](../../../reference/dashboard-surfaces.md#archive-recovery-export-amendment-2026-09-16),
[archived privacy](../../../reference/operator-trust.md#c0-archived-evidence-and-privacy--2026-09-09),
and the [desktop contract](../../../reference/frontend-backend-integration.md#d340--desktop-only-dashboard-support-operator-decision-2026-09-06).
The current code base has authority schema 52 and floor 46; this assignment changes neither.

| Question / current mechanism | Required change / permitted owner | Earliest acceptance proof |
| --- | --- | --- |
| Saved browsing already uses `archive-report.tsx`, `useSavedResource`, strict Archive queries and indexed `queryArchiveReports`. The detail read is independent of list membership. | Finish filter/pagination/history behavior within Archive surfaces/models; preserve bounded reads, deterministic ties, cursor/selection reset and obsolete-response suppression. Filters remain workspace drafts; Back/Forward restores exact route selection, even outside the current filtered page. Leaving/reopening the workspace resets its drafts without rewriting shared route semantics. | AR2 mounted tests plus AR5 real browser/service queries, including delayed old list/detail responses. |
| `SavedArchiveReport` renders generic frozen sections; no whole-report export. `projectArchiveReport` excludes private source payloads/digests. `SavedReportList` maps generic done to a verified-write StatusPill. | Export exactly the served public saved-report wire, with stable run-ID filename; render generic outcomes without inventing readback proof. Preserve declared absences and frozen values with originating descriptors/live parsers unavailable. | Exact parsed JSON equality, planted privacy canaries, all generic outcomes and browser download; AR2. |
| Verified attachment membership and safe same-origin URLs exist; production HTTP tests cover corrupt/missing bytes. Current saved attachment UI only links a download. | Finish generic saved-image inspection/lightbox, keyboard/focus behavior, download and explicit missing/corrupt/unsafe states using existing DS primitives and strict resource identities. Do not turn metadata presence into byte verification. | AR2 strict-client/mounted proof, then D03 browser image decode, focus and actual bytes. |
| `version_changes` retains immutable review and applying progress. Public/private review binding and authenticated apply recovery already exist. Current UI refreshes only after applied results and shows limited review details. | Draw reviewed scope/kind/members/blockers, refresh replacements after refusal, keep results visible, and resume the authenticated original request. Major transfers reviewed terminal prior-version membership; minor transfers none. | AR3 mounted interaction; AR5 real command route with changed membership, restart and partial transfer. |
| Archive delete commits canonical tombstones/lifecycle journal before separate file settlement and final operator audit. The lifecycle record retains a fingerprint, not the exact accepted envelope. `stampOperatorCommand` supplies a fresh time if the final operator journal is absent. | AR1 retains narrowly validated accepted Archive-delete request metadata in the existing lifecycle command/audit record, atomically with canonical deletion and before external file settlement. Bind replay to that identity after BFF provenance admission; never trust a caller-authored timestamp or broaden identity equivalence. | Delayed HTTP retry after settlement/audit failure, restart and exact positive replay; changed actor/target/fingerprint/intent refuses before further effects. |
| Saved report disposition immediately says deleted; it does not expose remaining cleanup or command settlement. Existing archive deletion rows and canonical receipts retain progress/tallies. | Add read-only, identity-bound deletion readback through lifecycle/Archive ports and wire; distinguish canonical removal, pending cleanup and completion. UI resumes only an authenticated retained request and never infers completion from a tombstone alone. | AR1 service/state tests and AR4 mounted/AR5 browser recovery, including missing/corrupt historical evidence. |
| Shared-file custody, terminal tree admission and exact replay are already tested in `archive-transfer`; A18 assigns live controls to Queue. | Preserve those authorities; prove live terminal-only deletion and custody in service tests, Archive UI deletion here, Queue UI at 3.1.13 and cross-surface convergence at 3.1.16. | Before/after canonical receipts, surviving shared-file owners and actual bytes; no invented physical storage savings. |

**Executed planning probe:** against the discovery base, a disposable `archiveFixture` passed an
Archive-delete request through `stampOperatorCommand`, interrupted `settlement`, advanced the clock
one second and retried the same browser intent. Output was
`firstError=injected-settlement`, `restamped=true`, `retryState=rejected`,
`retryCode=command-divergent`, `reportOwner=deleted`; replaying the original stamped envelope
returned `applied`. The fixture was disposed. The first diagnostic attempt encountered macOS
temporary-path symlink admission; using canonical `TMPDIR=/private/tmp` reached the actual boundary.
No operator data or repository file was changed. Scoped ESLint on the ingress, Archive command,
run-record service and diagnostic fixture exited zero. This is a discriminating probe, not a claim
that future recovery acceptance passed.

No deployment, operator database conversion or actual-target recovery is assigned. Production-browser
proof means the real application routes/services over disposable synthetic authorities and a built
candidate. No external HR action or access question is needed. Shared seeded/fixture harnesses are
inputs, not proof that current Archive commands already work; create the dedicated owned authority
helper described below, preserving production ingress and command handling.

### Exact ownership and exclusions

Production scope:

- `src/dashboard/surfaces/archive-report.tsx`, `archive-report-model.ts`, existing `archive.tsx` and
  `archive-model.ts` only for affected Archive consumers; new Archive-local helpers/components;
  `src/dashboard/client/archive-queries.ts` and `src/dashboard/state/archive-client.ts`.
- `src/domain/dashboard/archive.ts`, `src/server/dashboard/queries/archive-reports.ts`,
  Archive-specific functions in `queries/archive.ts`, and dedicated `routes/archive.ts` /
  `routes/archive-types.ts` only as needed for these readback contracts.
- **Approved recovery extension:** Archive-delete metadata only in `src/domain/commands.ts`;
  retention/replay only in `src/core/run-record-service.ts` and `src/core/archive-version-changes.ts`;
  identity-bound read access only in `src/infra/sqlite/authority-database.ts`,
  `src/infra/sqlite/lifecycle-storage.ts`, and an Archive-local adapter helper if useful.
  Consume `archive-database.ts`'s existing deletion/file state; no new deletion policy or writer.
- Archive-specific binding in `src/server/dashboard/commands/command-service.ts`, existing
  `version-review-binding.ts` only if affected, and a new `archive-deletion-binding.ts` if useful.
  The exact dependency wiring call in `src/server/dashboard/compose.ts` and matching types is
  admitted. Prefer this dedicated binding after existing ingress over changing shared provenance.
  If required, changes in `operator-command-ingress.ts` are limited to authenticated Archive-delete
  acceptance recovery; Host/Origin, content-type, actor admission and other families stay unchanged.

The retained envelope uses a narrowly validated, read-forward JSON extension, admitted only for
Archive deletion. Existing immutable records are not rewritten or backfilled. Historical records
without recoverable evidence must expose that absence, while existing exact-envelope replay remains
valid. Validate retained metadata against the lifecycle command fingerprint, operation, actor,
target and audit identity. Private report/source digests or source payloads never become public
recovery references. No new table, DDL, migration or schema-floor change is admitted.

Proof scope includes existing `tests/unit/archive-report-ui/`, `tests/unit/archive-transfer/`,
Archive dashboard/server suites, `tests/unit/served-database-surfaces/archive-api.test.ts`,
`tests/unit/archive-protected-identity.test.ts`, `tests/unit/commands-authority.test.ts`,
`tests/unit/sqlite-authority-database.test.ts` and exact affected lifecycle/ingress assertions.
Add `tests/unit/server/archive-deletion-recovery.test.ts`,
`tests/parity/helpers/fixture-archive-authority.ts` and `tests/parity/archive-authority.spec.ts`.
These must execute meaningful cases, not empty selectors. Own the existing Archive fixture,
route, evidence, report and reference-scene modules and four Archive parity specs listed below.
Only exact affected entries in strict-schema/wire/redaction/route architecture registrations and
test constructions may change. Guard addition/retirement requires the deciding evidence in
`docs/rebuild/guard-inventory.json`; no guard weakening or inventory-only bypass.

Reference scope is `archive-ledger`, `archive-run`, `archive-version-bump`, `archive-evidence`,
`archive-report-saved` and `archive-report-zoom`. Change only references affected by AR1–AR4, with
exact filename, before/after hash, reason, visual/a11y inspection and subsequent assert pass.
New scenarios use Archive-owned profiles and private evidence. Do not rewrite shared scene
membership, surrounding default fixture facts, DS/specimen, shell/providers/transport or sibling
surfaces. Read existing shared harnesses without modifying their custody/identity/service defaults.

Queue delete controls remain 3.1.13; paired cross-surface convergence remains 3.1.16. Preserve the
current notification/history contracts and test Archive's canonical results without taking their
UI ownership. Broad performance/virtualization measurements remain 3.1.17/3.1.19. No advanced
recovery UI, current-descriptor reconstruction, restored `archived_runs`/`archive_relaunches`,
Archive Relaunch/Rerun/Retry/Restart execution door, external HR transaction, operator-state mutation,
automatic backup, push or cutover. Generated artifacts remain generator-owned and finalizer-combined.

### Steps and required proof

| Step | Required result |
| --- | --- |
| **AR1 — Repair deletion recovery** | Reproduce the delayed HTTP retry failure through real ingress, then retain the accepted request and authenticate exact replay. Serve identity-bound deletion receipt/cleanup progress. Cover interruption before/after canonical removal, during file settlement and before final operator audit; reopen/retry with a later clock; prove one canonical deletion, one final audit and no other target effects. |
| **AR2 — Complete report browsing and evidence** | Finish bounded filters, deterministic pagination and exact route/history selection; ignore stale list/detail/attachment results. Render frozen generic values and truthful outcomes. Export exactly the public report as JSON; finish safe available-image/lightbox/download and honest unavailable states. |
| **AR3 — Complete version review** | Draw scope, major/minor kind, reviewed membership, blockers, progress and bound outcomes; refresh replacement reviews after refusal and require explicit renewed confirmation. Keep successful results through refresh; resume only the original authenticated apply. |
| **AR4 — Complete deletion interaction** | Preserve confirmation and permanent-key warning. Show pending cleanup separately from completed deletion, retain recovery after reload where evidence permits, and keep unavailable historical recovery explicit. Bind late result/readback to its original report; update only matching selection and list state. Never append an unsupported "nothing changed" assurance. |
| **AR5 — Prove and freeze candidate** | Complete focused service/mounted/browser proof, inspect references and actual desktop zoom, repair affected failures, record exact evidence and commit logical categories using exact paths. Freeze for operator-controlled 3.1.9.8 intake; close only owned processes and retain candidate/evidence until finalizer cleanup. |

The following interacting cases are mandatory, not independent happy-path substitutes:

| Boundary / combination | Required result / forbidden effects |
| --- | --- |
| Cleanup or audit interrupted + clock advances + same HTTP intent | Exact accepted request resumes after server/browser reload; no invented fresh ID/time, duplicate deletion or premature completion. |
| Same retained command ID + changed actor, target, archive reference or optional intent | Refuse before cleanup/writes to any new target. Include a valid original replay control so setup failure cannot satisfy refusal. |
| Canonically deleted + cleanup incomplete + missing/malformed recovery evidence | Show pending/unavailable evidence explicitly; no report resurrection, guessed request or false completed tally. Reads cause no settlement. |
| Old record without new metadata + original retained envelope | Preserve existing canonical replay; no backfill. If a browser cannot authenticate recovery, show the exact limitation rather than inventing an envelope. |
| Major review + changed membership/blockers/identity before apply | Renew review and require explicit confirmation; no transfer from the stale approval and no active-source transfer. |
| Partial transfer + restart + same/competing apply | Resume the exact original claim; refuse competing identity and preserve frozen report/source digests, pending capture custody and independently owned evidence. |
| Minor review with prior runs, including active runs | Archives none and reports the minor result truthfully; no fabricated major blocker/candidate semantics. |
| Shared live/report/pending-capture file ownership + deletion interruption/replay | Preserve every surviving owner's verified bytes; remove exclusively owned files only. Match canonical row tallies and measured fixture byte deltas; do not equate SQLite file size with logical rows removed. |
| Delete report A + select B before result | B remains selected; A's progress/result stays bound to A. Back/Forward to A shows current deletion disposition. |
| Filter/page/detail changes + older response resolves last | Current query and exact selected report win. New filter resets cursor/selection; malformed/failed reads never become plausible empty lists. |
| Report export/image/download + retired descriptor or missing/corrupt/foreign bytes | Export equals the public wire and contains no private source material; attachment handling rechecks exact membership/bytes. No execution door or verification claim inferred from a generic outcome. |

Real-browser proof must use the built dashboard with real Archive queries, canonical services and
command ingress against private synthetic state. Route-stubbed fixture parity supplements this
proof; it does not replace it. Prove all A15–A18 cases at their earliest stable boundary, plus D03
at 1024×768 and the 1024×720 minimum canvas, both themes, keyboard-only navigation, reduced motion,
actual browser zoom and saved image/lightbox focus/escape. Keep page errors fatal and verify native
downloaded bytes. No mobile/coarse-pointer variants. Broad combined acceptance remains deferred.

### Gate schedule and resources

During AR1–AR4 run focused selectors that establish the changed behavior, then scoped lint. Group
logical repairs; do not run full suites after every small edit. Before AR5 delivery run:

```sh
npm run test -- tests/unit/archive-report-ui tests/unit/archive-transfer tests/unit/served-database-surfaces/archive-api.test.ts tests/unit/archive-protected-identity.test.ts tests/unit/commands-authority.test.ts tests/unit/server/archive-deletion-recovery.test.ts
npm run test -- tests/unit/dashboard/archive-delete-door.test.ts tests/unit/dashboard/archive-bump-round-trip-press.test.ts tests/unit/dashboard/archive-bump-applied.test.ts tests/unit/sqlite-authority-database.test.ts
npm run test -- tests/unit/architecture/archive-invariants.test.ts tests/unit/architecture/command-result-exhaustive.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/architecture/control-command-single-path.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/redaction-surface-scan.test.ts
npm run test:parity -- tests/parity/reference-archive.spec.ts tests/parity/archive-report.spec.ts tests/parity/archive-accessibility.spec.ts tests/parity/archive-evidence.spec.ts tests/parity/archive-authority.spec.ts --workers=4
git diff --check
```

Run ESLint on every changed production/test/script file and record expanded argv. For a reproducible
candidate check, stage only the exact owned paths first, then execute the following from the assigned
checkout with the full approved plan commit supplied as the argument. It covers staged and committed
changes together; do not omit untracked implementation files from the candidate.

```sh
node --input-type=module - "$PLAN_COMMIT" <<'JS'
import { execFileSync } from 'node:child_process';
const planCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(planCommit ?? '')) throw new Error('exact-plan-commit-required');
const files = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', planCommit, '--', 'src', 'tests', 'scripts'], { encoding: 'utf8' }).split('\0').filter(p => /\.tsx?$/.test(p));
if (files.length === 0) throw new Error('implementation-lint-selection-empty');
const args = ['eslint', ...files, '--max-warnings', '0'];
console.log(JSON.stringify(['npx', ...args]));
execFileSync('npx', args, { stdio: 'inherit' });
JS
```

The planning prompt resolves `PLAN_COMMIT`; this variable is not a future or guessed SHA. The
parity wrapper imports the authoritative configuration, rebuilds/stamps the private candidate and
retains screenshot/a11y/provenance verification. Its `--workers=4` caps file workers; record effective
workers and selected tests from the report. Unit gates use the repository runner's private
`/tmp/hrt-<uid>/run-*` resources. At most four file workers; no overlapping build/parity writers in
one checkout. Ports are ephemeral, never operator ports 3938/5174. Do not copy operator roots,
credentials or authority. Evidence belongs under the implementation checkout's private
`.artifacts/3.1.9.7/`; preserve candidate/source/bundle/fixture/reference identities and commands/exits.

If approved reference changes are needed, use `npm run test:parity:update --` with the exact affected
Archive spec/test selectors and `--workers=4`, inspect and attribute each changed triple, then rerun
the assert lane above. Update is never a substitute for investigating a failure. Reuse passing
checks only with recorded unchanged inputs; rerun affected proofs after repairs. Any descriptor
import-closure change requires `npm run build:manifest` then `npm run build:manifest:check` and
recorded attribution; catalog sources are otherwise excluded. Never hand-edit generated outputs.

Documentation-only planning/recording runs roadmap binding, scoped test/generator lint, touched-link
checks, instruction-twin equality and the 32,768-byte chain cap, roadmap generation/freshness and
whitespace checks. No prior runtime gate is reused as proof of the new behavior.
3.1.9.8 owns combined typecheck, focused integration/regressions, scoped lint and affected build/output
checks. Full coverage, whole-repository lint/architecture, broad parity, production/performance,
recovery and full A01–A42/D01–D05 acceptance remain at 3.1.19.

### Delivery and stop conditions

Send Done / Now / Remaining at start/resume and after each verified completion, before the next
tool call. Keep unfinished AR steps, gates, integration and cleanup visible. Record the candidate
SHA, proof inputs, real commands/results and deferred work in this owner. Tactical fixes stay with
the supervisor. No independent review under this phase exception.

Return for amendment only if SQL/DDL or schema-floor changes, another command family, broader
shared ownership, changed deletion semantics or a material compatibility conflict become necessary.
Do not transfer an inspected contradiction to finalizer discovery. Preserve the existing terminal
tree, tombstone, permanent-key, shared-file and UNKNOWN-submit safeguards. Do not re-ask approved
scope or routine choices. If interrupted with unique recovery state, use `/handoff`.

Commit and freeze the focused candidate, retaining branch and evidence for 3.1.9.8. Close only owned
servers/browsers/resources. Product completion remains open until required integration and cleanup.
No automatic merge, push, sibling launch or next-task dispatch. The planner stops after verified
documentation handoff; product implementation starts in a fresh supervisor session.

### Planning verification — 2026-09-16

This section records documentation custody and checks before handoff. The final full plan SHA is
resolved from the commit containing this section and supplied externally, avoiding a self-reference.
Planning changes are limited to this task, its parent ownership record, the acceptance-matrix
ownership pointer, the Archive contract amendment/decision pointer, roadmap journal and generated
roadmap page. No runtime code, tests, dependencies, configuration, instruction file, migration or
product checkbox changes. Evidence is retained outside the temporary planning checkout at
`/Users/julianhein/Projects/hr-archive-plan-evidence-20260916-9VWO0W/`.

| Planning check | Verified result |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | Exit 0; 1 suite / 24 tests. `roadmap-binding.log`; repeated on the final recorded document tree before commit. |
| `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap/parse-plan.ts scripts/roadmap/scan-docs.ts scripts/roadmap/schema.ts --max-warnings 0` | Exit 0; `lint.log`. These code/test/config inputs remain unchanged for the recording-only update, so lint evidence is reused. |
| `npm run roadmap` then `npm run roadmap:check` | Both exit 0; `roadmap-generation.log` and `roadmap-freshness.log`. Regenerated/rechecked after recording. |
| `python3 /Users/julianhein/Projects/hr-archive-plan-evidence-20260916-9VWO0W/check-plan.py` | Exit 0; exact seven-document scope, 14 touched local links/fragments, 9 existing instruction pairs equal, maximum instruction chain 18,376 bytes, 48 retained approval controls, 2 required ancestors, unchanged product checkboxes. `document-checks.json` binds document hashes; repeated before commit. |
| `git diff --check` | Exit 0; repeated before exact-path staging and commit. |
| Runtime acceptance | Not run or reused for this documentation candidate. The executed diagnostic is recorded above; AR1–AR5 implementation and product acceptance remain pending. |

The planner verifies the committed owner against the checked document bytes, verifies the named
ref/prerequisite ancestry and removes only the clean owned planning checkout and its dependency
symlink. The retained planning ref supplies the exact implementation base without a master merge.
The handoff reports actual cleanup and READY/WAITING ON from the final verified state.


### Execution amendment — 2026-09-17

The required `command-result-exhaustive` gate failed on two Settings modules that were byte-identical
to the approved plan base. The operator selected **Allow focused Settings fixes** during this
supervisor task. This adds only `src/dashboard/surfaces/settings-feedback.tsx`,
`src/dashboard/surfaces/settings-protected-model.ts` and their focused dashboard tests to ownership.
The feedback title exhaustively maps the already-derived display state; protected command handling
uses `settleCommandResult` after its existing strict identity check. Existing messages, refusal
handling, draft retention, presence-only readback and exact retry remain unchanged. No command
schema, Settings backend, credentials, guard exemption or other command-family behavior changes.
Run the Settings protected/catalog surface tests, direct feedback-state proof, the assigned
architecture gate, scoped lint and affected Settings parity. This is an explicit scope amendment,
not a waiver of either failed assertion.


### Focused implementation delivery — 2026-09-17

**Frozen implementation:** `96771ec69511da58e1b79f5b274795fa97c44621` on
`codex/3.1.9.7-archive`, retained at `/Users/julianhein/Projects/hr-worktree-archive`.
The documentation-only commit containing this delivery record is the branch's delivery tip; its
SHA is reported externally to avoid a self-reference. Product checkboxes remain open for
operator-controlled 3.1.9.8 integration and cleanup. No independent reviewer under Phase 3.1.

At resume, the requested branch/worktree already existed. The supervisor verified its creation
from exact approved plan `76b2e1fc7809907010b2a1d0f7e117737815902c`, the retained
`codex/plan-3.1.9.7` ref and prerequisite ancestry
`3d4d8c0c64cf2e96096b193966a66741861d6f1c`, then preserved the existing two Archive commits.
The initial local evidence lacked supporting logs and had inconsistent totals; fresh checks below
supersede it. Master stayed at `ac8c620b72ec47d9788909a4a52941a4c741f42a` and Intake at
`45748dae4436537ab86585ffa03b95dbc6843caa`; neither checkout was edited by this supervisor.

| Step | Implemented result and proof |
| --- | --- |
| AR1 | Strict accepted-request retention is atomic with canonical deletion. Authenticated BFF replay restores only the accepted timestamp after checking all caller-controlled intent. Missing metadata permits only the original exact envelope; it is never backfilled. Twelve recovery tests cover before-removal rollback, cleanup/audit interruptions, reopened databases and later-clock HTTP retry, divergent actor/target/reference/reason, absent or corrupt evidence, and a contradictory final audit. Receipt, cleanup and operator completion remain separate facts. |
| AR2 | Public-wire JSON export, generic outcome labels, retained-image inspection/download, bounded filters and deterministic 50+2 pagination. Real HTTP responses deliberately resolve out of order: current list/detail wins and history restores an exact report outside the current page. Retired descriptors, missing/corrupt/foreign attachment evidence, native downloaded bytes and explicit read failures are covered across service, mounted and browser checks. |
| AR3 | Scope, kind, membership, blockers and progress remain visible. A changed major membership forces a new review and explicit confirmation. A partial transfer resumes after a real server/database restart, refuses a competing apply identity and preserves the already-published frozen report. A minor review containing active and terminal prior runs transfers none. |
| AR4 | Confirmation and permanent-key warning remain. Canonical removal, file settlement, final audit and unavailable historical recovery have distinct readback. Recovery survives reload/restart; foreign nested status/resume targets fail identity validation. Real delayed deletion of A leaves B selected, and history returns to A's current deleted disposition. |
| AR5 | All assigned focused gates pass, both themes inspected, actual browser zoom checked, all affected reference triples attributed, logical commits retained and owned browser/server resources closed. The branch and private evidence remain for integration. |

The shared-file test retains simultaneous live, published-report and pending-capture owners while
interrupting deletion after exclusive unlink. Reopen/replay preserves every surviving owner's
verified bytes, removes only exclusive bytes and checks canonical row tallies and measured byte
deltas. Readback tests assert no settlement or authority mutation. The historical-envelope positive
control proves valid replay rather than relying on refusal caused by broken setup.

The pure `lifecycleCommandId` implementation moved to a browser-safe domain module and remains
re-exported from `identifiers.ts`; its formula is unchanged. This lets strict retained-request
validation avoid importing Node identity minting into the dashboard. A computed manifest-closure
intersection found no changed workflow/task source input, so no manifest regeneration is needed.
No DDL, migration, schema-floor, guard exemption, Intake payload or shared-harness default changed.
The only non-Archive ownership is the explicit Settings amendment above.

#### Commands and verified results

Run from the retained checkout. Exact commands for the first four rows are the unchanged assigned
commands in **Gate schedule and resources** above, in the same order. Counts are per invocation;
the Settings invocation overlaps the shared result-fold architecture test.

| Gate | Result | Retained log under `.artifacts/3.1.9.7/resume/` |
| --- | --- | --- |
| Assigned service/storage/report selectors | Exit 0; 15 files / 135 tests | `gate-1-final.log` |
| Assigned delete/version/SQLite selectors | Exit 0; 4 files / 99 tests | `gate-2.log` |
| Assigned architecture selectors | Exit 0; 6 files / 62 tests | `gate-3-final.log` |
| Assigned Archive parity assert | Exit 0; 45 tests / 4 workers | `parity-final.log` |
| `npm run test -- tests/unit/dashboard/settings-protected-surface.test.ts tests/unit/dashboard/settings-catalog-surface.test.ts tests/unit/architecture/command-result-exhaustive.test.ts` | Exit 0; 3 files / 35 tests | `settings-fix.log` |
| `npm run test:parity -- tests/parity/reference-settings.spec.ts tests/parity/settings-catalog.spec.ts tests/parity/settings-activation.spec.ts --workers=4` | Exit 0; 22 tests / 4 workers; no reference updates | `settings-parity.log` |
| Assigned expanded ESLint script against the full approved plan SHA | Exit 0; all 28 changed TypeScript files; zero warnings; full argv retained | `lint-final.log` |
| `git diff --check` and `git diff --cached --check` | Exit 0 | Rechecked at commit/freeze |

Documentation recording checks also passed: `npm run test --
tests/unit/architecture/roadmap-doc-binding.test.ts` (24 tests); scoped ESLint over that test and
`scripts/generate-roadmap.ts`, `scripts/roadmap/parse-plan.ts`, `scripts/roadmap/scan-docs.ts`,
`scripts/roadmap/schema.ts` with `--max-warnings 0`; `npm run roadmap` then `npm run roadmap:check`
(no generated diff); and `python3 .artifacts/3.1.9.7/resume/check-delivery.py` (one owned document,
no new local links, nine instruction twins equal, maximum chain 18,376 bytes, 47 retained approval
controls, two required ancestors, unchanged product checkboxes). Results are retained as
`roadmap-binding.log`, `docs-lint.log`, `roadmap-generation.log`, `roadmap-freshness.log` and
`document-checks.json`. Final recording reruns the affected document checks; unchanged test/generator
code reuses its scoped lint result.

Unit configuration resolves `Math.min(4, availableParallelism())` to four file workers. Unit and
parity wrappers use private `/tmp/hrt-<uid>/run-*` directories and report scratch removal on exit.
Parity/build writers ran serially. All Archive authority hosts used ephemeral ports and synthetic
state; the surrounding shell, unrelated APIs and SSE remained explicit fixtures. No credentials,
operator roots, legacy state or HR transaction were used.

The final parity build stamp is input digest
`7d935ea71b9cb59d0aef98f80b7d852cbabd07f32cc23fcf38d02ea7d696504a`, output digest
`d066b32ac93b9094bc8b74d7a7bbcb7a44508a9838c023ef962c5e855f5ff0ad`.
`candidate-inputs.json` binds implementation/tree SHA, all 70 changed source/reference hashes,
expanded lint argv and final runtime-log hashes. Those inputs are unchanged by this evidence-only
record, so passing runtime checks are reused without claiming a new execution.

#### Visual and reference evidence

Using `/ui` and `playwright-cli`, the supervisor inspected the built specimen and Archive in both
themes, including keyboard image opening, dialog focus, Escape restoration, reduced motion and
native downloads. Actual Chromium zoom was set to 1.25 in an owned temporary browser profile;
`chrome.tabs.getZoom` returned 1.25 while CSS zoom stayed 1. A 1280×960 viewport yielded
1024×768 CSS pixels; 1280×900 yielded the 1024×720 minimum canvas. Image and controls remained
visible. `actual-zoom.json.log` records the final dimensions, DPR 1.25, focus and reduced-motion
state; `zoom-dark-image.png`, `zoom-light-image.png`, `zoom-light-report.png` and their YAML snapshots
retain the inspection. This is additional actual-browser proof beyond the existing CSS-zoom cases.
Automated page errors are fatal; the manual specimen's only console error was an absent favicon.

`reference-triples.json` lists every exact filename, before/after SHA-256, change reason and
inspection result for 24 affected triples (72 files: 24 changed PNGs, 18 changed a11y snapshots,
30 unchanged companion files). The six `reference-sheet-*.png` contact sheets were inspected
before/after; a11y differences were checked for matching names and unchanged surrounding structure.
The changed families are only the six approved Archive families. Ledger outcomes lose verification
styling; report views gain public export and plain outcome labels; evidence gains image inspection;
version review gains explicit scope/kind/progress. References were retained from `d971e5989` and
passed the subsequent complete Archive assert lane. No new reference baseline was accepted during
this resumed repair. Private evidence remains at `.artifacts/3.1.9.7/` and is intentionally untracked.

#### Delivery assessment and deferred work

One resumed repair candidate corrected implementation/proof defects already covered by AR1–AR5:
historical exact replay, source and nested target checks, final-audit truth, interrupted shared-file
custody, real restart and delayed-response proof. Fixture diagnostics were repaired without weakening
assertions: audit corruption obeys foreign keys, partial-transfer injection occurs after a completed
member, and the Back locator is exact. Earlier implementation telemetry is incomplete, so no total
repair count or elapsed-time claim is made.

The two unchanged Settings failures were a prerequisite inconsistency with the required architecture
gate. The operator amendment added two narrow frontend files and focused tests; this was required
gate repair, not new Settings product behavior. Baseline execution of the exact architecture selector
would have exposed the ownership conflict before implementation. There were zero workers and zero
independent review rounds, as approved. No broader scope or weakened gate was used to obtain a pass.

3.1.9.8 must consume the frozen branch, reconcile Intake, run combined typecheck and its focused
integration/lint/build-output checks, then perform operator-authorized integration and cleanup.
Full coverage, whole-repository lint/architecture, broad parity, production/performance/recovery and
full A01–A42/D01–D05 acceptance remain at 3.1.19; none are claimed passed here. No merge, push,
sibling launch or automatic next-task dispatch occurred. Owned browsers and manual hosts are closed;
the clean tracked worktree, branch and private evidence are intentionally retained.
