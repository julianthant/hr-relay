# DCA joined parity JSON fail-closed repair 15

Date: 2026-08-31  
Role: `sup_terra_parity_json_fail_closed_repair`  
Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`  
Index: empty

## Outcome

The parity JSON persistence path now fails closed at the ordinary npm command boundary.

- `npm run test:parity` and `npm run test:parity:update` both enter through one read-only verifier wrapper; npm arguments are appended byte-for-argument to the real Playwright CLI invocation.
- The wrapper refuses `PLAYWRIGHT_JSON_OUTPUT_FILE`, `PLAYWRIGHT_JSON_OUTPUT_DIR`, `PLAYWRIGHT_JSON_OUTPUT_NAME`, `--reporter`, `--config`, `--config=…`, `-c …`, and attached `-c…` before starting Playwright.
- Before launch it fingerprints any existing `tests/parity/.output/results.json`. After launch it requires a direct, non-symlinked regular file under the real `.output` root whose file identity changed and whose strict report `stats.startTime` is from this run.
- The built-in JSON is strict-parsed through the reporter's root/suite/spec/test/result/attachment/annotation shape. Missing, unreadable, malformed, redirected, stale, and evidence-empty reports refuse.
- Within each result, every `.a11y.yml`/`text/yaml` candidate must be exactly one body-backed, path-free attachment and exactly one same-name `a11y-attachment-sha256:` annotation. Base64 must be canonical, nonempty UTF-8; the annotation must be lowercase SHA-256 of those exact decoded bytes. Duplicate names across results, same-name path/body forms, duplicate attachments, duplicate or prefix annotations, and both orphan directions refuse.
- A nonzero Playwright result remains the returned primary exit. Verification still runs and is surfaced second. An exit-zero Playwright process with a missing/stale/unwritable reporter result becomes nonzero.

This closes the accepted findings: Standards HIGH output redirection, Silent MEDIUM attachment/annotation cardinality gaps, and Silent MEDIUM reporter `onEnd` write failure leaving Playwright exit zero.

## Scoped files

| Path | Before SHA-256 / bytes | After SHA-256 / bytes | Change |
| --- | --- | --- | --- |
| `AGENTS.md` | `6e7e2116483fd4b8cbb5788a581cc578c4f22344cc171a263291049241926de7` / 44633 | `ec5517a433aed5721a84364f2e596bff2c48821564c0c2a5d3bcac39b28f4d34` / 45364 | Added the fail-closed reporter-evidence lesson. |
| `package.json` | `925e28a274f321cdeda5bc7bd82db7537c6b3ebdfdcc457b806c300504b7ef18` / 2842 | `04e51a8942e16f6d3f423eaf826aac825649a96231ccc4ea4fbec46f71d38856` / 2804 | Routed both parity commands through the wrapper. |
| `scripts/verify-parity-json.ts` | absent | `eeb80a3e80e4357b9122a3601d78591627c565c95773c87c64429e6871a58941` / 12854 | Added read-only strict verifier and child orchestration. |
| `tests/unit/architecture/parity-reference-authority.test.ts` | `32605fa75178e57899365e8b15e3102a9fd1e08b36199fed75e40a6cfb4afc04` / 24365 | `c922321216bb2bb8af14979478b22b7db81de39f713d4588142fd728de849e46` / 25131 | Pinned npm wiring, overrides, and argument forwarding while retaining all D132 assertions. |
| `tests/unit/scripts/verify-parity-json.test.ts` | absent | `fc2750375ca1ede0dc866faea0a2d7d6a6713d176b34ac04264adb58881f1c11` / 15053 | Added strict report, cardinality, freshness, override, child and failure-order coverage. |

Repair14 inputs remain byte-identical and are not part of the repair15 patch:

- `playwright.parity.config.ts`: `76b685be64e6eb5d274f66c3cf7ce80984db026a192d125df5dbdf7d8727433b`
- `tests/parity/diagnostic-bundle-dialog.spec.ts`: `e7e8f710fceaf6cb6b20a9a7e7d1dc2f07e6a0e7074f8572eba08bcaf4b4b3a1`
- `tests/parity/run-captures.spec.ts`: `e2491b1809873b58aa7e41ec5c80d12e9587eb8ef23ed435e2b1e6974df2aaf2`
- repair14 report: `5b49e4f122169bbcef7236152c179490cc721a16766f2418c62796a80a6146dc`
- repair14 isolated patch: `ed1f0892eec010140bec3d9b91296b1a8bceb32ec450cc21a5b967cd31ae15eb`

No custom reporter, raw writer, reference helper, assertion/timeout/threshold/mask, product, materializer, history, migration, or reference corpus changed.

## TDD and controls

All focused Vitest runs used `VITEST_MAX_WORKERS=1` and `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`.

| Slice/control | Chunk | Exit | Evidence |
| --- | --- | ---: | --- |
| npm wiring red → green | `9b2ff3` → `41a4fd` | 1 → 0 | Direct Playwright package entry was observed, then the wrapper wiring passed. |
| valid report red → green | `fbfecd` → `b31c64` | 1 → 0 | Missing verifier export, then one exact fresh pair accepted. |
| strict malformed red → green | `6bac10` → `554dad` | 1 → 0 | Raw schema error, then named malformed-report refusal. |
| command forwarding red → green | `7ba23c` → `b630d1` | 1 → 0 | Five parser tests passed while orchestration was absent; real child forwarding then passed. |
| command failure matrix | `d2fc1d` | 0 | Pre-spawn override, missing, simulated unwritable, stale, and child-primary ordering passed. |
| digest bypass | `5a4b8b` | 1 | Exact-body digest assertion caught the temporary bypass. |
| cardinality bypass | `74fcfc` | 1 | Duplicate attachment assertion caught the temporary `>=1` weakening. |
| freshness bypass | `dbc193` | 1 | Prior-report identity assertion caught the temporary stale guard removal. |
| post-verifier bypass | `ea7582` | 1 | Missing-output command returned zero and the test caught it. |
| override bypass | `d45797` | 1 | The child ran instead of pre-spawn refusal and the test caught it. |

Every mutation was applied alone and restored. The verifier returned to SHA-256 `cabe8fd4…` after the original controls; the final attached-`-c` addition then produced the reviewed final SHA-256 `eeb80a3e…`.

The direct `EISDIR` line in command-matrix green logs is intentional child stderr from the simulated reporter write failure. The child catches it and exits zero; the wrapper's missing/unreadable verification is what makes the command result nonzero.

## Final gates

| Gate | Chunk | Exit | Result |
| --- | --- | ---: | --- |
| Focused two-file suite | `ac4a9a` | 0 | 2 files / 21 tests passed. |
| Locked full typecheck | `797c83` | 0 | `tsc --noEmit` passed. |
| Locked full lint | `abf0e4` | 0 | ESLint passed with zero warnings. |

An earlier locked typecheck (`88bbc5`, exit 2) found only that the synthetic test attachment did not type its optional `path`. The fixture was corrected without weakening behavior, a path-only refusal was added, focused tests returned 21/21, and both final locked gates passed.

Complete direct-log hashes, byte counts, chunks and outcomes are in `evidence/dca-joined-parity-json-fail-closed-gate-ledger.json` (SHA-256 `af714e1588d6efee2e518e096b3e84609bafc5928660073f36ffed8817e10a85` before this report; its product-independent contents are unchanged by report creation).

## Freeze

- Before: 91 non-coordination candidate paths, aggregate `54a68e6c15c4d4564dbfb843d0eb0ba6fce1acb66af8dbcf69b4b08ff6ed3c63`.
- After: 94 non-coordination candidate paths, aggregate `37ef9504b56e6549c113dff38abc396baad01466391ca9c707629cc016bae875`. The three added candidate paths are `package.json`, the verifier, and its new unit test; AGENTS and D132 architecture test were already inherited candidate paths.
- Protected inventory excluding the eight declared scope paths: 1884 paths; digest stayed `f6d9a388a5bf539e97bbc51e8f49dd2ac19720d1b14b0a36bef973aa22b8fc23`.
- Index empty; `git diff --check` green.
- Isolated patch: `evidence/dca-joined-parity-json-fail-closed-isolated.patch`, SHA-256 `a32d408927abd4d2a1e8664d866a294e1724a100f50f35fb5c74ec7b0269992a`.
- `git apply --reverse --check` against the isolated patch: green.
- Before receipt: SHA-256 `a2062a11960dd4a1bb60d083416ca212a273f9fcdaceafbf12ffcbc511c6251c`.
- After receipt: SHA-256 `a254f74afee9d36c070d53e1e067efbe51d2ddc900c494181a3deffce4fb3107`.

The first isolated-patch evidence helper refused before emission because its temporary representation added a trailing newline and failed all three required original-hash checks. It changed no candidate source. The corrected helper reconstructed and verified the exact three existing-file before hashes, emitted the patch, removed its temporary files, and passed reverse-check.

## Limits and pending proof

No browser, build, coverage, full parity, reference update, stage, commit, merge, cleanup, live access, or push ran. Browser13 remains the preserved system red. A later allocated browser run must still demonstrate that the built-in JSON produced by real Playwright carries the expected attachment bodies and matching annotations; repair15 ensures the ordinary npm command cannot report success without that evidence.

Writer and light-lane ownership are relinquished with this frozen receipt.
