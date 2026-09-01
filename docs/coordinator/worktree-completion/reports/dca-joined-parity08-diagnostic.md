# DCA joined Receipt diagnostic 08

Date: 2026-08-31 PDT

Status: one authorized diagnostic command completed and released; temporary code restored byte-for-byte; restored typecheck and lint green. No product repair, second browser command, reference update, full gate, stage, commit, merge, cleanup, live action, or push was performed.

## Frozen candidate and execution

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Active spec before and after: `tests/parity/run-captures.spec.ts` SHA-256 `02ed46960af6d08f56877b60e0b48d3bef18b0f8550f5e8d84721dd991267526`.
- Active fixture helper before and after: `tests/parity/helpers/fixture-bff.ts` SHA-256 `cd1411ee41b8bb7c4c1565e65417bf1b6c7478ee537242f2c702d2dfa020fbe6`.
- Temporary observer hashes: spec `891f55fec7eb71a79494441ce16e1f689c2a4ca433fd67a3e31a79532353053a`; helper `9418486b03d3fb055822e54c064e767e8b27c37fa7aadca7694352bbd849bb66`.
- Preserved temporary patch: `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-diagnostic-08.patch`, SHA-256 `609c1c5a381a6ad1ac6e459b13026452ff77bcbbc3fb689c84ed5b3bed8cb66c`.
- Exact command, run once:

  `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts --grep 'full Receipt keeps exact JPEG/data captures|coarse phone Receipt'`

- Terminal: exit 1 in 7.3 seconds, three failed tests. Raw direct log: `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-diagnostic-08.log`, SHA-256 `41fcb9c41a183628b4c7da7cefd7c418dbd53dec36dde593a49f6793ad500111`.
- The logical heavy slot was explicitly released immediately after output preservation and exact restoration.
- Restored light checks, serial and globally locked:
  - `npm run typecheck`: exit 0; log SHA-256 `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036`.
  - `npm run lint`: exit 0; log SHA-256 `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385`.
- Final index empty; `git diff --check` exit 0; 89 non-coordination candidate paths retain aggregate `8ea4aa259a09668bd34309202f2f0327fd5cd5d711c3c23b1bbf376137b72cfb`.

## Download finding — data artifact fully accounted

The temporary observer replaced only the Page-response waiter. It retained exact absolute href, one Playwright user click, native download event, exact native URL, exact stream bytes and SHA-256, and added a real Node/Hono exchange ledger.

For artifact `00000000-0000-4000-8000-00000000c103`:

- Ledger before: empty.
- Ledger after: exactly one `{method: "GET", pathname: "/artifacts/v1/00000000-0000-4000-8000-00000000c103", status: 200}`.
- `Download.url()` exactly equaled the expected fixture URL.
- Native stream completed with 26 bytes.
- SHA-256 exactly equaled `87a6188a29cd2cb3d26251f1bc25846114d0ca3b454b25605540dfc9334cf28b`.
- Exact-URL Page events were an empty vector: no `request`, `response`, `requestfinished`, or `requestfailed` event was emitted to the Page observers.

Durable JSON: `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-diagnostic-08-output/run-captures-full-Receipt--dbf63-ve-bytes-and-keyboard-focus/download-observer-00000000-0000-4000-8000-00000000c103.json`, SHA-256 `b9007e25f631b5bc9a48a7a3facd5ea2e3ce06399eca346a3fa5e2e2389ea009`.

Conclusion: the parity-07 120-second waiter was observing an event that Chromium did not publish to the Page for this native download. The product/fixture byte path succeeded exactly. Method and status remain provable at the real server adapter; native URL and bytes remain provable through `Download`. The Page response waiter is not a valid required proof for this path.

Missing: the JPEG download was not reached in diagnostic 08 because the desktop case encountered the distinct focus-visible red first. No JPEG conclusion is inferred from the data artifact.

## Phone finding — article scrolling leaves both controls below the scroller and viewport

Paper and Graphite emitted byte-identical geometry JSON, SHA-256 `9c0d9741145c3817756236efc231ecfdad553f6da7969c442753c2da7888536a`. The theme-specific screenshots are Paper `d5512893f1a2ff6b59a5787ab397f44b0b455e2cf88ae9b84bc619847856c8b3` and Graphite `de1a1385d9013876a9676df2e93ef320cc67192188fc39c93788efbf3f2998a7`.

Exact shared facts after the existing Escape, panel-count-zero assertion, article `scrollIntoViewIfNeeded`, and ratio-0 `toBeInViewport`:

- Workflow Panel dialog count: 0.
- Viewport: 390 × 844; document scroll `(0, 0)`.
- Article rectangle: `(left 25, top 514.5, right 365, bottom 1000.5)`, 340 × 486.
- Intersection rectangle: top 514.5 to bottom 778.5, height 264; ratio `0.5432098507881165`.
- Preview opener: top 946.5 to bottom 990.5, height 44; its effective 44px target is identical vertically; failed edge `bottom`.
- Download link: top 946.5 to bottom 990.5, height 44; its effective 44px target is identical vertically; failed edge `bottom`.
- The nearest Receipt scroller is top 396.5 to bottom 778.5, `clientHeight 382`, `scrollHeight 856`, `scrollTop 240`, `overflow-y:auto`.
- A second ancestor scroller is top 457.5 to bottom 779, `clientHeight 322`, `scrollHeight 786`, `scrollTop 158`, `overflow-y:auto`.
- All recorded transforms are `none`.

The screenshots visibly contain the upper artifact facts but not the action row. This proves the test precondition is insufficient: the whole 486px article cannot fit in the 382px inner scroller, and ratio-0 viewport success accepts the observed 54.3% intersection while both controls remain 146.5px below the viewport and 212px below the inner scroller's bottom.

No product layout defect is established. The existing exact control geometry assertion is evaluating controls that the test did not scroll into the visible region.

## Distinct desktop focus-visible red

After the successful data download, the test selected the JPEG opener, called Playwright `opener.focus()`, and entered `expectKeyboardFocus`. `toBeFocused()` passed; the first subsequent check failed because `node.matches(":focus-visible")` was false. The JPEG dialog and JPEG download were not reached.

This is an observed fact, not yet a product or test defect. The path immediately before it is pointer activation through `dataDownload.click()`, followed by programmatic `opener.focus()`; it does not use keyboard traversal to focus the opener. The temporary download observers add no input action, but diagnostic 08 did not record active element or `:focus-visible` before/after the click and focus calls, so observer effect and exact modality state are not fully reconciled.

The mounted order is JPEG Preview, JPEG Download, then data Download: the fixture returns JPEG before data and the component maps artifacts in that order. That gives a bounded real-keyboard path to test, but it is not claimed green without a focused run.

## Smallest bounded repair proposals

All proposals are test/helper-only and require ordinary review/light proof before any fresh browser allocation. No product component, design-system, reference, timeout, viewport, or assertion relaxation is proposed.

1. **Native download proof seam.** Retain an immutable artifact exchange ledger at the real Node/Hono fixture adapter. In `expectDownloadedBytes`, replace only `page.waitForResponse` with an exact ledger delta assertion for one `GET`/expected pathname/status 200. Continue to assert exact href, one native download event, exact `Download.url()`, stream existence, byte count, and SHA-256. Add focused fixture tests proving ledger isolation and exact status; do not perform an extra fetch.
2. **Phone visibility precondition.** Keep the article assertions, then scroll the exact opener/action row rather than relying on whole-article visibility. Require ratio-1 visibility for both the opener and sibling Download before running the unchanged 44px/ownership/overlap/edge geometry proof. This addresses only test positioning; it does not change UI layout.
3. **Actual keyboard focus path.** First pin the observed post-download focus state. If data Download retains focus, assert it, press `Shift+Tab` to the preceding JPEG Download and again to the JPEG Preview opener, then run the unchanged focus-visible/ring proof and activate with Enter. If that exact DOM-order path is not observed, stop with the recorded active-element/modality facts rather than substituting programmatic focus or weakening `:focus-visible`.

Suggested red-capable light seams before browser: fixture-ledger unit coverage, a DOM/order test for the three links/buttons, and the existing related dashboard tests plus locked typecheck/lint. Suggested fresh browser scope after review is the same three cases once; it must retain exact download, geometry, and focus assertions and release on any unexpected red.

## Disposition

- Download cause is evidence-supported and bounded to a test observation seam.
- Both phone causes are evidence-supported and bounded to the test's scroll target/precondition.
- Desktop focus-visible remains a separate, narrowly testable focus-path question; no defect classification yet.
- Active source is restored and frozen. No further command or edit is authorized by this receipt.
