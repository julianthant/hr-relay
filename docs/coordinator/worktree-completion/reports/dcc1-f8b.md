# DCC1 F8b — shared authenticated Settings observation

## Archival note — 2026-08-30

Lossless `.gz` copies now accompany the exact inventoried plaintext evidence; originals remain
untouched. Evidence links below resolve to archives. All historical commands, literal raw paths,
verdicts, byte counts and SHA256 values still describe the original plaintext, recovered with
`gzip -d -c ARCHIVE_PATH`. This packaging does not change evidence provenance or imply a commit.
See [packaging manifest](../evidence/dcc1-packaging-manifest.json) for original-to-archive mapping,
both hashes, original staged blobs and round-trip receipts. Index replacement/freeze is parent-owned.
Historical status and staging statements below remain statements about their original receipt time.


STATUS: bounded implementation returned for independent review; NOT full-gate-ready or task complete.
ROLE: `sup_sol_dcc1_f8b_shared_authenticated_observation`. MODEL: native Sol. REASONING: high; assigned 240k/220k profile.
COMMITS: none. STAGING: none. No new workers, tasks or worktrees.

## Result and exact receive boundary

The unchanged single-command-path guard now passes through one private read-and-authenticate
classifier in `src/server/settings-runtime.ts`. Public signatures, authority writers, activation,
SQLite/file exclusion, final verification and F5 single file acquisition are unchanged.
The codebase-design refactor used two verified transformations: extract exact command validation,
then join admission/recovery authentication while preserving caller-specific error precedence.
The nearest AGENTS lesson records why eager validation reordering is not equivalent.

Sole light lane explicitly released to parent and coordinator after lint ended
**2026-08-30T16:59:44.161Z**. All this worker's gates/logger processes exited naturally; no
owned process, browser or subunit remains active. No source/test edits after release. Parent
independent verification may run during report packaging; this is not a claim that other sessions
are idle. Parent-created `dcc1-f8b-parent-*` receipts are not this worker's gates.

Every shell workdir/edit was the assigned
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`;
branch `feature/r-dcc-dcc1-exclusive`.
Complete index remains **`0b5ae741d88e83b816705dd3ecf504dd5ebeaf59`**, with no unresolved entries.
Pending merge and all parent changes preserved.

| Owned tracked path | Frozen index blob → returned working blob |
| --- | --- |
| src/server/settings-runtime.ts | `ddf323be869cbcf61a031bfb710a32e8a82bda06` → `f0746f5f649d5c0bcea055852b9d3345d72c45e5` |
| tests/unit/server/compose-real-port.test.ts | `31c93984f51fb261123f691584b2fda3f418abd5` → `7edb5c38b5fb112c8ced91a2895d225349a4e644` |
| AGENTS.md | `3e5940007eba8341f1b0ea69e8c50a56b2ebb5ee` → `28a672ae2317d66acb058e4df0fe9163de2410f4` |

Additional owned outputs: this report, `dcc1-f8b-*.raw.log` and matching metadata listed below,
plus [receipts](../evidence/dcc1-f8b-receipts.json),
[return state](../evidence/dcc1-f8b-return-state.json), and
[exact owned diff against 0b5](../evidence/dcc1-f8b-owned.diff.gz).
The report/status delta in `reports/dcc1.md` belongs to parent and was not edited or staged.
Owned tracked diff: source +63/−29, tests +175/−1 (import extension, no assertion deletion),
AGENTS +5. Existing F2/F2b/F5/F7 tests and corruption fixtures remain intact.

Guard blob remains `dc10fa414fc60b4f0115ae943cef9f58919bd8b0`, including count and allowlist.
Dry-run runtime remains `ec2933b2587eee5359abd0c7d7b44952ff9d38de`.
No core/CLI/worker/repository/migration/reference/runtime-dry-run source edits.
The old index closure `36ec6220ce59f8fc9c63eae3057df32771bbd28b0ea055de243f83efaeb5a29e`
is no longer the working execution closure. Substituting only the three verified working blobs
into its tracked listing gives **`d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051`**.
This is a derived working-tracked listing hash, NOT a new staged tree or allocated full-gate proof;
the exact recipe and inventory are in return-state.

## Baseline pins and transformation

Before any production edit, 18 cases exercised existing public `requireJournaledSettings`,
ordinary `readJournaledSettings`, and real prepared recovery. Six competing-fault vectors per
entry pin simultaneous malformed command/audit/current, malformed command+audit, malformed
audit+current, divergent command envelope+malformed audit, missing command+malformed audit,
and divergent audit+current. Two attempts each assert the selected named diagnostic and exact
file/prepare/initialization/rollback presence, raw durable rows and authority metadata preservation.
Only temporary already-open SQLite authorities are corrupted; no live authority is touched.

Receipt precision (filenames are not verdicts):

- `baseline-precedence` 35096: **9 failed/9 passed/28 skipped**, exit1/logger0. Nine setups
  failed the immutable current advance trigger.
- `baseline-precedence-pinned` 41237: **9 failed/9 passed/28 skipped**, exit1/logger0.
  Updating only JSON revision still failed that trigger because its indexed revision was unchanged.
- `baseline-precedence-green` 75298: despite its name, **3 failed/15 passed/28 skipped**,
  exit1/logger0. These reached the public seam but the injected audit revision violated its strict
  restartRequired/exact-revision/fingerprint refinement, before semantic audit identity checking.
- `baseline-precedence-verified` 99632: **18 passed/28 skipped**, exit0/logger0 at unchanged
  source `ddf323be...`; test blob `5c41d07ddc732651b7dc90c1e51ee34d2263cf6f`.
  Corrected fixtures advance current's indexed and JSON revision together and use a schema-valid
  divergent audit fingerprint. No production policy or existing assertion was weakened.

Command extraction (interim source identity `1da0e90d7d3a16014399e986fe589fac1d22631b`,
not claimed retained as a Git object) passed 51 tests, session68136.
Classifier source `f0746f5f...` then passed the four-file matrix77/77, session90496.
One additional real-function-observed query-bound case passed, session70903, bringing the final
matrix to78. It authenticates committed prepare then final readback (two exact command/audit/current
reads each), performs a fresh ordinary read (one additional each), and asserts exact returned record,
unchanged file/durable rows, prepare cleanup and one lock per public read. Wrappers forward to
the real repositories; no fabricated results or mock authority.

The classifier's required arm receives the current row read first by its public caller, validates
the exact command before its sole audit lookup, then authenticates audit/current. The prepared arm
reads command, audit, current in the original order; absence requires command and audit absent
AND current not naming the exact command. Any other evidence must authenticate. Recovery keeps
authenticated next, or proves absence then authenticates prior before rollback. No observation
escapes the synchronous invocation; final post-reconciliation verification is still fresh.

## Original red retained

Full coverage87688 and exact minimized guard50617 remain the actual pre-repair red, unchanged.
Both reported `settings-runtime.ts may only authenticate settings through one commandAudits.findByCommand read`.
[Full-gate receipts](dcc1-full-gates.md) and [F8 diagnosis](dcc1-f8-analysis.md) retain their commands.
Coverage raw SHA256 remains `6db1a56603ad76aa3b859445e315a76ee2b1701bbb23ac72d5b573dd6de311e8`.
No new full coverage/parity, coverage floor, suite-size, browser, HR/auth or activation proof is claimed.

## Mutation sensitivity

Each meaningful mutation changed only Settings runtime, was stored with
`git hash-object -w src/server/settings-runtime.ts` BEFORE its test, and was immediately restored
and hash-checked to `f0746f5f649d5c0bcea055852b9d3345d72c45e5` before the identical restored test.
All ten meaningful mutations exit1, all corresponding restores exit0, every logger exit0.
The exact before/after text is retained in receipts JSON; stored blob pairs can be independently
compared with `git diff f0746f5f649d5c0bcea055852b9d3345d72c45e5 MUTANT_BLOB`.
The [per-mutation proof index](../evidence/dcc1-f8b-mutation-proof.json) joins each retained blob
to the red process's disk-first source metadata and the restored process's exact source hash,
named failing assertion, counts, sessions and raw hash. The pre-run `hash-object -w` operations
and immediate restore/hash checks were executed tool steps, not separately raw-logged processes;
the subsequent restored metadata independently records the bytes used by every green run.

| Mutation | Retained mutant blob | Raw evidence |
| --- | --- | --- |
| ignore-audit-only | `92688d25c1d528480c865d50f197678c21f26c34` | [red](../evidence/dcc1-f8b-ignore-audit-only-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-ignore-audit-only-restored.raw.log.gz) |
| skip-pre-settlement-authentication | `e1a82de9d713f3ff35adfe6d08b1c55a702d5837` | [red](../evidence/dcc1-f8b-skip-pre-settlement-authentication-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-skip-pre-settlement-authentication-restored.raw.log.gz) |
| skip-prior-authentication-matched | `468c7cc45a3cb2649f82a979d2a3733dafb4f545` | [red](../evidence/dcc1-f8b-skip-prior-authentication-matched-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-skip-prior-authentication-matched-restored.raw.log.gz) |
| break-audit-identity | `ce0ed985d9ed4148be2c715adaca04d60d72fb8f` | [red](../evidence/dcc1-f8b-break-audit-identity-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-break-audit-identity-restored.raw.log.gz) |
| break-current-identity | `b40cf12511dd4963b798591d8497f0532e88a137` | [red](../evidence/dcc1-f8b-break-current-identity-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-break-current-identity-restored.raw.log.gz) |
| duplicate-file-acquisition | `6443fb8f2cbc59ee111fb668d95a982a46a99e13` | [red](../evidence/dcc1-f8b-duplicate-file-acquisition-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-duplicate-file-acquisition-restored.raw.log.gz) |
| observation-outside-exclusion | `8df6719fc067835cc5f0163a56834bde86932eb1` | [red](../evidence/dcc1-f8b-observation-outside-exclusion-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-observation-outside-exclusion-restored.raw.log.gz) |
| duplicate-observation | `22db2ad4aa1df1b913cfb7f48b9471496c83a977` | [red](../evidence/dcc1-f8b-duplicate-observation-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-duplicate-observation-restored.raw.log.gz) |
| ordinary-precedence | `0d12544fdf6b67555b244c5ecfe31bb865678e26` | [red](../evidence/dcc1-f8b-ordinary-precedence-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-ordinary-precedence-restored.raw.log.gz) |
| prepared-precedence | `bb6b910b2bf3e1a70ce5688bee8576a6c1a16dbc` | [red](../evidence/dcc1-f8b-prepared-precedence-red.raw.log.gz) / [restored](../evidence/dcc1-f8b-prepared-precedence-restored.raw.log.gz) |

Observed failure mechanisms: ignoring audit-only presence loses the refusal; skipping authentication
before settlement deletes prepare before final verification refuses; skipping prior authentication
changes live revision-3 bytes before refusing. Removing audit fingerprint/current completion checks
loses the corresponding refusal. Duplicate file acquisition reads twice (2≠1); moving file observation
outside SQLite exclusion allows the real contender. Duplicate observation yields 3≠2 reads per row.
Ordinary eager audit read selects malformed-audit instead of command-envelope/missing-command (4 red);
prepared current-first read selects malformed-current instead of command/audit (2 red).

One initial prior-authentication filter matched **zero tests** (2490 and82716,47 skipped each,
exit0/logger0); this is NOT sensitivity or passing-test proof. Source was restored immediately,
then the same stored mutation was rerun against the matching four-case describe (65084:3 red/1 pass;
92235:4 pass). An initial audit-mutation patch context failed to match before any edit or test;
the exact full-line patch then produced the retained mutation above. No excluded source was touched.

## Command receipts and final gates

Every focused command used this exact prefix; selected suffix/file/filter are retained verbatim
per gate in the disk-first metadata and receipts JSON:

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/control-command-single-path.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/server/settings-runtime-reader.test.ts tests/unit/dry-run-scenario-composition.test.ts
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Final focused67174: **78/78, four files,14.11s, exit0/logger0**.
Fresh locked typecheck50470 and lint30055: **exit0/logger0**, no diagnostics, sequential.
`git diff --check` emitted no diagnostics. No staging, commit, lock unlink, timeout/assertion
change, probe lane or foreign process termination.

All times below are UTC on2026-08-30. A missing transport session means the tool returned the
completed process on its initial call, not that no command ran.

| Receipt (raw log) | Session | Start–end UTC | Gate/logger | Actual tests |
| --- | --- | --- | --- | --- |
| [baseline-precedence](../evidence/dcc1-f8b-baseline-precedence.raw.log.gz) | 35096 | 16:52:44.973–16:52:49.373 | 1/0 | Tests  9 failed / 9 passed / 28 skipped (46) |
| [baseline-precedence-pinned](../evidence/dcc1-f8b-baseline-precedence-pinned.raw.log.gz) | 41237 | 16:53:27.532–16:53:32.503 | 1/0 | Tests  9 failed / 9 passed / 28 skipped (46) |
| [baseline-precedence-green](../evidence/dcc1-f8b-baseline-precedence-green.raw.log.gz) | 75298 | 16:53:51.572–16:53:56.128 | 1/0 | Tests  3 failed / 15 passed / 28 skipped (46) |
| [baseline-precedence-verified](../evidence/dcc1-f8b-baseline-precedence-verified.raw.log.gz) | 99632 | 16:54:10.209–16:54:14.550 | 0/0 | Tests  18 passed / 28 skipped (46) |
| [extract-command-green](../evidence/dcc1-f8b-extract-command-green.raw.log.gz) | 68136 | 16:54:30.448–16:54:41.085 | 0/0 | Tests  51 passed (51) |
| [shared-observation-green](../evidence/dcc1-f8b-shared-observation-green.raw.log.gz) | 90496 | 16:55:02.357–16:55:16.467 | 0/0 | Tests  77 passed (77) |
| [observation-bound-green](../evidence/dcc1-f8b-observation-bound-green.raw.log.gz) | 70903 | 16:55:49.222–16:55:54.345 | 0/0 | Tests  1 passed / 46 skipped (47) |
| [ignore-audit-only-red](../evidence/dcc1-f8b-ignore-audit-only-red.raw.log.gz) | 5350 | 16:56:24.362–16:56:27.160 | 1/0 | Tests  1 failed / 46 skipped (47) |
| [ignore-audit-only-restored](../evidence/dcc1-f8b-ignore-audit-only-restored.raw.log.gz) | 27681 | 16:56:27.326–16:56:29.835 | 0/0 | Tests  1 passed / 46 skipped (47) |
| [skip-pre-settlement-authentication-red](../evidence/dcc1-f8b-skip-pre-settlement-authentication-red.raw.log.gz) | 89335 | 16:56:33.255–16:56:35.791 | 1/0 | Tests  1 failed / 46 skipped (47) |
| [skip-pre-settlement-authentication-restored](../evidence/dcc1-f8b-skip-pre-settlement-authentication-restored.raw.log.gz) | 40642 | 16:56:35.959–16:56:38.453 | 0/0 | Tests  1 passed / 46 skipped (47) |
| [skip-prior-authentication-red](../evidence/dcc1-f8b-skip-prior-authentication-red.raw.log.gz) | 2490 | 16:56:41.907–16:56:44.375 | 0/0 | Tests  47 skipped (47) |
| [skip-prior-authentication-restored](../evidence/dcc1-f8b-skip-prior-authentication-restored.raw.log.gz) | 82716 | 16:56:44.548–16:56:46.954 | 0/0 | Tests  47 skipped (47) |
| [skip-prior-authentication-matched-red](../evidence/dcc1-f8b-skip-prior-authentication-matched-red.raw.log.gz) | 65084 | 16:56:56.167–16:56:59.455 | 1/0 | Tests  3 failed / 1 passed / 43 skipped (47) |
| [skip-prior-authentication-matched-restored](../evidence/dcc1-f8b-skip-prior-authentication-matched-restored.raw.log.gz) | 92235 | 16:56:59.604–16:57:02.735 | 0/0 | Tests  4 passed / 43 skipped (47) |
| [break-audit-identity-red](../evidence/dcc1-f8b-break-audit-identity-red.raw.log.gz) | 50379 | 16:57:17.627–16:57:20.795 | 1/0 | Tests  1 failed / 3 passed / 43 skipped (47) |
| [break-audit-identity-restored](../evidence/dcc1-f8b-break-audit-identity-restored.raw.log.gz) | 53806 | 16:57:20.949–16:57:24.092 | 0/0 | Tests  4 passed / 43 skipped (47) |
| [break-current-identity-red](../evidence/dcc1-f8b-break-current-identity-red.raw.log.gz) | 87929 | 16:57:27.479–16:57:30.632 | 1/0 | Tests  1 failed / 3 passed / 43 skipped (47) |
| [break-current-identity-restored](../evidence/dcc1-f8b-break-current-identity-restored.raw.log.gz) | 76564 | 16:57:30.785–16:57:33.962 | 0/0 | Tests  4 passed / 43 skipped (47) |
| [duplicate-file-acquisition-red](../evidence/dcc1-f8b-duplicate-file-acquisition-red.raw.log.gz) | completed in initial call | 16:57:42.202–16:57:43.288 | 1/0 | Tests  1 failed / 4 skipped (5) |
| [duplicate-file-acquisition-restored](../evidence/dcc1-f8b-duplicate-file-acquisition-restored.raw.log.gz) | completed in initial call | 16:57:43.441–16:57:44.504 | 0/0 | Tests  1 passed / 4 skipped (5) |
| [observation-outside-exclusion-red](../evidence/dcc1-f8b-observation-outside-exclusion-red.raw.log.gz) | completed in initial call | 16:57:49.533–16:57:50.576 | 1/0 | Tests  1 failed / 4 skipped (5) |
| [observation-outside-exclusion-restored](../evidence/dcc1-f8b-observation-outside-exclusion-restored.raw.log.gz) | completed in initial call | 16:57:50.726–16:57:51.761 | 0/0 | Tests  1 passed / 4 skipped (5) |
| [duplicate-observation-red](../evidence/dcc1-f8b-duplicate-observation-red.raw.log.gz) | 59844 | 16:57:58.407–16:58:00.638 | 1/0 | Tests  1 failed / 46 skipped (47) |
| [duplicate-observation-restored](../evidence/dcc1-f8b-duplicate-observation-restored.raw.log.gz) | 54306 | 16:58:00.788–16:58:02.990 | 0/0 | Tests  1 passed / 46 skipped (47) |
| [ordinary-precedence-red](../evidence/dcc1-f8b-ordinary-precedence-red.raw.log.gz) | 46052 | 16:58:06.876–16:58:09.810 | 1/0 | Tests  4 failed / 8 passed / 35 skipped (47) |
| [ordinary-precedence-restored](../evidence/dcc1-f8b-ordinary-precedence-restored.raw.log.gz) | 11439 | 16:58:09.968–16:58:12.940 | 0/0 | Tests  12 passed / 35 skipped (47) |
| [prepared-precedence-red](../evidence/dcc1-f8b-prepared-precedence-red.raw.log.gz) | 10683 | 16:58:18.053–16:58:21.409 | 1/0 | Tests  2 failed / 4 passed / 41 skipped (47) |
| [prepared-precedence-restored](../evidence/dcc1-f8b-prepared-precedence-restored.raw.log.gz) | 93291 | 16:58:21.648–16:58:25.045 | 0/0 | Tests  6 passed / 41 skipped (47) |
| [final-focused](../evidence/dcc1-f8b-final-focused.raw.log.gz) | 67174 | 16:58:46.134–16:59:00.629 | 0/0 | Tests  78 passed (78) |
| [typecheck](../evidence/dcc1-f8b-typecheck.raw.log.gz) | 50470 | 16:59:02.733–16:59:15.886 | 0/0 | no diagnostics |
| [lint](../evidence/dcc1-f8b-lint.raw.log.gz) | 30055 | 16:59:17.967–16:59:44.161 | 0/0 | no diagnostics |

The inline Node logger opens unique raw/metadata paths with `wx` after checking nonexistence;
each stdout/stderr chunk is written to disk before forwarding, without normalization. Start and
end JSON records (exact command, cwd, source identity, UTC timestamps, gate/signal/logger statuses)
are separately fsynced before tool transport. Raw logs preserve the received stream chunks;
cross-stream ordering is arrival order. These are not relabeled historical normalized receipts.
All32 owned process receipts completed; no logging failure was observed.

| Raw receipt | Bytes | SHA256 |
| --- | --- | --- |
| baseline-precedence | 3524 | `3ed1c830ebf26f31212b3730a7da69a64df3eb92cf7e7d25e2dbb161f3e87b16` |
| baseline-precedence-pinned | 3524 | `0451d7c820dcc19868157329780af12c0d5ca6c5c430f14c43041f8048d7196c` |
| baseline-precedence-green | 2297 | `e374019ee5cb1627c0e0d0eb5d656b162d5e401fb5f90ef050dcfa13237afaa5` |
| baseline-precedence-verified | 455 | `d95fc0c523b87cc808928c902223d1cac137641ed6f6fefb30faa559c6d548cf` |
| extract-command-green | 506 | `c7b50bade8056f7c9c86a5bf667464da9023ce1c5fa32d6b42357a449be4eb71` |
| shared-observation-green | 667 | `9bd583bb200dbc32b9fdb76c59df30a932ba8008df65ad6a48d31105cf537c34` |
| observation-bound-green | 457 | `ec15a8f8684335d8793a9d298e91cc0a2ca3e887b3208be453f09059bd7a3951` |
| ignore-audit-only-red | 1129 | `e04d4d301841585413f9c84170656a1269d1f813da73c3e6ea85907e42ef84bf` |
| ignore-audit-only-restored | 431 | `0bee435c36b567e4df8c517fa640c4f8afc509f5e95a85c711432764d64c57d8` |
| skip-pre-settlement-authentication-red | 1332 | `91e5d53bf4cf8c906b2ebcf5447a6f25007ef7e4525ac3f35435a2b6319be569` |
| skip-pre-settlement-authentication-restored | 431 | `ac584a748c721e991829ff35340f14ed432a0bc2845fc923d776710c2599f8a9` |
| skip-prior-authentication-red | 454 | `255b859171f228e931405db67cb8064ff53a119e82bac65d11fc42cb66d0d60f` |
| skip-prior-authentication-restored | 454 | `f77263edf81cdd3686f2db0c0d003c05a66ff4aba96089462df9d26748ce8442` |
| skip-prior-authentication-matched-red | 10405 | `624d5e2607b3e49484d48b03765abf62dfbb6dcfbdfc25120be28fa372f5e654` |
| skip-prior-authentication-matched-restored | 465 | `86a79e3938bfa4687f78ae0236eea3a03f2ada83b3fa36e17dec4567a090b344` |
| break-audit-identity-red | 1279 | `24c748f50461e72030195c51669ebdf2de513c082899d7d724fb4ed4664f7a76` |
| break-audit-identity-restored | 465 | `b8e5a8da343416a3a04dd1da52ef4e2e27814e9d0ab9a7ca2fa5711d74584fd6` |
| break-current-identity-red | 1279 | `baf2ec7c9171eb71631d8805dbc255cf8de60d7e14f771fe74406afd7c93c6da` |
| break-current-identity-restored | 465 | `295af1686227276ca289bbcb8c20833c986a3c775dd7d15661fd08ecfda0e675` |
| duplicate-file-acquisition-red | 1242 | `fbfd17b2b6c83d4bb536553730241564aca7a66fa6c089aa7f95fac21e023553` |
| duplicate-file-acquisition-restored | 412 | `5bb924791284b914ece9f9a2ef41daf6a628828d72697742431c5e49db0ac11b` |
| observation-outside-exclusion-red | 1634 | `934a95234ab998ee5e0a86eb80203ea7ea35f92a2521c87b35c3700d664faa17` |
| observation-outside-exclusion-restored | 412 | `7375985b17849493e671999b688bc0cdec0d14c77a91493648f1931e3e74d15e` |
| duplicate-observation-red | 1438 | `5affaa1fd229c4bf8a35b0295eb9c7684607fc60225b09009d4a3f74123ea52c` |
| duplicate-observation-restored | 457 | `e36a0c30d89e7af67b2c3e7479ca75bdca4e33d10df8d52ae660df0f0164486c` |
| ordinary-precedence-red | 3666 | `ff7e858ae9afe174607860920919854b90b8dabe6da5ba3b849fb510a35aa177` |
| ordinary-precedence-restored | 465 | `90d523c36a1b1c58e2b08f20ac53d6562fc30fbad0b8dc05004d6418768544d5` |
| prepared-precedence-red | 3141 | `d6f36a7f6e57b7a22d01435f10438efb550fef38294676389835ca694b6dd12e` |
| prepared-precedence-restored | 451 | `7ba8ec1f7769e1d4c71b3bdce5a489b40a91d11a508f27a4283b42a4ba5bc0ac` |
| final-focused | 669 | `79b522949204df9f8fa6267283f79a20ff311c82bb0a6c67d84c2cbd7922ca90` |
| typecheck | 57 | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |
| lint | 81 | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |

## Limits and review handoff

Public temp-authority admission/refusal, file retention, real SQLite exclusion and synthetic F7
start regressions are covered; no live HR/UI/auth, broad performance benchmark, or global migration
compatibility is claimed. Query bounds are observed at the existing repository API, not a claim
about every internal SQLite SELECT. Temporary fault injection bypasses only fixture validity to
test refusal; durable artifacts are asserted before fixture teardown, not retained live databases.

Parent must independently receive/rerun and complete selected Tests/Standards/Correctness/Silent
Failures/Security/Performance review, then renew freeze and obtain full-gate allocation before any
product commit. No new policy/authority conflict or required interface expansion was found here.
Cross-run immutable v19–21 collisions and D75 final integration semantics remain coordinator-owned,
unchanged; [migration residue](dcc1-migrations.md) remains applicable. No history rewrite, migration,
or globally collision-free claim.
