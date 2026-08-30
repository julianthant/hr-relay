# DCC2 M1 — read-only history map

Immutable complete hashes/path inventory: [dcc2-history.md](dcc2-history.md). The scout's patch-equivalence observation is not proof of behavior equivalence; M2 must classify invariants directly.

STATUS: COMPLETE — read-only; HEAD `ac40292b`, branch clean except supervisor-owned `reports/dcc2-intake.md`.

ROLE: `sup_scout_dcc2_m1_history_map`.

COVERAGE: 70 unique commits (`80da3815..HEAD`); integrated DCC2 is 25 commits (`f12d8b28..2dbd50ac`, merged by `db42aebf`). No patch-ID matches.

COMMITS examined:

- Preflight/HTTP/frontend (35): `9bc5a2e5 0d0545fd ad54db66 ca053184 74f1f500 4c22735c 248ec5cc 84e93689 211b0ec8 fa4e7148 466af209 55e6c50c 57dd7f83 591cebf6 13beb09b 5db77143 ba0429d5 ffb1eab1 07e0c608 5d21b77f 1172a2c4 768355f1 e2fdf4f0 3dc0f684 807ce15b bbbb5bd7 5721a578 141c8cf7 da7bbcc1 7d008703 1edaf238 1586d98d 5c7b994b 02f9f9cf d75119a4`
- Storage/doctor (24): `5120d2fe cab1713b f3700f02 b2cc0176 f8fe8e08 df47b787 18e6dc04 e65dfc73 621cee86 986412a9 0c52c54d 45a47d16 f223d77e 5ec3e3d8 a91cf960 bdeda89b dd7e3d84 09e77fa3 f00d71fd 1417a476 eaa3a5d0 04c523ca e97fcea8 731cec9c`
- Docs/coordination (11): `c7c9cb36 2cae648b ca7613e4 36ccec8e f27ebfaf 9ed9cbf2 3a4754ce c1cc1087 44b16255 1c7e6f71 ac40292b`

FILES: Preflight: `src/core/preflight-executor.ts`, `src/domain/preflight.ts`, `src/server/dashboard/{preflight-authority,preflight-runners}.ts`, `src/server/dashboard/routes/api.ts`, `compose.ts`; tests `preflight-runtime-dependencies`, `server/preflight-runners`, `bff-flow`, `bootstrap-storage-arms`. Storage: `src/infra/sqlite/{authority-database,recovery-contracts,storage-doctor}.ts`; tests `architecture/storage-recovery`, `server/bff-flow`. Brief: `docs/plans/2026-08-28-dashboard-completion-runs.md:68-74`. Owners: `dashboard-surfaces.md:221-240,1375-1411`; `04-close-the-deferrals.md:1648-1650`; `AGENTS.md:367-422`.

GATES: None run by scout; supervisor reports typecheck/lint and focused tests 47/47 passed.

CONFLICTS: Baseline `clock-config-secrets.md:1003-1006` and integrated `a9:src/domain/preflight.ts:67-122` await actual detector settlement. Branch executor returns prompt timeout before settlement (`src/core/preflight-executor.ts:59-96`), while authority retains admission until settlement (`preflight-authority.ts:88-123`); tests `preflight-runtime-dependencies.test.ts:512-551,705-725`.

REVIEW-HINT: Treat timeout behavior as m2 judgment; shared surfaces are factual, implementation equivalence is unresolved.

NOTES: No credentials, live DB, writes, or gates used. Explicit unknowns: product intent and final supersession classification remain for m2.

ESCALATE: sup_analyst — timeout settlement/admission semantic comparison.
