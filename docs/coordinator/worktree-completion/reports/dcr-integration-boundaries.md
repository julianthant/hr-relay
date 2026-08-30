# DCR final-join boundaries — migrations and request identity

Verified source HEAD: `6d1e3ca89714e13ea7bbb440d27957301ffc6ca6`.
Common integration baseline: `13175b13340fec7b5326207fe54f98078d481d7d` (schema v18).
Receive date: 2026-08-30. This inventory changes no migration or product contract.

## Exact immutable migration inventory

Primary sources: `src/infra/sqlite/migrations.ts` and
`tests/unit/architecture/migration-history-immutability.test.ts`. Migration objects have no
formal `name` field: the descriptions below identify their purpose; the SQL object names are exact.
Current DCR schema version is 24.

Digests below were recomputed from the imported migration statements, not copied solely from the
test's expected literals. Framing is SHA-256 of `hrauto:sqlite-migration:v1\0`, version plus NUL,
statement count plus NUL, then each statement's zero-based index, colon, UTF-8 byte length, NUL,
statement bytes, NUL. Every recomputed value matches its literal history pin.

| Version | Statements | Exact SHA-256 |
|---|---:|---|
| 18 (common baseline) | 3 | `f1a471cef9b932c508095edbc102df94b851af722652c0a752d7382912464dfc` |
| 19 | 4 | `06ec41a35f5d6be47be67f19da26e504cf6788d892bc21d4d10d1d0768872c39` |
| 20 | 4 | `e3c09c940fb52c1193bb37c0d01644bbe3f15d4bbd84e89a18be4e200360cbe2` |
| 21 | 1 | `3f06f322f009e177afa8eeb1f48de6456a141da071fbf8ae8da33dab8168481d` |
| 22 | 5 | `70173d78676cdd88cec4e7f89fa2c364c955e7cd923d364ee6163950b3948f13` |
| 23 | 4 | `08565c854b7d809099a7e9d267466cec424c530ea7252469f43abebfe285419e` |
| 24 | 2 | `71dd383d16518b329ab1e5d64071646c43bf115619bec8093cc087e08fff511a` |

### v19 — XLSX evidence

- `operator_xlsx_exports` table.
- `operator_xlsx_exports_artifact_idx` index on `artifact_id`.
- `operator_xlsx_exports_immutable_update` trigger.
- `operator_xlsx_exports_never_deleted` trigger.
- Introduced by `baaf7b57b3154e6b2d86c97074689c0bb3ec9d62`; the selection-kind DDL was
  completed with `activity` alongside `search` in `5b66f0c3ba7f20a718a364271a6455d279cafd17`.
  The digest above is the final reviewed DCR v19, not the intermediate first implementation.

### v20 — D288 pseudonym evidence

- `activity_person_pseudonyms` table.
- `activity_person_pseudonyms_generation_value_idx` index on `(key_generation, pseudonym)`.
- `activity_person_pseudonyms_immutable_update` trigger.
- `activity_person_pseudonyms_never_deleted` trigger.
- Source commit: `0518a2d2314354c2d9aae4d4f3e506e125d075f4`.

### v21 — immutable insertion conflict

- `activity_person_pseudonyms_immutable_insert_conflict` trigger refuses an existing
  `record_key` or `(run_id, key_generation)` before SQLite REPLACE can implicitly delete it.
- Source commit: `ea64b078236fcda8326022193641ba5db089015b`.

### v22 — generation-to-key commitment

- `activity_person_pseudonym_generations` table.
- `activity_person_pseudonym_generations_immutable_update` trigger.
- `activity_person_pseudonym_generations_never_deleted` trigger.
- `activity_person_pseudonym_generations_immutable_insert_conflict` trigger, guarding
  `record_key` and `key_generation`.
- `activity_person_pseudonyms_require_generation_binding` trigger.
- Source commit: `4f778d80365a1489d5da56af0dd6f6d269d029c8`.

### v23 — refuse unbound pre-commitment evidence

- Create transient `activity_person_pseudonym_v21_upgrade_guard` table.
- Create `activity_person_pseudonym_v21_upgrade_guard_refusal` trigger.
- Insert the count of evidence without a generation binding, refusing any nonzero count.
- Drop the transient guard table.
- Runs inside the same exclusive migration transaction as v22; refusal rolls back schema,
  metadata and `user_version`. It cannot infer the secret that produced earlier evidence.
- Source commit: `48b964e8ddc98ebdedd818cc73c46895c81e2ddc`.

### v24 — D75 XLSX actor attribution

- Add nullable `requested_by` column to `operator_xlsx_exports`.
- Add `operator_xlsx_exports_immutable_insert_conflict` trigger guarding `record_key`.
- Historical v1 evidence remains NULL/unattributed. New v2 evidence carries the server-derived
  actor; mirrored SQL/JSON evidence must agree. No actor backfill or old-row rewriting.
- Source commit: `80eea7cd5f223220de8bbab36e0aa58395646e80`.

## Deployment-evidence boundary and final integration residue

The original close recorded a local live schema-v18 observation and seven ineligible Separations
rows on 2026-08-29. That is historical evidence, not a fresh deployment audit. Neither that close's
reported eligibility review nor this receive executed a live D288 backfill. This receive has not
opened live authority, read credentials, or established whether another authority has deployed
any v19–v24 lineage. Fixture migration/upgrade gates prove only the exercised test databases;
they cannot prove the deployed history of an operator database.

The coordinator reports that the alternate DCC1 lineage introduces v19 `runtime_config` and
additional v20–v21 migrations over the same v18 baseline. Its v19 therefore collides with DCR's
v19 XLSX evidence, not merely with v20–v24. DCR has not inspected or modified that foreign
checkout. Reconcile the two exact statement histories/digests and their actual deployment
evidence before the final join. Missing deployment proof is not proof that renumbering is safe.
Do not resolve this as a textual merge or update digest pins just to bless a rewritten history.
This is coordinator-owned combined-integration residue, not a reason to alter this receive's
standalone migrations or claim the combined result is already green.

## D75 — pre-effect mismatch refusal, never silent provenance stamping

Primary source: `src/server/dashboard/request-identity.ts` and
`src/server/dashboard/routes/api.ts:161` (first middleware), plus the explicit actor checks on
preflight, command and bulk-command ingress. D75 source commit is `80eea7cd`.

1. Derive the actor exactly once at BFF admission from the strict configured solo
   `local-operator`, never from body, query, headers, XLSX metadata or capture credentials.
2. For a schema-valid command envelope, compare its caller-supplied `requestedBy` claim with
   that derived actor **before dispatch, replay resolution, receipt/command persistence,
   settings application or other handler effects**. A mismatch must produce HTTP 403
   `REQUEST_IDENTITY_REFUSED`; it must not silently replace the claim and continue.
3. Invalid envelopes remain invalid. Derived provenance is not permission to repair a caller's
   malformed body. XLSX requests remain strict and actor-free, with the derived actor passed
   separately into the export service for new v2 evidence.
4. The alternate DCC1 command-stamping/replay behavior must be reconciled at the final join
   without weakening these D75 requirements. A replay path must not bypass the ingress comparison
   merely because a prior command or newly stamped actor looks authoritative.

Regression proof: `tests/unit/server/bff-flow.test.ts:1231` exercises Settings, preflight and
bulk mismatches (403; no Settings command persisted). Its route-enumerating test at line 1296
proves a refusing checkpoint runs exactly once on every registered route and an unknown route,
with unchanged authority generation, no artifacts and zero XLSX evidence. The explicit route
check occurs before invoking command services, so their replay paths cannot admit mismatches.
These tests and the independent q2 security review preserve the current D75 contract; they are
not evidence that an unmerged alternate DCC1 implementation already satisfies it.

Fresh focused command at the unchanged reviewed product HEAD (tool session 50954, exit 0):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/architecture/migration-history-immutability.test.ts tests/unit/server/bff-flow.test.ts --testNamePattern 'immutable SQLite migration history|refuses a command whose requested actor disagrees|crosses one request-identity checkpoint' --reporter=dot
```

Result: 2 files passed; 4 tests passed; 27 other BFF tests deliberately filtered/skipped. Duration
2.59s. This is focused verification, not the queued full coverage/parity gate. The receive's lint
gate also passed (session 54081); no product files changed between those checks.
