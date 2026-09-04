# Project profile — Phase 1.6

**Coordination UUID:** 858cc3dc-8536-4077-8049-34b76cc31baf
**Work key:** execute-phase-1-6-from
**Coordinator:** 01a06e8e-d1fc-7260-9fc7-cda1ea031a9a · local
**Integration checkout:** /Users/julianhein/Projects/hr-automation-rebuild · master
**Workspace:** /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/execute-phase-1-6-from-c858cc3dc
**Canonical title:** Coordinate · execute-phase-1-6-from · C858cc3dc · Phase 1.6
**Verified base:** 59c8bfb1d165ca83c7b7b470fab2ca60bd16fe1b (2026-09-04)

## Instructions and authorities
- Repository AGENTS.md / CLAUDE.md, byte-identical twins; nearest module instructions bind feature changes.
- Plan: docs/rebuild/01-build-the-spine.md §1.6, including the already-complete Task 1 and the approved hash-only parity repair. docs/roadmap/roadmap.md and its Governance own status and order. Generated index.html is regenerated, never hand edited.
- Contracts: docs/rebuild/reference/dashboard-surfaces.md D330/D332; clock-config-secrets.md D331/D332.S1–S6; guards-and-tests.md §5.2 adapter roster and guard lifecycle; frontend-backend-integration.md served-contract/parity obligations.
- Other relevant authorities: reference/lessons.md, charter.md, task-contract.md, workflow-model.md, execution-and-sessions.md, write-safety.md, stores.md. decisions.md is a pointer only.
- Close targets: doc 01 §1.6, roadmap + generated site, ref lessons for new lessons, nearest paired instruction files for changed features, docs/rebuild/02-prove-writes-build-the-tails.md §2.6 handoff. Reconcile only truth actually changed. No contract redesign is admitted.

## Gates
- Every run: `npm run typecheck && npm run lint && npm run test:coverage && npm run build:manifest:check` sequentially, with coverage isolated from compiler/linter contention.
- Additional proofs and deletion controls are exactly each immediate task's doc 01 binding; R01 records M3 open half, M9, M21 and M10 baseline over existing code.
- Parity must remain green without reference changes. Verify inherited repaired baseline with `npm run test:parity` before wave 2. No A8/UI changes admitted.
- Generated docs: `npm run roadmap && npm run roadmap:check`; applicable manifest/catalog regeneration plus checks; if tests run, lint is mandatory.
- Final R08 gate is Task 7's complete base/parity/catalog/architecture/doctor/T1b/adversarial gate, including exact zero write-authority deltas. Blocked live subjects are reported, never invented.

## Git, capacity, and roles
- Integration only here on master, verified before writes, merges and task calls. Local logical commits, explicit-path staging, no remote pushes. Coordinator owns all supervisor integration via `git merge --no-ff` and all board writes.
- Each supervisor gets a distinct managed worktree; capture returned actual path/ref before active. Canonical feature branches use the work key/C858cc3dc/run suffix where platform permits; platform-managed paths/refs take precedence.
- Total auxiliary-worktree budget 4. Initial inventory has one foreign worktree; count it but never inspect/adopt/change it. Wave cap 2. Serial run allowance 2 when available; wave 2 allowance R02=2, R03=1 while foreign slot remains, otherwise 2 each. Supervisors sequence supporting writers when their allowance is full; read-only workers need no auxiliary worktree.
- Supervisor gpt-6-astra/high; only native sup_scout, sup_analyst, sup_sol, sup_terra with matching names, clean contexts and generated unit envelopes. Supervisors own hard implementation; coordinator never implements or dispatches workers.
- Runtime enrollment UUID above is immutable. Supervisor task/host ids are recorded verbatim in this workspace's address book before communication. No foreign boards/tasks/reports are read or adopted.
- Worker rows must pass mark-worker-cleanup; supervisor rows require verified merge and gate, registered and physical worktree removal, branch deletion, mark-cleanup and exact task archival. Calling coordinator is retained.

## Operations and admission
- Live read-only and dryRun=true verification pre-authorized. Browser work uses playwright-cli with its reference and Duo Autopilot. Legacy production remains isolated.
- R07 owns stopped-system explicit backup then authority upgrade on the real root exactly as Task 6 admits; announce remove-list without leaking configuration values. Actual transactions/finalizations are excluded.
- Another Phase 1.6 worktree is present. Ownership clarification is pending before implementation wave dispatch; independent verification of already-merged Task 1 is safe.
- No workspace migration or authority adoption from another coordinator. This workspace stays retained at close.
