# 2.6.9 · Final integration, validation and repairs

## Approved execution brief — 2026-09-10

The operator approved the complete F01–F07 proposal with “approve” on 2026-09-10, including
separation of obsolete settings imports from supported database recovery, four focused reviews
followed by an integration review, and local master integration after accepted review and gates.
This file is the single execution owner for **2.6.9 / p2f-proof**. The [parent Task 9](../README.md#task-9--finalization)
retains its original proof and handover requirements. Historical numeric aliases are not launch IDs.

Phase 2.6 has one finalization task. Earlier scoped releases are not full acceptance; this supervisor
owns all remaining repairs, full gates, independent review, integration and cleanup. No repair
handbacks or successor dispatch. Implementation is in progress; see the [repaired candidate gate record](#repaired-candidate-gate-record--2026-09-11) and approved amendments below. This approval supersedes the earlier
one-complete-reviewer and Astra/high supervisor allocation for this assignment only.

## Assignment and verified inputs

| Binding | Approved value |
| --- | --- |
| Supervisor | One operator-opened GPT-6 Astra session, initially medium; operator changed continued supervision to xhigh on 2026-09-11. Zero implementation workers. Cross-store recovery, combined proof and integration make this consequential work. It is cohesive finalization of integrated implementations, not a new parallel implementation wave. |
| Implementation mode | Create `codex/database-validation` at `/Users/julianhein/Projects/hr-worktree-database-contracts`; never implement in the primary checkout. |
| Product input | `22bf85d3aa055a658b343127cf88db035164ecaf`, tree `a087ee61e9083ba3455d2faf850027f8a9ad324d`. Every integration below was verified as an ancestor during planning. |
| Execution base / plan | The exact approved plan commit recorded in [PROMPTS.md](PROMPTS.md#final-session-prompt), a documentation-only descendant of the product input containing this entire brief and the approved contract amendment. Verify with `git show` before creating the implementation checkout. |
| Complete review base | `0df282e45efab2e5a4768386b5c4d5202a7cfc93`, before R. Review the entire R-through-finalization product delta, not only finalizer repairs. Consume accepted T1 and 2.6.1 evidence and inspect their affected consumers. |
| Integration | The same supervisor owns local `master` integration at `/Users/julianhein/Projects/hr-automation-rebuild` after R1a–R4b and R5 PASS and required gates. Recheck target identity, ownership and dirty paths; preserve unrelated work. Material integration changes need affected review and full gates. No push. |
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
archive recovery. At initial admission schema/floor were 49/46. The approved retirement amendment below advances schema to 50 and preserves floor 46.

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
| P6 — versions/archive/deletion | Preserve reviewed membership and immutable proposal/application identities, changed-membership re-review, competing-apply refusal and exact replay. Capture complete generic reports before cleanup; verify both databases/file custody. Preserve historical conversion, numbering/shared files and non-relaunch lineage; discard obsolete archive relaunch relationships under the amendment below, missing-file availability, no transfer tombstone and explicit deletion receipts. Failed audit/reused ID, changed target/reason and replay after source deletion cannot authorize another effect. | F04: archive-transfer directory, archive-protected-identity, archive-ledger-read-through, served-database-surfaces/archive-api, archive resource/routes and A/L/V owners. |
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
6. **F06 — independent review/repair.** Obtain the approved R1a–R4b scopes then R5. Reviewers implement/delegate nothing.
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

Approval is recorded above. The planning checks below predate implementation; current execution is recorded separately. Planning validates documents/generated roadmap only, not new recovery behavior.
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

## Current execution state — 2026-09-10

Supervisor: one Astra session, zero implementation workers. Checkout `/Users/julianhein/Projects/hr-worktree-database-contracts`, branch `codex/database-validation`, exact base `7f77978716319c4329392a19e7a971f18af37362`. All cited prerequisite commits, including U/H and L retirement, are ancestors. Primary master last verified is `80d38635cd3455c2e8c7c4525e0470e4f60ce1d8`; its unrelated instruction/reference edits remain untouched. Integration requires all F01–F07 gates and R1–R5 PASS.

Evidence root: `/Users/julianhein/Projects/hr-final-validation-evidence-20260910/`. Each gate JSON records literal command, input HEAD and exit; logs retain failures. `F02-preserved-identities.json` binds fresh/v29 source, migrated copies and verified backups retained in private synthetic fixture directories. Initial preservation script failed on a missing explicit column list; its failed fixtures/log remain separate from the successful verified fixtures.

| Step | Current evidence / unfinished work |
| --- | --- |
| F01 | Prerequisites and V/U/H receipts verified. Current composition batch PASS, including all twelve P/D/G/S orders and A/Q controls. U/H recorded candidates merge in both orders to identical tree `b999cd0aa7b777a55fab18bfb065699b140be8b6` from common base `ea83e77`; current combined U/H unit proof: 8 files / 102 PASS (`F01-UH-order.json`, `F01-UH-current`). |
| F02 | Original unit batch: 10 files / 252 tests PASS; original lint PASS. Architecture: original 9 failures / 135 tests; repaired batch 135 PASS. Fresh/v29 copies and backup identities preserved. |
| F03 | Four obsolete settings adapters deleted; supported stopped conversion and below-floor refusal proved. Schema 50 relaunch retirement implemented under the amendment; complete physical fresh/46–49 inventory PASS. Uncommitted; final review/gates remain open. |
| F04 | Original recovery proof retained; consumer and lifecycle walk repairs pass. Complete table inventory plus populated 48/49 interruption and explicit paired recovery pass. Single-half transfer-custody restore now refuses before mutation. See proof disposition and gate receipts below. |
| F05 | PASS: typecheck/lint; 6,233 full-coverage tests and floors; suite-size491; architecture848; desktop parity274; scenarios135; served/concurrency235; production build; both unchanged benchmarks; manifest/catalog/roadmap freshness; diff/twins. Candidate awaiting independent review; identities in frozen external review packet. |
| F06–F07 | Candidate awaiting independent review. R1–R5, local integration, handover acceptance and cleanup remain. |

F02 expectation disposition: the installed schema/floor is 49/46 under the approved contract, so the obsolete schema-47 guard pin becomes 49 while retaining migration grammar and singleton assertions. The archived capture canaries target the retained historical reader and now seed the exact released schema-48 fixture through the existing stopped fixture capability; all nine planted canaries, verifier calls and refusal assertions remain. New generic served archive schemas receive explicit leaf origins in the D183 declaration inventory; their current producer proof remains F04. No production behavior or migration bytes changed in this repair.

Current repair disposition: provider capture uses allocated scope/meter joins for generic usage and capability joins for legacy usage; unrelated global usage is excluded. The cumulative accounting store remains retained. Current archive tests use the report/transfer/delete protocol instead of the retired historical writer. Mixed schema-40 source reconstruction marks the already-consumed historical plan applied, consistent with its existing application; exact source journal assertions remain. Completion fixtures now bind retained reports; `F02-completion-final` passes historical migration and terminal neighbors, including exact/divergent archived replay. Direct terminal writers verify retained snapshots and original completion/consequence identities before returning replay; failure replay no longer requires a current descriptor. Compiler repairs validate newly constructed branded values and preserve union return states; the migration edit is type-only and changes no released SQL. Recovery tree hashing now hashes binary bytes directly.

Evidence scripts save all temporarily replaced source bytes in `source-recovery-*/` and mark successful restoration. Later gate receipts also bind per-file input SHA-256; earlier HEAD-only results require explicit verified reuse or rerun. Final gates cannot use the temporary-original-proof script. Remaining known work includes historical case-by-case expiry disposition, obsolete adapter guard/inventory/CLI retirement, below-floor backup and interruption matrix, remaining fixture/test repairs, full served/UI/parity/coverage gates, candidate/reviews, integration and cleanup. No operator state or credentials were applied.

Latest iteration: `F04-capture-wired` passes selected-root canonical archive capture, timeline-collision, current archive custody/deletion and summary derivation neighbors. `F04-current-repaired` passes settings activation/save/create/retained execution, actual four-way independence, diagnostic commands and paired recovery. The reader adds `withRunTreeSnapshot`: selected roots and direct children are authenticated within one read transaction, reused only during that synchronous capture. The capture regression requires zero whole-history enumerations and one selected-tree snapshot, preserving both member order cases. Archive report tables now use the design-system `label` prop. Generation fixtures replace retired pseudonym/archive table mutations with current summaries/version changes/transfer writes and retain named retired-writer refusal checks. Its current subset still has an expired schema-39 conversion case pending disposition. Environment import tests preserve the complete former key inventory while proving ignored bytes, unchanged credentials and no file/value adoption; `F03-env-readonly` passed all 62 combined controls. CLI help/dispatch removes `--generated-from`.


### Historical assertion disposition

Original executable proofs remain bound to F02 logs/input receipts; final gates use only the finished
checkout. The following controls have been carried forward, not waived. Provider, mixed-domain and transaction-history mappings are recorded below; final gate acceptance remains separate.

| Original assertions | Finished-release disposition / evidence |
| --- | --- |
| Environment key inventory, malformed/unknown inputs, credential privacy, repeat | `storage-upgrade-environment`: every former key remains enumerated; ignored bytes cannot create settings/credentials or change on repeat. `F03-env-readonly` PASS. |
| v29 duplicate/disjoint patches; virgin, prepared, committed, partial, missing/divergent bytes; journal corruption, permissions and alias | `storage-upgrade-sources`: retained distinct source constructions now require named floor refusal and exact tree preservation. Frozen v29 grammar/fingerprints remain test facts. `F03-source-expiry` PASS. |
| Tombstone root/reconstructed/missing ordinals, numbering, original tally, immutable updates, doctor, duplicate/mismatch and hook order | Captured original migrated records in `fixtures/migrated-tombstones.json`; current reader/ordinal/trigger/doctor assertions plus old-source refusal. `F02-tombstone-retained` and `F03-tombstone-current` PASS (6 final controls). |
| Historical admitted versions and gaps, exact journals, backup freshness, immutable migration shape, active lock, precommit rollback/retry | `storage-upgrade-admission`: historical backup inspection and exact journal bytes retained; old conversion refused. Full positive/error matrix now uses supported 46–48. `F03-admission-current` PASS. |
| D331 ordinary/protected prior/committed, rollback and changed/missing bytes; D341 retired names and journal confidentiality | Frozen historical journal parsing remains exact; each expired source refuses before source/credential adoption and preserves bytes. `F03-d331-current` PASS. |
| Offline old-backup replacement and no credential/projection writes | Schemas 29–37 refuse before both offline replacement and historical marker/quarantine; supported 46–48 exercise actual replacement and subsequent conversion. All current corruption/claims/locks/concurrency/drill controls remain. `F03-restore-current-repaired` PASS (34). |
| M2 stale claims, M13 retained private snapshot exposure, M25 next-boot activation | Supported schema-46 copies preserve exact rows. M25 uses original captured migrated settings/commands/audits and boots the real dashboard; snapshot values are not logged. `F02-retained-settings-timeline` and `F03-upgrade-current-subset` PASS. |
| Worker/auth/request rename, populated grouping, complete row preservation, generation and rollback/replay | Historical 33–37 backup fingerprints/rows and corruption checks remain; conversion refuses. Supported 46–48 retain all populated row comparisons and both interruption seams. `F03-upgrade-current-subset` PASS. |
| Private import post-SQL/pre-SQL/missing/divergent/rename/audit settlement | Original F02 proof retains old settlement behavior. Finished release refuses an immutable pending expired receipt without modifying independent binding, environment or database, including changed/absent old bytes. `F03-private-pending` PASS; source-floor controls cover pre-SQL admission. |
| Orphan checkpoint cleanup and applied empty v29 revision | Historical populated source and backup/journal facts remain; conversion now refuses byte-exactly. Tombstone current trigger controls are retained above; exhaustive current never-delete controls remain in authority tests. Current upgrade suite renewal remains open. |
| T1 duplicate multi-day IDs, retention dates, imported source identity, replay, missing/contradictory/deleted sources | Captured original events in `fixtures/migrated-timeline.json`; supported 46–48 conversion retains all four exact records, dates and IDs through interruption/replay, rejects divergent replay, ignores corrupt old spans. Distinct old-source cases now refuse below floor with exact bytes. All 14 final T1 controls passed in `F03-upgrade-current`; full suite renewal remains open after pending-receipt fixture repair. |
| Completion success/failure 39/40, consequence/version/claim/outbox replay, archive fingerprint, journals, restore | Original F02 proof retained. `fixtures/migrated-completion-{success,failure}.json` captures inspected schema-46 rows from the immutable completion fixture. Final tests first refuse each original source, then exercise supported conversion/restore, exact/divergent service and direct replay, retained archive/journal identities and no-write repeat. `F03-completion-current` PASS: 2 files / 36 tests. |
| Provider populated lifecycle/budgets/midnight/backup replay | `provider-accounting/accounting` first verifies schema-42 backup/refusal and exact unchanged source, then loads inspected `migrated-provider.json` at 46. Original five admission records and blocked counter remain compared byte-derived field-for-field; interruption, replay, late settlement and supported restore controls remain. |
| Mixed-domain available/unavailable generated sources and retirements | `database-foundation/mixed-history` uses inspected `migrated-mixed-{available,unavailable}.json` plus retained generated manifest. Original source refusal and current exact history, retired-table absence, custody/availability and old-source mutation controls remain. |
| Historical ledger files, missing files, archive and confirmation | `transaction-history-fixture` preserves the original schema-39 source separately and loads the named inspected schema-46 fixture for supported conversion. `transaction-history` and `transaction-history-archive` retain exact facts/files, source absence/divergence and archive replay controls. |
| Historical settled lifecycle journal and write replay | `historical-settlement-replay` first refuses old source byte-exactly, then loads `migrated-settlement.json`; all three original journal entries remain exact through supported conversion, identical replay and changed operator/version refusal without new IDs or enqueue. |

The four-adapter deletion and replacement guard activation are implemented; no reviewer has been dispatched.
Latest full lint before these final fixture additions: `F03-lint-current` PASS; renewal and full final
coverage remain required. Temporary capture tests were removed after their successful receipts and
permanent fixture files were recorded. No final runtime gate executes an original adapter from another
checkout.

## Approved obsolete-table retirement amendment — 2026-09-10

The operator explicitly approved removal of `archive_relaunches` and its obsolete history, with no
replacement relationship store. Preserve descendant runs and source archive reports. This supersedes
prior descendant-relaunch retention requirements and authorizes the next forward migration, **50**,
after verifying candidate schema 49. Released migration bytes 1–49 remain immutable; floor stays 46.
No operator database application or tracker-file deletion is authorized.

Consumption reverified primary master `80d38635cd3455c2e8c7c4525e0470e4f60ce1d8`, task branch
`codex/database-validation` at `7f77978716319c4329392a19e7a971f18af37362`, both registered
worktrees, and existing owned dirty work. Primary unrelated instruction/operating-reference edits
remain untouched. F04-paired-floor passed. F05-coverage finished **FAIL: 46 files, 193 tests failed;
444 files, 6028 tests passed**, with retained evidence; no full acceptance is claimed.

## Tables that must be absent from the current physical schema

| Old tables | Required disposition |
| --- | --- |
| `archive_relaunches` | **New amendment:** remove the table, current storage methods, old relaunch-history queries and expectations in capture/deletion/recovery. No replacement relationship store. |
| `activity_person_pseudonyms`, `activity_person_pseudonym_generations` | Already retired by v48; retain approved summary distinct-person/privacy behavior. |
| `artifact_outbox`, `artifact_sink_heads`, `operator_xlsx_exports` | Already replaced by `generated_artifacts` in v46. Preserve publication state, file conflict checks and XLSX metadata. |
| `durable_outbox`, `operation_outbox` | Former name became operation_outbox in v36, then retired in v40. Preserve timeline/confirmed-operation evidence. |
| `ledger_partitions`, `ledger_projections` | Already retired in v40; preserve SQLite timeline/history and explicit exports. |
| `run_terminal_authorizations`, `run_terminal_outbox` | Already retired in v41; completion ownership and consequences remain on runs/results/failures. |
| `bulk_command_acceptances` | Already combined into parent rows in `commands` in v37. |
| `intake_sessions`, `intake_manifests` | Already combined into `imported_artifacts` in v42. |
| `provider_admissions`, `provider_budget_counters` | Already replaced by `provider_requests`, `provider_usage` in v43. |
| `runtime_config`, `settings_current` | Already combined into `app_settings` in v44; immutable `settings_snapshots` remain. |
| `spans`, `gates`, `notes`, `ocr_approvals`, `knowledge_records`, `fix_records` | Already retired in v47. Do not confuse SQL table removal with permission to delete span/log files, checkpoint gates, diagnostic files or other retained evidence. |
| `archived_runs` | Already retired in v49 after verified report conversion to the separate archive database. |
| `version_plans`, `version_bump_applications` | Already retired in v49 after conversion to `version_changes`. |
| `runs_view` | Already retired in v34; current dashboard uses `run_summaries`. |
| `capture_sessions`, `capture_photo_order`, `capture_finalization_outboxes`, `protected_settings_current` | Older retirements from the migration inventory, outside the screenshot. Verify they remain absent; do not resurrect them during recovery. |

## Old names that disappear through renaming, not data deletion

| Old name | Current name to preserve |
| --- | --- |
| `authority_meta` | `database_state` |
| `authority_upgrades` | `database_upgrades` |
| `leases` | `workflow_workers` |
| `duo_ceremony_leases` | `worker_auth` |
| `start_plans` | `workflow_run_requests` |
| `delegation_manifests` | `run_delegations` |
| `dependencies` | `delegation_dependencies` |
| `write_intents` | `run_operations` |
| `write_attempts` | `run_operation_attempts` |
| `config_snapshots` | `settings_snapshots` |
| `diagnostic_bundles` | `diagnostic_snapshots` |
| `diagnostic_attachments` | `diagnostic_files` |
| `evidence_receipts` | `run_receipts` |
| `failures` | `run_failures` |
| `dry_run_scenario_results` | `dryrun_results` |
| `ocr_extractions` | `extracted_artifacts` |
| `tasks` (older historical name) | `workflow_runs` |
| `run_sessions` (older historical name) | `workflow_run_batches` |

Keep `workflow_runs`, `workflow_run_batches`, `worker_pools`, `run_checkpoints`, `checkpoint_payloads`, `run_results`, `commands`, `command_audits`, `notifications` and `deleted_runs`. Also preserve the approved newer tables, including `archive_transfers`, `archive_records`, `archive_deletions`, `version_changes`, `run_summaries`, `summary_publication` and `timeline_operation_sources`. The last one is retained historical evidence, not another outbox. This is not authorization to remove all compatibility or bookkeeping tables.


### Execution, proof and review amendment

F03 adds migration 50, current registry/storage-method/query/lifecycle retirement. Historical names
remain only where immutable SQL, strict backup/journal recognition, historical evidence or negative
tests require them. Do not use zero text matches as the retirement proof. F04/P1/P2/P6 add populated
source archive plus descendant run preservation, relationship-only removal, supported 46–49 conversion
and restore, interruption/replay, capture/view/download and explicit deletion. P3/P7 retain archived
confirmed transactions in Activity until explicit deletion; P4/P5 retain settings snapshots, provider
and artifact state. Shared custody, privacy and paired database/archive recovery remain mandatory.

Freeze explicit current table inventories in `tests/unit/database-table-retirement.test.ts`: fresh
and each supported conversion must match SQLite catalog and current registry/catalog declarations;
assert all removed/renamed names above absent and all required current tables present. Check the
archive database separately. Audit every listed retirement and live consumer without duplicate
migrations. Record populated proof and complete consumer dispositions before claiming this row PASS.
Focused command: `npm run test -- --project unit tests/unit/database-table-retirement.test.ts
tests/unit/archive-transfer/retirement.test.ts tests/unit/storage-supported-conversion.test.ts`;
run `npm run lint` during iteration. Existing F05 commands/selectors remain mandatory, including
typecheck, lint, full coverage, architecture, scenarios, recovery, desktop parity, web build, both
benchmarks and manifest/catalog/roadmap freshness. No assertion, bound, floor or resource relaxation.

R1 covers migration 50, complete physical inventory and supported recovery; R2 covers relationship
discard versus source/descendant preservation, capture/deletion/custody and replay; R3 checks retained
settings/provider/artifact facts; R4 checks Activity totals and served/archive/download behavior.
Fresh R5 covers this amendment and all combined repairs on the committed candidate. Keep four
focused reviews, maximum three concurrent, then integration review; zero implementation workers.
All F06/F07 review, local merge, handover and owned cleanup conditions remain open and unchanged.

The handoff's surviving requirements are recorded here and in the current reference/prerequisite
amendments. Its exact untracked source may be removed after verifying these records; no other
handoff or task resource is included.

### Retirement amendment implementation checkpoint

Migration 50 drops only `archive_relaunches`; released 1–49 digests remain pinned. Current registry,
record mapping, repositories, lifecycle collection/deletion and archive history projection no longer
read or write it. Historical strict backup recognition retains its schema explicitly; deletion receipt
grammars and released SQL retain old names. Existing immutable reports are not rewritten. No replacement
relationship store exists. Source archive conversion omits new relaunch-history provenance while
preserving descendants, reports, numbering and transaction/file evidence. Supported recovery admission
now recognizes prior schema 49; floor remains 46 and ordinary boot requires stopped conversion to 50.

`tests/unit/database-table-retirement.test.ts` pins all 37 current main-database tables and both
archive tables independently of the registry, and checks every removed/renamed name in this amendment.
Fresh and supported 46/47/48/49 conversions all match the physical catalog and current registry.
The store catalog generator describes task-store capabilities, not SQL tables; its required freshness
check remains F05. Complete production-consumer classification and final acceptance remain open.

| Evidence in `/Users/julianhein/Projects/hr-final-validation-evidence-20260910/` | Verified outcome |
| --- | --- |
| `F04-retirement-50-final` | 4 unit files / 73 tests PASS: exact inventories, supported recovery, populated conversion, six archive interruption boundaries, three restored-backup boundaries, files/download bytes, explicit deletion and descendant survival. Architecture selector in this unit command was excluded and is not counted. |
| `F04-retirement-migration-history` | 2 architecture files / 9 tests PASS: immutable migrations 1–50 and historical archive invariants. |
| `F04-retirement-consumers` | 171 PASS / 1 failure: new run-tree snapshot missing from method-generation coverage map. Corrected with an actual read and zero-generation assertion. |
| `F04-terminal-harness` | 3 files / 124 PASS: run service and two dashboard suites. Shared terminal fixtures now carry schema-valid completion evidence; assertions and production validation remain intact. |
| `amendment-typecheck-2.log` | Typecheck PASS before subsequent bookkeeping repairs; renew on final inputs. |
| `F04-retirement-lint` | FAIL solely on an unused archive generation import after repository retirement; removed, renewed lint pending. |

The exact consumed primary handoff was removed only after all its surviving scope/acceptance facts
were recorded in this owner plus prerequisite/reference/decision amendments. Primary operator state
and unrelated edits were not modified. One supervisor, zero implementation workers; reviews have
not started. Full-coverage failure baseline remains open until repaired and renewed.

### Combined dependency and fixture repairs checkpoint

`F04-deletion-composition-repaired`: 6 files / 61 PASS, including exact retained transactions across
transfer, interruption/replay and explicit deletion, provider custody and public archive/download
identity. `F04-terminal-harness`: 124 PASS. `F04-command-groups-current`: 26 PASS; old 34–36
sources now prove floor refusal before effects, while explicitly seeded schema-46 parent/member
facts preserve original child/audit/delegation bytes, replay, credential collision controls and
rollback/settlement. Historical conversion release evidence remains history, not current admission.

The original full-coverage failure baseline also exposed cyclic/layer-inverted assembly. Canonical
archive deletion now lives in `RunRecordService.lifecycleStorage()`; SQLite storage no longer creates
a core service. Pure lifecycle-source grammar/digests live in `domain/archive/lifecycle-source.ts`;
pure summary derivation lives in `domain/run/summary-derivation.ts`. SQLite lifecycle/recovery
assembly lives in `infra/sqlite/lifecycle-storage.ts`; core facades preserve existing imports. Archive
command orchestration moves from `services/archive/version-changes.ts` to `core/archive-version-changes.ts`
with a narrow dependency contract. Shared command refusal lives in `core/command-refusal.ts`.
No cycle/layer exception was added. `F04-ratchet-final`: all 6 guard-manifest tests PASS, including
every ratchet and planted negative. R1/R2 cover storage/deletion movements, R3 refusal identity,
R4 summary/query equivalence; renew neighbor gates and R5 on final committed inputs.

Existing immutable archive source snapshots retain the historical `archive_relaunches` group grammar
for reading old reports; current capture emits 24 groups and never emits that group. Physical
retirement does not rewrite already-signed reports or historical journal/receipt bytes.

`F04-architecture-bookkeeping-repaired`: 93 PASS / 1 guard-manifest failure subsequently resolved
by the above changes. Runtime isolation now checks the already-approved archiveDatabaseFile binding;
parity H uses the common independently stamped parity bundle instead of an unregistered environment
key. The historical SQLite fixture helper moved into unit-only ownership. Settings validation
retains its refusal while deriving errors explicitly; empty archive queries validate optional workflow
directly without inventing a workflow value. Full architecture and final lint/typecheck are being
renewed; no full acceptance or review has been claimed.

### Current recovery and consumer renewal

`F04-architecture-recovery-renewed` passes all 114 tests in the four failing architecture suites.
Read-only historical table inspection validates the complete schema-specific physical inventory before
using retained archive evidence; current runtime registry parsing stays strict. Both dynamically
loaded stopped-command recovery entry points are checked by the retirement reachability guard.
Schema-49 refusal controls now take the required backup before supported conversion.

The retained operation fixture was materialized at schema 46 after strict backup inspection
(`F04-operation-capture-2`). `tests/unit/fixtures/migrated-operations.json` preserves four intents,
five attempts, exact historical outbox evidence and old deletion receipts. Its loader restores all
trigger definitions and verifies foreign keys plus strict backup inspection. Original 33–36 sources
refuse with unchanged bytes; current conversion preserves the original records, pending counts,
interruption/replay and shared-owner deletion assertions. Temporary capture code was removed.
`F04-combined-unit-renewal`: 663 PASS / 67 FAIL across 37 files (23 failing), including all 20
operation-name tests PASS. Remaining failures are tracked as open combined defects; no gate waiver.

Two real served-dashboard cases exposed an absent publication on a brand-new empty authority.
Fresh creation now publishes its exact empty summary baseline within the schema transaction;
existing missing or stale publications continue to refuse. Neighbor and complete gates remain open.

`F04-fresh-dashboard-renewed`: 6 files / 55 PASS, including the actual loopback dashboard,
empty initial day, lease-only SSE tick and summary neighbors. `F04-settings-consumer-final`: all
21 dry-run composition tests PASS. Immediate settings save activation is observed separately from
refused start effects; prior admitted runs/snapshots and zero post-refusal effects remain exact.
`F04-contract-consumers`: 75 PASS / 2 fixture failures, subsequently fixed and passed in
`F04-settings-consumer-renewal` (source-bound-repeat and rerun-values; settings subsequently renewed).
`F04-current-lint`: PASS on recorded prior inputs; typecheck's historical table narrowing repaired,
renewal remains required. No accepted full gate or review yet.

Additional synthetic schema-46 images retain confirmed history, missing-file assignment, all seven
database renames and actual released settlement journals. `F04-history-capture` (3 captures) and
`F04-settlement-capture` (1 capture) each passed strict backup inspection. Saved fixtures are
`migrated-history-{confirmation,missing-file}.json`, `migrated-database-renames.json` and
`migrated-settlement.json`. Temporary materializer and capture tests were removed. Recovery suites
retain original below-floor refusal and use inspected images for supported conversion/replay.

Production `archive_relaunches` text inventory is restricted to immutable migrations/closed
historical physical inventories, strict historical backup record/fingerprint recognition, historical
delete receipt grammar, and immutable report source grammar. No `archiveRelaunches` production
repository or query remains. Current capture omits the source group; no replacement relationship
store was introduced. Complete inventory and downstream acceptance remain subject to final gates.

### F04 consumer renewal — 2026-09-10 continued

The retired pseudonym writer tests now prove named refusal before secret reads or derivation,
including authenticated, forged, rotated and changed-key capabilities. Historical HMAC derivation
remains explicit history. Canonical-result tests retain missing, foreign, malformed, approved-subject
and repeat-read cases; the CLI creates no state. The former insertion/rotation success expectations
are superseded by L's retirement contract, not retained runtime behavior. `F04-pseudonym-retirement`
14 PASS and `F04-backfill-current` 11 PASS include neighboring privacy cases. `F04-served-people-storage`
174 PASS retains served distinct-person/missing-evidence behavior and explicit verified backups.

Archive UI consumers use immutable saved reports/current version reviews. The delete warning names
transaction evidence and last-owner permanent-key release; rejection preserves the actual refusal.
Pending and applied version actions cannot be resubmitted from stale UI state, and archive navigation
clears live filters/selection. `F04-version-ui-current` 13 PASS; all eight archive-delete-door cases
passed in `F04-archive-delete-renewed` (that combined invocation had a separate capture fixture failure,
later repaired). Live diagnostic files now test actual archive transfer and surviving shared owners.

Rerun planning and final consumption check archived/deleted ownership before reading a live source;
archived ownership refuses with `invalid-state`. `F04-last-unit-launcher` 14 PASS covers all four
ineligible lifecycle families and trust receipt/notification continuity. Notifications remain live
across archive transfer and are removed only by explicit archive deletion. A direct Vitest attempt
failed temporary-path integrity admission; the repository launcher passed without changing that guard.

`F04-lifecycle-walk-renewed` 2 PASS preserves all ten phase reports. It compares the frozen displayed
row/detail/sections and private receipt/checkpoint source records, reads reports without descriptors,
and proves retired relaunch returns `policy-refused` with no authority generation, run or manifest
change. The protected fixture's display differs only in three independently enumerated redacted cells;
private receipt bytes remain exact. The old relaunch-success phase is now its approved retired-door
refusal proof, not a claim that relaunch remains supported. Typecheck/lint found fixture brand errors
and unused old imports; corrected-input renewal and all broad gates remain pending.

Populated schema-49 retirement now covers interruptions before/after commit while preserving the
saved archive database, file bytes and exact existing descendant record. `F04-schema49-retirement`
16 PASS also renews all five complete schema inventories and the six archive conversion boundaries.
Extending restore proof exposed a real single-half defect: a schema-49 live backup with transfer
custody entered historical restore, which quarantined its independent archive. Historical restore
now rejects such a selection before mutation with `paired-lifecycle-backup-required`; the operator
must explicitly select the paired manifest. No companion is inferred, discarded or reconstructed.
Paired recovery retains its live/archive/files interruption protocol; schema-49 ordinary boot stays
blocked until explicit stopped conversion. Final paired-restore renewal is pending.

`F05-types` and `F05-lint` PASS on their recorded inputs. `F05-architecture-renewed` was interrupted
and is not accepted: it briefly overlapped the single-file recovery gate, exceeding the combined
four-file-worker allocation. Its process group has exited; the next whole architecture/coverage
invocation is serialized. Preserve the failed run and its scheduling evidence rather than count it.


`F04-paired49-restore-renewed`: 14 PASS, covering six schema-48 conversion interruptions, three
schema-48 restore interruptions, both schema-49 retirement commit boundaries and all three schema-49
paired restore boundaries. Unpaired custody-bearing selection refuses with unchanged database/archive
bytes and no restore marker. Native SQLite backup page headers may change on restore; immutable report
content and retained file bytes must remain identical and are asserted independently.

`F05-coverage-renewed`: 491 files / 6,231 tests, 6,229 PASS and two failures in source-hooks. The fresh
publication control now verifies initial publication, explicitly deletes it, and retains named absence,
repair and rollback assertions. Capture inventory expects 24 groups and explicitly excludes relaunch
history. `F05-summary-hook-fix`: all four source-hook tests PASS; a supplied obsolete single-file summary
selector matched nothing, so no neighboring-summary claim comes from this invocation. The five real
`tests/unit/run-summaries/` suites are part of full coverage. No skip, timeout or coverage-floor change.
`F05-manifest`, `F05-catalog` and `F05-roadmap` each PASS; diff check is clean after EOF whitespace repair.


### F05 broad gate renewal and archive reference disposition

`F05-architecture-awake`: 848 PASS. `F05-served-concurrency`: all ten required selectors,
235 PASS. `F05-scenarios`: 17 files / 135 PASS. `F05-build`: PASS. Both unchanged benchmark
instruments pass: `F05-dashboard-final` day 1,135 statements (initial baseline 7,531), archive
freeze 12 (bound 13), median 36.37 ms / p95 39.1 ms with 1,240 fixture rows.
`F05-summaries-final` retains the 100/1,000 outside-row controls, selected 20/page 10,
21 statements/25 returned rows/11 summary rows, zero heartbeat writes and one update write.
Both indexes are used; query plans are not measured row visits.

Two further full-coverage attempts were invalidated by host sleep and resulting test/worker
start timeouts. Preserve `F05-coverage-final`, `F05-coverage-awake` and the corroborating
`F05-coverage-host-sleep.log`; neither is PASS. `caffeinate -i` did not prevent maintenance
sleep. Subsequent gates use `caffeinate -iu`, with normal sampled intervals and at most four
file workers. No timeout, assertion, membership or coverage threshold was relaxed.

H's generic report contract supersedes the retired archive Evidence-tab/lightbox assertions.
The archive evidence suite retains both theme/viewport reference identities, frozen capture facts,
exact PNG bytes/dimensions and digest/run authorization. Native verified downloads replace inline
image decoding. Missing/corrupt/foreign metadata and transport refusal controls remain; native HTTP
failure and a throwing inline-decoder trap add negative controls. Keyboard and minimum-desktop
geometry cover the current report and download controls. No legacy preview UI is restored.
The version-review fixture retains visible blockers and disabled application. Archive warning
counts, terminal outcome filtering and navigation now exercise the saved-report/version routes.
R4 must review this explicit assertion disposition and all refreshed reference triplets.

Native attachment links now include the download filename, preserving the report on failed file
responses. The parity fixture's HTTP dispatcher admits the current /files/ route before static
fallback. `F05-native-fixture-final`: 20 PASS, including exact bytes, foreign-digest refusal and a
planted static file that must never be served. `F05-archive-reference-renewal`: 49 PASS, peak four
workers. Both archive evidence images, minimum-desktop saved reports and blocked version review
were visually inspected; files are in the external archive-visual-inspection evidence directory.
Settings/storage reference changes from this scoped run are descriptor provenance only; their
pixels and semantic trees are unchanged. Full parity renewal remains open: broad dashboard
references still carry the earlier descriptor fingerprint and require classified renewal.


`F05-parity-renewed` completed 274 cases: 109 PASS / 165 failures. Fingerprint-dependent
references retain the earlier descriptor/implementation hashes; the corpus derives current hashes
from the real descriptor. Two Chromium resource requests also reported ERR_NETWORK_IO_SUSPENDED;
no concurrent host sleep was recorded. Independent failures exposed stale archive heading names
and the fixture's missing D unresolved annotation. Heading checks retain level-two semantics and
now name the generic saved report/version review. The authored fixture now carries the current
unresolved annotation, matching the real seeded backend's note control; role comparisons remain
unchanged. `F05-adapter-renewed`: all 13 cases PASS. Full reference renewal is deliberate for the
fingerprints, visible hash text, D's follow-up control and already recorded archive disposition;
inspect all other semantic/pixel differences before accepting. Reference count and zero-pixel
allowance remain unchanged. Diagnostic adapter trees are retained in the external evidence root.


### Current resume boundary — 2026-09-10 evening

`F05-reference-final` reached 261 PASS / 13 failures over 30.1 minutes; macOS subsequently
confirmed repeated maintenance sleeps with AppleClamshellState=Yes. `caffeinate -diu` and a
separate bounded display/user-activity assertion did not overcome closed-lid suspension.
`F05-resolution-reference` likewise stalled for 9.5 minutes. Neither is accepted, and no timeout
was increased. Pause further timed gates until the operator leaves the laptop open and awake.
An asynchronous request was sent; this is an environmental acceptance blocker, not permission to
skip gates or commit an unvalidated candidate.

The remaining real resolution fixture defect is repaired: its archive arm now serves
/api/v1/archive/reports/:runId and a strict SavedArchiveReportWire containing frozen, already
redacted resolution facts. `F05-resolution-http`: 11 PASS; its new direct HTTP regression checks
protected note withholding, exact retained bytes after live reopening, and zero live failure reads.
Browser renewal remains required. All 274 parity cases remain collected (two additional native
negative controls); no reference identity was deleted. The full update has 485 changed reference
files: 217 a11y, 209 metadata and 59 PNG files. Differences beyond hashes are the recorded archive
replacement and six failed-run follow-up controls; a machine-readable semantic disposition lives
at the evidence root. The two archived-resolution reference triplets still need deliberate renewal.
Partial generation is not accepted reference parity. Inspect renewed images and run assert mode.

`F05-resolution-types` and `F05-resolution-lint` PASS; diff check PASS. Next: renew resolution/archive reference triplets and any
interrupted fingerprint triplets on an awake host, inspect all changes, then full assert parity and
exclusive full coverage (at most four file workers). Renew affected broad gates and recorded input
reuse, commit exact logical categories, freeze the complete 0df282e..candidate review packet, then
R1–R4 (maximum three simultaneous) and fresh R5. No review or merge has occurred.

Provisional 3.1 handover remains within this owner: fresh/current inventories are exact 37 main
and two archive tables; schemas 46–49 have supported explicit stopped recovery and floor remains
46. Original fresh/v29 import proofs are preserved external fixtures, not runnable removed adapters;
below-floor cases refuse with the original-release remedy. Static migrated fixtures under
 tests/unit/fixtures/migrated-*.json preserve the original canonical facts. Settings remain Saved;
observed primary display and active display override remain distinct. The catalog-driven editor
and P40/A8 deliberate Settings refreeze stay with 3.1 Task 9-2. This is a handover draft, not release.


Resume: checkpoint hashes verified unchanged; task/base and primary identities match. Lid is now open. Consumed the exact database-validation-resume handoff; all surviving requirements and pending gates are recorded here. Resume timed validation with unchanged limits.


Awake-host renewal: `F05-resolution-reference-resumed` 4 PASS. The minimum-desktop archived
resolution image was inspected: complete frozen status/version/operator/time and withheld note,
no editing controls or clipping. `F05-parity-resumed` 270/274; the four remaining failures were
fingerprint-only references interrupted by sleep. `F05-reference-tail` 26 PASS renews those exact
states. All 223 changed a11y references are classified in `reference-final-disposition.json` as
fingerprints, the approved generic archive changes or D's unresolved follow-up. Reference identity
membership is unchanged. `F05-build-fresh` is manifest freshness (not web build), `F05-stores-fresh`
and `F05-roadmap-fresh` all PASS. Full assertion renewal and coverage remain open.


`F05-parity-complete`: 274/274 PASS, zero retries, 84.7 seconds, four workers. All desktop cases, native downloads, archive resolution, observed logs, settings activation and required body-backed a11y evidence pass in assert mode. Full coverage renewal is running exclusively.


`F05-coverage-complete`: 490 files PASS / one fixture setup timeout; 6,225 cases PASS and eight
unrun due to the failed setup, not introduced skips. Four-worker sample gaps were at most 1.08s,
so host sleep is ruled out for this attempt. `F05-perf-fixture-exclusive` proves all eight fixture
cases pass under isolated coverage; command exit remains 1 because a one-file diagnostic cannot
meet global coverage floors. It is evidence of contention, not full gate PASS.

Use the admitted scheduling exception: external `vitest-two-workers.config.mts` imports the real
checkout config and changes only root and all three project maxWorkers to 2. It deep-compares
configs after removing exactly those fields and writes `two-worker-config-proof.json`. All includes,
excludes, isolation, timeouts, assertions and floors remain equal. The initial npm test:coverage
argument attempt was stopped (exit130) because npm passed --config to the second compound command;
no adapter loaded, so it is not counted. Correct invocation is `node --import tsx scripts/test-runner.ts
run --coverage --config /Users/julianhein/Projects/hr-final-validation-evidence-20260910/vitest-two-workers.config.mts`,
followed by `node --import tsx scripts/suite-size.ts`. `F05-coverage-two-worker-valid` has loaded the
verified 2/2/2/2 configuration. Record actual observed workers with its final receipt.


`F05-coverage-two-worker-valid`: 491 files / 6,233 tests PASS, no skips, exit0; statements
85.23%, branches77.46%, functions89.33%, lines88.13%; all configured safety-critical floors PASS.
`F05-suite-size-final` PASS preserves 394 unit,17 scenario,80 architecture files. Worker sampler
observed two direct project workers plus one nested test-runner proof worker (peak3), below the
four-worker ceiling; no other gate or compiler/linter ran concurrently. The external adapter's
SHA256 is 2880f881d3b9d526358c33ee76a12e8e93a2584bbeba89f3a16c8098ab608a9f.
Explicit architecture/build and both benchmark final renewals are serialized after coverage.


### Final candidate gates — 2026-09-11

`F05-architecture-final`: 80 files/848 tests PASS, peak4. `F05-production-build-final` PASS;
existing bundle-size advisory is unchanged. `F05-dashboard-accepted` and `F05-summaries-accepted`
PASS under unchanged instruments, seeds and bounds. Full parity/coverage receipts above remain
accepted. `candidate-gate-reuse-draft.json` enumerates every changed input since each accepted gate:
for coverage/parity and late broad gates only this evidence owner changed; earlier typecheck/lint
also precede the deliberate reference refresh, whose files are not their inputs. No relevant
source/test/config/dependency input differs. Final explicit scenario/served selector renewal passes: 135 scenario and 235 served/concurrency cases. Completion remains open pending independent review and integration.

Provisional delivery assessment: obsolete-table inventory/archive_relaunches is new operator scope
ratified in this owner. Single-half historical restore and selected-root capture cost were combined
implementation defects, fixed with recovery negatives and unchanged benchmarks. Stale fixture and
reference bindings came from scoped prerequisite releases explicitly deferred to this finalizer.
Closed-lid suspension was external; later fixture setup contention was resolved by the admitted
worker reduction. The first npm adapter invocation was an execution mistake, stopped and preserved.
No review repair cycle has yet occurred. Gate logs distinguish these failed attempts from mandatory
renewals; elapsed wall time includes host sleep and does not measure engineering effort.


Candidate status: awaiting independent review. F01–F05 proof/gates are recorded above; F06/F07 and phase completion remain open. Review packet binds exact committed HEAD/tree, full base, per-path scope inventory and gate receipts.


### Independent review interruption and repair ledger — 2026-09-11

R1, R2 and R3 reviewed candidate `28ab8e2b48c0a6f30b2781b3624dbde475254fa1`
against complete base `0df282e45efab2e5a4768386b5c4d5202a7cfc93`. Each returned
**BLOCKED** after unexpected automatic context compaction, with incomplete assigned coverage.
Their partial coverage is not acceptance. R4 and R5 have not run. Complete replacement scopes
require the review-contract fit reassessment; no exhausted reviewer may resume from its summary.
No implementation worker was used. The supervisor is repairing the findings locally.

| Finding | Deciding evidence and current disposition |
| --- | --- |
| R1-CUSTODY | Synthetic populated schema 49 with quarantined archive database/files admitted a live-only backup and schema-50 upgrade. Add custody refusal before backup/upgrade acceptance and verify retained file bytes. Repair pending complete gates and independent review. |
| R2-PAGE | Interrupted archive deletion commits its tombstone before settlement; limit 1 returned no items/no cursor while limit 10 revealed a survivor. Regression observed red, then 14 focused cases passed with pagination/protected-note fixes. Scan excluded rows before forming the visible page. |
| R2-SOURCE | After interruption following saveReport, both direct attachment insertion and the production annotate-failure command changed source evidence; exact apply retry failed archive-transfer-source-mismatch and remained applying. Durable source-write fence remains open. Terminal rename was correctly refused and is not a finding. |
| R2-RETRY | Applying-version UI creates a new apply command envelope; durable claim requires the original ID/fingerprint. Exact request recovery across lost responses/reload remains open. R4 overlap. |
| R3-NOTE | Production capture of a resolved protected run exposes arbitrary free-text notes in public sections/wire although live trust output withholds them. External probe completed with private source bytes retained. Regression observed red; public capture scrubbing repair passes focused cases. Broader proof and review remain open. |

Evidence is retained under `/Users/julianhein/Projects/hr-final-validation-evidence-20260910/`,
including `R1-missing-custody`, `R2-interrupted-attachment`, `R2-tombstone-pagination`,
`R2-interrupted-annotation`, `R3-protected-note` harnesses and `R-fixes-red`/`R-fixes-focused`
gate receipts. The initial repair typecheck/lint failed on a missing ArchiveReport type import;
that import is corrected and gate renewal remains required. The custody suite initially passed
27 cases and failed one newly authored error matcher: production correctly emitted the named
archive-file-unavailable refusal. The matcher now asserts that exact existing contract; no runtime
fallback or refusal weakening was introduced. Full candidate acceptance remains open.

#### Approved review sizing amendment — 2026-09-11

The operator approved the eight-scope replacement on 2026-09-11. Three native contexts exhausted before
complete acceptance, so a fresh unchanged restart has no demonstrated fit. The complete mapped
scopes contain R1 78 production/153 test paths, R2 34/121, R3 60/87 and R4 53/574; R4's test count
includes generated reference assets. Their full-range additions/deletions are respectively 34,691,
25,212, 21,176 and 26,219 lines including overlap and historical removals. These are routing/size
measurements, not evidence that any path was independently accepted.

Replace the four focused assignments with these eight complete bounded assignments,
then the same fresh R5 integration review. Keep Astra/high, read-only, zero implementation workers,
maximum three concurrent, the exact full base, complete requirements and every existing gate.
Each pair collectively retains its original responsibility; shared invariants belong to both
neighbors and R5. No partial prior verdict carries acceptance.

| Approved ID | Complete responsibility retained from original allocation |
| --- | --- |
| R1a | R/T/C authority registry/invariants, terminal/operation/timeline contracts and runtime write callers; P1/P3. |
| R1b | R/T/C immutable migrations, stopped conversion, complete table/adapter retirement inventory, floor refusal, backup/restore/doctor and historical recovery; P1/P2/P3. |
| R2a | L/A generic capture, archive storage, transfer, deletion, shared file custody and private/public evidence; P2/P6; overlap R1b and R3b. |
| R2b | L/A version review/application, durable claims, command-kernel/run-record effects, numbering/membership/lineage and exact replay; P6; overlap R2a and R4b. |
| R3a | F/S settings activation/claims and retained execution resources, sync/async/internal writers and runtime composition; P4/P5. |
| R3b | P/D/G providers, diagnostics, imported/generated artifacts and notification continuity, captured evidence/privacy; P4/P5; overlap R2a/R4b. |
| R4a | Q/V/U summaries, publication/rebuild/query, served Queue/Activity identity/failure states and both unchanged benchmarks; P7/P8. |
| R4b | U/H client/Archive/version retry, exports/downloads, privacy, UI/a11y and reference dispositions; P8; overlap R2b/R3b/R4a. |
| R5 | Entire plan/diff/proofs and all eight complete verdicts; independently inspect cross-boundary wiring, order, identity, recovery, privacy and end-to-end acceptance. |

Before dispatch, regenerate the complete path/proof map against the repaired frozen candidate,
verify every old scope path and requirement has a new owner, and size shared-boundary inspection
and verdict headroom. Findings R1-CUSTODY, R2-PAGE, R2-SOURCE, R2-RETRY and R3-NOTE remain explicit
required reconciliation items. If an assignment still lacks demonstrated fit, stop before dispatch;
never convert incomplete inspection or supervisor repair claims into PASS.

#### Repair verification progress — 2026-09-11

The supervisor implemented all five recorded repairs in the existing worktree. Pending applying
claims now validate retained member source digests before an authority transaction commits; failed
annotation/attachment writes roll back with their journal and generation. Verified archived deletion
remains allowed and exact replay never resurrects its tombstone. Dashboard retries retain an uncertain
request in memory; after reload the server reconstructs the standard dashboard envelope only when
its full canonical fingerprint matches the durable claim. Other envelopes remain unavailable to this
reconstructor and require the original command, rather than guessed optional fields.

`R-custody-renew` passes 28 cases. `R-retry-renew` passes 26 cases. Expanded
`R-schema-and-proof` passes 61 redaction, recovery, UI and protected-history cases. Both unchanged
benchmarks pass (`R-repairs-dashboard`, `R-repairs-summaries`): archive freeze remains 12 statements;
summary selection remains 21 statements/25 returned rows/11 summary rows at both populations,
heartbeat zero summary writes and relevant update one. `R-final-types`, `R-final-lint` and
`R-final-build` pass. Build retains the existing bundle-size advisory.

The initial repair coverage run was stopped after four redaction guard failures with one cause:
the resume-request schema allowed optional free-text reason, although the authenticated reconstruction
never emits it. The wire now omits that field; the unchanged redaction audit and its omission negative
controls pass. Failed run `R-repairs-coverage` and its scratch are retained; complete corrected coverage,
parity, architecture, served/scenario and freshness gates remain required. No repaired candidate is
independently accepted, committed or merged yet. All primary unrelated file hashes remain unchanged.

A twelve-member application probe exposed quadratic recapture in the first source-fence repair:
192 captures for 12 members. Source-writing transactions now carry a savepoint-safe dirty flag;
verified transfer and version-progress protocols retain their own source checks without recapturing
all remaining members on every progress write. Mixed transactions still run the source fence, as do
raw operation/attempt updates. The same probe now observes 48 captures; the regression caps this
12-member application at 60. `R-source-cost-focused` passes 29 recovery/deletion/privacy cases.
All source-sensitive gates are renewed after this correction; the earlier green gates remain
historical evidence, not an assertion of acceptance on changed inputs.

### Current repair boundary — 2026-09-11

The task remains incomplete and unmerged. The original candidate at `28ab8e2b48c0a6f30b2781b3624dbde475254fa1`
has three BLOCKED native reviews; all repairs remain uncommitted in the owned worktree. The source
fence is an experimental repair, **not an accepted solution**: a new regression shows that it also
rejects legitimate shared provider accounting updates. Full gate completion is reopened; two coverage
attempts were deliberately stopped before completion after defects were found. Earlier green gate
results do not accept the current draft or waive this failure.

Additional R1 custody closure passes `R-custody-complete` (34 cases): a nonempty applying claim can
already own captured reports before its first transfer, so it requires archive custody too. The
pre-capture test now interrupts after readPendingReport, outside the committed claim transaction;
the original claimVersionChange hook rolled the claim back and correctly did not require a pair.
Backup preflights retained files before publishing a live manifest. Default upgrade selection ignores
valid live manifests without a published lifecycle pair when pairing is required; explicit selection
of one refuses `paired-lifecycle-backup-required`. A later standalone live manifest no longer masks
an intact earlier pair. Missing or corrupt source halves remain refusals; no operator state was used.

**R2-SHARED is a confirmed repair-design blocker.** `R2-shared-usage.mts` demonstrates that the same
valid shared-quota update succeeds without an applying archive and fails `archive-source-applying`
with one. `R-shared-authority-red` preserves the regression requiring both independent accounting
progress and byte-identical archive replay. The captured source contains shared provider usage and
permanent item-scoped operations/checkpoints as well as run-owned records. Freezing every captured
source row would constrain other live owners; merely removing that check leaves the existing full
source-digest replay mismatch. Do not route around this with swallowed failures, altered digests,
shared-authority rollback, or weaker tests. No runtime deployment or integration is authorized while
this finding is open.

#### Approved capture-claim amendment — 2026-09-11

Keep the exact reviewed membership/source identities, immutable saved reports, current floor, complete
obsolete-table inventory and all existing gates. Amend the L/A recovery protocol so the durable apply
claim retains the complete frozen capture needed for replay, and transfer verifies only the source
facts it removes while shared authorities remain independently writable. This is a material lifecycle
contract change explicitly approved by the operator on 2026-09-11.

1. Under the existing authority transaction, validate the review and capture the complete private
   source, safe display sections and attachment identities for every member. Retain attachment bytes
   before publishing the claim. Persist recoverable capture payloads with the claim in the existing
   version_changes authority; do not add a table or restore retired settings/relaunch imports.
2. Replay publishes those exact captures. It does not recompute reports from changed shared counters,
   operations, checkpoints or UI state. Keep run-owned mutation fences; shared owners can advance
   without an unrelated archive causing their commit to fail. Validate the exact records/ownership
   being removed before cleanup, preserving shared rows and latest accounting.
3. Retain claim captures until archive publication and reciprocal custody verification make their
   removal safe. Preserve application command identity, source/report digests and completed membership.
   Clear only the temporary capture payloads through the reviewed progress protocol; do not leave a
   duplicate live archive after completion or change historical saved report bytes.
4. Paired backup/restore must include attachments owned by pending captures even before archive rows
   are published. Bind both halves and pending ownership; refuse missing/mismatched bytes. Preserve
   support for existing admitted claims: reuse verified captured reports, or reconstruct only with
   exact retained-source proof before retirement. Unprovable history must refuse by name and retain
   recovery assets, never invent original facts.
5. Add interruption/reopen proofs before/after claim, capture publication, each transfer and cleanup;
   preserve exact command identity and report bytes. Prove unrelated shared provider usage and a
   prepared operation's settlement can progress during archive recovery, with no external HR action.
   Prove changed run-owned evidence still refuses, shared ownership/deletion survives, pending backup
   restores all bytes, protected notes remain private, and capture work remains bounded.
6. Recheck the registry/floor/physical inventory and serialized metadata compatibility before edits.
   Renew all affected full gates/benchmarks and the complete focused/integration reviews. No scope,
   coverage, worker, timeout, assertion or production-safety waiver accompanies this proposal.

The operator approved this capture-claim amendment and the eight-scope review allocation together. The supervisor remains the sole implementer, reviews remain Astra/high with
maximum three concurrent, and completion still requires local integration, handover and owned cleanup.

Approval resume verified all fourteen saved dirty-file hashes, the exact handoff hash, task HEAD
`28ab8e2b48c0a6f30b2781b3624dbde475254fa1`, and all three unrelated primary-file hashes.
The consumed handoff is preserved as `consumed-review-sizing-handoff.md` in the external evidence
root; `repair-boundary-state.json` and its patch retain the pre-approval state and gate pointers.
The shared-authority regression remains red until the approved repair is verified.

### Approved repair implementation — 2026-09-11

The frozen-capture repair replaces the experimental full-source fence. New claims atomically retain
all report payloads after file retention; replay authenticates and publishes these exact bytes.
Cleanup and commit fences compare owned source groups while permanent shared accounting,
operations/attempts/checkpoints, settings, commands/audits and note streams remain independently
retained. Older claims retain exact-source reconstruction or saved-report recovery with named refusal
for unprovable capture history. Pending captures clear only through verified published member progress.
The optional schema-2 payload adds no SQL table or migration; floor 46/schema 50 remain unchanged.

Paired backup now includes pending claim file ownership before archive publication, authenticates
file membership against both backup databases, and verifies bytes from the pair's file directory.
Shared archive deletion preserves pending-claim attachments. The storage registry authenticates
private payloads and public projections omit them. The canonical contract and decision index record
this operator-approved amendment.

`R-frozen-final-focused` passes 92 cases in nine files: archive capture/recovery/deletion/retirement,
protected resolution, retained retry ownership and UI exact-request recovery. New proofs include
claim-only capture, shared accounting, synthetic prepared-operation settlement, pending-file paired
restore, shared deletion custody, admitted old claims, named unprovable-history refusal, rollback
before claim commit and replacement/removal refusal. Existing twelve-run capture bound passes.
`R-frozen-types2` and `R-frozen-lint` pass on their recorded earlier repair inputs; final static/full
checks remain to be renewed after contract and payload validation additions. No independent review,
full repair coverage or merge acceptance is claimed yet.

### Repaired candidate gate record — 2026-09-11

Repair implementation commit: `86658084d0867c5a6a71f152f9b912c4cd235278`. All twenty source/test
paths were committed together because capture, custody, command replay, privacy and their regression
proofs form one archive recovery change. The operator subsequently requested continuation with
xhigh supervisor reasoning. Reviews remain explicitly Astra/high, maximum three concurrent;
implementation remains solely with this supervisor.

Every tracked and untracked input byte was verified identical to the passed full-coverage manifest
before commitment and again after the interruption. Primary master remains `80d38635cd3455c2e8c7c4525e0470e4f60ce1d8`;
its unrelated AGENTS.md, CLAUDE.md and repository-work reference hashes remain unchanged.

| Final repaired gate | Receipt and result |
| --- | --- |
| Typecheck / lint / production build | `R-final-types`, `R-final-lint`, `R-final-build`: PASS. |
| Full coverage | `R-final-coverage`: 492 files / 6,257 tests PASS; statements 85.27%, branches 77.55%, functions 89.37%, lines 88.16%; all floors pass. Elapsed 565 seconds, peak three file workers under the approved two-worker adapter. |
| Suite accounting | `R-final-suite-size`: 395 unit, 80 architecture, 17 scenario files. |
| Explicit architecture | `R-final-architecture`: 80 files / 848 tests PASS. |
| Served / concurrency / production static | `R-final-served`: 10 files / 235 tests PASS. |
| Scenarios | `R-final-scenarios`: 17 files / 135 tests PASS; synthetic offline proof. |
| Desktop parity | `R-final-parity`: all 274 cases PASS; unchanged reference inputs and membership. |
| Dashboard benchmark | `R-final-dashboard-benchmark`: PASS with unchanged instrument/population and bounds. |
| Summary benchmark | `R-final-summary-benchmark`: PASS; indexed query 21 statements / 25 returned rows / 11 summary rows for outside populations 100 and 1,000; heartbeat zero summary writes and update one. |
| Generated freshness / whitespace | `R-final-manifest`, `R-final-stores`, `R-final-roadmap`, `R-final-diff`: PASS. |

All fifteen gate receipts report exit zero and peak file workers at most four. Coverage ran without
compiler, linter or benchmark contention. The subsequent required gates ran serially. The complete
obsolete-table test passes fresh and every supported schema 46–49 with exactly 37 main/two archive
tables; schema 50 and immutable released migrations remain unchanged by the capture repair.

The eight-scope map retains all 931 old/current source and evidence path responsibilities, including
rename sides, deleted behavior and the two new capture files. Each original R responsibility has a
new owner. The largest shared implementation is authority-database.ts: reviewers inspect the complete
assigned behavior and necessary callers, while its unrelated subprotocols belong to the other named
scopes. Repeated historical plan/gate records and generated reference rows are not separate behavior.
The external common brief and eight behavioral briefs identify required proof, overlap, prior
findings and commit-bound verdict requirements. The fit assessment separates authored changes from
reference metadata and removes duplicated full-file/history reading; it does not reduce acceptance.
A scope that cannot complete returns BLOCKED, with no partial acceptance or compacted continuation.

The three original reviewers remain BLOCKED and supply findings only. No replacement review has yet
been accepted. F06/F07, local master integration, fixture/contract handover acceptance and owned
cleanup remain open. Runtime gate reuse for the following evidence-only documentation commit is
bound to unchanged source/test/configuration/dependency/reference bytes; document links, binding,
existing twins, generated freshness and whitespace are checked separately.
