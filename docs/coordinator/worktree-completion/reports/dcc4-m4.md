# DCC4 m4 — UI/full-gate verification

2026-08-30 · `sup_terra` · Terra/high · one allocated heavy-gate attempt.

## Frozen state

- Worktree: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`
- Branch: `feature/r-dcc-dcc4-exclusive`
- HEAD: `49c6206cbc3d3e30e97603628590823787d120d8`
- MERGE_HEAD: `13175b13340fec7b5326207fe54f98078d481d7d`
- Index tree: `dbd1b32cc6233fb9fdf6f7b577ab4be06098822f`
- Unmerged entries: 0. Unstaged tracked changes: none.

## Original gate result — RED

Command (nonblocking coordinator admission; `pipefail` enabled):

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
```

Result: exit 1, duration 302.97s. Vitest: **335 passed / 1 failed files** and
**3717 passed / 1 failed tests**. It stopped before coverage thresholds/floors and suite-size
output, so neither was evaluated. The sole failure is
`tests/unit/architecture/redaction-surface-scan.test.ts:173`, whose assertion is
`assert.deepEqual(declared, scanned)`: the actual first argument, `declared`, is missing
`src/domain/dashboard/explorer-edit.ts`; the expected second argument, `scanned`, includes it.
`src/domain/dashboard/explorer-edit.ts` exists and is retained for dormant v19 schemas. There is
zero authority to retire that file; this is solely a missing declaration/disposition in the guard.

Evidence: [original red archive](../evidence/dcc4-coverage.log.gz) (122 decompressed lines).
It is the exact `tee` capture, untouched; its final byte is the terminal newline (`0a`). No parity
command was started, so `dcc4-parity.log` does not exist. The only prior log-normalization
disclosure remains the already-existing Duo evidence logs, not this coverage log.

The logical heavy slot was released immediately after the result, before this report or any image
inspection. Coordinator thread `01a04b28-14a3-7362-8778-4543583d9a16` and the caller thread
`01a052ee-00ad-7e43-b23b-0f59fbd58699` were notified. No repair, source/index change, reference
refresh, migration/history work, browser session, live authority access, commit, or push occurred.

## UI evidence

`/ui` review route and live WIG guidance were prepared in preflight. Parity is the required rendered
proof for Explorer graph/transaction in both themes at 1024/1280/1440. Because coverage is red,
parity and the post-green reference-image inspection were correctly not run.

## Residue

The task owns two new untracked artifacts: this report and the raw coverage log. Existing untracked
supervisor evidence/reports are preserved. Ignored inventory is `node_modules/` (16,234 paths,
321 MiB) plus `test-results/` (4 KiB). No task-owned Vitest or Playwright process remains.
Shared integration remains blocked on the separately open migration-history disposition.

## Renewed M3F candidate — full-gate GREEN

The M3F guard repair was independently frozen at index tree
`9ede08fa4842eaf9d4e26aa6beeec0b132baf3e8`. The exact identity was the same before and after
each gate: HEAD `49c6206cbc3d3e30e97603628590823787d120d8`, MERGE_HEAD
`13175b13340fec7b5326207fe54f98078d481d7d`, index tree
`9ede08fa4842eaf9d4e26aa6beeec0b132baf3e8`; zero unmerged entries and no unstaged tracked edits.

### Terminal command receipts

| Gate | Unified command session | Terminal result | Before → after identity |
|---|---:|---|---|
| coverage | `95081` | **exit 0** | HEAD `49c6206c`, MERGE_HEAD `13175b13`, index `9ede08fa` → the same three values |
| parity | `84166` | **exit 0** | HEAD `49c6206c`, MERGE_HEAD `13175b13`, index `9ede08fa` → the same three values |

Both are terminal process exits returned by their command sessions, not inferred from partial output.
After parity, the task-owned heavy-process query returned no Vitest, Playwright, coverage, or parity
process for this worktree.

Coverage command (nonblocking shared OS lock, `pipefail`, one worker):

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
```

Exit 0, duration 323.84s: **336/336 files** and **3721/3721 tests** passed. Configured floors
passed (60% global and 80% safety-critical lines/statements/functions; branches report-only):
statements 84.68% (24513/28947), branches 74.82% (12573/16803), functions 88.20%
(5039/5713), lines 86.62% (22574/26060). Suite-size completed: unit 249 files/84,334 lines;
scenario 18/7,124; architecture 69/22,237.

Parity command (a separate nonblocking shared OS lock; `PARITY_UPDATE` explicitly **unset**, never
set to `0`):

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity
```

Exit 0: **239/239** assertions passed in 3.3m. This asserted the stored PNG pixels with
`maxDiffPixels: 0` and `threshold: 0.2`, plus byte-exact stored semantic references (a11y tree and
provenance metadata); no reference update occurred. Explorer graph and transaction passed in both
themes at 1024×768, 1280×720, and 1440×900. After the green lane, representative existing reference
images were inspected: graph graphite-warm 1440×900 and paper-ink 1024×768; transaction
graphite-warm 1440×900 and paper-ink 1024×768. These are existing asserted references, not fresh
browser captures.

Raw evidence is preserved byte-for-byte: [coverage archive](../evidence/dcc4-coverage-m3f.log.gz) (502 decompressed lines; raw SHA-256
`63323f4cb0a9e94c49757e2c9edecbcacb314ff19dc26b9b60d3feeb3ffcb45a`) and
[parity archive](../evidence/dcc4-parity-m3f.log.gz) (250 decompressed lines; raw SHA-256
`368cbab319982fac64d3d40e206dd0fe694d33bce66acd2021411b81dc812872`). Each ends in its captured
terminal newline. The original red log remains unchanged at SHA-256
`192d2a098effb567ef5be9ad9d3ac3a3b0f79c7fbff590b85213a5c505261297`.

The logical slot was released and both parent thread `01a04b28-14a3-7362-8778-4543583d9a16` and main
thread `01a052ee-00ad-7e43-b23b-0f59fbd58699` were notified before this report append or image
inspection. No task-owned Vitest or Playwright process remains. New ignored runtime artifacts are
coverage (24 MiB), `dist/` (92 paths), and `tests/` (3 paths); `node_modules/` remains 321 MiB / 16,234
paths and `test-results/` 4 KiB. No source, index, reference, migration/history, live-authority,
commit, or push change occurred.

## Supervisor receive / portable evidence

Supervisor received terminal sessions95081/84166 EXIT0 and closed this native unit. Main also
inspected asserted reference images for graph graphite-warm1024×768 and transaction
paper-ink1440×900; no new visual issue identified in these views. This is inspection of existing
references backed by the fresh full asserted lane, not a claim to newly captured screenshots.
After release, raw logs were archived losslessly; see the [archive manifest](../evidence/dcc4-evidence-manifest.md)
for original/archive SHA256, classifications, exact paths and decompression instructions.
