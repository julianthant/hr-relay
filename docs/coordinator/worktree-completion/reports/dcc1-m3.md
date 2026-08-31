# sup_sol_dcc1_m3 — Settings reconciliation candidate

Status: FROZEN PARTIAL CANDIDATE — static reconciliation staged; NOT gated, NOT ready, NOT task completion. Frozen at coordinator request during RESOURCE HOLD. Light gates were released immediately after freeze; coordinator requested return without redundant new gates, so verification transfers to the parent. No merge commit.
Role: sup_sol_dcc1_m3; native sup_sol, high reasoning. No nested scouts or execution agents.

## Frozen inputs and scope

- Workdir for every command/edit: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
- Alternate A: `0c115123a738f62cbe01c9b45f53b7289284479c`, branch `feature/r-dcc-dcc1-exclusive`.
- Frozen integrated B: `13175b13340fec7b5326207fe54f98078d481d7d`.
- Common ancestor: `80da38158dea35f781eb69d5e682a779935f9c96`; 61 alternate-only commits, inventoried in supervisor-owned [m1](dcc1-m1.md).
- [Accepted m2](dcc1-m2.md) is binding. Its branch-local v18 observation is NOT a global collision-free claim; later coordinator migration instructions supersede that wording.
- Approved merge: `git merge --no-ff --no-commit 13175b13340fec7b5326207fe54f98078d481d7d`. 28 conflict paths; 97 non-generated hunks mapped below, plus generated manifest/roadmap.
- No live authority/workflow, migration conversion, other checkout edit, authored board change, commit, remote push, reset/abort/skip/clean, new worktree/task or subagent.
- Skills: worktree-sweep conflict arm; handoff for the requested partial freeze; ui for minimum wire-consumer compatibility (no visual redesign); tdd tests mode for assigned regression seams. Supervise brief read; execution role did not dispatch. All required local AGENTS, profile, brief, lessons and applicable references read.

## Primary-source intent map

A's source sequence is m1's immutable inventory: file hardening `1ff252a0..b11ba0e2`, boot/generation `4c1db1e7..dcb72bfd`, prepare/current/replay `f993156f..f0eb5459`, admission `73c8879e..bf41d273`, closed schema `71005014`, corruption tests `bc4c9ee2`, trusted ingress/bulk `3d7045fd..0c115123`. B includes independent Settings integration `073cd396` and control plane `a9b5395f`, followed by the existing DCC2/DCC3/Explorer interfaces at frozen B. The exact primary source for each row is `git show A:<path>` and `git show B:<path>`; hunk numbers/lines below refer to the original conflicted working file, not shifted final line numbers.

| Path | A primary intent | B primary intent |
|---|---|---|
| `.gitignore` | Private Settings evidence/lock/staging exclusions | Ignore persisted Settings file |
| `AGENTS.md` | Hardened file/current/runtime/ingress lessons | Completed editor, Explorer and storage lessons |
| `docs/rebuild/03a-finish-the-dashboard.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `docs/rebuild/03c-migrate-the-remaining-workflows.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `docs/rebuild/04-close-the-deferrals.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `docs/rebuild/reference/clock-config-secrets.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `docs/rebuild/reference/dashboard-surfaces.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `docs/rebuild/reference/frontend-backend-integration.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `docs/rebuild/reference/operator-trust.md` | Alternate Settings authority completion and its operational guarantees | Later completed DCC2/DCC3/editor/preflight/Explorer and bounded deferrals |
| `src/core/command-kernel.ts` | Compensated Settings application, exact current/journal/audit and SQLite admission fences | Active Settings, ambiguity recovery and Explorer post-commit finalization |
| `src/core/worker-loop.ts` | Typed boot config/epoch-aware claims | Composed claim-admission hook |
| `src/domain/commands.ts` | Exact Settings revision/fingerprint/restart results | Active Settings arm and baseline restart marker |
| `src/domain/config/resolve.ts` | Browser settings resolved with all existing groups | Compiler-exhaustive resolver group ownership |
| `src/domain/config/settings.ts` | Closed editable schema, lastApplied, compensation/replay identities | Broad resolver-based envelope plus editor runtime status wire |
| `src/infra/sqlite/authority-database.ts` | Atomic boot/runtime/current/snapshot claim conjunction | Queued claim config-fingerprint check |
| `src/infra/sqlite/run-store-contracts.ts` | Paired runtime token and config fingerprint schema | Optional composed claim fingerprint |
| `src/server/dashboard/compose.ts` | Hardened file + journaled boot, snapshot activation and trusted ingress | Editor/preflight readbacks, Explorer service, resource closure |
| `src/server/dashboard/routes/api.ts` | JSON/Origin admission before body parse | Settings/editor/preflight and existing route contracts |
| `src/server/worker/compose.ts` | Journaled boot and SQLite-only steady claim admission | File-based generation admission and boot resource closure |
| `tests/parity/helpers/seeded-bff.ts` | Trusted command/bulk acceptance fixture | Healthy preflight fixture |
| `tests/unit/architecture/control-command-single-path.test.ts` | Active Settings guard fixture | Active Explorer guard fixture |
| `tests/unit/command-kernel.test.ts` | Exact current-result, compensated rollback/replay and stale-epoch tests | Baseline Settings failure invariants plus Explorer tests |
| `tests/unit/config.test.ts` | Adversarial hardened file/replay/rollback tests | Every resolver group, including browser, consumed |
| `tests/unit/server/bff-flow.test.ts` | Single/bulk ingress and Settings zero-effect rejection | Editor/preflight readbacks and existing BFF features |
| `tests/unit/server/compose-real-port.test.ts` | Real crash, journal conjunction and restart-plan proof | Editor persisted/active readback through restart |
| `tests/unit/worker-composition.test.ts` | Exact snapshots, no polling file locks, corrupt boot and epoch crossing | Stale boot/claim and no-browser/resource-closure proof |

## Hunk-by-hunk resolution

Every hunk combines the primary intents above by accepted m2. Neither side was taken wholesale; conflicting implementation owners are explicitly disposed of below.

| Path · original hunk/line | Resolution and surviving invariant |
|---|---|
| `.gitignore` · H1/L30 | Private file, initialization, rollback, lock and staging exclusions retained; subsumes B file-only ignore. |
| `src/domain/config/resolve.ts` · H1/L340 | Both exhaustive groups incl browser; use B extracted groups binding. |
| `src/domain/commands.ts` · H1/L407 | Exact restart/revision/fingerprint result supersedes B restart-only. |
| `src/domain/config/settings.ts` · H1/L3 | Closed editable schema and exact lastApplied envelope replace broad SettingsOverride envelope. |
| `src/domain/config/settings.ts` · H2/L156 | A apply/refusal/baseline plus B read-only runtime identity/status contract. |
| `src/domain/config/settings.ts` · H3/L253 | Closed sparse merge retained; remove broad persistence type export. |
| `src/core/command-kernel.ts` · H1/L65 | Full-envelope fingerprint and Explorer audit type. |
| `src/core/command-kernel.ts` · H2/L167 | Both active Settings; literal empty deferred list. |
| `src/core/command-kernel.ts` · H3/L230 | Export selected executor's SettingsCommand. |
| `src/core/command-kernel.ts` · H4/L270 | Compensated file application outcome replaces restart-only/reconcile outcomes. |
| `src/core/command-kernel.ts` · H5/L306 | Exact replay via settings_current replaces independent journal adapter. |
| `src/core/command-kernel.ts` · H6/L604 | Settings rollback/commit/current plus Explorer finalizeAfterCommit. |
| `src/core/command-kernel.ts` · H7/L676 | Exact Settings result fields include restart marker. |
| `src/core/command-kernel.ts` · H8/L3248 | Full command executor plus compensating invalid-revision refusal. |
| `src/core/command-kernel.ts` · H9/L3326 | Settings current result plus Explorer executor; SQLite fences replace file-status admission. |
| `src/core/command-kernel.ts` · H10/L3552 | Replay carries verified revision/fingerprint. |
| `src/core/command-kernel.ts` · H11/L3614 | Compensation locals plus Explorer finalizer. |
| `src/core/command-kernel.ts` · H12/L3642 | Replay exact reconciliation; dispatch SQLite fences replace runtime-file check. |
| `src/core/command-kernel.ts` · H13/L3660 | Current/journal/audit one transaction plus Explorer post-commit finalizer. |
| `src/infra/sqlite/authority-database.ts` · H1/L4810 | Exact retained snapshot + boot token includes B fingerprint check. |
| `src/infra/sqlite/run-store-contracts.ts` · H1/L53 | Paired config/runtime token refinement supersedes optional fingerprint-only. |
| `src/core/worker-loop.ts` · H1/L143 | Typed claim plus config token. |
| `src/core/worker-loop.ts` · H2/L297 | Request construction matches selected claim callback. |
| `src/server/dashboard/compose.ts` · H1/L67 | Remove broad hash and obsolete file-runtime identity imports. |
| `src/server/dashboard/compose.ts` · H2/L116 | Settings executor plus newer Explorer service/store. |
| `src/server/dashboard/compose.ts` · H3/L557 | Hardened file authority. |
| `src/server/dashboard/compose.ts` · H4/L1222 | Closed hash plus preflight report. |
| `src/server/dashboard/routes/api.ts` · H1/L46 | Trusted mutation ingress plus preflight type. |
| `src/server/worker/compose.ts` · H1/L410 | Hardened authority and test hooks. |
| `src/server/worker/compose.ts` · H2/L461 | Journaled SQLite boot inside B resource-close-on-refusal. |
| `src/server/worker/compose.ts` · H3/L791 | One SQLite claim transaction; no filesystem polling. |
| `tests/unit/config.test.ts` · H1/L2 | Full authority operations imports include B temp-root needs. |
| `tests/unit/config.test.ts` · H2/L34 | Selected closed hash, full command fingerprint and hardened authority fixture. |
| `tests/unit/config.test.ts` · H3/L175 | Retain all hardened authority tests and B every-resolver-group coverage. |
| `tests/unit/config.test.ts` · H4/L821 | Exact restart/bytes test on selected writer; resolver still tests env precedence separately. |
| `tests/unit/config.test.ts` · H5/L887 | Retain staging, failed inspection and malformed-file cases. |
| `tests/unit/command-kernel.test.ts` · H1/L11 | Union fs imports incl B Explorer readback. |
| `tests/unit/command-kernel.test.ts` · H2/L30 | Selected Settings imports plus B Explorer types/schemas. |
| `tests/unit/command-kernel.test.ts` · H3/L183 | Keep Settings effect tracking and Explorer calls. |
| `tests/unit/command-kernel.test.ts` · H4/L235 | Selected Settings override plus baseline Explorer options and transaction seam. |
| `tests/unit/command-kernel.test.ts` · H5/L262 | Selected compensated fake Settings plus Explorer tracking. |
| `tests/unit/command-kernel.test.ts` · H6/L333 | Selected executor methods/compensation/result. |
| `tests/unit/command-kernel.test.ts` · H7/L364 | Both independent family observations. |
| `tests/unit/command-kernel.test.ts` · H8/L543 | Actual settings_current stale fence instead of mocked legacy status; pre-restart config mismatch pinned in composed test. |
| `tests/unit/command-kernel.test.ts` · H9/L1644 | Equivalent deferred-list typing. |
| `tests/unit/command-kernel.test.ts` · H10/L1705 | Real exact cleanup replay; B corrupt audit checks survive corruption fixture matrix. |
| `tests/unit/command-kernel.test.ts` · H11/L1742 | Real cleanup test + selected multi-leaf; B tests old writer removed after equivalent mapping. |
| `tests/unit/command-kernel.test.ts` · H12/L1853 | Closed hash and computed patch digest. |
| `tests/unit/command-kernel.test.ts` · H13/L1869 | Exact result and commit callbacks. |
| `tests/unit/command-kernel.test.ts` · H14/L1882 | Current singleton and wrong-revision rollback; B stale/audit tests map to BFF/config and A rollback tests. Ambiguous transaction return retained separately. |
| `tests/unit/command-kernel.test.ts` · H15/L2050 | Closed hash. |
| `tests/unit/command-kernel.test.ts` · H16/L2060 | Invalid revision and audit rollback evidence; B postcommit test migrated separately. |
| `tests/unit/command-kernel.test.ts` · H17/L2149 | Current-result failure rollback; schema drift zero-effects retained in BFF and config. |
| `tests/unit/worker-composition.test.ts` · H1/L24 | Selected full-envelope/file authority imports. |
| `tests/unit/worker-composition.test.ts` · H2/L110 | Real config snapshot + runtime generation seed. |
| `tests/unit/worker-composition.test.ts` · H3/L396 | Keep zero polling locks and unjournaled boot refusal; B's mixed-generation process-record release assertion is still a proof-transfer TODO (see exact remaining work). |
| `tests/unit/worker-composition.test.ts` · H4/L476 | Keep corruption matrix, persisted session timeout, old queued refusal and crossing current epoch; B claims mapped to real SQLite tests. |
| `tests/unit/server/compose-real-port.test.ts` · H1/L9 | All crash-proof fs/child imports. |
| `tests/unit/server/compose-real-port.test.ts` · H2/L29 | Selected authority imports. |
| `tests/unit/server/compose-real-port.test.ts` · H3/L192 | Keep alternate crash/restart proof and baseline editor readback/restart integration; latter moved off obsolete generation file. |
| `tests/unit/server/bff-flow.test.ts` · H1/L25 | Closed schema plus baseline readback helpers/preflight. |
| `tests/unit/server/bff-flow.test.ts` · H2/L43 | Kernel and hardened authority; remove obsolete journal factory. |
| `tests/unit/server/bff-flow.test.ts` · H3/L227 | Real selected Settings executor. |
| `tests/unit/server/bff-flow.test.ts` · H4/L824 | Keep exact zero-effects schema refusal; actual apply covered separately incl editor. |
| `tests/parity/helpers/seeded-bff.ts` · H1/L878 | Seed trusted journal/bulk parent plus preflight. |
| `tests/unit/architecture/control-command-single-path.test.ts` · H1/L99 | Equivalent active Settings empty deferred arm. |
| `tests/unit/architecture/control-command-single-path.test.ts` · H2/L172 | Both Settings and Explorer typed refusal seams. |
| `AGENTS.md` · H1/L389 | Retain hardened Settings lesson and newer Explorer/storage lessons; remove duplicate obsolete Settings engine explanation. |
| `docs/rebuild/03a-finish-the-dashboard.md` · H1/L112 | Preserve DCC3 completed editor/preflight. |
| `docs/rebuild/03c-migrate-the-remaining-workflows.md` · H1/L296 | Preserve baseline DCC1–DCC3 subset completion and named broader deferrals. |
| `docs/rebuild/03c-migrate-the-remaining-workflows.md` · H2/L974 | Preserve baseline DCC1–DCC3 subset completion and named broader deferrals. |
| `docs/rebuild/03c-migrate-the-remaining-workflows.md` · H3/L984 | Preserve baseline DCC1–DCC3 subset completion and named broader deferrals. |
| `docs/rebuild/04-close-the-deferrals.md` · H1/L16 | Preserve later Settings/Explorer completion; authority specifics amended below. |
| `docs/rebuild/04-close-the-deferrals.md` · H2/L61 | Preserve later Settings/Explorer completion; authority specifics amended below. |
| `docs/rebuild/04-close-the-deferrals.md` · H3/L299 | Preserve later Settings/Explorer completion; authority specifics amended below. |
| `docs/rebuild/04-close-the-deferrals.md` · H4/L349 | Preserve later Settings/Explorer completion; authority specifics amended below. |
| `docs/rebuild/04-close-the-deferrals.md` · H5/L551 | Preserve later Settings/Explorer completion; authority specifics amended below. |
| `docs/rebuild/04-close-the-deferrals.md` · H6/L583 | Preserve later Settings/Explorer completion; authority specifics amended below. |
| `docs/rebuild/reference/clock-config-secrets.md` · H1/L105 | Keep exhaustive resolver and producer completion. |
| `docs/rebuild/reference/clock-config-secrets.md` · H2/L219 | Retain hardened backend detail; replace false editor/preflight deferral with baseline completion. |
| `docs/rebuild/reference/clock-config-secrets.md` · H3/L400 | Selected hardened owner; retain baseline editor; precise reportsDir carveout; no invented state migration. |
| `docs/rebuild/reference/clock-config-secrets.md` · H4/L1149 | Retain editable boundary, candidate validation and exact restart provenance plus B compiler exhaustiveness. |
| `docs/rebuild/reference/clock-config-secrets.md` · H5/L1217 | Fiscal dates remain excluded; baseline editor exists for other leaves. |
| `docs/rebuild/reference/dashboard-surfaces.md` · H1/L1169 | Active registry completion; augment exact result/current identity. |
| `docs/rebuild/reference/dashboard-surfaces.md` · H2/L1200 | Preserve baseline editor completion/doctor and broader-scope boundary. |
| `docs/rebuild/reference/dashboard-surfaces.md` · H3/L1448 | Preserve baseline editor completion/doctor and broader-scope boundary. |
| `docs/rebuild/reference/dashboard-surfaces.md` · H4/L4534 | Preserve baseline editor completion/doctor and broader-scope boundary. |
| `docs/rebuild/reference/dashboard-surfaces.md` · H5/L4555 | Preserve baseline editor completion/doctor and broader-scope boundary. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H1/L151 | Preserve bounded UI/preflight completion. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H2/L598 | Exact backend results/fences plus baseline UI completion. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H3/L675 | Preserve baseline Settings/preflight/Explorer completion and explicit residue. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H4/L814 | Preserve baseline Settings/preflight/Explorer completion and explicit residue. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H5/L947 | Preserve baseline Settings/preflight/Explorer completion and explicit residue. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H6/L970 | Preserve baseline Settings/preflight/Explorer completion and explicit residue. |
| `docs/rebuild/reference/frontend-backend-integration.md` · H7/L1636 | Preserve baseline Settings/preflight/Explorer completion and explicit residue. |
| `docs/rebuild/reference/operator-trust.md` · H1/L2364 | Preserve DCC1–DCC3 subset closure; do not claim future workflow preflight/test-login. |
| `docs/rebuild/reference/operator-trust.md` · H2/L2473 | Preserve DCC1–DCC3 subset closure; do not claim future workflow preflight/test-login. |

| `src/domain/workflow/generated-build-manifest.ts` · all 11 fingerprint hunks | Neither historical fingerprint is authoritative after reconciliation. Regenerate from final descriptor source closure with `npm run build:manifest`. |
| `docs/roadmap/index.html` · generated conflict | Neither generated snapshot wins. Preserve baseline completion sources, reconcile authority prose, then `npm run roadmap`. |

## Single surviving authority and compatibility

- The only Settings writer is `src/infra/config/settings-file.ts`; `settings-service.ts` is its command adapter and `server/settings-runtime.ts` owns journal/current verification and the editor's read adapter. SQLite owns `settings_current`, `runtime_config`, exact command/audit and bulk parent acceptance. No second generation file or file engine remains.
- Keep all alternate backend admitted arms; add exactly `ocr.pageConcurrency`, `ocr.maxValidationRetries`, `concurrency.defaultWorkers`, `paths.reportsDir`. The reports directory is the sole admitted path. Credential/auth/runtime-state/artifact/profile paths remain excluded. The broader resolver schema is unchanged.
- Baseline runtime-status wire and the eight-leaf editor survive. `CURRENT_SETTINGS_SCHEMA_HASH` is a compatibility alias of the one closed hash, not another authority. The query consumes a structural read-only reader; it does not know a second persistence implementation.
- Exact old broad-schema and missing-lastApplied envelopes refuse; fixtures verify bytes are unchanged. No old-format conversion is invented.
- Explorer finalization/preflight, the newer baseline features, and existing capture are retained. Capture's alternate current-epoch handoff fence remains intact. No capture retirement.
- Additional baseline invariants ported in code but UNVERIFIED: ambiguous post-COMMIT Settings outcome, pre-replace concurrent-byte refusal; neither is the separate directory-integrity security fix.

## Obsolete owner/test disposition

Removed files are recoverable exactly from frozen B; no operator data is removed.

| Retired baseline owner/test | Original invariant | Surviving owner/proof |
|---|---|---|
| `src/server/settings/settings-file-service.ts` | File CAS, strict record, candidate validation, atomic stage/replace, journal recovery | Hardened infra writer + settings-runtime verifier + kernel; config and composed runtime suites |
| `src/server/settings/settings-runtime-generation.ts` | Persisted versus active generation, stale-worker refusal | SQLite runtime_config/settings_current, runtime-status reader, composed boot/claim gates |
| `tests/unit/settings-process-loss.test.ts`: prepare before replacement | No committed bytes when live rename never starts | compose-real-port: clears durable prepare before live rename |
| same: live replacement before journal | Restore exact prior when no commit | compose-real-port: rolls back prepared rename; config: exact prior recovery |
| same: concurrent worker | No unjournaled in-flight observation | config: holds exclusive authority until settlement; composed worker boot refusal |
| same: committed exact next | Keep next only with exact journal evidence | compose-real-port: command/audit/current exact prepared recovery |
| same: foreign command and inconsistent audit | Refuse without erasing ambiguous evidence | retained SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS fixture matrix in compose/worker tests (partial-presence gap explicitly OPEN below) |
| `tests/unit/settings-runtime-generation.test.ts`: pending/current split | Apply does not activate running process; restart does | preserved compose-real-port editor readback/restart test, now querying temp SQLite instead of obsolete JSON |
| same: malformed activation | Never adopt corrupt generation | SQLite strict runtime token/config snapshot and retained runtime-corruption suite |
| `tests/unit/settings-file-service.test.ts` | Ten baseline file invariants | File retained and ported to the sole infra writer. Annual dates stay excluded; nested URL test uses already-admitted leaves. Post-rename directory-fsync uncertainty retains lock/prepare and refuses, per accepted hardened protocol, rather than falsely declaring rollback complete. |
| Baseline kernel duplicate Settings tests | CAS/schema, audit rollback, cleanup, full journal identity | Alternate kernel/config/BFF tests and runtime corruption matrix; unique ambiguous-commit case explicitly retained |

## Integration residue — OPEN, not waived

1. All DCC1 suffix versions collide with separate completion returns. No migration bytes/digests changed. See supervisor-owned [dcc1-migrations.md](dcc1-migrations.md).

| Version | Actual owned table/trigger names (migration objects have no separate name field) | Pinned framed SHA-256 |
|---|---|---|
| 19 | runtime_config; runtime_config_never_deleted; runtime_config_generation_advances | f10c15c58161cf658eb6526c8b3994ef72b0d85473389114eebb4d54651429d5 |
| 20 | settings_current; settings_current_never_deleted; settings_current_revision_advances | 29bbfab1ce3efdc17ac7f5943f6681b2af4604baaf0a5c91c42f7dee09d466fd |
| 21 | bulk_command_acceptances; bulk_command_acceptances_immutable_update; bulk_command_acceptances_never_deleted | d2a0c8de6f97f1c737d85b3474df07b053357a12626b3c08659cf7369fa41ce6 |

DCC1 retained runtime deployment is UNKNOWN, not never. Coordinator's root `docs/coordinator/worktree-completion/evidence/schema-history-intake.md` reports one conventional state.db at v18 and 95 retained backups <=18, no migration owner; this bounded evidence does not establish universal nondeployment. Root `decisions/2026-08-30-migration-history-integration.md` is OPEN/UNAPPROVED. No rewrite, renumber, dropping history, normalization, conversion or live migration is authorized. Final shared integration waits explicit disposition.

2. Cross-run DCR D75 actor-mismatch refusal versus DCC1 server provenance stamping is coordinator-owned. Frozen branch-local behavior is preserved, not globally resolved.
3. Accepted medium security finding remains OPEN: existing Settings directory owner/mode/ancestry is not validated before mkdir/lock; another UID with directory write could unlink evidence. See [dcc1-review-security-original.md](dcc1-review-security-original.md). No directory-integrity fix in this unit.
4. Original Tests review remains OPEN: instrument body consumption before refusal; replace transaction-count first-claim injection with semantic boundary; complete prepared command/audit/current partial-presence matrix (possible audit-only rollback bug); exact max-byte parsed-value readback. See [dcc1-review-tests-original.md](dcc1-review-tests-original.md). Preserve selected code/tests for separate focused units; do not imply these gaps are closed by this reconciliation.
5. Coverage/parity and final independent review are supervisor/coordinator gated. No merge commit before full per-commit coverage gate; this is an intentional intermediate merge, not task completion.

## Gate evidence and exact remaining work

No M3 Vitest, coverage, parity, browser test, live workflow or live authority command was executed.
All commands below ran only in the assigned workdir. No threshold/timeout/assertion changes were made
to evade resource contention; the file tests' API/contract ports predate the hold. A static fixture
`manualClock(string)` mistake was corrected to `manualClock(new Date(...))` during the hold.

| Command / check | Observed output and disposition |
|---|---|
| `git merge --no-ff --no-commit 13175b13340fec7b5326207fe54f98078d481d7d` | 28 conflict paths; merge intentionally remains open |
| Initial `npm run build:manifest` | Failed on generated conflict markers; resolved via generation, not a gate waiver |
| `npm run build:manifest && npm run roadmap && npm run typecheck` | Generated both outputs, then tsc exit 2: obsolete `createSettingsCommandJournal` in command-kernel test line 20 and BFF fixture line 173; undefined `SettingsOverrideSchema` at test line 141; undefined `CURRENT_SETTINGS_SCHEMA_HASH` in compose test line 579. Those stale references were removed/replaced. |
| Later `npm run typecheck\nnpm run lint` | tsc printed `tsc --noEmit`; shell ended 143 without diagnostics. Lint never started. NOT green. |
| Standalone `npm run lint` | Started before RESOURCE HOLD, PID 45279 / tool session 35843. Still running with no output beyond ESLint command at freeze; result UNOBSERVED. Read-only process left running as instructed. Even a later pass is not an exact-final-tree gate because the last static edits occurred during it. |
| `npm run build:manifest && npm run roadmap` before hold | exit 0: `Wrote src/domain/workflow/generated-build-manifest.ts.`; `Rendered docs/roadmap/index.html (1259449 bytes).` Final authority prose was added afterward, so roadmap must be regenerated/checked again after release; do not claim the final site is verified current. |
| `git ls-files -u` | empty: no unresolved index merges |
| `git diff --check`; `git diff --cached --check` | exit 0, no output |
| `git diff --name-only` | empty after explicit staging: no unstaged tracked changes |
| `git diff B --name-only -- src/dashboard` | only dashboard AGENTS and alternate-existing client/transport.ts; baseline surface components unchanged |
| `git hash-object` vs `git rev-parse HEAD:<path>` | migrations.ts both `0e8ad5cc6982a95713fbdd84678b94606dcff715`; immutability test both `9209beb9255b0ee77f0bb79666b723d04018b2c8`. Exact migration bytes and digest pins unchanged. |

### Remaining compile/proof seams (not acceptance)

1. Final typecheck and lint are **unverified**. No known outstanding compiler diagnostic is being
   suppressed, but the final candidate has not compiled. The initial four diagnostics and the static
   Date fixture error were repaired without a successful compiler rerun.
2. New/ported regression cases have not run. Verify post-COMMIT exact reconciliation and its failed
   inspection arm, pre-replace concurrent-byte refusal/cleanup, old envelope legible refusal and the
   four admitted DCC3 leaves. Mutation-proof these cases by temporarily removing only the new guard
   or reconciliation path, observing red, restoring via apply_patch, and observing green. No mutant
   is left in this candidate. The existing code was reconciled in tdd **tests** mode, not claimed as
   a completed red-green cycle.
3. **Remaining baseline worker proof transfer:** B's mixed-generation test asserted the stopped
   process-lock record, and its stale queued/claim-crossing tests asserted zero UCPath/CRM browser
   opens. The selected A tests retain queued-state refusal but these exact baseline assertions have
   not yet been re-pinned. The semantic `afterClaimAdmissionCheck` seam remains composed, but the
   selected crossing test still uses `bootTransactionsRemaining = 2`, as the supervisor's OPEN
   Tests review records. Coordinate that narrow follow-up; this report does NOT claim full baseline
   worker proof equivalence.
4. Regenerate/check roadmap after the final prose addition; run final manifest check. Browser/UI
   inspection and parity remain unperformed under the gate hold. The ui skill influenced preservation
   of baseline consumers rather than surface redesign; no visual/a11y acceptance is claimed.
5. Finish all focused suites below, then independent review and the allocated full coverage gate.
   The directory-security, partial prepared-presence bug investigation, body-consumption observation,
   max-byte exact-value proof, cross-run migration and D75 seams above remain explicitly separate.

### Pending commands — light release received; wait for the existing lint to end

Run serially, with no assertions/thresholds/timeouts weakened. These are a resume recipe, not output.
Light-gate admission transfers to the parent at return; do not overlap PID 45279, which was still
running at the last observation (elapsed 08:57, no lint diagnostics). Heavy gates remain forbidden
without their separately allocated slot.

```sh
npm run typecheck
npm run lint
npm run build:manifest
npm run roadmap
npm run build:manifest:check
npm run roadmap:check
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- --maxWorkers=1 tests/unit/config.test.ts tests/unit/settings-file-service.test.ts tests/unit/command-kernel.test.ts tests/unit/run-authority.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/worker-composition.test.ts
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- --maxWorkers=1 tests/unit/server/bff-flow.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/server/settings-facts.test.ts tests/unit/server/capture-surface.test.ts tests/unit/server/worker-pool-composition.test.ts tests/unit/server/worker-pool-parallel-proof.test.ts tests/unit/server/explorer-edit-service.test.ts tests/unit/server/explorer-override-store.test.ts tests/unit/preflight-runtime-dependencies.test.ts tests/unit/preflight-dashboard-runners.test.ts
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- --maxWorkers=1 tests/unit/dashboard/settings-editor-client.test.ts tests/unit/dashboard/settings-editor-surface.test.ts tests/unit/dashboard/settings-status-sections.test.ts tests/unit/dashboard/settings-takeover.test.ts tests/unit/dashboard/preflight-client.test.ts tests/unit/dashboard/client-transport.test.ts tests/unit/architecture/control-command-single-path.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/descriptor-coverage.test.ts
```

No coverage/parity command is delegated by this recipe. The supervisor must obtain the heavy slot.
The handoff is [2026-08-30-dcc1-m3-frozen-merge.md](../handoffs/2026-08-30-dcc1-m3-frozen-merge.md).
All M3 writer ownership is released to the parent at return; subsequent candidate changes invalidate
the returned tree hash and need their own evidence. This is permission to continue the assigned
workflow, not an expansion into the OPEN cross-run migration or live-authority decisions.

## Final index and changed paths

The final index tree hash is returned alongside this report, not embedded in its own hashed content.
HEAD and MERGE_HEAD remain frozen A/B above. Explicit stage paths were the 39 edited/conflicted
paths plus this report and the handoff; clean-merge baseline entries were already staged by Git.
The exact staged-path inventory below uses `git diff --cached --no-renames --name-only` (386 paths,
including both sides of a rename). Baseline board/CLAUDE blobs arrived unchanged from frozen B via
merge; no manual board/CLAUDE edits were authored. Supervisor-owned M1/M2/migration/security/tests
reports remain untracked and unstaged.

### Reconciliation delta against frozen B (63 paths)

```text
M	.gitignore
M	AGENTS.md
A	docs/coordinator/worktree-completion/handoffs/2026-08-30-dcc1-m3-frozen-merge.md
A	docs/coordinator/worktree-completion/reports/dcc1-m3.md
M	docs/rebuild/01-build-the-spine.md
M	docs/rebuild/02-prove-writes-build-the-tails.md
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
M	src/dashboard/AGENTS.md
M	src/dashboard/client/transport.ts
M	src/domain/authority.ts
M	src/domain/commands.ts
A	src/domain/config/runtime-generation.ts
M	src/domain/config/schema.ts
A	src/domain/config/settings-current.ts
M	src/domain/config/settings.ts
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
M	src/server/dashboard/queries/settings-editor.ts
M	src/server/dashboard/routes/api.ts
A	src/server/dashboard/routes/operator-mutation-ingress.ts
A	src/server/settings-runtime.ts
D	src/server/settings/settings-file-service.ts
D	src/server/settings/settings-runtime-generation.ts
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
M	tests/unit/settings-file-service.test.ts
D	tests/unit/settings-process-loss.test.ts
D	tests/unit/settings-runtime-generation.test.ts
M	tests/unit/sqlite-authority-database.test.ts
M	tests/unit/worker-composition.test.ts
```

### Exact staged paths against alternate HEAD (386 paths)

```text
.agents/skill-library/hr-debug/REFERENCE.md
.agents/skills/hr-debug/SKILL.md
.agents/skills/hr-manage/SKILL.md
.agents/skills/hr-workflow/SKILL.md
.claude/skills/hr-debug/SKILL.md
.claude/skills/hr-manage/SKILL.md
.claude/skills/hr-workflow/SKILL.md
.gitignore
AGENTS.md
config/legacy-capabilities.json
config/pending-wire-bindings.json
config/test-subjects.json
docs/coordinator/worktree-completion/handoffs/2026-08-30-dcc1-m3-frozen-merge.md
docs/coordinator/worktree-completion/reports/dcc1-m3.md
docs/decisions/2026-08-28-dashboard-reporting-authority-answers.md
docs/decisions/2026-08-28-r2-controlled-commit-authorization.md
docs/decisions/2026-08-28-r2-post-u1r-residue.md
docs/decisions/2026-08-28-r2-u1-4537-registry-reconciliation.md
docs/decisions/2026-08-28-r2c-clear-pending-diagnostic-scope.md
docs/handoffs/2026-08-28-r-dcr-authority-close.md
docs/handoffs/2026-08-28-r2-4537-controlled-close.md
docs/handoffs/2026-08-28-r2-u1-4537-preflight-report.md
docs/handoffs/2026-08-28-r2-u1-4537-preflight.md
docs/handoffs/2026-08-28-r2-u1p-parity-refreeze-report.md
docs/handoffs/2026-08-28-r2-u1p-parity-refreeze.md
docs/handoffs/2026-08-28-r2-u1r-4537-single-subject-report.md
docs/handoffs/2026-08-28-r2-u1r-4537-single-subject.md
docs/handoffs/2026-08-28-r2c-fix-4568-clear-pending-report.md
docs/handoffs/2026-08-28-r2c-fix-4568-clear-pending.md
docs/handoffs/2026-08-28-run-dashboard-artifacts.md
docs/handoffs/2026-08-28-run-dashboard-capture-retirement.md
docs/handoffs/2026-08-28-run-dashboard-demo.md
docs/migrations/separations.md
docs/plans/03b-board.md
docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md
docs/plans/2026-08-21-03a-fidelity-2-run-detail.md
docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md
docs/plans/2026-08-26-p1-refreeze-attribution.md
docs/plans/2026-08-27-03b-runs.md
docs/plans/2026-08-27-separations-feature-map.md
docs/plans/2026-08-28-dashboard-completion-runs.md
docs/plans/dashboard-artifacts-board.md
docs/plans/dashboard-capture-retirement-board.md
docs/plans/dashboard-completion-board.md
docs/plans/dashboard-demo-board.md
docs/plans/dashboard-fidelity-board.md
docs/rebuild/03a-finish-the-dashboard.md
docs/rebuild/03b-finish-separations.md
docs/rebuild/03c-migrate-the-remaining-workflows.md
docs/rebuild/04-close-the-deferrals.md
docs/rebuild/guard-inventory.json
docs/rebuild/reference/clock-config-secrets.md
docs/rebuild/reference/dashboard-surfaces.md
docs/rebuild/reference/decisions.md
docs/rebuild/reference/execution-and-sessions.md
docs/rebuild/reference/frontend-backend-integration.md
docs/rebuild/reference/guards-and-tests.md
docs/rebuild/reference/operator-trust.md
docs/roadmap/index.html
docs/roadmap/roadmap.md
docs/status/2026-08-28-dashboard-status.md
docs/status/2026-08-28-phase-3b-status.md
src/control/CLAUDE.md
src/control/test-target-registry.ts
src/core/command-kernel.ts
src/core/runtime-composition.ts
src/core/worker-loop.ts
src/core/write-sequencer.ts
src/dashboard/AGENTS.md
src/dashboard/app/dashboard-app.tsx
src/dashboard/client/commands.ts
src/dashboard/client/queries.ts
src/dashboard/ds/primitives-layout.tsx
src/dashboard/surfaces/activity.tsx
src/dashboard/surfaces/archive.tsx
src/dashboard/surfaces/explorer-model.ts
src/dashboard/surfaces/explorer.tsx
src/dashboard/surfaces/intake.tsx
src/dashboard/surfaces/run-start-kit-model.ts
src/dashboard/surfaces/run-start-kit.tsx
src/dashboard/surfaces/run-start-model.ts
src/dashboard/surfaces/run-start-timeline.ts
src/dashboard/surfaces/run-start.tsx
src/dashboard/surfaces/settings-model.ts
src/dashboard/surfaces/settings.tsx
src/dashboard/surfaces/top-bar.tsx
src/dashboard/surfaces/ui-catalog.tsx
src/domain/commands.ts
src/domain/config/provenance.ts
src/domain/config/resolve.ts
src/domain/config/schema.ts
src/domain/config/settings.ts
src/domain/dashboard/bootstrap.ts
src/domain/dashboard/explorer.ts
src/domain/dashboard/settings-editor.ts
src/domain/dashboard/storage.ts
src/domain/preflight-contract.ts
src/domain/preflight-semantics.ts
src/domain/preflight.ts
src/domain/runtime-dependencies.ts
src/domain/trust/evidence-classification.ts
src/domain/ui/ucpath-smart-hr-termination.ts
src/domain/workflow/generated-build-manifest.ts
src/infra/config/settings-file.ts
src/infra/providers/dashboard-frontend-http-probe.ts
src/infra/sqlite/authority-database.ts
src/infra/sqlite/authority-health-runner.ts
src/infra/sqlite/index.ts
src/infra/sqlite/recovery-contracts.ts
src/infra/sqlite/storage-doctor.ts
src/server/dashboard/commands/explorer-edit-service.ts
src/server/dashboard/commands/explorer-override-store.ts
src/server/dashboard/commands/settings-service.ts
src/server/dashboard/commands/start-plan-service.ts
src/server/dashboard/compose.ts
src/server/dashboard/queries/bootstrap.ts
src/server/dashboard/queries/explorer.ts
src/server/dashboard/queries/settings-editor.ts
src/server/dashboard/queries/storage.ts
src/server/dashboard/routes/api.ts
src/server/preflight/dashboard-runners.ts
src/server/settings-runtime.ts
src/server/storage/compose.ts
src/server/worker/compose.ts
src/services/start/step-selection.ts
src/stores/ucpath/AGENTS.md
src/stores/ucpath/driver/smart-hr-fake.ts
src/stores/ucpath/driver/smart-hr-operation.ts
src/stores/ucpath/tasks/match-pending-terminations.ts
tests/fixtures/preflight-seams.ts
tests/parity/dashboard-reference.spec.ts
tests/parity/helpers/fixture-bff.ts
tests/parity/helpers/fixture-day.ts
tests/parity/helpers/seeded-bff.ts
tests/parity/panel-heading-accessibility.spec.ts
tests/parity/references/activity-report--graphite-warm--1280x720.a11y.yml
tests/parity/references/activity-report--graphite-warm--1440x900.a11y.yml
tests/parity/references/activity-report--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/activity-report--paper-ink--1280x720.a11y.yml
tests/parity/references/activity-report--paper-ink--1440x900.a11y.yml
tests/parity/references/activity-report--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/archive-ledger--graphite-warm--1280x720.a11y.yml
tests/parity/references/archive-ledger--graphite-warm--1440x900.a11y.yml
tests/parity/references/archive-ledger--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/archive-ledger--paper-ink--1280x720.a11y.yml
tests/parity/references/archive-ledger--paper-ink--1440x900.a11y.yml
tests/parity/references/archive-ledger--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/archive-run--graphite-warm--1280x720.a11y.yml
tests/parity/references/archive-run--graphite-warm--1440x900.a11y.yml
tests/parity/references/archive-run--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/archive-run--paper-ink--1280x720.a11y.yml
tests/parity/references/archive-run--paper-ink--1440x900.a11y.yml
tests/parity/references/archive-run--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/catalog-search--graphite-warm--1280x720.a11y.yml
tests/parity/references/catalog-search--graphite-warm--1440x900.a11y.yml
tests/parity/references/catalog-search--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/catalog-search--paper-ink--1280x720.a11y.yml
tests/parity/references/catalog-search--paper-ink--1440x900.a11y.yml
tests/parity/references/catalog-search--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/explorer-graph--graphite-warm--1280x720.a11y.yml
tests/parity/references/explorer-graph--graphite-warm--1280x720.png
tests/parity/references/explorer-graph--graphite-warm--1440x900.a11y.yml
tests/parity/references/explorer-graph--graphite-warm--1440x900.png
tests/parity/references/explorer-graph--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/explorer-graph--graphite-warm--narrow-1024x768.png
tests/parity/references/explorer-graph--paper-ink--1280x720.a11y.yml
tests/parity/references/explorer-graph--paper-ink--1280x720.png
tests/parity/references/explorer-graph--paper-ink--1440x900.a11y.yml
tests/parity/references/explorer-graph--paper-ink--1440x900.png
tests/parity/references/explorer-graph--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/explorer-graph--paper-ink--narrow-1024x768.png
tests/parity/references/explorer-transaction--graphite-warm--1280x720.a11y.yml
tests/parity/references/explorer-transaction--graphite-warm--1280x720.png
tests/parity/references/explorer-transaction--graphite-warm--1440x900.a11y.yml
tests/parity/references/explorer-transaction--graphite-warm--1440x900.png
tests/parity/references/explorer-transaction--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/explorer-transaction--graphite-warm--narrow-1024x768.png
tests/parity/references/explorer-transaction--paper-ink--1280x720.a11y.yml
tests/parity/references/explorer-transaction--paper-ink--1280x720.png
tests/parity/references/explorer-transaction--paper-ink--1440x900.a11y.yml
tests/parity/references/explorer-transaction--paper-ink--1440x900.png
tests/parity/references/explorer-transaction--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/explorer-transaction--paper-ink--narrow-1024x768.png
tests/parity/references/intake-manifest--graphite-warm--1280x720.a11y.yml
tests/parity/references/intake-manifest--graphite-warm--1440x900.a11y.yml
tests/parity/references/intake-manifest--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/intake-manifest--paper-ink--1280x720.a11y.yml
tests/parity/references/intake-manifest--paper-ink--1440x900.a11y.yml
tests/parity/references/intake-manifest--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/intake-mapping--graphite-warm--1280x720.a11y.yml
tests/parity/references/intake-mapping--graphite-warm--1440x900.a11y.yml
tests/parity/references/intake-mapping--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/intake-mapping--paper-ink--1280x720.a11y.yml
tests/parity/references/intake-mapping--paper-ink--1440x900.a11y.yml
tests/parity/references/intake-mapping--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/intake-rerun--graphite-warm--1280x720.a11y.yml
tests/parity/references/intake-rerun--graphite-warm--1440x900.a11y.yml
tests/parity/references/intake-rerun--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/intake-rerun--paper-ink--1280x720.a11y.yml
tests/parity/references/intake-rerun--paper-ink--1440x900.a11y.yml
tests/parity/references/intake-rerun--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/intake-review--graphite-warm--1280x720.a11y.yml
tests/parity/references/intake-review--graphite-warm--1440x900.a11y.yml
tests/parity/references/intake-review--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/intake-review--paper-ink--1280x720.a11y.yml
tests/parity/references/intake-review--paper-ink--1440x900.a11y.yml
tests/parity/references/intake-review--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/intake-upload--graphite-warm--1280x720.a11y.yml
tests/parity/references/intake-upload--graphite-warm--1440x900.a11y.yml
tests/parity/references/intake-upload--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/intake-upload--paper-ink--1280x720.a11y.yml
tests/parity/references/intake-upload--paper-ink--1440x900.a11y.yml
tests/parity/references/intake-upload--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-input--graphite-warm--1440x900.a11y.yml
tests/parity/references/separations-start-input--graphite-warm--1440x900.meta.json
tests/parity/references/separations-start-input--graphite-warm--1440x900.png
tests/parity/references/separations-start-input--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-input--graphite-warm--narrow-1024x768.meta.json
tests/parity/references/separations-start-input--graphite-warm--narrow-1024x768.png
tests/parity/references/separations-start-input--paper-ink--1440x900.a11y.yml
tests/parity/references/separations-start-input--paper-ink--1440x900.meta.json
tests/parity/references/separations-start-input--paper-ink--1440x900.png
tests/parity/references/separations-start-input--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-input--paper-ink--narrow-1024x768.meta.json
tests/parity/references/separations-start-input--paper-ink--narrow-1024x768.png
tests/parity/references/separations-start-options--graphite-warm--1440x900.a11y.yml
tests/parity/references/separations-start-options--graphite-warm--1440x900.meta.json
tests/parity/references/separations-start-options--graphite-warm--1440x900.png
tests/parity/references/separations-start-options--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-options--graphite-warm--narrow-1024x768.meta.json
tests/parity/references/separations-start-options--graphite-warm--narrow-1024x768.png
tests/parity/references/separations-start-options--paper-ink--1440x900.a11y.yml
tests/parity/references/separations-start-options--paper-ink--1440x900.meta.json
tests/parity/references/separations-start-options--paper-ink--1440x900.png
tests/parity/references/separations-start-options--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-options--paper-ink--narrow-1024x768.meta.json
tests/parity/references/separations-start-options--paper-ink--narrow-1024x768.png
tests/parity/references/separations-start-plan--graphite-warm--1440x900.a11y.yml
tests/parity/references/separations-start-plan--graphite-warm--1440x900.meta.json
tests/parity/references/separations-start-plan--graphite-warm--1440x900.png
tests/parity/references/separations-start-plan--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-plan--graphite-warm--narrow-1024x768.meta.json
tests/parity/references/separations-start-plan--graphite-warm--narrow-1024x768.png
tests/parity/references/separations-start-plan--paper-ink--1440x900.a11y.yml
tests/parity/references/separations-start-plan--paper-ink--1440x900.meta.json
tests/parity/references/separations-start-plan--paper-ink--1440x900.png
tests/parity/references/separations-start-plan--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-plan--paper-ink--narrow-1024x768.meta.json
tests/parity/references/separations-start-plan--paper-ink--narrow-1024x768.png
tests/parity/references/separations-start-result--graphite-warm--1440x900.a11y.yml
tests/parity/references/separations-start-result--graphite-warm--1440x900.meta.json
tests/parity/references/separations-start-result--graphite-warm--1440x900.png
tests/parity/references/separations-start-result--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-result--graphite-warm--narrow-1024x768.meta.json
tests/parity/references/separations-start-result--graphite-warm--narrow-1024x768.png
tests/parity/references/separations-start-result--paper-ink--1440x900.a11y.yml
tests/parity/references/separations-start-result--paper-ink--1440x900.meta.json
tests/parity/references/separations-start-result--paper-ink--1440x900.png
tests/parity/references/separations-start-result--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-result--paper-ink--narrow-1024x768.meta.json
tests/parity/references/separations-start-result--paper-ink--narrow-1024x768.png
tests/parity/references/separations-start-steps--graphite-warm--1440x900.a11y.yml
tests/parity/references/separations-start-steps--graphite-warm--1440x900.meta.json
tests/parity/references/separations-start-steps--graphite-warm--1440x900.png
tests/parity/references/separations-start-steps--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-steps--graphite-warm--narrow-1024x768.meta.json
tests/parity/references/separations-start-steps--graphite-warm--narrow-1024x768.png
tests/parity/references/separations-start-steps--paper-ink--1440x900.a11y.yml
tests/parity/references/separations-start-steps--paper-ink--1440x900.meta.json
tests/parity/references/separations-start-steps--paper-ink--1440x900.png
tests/parity/references/separations-start-steps--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/separations-start-steps--paper-ink--narrow-1024x768.meta.json
tests/parity/references/separations-start-steps--paper-ink--narrow-1024x768.png
tests/parity/references/settings--graphite-warm--1280x720.a11y.yml
tests/parity/references/settings--graphite-warm--1280x720.png
tests/parity/references/settings--graphite-warm--1440x900--capabilities.a11y.yml
tests/parity/references/settings--graphite-warm--1440x900--capabilities.png
tests/parity/references/settings--graphite-warm--1440x900--system-hosts.a11y.yml
tests/parity/references/settings--graphite-warm--1440x900--system-hosts.png
tests/parity/references/settings--graphite-warm--1440x900.a11y.yml
tests/parity/references/settings--graphite-warm--1440x900.png
tests/parity/references/settings--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/settings--graphite-warm--narrow-1024x768.png
tests/parity/references/settings--paper-ink--1280x720.a11y.yml
tests/parity/references/settings--paper-ink--1280x720.png
tests/parity/references/settings--paper-ink--1440x900.a11y.yml
tests/parity/references/settings--paper-ink--1440x900.png
tests/parity/references/settings--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/settings--paper-ink--narrow-1024x768.png
tests/parity/references/start-run--graphite-warm--1280x720.a11y.yml
tests/parity/references/start-run--graphite-warm--1280x720.png
tests/parity/references/start-run--graphite-warm--1440x900.a11y.yml
tests/parity/references/start-run--graphite-warm--1440x900.png
tests/parity/references/start-run--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/start-run--graphite-warm--narrow-1024x768.png
tests/parity/references/start-run--paper-ink--1280x720.a11y.yml
tests/parity/references/start-run--paper-ink--1280x720.png
tests/parity/references/start-run--paper-ink--1440x900.a11y.yml
tests/parity/references/start-run--paper-ink--1440x900.png
tests/parity/references/start-run--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/start-run--paper-ink--narrow-1024x768.png
tests/parity/references/start-run-separations--graphite-warm--1280x720.a11y.yml
tests/parity/references/start-run-separations--graphite-warm--1280x720.meta.json
tests/parity/references/start-run-separations--graphite-warm--1280x720.png
tests/parity/references/start-run-separations--graphite-warm--1440x900.a11y.yml
tests/parity/references/start-run-separations--graphite-warm--1440x900.meta.json
tests/parity/references/start-run-separations--graphite-warm--1440x900.png
tests/parity/references/start-run-separations--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/start-run-separations--graphite-warm--narrow-1024x768.meta.json
tests/parity/references/start-run-separations--graphite-warm--narrow-1024x768.png
tests/parity/references/start-run-separations--paper-ink--1280x720.a11y.yml
tests/parity/references/start-run-separations--paper-ink--1280x720.meta.json
tests/parity/references/start-run-separations--paper-ink--1280x720.png
tests/parity/references/start-run-separations--paper-ink--1440x900.a11y.yml
tests/parity/references/start-run-separations--paper-ink--1440x900.meta.json
tests/parity/references/start-run-separations--paper-ink--1440x900.png
tests/parity/references/start-run-separations--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/start-run-separations--paper-ink--narrow-1024x768.meta.json
tests/parity/references/start-run-separations--paper-ink--narrow-1024x768.png
tests/parity/references/storage-settings--graphite-warm--1280x720.a11y.yml
tests/parity/references/storage-settings--graphite-warm--1280x720.png
tests/parity/references/storage-settings--graphite-warm--1440x900.a11y.yml
tests/parity/references/storage-settings--graphite-warm--1440x900.png
tests/parity/references/storage-settings--graphite-warm--narrow-1024x768.a11y.yml
tests/parity/references/storage-settings--graphite-warm--narrow-1024x768.png
tests/parity/references/storage-settings--paper-ink--1280x720.a11y.yml
tests/parity/references/storage-settings--paper-ink--1280x720.png
tests/parity/references/storage-settings--paper-ink--1440x900.a11y.yml
tests/parity/references/storage-settings--paper-ink--1440x900.png
tests/parity/references/storage-settings--paper-ink--narrow-1024x768.a11y.yml
tests/parity/references/storage-settings--paper-ink--narrow-1024x768.png
tests/parity/shell-toast-floor.spec.ts
tests/scenario/separations-ucpath-termination.scenario.test.ts
tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.ts
tests/scenario/workflows/separations/dry-run.scenario.ts
tests/unit/architecture/control-command-single-path.test.ts
tests/unit/architecture/dashboard-wire-boundary.test.ts
tests/unit/architecture/helpers/redaction-surface-audit.ts
tests/unit/architecture/provider-capability-boundary.test.ts
tests/unit/architecture/redaction-surface-scan.test.ts
tests/unit/architecture/storage-recovery.test.ts
tests/unit/architecture/strict-boundary-schemas.test.ts
tests/unit/architecture/test-target-registry.test.ts
tests/unit/architecture/wire-connectivity.test.ts
tests/unit/architecture/workflow-editor-compile-integrity.test.ts
tests/unit/command-kernel.test.ts
tests/unit/config.test.ts
tests/unit/dashboard-wire.test.ts
tests/unit/dashboard/archive-render.test.ts
tests/unit/dashboard/explorer-client.test.ts
tests/unit/dashboard/explorer-edit-dialog.test.ts
tests/unit/dashboard/explorer-edit-review.test.ts
tests/unit/dashboard/explorer-editable-field-row.test.ts
tests/unit/dashboard/preflight-client.test.ts
tests/unit/dashboard/run-detail-decision-cue.test.ts
tests/unit/dashboard/run-start-dialog.test.ts
tests/unit/dashboard/run-start-model.test.ts
tests/unit/dashboard/run-start-timeline.test.ts
tests/unit/dashboard/settings-editor-client.test.ts
tests/unit/dashboard/settings-editor-surface.test.ts
tests/unit/dashboard/settings-status-sections.test.ts
tests/unit/dashboard/settings-takeover.test.ts
tests/unit/dashboard/shell-structural-fidelity.test.ts
tests/unit/dashboard/takeover-frame-focus.test.ts
tests/unit/domain/explorer-edit-protocol.test.ts
tests/unit/dry-run-scenario-composition.test.ts
tests/unit/fixtures/phase1c-contract-fixtures.ts
tests/unit/fixtures/ucpath-termination-fixtures.ts
tests/unit/preflight-dashboard-runners.test.ts
tests/unit/preflight-runtime-dependencies.test.ts
tests/unit/server/bff-flow.test.ts
tests/unit/server/bootstrap-start-surface.test.ts
tests/unit/server/bootstrap-storage-arms.test.ts
tests/unit/server/capture-surface.test.ts
tests/unit/server/compose-real-port.test.ts
tests/unit/server/explorer-edit-service.test.ts
tests/unit/server/explorer-override-store.test.ts
tests/unit/server/explorer-query.test.ts
tests/unit/settings-file-service.test.ts
tests/unit/start-step-selection.test.ts
tests/unit/storage-restore-drill.test.ts
tests/unit/storage-span-authority-reconciliation.test.ts
tests/unit/test-target-registry.test.ts
tests/unit/ucpath-smart-hr-operation.test.ts
tests/unit/ucpath-termination-verdict.test.ts
tests/unit/write-sequencer.test.ts
```
