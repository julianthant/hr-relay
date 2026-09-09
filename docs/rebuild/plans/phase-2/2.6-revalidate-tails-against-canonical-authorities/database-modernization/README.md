# Phase 2.6.2 · Database modernization

## Approval and scope

On 2026-09-09 the operator approved combining database-parallel, database-remaining and the
remaining timeline T2 into one prerequisite-driven workflow before the former 2.6.2 proof task.
This folder is the single substantive plan owner. Earlier folders are navigation/history only.
The operator requested focused tests and fixes during implementation, then heavy gates, independent
review and remaining repairs in one fresh final session. Planning creates no tasks or worktrees.

**Status: organization and approved product directions recorded; execution admission remains open.**
No runtime changes, implementation gates or accepted prerequisite releases are claimed here.
The active **Review timeline history** task was inspected on 2026-09-09: it is implementing T1 in
`hr-worktree-timeline-events`, with focused repairs, full gates and review still outstanding.
T1 is an external input whose in-flight ownership, plan, gates and evidence remain unchanged.
A later coordination message reports candidate `535c16c6650ac0aa7cd818cd4480c58de51b0f87`
and R1c PASS, with integration gates still running; this is not yet an accepted master release.
T2 is included here as pending work; do not run the old standalone T2 prompt as well.

The [product decisions](decisions.md) retain every approved settings/version/archive/read-model
choice. The domain files retain the detailed earlier product contracts and proof rows. This README,
[prerequisites](prerequisites.md) and [prompts](PROMPTS.md) replace their old execution controls.
Product scope is not reduced when a proof moves to a later gate. Current contracts still describe
implemented behavior until prerequisite C0 ratifies the approved changes at their actual owners.

## Roadmap identity

| Current identity | Meaning | Earlier identity |
| --- | --- | --- |
| 2.6.2 / `p2-db-modernization` | This combined planning and development workflow | database-parallel + database-remaining + pending timeline T2 |
| 2.6.3 / `p2f-proof` | Fresh final integration, migration/recovery proof, heavy tests, repairs and independent review | Former 2.6.2; stable node ID unchanged |
| 2.6.4 / `p2f-close` | Final evidence and fixture handover to 3.1 | Former 2.6.3; stable node ID unchanged |

Completed 2.6.1 tasks retain their identities and evidence. The existing task titled
“Plan phase 2.6.2” refers to the old proof assignment: resume it as **2.6.3**, not as this new scope.
The final 2.6.3 session may record the 2.6.4 handover after satisfying that task's criteria; do not
repeat unchanged heavy gates merely to record a second task number. Broader Phase 3.1 dashboard
work remains with its existing owner; only the approved database-driven surfaces move here.

## Workflow and concurrency

These are bounded assignments within 2.6.2, not additional top-level roadmap phases. An arrow
means a real input dependency. “Release” means a committed, focused-tested development candidate,
not reviewed master acceptance. All releases are audited again on the combined final tree.

```text
accepted T1 ── C0: contracts and precise allocation
                    │
                    T: remaining timeline T2
                    │
                    C: run completion
                    │
                    F: shared database/domain foundation
                    ├── P: provider usage ─────────────────────────────┐
                    ├── D: diagnostic resolution ──┐                 │
                    ├── G: generated artifacts ───┼── L: lifecycle   │
                    └── S: settings activation ───┘   foundation     │
                                                       ├── A: archive/version transfer
                                                       └── Q: run summaries
                                                              │ (A + Q)
                                                       V: served interface release
                                                       ├── U: Queue/Activity consumers
                                                       └── H: generic archive viewer
                                                              │ (U + H + P)
                                               2.6.3: combine, heavy gates, fixes, review
                                                              │
                                               2.6.4: handover and cleanup evidence
```

F unlocks up to **four implementation sessions** (P/D/G/S), subject to actual available checkout
and test capacity. L needs D/G/S, not P; an unfinished provider implementation alone cannot block
archive/summary work. P plus A/Q, or P plus U/H, permits up to three active implementers. V needs
both A and Q. These are separate supervisor tasks because each owns a full behavior/proof seam;
default zero implementation subagents. The final session uses one fresh read-only `sup_review`.
All Codex work uses **GPT-6 Astra/high**. No coordinator session or idle observer is needed.

This graph is the approved scheduling direction, **not a claim that the future seams already
exist or peers can launch today**. C0 closes decision/ownership questions; each implementation
prerequisite must deliver working shared interfaces and prove peer independence before release.
If the proposed split cannot satisfy both merge orders, amend it before launching affected peers.

## Assignment and product ownership

| ID | Sole responsibility | Product/proof owner |
| --- | --- | --- |
| C0 | Inspect accepted T1; ratify approved contracts, settle open decisions, allocate exact files/tests/migrations and issue verified briefs | prerequisites.md; decisions.md |
| T | Database transaction history and existing exports; lossless ledger/outbox conversion and retirement; compatibility archive transaction section | timeline.md |
| C | Completion directly on workflow_runs; run_failures; retire terminal authorizations and terminal outbox safely | run-completion.md, all P1–P6 |
| F | Shared migrations, repository/transaction contracts, real composition seams, recovery, import/extraction, baseline domain modules and isolated fixtures | foundation.md; artifacts.md import/extraction proof; prerequisites.md |
| P | Provider-neutral requests, all-time/current usage and quota policy; no real key/provider integration | provider-usage.md, all P1–P6 |
| D | Live diagnostic resolution and remaining diagnostic UI/command behavior; no lessons/fixes machinery | diagnostics.md, all P1–P6 |
| G | Generated artifact publication/update lifecycle, file verification and existing XLSX exports | artifacts.md generated-output P4–P8 |
| S | Save/validate/activate app_settings + settings_snapshots for new runs without restart; preserve each existing run's configuration | decisions.md group 2 settings |
| L | Shared archive/version/summary lifecycle contracts, schemas, atomic mutation hooks, deletion/backup/source adapters and live API baseline | prerequisites.md; decisions.md groups 2–5 |
| A | version_changes and verified archive.sqlite/archive_records transfer, old archive conversion, deletion/recovery and no relaunch backend | decisions.md version/archive/deletion sections |
| Q | run_summaries derivation, incremental maintenance, rebuild, indexed queries and validated aggregate identity counts | decisions.md group 5 |
| V | Freeze working served APIs and shared UI wiring from accepted development A/Q candidates; remove remaining shared relaunch wiring | prerequisites.md |
| U | Queue/Activity consumers and exports through served queries; benchmark query count/latency with isolated fixtures | decisions.md group 5; timeline.md transaction metric boundary |
| H | Generic saved archive report list/detail/filter/download viewer; remove archive relaunch UI | decisions.md group 3 |
| 2.6.3 | Sole final integration/repair owner; required migration/recovery, full gates, fresh independent review; no repair handbacks | final-validation.md and parent phase Task 3 |

F owns approved removal of unused gates, ocr_approvals and SQL notes projections, and the
`dryrun_results` rename with all its consumers; it preserves actual approvals, logs and live-read
results. F completes diagnostic renames/retirements and evidence migration before D adds live
resolution behavior. Existing notifications remain durable; L/A own archive/delete link handling.
Only the existing two maintenance tables and unresolved historical relationships remain decisions,
not silent rename/removal assignments. C0 resolves their impact before issuing implementation briefs.

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

The operator launches assignments. Each prerequisite supervisor may assemble its named development
inputs in its own isolated candidate branch as part of its assigned work; this is not master
integration or acceptance. **2.6.3 is the single final integration and repair owner.** No peer has
permission to merge into master, dispatch siblings, restart T1, or push. Local master integration
still requires the operator's assignment after full gates and review. Progress/evidence belong to
the assigned file; no peer edits this shared index concurrently.

Compact handoff: ID, plan commit, base/head/tree, branch/worktree, exact changed paths and contract
versions, focused commands/exits/proof rows, unverified heavy rows and concrete remaining defects.
No repeated status polling. Continue unrelated owned work when blocked, then return the exact blocker.
Fix in-scope defects during implementation; after candidate handoff, remaining fixes belong to 2.6.3.
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
assignments currently **WAITING ON C0 and accepted T1**, then their explicit inputs in the graph.
The architecture graph is recorded now; executable file allocations and resolved launch prompts
are completed in C0 and checked at each release, not left for parallel peers to negotiate.

Final acceptance requires every retained product proof, required heavy gate, independent review,
review-finding repair, operator-assigned integration and exact cleanup/evidence. Development release
never sets a roadmap task to done. No live external submission or operator database upgrade is
included in this planning or candidate workflow.

## Planning verification — 2026-09-09

Planning was prepared on `58d4fbcba` and reconciled with `d61dc6fe6`, preserving that commit's
Phase 3 finalizer amendments and instruction twins. The specific database exception preserves the
operator's stronger request to defer prerequisite/peer reviews as well as heavy gates to 2.6.3.

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
