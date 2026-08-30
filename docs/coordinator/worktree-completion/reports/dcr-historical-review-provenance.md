# DCR historical independent review provenance

Retrieved read-only on 2026-08-30 from the original reviewer tasks. These are historical returns,
not fresh gate runs. The current receive review and q3 logs supersede them for current readiness.

## D75 checkpoint

Reviewer task: `01a04cb7-fe75-7ae1-af2d-5ff757ccb4ce`.

STATUS: COMPLETE — read-only review of `d9b467e5..80eea7cd` at `80eea7cd`; worktree clean.

ROLE: `sup_analyst_d75_checkpoint_review`

VERDICT: ZERO FINDINGS — critical 0 · high 0 · medium 0 · low 0. D75 satisfies the requested solo authority boundary.

CONFIDENCE: High. Static code and all composition paths agree; focused regression coverage explicitly enumerates every registered route. No gates were run under this read-only assignment.

EVIDENCE:

| Check | Evidence |
|---|---|
| Exactly one checkpoint before handlers | `src/server/dashboard/routes/api.ts:161` installs the sole identity middleware before the capture gate and all handlers. `tests/unit/server/bff-flow.test.ts:1296` invokes every registered route plus an unknown path, asserts one call and no authority/artifact/XLSX effects. |
| Strict local-only derivation | `src/domain/ids.ts:145` permits actor syntax generally, but `LocalOperatorActorSchema` at `:147` strictly requires literal `local-operator`; production composes it at `src/server/dashboard/compose.ts:1191`. |
| No request-controlled identity | `src/server/dashboard/request-identity.ts:17` parses configuration once and ignores its `Request`; its test supplies query, header, and capture token material yet derives only local operator at `tests/unit/server/request-identity.test.ts:8`. |
| Every existing command envelope checked pre-effect | Preflight: `api.ts:193`; single command check precedes intake warm-up and submit at `:495`; bulk check precedes execution at `:521`. |
| Typed, non-sensitive refusal | Mismatch error text is fixed and contains no actor/credential value at `request-identity.ts:29`; wire mapping is typed `403 REQUEST_IDENTITY_REFUSED` at `routes/failure-status.ts:76`. |
| XLSX attribution is server-derived | Actor-free route passes checkpoint identity separately at `api.ts:208`; service parses that argument and writes v2 evidence at `operator-xlsx-export-service.ts:193`. Migration preserves v1 attribution as NULL at `migrations.ts:1347`. |
| Harness and parity coverage | Capture harness composes the same checkpoint at `tests/unit/server/capture-surface.test.ts:316`; parity BFF does likewise at `tests/parity/helpers/seeded-bff.ts:877`. |
| Phase 3d honesty | The document marks only D75’s solo baseline complete and leaves closed union, credential derivation, policy, and two-actor settlement open at `docs/rebuild/03d-co-operate-with-claude.md:132`. |

CONFLICTS: None unresolved. The open `ActorIdSchema` is intentionally constrained by the strict local actor config schema; Phase 3d explicitly records that a closed two-actor union remains unbuilt.

OPERATOR-CALL: None.

SCOUTS: None.

WHAT-WOULD-CHANGE-THIS: A second `createDashboardApp` composition, a route mounted outside this app, or a future identity adapter accepting request material without preserving the same checkpoint/mismatch checks would require re-review.

## D75 migration

Reviewer task: `01a04cb7-fee6-7ca0-a7aa-ec0053cae165`.

STATUS: COMPLETE

ROLE: Read-only independent reviewer

VERDICT: PASS — zero findings.

CONFIDENCE: High. The D75 contract, implementation, persistence, migration, tests, and roadmap records agree at `80eea7cd`. I did not run test gates under the read-only constraint.

EVIDENCE:

| Claim | Evidence |
|---|---|
| Strict, actor-free XLSX request | `src/domain/dashboard/xlsx-export.ts:133` |
| XLSX service accepts separate `ActorId`, parses it, and writes v2 attribution | `src/server/dashboard/exports/operator-xlsx-export-service.ts:38`, `:193`, `:207` |
| First middleware derives actor for every request | `src/server/dashboard/routes/api.ts:161` |
| Command, bulk, and preflight claims refuse before authority handlers | `src/server/dashboard/routes/api.ts:193`, `:484`, `:503` |
| XLSX route supplies only derived context actor; body remains strict | `src/server/dashboard/routes/api.ts:208` |
| v1 is strict/unattributed; v2 requires `requestedBy` | `src/domain/dashboard/xlsx-export.ts:169`, `:174`, `:276` |
| Mirrored nullable column reconciles on read and boot | `src/infra/sqlite/authority-database.ts:1072`, `:1638`, `:1829` |
| v24 is append-only; old update/delete triggers retained; conflict trigger blocks `INSERT OR REPLACE` | `src/infra/sqlite/migrations.ts:1253`, `:1350` |
| Migration execution is one exclusive transaction with rollback | `src/infra/sqlite/authority-database.ts:2813` |
| Tests cover v1/v2, v23 upgrade/no backfill, mismatch read+boot, update/delete/replace, both Activity/Search, actor smuggling, command mismatch, all-route checkpoint, and zero effects | `tests/unit/operator-xlsx-export.test.ts:52`; `tests/unit/sqlite-authority-database.test.ts:764`, `:1591`, `:1624`; `tests/unit/server/operator-xlsx-export-service.test.ts:261`; `tests/unit/server/bff-flow.test.ts:1231`, `:1296`, `:1603`, `:1650` |
| D75 authority is reconciled into charter, owning contracts, phase docs, and roadmap without claiming Phase 3d complete | `docs/rebuild/reference/charter.md:438`; `docs/rebuild/reference/operator-trust.md:2319`; `docs/rebuild/reference/frontend-backend-integration.md:598`; `docs/rebuild/03d-co-operate-with-claude.md:132`; `docs/roadmap/roadmap.md:79` |
| Pinned review target | `d9b467e5..80eea7cd` at commit `80eea7cd5f223220de8bbab36e0aa58395646e80` |

CONFLICTS: None. The apparent tension—D75 completion versus the future second actor—is explicitly resolved: solo admission is complete; credential-derived `claude` identity and two-actor policy remain planned.

OPERATOR-CALL: None.

SCOUTS: None.

WHAT-WOULD-CHANGE-THIS: A failing targeted test/gate result, evidence that a non-command route accepts caller actor material as durable identity, or a v1/v2 row that passes read/boot reconciliation while JSON and `requested_by` disagree.

## Final exact-merge review

Reviewer task: `01a04cba-538f-75e3-ac16-c511378e5bc0`.

**Receive correction (2026-08-30):** the historical `REVIEW-HINT` below conflated search and XLSX.
The search wire intentionally carries `runId`, `traceId`, and `retryOf` for navigation
(`src/domain/dashboard/search.ts`); only XLSX omits those identifiers from the workbook
(`tests/unit/server/operator-xlsx-workbook.test.ts`). The original return is retained verbatim
below as a historical quotation, not as the current contract. The corrected handoff and q1 report
reflect the owning search and XLSX contracts.

Original reviewer return:

STATUS: PASS/CLOSEABLE — findings: 0. DCR1 PASS as implemented/current-corpus-unavailable; DCR3, DCR4, DCR5, DCR6 PASS.

ROLE: sup_sol final independent reviewer

MODEL: GPT-5 Codex

REASONING: High; read-only review of all 166 commits in `13175b13..3b36592b`.

COMMITS: None. Key merges: DCR3 `1a8cdc3a`, DCR4 `289b60ad`, DCR5 `1082113c`, DCR6 `d26d1c83`/`8bc658d9`, DCR1 `d9b467e5`, D75 `3b36592b`.

FILES: 575 changed files reviewed; 50 runtime files. No tracked or untracked changes remain.

GATE: Exact locked gate PASS: typecheck; zero-warning lint; 353/353 files and 3,831/3,831 tests. Coverage: 84.74% statements, 75.01% branches, 88.43% functions, 86.69% lines. Focused privacy/authority suite: 115/115. Manifest no diff; parity 265/265; roadmap fresh; diff-check clean. Initial coverage attempt hit only the anticipated missing Duo symlink; prerequisite-corrected rerun passed.

SCOUTS: None; nested dispatch prohibited.

INVARIANT: Live corpus has seven current Separations rows: six failed without results; one done with legacy preview-shaped output and no approved canonical binding. D288 correctly returns unavailable and forbids substitutes. D75 schema v24 preserves unattributed v1 XLSX rows, attributes v2 via server-derived actor, and verifies JSON/column identity.

REVIEW-HINT: Backfill output exposes no EID/pseudonym/key; D289 withheld arms reveal no value or relation; search/XLSX omit person/run/trace/retry identifiers. Four representative Activity/search/comparison screenshots inspected.

NOTES: Parent close residue: board remains `briefed`, report is absent, and operator-trust/roadmap still say D289 unimplemented. Five clean, fully merged DCR/D75 worktrees and branches remain for sweep. Live DB remains schema v18 and intentionally unbackfilled.
