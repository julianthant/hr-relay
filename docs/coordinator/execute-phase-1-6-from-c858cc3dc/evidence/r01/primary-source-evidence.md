# R01 primary-source evidence

All excerpts are from inherited base 99c9ed51882a4e53069d18cf0e890c98f9810be2; no foreign coordination material was consulted.

## docs/rebuild/01-build-the-spine.md
SHA-256: `c5c002b85f234f57040b5a3a019f3d9d970106cc5326de5587322054d2355bed`

Lines 599–638:
```text
599: ### Task 1 · Land the schema floor
600: <!-- roadmap: p1f-floor -->
601:
602: **Seam:** `src/infra/sqlite/migrations.ts` (ONE numbered migration `v30`, the **floor**, carrying every
603: D332 schema step: `deleted_runs` + `item_id`/`attempt`/`run_number`/`ordinal_source` with
604: `deleted_runs_immutable_update` dropped and re-created with the four columns in its equality set;
605: `checkpoint_payloads_never_deleted` created relaxed behind the tombstone with its tally key;
606: `protected_settings_current`; `authority_upgrades`); `src/domain/authority.ts` (`AUTHORITY_TABLE_REGISTRY`
607: and the `AuthorityUpgradeRecord` schema); `src/domain/run/deleted-run.ts` (the existing
608: `DeletedRunTableSchema` owner, extended with nullable ordinals, `ordinal_source` and `tallyVersion`);
609: `src/infra/sqlite/authority-database.ts` for exactly four things — the
610: D290 `integratedByVersion` FROZEN literal lists for 27, 28 and 29, the `#runMigrations` floor gate with the
611: read-only no-migrate open mode for `storage backup`, `storage doctor` and the upgrade's preflight, the
612: `baseline` `authority_upgrades` row written in the transaction that creates a fresh at-floor database
613: (D321 regeneration), and the `protectedSettingsCurrent` singleton repository (get / advance-in-transaction)
614: so wave peer 2-2 never edits this file; the `authority-ahead` open wrapper that releases the `server`
615: process record (§D332.6); `src/server/dashboard/compose.ts` and its focused composition test solely to
616: place the already-acquired `server` process lock inside that open-failure wrapper. The operator admitted
617: this narrow seam expansion on 2026-09-04 because preserving the earlier file list would leave M9
618: unimplemented with no later owner. **Owes:** §D332.11 M3 (the open half), M9, M21, M10's `baseline` cell; the
619: `planned` `guard-inventory.json` entry for `no-lifecycle-sql-outside-the-adapter` (activation: 1.6 Task 4;
620: its `.test.ts` must not exist yet, ref guards-and-tests §5.1). **Gate:** base + those proofs + every
621: existing storage/backup/doctor suite green, with a direct v29 fixture proving each of the three
622: read-only no-migrate opening modes leaves `user_version` at 29. This is M3's **open half** only:
623: Task 6 owns the backup/doctor inspector and manifest widening and re-runs the complete command-level
624: M3 proof in which both commands succeed and the backup manifest reports 29. **Deletion test:** none is
625: deleted here; the direct M3 open-half test is the red-capable oracle (remove the gate and the fixture
626: reports the floor). **Order:** first; merged before 2-1/2-2 branch. Later additive migrations (`v31+`)
627: apply at open as before — the floor is a one-time gate (§D332.1).
628:
629: - [x] One migration `v30 = floor` with the four D332 schema steps and the re-created `deleted_runs`
630:   trigger; `CURRENT` bumped in the SAME commit as the frozen 27/28/29 literals (§D332.3 step 3(b), M21).
631: - [x] `#runMigrations` gated at the floor; the read-only no-migrate open mode for its three callers;
632:   every other door `upgrade-required { schemaVersion, floor }`; the `baseline` journal row at
633:   regeneration; the open releases the `server` record on `authority-ahead` (§D332.1, §D332.5, §D332.6; M3, M9).
634: - [x] `AUTHORITY_TABLE_REGISTRY`, the record schemas, the `protectedSettingsCurrent` repository and the
635:   `planned` guard entry; base gate green with a v29 fixture untouched by each direct read-only
636:   no-migrate open mode. Task 6 owns successful pre-floor backup/doctor command and manifest compatibility.
637:
638: ### Task 2-1 · Implement the canonical run-record service
```

## docs/rebuild/reference/dashboard-surfaces.md
SHA-256: `9e1f64df1a8d28cfa6900f8cd0b7f70f68f015175e00230ae8ac2203f4ef44e2`

Lines 2262–2266:
```text
2262: 3. `boot-refuses-pre-floor-by-name` → §D332.1/§D332.6 → dashboard boot, worker boot and dry-run start
2263:    over a v29 fixture refuse `upgrade-required { 29, floor }` and run no migration; `storage backup`
2264:    and `storage doctor` open it through the read-only no-migrate mode (§D332.1) and leave
2265:    `user_version` at 29 — remove the gate on `#runMigrations` and this is red because the backup's
2266:    manifest reports the floor.
```

Lines 2285–2295:
```text
2285: 9. `downgrade-refuses-at-open` → §D332.6 → the as-built `#admitExistingSchema` (or its 1.6 successor)
2286:    over an at-floor database under a build whose `CURRENT` is 29 throws "newer than supported" before
2287:    any settings path is opened and before any migrated environment value is applied to `Config`
2288:    (assert with a filesystem spy on the settings family and a resolver spy: zero settings-path opens,
2289:    zero `resolveConfigWithProvenance` calls; the state-root `mkdir`, artifact-root check and process
2290:    lock DO run first, as built, and the proof names them rather than pretending they do not).
2291: 10. `mixed-generation-matrix-is-closed` → §D332.6 → every cell of the matrix is constructed on disk and
2292:     yields exactly the named verdict; a cell yielding `healthy` that the table does not mark healthy is
2293:     red. One cell is unconstructible and the proof says so: `at-floor / none / committed` with
2294:     `settings_current` still at revision 1 cannot arise because the rewrite always advances the
2295:     singleton; the proof asserts that impossibility rather than constructing it.
```

Lines 2333–2339:
```text
2333: 21. `d290-admits-v27-v28-v29-into-the-floor` → §D332.3 step 3(b) → exact v27, v28 and v29 databases
2334:     (each its frozen integrated table set) pass `#admitExistingSchema` under a build whose `CURRENT` is
2335:     the floor and upgrade through the ordinary chain; a v29 database with one extra table refuses
2336:     `foreign-suffix { 29, unrecognized }`; derive the lists from the live DDL again (the as-built
2337:     shape) and the v27/v28 arms go red because the DDL now holds the D332 tables.
2338: 22. `pre-floor-manifest-readable-for-restore` → §D332.4 → a v29 backup manifest parses under the READ
2339:     schema, `storage restore --from` it succeeds, and the restored root is `upgrade-required` at the
```

## src/infra/sqlite/migrations.ts
SHA-256: `aab5e62befe5bc3c8610a5741267f3ddc49c8a589bf4c74e41ca421327d2b7cd`

Lines 5–11:
```text
5: export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
6: export const UPGRADE_FLOOR_SCHEMA_VERSION = 30;
7: export const CURRENT_AUTHORITY_SCHEMA_VERSION = UPGRADE_FLOOR_SCHEMA_VERSION;
8:
9: export function requiresStoppedSystemAuthorityUpgrade(schemaVersion: number): boolean {
10:   return schemaVersion > 0 && schemaVersion < UPGRADE_FLOOR_SCHEMA_VERSION;
11: }
```

Lines 715–771:
```text
715: /**
716:  * D290/D332 — immutable released-layout admission. These are deliberately
717:  * literal: growing today's DDL must never rewrite what an integrated v27,
718:  * v28, or v29 authority meant.
719:  */
720: export const INTEGRATED_AUTHORITY_TABLES_BY_VERSION = deepFreeze({
721:   27: [
722:     "activity_person_pseudonym_generations", "activity_person_pseudonyms", "archive_relaunches",
723:     "archived_runs", "artifact_outbox", "artifact_sink_heads", "authority_meta",
724:     "bulk_command_acceptances", "capture_finalization_outboxes", "capture_photo_order",
725:     "capture_sessions", "checkpoint_payloads", "command_audits", "commands", "config_snapshots",
726:     "delegation_manifests", "dependencies", "diagnostic_attachments", "diagnostic_bundles",
727:     "dry_run_scenario_results", "duo_ceremony_leases", "durable_outbox", "evidence_receipts",
728:     "failures", "fix_records", "gates", "intake_manifests", "intake_sessions", "knowledge_records",
729:     "leases", "ledger_partitions", "ledger_projections", "notes", "notifications", "ocr_approvals",
730:     "ocr_extractions", "operator_xlsx_exports", "provider_admissions", "provider_budget_counters",
731:     "run_checkpoints", "run_results", "run_sessions", "run_terminal_authorizations",
732:     "run_terminal_outbox", "runs_view", "runtime_config", "settings_current", "spans", "start_plans",
733:     "tasks", "version_bump_applications", "version_plans", "worker_pools", "write_attempts",
734:     "write_intents",
735:   ],
736:   28: [
737:     "activity_person_pseudonym_generations", "activity_person_pseudonyms", "archive_relaunches",
738:     "archived_runs", "artifact_outbox", "artifact_sink_heads", "authority_meta",
739:     "bulk_command_acceptances", "checkpoint_payloads", "command_audits", "commands",
740:     "config_snapshots", "delegation_manifests", "dependencies", "diagnostic_attachments",
741:     "diagnostic_bundles", "dry_run_scenario_results", "duo_ceremony_leases", "durable_outbox",
742:     "evidence_receipts", "failures", "fix_records", "gates", "intake_manifests", "intake_sessions",
743:     "knowledge_records", "leases", "ledger_partitions", "ledger_projections", "notes", "notifications",
744:     "ocr_approvals", "ocr_extractions", "operator_xlsx_exports", "provider_admissions",
745:     "provider_budget_counters", "run_checkpoints", "run_results", "run_sessions",
746:     "run_terminal_authorizations", "run_terminal_outbox", "runs_view", "runtime_config",
747:     "settings_current", "spans", "start_plans", "tasks", "version_bump_applications",
748:     "version_plans", "worker_pools", "write_attempts", "write_intents",
749:   ],
750:   29: [
751:     "activity_person_pseudonym_generations", "activity_person_pseudonyms", "archive_relaunches",
752:     "archived_runs", "artifact_outbox", "artifact_sink_heads", "authority_meta",
753:     "bulk_command_acceptances", "checkpoint_payloads", "command_audits", "commands",
754:     "config_snapshots", "delegation_manifests", "deleted_runs", "dependencies",
755:     "diagnostic_attachments", "diagnostic_bundles", "dry_run_scenario_results", "duo_ceremony_leases",
756:     "durable_outbox", "evidence_receipts", "failures", "fix_records", "gates", "intake_manifests",
757:     "intake_sessions", "knowledge_records", "leases", "ledger_partitions", "ledger_projections",
758:     "notes", "notifications", "ocr_approvals", "ocr_extractions", "operator_xlsx_exports",
759:     "provider_admissions", "provider_budget_counters", "run_checkpoints", "run_results",
760:     "run_sessions", "run_terminal_authorizations", "run_terminal_outbox", "runs_view",
761:     "runtime_config", "settings_current", "spans", "start_plans", "tasks",
762:     "version_bump_applications", "version_plans", "worker_pools", "write_attempts", "write_intents",
763:   ],
764: } as const satisfies Readonly<Record<27 | 28 | 29, readonly string[]>>);
765:
766: export const SQLITE_MIGRATIONS = deepFreeze([
767:   {
768:     // This is the committed Stage-B schema. Never edit a released migration in place.
769:     version: 1,
770:     statements: [
771:       ...V1_TABLE_ORDER.map((name) => SQLITE_TABLE_DDL[name]),
```

Lines 1665–1724:
```text
1665:   {
1666:     // D332 — the one stopped-system authority upgrade journal. Every append
1667:     // has its own opaque key; planned attempts may repeat, while the three
1668:     // decisive phases are unique per upgrade identity.
1669:     version: 30,
1670:     statements: [
1671:       "ALTER TABLE deleted_runs ADD COLUMN item_id TEXT",
1672:       "ALTER TABLE deleted_runs ADD COLUMN attempt INTEGER CHECK (attempt IS NULL OR attempt >= 1)",
1673:       "ALTER TABLE deleted_runs ADD COLUMN run_number INTEGER CHECK (run_number IS NULL OR run_number >= 1)",
1674:       "ALTER TABLE deleted_runs ADD COLUMN ordinal_source TEXT CHECK (ordinal_source IS NULL OR ordinal_source IN ('tombstone','span-root-backfill','unknown'))",
1675:       "DROP TRIGGER deleted_runs_immutable_update",
1676:       `CREATE TRIGGER deleted_runs_immutable_update
1677:         BEFORE UPDATE ON deleted_runs
1678:         WHEN NOT (
1679:           NEW.record_key = OLD.record_key
1680:           AND NEW.workflow = OLD.workflow
1681:           AND NEW.trace_id = OLD.trace_id
1682:           AND NEW.item_id IS OLD.item_id
1683:           AND NEW.attempt IS OLD.attempt
1684:           AND NEW.run_number IS OLD.run_number
1685:           AND NEW.ordinal_source IS OLD.ordinal_source
1686:           AND NEW.origin = OLD.origin
1687:           AND NEW.command_id = OLD.command_id
1688:           AND NEW.deleted_at = OLD.deleted_at
1689:           AND NEW.created_at = OLD.created_at
1690:           AND json_array_length(OLD.record_json, '$.removed') = 0
1691:           AND json_array_length(NEW.record_json, '$.removed') > 0
1692:         )
1693:         BEGIN SELECT RAISE(ABORT, 'deleted run tombstones are immutable once their tally is settled'); END`,
1694:       `CREATE TRIGGER checkpoint_payloads_never_deleted
1695:         BEFORE DELETE ON checkpoint_payloads
1696:         WHEN substr(OLD.record_key, 37, 1) <> ':'
1697:           OR NOT EXISTS (
1698:             SELECT 1 FROM deleted_runs
1699:             WHERE record_key = substr(OLD.record_key, 1, 36)
1700:           )
1701:         BEGIN
1702:           SELECT RAISE(ABORT, 'checkpoint payloads are never deleted outside a D308 deleted_runs tombstone');
1703:         END`,
1704:       SQLITE_TABLE_DDL.protected_settings_current,
1705:       `CREATE TRIGGER protected_settings_current_never_deleted
1706:         BEFORE DELETE ON protected_settings_current
1707:         BEGIN SELECT RAISE(ABORT, 'protected settings current authority is never deleted'); END`,
1708:       `CREATE TRIGGER protected_settings_current_revision_advances
1709:         BEFORE UPDATE ON protected_settings_current
1710:         WHEN NEW.revision <> OLD.revision + 1
1711:         BEGIN SELECT RAISE(ABORT, 'protected settings current revision must advance exactly once'); END`,
1712:       SQLITE_TABLE_DDL.authority_upgrades,
1713:       "CREATE UNIQUE INDEX authority_upgrades_baseline_unique ON authority_upgrades(upgrade_id) WHERE phase = 'baseline'",
1714:       "CREATE UNIQUE INDEX authority_upgrades_committed_unique ON authority_upgrades(upgrade_id) WHERE phase = 'committed'",
1715:       "CREATE UNIQUE INDEX authority_upgrades_settled_unique ON authority_upgrades(upgrade_id) WHERE phase = 'settled'",
1716:       `CREATE TRIGGER authority_upgrades_immutable_update
1717:         BEFORE UPDATE ON authority_upgrades
1718:         BEGIN SELECT RAISE(ABORT, 'authority upgrade journal rows are immutable'); END`,
1719:       `CREATE TRIGGER authority_upgrades_never_deleted
1720:         BEFORE DELETE ON authority_upgrades
1721:         BEGIN SELECT RAISE(ABORT, 'authority upgrade journal rows are never deleted'); END`,
1722:     ],
1723:   },
1724: ] as const);
```

## src/infra/sqlite/authority-database.ts
SHA-256: `1ed1044d05cf6e7aa93a5ef9918a26a1306f1c1f6aef5762fb654cf3a01ad465`

Lines 2552–2578:
```text
2552:       allowUnknownNamedParameters: false,
2553:       defensive: true,
2554:     });
2555:
2556:     try {
2557:       const existingVersion = existed ? this.#admitExistingSchema() : undefined;
2558:       if (!readOnlyNoMigrate
2559:         && existingVersion !== undefined
2560:         && requiresStoppedSystemAuthorityUpgrade(existingVersion)) {
2561:         throw new Error(
2562:           `upgrade-required { schemaVersion: ${String(existingVersion)}, floor: ${String(UPGRADE_FLOOR_SCHEMA_VERSION)} }`,
2563:         );
2564:       }
2565:       if (readOnlyNoMigrate) {
2566:         this.#configureReadOnlyConnection();
2567:         this.#validateReadOnlyNoMigrateDatabase(existingVersion);
2568:       } else {
2569:         this.#configureConnection();
2570:         this.#initializeSchema(existingVersion, options.migrationOwner);
2571:         this.#validateDatabase();
2572:       }
2573:     } catch (error) {
2574:       this.#database.close();
2575:       throw new Error(`failed to open authority database ${options.path}: ${errorMessage(error)}`, { cause: error });
2576:     }
2577:
2578:     this.authority = this.#buildAuthorityRepositories();
```

Lines 3344–3398:
```text
3344:   #admitExistingSchema(): number {
3345:     const applicationId = this.#readIntPragma("application_id");
3346:     if (applicationId !== AUTHORITY_APPLICATION_ID) {
3347:       throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
3348:     }
3349:     const userVersion = this.#readIntPragma("user_version");
3350:     if (userVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
3351:       throw new Error(`authority schema ${String(userVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
3352:     }
3353:     if (userVersion < 1) throw new Error("existing authority database has no recognized schema version");
3354:     const meta = this.#readMetaRow();
3355:     if (meta.schema_version !== userVersion) {
3356:       throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(userVersion)}`);
3357:     }
3358:     if (meta.migration_owner !== null || meta.migration_started_at !== null) {
3359:       throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
3360:     }
3361:     if (userVersion > 18 && requiresStoppedSystemAuthorityUpgrade(userVersion)) {
3362:       const existingTables = this.#database.prepare(`
3363:         SELECT name FROM sqlite_master
3364:         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
3365:         ORDER BY name
3366:       `).all().map((row) => TableNameRowSchema.parse(row).name);
3367:       /*
3368:        * D290 admits only the common integrated lineage: the exact table set a
3369:        * database holds at each released version on THIS suffix. v27 is the
3370:        * whole DDL before the phone-capture retirement; v28 is that set with
3371:        * the capture tables dropped (D294). Later tables (D308's
3372:        * `deleted_runs`) are absent from both. Any other set at these versions
3373:        * is a divergent suffix and refuses below.
3374:        */
3375:       const integratedTables = userVersion === 27 || userVersion === 28 || userVersion === 29
3376:         ? INTEGRATED_AUTHORITY_TABLES_BY_VERSION[userVersion]
3377:         : undefined;
3378:       const isExactIntegrated = integratedTables !== undefined
3379:         && existingTables.length === integratedTables.length
3380:         && existingTables.every((name, index) => name === integratedTables[index]);
3381:       if (isExactIntegrated) return userVersion;
3382:       const rows = this.#database.prepare(`
3383:         SELECT name FROM sqlite_master
3384:         WHERE type IN ('table', 'index', 'trigger')
3385:       `).all();
3386:       const names = new Set(rows.map((row) => TableNameRowSchema.parse(row).name));
3387:       const source = names.has("runtime_config")
3388:         ? "DCC1"
3389:         : names.has("explorer_edit_reviews")
3390:           ? "DCC4"
3391:           : names.has("operator_xlsx_exports")
3392:             ? "DCR"
3393:             : "unrecognized";
3394:       throw new Error(
3395:         `D290 divergent post-v18 migration suffix: ${source} v${String(userVersion)}; `
3396:         + "automatic conversion is not authorized",
3397:       );
3398:     }
```

Lines 3412–3445:
```text
3412:   #runMigrations(fromVersion: number, migrationOwner: string): void {
3413:     if (requiresStoppedSystemAuthorityUpgrade(fromVersion)) {
3414:       throw new Error(
3415:         `upgrade-required { schemaVersion: ${String(fromVersion)}, floor: ${String(UPGRADE_FLOOR_SCHEMA_VERSION)} }`,
3416:       );
3417:     }
3418:     this.#database.exec("BEGIN EXCLUSIVE");
3419:     try {
3420:       const migrations = SQLITE_MIGRATIONS.filter(({ version }) => version > fromVersion);
3421:       for (const migration of migrations) {
3422:         for (const statement of migration.statements) this.#database.exec(statement);
3423:         if (fromVersion === 0 && migration.version === UPGRADE_FLOOR_SCHEMA_VERSION) {
3424:           const baseline = AuthorityUpgradeRecordSchema.parse({
3425:             recordKey: randomUUID(),
3426:             upgradeId: "fresh",
3427:             phase: "baseline",
3428:             fromSchemaVersion: 0,
3429:             toSchemaVersion: UPGRADE_FLOOR_SCHEMA_VERSION,
3430:             by: LOCAL_OPERATOR_ACTOR_ID,
3431:             recordedAt: this.#now(),
3432:           });
3433:           this.#database.prepare(`
3434:             INSERT INTO authority_upgrades (
3435:               record_key, upgrade_id, phase, record_json, created_at
3436:             ) VALUES (?, ?, ?, ?, ?)
3437:           `).run(
3438:             baseline.recordKey,
3439:             baseline.upgradeId,
3440:             baseline.phase,
3441:             canonicalJsonStringify(baseline),
3442:             baseline.recordedAt,
3443:           );
3444:         }
3445:         if (migration.version === 1) {
```

## src/server/dashboard/compose.ts
SHA-256: `3462216043512b8af2feba9878a168a2f6a48f8a30f841a91ca77e514aabf2f6`

Lines 604–648:
```text
604:   const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
605:   const settingsAuthority = createSettingsFileAuthority({
606:     path: join(stateRoot, "settings.json"),
607:     validateCandidate: (settings) => {
608:       resolveConfigWithProvenance(env, settings, clock);
609:     },
610:   });
611:   mkdirSync(stateRoot, { recursive: true });
612:   ensureOwnerOnlyDirectory(artifactRoot, "dashboard artifact root");
613:   /**
614:    * D181: this process takes the `server` role lock BEFORE it opens the
615:    * authority database. Two dashboards over one authority store is the
616:    * collision `config/runtime-isolation.json` has named since D88 and nothing
617:    * enforced; it is also the fact `cli storage restore` needs, because a
618:    * stopped-system proof is composed from these two lock files.
619:    */
620:   const processLock = acquireRuntimeProcessLock(
621:     { processLockRoot: join(repoRoot, input.isolation.processLockRoot), name: "server", pid: process.pid },
622:     clock,
623:   );
624:   const database = (() => {
625:     try {
626:       return AuthorityDatabase.open(
627:         { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "rebuild-dashboard" },
628:         clock,
629:       );
630:     } catch (openError) {
631:       try {
632:         processLock.release();
633:       } catch (releaseError) {
634:         throw new AggregateError(
635:           [openError, releaseError],
636:           "dashboard authority open failed and its process record could not release",
637:           { cause: releaseError },
638:         );
639:       }
640:       throw openError;
641:     }
642:   })();
643:   const bootConfig = (() => {
644:     try {
645:       const explorerOverrides = createExplorerOverrideStore(join(stateRoot, "explorer-overrides.json"));
646:       try {
647:         database.withAuthorityTransaction((repositories) => {
648:           explorerOverrides.reconcilePending(
```

## tests/unit/sqlite-authority-database.test.ts
SHA-256: `767b6b608ba54c5b935c74ca1d6dfaa70803939374f60556f3a0ff1e913aa34d`

Lines 892–926:
```text
892:   it("creates a fresh authority at the v30 floor with one baseline journal row", () => {
893:     const path = databasePath("fresh-v30.sqlite");
894:     openDatabase(path).close();
895:
896:     const raw = new DatabaseSync(path, { readOnly: true });
897:     try {
898:       assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 30);
899:       const row = raw.prepare(`
900:         SELECT record_key, upgrade_id, phase, record_json
901:         FROM authority_upgrades
902:       `).get() ?? {};
903:       const record = JSON.parse(String(Reflect.get(row, "record_json"))) as Record<string, unknown>;
904:       assert.deepEqual({
905:         recordKey: record.recordKey,
906:         upgradeId: record.upgradeId,
907:         phase: record.phase,
908:         fromSchemaVersion: record.fromSchemaVersion,
909:         toSchemaVersion: record.toSchemaVersion,
910:         by: record.by,
911:         recordedAt: record.recordedAt,
912:       }, {
913:         recordKey: Reflect.get(row, "record_key"),
914:         upgradeId: "fresh",
915:         phase: "baseline",
916:         fromSchemaVersion: 0,
917:         toSchemaVersion: 30,
918:         by: "local-operator",
919:         recordedAt: NOW,
920:       });
921:       assert.equal(Reflect.get(row, "upgrade_id"), "fresh");
922:       assert.equal(Reflect.get(row, "phase"), "baseline");
923:     } finally {
924:       raw.close();
925:     }
926:   });
```

Lines 953–1001:
```text
953:   it.each([
954:     "storage-backup-read-only-no-migrate",
955:     "storage-doctor-read-only-no-migrate",
956:     "storage-upgrade-preflight-read-only-no-migrate",
957:   ] as const)("admits v29 through %s without migrating or changing its bytes", (openMode) => {
958:     const path = databasePath(`${openMode}.sqlite`);
959:     createExactReleasedDatabase(path, 29);
960:     const before = readFileSync(path);
961:
962:     const database = openDatabaseWithoutMigration(path, openMode);
963:     assert.equal(database.getMeta().schemaVersion, 29);
964:     database.close();
965:
966:     assert.deepEqual(readFileSync(path), before);
967:     const raw = new DatabaseSync(path, { readOnly: true });
968:     try {
969:       assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 29);
970:       assert.equal(raw.prepare(`
971:         SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authority_upgrades'
972:       `).get(), undefined);
973:     } finally {
974:       raw.close();
975:     }
976:   });
977:
978:   it("refuses an ordinary v29 open with upgrade-required before any migration", () => {
979:     const path = databasePath("ordinary-v29.sqlite");
980:     createExactReleasedDatabase(path, 29);
981:     const before = readFileSync(path);
982:
983:     assert.throws(
984:       () => openDatabase(path),
985:       /upgrade-required \{ schemaVersion: 29, floor: 30 \}/u,
986:     );
987:     assert.deepEqual(readFileSync(path), before);
988:   });
989:
990:   it.each([27, 28, 29] as const)("admits the frozen integrated v%s layout for upgrade preflight", (version) => {
991:     const path = databasePath(`integrated-v${String(version)}.sqlite`);
992:     createExactReleasedDatabase(path, version);
993:     const before = readFileSync(path);
994:
995:     const database = openDatabaseWithoutMigration(path, "storage-upgrade-preflight-read-only-no-migrate");
996:     assert.equal(database.getMeta().schemaVersion, version);
997:     database.close();
998:     assert.deepEqual(readFileSync(path), before);
999:   });
1000:
1001:   it("creates the complete v30 schema floor and preserves journal append semantics", () => {
```

Lines 1083–1105:
```text
1083:   it("keeps the released v28 phone-capture retirement over an empty exact v27 authority", () => {
1084:     const path = databasePath("phone-capture-empty-v27.sqlite");
1085:     createExactV27Database(path);
1086:
1087:     applyReleasedMigrationChainForTest(path, 27);
1088:     const upgraded = openDatabase(path);
1089:
1090:     assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
1091:     for (const table of ["capture_sessions", "capture_photo_order", "capture_finalization_outboxes"]) {
1092:       assert.equal(upgraded.inspectSchema().tables.some(({ name }) => name === table), false, table);
1093:     }
1094:   });
1095:
1096:   it("refuses a v27 authority whose table set is no longer the exact integrated lineage", () => {
1097:     const path = databasePath("phone-capture-extra-table-v27.sqlite");
1098:     createExactV27Database(path);
1099:     const altered = new DatabaseSync(path);
1100:     altered.exec("CREATE TABLE unreviewed_v27_suffix (record_key TEXT PRIMARY KEY) STRICT");
1101:     altered.close();
1102:
1103:     assertD290RefusalWithoutMutation(path, "DCC1", 27);
1104:   });
1105:
```

## tests/unit/server/compose-real-port.test.ts
SHA-256: `eb2246c9ec5fb5d95fc11e916be51f9e6fbafae90b2d69f629f360cf93295390`

Lines 347–402:
```text
347: describe("composed dashboard runtime over an owned loopback socket", () => {
348:   it.each([
349:     { version: 29, refusal: /upgrade-required \{ schemaVersion: 29, floor: 30 \}/u },
350:     { version: 31, refusal: /authority schema 31 is newer than supported 30/u },
351:   ])("releases its acquired server process record when authority v$version refuses open", async ({
352:     version,
353:     refusal,
354:   }) => {
355:     const repoRoot = mkdtempSync(join(tmpdir(), `hrauto-compose-open-v${String(version)}-`));
356:     copyRuntimePackageFixture(repoRoot);
357:     cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
358:     const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
359:     mkdirSync(stateRoot, { recursive: true });
360:     const path = join(stateRoot, "state.db");
361:     const legacy = new DatabaseSync(path);
362:     legacy.exec("BEGIN EXCLUSIVE");
363:     for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 29)) {
364:       for (const statement of migration.statements) legacy.exec(statement);
365:     }
366:     legacy.prepare(`
367:       INSERT INTO authority_meta (
368:         singleton_id, schema_version, authority_generation, updated_at,
369:         migration_owner, migration_started_at
370:       ) VALUES (1, ?, 0, ?, NULL, NULL)
371:     `).run(version, "2026-08-28T12:00:00.000Z");
372:     legacy.exec("PRAGMA application_id = 1217249861");
373:     legacy.exec(`PRAGMA user_version = ${String(version)}`);
374:     legacy.exec("COMMIT");
375:     legacy.close();
376:
377:     await assert.rejects(
378:       composeDashboardRuntime({
379:         isolation: rebuildRuntimeIsolation,
380:         backendPortOverride: 0,
381:         env: {},
382:         clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
383:         repoRoot,
384:       }),
385:       refusal,
386:     );
387:     const releasedRecord = JSON.parse(readFileSync(
388:       join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json"),
389:       "utf8",
390:     )) as Record<string, unknown>;
391:     assert.equal(releasedRecord.releasedAt, "2026-08-28T12:00:00.000Z");
392:     const unchanged = new DatabaseSync(path, { readOnly: true });
393:     try {
394:       assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), version);
395:     } finally {
396:       unchanged.close();
397:     }
398:   });
399:
400:   describe.each(["require", "read", "recover"] as const)("%s diagnostic precedence", (entry) => {
401:     it.each([
402:       {
```

## docs/rebuild/guard-inventory.json
SHA-256: `c908ceb6ed8d1e1c73ff4c16f05e73e8256d1346a441374c5a20e3e129575c51`

Lines 382–390:
```text
382:     {
383:       "name": "no-lifecycle-sql-outside-the-adapter",
384:       "file": "tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts",
385:       "status": "planned",
386:       "owner": "docs/rebuild/reference/guards-and-tests.md; docs/rebuild/reference/dashboard-surfaces.md",
387:       "invariant": "PLANNED for 1.6 Task 4 (D330.10/D332.9): lifecycle mutation and lifecycle-authoritative reads route only through the run-record service adapter; no dashboard, worker, command, executor, or projection seam writes tasks/leases directly or treats evidence and runs_view as lifecycle authority. The guard and its violating fixture activate together only after Task 4 has displaced the existing writers.",
388:       "replacementRequired": true,
389:       "activationMilestone": "phase-1.6-task-4"
390:     },
```
