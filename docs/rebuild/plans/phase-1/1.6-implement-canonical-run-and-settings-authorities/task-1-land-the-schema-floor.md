# Task 1 · Land the schema floor
<!-- roadmap: p1f-floor -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** `src/infra/sqlite/migrations.ts` (ONE numbered migration `v30`, the **floor**, carrying every
D332 schema step: `deleted_runs` + `item_id`/`attempt`/`run_number`/`ordinal_source` with
`deleted_runs_immutable_update` dropped and re-created with the four columns in its equality set;
`checkpoint_payloads_never_deleted` created relaxed behind the tombstone with its tally key;
`protected_settings_current`; `authority_upgrades`); `src/domain/authority.ts` (`AUTHORITY_TABLE_REGISTRY`
and the `AuthorityUpgradeRecord` schema); `src/domain/run/deleted-run.ts` (the existing
`DeletedRunTableSchema` owner, extended with nullable ordinals, `ordinal_source` and `tallyVersion`);
`src/infra/sqlite/authority-database.ts` for exactly four things — the
D290 `integratedByVersion` FROZEN literal lists for 27, 28 and 29, the `#runMigrations` floor gate with the
read-only no-migrate open mode for `storage backup`, `storage doctor` and the upgrade's preflight, the
`baseline` `authority_upgrades` row written in the transaction that creates a fresh at-floor database
(D321 regeneration), and the `protectedSettingsCurrent` singleton repository (get / advance-in-transaction)
so wave peer 2-2 never edits this file; the `authority-ahead` open wrapper that releases the `server`
process record (§D332.6); `src/server/dashboard/compose.ts` and its focused composition test solely to
place the already-acquired `server` process lock inside that open-failure wrapper. The operator admitted
this narrow seam expansion on 2026-09-04 because preserving the earlier file list would leave M9
unimplemented with no later owner. **Owes:** §D332.11 M3 (the open half), M9, M21, M10's `baseline` cell; the
`planned` `guard-inventory.json` entry for `no-lifecycle-sql-outside-the-adapter` (activation: 1.6 Task 4;
its `.test.ts` must not exist yet, ref guards-and-tests §5.1). **Gate:** base + those proofs + every
existing storage/backup/doctor suite green, with a direct v29 fixture proving each of the three
read-only no-migrate opening modes leaves `user_version` at 29. This is M3's **open half** only:
Task 6 owns the backup/doctor inspector and manifest widening and re-runs the complete command-level
M3 proof in which both commands succeed and the backup manifest reports 29. **Deletion test:** none is
deleted here; the direct M3 open-half test is the red-capable oracle (remove the gate and the fixture
reports the floor). **Order:** first; merged before 2-1/2-2 branch. Later additive migrations (`v31+`)
apply at open as before — the floor is a one-time gate (§D332.1).

- [x] One migration `v30 = floor` with the four D332 schema steps and the re-created `deleted_runs`
  trigger; `CURRENT` bumped in the SAME commit as the frozen 27/28/29 literals (§D332.3 step 3(b), M21).
- [x] `#runMigrations` gated at the floor; the read-only no-migrate open mode for its three callers;
  every other door `upgrade-required { schemaVersion, floor }`; the `baseline` journal row at
  regeneration; the open releases the `server` record on `authority-ahead` (§D332.1, §D332.5, §D332.6; M3, M9).
- [x] `AUTHORITY_TABLE_REGISTRY`, the record schemas, the `protectedSettingsCurrent` repository and the
  `planned` guard entry; base gate green with a v29 fixture untouched by each direct read-only
  no-migrate open mode. Task 6 owns successful pre-floor backup/doctor command and manifest compatibility.


**Continuation verification (2026-09-04, C858cc3dc R01).** Independent verification found and closed
M9's exact older-build/zero-settings-access proof and M21's full v27/v28/v29 traversal plus negative
controls. Test commit `d650a43b`, report/evidence `df41e0b5`, integrated by `5b1fb626`; the base gate
passes 411 files / 5,040 tests, and assertion-only parity passes 269 tests with unchanged references.
Seven mutation controls fail at their intended assertions. Task 1's supervisor worktree, branch and
exact task are fully closed. M3 command/manifest compatibility and M21's command-level `foreign-suffix`
wire and upgrade repetition remain Task 6. The historical coordinator launch of wave peers 2-1/2-2
from `d2fe05dd` produced no Task-2-1 candidate and its temporary evidence was later removed; the direct
focused plans below supersede that launch record and require a newly verified common base.
