# DCC2 merge preview

Read-only checkout preview via `git merge-tree --write-tree --messages --name-only ac40292b8e3e8ff9b66242bbf8f8288554335f40 13175b13340fec7b5326207fe54f98078d481d7d`; exit 1 denotes conflicts in the synthetic Git tree. No checkout, branch, index or MERGE_HEAD was changed. This is not a completed merge.

```text
c766f73794f205df6abc978f88125e16ecf7b13f
AGENTS.md
docs/rebuild/04-close-the-deferrals.md
docs/rebuild/reference/clock-config-secrets.md
docs/rebuild/reference/dashboard-surfaces.md
docs/rebuild/reference/frontend-backend-integration.md
docs/roadmap/index.html
docs/roadmap/roadmap.md
src/domain/dashboard/bootstrap.ts
src/domain/dashboard/storage.ts
src/domain/preflight.ts
src/domain/runtime-dependencies.ts
src/infra/sqlite/authority-database.ts
src/infra/sqlite/authority-health-runner.ts
src/infra/sqlite/recovery-contracts.ts
src/infra/sqlite/storage-doctor.ts
src/server/dashboard/compose.ts
src/server/dashboard/queries/bootstrap.ts
src/server/dashboard/routes/api.ts
src/server/storage/compose.ts
tests/fixtures/preflight-seams.ts
tests/parity/helpers/seeded-bff.ts
tests/unit/architecture/storage-recovery.test.ts
tests/unit/architecture/strict-boundary-schemas.test.ts
tests/unit/preflight-runtime-dependencies.test.ts
tests/unit/server/bff-flow.test.ts
tests/unit/server/bootstrap-start-surface.test.ts
tests/unit/server/bootstrap-storage-arms.test.ts
tests/unit/server/compose-real-port.test.ts

Auto-merging AGENTS.md
CONFLICT (content): Merge conflict in AGENTS.md
Auto-merging docs/rebuild/04-close-the-deferrals.md
CONFLICT (content): Merge conflict in docs/rebuild/04-close-the-deferrals.md
Auto-merging docs/rebuild/reference/clock-config-secrets.md
CONFLICT (content): Merge conflict in docs/rebuild/reference/clock-config-secrets.md
Auto-merging docs/rebuild/reference/dashboard-surfaces.md
CONFLICT (content): Merge conflict in docs/rebuild/reference/dashboard-surfaces.md
Auto-merging docs/rebuild/reference/frontend-backend-integration.md
CONFLICT (content): Merge conflict in docs/rebuild/reference/frontend-backend-integration.md
Auto-merging docs/roadmap/index.html
CONFLICT (content): Merge conflict in docs/roadmap/index.html
Auto-merging docs/roadmap/roadmap.md
CONFLICT (content): Merge conflict in docs/roadmap/roadmap.md
Auto-merging src/dashboard/client/commands.ts
Auto-merging src/domain/dashboard/bootstrap.ts
CONFLICT (content): Merge conflict in src/domain/dashboard/bootstrap.ts
Auto-merging src/domain/dashboard/storage.ts
CONFLICT (content): Merge conflict in src/domain/dashboard/storage.ts
Auto-merging src/domain/preflight.ts
CONFLICT (content): Merge conflict in src/domain/preflight.ts
Auto-merging src/domain/runtime-dependencies.ts
CONFLICT (content): Merge conflict in src/domain/runtime-dependencies.ts
Auto-merging src/infra/sqlite/authority-database.ts
CONFLICT (content): Merge conflict in src/infra/sqlite/authority-database.ts
Auto-merging src/infra/sqlite/authority-health-runner.ts
CONFLICT (content): Merge conflict in src/infra/sqlite/authority-health-runner.ts
Auto-merging src/infra/sqlite/index.ts
Auto-merging src/infra/sqlite/recovery-contracts.ts
CONFLICT (content): Merge conflict in src/infra/sqlite/recovery-contracts.ts
Auto-merging src/infra/sqlite/storage-doctor.ts
CONFLICT (content): Merge conflict in src/infra/sqlite/storage-doctor.ts
Auto-merging src/server/dashboard/compose.ts
CONFLICT (content): Merge conflict in src/server/dashboard/compose.ts
Auto-merging src/server/dashboard/queries/bootstrap.ts
CONFLICT (content): Merge conflict in src/server/dashboard/queries/bootstrap.ts
Auto-merging src/server/dashboard/queries/storage.ts
Auto-merging src/server/dashboard/routes/api.ts
CONFLICT (content): Merge conflict in src/server/dashboard/routes/api.ts
Auto-merging src/server/storage/compose.ts
CONFLICT (content): Merge conflict in src/server/storage/compose.ts
Auto-merging tests/fixtures/preflight-seams.ts
CONFLICT (add/add): Merge conflict in tests/fixtures/preflight-seams.ts
Auto-merging tests/parity/helpers/seeded-bff.ts
CONFLICT (content): Merge conflict in tests/parity/helpers/seeded-bff.ts
Auto-merging tests/unit/architecture/helpers/redaction-surface-audit.ts
Auto-merging tests/unit/architecture/provider-capability-boundary.test.ts
Auto-merging tests/unit/architecture/storage-recovery.test.ts
CONFLICT (content): Merge conflict in tests/unit/architecture/storage-recovery.test.ts
Auto-merging tests/unit/architecture/strict-boundary-schemas.test.ts
CONFLICT (content): Merge conflict in tests/unit/architecture/strict-boundary-schemas.test.ts
Auto-merging tests/unit/preflight-runtime-dependencies.test.ts
CONFLICT (content): Merge conflict in tests/unit/preflight-runtime-dependencies.test.ts
Auto-merging tests/unit/server/bff-flow.test.ts
CONFLICT (content): Merge conflict in tests/unit/server/bff-flow.test.ts
Auto-merging tests/unit/server/bootstrap-start-surface.test.ts
CONFLICT (content): Merge conflict in tests/unit/server/bootstrap-start-surface.test.ts
Auto-merging tests/unit/server/bootstrap-storage-arms.test.ts
CONFLICT (content): Merge conflict in tests/unit/server/bootstrap-storage-arms.test.ts
Auto-merging tests/unit/server/capture-surface.test.ts
Auto-merging tests/unit/server/compose-real-port.test.ts
CONFLICT (content): Merge conflict in tests/unit/server/compose-real-port.test.ts

```

