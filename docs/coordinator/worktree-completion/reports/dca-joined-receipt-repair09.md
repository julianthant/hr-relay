# DCA joined Receipt repair 09 — browser readiness

Date: 2026-08-31 PDT

Status: the three diagnostic08 test/helper repairs are implemented, frozen, light-green, and independently reviewed. No browser/build/heavy/full gate, reference update, product change, stage, commit, merge, cleanup, live action, or push was performed. One reviewed three-case browser allocation remains required.

## Scope and frozen identity

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Index: empty.
- `git diff --check`: exit 0.
- Frozen non-coordination candidate: 89 paths, aggregate `e4a01b57b3f7876543ff95397601edc0ee096acf4fb962dab6c2dd9f74b3864d` using the established locale-sorted `path + NUL + sha256(file)` row recipe.
- Isolated repair transcript: `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-repair-09.patch`, SHA-256 `f4e58c0581055e524cca0069a03a7b291846a9b10f23536e3ae6a08ce061f440`.

Changed seam hashes:

| Path | SHA-256 |
| --- | --- |
| `tests/parity/helpers/fixture-bff.ts` | `0e74acef4f223a146c8deb6e12c6255da769f6bdf0cff2b0b0edfd8fe8def764` |
| `tests/parity/run-captures.spec.ts` | `f24fbc41b641735da413b8ca2e3d47d517367d11f00eab38445919dd714fad69` |
| `tests/unit/dashboard/run-captures-fixture.test.ts` | `887c44a9d7d82364fb6749d7510a319fb1cf1661b0f18ac1fa3027d4ab82cbe9` |
| `tests/unit/dashboard/run-captures-app.test.ts` | `e155e8dce6e8aab9f1f441c96f9fd41b2d0180e4c1ac3bd8fcd2bacc108f7040` |
| `src/dashboard/AGENTS.md` | `a67a5c830020b1bbd7bacf42a5a8c1537cd417a761b471f71382ef482cbb4dc1` |

The prior active spec and helper identities were `02ed46960af6d08f56877b60e0b48d3bef18b0f8550f5e8d84721dd991267526` and `cd1411ee41b8bb7c4c1565e65417bf1b6c7478ee537242f2c702d2dfa020fbe6` respectively.

## Implemented seams

### Native download proof

The real Node/Hono fixture adapter now records artifact-only `{method, pathname, status}` exchanges in server-local append order. `artifactExchanges()` returns a newly copied, recursively frozen snapshot; API and static traffic receive no credit.

`expectDownloadedBytes` no longer waits for the unobservable Page response. It retains exact absolute href, one link click, native download event, exact `Download.url()`, non-null stream, byte chunks, exact byte count and independent fixture SHA-256. It additionally requires the immutable before/after ledger delta to be exactly one `GET` of the expected pathname with status 200. It performs no second fetch.

### Phone action-row precondition

Both coarse-phone cases retain Workflow Panel dismissal, exact count zero, article scroll, and the existing ratio-zero article assertion. They then scroll the exact Preview opener and require ratio-1 viewport visibility for both the opener and its sibling Download before the unchanged touch-target geometry proof. The product layout, viewport, timeout, helper predicate, 44px floor, ownership, edge, overlap, and foreign-overlap assertions are unchanged.

Diagnostic08 remains the red evidence for this browser seam: the 486px article intersected only 54.3% of its 382px scroller while both controls ended at y=990.5 in an 844px viewport. Green rendered proof is deliberately pending.

### Real keyboard order

After the data native download, the full Receipt case now pins the data Download as the active element. It uses real `Shift+Tab` transitions to exact JPEG Download and then exact JPEG Preview before the unchanged focus-visible/ring proof, Enter activation, dialog/decode/JPEG download, Escape close and opener-focus restoration.

The mounted jsdom seam pins exact order and identities: JPEG Preview button, JPEG Download href, data Download href. The phone case's existing `opener.focus()` remains a direct focus-ring assertion after keyboard-driven Escape; it is not represented as traversal proof.

## TDD and mutation receipts

| Proof | Result | Raw evidence SHA-256 |
| --- | --- | --- |
| Ledger test before helper | intended red: `artifactExchanges is not a function`; 1 failed/10 passed | `a3e5d1e046e21eaeda794c08704f8e7854ef06e56a958b3aff963bed78471700` |
| Wrong recorded status | intended red: expected 404, received 200 | `58b9e279b164be67b215d23d26fd61f16555a862dfaa0bf9ec07ec9b56e925e3` |
| Live mutable snapshot | intended red: `Object.isFrozen(first)` false | `e6b9158292611da20aacbb9e6cca2c97637696c05ae5aee6aef6bdfacce7b43c` |
| Reversed mounted artifact order | intended red: data Download appeared before JPEG Preview | `cba65ecc4163248e9cb65d9a45511cefa2fc121b7648bdc7804248e79abac1b2` |
| Final affected parent run | 3 files, 54 tests passed | `7eb8a034357b7ead06b234be7e369aee185a74de7fae2dd555e9bf37649bf982` |
| Globally locked typecheck | exit 0 | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |
| Globally locked lint | exit 0 | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |

Every status/isolation/order mutation was restored immediately and followed by its exact focused green. A first draft of the DOM-order fixture reused one bundle origin across different artifact metadata; the real parser refused it and rendered no controls. That setup red was corrected with distinct valid origins and was not claimed as semantic proof. Its tee path was subsequently overwritten by the corrected green, so no raw-log preservation claim is made for that discarded setup attempt.

## Independent review

All reviewers were resumed existing native units, read-only, and closed after return.

| Axis | Native return | Outcome |
| --- | --- | --- |
| Tests | `01a058e9-4b25-7323-ab97-272f1a379e83` | 0 findings; high confidence for test/helper seam; browser claims pending |
| UI | `01a058e9-4be6-71a1-83ce-26abed62b4e0` | 0 findings; static semantics sound; browser geometry/focus pending |
| Silent failures | `01a058e9-4d02-79a1-9ded-02e66bcd330b` | 0 findings; no cross-credit, fallback, extra fetch or weakened proof |
| Standards | `01a05310-bd69-7630-93b1-88c6c475c29e` | Initial medium+low documentation findings closed; final 0 findings |

Standards closure moved the lesson from root to the owning dashboard AGENTS file and narrowed it to distinguish pointer-to-keyboard traversal from the existing Escape-driven direct focus-ring assertion. Executable hashes did not change during closure.

## Requested browser allocation

Request exactly one reviewed three-case run, with `PARITY_UPDATE` unset and the mandatory heavy lock:

`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts --grep 'full Receipt keeps exact JPEG/data captures|coarse phone Receipt'`

Expected required proof:

- data and JPEG each produce exact one-click native Download URL/stream/bytes/SHA and exact one-row `GET`/pathname/200 adapter delta;
- data Download retains focus, real Shift+Tab reaches JPEG Download then Preview with unchanged focus-visible/ring proof;
- both phone themes fully expose Preview and Download after exact opener scroll and pass unchanged 44px/edge/ownership/nonoverlap geometry;
- all three cases pass without timeout, viewport, reference, product, helper-predicate or assertion changes.

Any red releases the logical slot before repair. No full coverage/parity continuation is implied by this readiness request.
