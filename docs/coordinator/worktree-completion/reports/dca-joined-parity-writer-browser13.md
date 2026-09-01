# DCA joined parity-writer browser13 receipt

Date: 2026-08-31 PDT

Status: **browser command green, required attachment-persistence proof red**. The one authorized two-case command ran once and terminated naturally; the logical heavy slot was released before output interpretation. Both tests passed, but neither expected `.a11y.yml` body attachment exists in the actual runner output, so the repair is not accepted and no full gate followed.

## Frozen launch identity

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Index: empty.
- Non-coordination candidate: 89 paths; aggregate `b058545bd44228d11457a8d56232962ee42ba2c72983e0cb3545594abe5a4894`.
- `tests/parity/diagnostic-bundle-dialog.spec.ts`: `2a5aee9a35bdfa5854a0c71dd72c713bbb1b0e146584fd87823d8c8da4fcc75a`.
- `tests/parity/run-captures.spec.ts`: `682ece1fc2ec1ed54e66ececf5fb4729e1f5337c0ba29a571f306683d2ae8629`.
- Affected-spec `git diff --check`: exit 0.

## Exact single command

`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/diagnostic-bundle-dialog.spec.ts tests/parity/run-captures.spec.ts --grep 'captures the exact-identity screenshot gallery with attributable fixture metadata|full Receipt keeps exact JPEG/data captures, native bytes and keyboard focus'`

- Owned session: `92774`.
- Exit: `0`.
- Result: 2 tests passed using 1 worker in 3.9s.
- Diagnostic case: passed in 1.1s.
- Receipt case: passed in 780ms.
- Raw stdout/stderr: `docs/coordinator/worktree-completion/evidence/dca-joined-parity-writer-two-case-13.log`, 853 bytes / 13 lines, SHA-256 `d850ad9b66c3bf51ba02dafcaba8fd5cd954577ee35ee991cb40b9804cb3450b`.
- `PARITY_UPDATE` was unset. No rerun, reference update, source repair, full coverage, or full parity followed.

## Complete output preservation and failed acceptance

The untouched `tests/parity/.output` directory was copied after terminal to:

`docs/coordinator/worktree-completion/evidence/dca-joined-parity-writer-two-case-13-output`

Its complete locale-sorted `path + NUL + sha256(file)` aggregate is `292c32cc29c36538c4273f3510188785e915b60c379dde70f97f7679643f972b`. It contains exactly seven files:

1. `.last-run.json`, SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`, status `passed`, no failed tests.
2. Diagnostic screenshot output plus its attachment copy, each SHA-256 `c113aea439d12bffb8e39edecde87642b0d5d0df089333d5d9615f7cd830d6a9`.
3. Full Receipt screenshot output plus its attachment copy, each SHA-256 `e4cfdeafc545a5dc4ab252165d538ad75c6596025d5261515ceac02fd4a3171f`.
4. JPEG-dialog screenshot output plus its attachment copy, each SHA-256 `4d921af4a6ad0423643604ba940781f86e5c225974efd59d1c22ddc20821aa22`.

The preserved runner output contains **zero** paths ending in `.a11y.yml`. The source `tests/parity/.output` inventory is identical in this respect. Therefore:

- `diagnostic-lightbox--graphite-warm--1280x720.a11y.yml` is absent;
- `run-captures-full-graphite-desktop.a11y.yml` is absent;
- `run-capture-jpeg-graphite-desktop.a11y.yml` is absent;
- no body-backed a11y attachment is durably recoverable;
- byte-for-byte equality to the snapshots observed by the tests cannot be checked.

This is the exact predeclared acceptance failure. A successful awaited `test.info().attach({ body })` under the configured list reporter did not produce a recoverable attachment in the actual output directory. This receipt does not infer a broader Playwright cause or authorize a reporter/helper/writer change.

## Frozen return and limits

After the run and evidence copy:

- both spec hashes remain exactly `2a5aee9…fcc75a` and `682ece1…e8629`;
- HEAD remains `eda17b27…3187`;
- index remains empty;
- affected-spec `git diff --check` remains exit 0.

No file was fabricated to stand in for either missing attachment. No raw writer, helper, reporter, guard, allowlist, reference, screenshot path, output policy, mask, threshold, timeout, source, product, stage, commit, merge, cleanup, live action, or push was changed. Full coverage and full asserted parity remain unrun after coverage11.
