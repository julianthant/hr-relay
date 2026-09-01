# DCA joined coverage11 parity-writer repair12

Date: 2026-08-31 PDT

Status: the bounded two-spec D132 repair is implemented, frozen, light-green, and independently reviewed. No browser, build, coverage, full parity, reference update, product change, guard change, stage, commit, merge, cleanup, live action, or push was performed. Playwright reporter persistence of body-backed attachments remains explicitly unproved and requires one later allocated browser command.

## Scope and frozen identity

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Index: empty.
- `git diff --check` for both affected specs: exit 0.
- Frozen non-coordination candidate: 89 paths, aggregate `b058545bd44228d11457a8d56232962ee42ba2c72983e0cb3545594abe5a4894` using the established locale-sorted `path + NUL + sha256(file)` row recipe.
- Isolated repair: `docs/coordinator/worktree-completion/evidence/dca-joined-parity-writer-repair-12.patch`, 1,531 bytes / 28 lines, SHA-256 `301bf3df10f53e773bd91300a9ebb0c491583ee6c79494823a9daeba79e47432`.

| Path | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `tests/parity/diagnostic-bundle-dialog.spec.ts` | direct-writer candidate recorded by coverage11 | `2a5aee9a35bdfa5854a0c71dd72c713bbb1b0e146584fd87823d8c8da4fcc75a` |
| `tests/parity/run-captures.spec.ts` | `f24fbc41b641735da413b8ca2e3d47d517367d11f00eab38445919dd714fad69` | `682ece1fc2ec1ed54e66ececf5fb4729e1f5337c0ba29a571f306683d2ae8629` |

The diagnostic pre-repair file hash was not independently recorded before the approved edit, so this report does not reconstruct one. The complete coverage11 raw red and the isolated textual patch preserve the attributable before evidence without inventing a digest.

## Repair

Only the two coordinator-approved parity specs changed:

- `diagnostic-bundle-dialog.spec.ts` removes `writeFile` from its existing `node:fs/promises` import, acquires the exact same `ariaSnapshot()` string once, and awaits `test.info().attach(..., { body: snapshot, contentType: "text/yaml" })`.
- `run-captures.spec.ts` removes its `writeFile` import and `a11yPath` local, retains the exact snapshot acquisition plus existing non-empty and exact accessible-root assertions, and attaches that same string body with `text/yaml`.
- Both PNG `test.info().outputPath` / `page.screenshot({ path })` / path-attachment sequences are byte-for-byte unchanged.

No raw filesystem writer, new helper, catch, fallback, static substitution, or allowlist entry replaced the removed calls. The current direct-writer census below `tests/parity` contains exactly the two existing D132 owners:

- `tests/parity/helpers/reference-store.ts`
- `tests/parity/helpers/bundle.ts`

The D132 scanner, its two-way stale-entry check, both listed helpers, `captureParityPair`, `REFERENCES`, reference bytes, masks, thresholds, timeouts, screenshot output, and `PARITY_UPDATE` behavior are unchanged.

## Before red and light proof

The red-capable before evidence remains full coverage11:

- `docs/coordinator/worktree-completion/evidence/dca-joined-full-coverage-11.log`
- SHA-256 `8c5ebba384ca6e51106ffce480f8120e7cf4b4cf8adfb84a2fed559e9e14139a`
- The sole failing architecture test named both specs as unauthorized direct writers; full asserted parity did not run.

| Proof | Command/result | Raw SHA-256 |
| --- | --- | --- |
| Real D132 arm | `VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/parity-reference-authority.test.ts`; session 27797; exit 0; 1 file / 13 tests passed in 2.63s, including unchanged negative controls | `40508f7bdb1ba0ea70e6b71f9f0de32b1e9f7d556ebd49e46cc0271bc204a57c` |
| Locked typecheck | `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck`; session 42229; exit 0 | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |
| Locked lint | `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint`; session 75313; exit 0 | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |

The two locked light commands ran sequentially; no own browser/build/heavy command overlapped them.

## Independent native review

All four original native units were resumed read-only against patch `301bf3df…`, returned independently, and were closed after receipt.

| Axis | Native unit | Outcome |
| --- | --- | --- |
| Tests | `01a052ff-4062-7b32-b0ba-4c6d27bbec85` | 0 findings. D132 remains red-capable; run-captures retains non-empty/root assertions; both attachment calls are awaited. Reporter persistence remains browser-pending. |
| Standards | `01a05310-bd69-7630-93b1-88c6c475c29e` | 0 findings. The direct-writer census is exactly the two existing owners; no guard, allowlist, reference, or output-policy evasion. |
| Correctness | `01a052fb-ba16-7803-82d7-1f7c41c361db` | 0 findings. The same snapshot string and MIME are passed; installed Playwright converts string bodies with `Buffer.from`, equivalent to the removed UTF-8 payload. Reporter persistence remains unproved. |
| Silent failures | `01a052ff-40db-71b2-8fbf-14c964689ff7` | 0 findings. Snapshot and attach rejections fail because both are awaited; no new catch/default/substitution. The diagnostic helper's pre-existing lack of a content oracle was not widened. |

No reviewer ran tests, gates, a build, or a browser. None inferred reporter durability from the type declaration or light receipts.

## Requested one-command browser allocation

Request one separately allocated, OS-locked parity command with `PARITY_UPDATE` unset that selects exactly one affected case per spec:

`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/diagnostic-bundle-dialog.spec.ts tests/parity/run-captures.spec.ts --grep 'captures the exact-identity screenshot gallery with attributable fixture metadata|full Receipt keeps exact JPEG/data captures, native bytes and keyboard focus'`

Required receive before any full gate:

1. both selected cases pass without source, timeout, threshold, mask, reference, or output-policy changes;
2. the reporter's actual output contains each expected named `.a11y.yml` attachment produced by the body form;
3. each attachment is recoverable as a regular durable file from the runner output/receipt and its exact bytes are checked against the snapshot body observed for that case, not merely inferred from Playwright types or a successful attach call;
4. complete stdout/stderr, output identity, attachment paths/hashes/bytes and comparison method are preserved.

If either attachment is absent, unreadable, transformed, or cannot be compared byte-for-byte to its body, release the slot and report the exact outcome. Do not add a raw writer, weaken D132, fabricate a parallel file, or claim persistence.

This allocation is only the remaining repair acceptance proof. Full coverage and full asserted parity still require coordinator disposition after its receive; the existing coverage11 red is not waived.
