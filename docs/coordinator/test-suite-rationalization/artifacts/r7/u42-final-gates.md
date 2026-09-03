# R7 u42 — final gates, deltas, output proof, and cleanup

## Accepted clean-state proof

The accepted measurements ran at committed HEAD `62209483` with no legacy override and no
concurrent compiler, linter, Vitest, Playwright, or performance process visible at admission. Each
long gate wrapper started the repository's real `scripts/dev-dashboard.ts`, waited for
`GET /api/v1/bootstrap` and the Vite index, recorded the Node listeners on reserved ports 3938 and
5174 before the gate, re-read both endpoints and listeners after the gate, then stopped the
dashboard. The tracked tree was clean throughout the measured runs.

| Gate | Accepted result | Wall time |
|---|---|---:|
| `npm run typecheck` | PASS | 16.26 s |
| `npm run lint` | PASS, zero warnings | 32.42 s |
| `npm run test:coverage` | PASS — 393 files / 4,885 tests; suite-size report chained | 121.88 s |
| `npm run test:architecture` | PASS — 70 files / 707 tests | 21.18 s |
| `npm run test:parity` | PASS — 281/281; secure JSON evidence verified | 57.12 s |
| `npm run build:manifest:check` | PASS — generated workflow manifest current | 1.89 s |
| `npm run roadmap:check` | PASS — generated roadmap site fresh | 0.42 s |
| `npm --prefix duo-autopilot test` | PASS — 43/43 | 0.26 s |
| `npm run perf:dashboard -- --iterations 5` | PASS — all six structural bounds | 10.95 s |
| `git diff --check` | PASS | non-timed |
| twin hashes | PASS — root pair identical; scenario pair identical | non-timed |

The first final roadmap check correctly failed stale after the owning reference changed. Running the
sole generator replaced one generated JSON line, `62209483` committed it, and the accepted rerun
above passed. The manifest needed no regeneration.

## Exact census and coverage delta

The reservation base `e880da7` was measured directly before R7; the final values come from the
accepted coverage run and its chained suite-size report.

| Measure | R7 base | Final | Delta |
|---|---:|---:|---:|
| Vitest files | 393 | 393 | 0 |
| Vitest cases | 4,883 | 4,885 | +2 |
| unit files / cases | 306 / 4,044 | 306 / 4,046 | 0 / +2 |
| scenario files / cases | 17 / 132 | 17 / 132 | 0 / 0 |
| architecture files / cases | 70 / 707 | 70 / 707 | 0 / 0 |
| unit source lines | 111,789 | 111,789 | 0 |
| scenario source lines | 7,060 | 7,105 | +45 |
| architecture source lines | 27,512 | 27,587 | +75 |
| statements | 85.40% (28,534/33,412) | 85.40% (28,534/33,412) | 0 |
| branches | 76.39% (15,367/20,115) | 76.39% (15,367/20,115) | 0 |
| functions | 89.41% (5,660/6,330) | 89.41% (5,660/6,330) | 0 |
| lines | 87.34% (26,293/30,103) | 87.34% (26,293/30,103) | 0 |
| parity specs / cases / triples | 17 / 281 / 222 | 17 / 281 / 222 | 0 / 0 / 0 |

The two added unit cases are the structural-performance negative controls. Phase reporting and
diagnostic assertions strengthen existing cases rather than manufacturing count. Intermediate
board counts predate the final R5b integration; the direct `e880da7` measurement is the R7 base.

## Runtime and reporter delta

The exact same committed 393-file/4,885-test state ran twice under the legitimate dashboard:

| Stream | Wall time | Delta from compact |
|---|---:|---:|
| explicit compact `--reporter=dot` | 121.46 s | — |
| canonical single `verbose` reporter | 121.88 s | +0.42 s / +0.35% |

The labeled stream therefore adds negligible measured cost and does not duplicate a second
reporter. It shows `|project| file > suite > full behavior/refusal title`; the lifecycle walk shows
ten ordered begin/complete phases, and the existing R3a/R3b long harnesses show their stable
startup/request/teardown or spawn/stop phases.

The ≤90-second full-coverage target remains **unmet by 31.88 seconds** and is not waived. R7's
bounded source-scan caches and project organization improved the uncontended base compact sample
from 146.66 s to 121.46 s (-25.20 s), but unique protection, four-worker isolation, and 30-second
per-file bounds were preserved. Parity is within its ≤75-second target by 17.88 seconds.

Two earlier coverage attempts are deliberately excluded from timing authority:

- one ended after 1,603.32 s with five 30-second hook/test timeouts while an unrelated phase-3c
  coverage job overlapped; there were no assertion mismatches;
- one passed 393/4,885 after 824.48 s, but another repository coverage job started after admission.

Both prove why contention is inspected rather than used to weaken a timeout or revise a target.

## Green and controlled-red output proof

| Runner family | Representative green | Controlled intentional red |
|---|---|---|
| Vitest | labeled architecture/unit/scenario entries plus all ten lifecycle phases | temporary assertion after `01-upload:begin` named project, file, full lifecycle behavior, phase, and controlled message |
| Playwright | list stream named each file:line and full behavior; 281 passed | temporary inverted A169 toast-clearance assertion named file:line, full behavior, viewport, and measured geometry; the evidence verifier also refused the intentionally incomplete focused run |
| Duo Node self-test | 43 named crypto checks passed | temporary false base64 round-trip reported the named case and 42 pass / 1 fail |
| dashboard performance | report named each path, audit, timings, and counters | temporary ceiling 5,568 refused: `dashboard performance dayWireStatements must be at most 5568; measured 5569` |
| generated manifest | current at 380,440 bytes | temporary toolchain-byte drift refused the checked-in/generated files as stale with both byte counts |
| generated roadmap | fresh at 1,253,775 bytes | temporary title-byte drift refused `docs/roadmap/index.html` as stale and named the repair command |

Every mutation was restored before the next gate and changed no committed source. The pdfjs
unreadable-input warning is now captured, exactly asserted, and restored inside its scenario test;
it no longer leaks as unexplained stderr. Playwright emitted only its runner-level inherited
`NO_COLOR`/`FORCE_COLOR` notice, not a product failure or swallowed diagnostic.

## Structural performance result

The clean benchmark measured day-wire SQL 5,569; row-patch whole-day parses 0; Logs span parses 0;
Logs files in scope 2; archive-freeze SQL 13; member-preview delta SQL 6. Median observations were
150.88 ms day wire, 0.02 ms row patch, 39.48 ms Logs, and 42.25 ms archive freeze. Only the stable
non-duration counters gate.

## Cleanup

Cleanup was performed after the report packet commit `e05f825febe6241ee4cf9b5900fe11def5120263`.
The pre-cleanup `git status --short --ignored` named exactly `.env`, `.tracker-rebuild/`,
`config/settings.json.authority.json`, `coverage/`, `dist/`, `node_modules`, and
`tests/parity/.output/`. Those ignored, regenerable paths were moved out of the run worktree to the
recoverable host-temporary directory `/tmp/r7-cleanup.Tk5vPp`; no tracked path was removed.

The immediate post-cleanup observations were:

| Command | Exit/result |
|---|---|
| `git status --short --ignored` | 0; no output |
| `git status --porcelain=v1` | 0; no output |
| listeners on TCP 3938 and 5174 (`lsof`) | 1; no output — neither port had a listener |
| current-worktree Node/Vite/Playwright/Chromium process scan | 1; no output — no match |
| `playwright-cli list` | 0; `(no browsers)` |
| current worktree registration | `e05f825f...`, `feature/test-r7-integration-review` |
| `feature/test-r7-*` branch inventory | only the current run branch |

All reviewers were read-only, so R7 created no worker worktree or worker branch to remove. This run
worktree and branch deliberately remain registered for coordinator integration, as the brief
requires the coordinator to perform project-worktree cleanup. The final resolved commit SHA cannot
be embedded inside the commit that contains it; it is proven with `git rev-parse HEAD` in the
supervisor return together with a final empty porcelain check.
