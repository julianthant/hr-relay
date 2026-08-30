# DCC4 gate-evidence archive manifest

2026-08-30. Archived only this task's exact new logs, AFTER the heavy slot was released.
Original plaintext was retained untouched during compression and round-trip verification.
No previously committed raw-history file, ignore policy, source or test setting was rewritten.

## Identity and provenance

Full green gates executed with HEAD `49c6206cbc3d3e30e97603628590823787d120d8`,
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`, and index tree
`9ede08fa4842eaf9d4e26aa6beeec0b132baf3e8`. Actual terminal command receipts/session
IDs are in [M4](../reports/dcc4-m4.md). Earlier red/light results are distinct, not substituted.
The original full-red SHA256 remains `192d2a098effb567ef5be9ad9d3ac3a3b0f79c7fbff590b85213a5c505261297`.

All original paths below are relative to the repository directory
`docs/coordinator/worktree-completion/evidence/`; each archive is that exact original
path with `.gz` appended. Links name every exact tracked archive. Plaintext copies are
retained until archive/manifest commit durability is verified, then moved without alteration
to ignored `test-results/dcc4-raw-evidence/<original-basename>` in this assigned worktree.
They are not deleted. Decompression from the committed archive is the portable evidence.

`gzip -n -k` produced deterministic archives, preserving original inputs. Every archive
was decompressed and compared with its original using `gzip -cd ARCHIVE | cmp - ORIGINAL`;
all 18 comparisons exited0. Both hashes were then recorded below. Compression is lossless;
it does not restore earlier normalized logs to raw status.

## Commands

All commands ran in `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`.
Output capture used `tee` with pipefail, so the recorded exit is not tee's successful exit.

- **coverage:** `/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage`.
- **parity:** `/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity`.
- **typecheck:** `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck`.
- **lint:** `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint`.
- **manifest:** `npm run build:manifest`; the verified runs also checked `git diff --exit-code -- src/domain/workflow/generated-build-manifest.ts`.
- **roadmap:** `npm run roadmap`.
- **roadmap-check:** `npm run roadmap:check`.
- **redaction-focused:** `VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run tests/unit/architecture/redaction-surface-scan.test.ts -t 'registers every surface-bearing module in both directions' --maxWorkers=1 --reporter=dot`.
- **embedded commands:** the decompressed log records every exact COMMAND and EXIT alongside its raw output. See [M3F](../reports/dcc4-m3f.md) for the sequence and mutation restoration; all focused commands use one worker.

## Per-file receipts

| Original basename / tracked archive | Command | Exit | Classification / scope |
|---|---|---|---|
| [dcc4-coverage-m3f.log](dcc4-coverage-m3f.log.gz) | coverage | 0 | raw; 9ede: 336 files / 3721 tests; 323.84s |
| [dcc4-coverage.log](dcc4-coverage.log.gz) | coverage | 1 | raw; dbd1: 335 passed / 1 failed files; 3717 passed / 1 failed tests |
| [dcc4-lint-m3f.log](dcc4-lint-m3f.log.gz) | lint | 0 | raw; 9ede |
| [dcc4-lint-repaired.log](dcc4-lint-repaired.log.gz) | lint | 0 | normalized; dbd1; final blank line removed before this archive |
| [dcc4-manifest-final.log](dcc4-manifest-final.log.gz) | manifest | 0 | raw; earlier redundant generator run, not counted twice |
| [dcc4-manifest-m3f.log](dcc4-manifest-m3f.log.gz) | manifest | 0 | raw; 9ede; generated manifest unchanged |
| [dcc4-manifest-verified.log](dcc4-manifest-verified.log.gz) | manifest | 0 | raw; dbd1; generated manifest unchanged |
| [dcc4-parity-m3f.log](dcc4-parity-m3f.log.gz) | parity | 0 | raw; 9ede: 239 passed / 3.3m |
| [dcc4-redaction-focused-red.log](dcc4-redaction-focused-red.log.gz) | redaction-focused | 1 | raw; dbd1; surviving dormant module lacks disposition |
| [dcc4-redaction-m3f-green.log](dcc4-redaction-m3f-green.log.gz) | embedded commands | all 0 | raw output + receipt metadata; 7 full files / 122 distinct tests plus repeated focused case |
| [dcc4-redaction-m3f-red.log](dcc4-redaction-m3f-red.log.gz) | embedded commands | all 1 | raw output + receipt metadata; schema/origin/exception/misclassification controls |
| [dcc4-roadmap-check-m3f.log](dcc4-roadmap-check-m3f.log.gz) | roadmap-check | 0 | raw; 9ede |
| [dcc4-roadmap-check.log](dcc4-roadmap-check.log.gz) | roadmap-check | 0 | raw; pre-M3F final docs |
| [dcc4-roadmap-generate.log](dcc4-roadmap-generate.log.gz) | roadmap | 0 | raw; pre-M3F final docs |
| [dcc4-typecheck-final.log](dcc4-typecheck-final.log.gz) | typecheck | 2 | raw; 202a; missing readAll fixture adapter |
| [dcc4-typecheck-m3f.log](dcc4-typecheck-m3f.log.gz) | typecheck | 0 | raw; 9ede |
| [dcc4-typecheck-repaired.log](dcc4-typecheck-repaired.log.gz) | typecheck | 0 | normalized; dbd1; final blank line removed before this archive |
| [dcc4-typecheck.log](dcc4-typecheck.log.gz) | typecheck | 75 | raw; queued; lock not acquired, compiler not run |

## Per-file SHA256

| Original basename | Original SHA256 | Archive SHA256 |
|---|---|---|
| dcc4-coverage-m3f.log | `63323f4cb0a9e94c49757e2c9edecbcacb314ff19dc26b9b60d3feeb3ffcb45a` | `233fc2caa850bf986e6cdf6acc0623233f120d62d0365b5fc396a4ac62a0c2b7` |
| dcc4-coverage.log | `192d2a098effb567ef5be9ad9d3ac3a3b0f79c7fbff590b85213a5c505261297` | `2e6be28e2eb8d107e9595fe99228f9999ac73a661ac0accfc2a8fadcfe21d058` |
| dcc4-lint-m3f.log | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` | `e03600cf5ac3f6eb3d9c8ae1a7b5fd4cda26d19b67a84cdef1417155fdb877c4` |
| dcc4-lint-repaired.log | `cb7be44dd78cd02573693e016d5aa716ff343edf440e3173cdb86bd0a15d4fbd` | `bb89103f52ff503c10b8dc8e148c8d2a2c1bb86ba06f1d38120f6e5953c79418` |
| dcc4-manifest-final.log | `4c881ebbb1fe41db46be8dd58981514fcdb8c921e48b657da0018843dc0df8ad` | `78cc14236392f9ea0a06a8c5f07289d4f82289bbcc74ac5d869cf980c1a8e83f` |
| dcc4-manifest-m3f.log | `4c881ebbb1fe41db46be8dd58981514fcdb8c921e48b657da0018843dc0df8ad` | `78cc14236392f9ea0a06a8c5f07289d4f82289bbcc74ac5d869cf980c1a8e83f` |
| dcc4-manifest-verified.log | `4c881ebbb1fe41db46be8dd58981514fcdb8c921e48b657da0018843dc0df8ad` | `78cc14236392f9ea0a06a8c5f07289d4f82289bbcc74ac5d869cf980c1a8e83f` |
| dcc4-parity-m3f.log | `368cbab319982fac64d3d40e206dd0fe694d33bce66acd2021411b81dc812872` | `c304c6d5a7a9cf88f1706c10afd7b4be8a3760b33610f945dc521c872bd727d8` |
| dcc4-redaction-focused-red.log | `c9bf9d98242ff3bcfe22da7323bedd5cf1ef03b9108abbada03a8fa27224b593` | `870005d7451cfd6ef16aafd5c4d342e82336373dc977fc4d630e53601d0daf3e` |
| dcc4-redaction-m3f-green.log | `0c5f801f68e2c14f8a1803d019efe80853c56a4d0d683f6e55db37663dc9bbf3` | `79ecb120c2af257c7c842da8feeb5c361a419b031e13e24bba161431f1360dfc` |
| dcc4-redaction-m3f-red.log | `674cbd5e34b6aebb06c8fd2937178dbf21988dbda229fa64aaa413ef8cc3583f` | `d6dde380a831b1c5e1358ec256297892855693e1503b5abf18fb0c1d5411d180` |
| dcc4-roadmap-check-m3f.log | `5f1fc3bf701099ca19ea3a53dbb9c5f686c1f79210542607773331a523270f37` | `8562338b44b418afa3cd5dc5958617611e275af467bd5e8c0023cfd25081f9f4` |
| dcc4-roadmap-check.log | `5f1fc3bf701099ca19ea3a53dbb9c5f686c1f79210542607773331a523270f37` | `8562338b44b418afa3cd5dc5958617611e275af467bd5e8c0023cfd25081f9f4` |
| dcc4-roadmap-generate.log | `39cffad1d96e989ef65984fbbdcabbb061180b5913bb0259b202687851e6cfed` | `e1483c5cca27745a9d3c8e776be33f6711667ec2b77be3ecb61aa2da4e88e303` |
| dcc4-typecheck-final.log | `b9545993360d0ad2917d6a02664ef0269415a4c83c5488b93d574313edece205` | `1eb3f40c6a25bb209e4a6f79e8d39136827dea9fb05872b5b2bf5c7049f4bbb0` |
| dcc4-typecheck-m3f.log | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` | `628cf449cfa709101cc0591bfec9bac4e0603287b188a191c0f69c1bfbbcac5d` |
| dcc4-typecheck-repaired.log | `80be0cfe6803f678dc8aa2d9eb80c1026ce4a4bbf26c44de72092be4dc0b0f76` | `23a14f89f5e5712074ae328f8d9a83cfe1cd4dd10bfaeb7dad18f59f18220f29` |
| dcc4-typecheck.log | `4f7477c57366d18ad1b60315d896489e9e4f7a4a07b4d747e9cd1c0745c676e9` | `3b27612bb92e201a2890b5c0a0f67a83e866bc67d49d1ec5129ae0e04f794001` |

## Already-normalized Duo evidence (not re-archived)

The existing explicitly staged [Duo red](dcc4-duo-red.log) and [Duo green](dcc4-duo-green.log)
remain plaintext. Both had ONLY their final blank line removed, disclosed in [M3E](../reports/dcc4-m3e.md).
They are not raw byte-identical terminal captures; no compression claim changes that fact.
Their synthetic one-worker composition command and actual red EXIT1 (2 failed/6 passed),
then green EXIT0 (8 passed), are recorded in M3E.

- Red SHA256: `ad0ff98bb16d745423366ff476ff1eb587a8c8916010d3c0cee9b39299617893`.
- Green SHA256: `fc08cf2665bac5665719fff295fc4d2b3bae3c14913a3c7ace76711cc3ed807f`.

## Read and verify

From the assigned worktree (or any checkout of the final evidence commit):

```sh
gzip -cd docs/coordinator/worktree-completion/evidence/dcc4-coverage-m3f.log.gz
gzip -cd docs/coordinator/worktree-completion/evidence/dcc4-coverage-m3f.log.gz | shasum -a 256
shasum -a 256 docs/coordinator/worktree-completion/evidence/dcc4-coverage-m3f.log.gz
```

Compare decompressed and archive hashes with the same row above. Repeat with any listed
basename. To compare against the retained local plaintext after close-out:

```sh
gzip -cd docs/coordinator/worktree-completion/evidence/dcc4-coverage-m3f.log.gz |
  cmp - test-results/dcc4-raw-evidence/dcc4-coverage-m3f.log
```

Raw logs include ordinary synthetic-test warnings; these were not removed. No live HR workflow
was executed. This archive proves reported branch-local checks, not shared migration-history
acceptance or retired command-envelope compatibility.
