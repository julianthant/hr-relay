# DCA4 A6 — archived capture resource D183 registration

STATUS: Implemented and frozen for independent Tests/Security/Correctness review. Allocated lights
pass; **not full acceptance**. Historical full-coverage-05 remains RED (5/3634), preserved unchanged.
ROLE/MODEL/REASONING: sup_sol / native Sol / high. COMMITS: none; nothing staged.
Workdir for every shell command: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.

## Scope and provenance

HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`, branch `feature/dca4-archive-evidence`.
The archive resource schema/producer are inherited dirty DCA4 additions. Both audit files were
HEAD-identical before A6; root AGENTS already contained unrelated/backend changes, preserved exactly.
Only the following delta was authored (182 additions, 2 replacements):

| File | Isolated delta | Final SHA-256 |
|---|---:|---|
| `tests/unit/architecture/helpers/redaction-surface-audit.ts` | +9/-1 | `8b5f7eb7b00b5d8749698b319b5851e9a5f08b24e03305e3f97f33cd88aa4b39` |
| `tests/unit/architecture/redaction-surface-scan.test.ts` | +166/-1 | `7329ca05e57f726da6c617de2c3c30b9d72140d92cca1021ec08eaec9beb18a6` |
| `AGENTS.md` | +7/-0 | `a7acd7d280dc1a0bcf84b9447f10ea21687f5596f8ded2f198cc4171087b5588` |

Evidence below is relative to `../evidence/dca4-gates/`. The exact isolated patch is
[`redaction-isolated.patch`](../evidence/dca4-gates/redaction-isolated.patch), SHA-256
`30d746aa6ef76765a58ad1e110bad45c7f5150b1d874ec3b03cb604e26b7ded9`.
It is relative to the interrupted dirty baseline, not an attribution of the entire HEAD diff to A6.
Read-only `git apply --reverse --check` succeeds; no patch was applied during this check.

## Classification and authority

D183 owner: `docs/rebuild/reference/guards-and-tests.md` §3.15. Registered the COMPLETE
`ArchivedCaptureResourceWireSchema` as `wire/archived-capture-resource`, `operator-loopback`,
analogous to existing `ArtifactResourceWireSchema` (whose reason/message are repository-authored).

| Leaf | Schema classification | Actual origin |
|---|---|---|
| `runId`, `artifactId` | closed UUID-pattern strings | parsed requested identities, bound to the exact archived record/tile |
| `resource.state` | closed literals | available/missing/error branches; no fabricated purge arm |
| `resource.downloadUrl` | free-text | repository-authored fixed route + encoded exact IDs |
| `resource.reason` | free-text | repository-authored fixed missing-bytes sentence |
| `resource.message` | free-text | repository-authored fixed verification-failure sentence |

The schema's URL refinement does not make the JSON-schema string closed. Exactly three origins
were added. The producer is `src/server/dashboard/queries/archive.ts:249`; it verifies the frozen
reference and constructs fixed safe copy rather than copying caught messages, stored metadata or
filesystem paths. This is not `external-text` or `declared-redacted`. No classification exception,
matrix change, policy change, schema rename, scanner waiver/removal, or new guard file was needed.

## Tests and red-capable evidence

`hr-debug` guided reproduction; `tdd` tests mode used the operator-confirmed audit/canary seam.
Every configured architecture invocation used both `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`
(guard data only) and `VITEST_MAX_WORKERS=1`. Commands were serial. Raw logs are direct
`set -o pipefail` + `2>&1 | tee` streams, never reconstructed tool output. Exact commands, execution
chunks, sessions and terminal exits are in
[`redaction-execution-receipts.json`](../evidence/dca4-gates/redaction-execution-receipts.json).

| Evidence log | Result / intended signal |
|---|---|
| `redaction-red.log` | Exit 1 before collection: exact brief invocation lacked worktree legacy sibling; **not semantic red** |
| `redaction-red-configured.log` | Exit 1: 1 failed / 14 passed; missing registration names downloadUrl/message/reason/state |
| `redaction-registration-green.log` | Exit 0: unchanged 15 tests pass after registration |
| `redaction-canary-green.log` | Exit 0: 26/26 including 11 new tests |
| `redaction-negative-download-url.log` | Exit 1: 1 failed / 25 skipped; only downloadUrl origin removed |
| `redaction-negative-message.log` | Exit 1: 1 failed / 25 skipped; only message origin removed |
| `redaction-negative-reason.log` | Exit 1: 1 failed / 25 skipped; only reason origin removed |
| `redaction-negative-typed-missing.log` | Exit 1: 1 failed / 25 skipped; missing reason leaks all nine sentinels |
| `redaction-negative-typed-corrupt.log` | Exit 1: 1 failed / 25 skipped; corrupt message leaks all nine sentinels |
| Each `redaction-restored-*-green.log` (five) | Exit 0: 26/26 immediately after its exact hash-verified restoration |
| `redaction-related-green.log` | Exit 0: 101/101 across the exact three files below |
| `redaction-typecheck.log` | Exit 0, globally locked full typecheck |
| `redaction-lint.log` | Exit 0, globally locked full lint, zero warnings |
| `redaction-diff-check.log`, `redaction-patch-check.log` | Exit 0, clean whitespace / reverse-checkable isolated patch |

Focused command: `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/redaction-surface-scan.test.ts`.
Origin negatives add `-t 'dispositions every free-text'`; typed negatives respectively add
`-t 'keeps typed missing'` and `-t 'keeps typed corruption'`.
Related command uses the same prefix and these three exact test paths:

- `tests/unit/architecture/redaction-surface-scan.test.ts`
- `tests/unit/server/archive-capture-resource.test.ts`
- `tests/unit/server/archive-capture-routes.test.ts`

Full lights: `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck`, then
`/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint`; no overlapping gate processes.

The 11 new tests are: full registration/three-origin/six-leaf pin (1), independent origin omissions
(3), exact verified available result (1), typed missing/corrupt and raw ENOENT/storage failures (4),
foreign/canary URL rejections (2). Existing 15 tests remain, including all seven original canary
tests and scanner/matrix/module completeness controls.

The new canary tests insert and read back a strictly sealed archive in a real SQLite test database,
assert all nine sentinels reached stored metadata and source bytes before derivation, then run the
REAL `buildArchivedCaptureResource` and shared verifier. Only the storage-open boundary is injected.
The tests assert its exact frozen reference, the complete returned IDs/state/URL/fixed copy, and
sentinel-free serialization. Typed canary-bearing verifier errors survive normalization, so these
tests would catch a query change to `error.message`; raw-error-only tests could miss that regression.

The two executed canary negatives are explicitly **test-only leaking-output controls**, not
production mutations: after real derivation, a schema-valid copy substitutes the typed error's
message into reason/message. Temporarily calling the SAME canary assertion directly, instead of
asserting that it throws, produced red with all nine canary names. They do not claim an executed
production mutant. URL schema-rejection controls and origin-table controls are separate. No
temporary production mutation was performed or needed for the allocated proof.

## Freeze and limits

[`redaction-before.json`](../evidence/dca4-gates/redaction-before.json) preserves the complete original
bytes of all three owned files, HEAD/staging/dirty inventory, and 1,859 bounded tracked/untracked
nonignored repository file hashes. [`redaction-after.json`](../evidence/dca4-gates/redaction-after.json)
proves only those three files differ; **1,856 outside-scope paths are unchanged**, including frozen
A5 UI, spec/references, production/archive/schema/routes/config and shared materializer. The
coordination subtree is excluded because parent may write disjoint report artifacts; ignored
runtime/dependency files are not claimed by this bounded inventory.

Outside-scope digest before = after:
`e1b564d0c61ae7e11a530f2c67681d234e2f43a5674f69a90b6036958fb8f603`.
Each `redaction-restore-*.json` proves both owned candidate hashes and the unchanged domain/query/
materializer hashes after its negative. `full-coverage-05.log` remains byte-identical, SHA-256
`8d894ee26188f8e404485bedbcae88965f7259f7d125cc41e25485cc491217ab`.

No allocated A6 implementation or light proof remains. Independent reviews and required final
parent gates remain pending; no claim of clean worktree or full acceptance. No source, route,
config, shared-materializer, browser, parity, reference, build/manifest, full coverage, credential,
live authority, board, staging, commit or remote action. Writer/light-lane ownership relinquished
on direct return to parent thread `01a052ed-f880-7f20-8c9e-8a2f356b9c35`.
