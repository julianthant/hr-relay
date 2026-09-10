# 2.6.9 · Final integration, validation and repairs

## Approved execution brief — 2026-09-10

The operator approved the complete F01–F07 proposal with “approve” on 2026-09-10, including
separation of obsolete settings imports from supported database recovery, four focused reviews
followed by an integration review, and local master integration after accepted review and gates.
This file is the single execution owner for **2.6.9 / p2f-proof**. The [parent Task 9](../README.md#task-9--finalization)
retains its original proof and handover requirements. Historical numeric aliases are not launch IDs.

Phase 2.6 has one finalization task. Earlier scoped releases are not full acceptance; this supervisor
owns all remaining repairs, full gates, independent review, integration and cleanup. No repair
handbacks or successor dispatch. Implementation is unstarted. This approval supersedes the earlier
one-complete-reviewer and Astra/high supervisor allocation for this assignment only.

## Assignment and verified inputs

| Binding | Approved value |
| --- | --- |
| Supervisor | One operator-opened GPT-6 Astra/medium session, zero implementation workers. Cross-store recovery, combined proof and integration make this consequential work. It is cohesive finalization of integrated implementations, not a new parallel implementation wave. |
| Implementation mode | Create `codex/database-validation` at `/Users/julianhein/Projects/hr-worktree-database-contracts`; never implement in the primary checkout. |
| Product input | `22bf85d3aa055a658b343127cf88db035164ecaf`, tree `a087ee61e9083ba3455d2faf850027f8a9ad324d`. Every integration below was verified as an ancestor during planning. |
| Execution base / plan | The exact approved plan commit recorded in [PROMPTS.md](PROMPTS.md#final-session-prompt), a documentation-only descendant of the product input containing this entire brief and the approved contract amendment. Verify with `git show` before creating the implementation checkout. |
| Complete review base | `0df282e45efab2e5a4768386b5c4d5202a7cfc93`, before R. Review the entire R-through-finalization product delta, not only finalizer repairs. Consume accepted T1 and 2.6.1 evidence and inspect their affected consumers. |
| Integration | The same supervisor owns local `master` integration at `/Users/julianhein/Projects/hr-automation-rebuild` after R1–R5 PASS and required gates. Recheck target identity, ownership and dirty paths; preserve unrelated work. Material integration changes need affected review and full gates. No push. |
| Planning isolation | `codex/final-plan` at `/Users/julianhein/Projects/hr-worktree-final-plan`, created from the product input for approved documentation only. |

At planning only the primary worktree was registered; proposed task refs/paths were absent. The
primary checkout had unrelated edits to `AGENTS.md`, `CLAUDE.md` and the repository operating
reference. Do not incorporate or discard those edits. Recheck task availability and the existing
four-auxiliary-worktree ceiling at execution. Names are proposals, not reservations. Read-only
reviewers need no additional checkout. Other task status does not authorize altering its resources.

| Input | Verified integration ancestor | Requirement / release owner |
| --- | --- | --- |
| 2.6.1 trust / data / operator | `5a07b329ec8a935535ee34935fc05717bbc4f0c1` / `b2302c057836254067845c95b75ec9edaca78ef5` / `8135811243470e9ca87972401fd244a7c6092d0b` | [Parent phase](../README.md) |
| Accepted T1 | `46930920696ab214b036d5f2681b8ffb4e5620ea` | [T1 history](history/timeline-t1.md) |
| R / C0 | `a54505b19b7bd51d3ca04bf843a0ba2cedf7fa8c` / `8cf605a426553b6eeb169fffb0ec3ccc5b2f94d0` | [Renames](renames.md), [prerequisites](prerequisites.md) |
| T / repaired C | `5e446a90f018456d11ad38442c0fe3ba13e31dd1` / `e43a8d8515486c73c276fa319bbe06d196b309e3` | [Timeline](timeline.md), [completion](run-completion.md) |
| Repaired F | `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` | [Foundation](foundation.md) |
| P / D | `4818223c9da0231481da6051f73f2c33ee16abf0` / `7443100f701e95f22363cbf39da085f88d14a4ac` | [Provider accounting](provider-usage.md), [diagnostics](diagnostics.md) |
| G / final S | `4328ce56a05e91c34700a2c5df7dc9fb8e25907f` / `c7336ec9ba6557a9980c2996a04c68ff027e7284` | [Artifacts](artifacts.md), [S release](decisions.md#s06-scoped-release-and-cleanup--2026-09-09) |
| Repaired L | `6b453df208c30c7c3e863507fc2630a00dc73bab` | [Prerequisites](prerequisites.md) |
| A / Q | `7e20edc073d4a5a233ef960783e97d08578e8e9e` / `cb36757703873d7da0c571a126bf3676894dd2db` | [Archive evidence](05-archive-evidence.md), [summary evidence](06-summary-evidence.md) |
| Archived history repair / L retirement | `9892575c332299d3907a58f05439fa0a7b5584d0` / `4591b263ed26d68af91b048a5cfae07f88400b38` | [L retirement](prerequisites.md#approved-l-retirement-follow-up-after-a-conversion-proof) |
| V | `4c9500bacc99fcccf96254b100a5f009acb666f0` | [V release](prerequisites.md#v06-integrated-release-and-cleanup--2026-09-10) |
| U / H | `1e2981f2ef8897612e7ca02deccea2e30386605e` / `f8ae343298647363808c2695e463d059a713d813` | [U evidence](07-activity-ui-evidence.md), [H evidence](08-archive-ui-evidence.md) |

The committed release owners bind candidates, tested trees, commands, results and cleanup. V/U/H
`release.json` receipts exist respectively under `/Users/julianhein/Projects/hr-v-surfaces-evidence-20260910/`,
`/Users/julianhein/Projects/hr-u-activity-views-evidence-20260910/` and
`/Users/julianhein/Projects/hr-h-archive-evidence-20260910/`. Follow the other owners' exact links.
Missing/divergent required evidence blocks its acceptance row. Do not re-merge incorporated
candidates or recreate removed peer branches as prerequisites.

## Ownership and exclusions

The supervisor owns repairs required by the admitted R/C0/T/C/F/P/D/G/S/L/A/Q/V/U/H contracts,
their production callers, tests, fixtures, guards and generated outputs. Earlier source allocations
remain the lookup map; peer-exclusive restrictions do not prevent this sole finalizer from fixing
shared composition. Every changed path must map to a proof row below.

The known recovery seam includes `src/server/storage/{compose,upgrade,historical-restore}.ts`,
`src/infra/compat/{upgrade-sources,pre-floor-settings,settings-source-recovery,settings-database-upgrade}.ts`,
historical inspection/journal readers, their SQLite callers and `src/core/run-lifecycle-storage.ts`.
A separately named stopped database conversion module may be introduced at the server/storage or
SQLite owner. Do not retain old settings imports under another filename. Update CLI dispatch/help,
import guards and fixtures together. Read nearest module instructions and owning contracts first.

Documentation ownership includes this brief, parent Task 9, combined README/launch pointers,
roadmap, affected reference owners and decision pointers. Guard activation/retirement updates
`docs/rebuild/guard-inventory.json` with deciding evidence in the implementation commit; planning
does not activate a guard. Add/update meaningful tests for changed behavior.

No operator database upgrade/restore, credential change, HR submission, second D135 controlled
write, UNKNOWN retry, legacy runtime dependency, Phase 3 implementation, mobile restoration,
threshold relaxation, silent authority fallback or unrelated cleanup. Preserve released migration
bytes, immutable command/configuration journal grammars, protected identities and retained evidence.
An unforeseen new schema version, source-admission range or material behavior change needs amendment;
routine in-scope repairs stay here. No push, automatic successor or nested repair workers.

## Feasibility, recovery separation and proof

The [D332.9 amendment](../../../../reference/dashboard-surfaces.md#phase-269-recovery-separation--2026-09-10)
and [guard mapping](../../../../reference/guards-and-tests.md#phase-269-retirement-proof-amendment--2026-09-10)
resolve the discovered conflict: Task 9 formerly deleted the stopped upgrade entry, while accepted L
recovery calls `upgradeStorage -> convertSettingsDatabase -> convertHistoricalArchives`. Historical
restore and CLI restore both consume that route. Deleting it without separation breaks populated
archive recovery. Current schema/floor are 49/46; preserve the installed supported range.

Acceptance targets are synthetic isolated fixtures, never an applied operator target. The fresh/v29
recipes are in `tests/unit/storage-upgrade.test.ts`; populated schema-48 archive recipes are in
`tests/unit/archive-transfer/historical-fixtures.ts`. F02 executes old migration proof while adapters
still exist, recording source/result identities. After retirement, final tests exercise current and
supported recovery plus below-floor refusal. Retain old proof and immutable fixture facts; final gates
must not execute removed adapters from another checkout. Rebind fixtures with an assertion-by-assertion
disposition, not blanket removal. Historical backup inspection is separate from permission to restore.

| Row | Mechanism, required result and negative controls | Proof owner / selectors |
| --- | --- | --- |
| P1 — migration/expiry | Stopped upgrade combines expired settings imports and newer conversion. Preserve fresh/v29 and migrated-copy restore proof before deletion. Remove four adapters; old settings/env/sidecars cannot alter current answers. Below-floor database/backup refusal occurs before replacement, conversion or credential access. Supported recovery is the positive control. Incomplete old conversion requiring expired inputs refuses with original-release remedy; no guessed settlement or journal rewrite. | F02/F03: storage-upgrade family, storage-restore-drill, archive-transfer/retirement, storage-recovery, migration-history-immutability and new authority-upgrade-adapters-retired. |
| P2 — restore/authority | Storage composer, historical/offline restore and lifecycle storage preserve authenticated database/archive/file pairs. Wrong source, stale/corrupt backup, active runtime, source mutation and interruptions before/after replacement/quarantine/conversion retain suspects and exact replay. No cross-database rollback claim. Reconcile claims, dependencies, checkpoints, writes and timeline; authority-unknown runs never re-admit. | F02/F04: storage-restore-drill, storage-span-authority-reconciliation, archive-transfer/recovery and retirement, transaction-history-archive, storage-recovery. |
| P3 — timeline/completion/concurrency | T/C's SQLite timeline, write history and terminal publication preserve complete history, exact replay and fences. Missing/corrupt sources refuse; archive cleanup preserves settled write facts; terminal effects do not duplicate; same/different-workflow concurrency preserves ownership. Cite D135 and use synthetic write boundaries. | F04: events/timeline-history, run-completion-migration, run-terminal-authority, parallel-runs-authority-store, server/worker-pool-parallel-proof, collected scenario project. |
| P4 — settings/execution | Save/current selection, snapshots, start/claim/retry/fan-out and provider/browser resources form one chain. Save/create races choose a whole snapshot. Old queued/paused/running runs retain actual execution values. Stale reviewed starts require review; failed save cannot partly activate; exact replay/history never reconstruct from current private config. | F04: settings-activation directory and complete S selectors, command-kernel, run-executor, foundation transaction/independence proof. |
| P5 — domain effects | Provider reservations/settlement retain process-race accounting; diagnostic resolution is atomic/durable; imported/generated artifacts retain verified ownership and truthful publication failures. Invalid identity, competing writer, failed audit and restart cannot create unbound/duplicate effects. Preserve durable notification inbox behavior. | F04: provider-accounting/accounting, failure-resolution directory, generated-artifacts/publication, artifact-projection, notification-inbox and complete P/D/G owners. |
| P6 — versions/archive/deletion | Preserve reviewed membership and immutable proposal/application identities, changed-membership re-review, competing-apply refusal and exact replay. Capture complete generic reports before cleanup; verify both databases/file custody. Preserve historical conversion, numbering/lineage/shared files, missing-file availability, no transfer tombstone and explicit deletion receipts. Failed audit/reused ID, changed target/reason and replay after source deletion cannot authorize another effect. | F04: archive-transfer directory, archive-protected-identity, archive-ledger-read-through, served-database-surfaces/archive-api, archive resource/routes and A/L/V owners. |
| P7 — summaries/privacy/performance | Summary publication/indexed ports serve Queue/Activity/exports. Missing/stale/corrupt generations refuse; atomic rebuild/writer/read interleavings preserve freshness; replay/counts/parents/selected-set statistics agree. No whole-history fallback, private identity in aggregates or heartbeat summary rewrite. Measure query counts, returned rows, timings and write overhead; EXPLAIN is not measured rows visited. | F04/F05: run-summaries directory, served-database-surfaces/summary-api, summary-surfaces directory and both benchmark instruments. |
| P8 — served/UI/egress | Real BFF/static assets and Queue/Activity/Archive use served facts/generic reports. Verify JSON/CSV/XLSX equality, route/command identities, exact run/digest downloads, loading/error/unavailable states, keyboard/zoom/desktop and D183 redaction. Retired relaunch stays absent; archived viewing requires no live descriptor/source. | F04/F05: server/static-bundle, server/bff-flow, dashboard/seeded-bff, archive-report-ui directory, redaction-surface-scan, full desktop parity and production-route smoke. |

Carry the applicable interaction matrix through fixes: below-floor plus malformed/foreign input
cannot reach effects; interrupted restore plus same/different backup resumes exactly/refuses; changed
archive membership plus old confirmation requires review; failed audit plus reused identity preserves
its reservation; save/create races preserve whole snapshots; one missing retained file does not erase
independent report/attachment availability. Valid controls rule out unrelated fixture/setup refusals.
Planning inspected source, contracts and receipts, not runtime success. All rows have feasible owners.

## Ordered execution

1. **F01 — admit candidate.** Verify plan/base/tree and every input above. Inventory changed source,
   tests/contracts, proof coverage and outstanding failures. Verify both-order evidence for six
   P/D/G/S pairs, A/Q and U/H against recorded common bases. Preserve legitimate shared repairs;
   where historical nonoverlap evidence is insufficient, prove composition/order on isolated
   fixtures and record the actual combination. Do not replay merged candidates onto master.
2. **F02 — preserve recovery proof.** Run the pre-retirement batch below and repair failures before
   deleting its mechanism. Record fresh/v29 sources, migrated outputs, backup identities, canonical
   reconciliation, refusal/control cases, command exits/logs. Cite D135 without another external write.
3. **F03 — retire obsolete adapters.** Apply the approved separation and P1/P2 matrix. Remove the four
   settings adapters and old import-entry behavior; retain supported stopped database conversion and
   historical recovery under an explicit owner. Preserve strict readers and permanent schemas. Land
   red-capable module absence/legacy-input refusal tests; activate authority-upgrade-adapters-retired
   and retire authority-upgrade-adapters-isolated in the same implementation commit. Keep
   sqlite-settings-authority; update consumers, CLI and fixtures together.
4. **F04 — close combined proof.** Complete P2–P8 with real composition/populated fixtures and fix
   gaps across completed peers here. Carry historical case disposition into final proof. Use /ui
   locally: Verification lead, Components for needed behavior repairs, no redesign. Browser work
   uses playwright-cli and its required playbook. Preserve accepted desktop states/reference policy.
5. **F05 — full validation.** Run every required gate and benchmark, repair failures and retain
   before/after measurements. Commit logical categories with exact paths. Freeze HEAD/tree, review
   base, tested-input hashes, command exits/logs and complete proof map; record awaiting independent
   review with task completion still open.
6. **F06 — independent review/repair.** Obtain R1–R4 then R5. Reviewers implement/delegate nothing.
   Fix findings locally, renew affected proof, full gates and affected scope/neighbors then R5.
   No partial-scope or author verdict is complete PASS.
7. **F07 — integrate/hand over.** After review/gates PASS, perform approved local master merge after
   target checks. Prove unchanged-input reuse or rerun invalidated checks; material conflicts need
   review. Record acceptance only after actual integration/cleanup. Hand 3.1 the fresh/current/
   migrated/refused fixture matrix, stable Settings/Setup and observed/active display contracts,
   remaining P40/A8 editor scope and explicit defect disposition. Do not absorb 3.1 implementation
   or its deliberate refreeze. Preserve proof, stop only owned resources, remove owned worktree/ref
   and verify absence. No next task is dispatched.

Send **Done / Now / Remaining** at start/resume and every verified step before the next tool call.
Keep all unfinished steps/findings/review/integration/cleanup visible. Maintain one compact current
state/evidence record here; use a unique handoff only for interrupted recovery state.

## Reproducible gates and resources

Run from the verified task checkout. Installed Vitest uses isolated forks, root
`maxWorkers: Math.min(4, availableParallelism())` and three extending projects without independent
worker overrides. Use unchanged configuration and verify actual effective workers, at most four.
Coverage runs without this task's compiler/linter or benchmark contention. A smaller worker count
may address observed contention only: a temporary adapter must import the tested checkout's real
config, change only root/project maxWorkers, and deep-compare configs with only those fields removed.
Record adapter body/hash and observed workers. Preserve every other option and assertion.

### F02 pre-retirement batch

```sh
npm run test -- --project unit tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-admission.test.ts tests/unit/storage-upgrade-d331.test.ts tests/unit/storage-upgrade-environment.test.ts tests/unit/storage-upgrade-sources.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/storage-span-authority-reconciliation.test.ts tests/unit/archive-transfer/retirement.test.ts tests/unit/archive-transfer/recovery.test.ts
npm run test:architecture -- tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/authority-upgrade-adapters-isolated.test.ts tests/unit/architecture/sqlite-settings-authority.test.ts tests/unit/architecture/redaction-surface-scan.test.ts
npm run lint
```

After F03 use the new `tests/unit/architecture/authority-upgrade-adapters-retired.test.ts` in place
of the isolated guard. Preserve other required assertions through the approved historical/current/
refusal mapping. A missing selector is not PASS.

### Combined focused proof and final candidate

P/D/G/S/A/Q/V/U/H owners retain their complete exact focused selector lists. Use row-linked suites
for iteration and add regressions at repaired boundaries. Explicit original/final lanes are:

```sh
npm run test -- --project scenario
npm run test -- --project unit tests/unit/parallel-runs-authority-store.test.ts tests/unit/server/worker-pool-parallel-proof.test.ts tests/unit/run-completion-migration.test.ts tests/unit/run-terminal-authority.test.ts tests/unit/transaction-history-archive.test.ts
npm run test -- --project unit tests/unit/server/static-bundle.test.ts tests/unit/server/bff-flow.test.ts tests/unit/dashboard/seeded-bff.test.ts tests/unit/served-database-surfaces/summary-api.test.ts tests/unit/served-database-surfaces/archive-api.test.ts
npm run typecheck
npm run lint
npm run test:coverage
npm run test:architecture
npm run test:parity
npm run web:build
npm run perf:dashboard
node --import tsx tests/perf/run-summaries.ts
npm run build:manifest:check
npm run stores:catalog:check
npm run roadmap:check
git diff --check
```

Coverage includes suite-size enforcement. Explicit whole architecture/parity/build remain required.
Generate affected outputs before freshness checks; never hand-edit them. Production smoke uses real
served/static tests and isolated parity/BFF fixtures, not the operator database. Collected offline
scenarios are not live T1b/T3/T4 evidence. If an existing acceptance row requires live proof, carry its
exact admitted manifest/subject and rebuild-only preflight through the operating/hr-manage rules;
retain dry-run/no-submit limits, actual zero-write deltas and blocked status for unavailable proof.
No new live run or second D135 write is introduced to replace deterministic recovery proof.

T's [integration record](timeline.md#subsequent-operator-integration-request--2026-09-09) retained
benchmark failures: day statements 5,574 against 5,569 and archive freeze 3,234 against 13. These are
historical failures, not current measurements or waivers. Capture the present baseline before
performance fixes with unchanged instrument/seed; compare final results under the same conditions.
Preserve bounds and population. The summary instrument measures selected-set queries, returned rows,
rebuild cost and heartbeat/update writes; retain counter controls and distinguish plans from visits.

| Boundary | Cadence / reuse |
| --- | --- |
| Iteration | Focused behavior/neighbors plus lint; group related fixes. Preserve failures; classify fixture versus production defects against contracts before changing expectations. |
| Implementation commit / candidate | D191 typecheck, lint and full coverage. The final combined candidate also requires every listed proof, broad gate and benchmark. No full cycle for every green micro-edit. |
| Review correction | Focused repair then required full gates on corrected inputs; renew affected scope/neighbors and R5. No review of moving inputs. |
| Integration | Recheck actual target. Relevant source/test/config/dependency/reference changes invalidate results; material integration needs full gates and affected review. Recording-only changes may reuse verified identical inputs. |
| Documentation recording | Applicable document/binding/link/twin/generated and diff checks. Record old/new commit/tree and unchanged gate inputs; unrun runtime checks are not PASS. |

Reference refreshes are deliberate reviewed changes only. Inspect fingerprint-driven metadata/a11y/
image changes and renew dependent gates. Preserve desktop minimum size, zoom/keyboard, reference
membership and zero pixel-difference allowance. Isolate databases/files/ports; verify process ownership.

## Independent review allocation

Five assignments: four behavioral scopes and one fresh integration reviewer, all read-only
`sup_review` on GPT-6 Astra/high. Maximum three concurrently; R5 waits for all four reports. The
supervisor is sole writer. Read the required parallel-agent-work reference before dispatch. Reviewers
never implement or delegate. Recheck native role/capacity before dispatch, preserving this allocation.

Fit assessment: the R-through-H delta includes 137 production paths, coupled authority/execution/
archive/served contracts, substantial failure/history proof and many generated references. T's earlier
integration review stopped at its context boundary on a smaller set. Four scopes avoid repeating that
allocation. R5 independently verifies wiring and reconciliation without repeating every scope's
internals. Recheck fit before dispatch; resizing requires amendment, never a truncated PASS.

| ID | Complete source/behavior responsibility | Proof / intentional overlap |
| --- | --- | --- |
| R1 | R/T/C; migration/registry/immutable schemas, adapter retirement, SQLite backup/restore/doctor, timeline/operation/terminal evidence and storage/core write callers. | P1–P3; overlap R2 on archive recovery, R3 on historical settings/provider/artifact conversion. |
| R2 | L/A; version change and archive/lifecycle protocols, report storage, transfer/deletion, numbering/lineage/shared custody; command-kernel/run-record callers through effects and replay. | P2/P6; overlap R1 on conversion, R3 on protected identities, R4 on download/served authorization and summary cleanup. |
| R3 | F/P/D/G/S; settings activation/retained resources, providers, diagnostics, imported/generated artifacts and notification continuity. Inspect sync/async/internal writers and runtime composition. | P4/P5; overlap R1 on migration/terminal source facts, R2 on captured/deleted evidence, R4 on egress/privacy. |
| R4 | Q/V/U/H; summary derivation/mutations/rebuild/query, BFF/client/Queue/Activity/Archive/exports/downloads, UI/a11y/reference changes and both benchmarks. | P7/P8; overlap R2 on retained custody, R3 on source facts. Cover served identity absence and failure states, not just images. |
| R5 | Entire plan/diff/proof inventory and four verdicts; independent cross-boundary wiring, identity/privacy, transaction/order/recovery, production composition and end-to-end acceptance inspection. | P1–P8 and F01–F07. Every changed boundary and finalizer repair needs coverage; reconcile findings using primary evidence. No summary-only PASS or uncovered author-reviewed tail. |

Every reviewer receives identical plan/base/implementation/evidence identities, whole changed-path
inventory with assigned mapping, gate outputs/exits, proof rows, historical evidence and known risks.
Identify unrelated prose separately without excluding runtime scope. Acceptance requires all R1–R5
PASS, no unresolved required finding and all gates. After fixes renew affected scopes/neighbors then
R5; carry unaffected verdicts only with inspected unchanged-input proof naming both heads. No author
signoff, majority voting, tail-only review or self-created PASS.

## Planning persistence and current status

Approval is recorded above. F01–F07 implementation, runtime gates, reviews, integration and cleanup
remain unstarted. Planning validates documents/generated roadmap only, not new recovery behavior.
The substantive plan SHA, execution base and verified READY/WAITING disposition are recorded after
commitment in [the launch registry](PROMPTS.md#final-session-prompt). Verification requires plan
reachability, integrated prerequisites, scoped gates and available task path/ref. The operator opens
the fresh supervisor session; planning does not dispatch it.


### Planning verification — 2026-09-10

The approved documentation candidate changes nine paths: this brief, three phase/launch pointers,
three reference owners, roadmap source and its generated HTML. No source, test, runtime configuration,
dependency, parity reference or guard inventory changes. Product and full runtime acceptance are not
claimed. Full code gates are outside this documentation-only persistence; lint was executed, not
inferred. Its source/test/configuration inputs are unchanged from product input `22bf85d3a`.

| Planning check | Result |
| --- | --- |
| Roadmap document binding | 24 tests PASS, exit 0; repeated after final recording edits. |
| Lint | PASS, exit 0. |
| Roadmap generation / freshness | PASS, exit 0; generated through the owning script. |
| Changed local links / exact existing selectors | PASS; 36 changed links resolved at initial verification, with final additions checked before handoff. The future retirement guard is explicitly planned. |
| Existing instruction twins / chain cap / whitespace | PASS; no instruction files changed. |
| Prerequisites | All tabled integration SHAs are ancestors of the exact product input. V/U/H release receipts parse and remain available. |

Command logs, individual exits, changed-input classification and exact commit/tree verification are
retained under `/Users/julianhein/Projects/hr-final-plan-evidence-20260910/`. The launch registry binds
the substantive plan commit after commitment; it does not mark F01–F07 implemented.
