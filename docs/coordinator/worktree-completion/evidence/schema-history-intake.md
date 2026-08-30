# Schema-history integration intake — 2026-08-30

Coordinator read-only inspection, approximately 07:08 PDT. No application bootstrap, workflow,
person-row query, migration, database copy, authority replacement, or secret-file read occurred.

## Exact root metadata

Target: /Users/julianhein/Projects/hr-automation-rebuild/.tracker-rebuild/state.db.
This is the repository's conventional root authority path, not proof of a currently configured or
admitted live runtime (R2's assigned runtime still lacks admission).

```sh
sqlite3 -readonly .tracker-rebuild/state.db "PRAGMA query_only=ON; BEGIN; SELECT 'user_version', user_version FROM pragma_user_version; SELECT 'authority_meta', schema_version, migration_owner IS NULL FROM authority_meta WHERE singleton_id=1; SELECT 'relevant_tables', name FROM sqlite_schema WHERE type='table' AND name IN ('operator_xlsx_exports','runtime_config','settings_current','activity_person_pseudonyms','explorer_edit_outbox','explorer_edit_review_snapshots') ORDER BY name; COMMIT;"
```

Exit 0; output:

```text
user_version|18
authority_meta|18|1
```

Thus pragma and authority metadata agree at v18, the metadata migration owner is absent, and the
queried later-branch tables are absent. No claim is made about person/run contents.

## Retained authority backups

Read only the header schema version in every existing
`.tracker-rebuild/backups/authority/*.sqlite`, failing on any query error:

```sh
set -o pipefail
for schema_backup in .tracker-rebuild/backups/authority/*.sqlite; do
  sqlite3 -readonly "$schema_backup" 'SELECT user_version FROM pragma_user_version;' || exit 1
done | sort -n | uniq -c
```

Exit 0. Distribution: 30 at v13, 10 at v14, 16 at v15, 39 at v18: **95 backups, none above v18**.
This bounded audit does not prove no divergent database exists elsewhere or ever existed.

## Committed conflicting history

The guard at `tests/unit/architecture/migration-history-immutability.test.ts` calls all these
entries released and forbids recomputing old digests to bless changed statements.
v1-v18 agrees across the compared branches.

| Branch/head | v19 digest | Later collisions |
|---|---|---|
| DCR `6d1e3ca8` | `06ec41a35f5d6be47be67f19da26e504cf6788d892bc21d4d10d1d0768872c39` | v20-v21 distinct from DCC1; DCR continues through v24 |
| DCC1 `0c115123` | `f10c15c58161cf658eb6526c8b3994ef72b0d85473389114eebb4d54651429d5` | v20 `29bbfab1ce3efdc17ac7f5943f6681b2af4604baaf0a5c91c42f7dee09d466fd`; v21 `d2a0c8de6f97f1c737d85b3474df07b053357a12626b3c08659cf7369fa41ce6` |
| DCC4 `49c6206c` | `bef14546c5a4bba520dca00f2bd0d950bc6f3824c5f953f54729d233b1701b8d` | superseded active Explorer outbox protocol; original schema remains preserved pending disposition |

Detailed run inventories: assigned-tree `reports/dcc1-migrations.md`,
`reports/dcc4-migration-history.md`, and `reports/dcr-integration-boundaries.md`.
Existing deployment evidence is historical or unknown; missing proof is not proof of non-deployment.

## Separate ingress join

DCR D75 requires HTTP 403 `REQUEST_IDENTITY_REFUSED` for a valid-envelope actor claim mismatch
before dispatch/replay/effects. DCC1's provenance stamping must not silently replace a foreign
claim at final integration. Preserve both exact-replay safety and pre-effect refusal.
