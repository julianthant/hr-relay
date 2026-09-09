# Phase 2.6 · Database modernization

## Approval and scope

On 2026-09-09 the operator approved combining database-parallel, database-remaining and the
remaining timeline T2 into one prerequisite-driven workflow before the former 2.6.2 proof task.
This folder is the single substantive plan owner. The old sidetrack folders are removed; completed evidence is retained in this folder's history/.
This is a **Phase 2.6-only trial**; other phases retain their existing gate requirements.
The operator requested focused tests and fixes during implementation, then heavy gates, independent
review and remaining repairs in one fresh final session. Planning creates no tasks or worktrees.

**Status: organization and approved product directions recorded; execution admission remains open.**
No database-modernization implementation releases are claimed here. T1 is a separately completed input.
Timeline T1 is now integrated at `46930920696ab214b036d5f2681b8ffb4e5620ea`; its existing owner
records R1c PASS, integration gates and cleanup. Its implementation/evidence remain unchanged.
T2 is included here as pending work; do not run the old standalone T2 prompt as well.

The [product decisions](decisions.md) retain every approved settings/version/archive/read-model
choice. The domain files retain the detailed earlier product contracts and proof rows. This README,
[prerequisites](prerequisites.md) and [prompts](PROMPTS.md) replace their old execution controls.
Product scope is not reduced when a proof moves to a later gate. Current contracts still describe
implemented behavior until the assigned prerequisite ratifies the approved changes at their actual
owners: R handles its names; C0 handles downstream product contracts.

## Roadmap identity

The operator requested visible prerequisite and parallel-child cards matching Phase 3.1. The
new 2.6.2 naming task precedes C0, now 2.6.3. Later pending tasks shift by one;
assignment letters and stable node IDs keep their existing owners.

| Roadmap task | Assignment | Outcome |
| --- | --- | --- |
| 2.6.2 | R / p2db-simple-renames | Seven approved naming-only changes |
| 2.6.3 | C0 / p2-db-modernization | Contracts and exact execution admission |
| 2.6.4 | T | Remaining timeline T2 |
| 2.6.5 | C | Direct run completion |
| 2.6.6 | F | Shared domain foundation |
| 2.6.6.1–4 | P / D / G / S | Independent provider / diagnostic / artifact / settings tasks |
| 2.6.6.5 | Domain finalization | Combine all four domain peers |
| 2.6.7 | L | Lifecycle foundation; consumes 2.6.6.5 |
| 2.6.7.1–2 | A / Q | Independent archive transfer / run summaries |
| 2.6.7.3 | Lifecycle finalization | Combine archive/summary peers |
| 2.6.8 | V | Served interface foundation; consumes 2.6.7.3 |
| 2.6.8.1–2 | U / H | Independent Queue/Activity / archive viewer |
| 2.6.8.3 | p2f-proof | Final integration, heavy tests, repairs and independent review |
| 2.6.9 | p2f-close | Final handover and cleanup evidence |

Historical aliases: proof was 2.6.2, then 2.6.3; closure was 2.6.3, then 2.6.4. Both stable
node IDs remain unchanged. The existing task titled “Plan phase 2.6.2” referred to the old proof:
resume it as 2.6.8.3. Completed 2.6.1 and Phase 3 tasks remain unchanged. Broader dashboard work stays
with its existing 3.1 owner. The final session may record Task 9 when its criteria pass without
rerunning unchanged heavy checks just for another task number.

A prerequisite/peer card becomes complete only on its named scoped development release: committed
working behavior, focused proof and exact handoff. It does not claim independent review or master
acceptance. This lets dependency edges unlock the actual next tasks while Phase 2.6 and finalizer
remain unfinished. All full product acceptance remains with 2.6.8.3; no completed cards are claimed now.

## Workflow and concurrency

These are visible tasks within Phase 2.6, with independent peers nested under their prerequisite. An arrow
means a real input dependency. “Release” means a committed, focused-tested development candidate,
not reviewed master acceptance. All releases are audited again on the combined final tree.

```text
2.6.2 Renames → 2.6.3 C0 → 2.6.4 Timeline T2 → 2.6.5 Completion → 2.6.6 Domain prerequisite
                                                      ├─ 2.6.6.1 Provider
                                                      ├─ 2.6.6.2 Diagnostics
                                                      ├─ 2.6.6.3 Artifacts
                                                      ├─ 2.6.6.4 Settings
                                                      └─ 2.6.6.5 Finalization (after 1–4)
                                                               ↓
                                                2.6.7 Lifecycle prerequisite
                                                      ├─ 2.6.7.1 Archive transfer
                                                      ├─ 2.6.7.2 Run summaries
                                                      └─ 2.6.7.3 Finalization (after 1–2)
                                                               ↓
                                                2.6.8 Served-interface prerequisite
                                                      ├─ 2.6.8.1 Queue/Activity
                                                      ├─ 2.6.8.2 Archive viewer
                                                      └─ 2.6.8.3 Finalization (full batch gates/review)
                                                               ↓
                                                2.6.9 Handover and cleanup evidence
```

F unlocks up to **four implementation sessions** (P/D/G/S), subject to actual available checkout
and test capacity. L consumes finalization 2.6.6.5 after all four domain peers; V consumes 2.6.7.3
after both archive/summary peers. These are explicit group-release barriers. The later groups each allow two active implementers. Their finalization children run afterward. These are separate supervisor tasks because each owns a full behavior/proof seam;
default zero implementation subagents. The final session uses one fresh read-only `sup_review`.
Planning, supervision and independent review use **GPT-6 Astra/high**. Any separately authorized
supporting implementation worker follows the current native Sol/Terra role policy; none is assigned here. Intermediate finalization is owned by [its last child](group-finalization.md), not an idle observer.
The sole full-batch acceptance/repair owner remains 2.6.8.3.

This graph is the approved scheduling direction, **not a claim that the future seams already
exist or peers can launch today**. C0 closes decision/ownership questions; each implementation
prerequisite must deliver working shared interfaces and prove peer independence before release.
If the proposed split cannot satisfy both merge orders, amend it before launching affected peers.

## Assignment and product ownership

| ID | Sole responsibility | Product/proof owner |
| --- | --- | --- |
| R | Seven approved naming-only changes; current consumers and historical-name preservation | renames.md |
| C0 | Consume R and inspect accepted T1; ratify approved contracts, settle open decisions, allocate exact files/tests/migrations and issue verified briefs | prerequisites.md; decisions.md |
| T | Database transaction history and existing exports; lossless ledger/outbox conversion and retirement; compatibility archive transaction section | timeline.md |
| C | Completion directly on workflow_runs; run_failures; retire terminal authorizations and terminal outbox safely | run-completion.md, all P1–P6 |
| F | Shared migrations, repository/transaction contracts, real composition seams, recovery, import/extraction, baseline domain modules and isolated fixtures | foundation.md; artifacts.md import/extraction proof; prerequisites.md |
| P | Provider-neutral requests, all-time/current usage and quota policy; no real key/provider integration | provider-usage.md, all P1–P6 |
| D | Live diagnostic resolution and remaining diagnostic UI/command behavior; no lessons/fixes machinery | diagnostics.md, all P1–P6 |
| G | Generated artifact publication/update lifecycle, file verification and existing XLSX exports | artifacts.md generated-output P4–P8 |
| S | Save/validate/activate app_settings + settings_snapshots for new runs without restart; preserve each existing run's configuration | decisions.md group 2 settings |
| 2.6.6.5 | Combine all domain candidates and release L after focused integration checks | group-finalization.md |
| L | Shared archive/version/summary lifecycle contracts, schemas, atomic mutation hooks, deletion/backup/source adapters and live API baseline | prerequisites.md; decisions.md groups 2–5 |
| A | version_changes and verified archive.sqlite/archive_records transfer, old archive conversion, deletion/recovery and no relaunch backend | decisions.md version/archive/deletion sections |
| Q | run_summaries derivation, incremental maintenance, rebuild, indexed queries and validated aggregate identity counts | decisions.md group 5 |
| 2.6.7.3 | Combine archive/summary candidates and release V after focused integration checks | group-finalization.md |
| V | Freeze working served APIs and shared UI wiring from accepted development A/Q candidates; remove remaining shared relaunch wiring | prerequisites.md |
| U | Queue/Activity consumers and exports through served queries; benchmark query count/latency with isolated fixtures | decisions.md group 5; timeline.md transaction metric boundary |
| H | Generic saved archive report list/detail/filter/download viewer; remove archive relaunch UI | decisions.md group 3 |
| 2.6.8.3 | Sole final integration/repair owner; required migration/recovery, full gates, fresh independent review; no repair handbacks | final-validation.md and parent phase Task 8.3 |

R exclusively owns the seven naming-only changes in [renames.md](renames.md). F consumes those
names and owns approved removal of unused gates, ocr_approvals and SQL notes, diagnostic retirement
and resolution storage; it preserves working approvals, logs and live-read results. D adds live
resolution behavior; S adds settings activation. Existing notifications remain durable; L/A own
archive/delete links. F also removes unused SQL spans while preserving timeline/history inputs,
and F/G consolidate XLSX export evidence into generated_artifacts, retiring operator_xlsx_exports.
Historical run/operation relationships remain open for C0; the two table dispositions are approved.

## Independent implementation and integration contract

A prerequisite is finished for development release only when the real composed application works
on its candidate alone. It cannot deliver just types, stubs, promised APIs, or opaque no-op hooks
that lose required facts. Each peer receives an exact disjoint production/test/document write set,
existing callable interfaces, scoped proof selectors and a pinned prerequisite SHA. A peer can
implement and run its focused acceptance without checking out another peer's branch or fixtures.

Shared owners alone edit migrations, schema/fingerprint registries, composition roots, global
command/wire unions, common fixtures and generated catalog/manifest inputs. Prerequisites extract
real baseline modules where peers would otherwise need those files. Any later shared edit becomes
an explicit sequential prerequisite amendment, not permission for concurrent touching of the file.
The ownership candidates in foundation.md are evidence for F, not a frozen claim about post-T1 paths.
L must similarly separate archive transfer from summary derivation; V separates their UI consumers.

Each release records pairwise write-set intersections and both merge orders, including aggregate
behavior, schema history, source hooks, test helpers and generated outputs. At final validation,
reproduce both orders for peers on disposable local trees where order affects compatibility; use
focused boundary checks there, then full gates once on the actual combined candidate. Shared
regeneration and mutations of a single target are serialized. Do not duplicate full suites merely
for an order label or substitute a clean textual merge for behavior proof.

## Candidate flow, integration owner and resources

The operator launches assignments. Each group finalization supervisor assembles its named worker candidates in its own isolated
branch and passes a verified development release to the next prerequisite; this is not master
integration or acceptance. **2.6.8.3 is the single full-batch acceptance, master-integration and remaining-repair owner.** No peer has
permission to merge into master, dispatch siblings, restart T1, or push. Local master integration
still requires the operator's assignment after full gates and review. Progress/evidence belong to
the assigned file; no peer edits this shared index concurrently.

Compact handoff: ID, plan commit, base/head/tree, branch/worktree, exact changed paths and contract
versions, focused commands/exits/proof rows, unverified heavy rows and concrete remaining defects.
No repeated status polling. Continue unrelated owned work when blocked, then return the exact blocker.
Fix in-scope defects during implementation; group finalization owns immediate combination defects, and the final
2.6.8.3 session owns all remaining acceptance/review failures without repair handbacks.
Use /handoff only for unique interrupted state not already captured by that record.

Known contention from the earlier allocation: simultaneous default Vitest invocations can each
spawn four file workers; coverage must not contend with this batch's compiler/linter. Allocate at
most **four effective test workers across this batch**, normally one per active peer; verify runner
support and observed workers before use. The command's task owns its process group and releases the
allocation on exit, including failure. Recheck unrelated host work before launching; never kill it.
Private synthetic DBs/temp directories belong to the test invocation. No tests use the operator DB.

Existing parity/build/report outputs and locks are worktree-local; use unique supported temporary
roots and ephemeral ports. The final owner runs heavy coverage/parity/build after peers finish,
without this batch's concurrent compiler/linter. It owns combined generation and shared target writes.
Do not invent a global lock for isolated outputs. If evidence reveals another shared resource,
record owner, acquisition and release checks in the affected brief before using it.

## Completion and readiness

[Prerequisites](prerequisites.md) define each release. [Prompts](PROMPTS.md) give exact planning and
conditional execution wording. No base SHA for a future release is fabricated. All implementation
assignments after R are **WAITING ON R → C0**, then their explicit inputs. R scope is approved;
its exact execution brief/base is resolved by `/phase-plan 2.6.2`. T1 integration is complete.
The architecture graph is recorded now; executable file allocations and resolved launch prompts
are completed in C0 and checked at each release, not left for parallel peers to negotiate.

Final acceptance requires every retained product proof, required heavy gate, independent review,
review-finding repair, operator-assigned integration and exact cleanup/evidence. A completed development card means its scoped release only; final product acceptance remains open. No live external submission or operator database upgrade is
included in this planning or candidate workflow.

## Initial consolidation verification — a524b70bf

Planning was prepared on `58d4fbcba` and reconciled with `d61dc6fe6`, preserving that commit's
Phase 3 finalizer amendments and instruction twins. The specific database exception preserves the
operator's stronger request to defer prerequisite/peer reviews as well as heavy gates to 2.6.7.3.

- Roadmap binding guard: 24/24 tests passed; full repository lint passed.
- Roadmap generation/freshness and whitespace checks passed.
- All 26 original domain P1–Pn proof rows retained verbatim; nine existing instruction twins equal
  and project instruction chains below 32,768 bytes.
- New/moved Markdown destinations and anchors verified. Six existing links in the decision index
  and old timeline owner point to three old plans deleted by another session. Those deletions and
  untracked handoffs are preserved; they are not new broken links from this consolidation.
- Product code/config/tests/dependencies unchanged by this commit. No full coverage, runtime proof,
  implementation review, operator database changes or launch readiness claimed.

Exact planning commit and checks are also recorded in the commit message. T1's integration owner
was notified to preserve this pending-T2 pointer and its own evidence; no T2 execution was requested.

## Sidetrack cleanup and evidence routing

All remaining sidetrack work is now represented here. The original database-parallel and
database-remaining entry points are removed after repointing current links. Completed timeline T1
and worker/operation/command rename records are retained under [history](history/timeline-t1.md),
with exact original commit/path and source digests. Relocation preserves their recorded evidence;
historical instructions cannot launch duplicate work. Untracked handoffs outside sidetracks remain
untouched. Use the roadmap's current identities and this folder for all remaining implementation.

## Roadmap expansion and cleanup verification — 2026-09-09

On the documentation candidate based on accepted T1 integration `469309206`:

- Roadmap binding and desktop interaction tests: 2 files, 30 tests passed with one test worker.
- Full repository lint, roadmap generation/freshness, whitespace and docs instruction audit passed.
- Three generated groups verified: 4/2/2 mutually independent workers, each followed by its last
  numbered Finalization child; the next prerequisite requires that child. Full acceptance is
  2.6.7.3, followed by 2.6.8 handover. Completed 2.6.1 and existing Phase 3 node IDs are preserved.
- Forty-four scoped Markdown files, including moved history, have no missing local links/anchors.
- All 26 original domain proof rows and all four historical evidence bodies are preserved;
  historical source hashes verified, with only relocation banners and Markdown destinations changed.
- The old sidetracks directory is absent. Already missing completed-plan paths were included in
  the operator-requested cleanup after preserving their exact committed history; untracked handoffs
  outside this directory remain untouched.

This is documentation and planning only. No implementation, worktree/task launch, database mutation,
heavy runtime gate or independent implementation review is claimed. C0 execution admission remains.

## Rename-first and table disposition verification — 2026-09-09

The operator approved new 2.6.2 R, moving C0 to 2.6.3 and pending successors by one; the gate
trial applies only to Phase 2.6. R owns seven naming-only changes. F removes unused SQL spans;
F/G fold XLSX request/completion evidence into generated_artifacts and retire operator_xlsx_exports.
Backups, exports and maintenance recovery remain. Current workflow/task owners and prompts above
supersede the earlier numeric aliases in the dated verification records.

Validation of this documentation-only amendment:

- `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/roadmap/roadmap-ui.test.ts --maxWorkers=1`: 2 suites, 30 tests passed.
- `npm run lint`: exit 0. Roadmap generation/freshness and `git diff --check`: passed.
- 172 scoped local links/anchors and all nine existing instruction pairs passed; frozen history
  files remain unchanged. The generated UI verifies 13 new/shifted identities and all 80 Phase 3
  identities unchanged. No source/test/config/dependency inputs were modified.
- Full runtime gates and independent implementation review were not run or claimed. All new
  task cards remain planned. R needs its exact execution admission via `/phase-plan 2.6.2`;
  downstream C0 consumes R's committed development release. No worktree, task dispatch, live
  upgrade, backup, export or production action occurred in this planning session.
