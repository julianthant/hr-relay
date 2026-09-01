# Board — R-DCT mobile document capture retirement

**Integration branch:** `master` (operator-directed direct integration)
**Board owner:** R-DCT supervisor at close
**Write rule:** only the R-DCT supervisor may update this file, once, while closing the run
**Last verified:** 2026-09-01 at local `master` HEAD

## Facts every run needs
- Main board: `docs/plans/dashboard-completion-board.md`; plan: `docs/plans/2026-08-28-dashboard-completion-runs.md` §DCT1–DCT6.
- Operator direction: remove Capture Mode from the rebuild, its active plans and roadmap.
- Boundary: retire the mobile document-capture product only. Preserve diagnostic bundle screenshots, artifact evidence, receipt/run-detail capture records and other non-phone meanings of “capture.”
- This repository is not production, but durable schema/migration removal still requires explicit authority judgment and tests; do not leave orphaned tables or silently rewrite compatibility history.

## Unit ledger
| Unit | Status | Merge SHA | Gate evidence | Review | Notes |
|---|---|---|---|---|---|
| DCT1 | complete | `46c6ff3a` | reviewed keep/delete inventory | complete | mobile document capture isolated from diagnostic, Receipt and Archive evidence |
| DCT2 | complete | `57bf7884` | Intake client 7/7; browser inspection | complete | phone page, Vite entry and Intake control removed |
| DCT3 | complete | `50dc9a52`, `1ce11401`, `f7772c4b` | v28 migration and retirement boundary tests | complete | commands, routes, services, secrets, tables and stale writable config retired |
| DCT4 | complete | `5ea4ff70`, `8c34770e`, `34e97b5c` | `roadmap:check` passed | complete | D294 ratified; Phase 05 and stale preflight binding reconciled |
| DCT5 | complete | `4834826c`, `1a3ca31f`, `b67084fe` | architecture 680/680; coverage 4,566/4,566 | complete | retired tests removed and remaining evidence coverage preserved |
| DCT6 | complete | `0644f9ff`, `ca768414`, `546e375e` | parity 293/293; typecheck, lint and production build passed | complete | full corpus re-frozen against the retired authority; no `capture.html` output |

## Closure evidence

- `npm run test:coverage`: 367 files and 4,566 tests passed; 85.08% statements, 87.08% lines.
- `npm run test:architecture`: 69 files and 680 tests passed.
- `npm run test:parity`: 293/293 passed in assertion mode after the reviewed corpus refresh.
- `npm run typecheck`, `npm run lint`, `npm run roadmap:check`, `npm run build:manifest`, and `npm run web:build`: passed. The regenerated build manifest had no diff.
- Production HTML contains only `index.html` and `kit.html`; no `capture.html` is emitted.
- Playwright CLI opened the live Intake surface and found spreadsheet upload only; `phone capture` was absent. The browser was closed and the process list was empty.
- Exact active-source retirement search found only the dated `src/dashboard/AGENTS.md` prohibition against reintroducing the product.
- Diagnostic bundle screenshots, Receipt capture tiles and Archive evidence remain served and covered.
- No push or live HR action occurred. The unrelated local edits in `src/infra/providers/local-vite-probe.ts` and `tests/unit/server/preflight-runners.test.ts` were left untouched.

## Questions for the operator
- None. “Remove Capture Mode” is treated as full retirement of the mobile capture product, not deletion of generic evidence captures.
