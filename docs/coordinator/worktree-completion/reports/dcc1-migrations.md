# DCC1 — cross-run immutable migration collision

Verified through immutable Git objects on 2026-08-30. No live database opened or runtime started.

DCC1 source: 0c115123a738f62cbe01c9b45f53b7289284479c.
DCR return: 6d1e3ca89714e13ea7bbb440d27957301ffc6ca6.
Frozen reconciliation baseline: 13175b13340fec7b5326207fe54f98078d481d7d (v18).
Digest source on each branch: tests/unit/architecture/migration-history-immutability.test.ts, RELEASED_MIGRATION_DIGESTS. These are exact pinned literals; this inventory did not execute either branch's migrations.

| Branch | Version | Migration purpose | Pinned SHA-256 |
|---|---:|---|---|
| DCC1 | 19 | runtime_config singleton, no-delete + generation-advance triggers | f10c15c58161cf658eb6526c8b3994ef72b0d85473389114eebb4d54651429d5 |
| DCC1 | 20 | settings_current singleton, no-delete + revision-advance triggers | 29bbfab1ce3efdc17ac7f5943f6681b2af4604baaf0a5c91c42f7dee09d466fd |
| DCC1 | 21 | immutable bulk_command_acceptances parent | d2a0c8de6f97f1c737d85b3474df07b053357a12626b3c08659cf7369fa41ce6 |
| DCR | 19 | operator_xlsx_exports table/index/immutability triggers | 06ec41a35f5d6be47be67f19da26e504cf6788d892bc21d4d10d1d0768872c39 |
| DCR | 20 | activity_person_pseudonyms evidence table | e3c09c940fb52c1193bb37c0d01644bbe3f15d4bbd84e89a18be4e200360cbe2 |
| DCR | 21 | activity_person_pseudonyms conflicting INSERT refusal | 3f06f322f009e177afa8eeb1f48de6456a141da071fbf8ae8da33dab8168481d |
| DCR | 22 | activity_person_pseudonym_generations + generation-binding guards | 70173d78676cdd88cec4e7f89fa2c364c955e7cd923d364ee6163950b3948f13 |
| DCR | 23 | refuse pre-commitment v21 pseudonym evidence at upgrade | 08565c854b7d809099a7e9d267466cec424c530ea7252469f43abebfe285419e |
| DCR | 24 | operator_xlsx_exports requested_by + conflicting INSERT refusal | 71dd383d16518b329ab1e5d64071646c43bf115619bec8093cc087e08fff511a |

All three DCC1 versions collide, including v19 (not only D288's v20/v21).

## Existing durable-application evidence

- DCC1: no tracked claim was found proving v19–21 ran against retained operator authority. The original control-plane brief is an assignment, not an execution receipt. Commits dcb72bfd, 7c785010, b5493899 and 0c115123 introduce/pin these migrations and their tests; test-created SQLite databases are not proof of production/runtime deployment. Intake showed only ignored node_modules in this assigned worktree. Status is **unknown**, not “never applied.”
- DCR: the committed report docs/handoffs/2026-08-28-r-dcr-authority-close-report.md §Migrations and backfill explicitly states the inspected local runtime database remained v18 during review and no ad-hoc migration/backfill was forced. This is dated reported evidence, not a fresh current-state check or universal proof that no other authority used v19–24.
- No current authority inspection or conversion was attempted; this assignment forbids live authority access.

## Required final-integration disposition

Coordinator owns this dependency. Do not renumber, rewrite released digest history, silently choose a branch's version numbers, force migrations, or delete evidence. DCC1 continues only the frozen-v18 reconciliation with its exact migration bytes preserved. Its local green gates cannot establish compatibility with the separate DCR return.

Related future join: DCR's D75 report claims forged command actor mismatches refuse before effects; alternate DCC1 server stamps caller provenance. The final integrated ingress must preserve the selected owning D75 contract as well as exact replay identity. This report does not settle or mutate that cross-run boundary.

## Coordinator follow-up evidence

Read the coordinator's exact `evidence/schema-history-intake.md` (2026-08-30 about 07:08 PDT): conventional root state.db pragma/meta both 18, no migration owner and none of the queried later tables; 95 retained authority backups all <=18. This remains bounded evidence, not universal nondeployment proof. The coordinator's `decisions/2026-08-30-migration-history-integration.md` is OPEN/UNAPPROVED. No normalization, lineage conversion, history rewrite, or live migration is authorized. DCC4 also has a different v19 suffix, as listed in that audit.
