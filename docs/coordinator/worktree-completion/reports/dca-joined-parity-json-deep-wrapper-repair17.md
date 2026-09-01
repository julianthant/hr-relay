# DCA joined parity JSON deep-wrapper repair 17

Date: 2026-08-31  
Role: `sup_terra_parity_json_deep_wrapper_repair17`  
Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`  
Index: empty

## Outcome

All bounded Repair16 review findings are closed in the same deep-wrapper seam.

- The wrapper refuses both `--output <path>` and `--output=<path>` before its child boundary. The
  controls include `tests/parity/references`, the checkout root, `/`, and the operating-system temp
  directory. These values are neither normalized nor forwarded.
- The selected keyboard-focus producer and both selected portrait-loop producers now declare their
  exact required `.a11y.yml` names in Playwright test metadata. The D132 static inventory names all
  three and mutation-checks each declaration.
- Command ownership is now one canonical checkout identity. `realpathSync(cwd)` maps lexical and
  symlink aliases to the fixed checkout-owned `.tracker-rebuild/locks/parity-json-report.lock`; a
  changed `TMPDIR` cannot create a second lock. Every lock parent and file remains direct,
  current-user-owned and no-follow checked. The lock is held across report preparation, child exit,
  the one-descriptor read, and completed JSON verification.
- A test selected as required evidence is accepted only when `expectedStatus === "passed"`, its
  Playwright outcome is `"expected"`, its sole retry-0 result status is `"passed"`, and neither the
  result's singular error nor errors array carries a value. Skipped, expected-failed, unexpected,
  failed-result, and both error shapes refuse by name.
- The exact default launch consumed by `runParityAndVerify` is tested through an injected child
  process boundary without setting `command` or `commandArgs`: Node's executable, Playwright's CLI,
  `test --config playwright.parity.config.ts`, then the untouched caller arguments.

Repair16's recursive schema, single-read report authority, private report lifecycle, retry
cardinality, canonical base64/fatal UTF-8 checks, and D132 authority remain intact.

## Test matrix added

The focused verifier suite now has independent controls for:

- JSON depth and node ceilings, suite depth, and aggregate spec/test/result/attachment/annotation
  ceilings;
- every installed compact update spelling: `-uall`, `-uchanged`, `-umissing`, and `-unone`;
- stale `result.startTime` independently of the report file and `stats.startTime` clocks;
- two required names supplied by the same successful result, followed by a missing-second-body red;
- differing `TMPDIR` values plus lexical/symlink checkout aliases contending for one OS lock;
- a second lock attempt during verification after the producer child already exited;
- every required-producer success field independently; and
- `--output` refusal before the injected default-child boundary can run.

The aggregate controls are table-driven but each case creates a report that exceeds only its named
authority ceiling before evidence cardinality is considered.

## TDD and raw receipts

Every focused Vitest command used `VITEST_MAX_WORKERS=1` and
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`.

- Initial producer/output/inventory red, chunk `1ef711`: 8 failed / 34 passed.
- Canonical lock/lifecycle red, chunk `f235bb`: 3 failed / 27 passed.
- Default-launch seam red, chunk `04bd80`: 1 failed / 30 passed. Because the dependency seam did
  not yet exist, that unit red reached Playwright CLI config resolution and refused the temporary
  repo's missing `playwright.parity.config.ts`; it exited before browser startup. No parity suite,
  browser, build, reference write, or output-directory mutation ran.
- Restored final focused gate, chunk `69812c`: 2 files / 45 tests passed.

The first locked typecheck (`93bcbd`, exit 2) found only three explicit-shape omissions in synthetic
aggregate controls. The fixtures were corrected without changing limits or assertions. The full
run ledger, including every intermediate red/green log, byte count, SHA-256, command chunk/session,
and exit is
`docs/coordinator/worktree-completion/evidence/dca-joined-parity-json-deep-wrapper-repair17-gate-ledger.json`
(SHA-256 `94590a71584d31bcfcf8fc2a634cbb5430ad8b3224e943b050f5d3e709746564`).

## Final light gates

| Gate | Execution | Exit | Result |
| --- | --- | ---: | --- |
| Focused verifier + D132 authority | chunk `69812c` | 0 | 2 files / 45 tests passed |
| Locked full typecheck | chunk `2410ac` | 0 | `tsc --noEmit` passed |
| Locked full lint | session `37239`, chunks `2d436b` / `9eb2aa` | 0 | ESLint passed with zero warnings |
| Diff check | chunk `d1d88c` | 0 | no whitespace errors |

## Frozen delta

Only four non-coordination files changed from Repair16:

| Path | Repair16 SHA-256 | Repair17 SHA-256 | Bytes |
| --- | --- | --- | ---: |
| `scripts/verify-parity-json.ts` | `cb87ec922ea1b0624fbfd5ce7b19a21f5e845ce35d2ec3c1e167dd8e1fa27d57` | `35d2a35b3649b4d671c44836d3784d90dc31adad5533eba760e2d0618adf0c05` | 34,250 |
| `tests/parity/diagnostic-bundle-dialog.spec.ts` | `c0d0ec130c2f8c31f958cfd46ef3f3f8513c628fd6e31957476596a014d5408a` | `49fa39e34d369f0923f0233794e0691952c63fa8ffea5916a53787ae3984a518` | 55,642 |
| `tests/unit/architecture/parity-reference-authority.test.ts` | `72a209c6092e4a23eb4fa3e44b24bc6d15d6f725e0933720c84ef3d24ea5d7b1` | `6f2f6be6d1ee6c82349c3c16bcbf9c33f4a3ca2497012e08612ab474e6900f1a` | 27,679 |
| `tests/unit/scripts/verify-parity-json.test.ts` | `e7d86e592029717c96be4f3a630dd12947e85f70deb1c47864d11aa53118fa1e` | `912c0e29bc18c9a034f94bb42b4f0600db7dbbc1a39ecee43266a90e829cfef4` | 48,890 |

The byte-reconstructed Repair16-to-Repair17 patch is
`docs/coordinator/worktree-completion/evidence/dca-joined-parity-json-deep-wrapper-repair17.patch`,
SHA-256 `486f22da4818e393bfe0b79e87406f6b3ce9256377eacb1645c1690573ce1ae3`,
33,776 bytes / 812 lines. Reverse apply check passed.

The 94-path candidate aggregate moved from
`195b7beb501588e7510d668278587e5b1ca13ea4bafa66b2bd5b53d28fb694e2` to
`c0bf7657917e9f9aa5118785cfd9fd6ef088be2d42fb8edf18f5f7a4292c3a08`.
Replacing exactly the four current scoped hashes with their reconstructed Repair16 bytes returns
the original aggregate exactly. The 1,888-file protected digest is
`629f7b501b6f594fc50fa017bb74e6e93c5ec96464f87cb6c33861dee9b08d2d`.
The 591-file reference corpus remains unchanged at
`b0a15dc7b0fda97f80aa403ac67ae5949cd0b71e6f7bd5a5d36aba65bd2abc61`.

The complete freeze is
`docs/coordinator/worktree-completion/evidence/dca-joined-parity-json-deep-wrapper-repair17-freeze.json`,
SHA-256 `7bc7fee5010bf65c112a15a4b4fc9a92fee4f42835e39f13d5df41a028bc8088`.
Repair16's report, patch, freeze, and ledger remain byte-identical to the supplied authority hashes.

## Boundaries

No product behavior, reference bytes, thresholds, masks, materializer, browser fixture, package
script, parity config, or unrelated documentation changed. The existing D132 lesson already states
the non-obvious persisted-evidence authority, so no duplicate lesson was added.

No browser, build, coverage, parity suite, parity update, stage, commit, merge, live access, or push
ran. No heavy lane was used. Writer and light-lane ownership are relinquished with this frozen
receipt.
