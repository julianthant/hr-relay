# R04 research — the 90 proofs 1.6 owes, the adapter roster, the intended inventory entries (sup-scout U03, read-only, 2026-09-04)

Coordination `31da5310-fb55-4982-ad02-05f4c9356d8b` · R04 · U03. Read at `98037ef7`: §D330.11 rows 1–26 at
`dashboard-surfaces.md:4258–4340`, §D331.11 P1–P40 at `clock-config-secrets.md:1101–1140`, §D332.11 rows 1–24 at
`dashboard-surfaces.md:2228–2320`, roster/deletion tests at `guards-and-tests.md:1496–1637`, intended inventory
entries at `:1645–1668`. No proof row names a doc 01 §1.6 task; the supervisor assigns them in doc 01 §1.6 (the
binding table in `reports/r04.md` is the assignment). Guard-inventory.json was grepped directly: none of
`settings-catalog`, `no-lifecycle-sql-outside-the-adapter`, `settings-root-single-pathname`,
`authority-upgrade-adapters-retired` exists today; `config-snapshot-generations` exists (line 101) and gains an ARM.

## Table P — the proofs (id → name; kind as the spec states it, `guard` where a `tests/unit/architecture/` file is named)

§D330.11 (service proofs; all fixture-composed over the real service and a temporary database):
1 identity-unique-under-concurrent-create · 2 create-refuses-tombstoned-run-id · 3 create-refuses-missing-parent-and-retry-source ·
4 claim-next-race-one-winner · 5 claim-refuses-stale-runtime-generation · 6 lost-heartbeat-requeue-then-zombie-write ·
7 requeue-refuses-live-heartbeat · 8 cas-conflict-returns-current-version · 9 terminalize-composite-atomicity ·
10 terminalize-replay-exact-and-divergent · 11 retry-and-restart-mint-next-attempt · 12 retry-refuses-deleted-or-unknown-write-source ·
13 relaunch-mints-fresh-run-with-archive-lineage · 14 archive-idempotent-if-identical · 15 delete-order-tombstone-first-leaves-first ·
16 every-never-deleted-trigger-still-aborts · 17 delete-refuses-member-and-non-terminal-tree · 18 delete-archived-digest-mismatch-writes-nothing ·
19 deleted-run-id-cannot-return · 20 existence-answers-are-total · 21 span-only-root-answers-absent-with-a-finding ·
22 gate-records-leave-with-the-run · 23 group-tree-lifecycle-end-to-end · 24 no-lifecycle-sql-outside-the-adapter (GUARD + inventory entry) ·
25 spent-ordinal-survives-delete · 26 anchor-delete-cascades-members-one-tombstone-each.

§D331.11 (P-rows; `settings-catalog.test.ts` is the NEW guard; the rest are unit/wire tests in the named files):
P1 catalog bidirectionally complete (guard) · P2 sourceClass/sensitivity pairing + consumers (guard) · P3 `CONFIG_ENV_BINDINGS` empty, `config` channel zero (guard + runtime-environment-coverage) ·
P4 resolver takes no env input (config.test) · P5 no protected name is a `ConfigSchema` leaf (guard) · P6 no protected value in the fingerprint preimage (guard) ·
P7 marked envelope only in command/audit rows (command-kernel, settings-file-service) · P8 ordinary document never holds a protected name · P9 `config_snapshots` carry no protected value ·
P10 provenance map = paths + two-value vocabulary · P11 singletons + claim token hold counters/hashes/names only (strict-boundary-schemas) · P12 protected readback wire exact (settings-runtime-reader, strict-boundary-schemas) ·
P13 settings FACTS wire not widened (bff-flow) · P14 bootstrap wire serves schema hashes only (bff-flow) · P15 backup copies ordinary half only, presence metadata value-free (storage-backup, backup-service, recovery-contracts) ·
P16 doctor/preflight report protected leaf by name (storage-doctor, preflight) · P17 diagnostic bundle carries `configFingerprint`, no dump · P18 sinks never carry a value (no-secret-values-in-logs, secrets-single-source) ·
P19 XLSX free of config refs (activity-export) · P20 no protected value into a child `process.env` (secrets-single-source WRITE arm, worker-composition, worker-supervisor) ·
P21 marked bytes re-authenticated after restart (settings-runtime-reader) · P22 nothing derived from a protected value stored/served (guard, settings-file-service) · P23 private-file protocol for both documents ·
P24 one lock, one reaper, one twin · P25 prepare/rollback name `target`, move as a unit · P26 the two singletons independent (command-kernel, authority-database) ·
P27 D321 coupling per document; fresh root regenerates both baselines (settings-runtime-reader) · P28 CAS only; request-only refusals before authority · P29 already-applied/command-divergent both arms ·
P30 remaining refusal arms · P31 `{ clear: true }` retires the `valueId` (settings-file-service, secrets) · P32 D300 semantics survive the source move (test-target-registry, dry-run-scenario-composition, secure-env-bootstrap) ·
P33 restart scopes exactly §D331.7; claim token REQUIRED IN FULL (authority-database `claimNext`, worker-composition, command-kernel) · P34 every migrated key is `RETIRED_ENVIRONMENT_KEYS`, refused by name at bootstrap and boot (runtime-environment-coverage, secrets, worker-composition) ·
P35 `.env` allowlist = five provider families (secrets, secure-env-bootstrap) · P36 `config-default` channel has exactly one member (guard) · P37 annual-dates and `urls.<system>.prod` as document-schema properties ·
P38 `snapshot-generations` retirement arm + negative control (config-snapshot-generations) · P39 every invalidated guard/test changed deliberately in the same commit (the 16 named files) · P40 the eleven parity references re-frozen deliberately (parity; at 3.1 = A8).

§D332.11 (M-rows; the upgrade command's proofs):
M1 upgrade-refuses-live-runtime · M2 upgrade-never-writes-lifecycle-rows · M3 boot-refuses-pre-floor-by-name (+ the read-only no-migrate open) · M4 preflight-is-total-and-ordered ·
M5 backup-prerequisite-binds-generation · M6 ambiguous-duplicate-refuses · M7 migrate-is-one-transaction · M8 settle-is-re-enterable · M9 downgrade-refuses-at-open ·
M10 mixed-generation-matrix-is-closed · M11 tombstone-backfill-with-provenance · M12 deleted-runs-trigger-survives-backfill · M13 evidence-and-snapshots-byte-identical ·
M14 snapshot-generation-retirement-arm · M15 journal-carries-no-value · M16 already-upgraded-writes-nothing · M17 restore-rollback-pairs-with-evidence ·
M18 authority-unknown-never-readmitted · M19 no-force-flags · M20 env-untouched (+ `migrated-refused` per key) · M21 d290-admits-v27-v28-v29-into-the-floor ·
M22 pre-floor-manifest-readable-for-restore · M23 orphan-gate-records-leave-at-upgrade · M24 pre-floor-manifest-and-old-sidecar-flags-carry.

## Table A — adapters (ref dashboard-surfaces §D332.9 · ref guards-and-tests §5.2)

| id | adapts | expiry | deletion test / oracle | lines |
|---|---|---|---|---|
| A0 | the upgrade's pre-floor readers (old-layout parser, sidecar reader, widened `.env` admission, tombstone backfill, orphan-gate sweep) | 2.6 | `authority-upgrade-adapters-retired` arm 1 (reachability from composition roots → path absent) | ds:2182–2189 · gt:1508–1522 |
| A1 | old-pathname prepare/rollback reconciler | 2.6 | arm 2 + `settings-root-single-pathname` | ds:2189–2190 · gt:1524–1537 |
| A2 | D268 fold arms in `run-status.ts` (`row.ended`, `row.claimedBy`) | 2.6 | `run-status-fold-contributes-no-lifecycle-arm` (unit test, table-driven) | ds:2190–2192 · gt:1539–1552 |
| A3 | `runs_view` — NOT an adapter (zero readers) | 2.6 (table removal) | `runs-view-has-no-reader` ARM of the §D330.10 guard + stub-throws negative control | ds:2193–2196 · gt:1554–1571 |
| A4 | the resolver's environment layer | 1.6 | P3 + P4 (compile-time red: `env` is the first parameter) | ds:2197–2200 · gt:1573–1584 |
| A5 | `secrets.ts` `process.env` reads for migrated names; the dual channel | 1.6 | P34 + P39 (`secrets-single-source` WRITE arm) | ds:2201–2202 · gt:1586–1597 |
| A6 | pre-floor tombstone reader (NULL ordinals, `tallyVersion` 1) | permanent | proof only: M11 + §D330.11 #25 | ds:2202–2205 · gt:1599–1611 |
| A7 | `snapshot-generations` retirement arm | permanent | ARM `retired-leaves-are-a-closed-list` of `config-snapshot-generations`; oracle M14 (+ P38) | ds:2205–2206 · gt:1613–1626 |
| A8 | eleven `settings.json: not set` parity references + DCC3's eight-leaf editor inventory | 3.1 | P40 (deliberate re-freeze) | ds:2206–2207 · gt:1628–1637 |

## Table G — intended `guard-inventory.json` entries (none exists today except `config-snapshot-generations`)

| name | spec | today | cited by |
|---|---|---|---|
| `settings-catalog` | ccs:1092–1097 | absent | P1 P2 P3 P5 P6 P22 P36 |
| `no-lifecycle-sql-outside-the-adapter` | ds §D330.10 (:4233–4242) · gt:1656–1660 | absent | §D330.11 #24; A3 arm |
| `settings-root-single-pathname` | gt:1645–1650 | absent | A1 |
| `authority-upgrade-adapters-retired` | gt:1651–1655 | absent | A0, A1 |
| `run-status-fold-contributes-no-lifecycle-arm` | gt:1661–1665 | n/a (unit test by design) | A2 |
| `config-snapshot-generations` + ARM `retired-leaves-are-a-closed-list` | gt:1666–1668 | entry present (`guard-inventory.json:101`); arm not landed | A7, M14, P38 |

## Table X — explicit 1.6 carry items (R03 residue) and where each is defined

| item | spec |
|---|---|
| read-only no-migrate open mode (`storage backup|doctor` + the upgrade's preflight) | ds:2236 (§D332.1), M3 |
| D290 literal freeze for 27/28/29 in the same commit as the `CURRENT` bump | ds:1891–1896 (§D332.3 step 3(b)), M21 |
| backup READ-path widening (three schemas + inspector) | ds:1949 (§D332.4), M17/M22 |
| A0's frozen pre-floor schema copies + hash literal | ds:2184–2189 (§D332.9) · ccs:1301–1306 (§D332.S2), preflight step 9 |
| `baseline` journal row at D321 regeneration | ds §D332.1/§D332.5/§D332.6 · ccs:1127 (P27), ccs:215 |
| `snapshot-generations` closed retired-leaf list (generation 5) | ccs:1138 (P38) · gt:1613–1626 |
| `run-status-fold-contributes-no-lifecycle-arm` unit test | gt:1541–1552 |
