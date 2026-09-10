# Q run summaries — scoped release evidence

Status: **Q01–Q06 complete as a scoped development release: focused PASS, locally integrated, owned cleanup verified.** Full gates and independent review remain assigned to 2.6.9.

## Binding and current state

The approved Q01–Q06 brief is `decisions.md` at instructions commit `1d4629c358f3ba35a6603e118373abf777967415`. Product base is `42df5095160e1ff448e76c155a048134ec395ba5`, with repaired L implementation `a1d0c4a5c5f63a3d444b6a5c386fc56b2e2cef57` verified as an ancestor. The owned checkout was `/Users/julianhein/Projects/hr-worktree-database-other`, branch `codex/run-summaries`; both were removed after verified local integration.

Q changes its three production files, five unit files, performance script and this record. The operator additionally authorized the two prerequisite regression-test repairs below. No shared contract, shared fixture harness, migration bytes, registry, dashboard route or operator database was changed. The temporary handoff was consumed, its unique state retained here, and removed. There are no implementation/reviewer agents, pushes or sibling dispatches. Master was initially in another owner's documentation merge conflict; that owner completed it. Before integration master was clean at `6d2ab9201bc454cd893053d2e63416b938163440`. A subsequently created its separate `hr-worktree-database-peer` checkout; Q preserves it and its branch.

## Steps

| Step | State and evidence |
| --- | --- |
| Q01 | Complete: fixed-base ancestry, ownership/capacity and consumer mapping; baseline measurements retained. |
| Q02 | Implemented with owned mutation tests: heartbeat/no-op suppression, creation, presentation, parent/dependency updates, batch grouping, receipt replay, cancellation, timeline append/replay and rollback. L failure-resolution tests also pass. The complete assigned regression gates passed. |
| Q03 | Implemented: atomic rebuild, independent snapshots, blocked writers, interruption after partial insertion, rollback/restart, missing rows, old/corrupt digest refusal, explicit rebuild recovery. |
| Q04 | Implemented: bounded state/workflow partition pages, status/range/parent/batch filters, top-level member exclusion, selected-set Activity, distinct identities across days, retry/member eligibility, lower median, warning availability, timezone and retained-projector equivalence. V still owns real route/export composition; existing served surfaces were not switched. |
| Q05 | Complete: full scoped batch PASS, baseline fixture/pin repairs approved, candidate SHA/tree frozen below. |
| Q06 | Complete: local merge `cb3675770`, integrated input identity and affected checks PASS; owned path, registration and branch verified absent. |

## Gate results

Logs, receipts, synthetic diagnostic scripts and input hashes live at `/Users/julianhein/Projects/hr-summary-evidence-20260909`.

| Gate | Result |
| --- | --- |
| Exact 11-file Q unit command from the approved brief | **PASS: 131 tests, 11 files**, including all 17 owned tests and repaired Queue regressions; `amended-unit.log`, exit 0. |
| Exact three-file architecture command | **PASS: 32 tests, three files**; `amended-gate-0.log`, exit 0. |
| `npm run lint` | PASS, exit 0; `amended-gate-1.log`. |
| `TZ=UTC ./node_modules/.bin/tsx tests/perf/run-summaries.ts` | PASS, exit 0; `amended-gate-2.log`. |
| Manifest generation then check | PASS, exit 0; `amended-gates.json`. |
| Store catalog generation then check | PASS, exit 0; generated output unchanged. |
| Roadmap generation then check | PASS, exit 0; generated output unchanged. |
| `git diff --check` | PASS; documentation recording also reruns this check. |
| Full typecheck/coverage/parity, complete architecture, independent review | Not run; assigned to 2.6.9. |

Both test commands used `VITEST_MAX_WORKERS=1`, `--maxWorkers=1` and the unchanged real configuration. The named projects inherit the root worker limit without overriding it; observed execution had one forked file worker. Membership, isolation, timeouts, assertions and floors are unchanged. `amended-tested-inputs.json` records 2,087 executable/test/tooling inputs including the two authorized test repairs. Earlier pre-amendment logs/hashes are diagnostic history, not the released gate receipt.

## Reproduced prerequisite defects and approved amendment

1. `tests/unit/server/run-queue-projection.test.ts` has **17 pre-existing failures**. Its calls through `tests/unit/server/helpers/dashboard-harness.ts:378` construct terminal done/failed runs without the required completion record. `RunRecordSchema` refuses them with `done/failed requires completion; other states cannot carry it`. The exported exact fixed product base reproduces all 17; the accompanying Activity export suite passes (`fixed-base-regressions.log`: 17 failed, 50 passed). The repair supplies valid, claim-bound completion fixtures locally in this test file, following the existing Activity test pattern. All assertions, the source schema and shared harness remain unchanged.
2. `tests/unit/architecture/migration-history-immutability.test.ts:99` pins through schema 47, but the fixed product base is schema 48. The exact base reproduces `48 !== 47` / `a new schema version must append its reviewed literal digest` (`fixed-base-migration.log`: one failed, three passed). The repair appends the v48 literal `c7ec15732fac549fce184f1cd8454203fd332e1f5b2e373d9182fba6060fcbeb`, calculated with the existing framed digest algorithm from the exported fixed base. The released migration originated in `08d9f4f5334eb20a49334acda268727b622b1163`; its statements were inspected and are unchanged. No earlier pin or migration bytes changed.

`baseline-identity.json` proves that both test files, the shared dashboard harness, run-record schema and migrations match both Git's fixed base and the exported baseline byte-for-byte. These are prerequisite defects, not failures introduced by Q. The approved brief explicitly makes these regressions read-only to Q and says a newly required shared edit blocks release until ownership is amended and revalidated. These failures were not waived or deferred to 2.6.9.

The operator explicitly answered **“do it”** to the proposed two-file proof-ownership amendment. Q owns these narrow repairs for this release; the three-production-file boundary and all other exclusions remain intact. The exact unit and architecture commands now pass. No automatic owner dispatch occurred.

## Implementation and measurement notes

- Queue/Activity use the retained enqueue-to-end duration contract. Protected historical receipt diagnostics leave warning counts unavailable; they are not treated as clean.
- The summary digest now binds a domain-separated `run-summary-v2` payload of contributing read-model facts. It excludes publication revision, display-update clock and heartbeat clock, so unrelated changes do not rewrite rows. This digest is internal to Q, is validated on reads and is never an archive source proof or public projection field. Existing L-format rows refuse with `run-summary-rebuild-required` until explicit refresh. An actual database produced by the unmodified fixed base reproduced the old-duration defect; `old-publication-repaired.log` proves refusal and correct explicit recovery with Q.
- Timeline notifications now use the durable `scope.runId`, and only contributing queued/claimed events advance the summary cursor. Exact replay and rolled-back appends do not change published rows. Parent source lookup uses the existing indexed `parent_run_id` column.
- Cancellation is a bounded scalar primary-key read; batch presentation is a bounded batch-record read inside the same snapshot. Neither reconstructs receipt, checkpoint, result or failure stores per displayed row. Source authority remains responsible for every action.
- The existing summary index orders workflow/day/state/key. Bounded state partitions merge into stable day/key pages. Equal range bounds retain SQLite's index order; an equality predicate caused SQLite to elide the constant ORDER BY term and introduce a temporary tie sort. The real query-plan regression proves the bounded partition query uses the existing index without that sort. No DDL was added.
- Synthetic populations contain 100 or 1,000 out-of-range rows plus 20 selected rows and one earlier fixture run. A 10-row page materializes 11 summary rows at both sizes; the old whole-reader path materializes 121 and 1,021. The indexed path executes 21 prepared statements (including metadata, seven bounded state partitions and ten cancellation scalars), versus four for the whole reader. It performs zero receipt/result/failure/checkpoint reconstruction. Heartbeat writes zero summaries; one presentation update writes one summary. Actual SQLite rows visited are **unavailable** through Node's API; returned rows are measured and EXPLAIN output is only plan evidence. Latencies are recorded without a speedup threshold or claim.

## Delivery assessment

The missing prerequisite fixture/pin updates are planning/preflight omissions: the exact required gates did not pass on the bound product base. In-scope implementation repairs addressed old-format validation, timeline source identity, typed status aggregation, bounded tie sorting and invalid synthetic fixture inputs. Earlier lint runs invalidated by further edits were not reused; two obsolete owned lint processes were stopped, and the final full lint passed. No assertion, timeout, coverage threshold, migration or shared test was weakened. The operator-approved fixture/pin repairs close the prerequisite defects without changing production authority. Full combined acceptance remains assigned to 2.6.9.

## Frozen candidate

- Product base: `42df5095160e1ff448e76c155a048134ec395ba5`, tree `d5dce8241e4ff48592a62aeeff1dcddf03509431`.
- Authorized prerequisite proof repair: `6c078b342f9593dea33e39645bad665459df8871`.
- Q implementation candidate: `75fab6b9adad7c25c41427c9e5eaff37495e2e55`, tree `4b63cf59b4777995586b0895e911827145a86114`.
- Exact commands/exits: `amended-gates.json` plus `amended-unit.log` (unit command printed in the runner log); all exit 0. Candidate input hashes: `amended-tested-inputs.json`. All 2,087 recorded inputs match the committed candidate.
- Documentation-only evidence recording reuses those executable results on verified identical hashes, rerunning roadmap binding/freshness, instruction pairs/chains, local links and whitespace. No new relative links were introduced; the evidence owner and instruction SHA paths resolve.
- No reviewer was dispatched under the approved Q exception. This is a scoped development release, awaiting independent review and full combined acceptance at 2.6.9.

## Verified local integration and cleanup

Release/evidence tip `52ab28b6711f3310a6ee7fcfee103da2e5b1cd7a` (tree `ef69226232c5f64508727acef4f9fec029eeb53b`) merged without conflicts into clean master `6d2ab9201bc454cd893053d2e63416b938163440`. Integration commit is `cb36757703873d7da0c571a126bf3676894dd2db`, tree `ccd13d5b8f1aaa5602e10318b48b6ab8acb7d3fe`.

`integration-inputs.json` verifies every one of the 2,087 frozen executable/test/tooling hashes on that integration. Relative to the candidate, master adds only five previously approved planning/governance Markdown changes; their paths are retained in that receipt. Unit, lint and synthetic performance results are reused on input identity. The exact three-file architecture batch reran **32/32 PASS**; manifest, store catalog and roadmap generation/check pairs, instruction-pair/chain audit and whitespace all passed with unchanged generated output (`integration-gates.json`). No full gate or independent review is represented by this reuse.

Cleanup followed gate acceptance and ancestry verification. Q had no uncommitted tracked/untracked content and zero unique commits. Its only ignored content was the owned `node_modules` symlink, removed without touching the dependency target. Ordinary `git worktree remove` and `git branch -d` succeeded. `cleanup.json` verifies the physical Q path, registration and branch ref absent. A's active `hr-worktree-database-peer` / `codex/archive-transfer` remained intact. No task was archived, no push or sibling/next-task dispatch occurred. Synthetic evidence remains outside the removed checkout at the retained evidence root.

Final completion recording changes only this evidence file. `completion-gates.json` records the rerun roadmap binding (24 tests), roadmap generation/freshness, instruction pair/chain audit and whitespace checks; executable hashes remain identical. This closes Q only. V may consume Q's actual integrated release when its other prerequisites are met; route/export composition remains V-owned, and complete combined review/full gates remain 2.6.9.


## P1 follow-up — retained archived transaction history

The operator reported one confirmed transaction becoming zero after archiving, with the archive retained and no deletion. The requested repair authorizes the history reader and its authority wiring plus relevant proof. This follow-up used `codex/archive-history` at `/Users/julianhein/Projects/hr-worktree-archive-history`, based on integrated A/Q `8e0ff7f9d8f4458f332157c409ff351cb01c5ed0`. It preserves the existing 2.6.9 full-gate/review boundary and authorized local integration/cleanup. No live data, schema or transfer cleanup policy changes.

Cause: transfer atomically removed the live timeline rows, while `createTransactionHistory` enumerated only that live timeline. The earlier Q peer/recovery proof established retained archive ownership but missed transaction totals across cleanup. This was an integration-proof omission, not an authorized change to transaction semantics. The deciding requirement remains `dashboard-surfaces.md` §T2: count retained archived confirmed operations, excluding deleted owners.

Repair: the authority exposes source snapshots only for committed, non-deleted transfers. It validates the retained verified/published report, transfer identity, source digest and run tuple. Verified custody is included immediately after live cleanup, before publication replay. Pending captures without committed transfer remain represented by live rows. The same history reducer reconstructs archived operations from frozen events, attempts and checkpoints, applying existing confirmed-day/system filters, protected presentation and operation-generation duplicate refusal. No second totals implementation or new public wire was introduced. Pre-transfer conversion and isolated live-only test repositories explicitly lack this archive port; production authority always supplies it. A missing or corrupt retained report fails instead of returning smaller totals.

`tests/unit/transaction-history-archive.test.ts` first failed in all four transfer-interruption cases without the fix. Seven final regression cases prove capture/verification/cleanup/publication interruption, restart and exact replay; live-plus-archived counts without duplicates; byte-identical explicit exports; converted source provenance and confirmed-day filtering; explicit deletion and interrupted deletion settlement; and loud refusal when retained evidence disappears. The original and new tests preserve all assertions and source schemas.

The expanded projection guard also exposed two integrated-base proof defects, reproduced on an untouched export of `8e0ff7f9d`: its consumer set omitted the approved Q query port, and its failed-run fixture omitted the required completion. The narrow proof repair names that exact admitted consumer and supplies a valid claim-bound fixture. The producer bound and badge/status/row assertions remain intact. The active guard inventory records this scope and deciding evidence; no guard was retired. These findings did not justify changing transaction behavior or weakening a source schema.

Evidence root: `/Users/julianhein/Projects/hr-archive-history-evidence-20260909`. `archive-history-red.log`, `archive-history-expanded.log` and `baseline-projection.log` retain red/green and baseline diagnosis. `gates.json` records the 18-file unit command (184 PASS), initial expanded guard failure, lint and generation/freshness results. `repaired-gates.json` records all six architecture files (47 PASS) and the renewed lint/whitespace checks. One effective file worker uses the unchanged Vitest configuration and explicit `VITEST_MAX_WORKERS=1 --maxWorkers=1`. Full typecheck/coverage/parity and independent review remain 2.6.9; no such PASS is claimed here.


P1 implementation `6cec3e8b06ef4a802d8ef0e8ec68e529dd0d3492` has tree `745feacb40bf054f505e9c3a145fdcbe6f595e73`. Related proof repair `1ee4c42a0bd03cf0c5149b322b69d661bb63077a` has tree `7d2a64b0dad6289fa6a7ef6125d40784cb5d3776`. `candidate-inputs.json` freezes 2,129 non-document inputs; `input-reuse.json` proves the only change after the unit batch was the unimported architecture test, which then passed its six-file rerun and renewed lint. Manifest/catalog/roadmap generation and freshness all passed without changed output.

The additional inventory audit has an explicit **baseline failure**, not a PASS: its repository-wide `fail-loud-catch-default` arm flags unchanged `src/dashboard/surfaces/settings-model.ts` (SHA256 `16a0a9a84706e26f57049f8eefc24a172cf52c0d2857cf43d80192d06bf2408c`). The untouched base reproduces this one failure with five inventory tests passing (`baseline-manifest.log`); the working audit also passes roadmap binding, yielding 29 PASS / one baseline FAIL (`docs-gates.json`). This unrelated Settings production issue is retained for the already-assigned 2.6.9 full-gate finalizer. No guard was skipped or weakened to hide it, and this scoped P1 release does not claim broad architecture/full acceptance. Instruction-pair/chain, roadmap freshness and whitespace checks passed.


P1 local integration is complete: release `ab19cfba199895a93b25b33d85793873047267e2` merged as `9892575c332299d3907a58f05439fa0a7b5584d0`. Both have tree `2432f8dd4c80f9e9917f7a9dadb557199a245fae`; all 2,129 frozen inputs match, so the recorded focused gates are reused without invalidated inputs (`integration.json`). Ordinary removal of the owned worktree and merged branch succeeded; physical path, registration and ref are absent (`cleanup.json`). Only master remains registered. Final documentation checks and unchanged-input verification are retained in `completion-gates.json`. No push, sibling dispatch, next task or live database action occurred. The P1 is repaired; the explicitly recorded baseline Settings ratchet failure and full combined acceptance remain with 2.6.9.
