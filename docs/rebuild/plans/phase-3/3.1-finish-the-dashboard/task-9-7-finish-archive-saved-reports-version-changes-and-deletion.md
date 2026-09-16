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
