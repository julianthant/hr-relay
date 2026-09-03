# R6 u34 — smoke, Duo, and generated-check audit

## Classification

| Surface | Classification | What it proves | Side effects / boundary |
| --- | --- | --- | --- |
| Playwright parity | Offline browser integration | Built dashboard, deterministic adapters, screenshots, accessibility trees, interactions | Ephemeral servers and temporary state only |
| `npm --prefix duo-autopilot test` | Offline | WebAuthn crypto encoding/signing round trips with throwaway keys | No credential or network use; 43/43 passed in audit |
| `node duo-autopilot/launch-selector-browser.mjs <login-url>` | Live read-only | Real auth-gated selector/login behavior and Duo ceremony | Writes gitignored local Playwright config/profile artifacts; must close the session |
| `scripts/live-browser-login-smoke.ts` | Live read-only | Real browser login against configured systems | Writes browser profile/lock/SQLite state; not run in R6 |
| `scripts/smoke-test-target-document-number.ts` | Local integration | Secure `.env` admission, registry/configuration, and document-number startup composition | Reads local ignored environment; does not open HR browser itself; not run in R6 |
| UI catalog generator/check | Offline generated freshness | Generated catalog equals declared UI registrations | Freshness enforced by its architecture/unit check rather than a live service |
| build manifest check | Offline generated freshness | Descriptor fingerprints match source closures | No live service |
| roadmap check | Offline generated freshness | Committed roadmap HTML matches roadmap source | No live service |

## Truthfulness findings

The Duo extension README advertised an absent root `npm run sel:browser` alias and presented root `npm test` as though it ran the Duo crypto self-test. Root `npm test` does exist, but it runs the rebuild's Vitest suite; the real Duo commands are the direct selector launcher and `npm --prefix duo-autopilot test`. u35 owns the documentation correction; a convenient root launcher alias, if desired, belongs to R7 because R6 must not edit `package.json`.

The Duo `.mjs` self-test should not be chained into root coverage. D244 deliberately pins its load-bearing sign-count behavior through `tests/unit/duo-sign-count.test.ts`; the standalone suite remains a focused offline crypto check.

Offline audit checks passed: Duo crypto 43/43, build-manifest freshness, and roadmap freshness. No live HR/Duo login and no local document-number smoke were run; this is classification evidence, not a claim that those live/local integrations succeeded.
