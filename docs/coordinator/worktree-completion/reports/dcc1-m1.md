# DCC1 m1 — unique-history inventory

Read-only native `sup_scout` return verified by supervisor on 2026-08-30. Assigned tree: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`; HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`; frozen baseline `13175b13340fec7b5326207fe54f98078d481d7d`.

61 unique commits. Existing integrated control plane `a9b5395f` includes independent Settings merge `073cd396`. Alternate authority: `src/infra/config/settings-file.ts`; integrated authority: `src/server/settings/settings-file-service.ts`. Inventory is not evidence of equivalence; m2 owns invariant disposition.

Buckets: domain config; settings-file integrity/atomic apply; SQLite command/current/runtime identities; kernel/worker admission; bootstrap and trusted single/bulk ingress; capture handoff; generated manifest; regression/architecture/transport/parity tests. The frozen baseline still contains phone capture and its owning contract (`git ls-tree -r --name-only 13175b13 src`); R-DCT retirement is separately planned, not implemented at this baseline. Preserve existing capture behavior and its Settings generation fence; do not execute the later retirement in this assignment.

## Exact inventory

Commands: `git merge-base 13175b13 HEAD`; `git log --reverse --format='%h %s' 13175b13..HEAD`; `git diff --name-status 80da3815..HEAD`.

```text
80da38158dea35f781eb69d5e682a779935f9c96
1ff252a0 feat(config): persist strict settings authority
dd8986ea test(config): prove settings failure recovery
214f9ee7 feat(commands): activate apply-settings
ab3fced4 docs: record settings authority recovery lesson
d058b432 fix(config): bind settings revision evidence
bffb2ccb fix(config): harden settings authority
0e3b4e64 docs: harden settings authority lesson
5fa3699c chore(config): ignore local settings authority
542bef11 fix(config): serialize settings lock recovery
b70fa9bd docs: record settings reaper invariant
87059d01 fix(config): bound persisted settings bytes
b11ba0e2 fix(config): recover dead settings reapers
de18675f docs: record settings recovery bounds
4c1db1e7 fix(worker): resolve persisted settings at boot
ada6c296 fix(config): make settings rollback crash-distinguishable
178fb298 docs: record settings boot and rollback invariants
d1ab4ad6 fix(config): hash rollback bytes without type drift
0cea92b3 fix(settings): refuse unjournaled worker boot
8fe7b483 fix(settings): refuse unjournaled dashboard boot
3d66fc88 fix(worker): fence claims by boot config identity
dcb72bfd fix(worker): fence claims to dashboard config generation
207caf18 docs: record runtime config claim fence
5b3cfdd7 test(architecture): permit settings journal verification
f993156f fix(config): durably prepare settings replacements
4cd829f2 fix(config): reconcile interrupted settings prepare
7c785010 fix(settings): persist canonical current result
900781e7 fix(settings): reconcile boot against canonical state
3153d1f3 docs(settings): record exact boot reconciliation
7459cb4d fix(settings): reconcile exact command replays
f0eb5459 fix(settings): require restart-specific command results
73c8879e fix(settings): fence stale dashboard planning
a323d730 fix(settings): fence stale dashboard starts
ad758b3c fix(settings): fence stale worker starts
3ff1190d fix(settings): fence stale async worker starts
ae097f05 fix(settings): fence stale intake fan-out
4eef5a1b fix(settings): fence stale retry fan-out
620c48f9 fix(settings): fence stale archive relaunches
5a3ca408 fix(settings): recheck worker starts after effects
12c6c72c test(settings): pin replay and restart recovery
97728871 test(settings): wire active BFF settings authority
4ba28ef8 docs(settings): record replay and restart fence
79c98563 test(settings): type fixture restart fences
d9fdc548 fix(settings): fence capture handoff fan-out
ff79bae4 fix(settings): fence claims on durable settings epoch
f8e92e7f perf(settings): remove filesystem lock from worker polls
5e0f993a test(settings): pin apply crossing worker claim
bf41d273 docs(settings): record durable worker epoch fence
c6ce5251 fix(settings): preserve failure inspection evidence
f7cb195a refactor(settings): name transaction settlement explicitly
b5493899 test(authority): pin settings migration digests
71005014 fix(settings): serve editable schema authority hash
36ce51f7 docs(settings): record absence and schema authorities
ae2b8300 docs(settings): reconcile apply authority status
1a6afeec test(settings): bind restart plan to persisted config
e7281f45 test(settings): pin schema refusal zero effects
4a82c202 test(settings): pin wrong revision rollback
bc4c9ee2 test(settings): pin runtime identity conjunctions
3d7045fd fix(dashboard): secure command mutation ingress
5793c0aa docs(settings): record trusted command ingress lesson
7df674b8 fix(dashboard): preserve command ingress HTTP errors
0c115123 fix(commands): bind bulk replay to durable parent
M	.gitignore
M	AGENTS.md
M	docs/rebuild/01-build-the-spine.md
M	docs/rebuild/02-prove-writes-build-the-tails.md
M	docs/rebuild/03a-finish-the-dashboard.md
M	docs/rebuild/03c-migrate-the-remaining-workflows.md
M	docs/rebuild/03d-co-operate-with-claude.md
M	docs/rebuild/04-close-the-deferrals.md
M	docs/rebuild/reference/clock-config-secrets.md
M	docs/rebuild/reference/dashboard-surfaces.md
M	docs/rebuild/reference/decisions.md
M	docs/rebuild/reference/frontend-backend-integration.md
M	docs/rebuild/reference/operator-trust.md
M	docs/roadmap/index.html
M	src/core/capture-intake-handoff.ts
M	src/core/command-kernel.ts
M	src/core/worker-loop.ts
M	src/dashboard/client/transport.ts
M	src/domain/authority.ts
M	src/domain/commands.ts
M	src/domain/config/resolve.ts
A	src/domain/config/runtime-generation.ts
M	src/domain/config/schema.ts
A	src/domain/config/settings-current.ts
A	src/domain/config/settings.ts
M	src/domain/workflow/generated-build-manifest.ts
A	src/infra/config/settings-file.ts
M	src/infra/sqlite/authority-database.ts
M	src/infra/sqlite/migrations.ts
M	src/infra/sqlite/run-store-contracts.ts
M	src/infra/sqlite/storage-records.ts
M	src/server/dashboard/commands/command-service.ts
A	src/server/dashboard/commands/operator-command-ingress.ts
A	src/server/dashboard/commands/settings-service.ts
M	src/server/dashboard/commands/start-plan-service.ts
M	src/server/dashboard/compose.ts
M	src/server/dashboard/routes/api.ts
A	src/server/dashboard/routes/operator-mutation-ingress.ts
A	src/server/settings-runtime.ts
M	src/server/worker/compose.ts
M	tests/parity/helpers/seeded-bff.ts
M	tests/unit/architecture/control-command-single-path.test.ts
M	tests/unit/architecture/migration-history-immutability.test.ts
M	tests/unit/architecture/strict-boundary-schemas.test.ts
M	tests/unit/command-kernel.test.ts
M	tests/unit/config.test.ts
M	tests/unit/dashboard/client-transport.test.ts
A	tests/unit/fixtures/settings-runtime-corruption-fixtures.ts
M	tests/unit/run-authority.test.ts
M	tests/unit/server/bff-flow.test.ts
M	tests/unit/server/capture-surface.test.ts
M	tests/unit/server/compose-real-port.test.ts
M	tests/unit/server/worker-pool-composition.test.ts
M	tests/unit/server/worker-pool-parallel-proof.test.ts
M	tests/unit/sqlite-authority-database.test.ts
M	tests/unit/worker-composition.test.ts

```

## Intake evidence

Expected branch and HEAD verified; clean tracked/untracked state, only ignored `node_modules/`. `npm run typecheck && npm run lint`: exit 0. `env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/settings-facts.test.ts tests/unit/command-kernel.test.ts`: exit 0, 2 files / 52 tests passed. No source edits or live runs.

Native naming limitation: tool has `agent_type` but no `task_name`; exact `sup_scout_dcc1_m1` prefix supplied in prompt. Coordinator explicitly approved recording this limitation and continuing. Board read-only; no board writes.

Additional intake gates: `npm run build:manifest:check` passed (manifest current). `npm run roadmap:check` failed at `scripts/generate-roadmap.ts:1102`: `docs/roadmap/index.html is stale — run npm run roadmap and commit the result`. This is pre-existing at the intake head; regenerate after reconciliation. No generated file changed during intake.
