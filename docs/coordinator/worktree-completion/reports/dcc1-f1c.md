# DCC1 F1c — pure request-owned Settings refusals

2026-08-30 · native `sup_sol_dcc1_f1c_pure_refusal` · high reasoning.
Status: implementation complete; all assigned gates green; ready for independent parent review.

## Scope and preserved state

All commands used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1` as their workdir;
all edits used absolute paths there. Incoming index tree:
`a3e37553676c7d175566835bf7d5661379e62c2f`. HEAD remains
`0c115123a738f62cbe01c9b45f53b7289284479c`; MERGE_HEAD remains
`13175b13340fec7b5326207fe54f98078d481d7d`. The approved merge and all parent changes are preserved.
No commit, new agent/tree, heavy gate, browser/build, live authority, migration, board or D75 change.

Only four paths belong to this increment: `src/infra/config/settings-file.ts`,
`tests/unit/config.test.ts`, root `AGENTS.md`, and this report. The production change moves the two
existing request-only schema/patch-fingerprint refusal checks immediately after strict input parsing,
before lock acquisition and `readState()`. Their strict frozen response, code, message and ordering
are unchanged. They no longer require lock release because they never acquire authority.

The canonical fingerprint helper still strictly parses and hashes the supplied patch; no replacement
or default data is introduced. Valid apply, exact full-envelope replay, revision CAS, candidate
validation, prepared recovery, settlement and F3/F3b directory safeguards are unchanged.

## Red → green evidence

`/debug --fast` used the completed F1b full two-file red: 50 passed / 1 failed (51), schema refusal
created a 218-byte virgin initialization record. The parent independently reproduced the same red
and explicitly released sole light admission before F1c ran any gate.

`/tdd` used the assigned Settings apply seam. Two direct-authority cases start with no config
directory and no authority read/pre-initialization. They pin exact typed/frozen refusal messages,
unchanged empty root, absent settings/initialization/lock/prepare/rollback files, and zero calls to
the existing post-lock-link observation hook (including transient acquisitions). The patch mismatch
uses another valid patch's canonical fingerprint, not malformed input. Existing BFF whole-snapshot
equality and body nonconsumption assertions are untouched.

Every Vitest command used this exact prefix:
`env VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test --`.

| Invocation suffix / command | Actual result |
|---|---|
| `tests/unit/config.test.ts -t 'refuses request-owned'` before production edit | Exit 1: 2 failed / 44 skipped. Both typed refusals returned, but the snapshot found a new `config/` directory and initialization evidence. |
| Same exact invocation after production edit | Exit 0: 2 passed / 44 skipped. |
| `tests/unit/server/bff-flow.test.ts tests/unit/dashboard/client-transport.test.ts tests/unit/config.test.ts tests/unit/settings-file-service.test.ts` | Exit 0: 107 passed, 4 files passed. Includes the original BFF schema-refusal regression, all F1b client/body proofs and existing replay/CAS/recovery/directory cases. |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | Exit 0; full `tsc --noEmit`. |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint` | Exit 0; full ESLint with zero warnings. |

The original implementation itself is the red-capable broken variant; neither regression passes
until the pure checks move. No temporary production mutations were needed in F1c.

## Exact blobs and review boundary

| Path | Blob |
|---|---|
| `src/infra/config/settings-file.ts` | `47ab73fbfe612adb9fe546d51241fa9f160645ff` |
| `tests/unit/config.test.ts` | `50c008a8ad045a0a20b7ab4562f14a50b9c9210d` |
| `AGENTS.md` | `595490ef04a7752518d406e5daececb7ecdff4cb` |
| Preserved `tests/unit/server/bff-flow.test.ts` | `bc41eebb2729f955acdbe4a8990e5d788ff2810a` |
| Preserved `tests/unit/dashboard/client-transport.test.ts` | `a4fe95a56eebd7af661b27b00df794baa9003342` |
| Preserved `src/server/dashboard/routes/api.ts` | `a6fb0f45ac423a5f6c1c5439a51a51dabda013ab` |
| Preserved `src/dashboard/client/transport.ts` | `f65a6c574539a1cbd6535e4005acb1a7b80dce8b` |
| Preserved `reports/dcc1-f1b.md` | `b8013b7cdee9b5adf6d46d96ad17496b01ec82de` |

F1b remains an accurate PARTIAL report of its own scope and historical red gate. This authorized
F1c repair resolves that specific remaining production issue; it does not rewrite the earlier
report or claim full DCC1 completion. The dated nearest-AGENTS lesson explains why a nominal read
is a mutation and why pristine refusal tests must not initialize their fixtures.

Review hint: independently check that both request-owned mismatches return before all filesystem
access while valid requests still enter unchanged exclusive authority. Parent owns independent
Correctness/Silent-failures review, remaining full/heavy acceptance and the merge commit.

All owned gate processes finished with observed terminal exits. Only the four F1c paths above are
explicitly staged by this increment; parent report/spec edits remain unstaged. The exact final index
tree is returned with this report, not embedded into the report that contributes to that tree.
Light-gate admission returns to the parent.
