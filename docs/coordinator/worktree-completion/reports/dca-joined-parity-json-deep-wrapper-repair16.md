# DCA joined parity JSON deep-wrapper repair 16

Date: 2026-08-31  
Role: `sup_terra_parity_json_deep_wrapper_repair16`  
Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`  
Index: empty

## Outcome

The repair15 verifier is now a bounded, declaration-driven deep command boundary rather than a
flat post-process check.

- `npm run test:parity` and `npm run test:parity:update` invoke the same wrapper with explicit,
  non-forwarded `assert` and `update` modes. Inherited `PARITY_UPDATE`, reporter/config redirects,
  every installed snapshot-update form, `--ignore-snapshots`, and retry overrides refuse before the
  child starts. Assert removes `PARITY_UPDATE`; update supplies exactly `PARITY_UPDATE=1` to the
  child. Test/grep/output arguments otherwise retain their order and values.
- A checkout/report-derived `/usr/bin/lockf` lock is held by an owned child process from report
  preparation through child completion and verification. The lock is independent of the
  coordinator's dashboard gate lock and has no stale-sentinel authority.
- Under that lock, the wrapper validates direct current-user `cwd`, `tests`, and `tests/parity`
  parents; makes only `tests/parity/.output` private `0700`; refuses a symlink, non-file, foreign
  owner, or multi-link existing report; replaces only `results.json`; and precreates it `0600`.
  Unrelated output artifacts and forwarded `--output` locations are not removed.
- The verifier is read-only. It opens `results.json` with `O_NOFOLLOW`, validates regular-file,
  owner, mode and `nlink=1`, applies the byte ceiling, reads once from that descriptor, compares
  descriptor identity/size/times before and after, checks that the path still names that inode, and
  hashes/parses/verifies the same buffer.
- The Playwright model uses recursive `z.lazy` suites and iterative traversal. Explicit ceilings
  cover report bytes, JSON depth/nodes, suite depth, local arrays, aggregate suite/spec/test/result/
  attachment/annotation counts, strings, base64 text and decoded a11y bytes. Base64 must be
  canonical and text/yaml bytes must decode as fatal UTF-8.
- Seven real evidence-producing parity tests statically declare their exact required a11y names in
  test metadata. The verifier derives inventory only from selected tests present in the report,
  requires exactly one retry-0 result, and pairs each declaration with exactly one same-result
  body-backed text/yaml attachment and exact digest annotation. Missing helpers, undeclared or
  duplicate bodies/digests, orphan directions, path attachments, global cross-result reuse and
  retry pooling all refuse.
- Playwright remains primary when both child and verifier fail; verifier failure is surfaced second.
  A green child with missing, stale, malformed, unsafe or incomplete evidence returns nonzero.
- The repair15 root lesson was removed. The persisted-evidence lesson now extends the existing D132
  entry in `docs/rebuild/reference/lessons.md`; no decision or roadmap contract changed.

No custom reporter was added. Playwright's built-in JSON reporter remains configured at the exact
fixed report path.

## Repair15 review findings closed

| Finding | Repair16 disposition/proof |
| --- | --- |
| Flat suite schema/traversal | Recursive `z.lazy` model plus realistic nested acceptance, flat positive and depth/aggregate controls. |
| Assert mode inherited or forwarded updates | Explicit wrapper mode, child-owned environment, all installed update/ignore/retry controls refused. |
| Unsafe report parent/link lifecycle | OS-held lock; direct owner/type checks; private directory/file; symlink and hard-link controls; exact-file-only replacement. |
| Missing expected-evidence inventory | Static declarations on every selected producer; vanished-helper and real-source removal controls. |
| Concurrent shared report overwrite | Checkout-scoped real `lockf` contention test; second invocation refuses while the first child is active. |
| Missing ceilings | Report/depth/node/local/aggregate/string/base64/decoded limits with malformed and oversized controls. |
| Path reread TOCTOU | One no-follow descriptor read with pre/post descriptor and path identity checks; append and replacement controls. |
| Retry/cross-result ambiguity | Config pins `retries: 0`; verifier requires one retry-0 result and globally unique declared names. |
| Root documentation placement | Root lesson removed; owning D132 lesson extended; roadmap remains fresh. |

## Scoped identity

The exact nine-path repair15-to-repair16 before/after hashes and byte counts are in
`evidence/dca-joined-parity-json-deep-wrapper-repair16-freeze.json`.

- Repair15 intake: 94 non-coordination candidate paths, aggregate
  `37ef9504b56e6549c113dff38abc396baad01466391ca9c707629cc016bae875`.
- Repair16 freeze: 94 non-coordination candidate paths, aggregate
  `195b7beb501588e7510d668278587e5b1ca13ea4bafa66b2bd5b53d28fb694e2`.
- Protected inventory excluding the nine repair16 paths: 1883 paths; digest before and after
  `42a299f4574f3930a3b2bd86480498b8fef09da1753e96b8b820f55165487a64`.
- Complete nine-path candidate patch against HEAD:
  `evidence/dca-joined-parity-json-deep-wrapper-repair16.patch`, SHA-256
  `6dd7f95f536214e14dda2f689de68e99bc8f6f4aea4ead5a68df7342b039c64d`, 165052 bytes / 3398 lines.
  `git apply --reverse --check` passed against the frozen candidate.
- `git diff --check` passed; index remains empty.

Repair15 artifacts stayed byte-identical:

- report `05e5709471f36a2e550802481698522f3a122c9240b97a31e1eb65418f7acec9`
- patch `a32d408927abd4d2a1e8664d866a294e1724a100f50f35fb5c74ec7b0269992a`
- gate ledger `af714e1588d6efee2e518e096b3e84609bafc5928660073f36ffed8817e10a85`

## TDD and controls

Every Vitest command used `VITEST_MAX_WORKERS=1` and
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`.

- Initial red `8655c5`: 2 failed / 6 passed. Actual nested `test.describe` evidence was rejected by
  the flat schema and installed update controls were accepted.
- Restored final focused `bb1e8f`: 2 files / 27 tests passed.
- Static declaration source control `1c9224`: removing the real Graphite diagnostic declaration
  failed with its exact missing declaration name; the spec returned to SHA-256 `c0d0ec13…`.
- Update child-environment source control `84c80b`: removing wrapper assignment failed `null !== "1"`;
  the verifier returned to SHA-256 `cb87ec92…`.
- The unit matrix additionally executes nested/flat traversal, suite/local/aggregate ceilings,
  canonical base64 and fatal UTF-8, independent stale file/stats/identity arms, same-fd mutation and
  path replacement, parent/report symlinks, hard link, mode and owner simulation, real lock
  contention, stale/missing/unsafe command outcomes, exact forwarding, declarations, duplicate/
  orphan/cross-result/retry refusal, and default Playwright command prefix.

Complete log hashes, command chunks/sessions and exits are in
`evidence/dca-joined-parity-json-deep-wrapper-repair16-gate-ledger.json`.

## Final light gates

| Gate | Execution | Exit | Result |
| --- | --- | ---: | --- |
| Focused verifier + D132 authority | chunk `bb1e8f` | 0 | 2 files / 27 tests passed |
| Locked full typecheck | chunk `97fa10` | 0 | `tsc --noEmit` passed |
| Locked full lint | session `45409`, chunks `524e08` / `48f2bf` | 0 | ESLint passed with zero warnings |
| Roadmap check | chunk `22c888` | 0 | generated roadmap is fresh |
| Manifest check | chunk `1fa523` | 0 | generated build manifest is current |

The first full typecheck (`fc78ae`, exit 2) found only local `Stats` overload typing and a synthetic
recursive fixture shape. The first full lint (`82194`, exit 1) found only two local caught-error
propagation violations. Both were fixed without weakening assertions; final focused/type/lint gates
are green.

## Boundaries and pending work

No browser, build, coverage, parity, reference update, stage, commit, merge, cleanup, live access or
push ran. No product/runtime/source surface, reference corpus, mask, threshold, timeout or shared
materializer changed. Browser13 remains the retained persistence red.

The complete repair15→16 delta still requires the parent/coordinator's independent Tests,
Standards, Correctness, Silent-failures and Security reviews. A scoped real-Playwright browser
allocation should be requested only after those axes close; this unit does not claim that heavy
proof.

Writer and light-lane ownership are relinquished with this frozen receipt.
