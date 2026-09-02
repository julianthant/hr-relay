# R6 u35 — runner/configuration truth

## Changed paths

| Path | Change |
| --- | --- |
| `playwright.parity.config.ts` | Replaced the obsolete 289-case/57–60-second performance claim with the current 281-case count and the two latest measured audit outcomes; preserved all runner behavior. |
| `duo-autopilot/README.md` | Corrected root-relative commands and made the live/offline distinction explicit. |
| `duo-autopilot/launch-selector-browser.mjs` | Corrected only the header's stale absent-package-alias examples. |

`package.json` was not edited. The audit premise that the root package has no
`test` script was incorrect: the existing root `npm test` runs the rebuild's
Vitest suite, not the Duo crypto self-test. The root package has no
`sel:browser` script.

## Check classification

| Surface | Classification | What it proves / writes |
| --- | --- | --- |
| Playwright parity lane | Offline browser integration | Built dashboard plus seeded/fixture BFF, strict screenshot/a11y/reference assertions, and per-worker ephemeral servers/state. |
| Duo crypto self-test | Offline | Byte-level WebAuthn crypto round trips with throwaway keys; no browser or HR system. |
| Selector launcher | Live read-only HR/Duo verification with local artifacts | Opens an auth-gated browser session for selector mapping; writes only gitignored local browser profile/config artifacts. |
| Document-number smoke | Local integration | Exercises the local smoke composition and its secure environment admission; it is not a live HR workflow run. |
| UI catalog, build manifest, roadmap checks | Offline generated freshness | Check repository-derived outputs against committed generated artifacts. |

## Verification

| Command | Outcome |
| --- | --- |
| `PLAYWRIGHT_HTML_OPEN=never npx playwright test --config playwright.parity.config.ts --list` | PASS — `Total: 281 tests in 17 files`. |
| `npm --prefix duo-autopilot test` | PASS — 43 passed, 0 failed. |
| `git diff --check` | PASS — no whitespace errors. |
| Scoped command-truth grep/check | PASS — no stale `npm run sel:browser` text; both documented launcher forms exist; root has no `sel:browser`; `.auth/` and `.playwright/` artifacts are ignored. The root `test` script is intentionally identified as Vitest rather than Duo crypto. |

No live HR/Duo command or document-number smoke was run.

## R7 wiring recommendation

If R7 wants a root convenience alias, it should add one deliberately in
`package.json` for the launcher and document its live read-only classification.
This unit deliberately did not add that alias. Root scripts currently provide
no `sel:browser`; the existing root `test` remains the broad Vitest suite, not
the Duo crypto self-test.
