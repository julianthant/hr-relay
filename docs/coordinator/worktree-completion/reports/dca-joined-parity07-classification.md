# DCA joined parity-07 read-only failure classification

Date: 2026-08-31 PDT

Scope: read-only classification after the released scoped Receipt parity run. This report does not authorize or perform a browser rerun, source/test/helper/reference edit, reference update, full gate, stage, commit, merge, or cleanup.

## Frozen input and observed red

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Index: empty at the classification check.
- Active spec: `tests/parity/run-captures.spec.ts`, SHA-256 `02ed46960af6d08f56877b60e0b48d3bef18b0f8550f5e8d84721dd991267526`.
- Scoped command: `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts`.
- Raw log: `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-parity-07.log`, SHA-256 `6f6152e505dca2e6e1b55bb0015e65b5e87c47f18a97ba3f5522848699baf7d9`.
- Terminal outcome: exit 1 after about 2.2 minutes; 3 failed and 4 passed. The three failures were one full-Receipt download timeout and two coarse-phone geometry failures. No rerun followed.

## Failure 1 — native data download

The timeout occurs at `page.waitForResponse(...)` in `expectDownloadedBytes`, before the helper can assert response status, create the native download stream, or compare byte count and SHA-256.

### Proven by parity-07

- The link had already passed its exact absolute `href` assertion.
- No Playwright `Page` response satisfying exact URL plus `GET` was observed before the 120-second test timeout.
- The test reached the first data-artifact download call.

### Not proven by parity-07

- `link.click()` completion is not separately receipted.
- The native `download` event is not separately receipted.
- The fixture server does not retain a request/status ledger, so the click's exact server-side `GET` and status 200 are unproved.
- Download stream creation, exact bytes, byte count, and SHA-256 were not reached.
- `Promise.all` does not reveal in this failure which non-rejecting operands may already have resolved.

### Contract/source evidence

- Installed Playwright defines `page.waitForResponse` over a `Response`; it separately defines `Download` with `url()` and `createReadStream()` but no response status or request method.
- Chromium handling registers `Network.responseReceived` and `Browser.downloadWillBegin` as separate protocol events in `node_modules/playwright-core/lib/coreBundle.js`.
- Existing repository parity proofs for Diagnostic Bundle and Archive downloads wait for `download`, then read the downloaded path/stream and compare bytes. They do not require a matching page response event.
- `startFixtureServer` forwards the Hono response status to Node with `res.writeHead(response.status, ...)`, but its public interface exposes only `port`, `baseUrl`, `publish`, and `close`; it records no exchange.
- `tests/unit/dashboard/run-captures-fixture.test.ts` separately proves the real ephemeral fixture route can return exact `GET`/200 bytes. That does not prove the parity-07 click made that exchange.

Classification: the red is at an observation seam, not evidence of a product byte failure. The currently required page-response event may be unobservable for a browser-native download. Exact URL, method, status, native download, bytes, and SHA remain required and unwaived.

## Failures 2 and 3 — coarse-phone Receipt geometry

Both Paper and Graphite fail unchanged `control.inside` for the capture opener after the test closes the Workflow Panel, scrolls the whole capture `article` with `scrollIntoViewIfNeeded`, and asserts `toBeInViewport()` without a ratio.

### Contract/source evidence

- Installed Playwright documents `scrollIntoViewIfNeeded` as skipping scrolling only when the target is completely visible by IntersectionObserver ratio.
- Installed Playwright documents `toBeInViewport()` with no `ratio` as ratio 0: any positive intersection passes; it does not establish full containment.
- The retained prior observer measured the article at 486px high and its nearest relevant scroll container at 382px high. The whole article therefore cannot fit inside that container simultaneously.
- The retained prior observer also measured the opener's 44px effective target below the 390x844 viewport before this precondition repair. That is historical causal evidence only; parity-07 contains no post-scroll measurement.

Classification: article-level scrolling plus a zero-ratio viewport assertion can admit a partially visible article while its action row remains below the viewport or clipped by a nested scroller. The current red does not prove a product layout defect because exact post-scroll article/control/scroller measurements were not captured.

## Ranked falsifiable hypotheses

1. **High — native download response-event mismatch.** The exact fixture request may reach the server and complete as a native download while Chromium emits `downloadWillBegin` without a Page `Response` satisfying the waiter. Falsify if a same-click server ledger records no exact `GET`/200, or if an exact Page response is in fact observed.
2. **High — partial article visibility admits a hidden action row.** Article scrolling plus `toBeInViewport({ratio: 0})` leaves the opener below the viewport. Falsify if a post-scroll observer shows every actual and effective 44px control rectangle fully inside the viewport.
3. **Medium — nested scroller clipping determines the final position.** The scroll acts through an ancestor whose visible height is smaller than the article, and the chosen intersection clips the action row. Falsify if post-scroll ancestor rectangles, overflow, `scrollTop`, `clientHeight`, and `scrollHeight` show no clipping and the action row is fully inside.
4. **Lower — the click uses a wrong URL, method, or non-200 response.** Falsify with an exact one-exchange server ledger for the expected path, `GET`, and status 200.
5. **Lower — the click/download itself fails before byte proof.** Falsify with a native download event, exact `Download.url()`, successful stream completion, exact bytes, and expected SHA-256.

## Missing facts

- A same-click server-side exchange record for exact path, method, and response status.
- Whether the Page emitted any request/response/request-finished/request-failed events for the download URL.
- Whether the native download event resolved, its exact URL, and its stream byte/hash result.
- Post-scroll viewport, article, opener, Download control, effective-44px, and relevant ancestor geometry for both phone themes.
- Post-scroll ancestor overflow and scroll state.

## Smallest reversible diagnostic proposal

This requires a fresh explicit browser allocation. No part was executed during classification.

1. Temporarily extend only the test fixture adapter with an immutable snapshot of real artifact exchanges recorded at the Node/Hono adapter boundary: exact method, pathname, and actual response status. Do not add an extra fetch or change fixture success behavior.
2. Temporarily instrument the full-Receipt download case to record exact-URL Page request/response/request-finished/request-failed observations, the native `download` event and `Download.url()`, stream byte count/SHA-256, and the before/after fixture exchange ledger. Remove only the unobservable `waitForResponse` from the temporary diagnostic path; retain exact absolute URL, one user click, `GET`, status 200, native download, exact bytes, and SHA assertions.
3. Temporarily instrument both coarse-phone cases after the existing Escape, dialog-count-zero check, article scroll, and zero-ratio viewport assertion. Persist file-backed JSON and a screenshot containing viewport, article intersection, each control's actual/effective-44px rectangles and failed edges, and every relevant ancestor's rectangle, overflow, transform, `scrollTop`, `clientHeight`, and `scrollHeight`. Keep the existing geometry assertions unchanged.
4. Run exactly one minimized, separately locked command:

   `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts --grep 'full Receipt keeps exact JPEG/data captures|coarse phone Receipt'`

5. Preserve the exact temporary patch and raw file-backed output, then restore the active spec and fixture helper byte-for-byte in `finally`, verify their hashes, and run only the required restored locked light checks. Do not refresh references, extend timeouts, or repair product code while holding the diagnostic slot.

Expected diagnostic interpretation: the two unchanged phone geometry assertions may remain red while yielding the missing post-scroll measurements. Any product/source repair or a second browser command requires release and a new reviewed candidate/allocation.

## Disposition

The three parity-07 reds remain open and independently classified. The smallest next step is the one-command reversible observer above. No gate waiver, product fix, reference update, or full-gate readiness is claimed.
