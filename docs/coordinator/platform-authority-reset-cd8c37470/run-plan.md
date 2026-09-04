# Run plan — Phase 0.3 authority design — 2026-09-03

**Coordination UUID:** `d8c37470-550f-4093-80dd-139763304d77`
**Coordinator owner/channel:** `01a06ade-e8da-7f91-9e45-bf1fcc12175a` / `local`
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`

| Run | Canonical supervisor title | Roadmap task | Theme | Base | Integration order | Parallel-ready | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|---|
| R01 | Supervisor · platform-authority-reset · Cd8c37470 · R01 · run-authority-design | 0.3 Task 1 | Canonical run lifecycle contract | planning commit | 1 | yes, only with R02 after isolation | — | owning-spec contract, decision reconciliation, adversarial report |
| R02 | Supervisor · platform-authority-reset · Cd8c37470 · R02 · settings-authority-design | 0.3 Task 2 | Settings/source/security catalog | planning commit | 2 | yes, only with R01 after isolation | — | complete leaf/source catalog, security contract, adversarial report |
| R03 | Supervisor · platform-authority-reset · Cd8c37470 · R03 · migration-recovery-design | 0.3 Task 3 | Upgrade/recovery/deletion tests | R01+R02 integrated | 3 | no | R01 · R02 | migration state machine, D322 backup boundary, adapter deletion plan |
| R04 | Supervisor · platform-authority-reset · Cd8c37470 · R04 · authority-design-close | 0.3 Task 4 | Consequential review and briefs | R03 integrated | 4 | no | R03 | all decisions resolved, 1.6 task briefs/gates, 2.6/3.1 handoff contracts |

## R01 / Task 1 — canonical run-record authority

- Own stable identity, lifecycle states/revisions, typed CRUD/CAS, ordering/first-eligible claim,
  retry/relaunch/archive/purge, tree semantics, and D308 terminal-only deletion/tombstones.
- Preserve spans/logs/receipts/failures/captures/artifacts as append-only linked evidence, never a
  competing lifecycle source.
- Produce exact repository/service boundaries, invariants, failure modes, property tests, migration
  requirements, and deletion tests. Do not implement code.

## R02 / Task 2 — canonical settings catalog and protected root

- Inventory every current setting/source/consumer and classify ordinary configuration, credentials,
  provider API keys, local canary/test inputs, derived host facts, and runtime snapshots.
- Define one active authority per class, the protected `.tracker/settings/` structure, revision/CAS,
  write-only secret behavior, permissions/redaction, restart scope, and UI contract.
- Reconcile D321's old layout, D324's derived display default, and secure bootstrap. Do not implement.

## R03 / Task 3 — migration, compatibility, and recovery

- Design an idempotent upgrade with explicit D322 `cli storage backup` prerequisite, transactional
  journal/rollback, mixed-generation refusal, stable historical identities, and no evidence rewrite.
- Define one-time imports, ambiguous-duplicate refusals, read-forward rules, temporary adapters,
  their expiry, and red-capable deletion tests.
- Prove the run/settings migrations compose without sharing a hidden second authority.

## R04 / Task 4 — design close and implementation briefs

- Adversarially review concurrency, idempotence, deletion, write-safety, recovery, permissions,
  redaction, secret exposure, source precedence, and failure reporting.
- Resolve all open decisions in owning specs and the decision index.
- Issue one exact brief/gate per 1.6 task; bind 2.6 downstream-only scope and 3.1 consumption/acceptance
  scope. Any failed review opens a focused design task; R04 does not absorb repairs.

## Integration and close

- R01/R02 may run concurrently only after the coordinator records separate worktrees, files/scopes,
  gates, and integration order; otherwise run sequentially.
- Each supervisor report is verified against the roadmap, owning specs, D308/D321/D322/D324/D327,
  and its declared red-capable evidence before integration.
- Phase 0.3 closes only after R04 and the planning/document gates are green. Then the coordinator
  issues Phase 1.6; no runtime implementation begins earlier.
