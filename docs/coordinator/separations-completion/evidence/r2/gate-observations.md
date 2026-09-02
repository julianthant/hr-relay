# R2 gate observations

Initial source: `85d3b0829d34f327f594c77c7e782ae28a8e2a1e`. Coordinator's documentation changes are concurrent; runtime source, config, tests and scripts have no R2 edits. Dashboard launcher PID 8946 (BFF 9025, Vite 9023) was verified, gracefully stopped with SIGTERM, and both listeners observed absent before test execution. No workflow worker was started.

| Gate | Initial result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `.screenshots/separations-2026-09-02/r2-typecheck.log` |
| `npm run lint` | exit 0 | `.screenshots/separations-2026-09-02/r2-lint.log` |
| `npm run build:manifest:check` | exit 0, generated manifest current | `.screenshots/separations-2026-09-02/r2-build-manifest-check.log` |
| `npm run roadmap:check` | exit 0 after coordinator regenerated index | `.screenshots/separations-2026-09-02/r2-roadmap.log` |
| `npm run test:coverage` (first run) | exit 1; 384/388 files passed, 4 failed; 4,786 tests passed, 3 failed, 6 skipped / 4,795 | `.screenshots/separations-2026-09-02/r2-coverage.log` |
| `npm run test:parity` | exit 0; 287 passed; assert mode, no baseline updates | `.screenshots/separations-2026-09-02/r2-parity.log` |

The first coverage pass ran alongside typecheck/lint/manifest checks. Four 30-second timeouts occurred:

- `tests/unit/server/dashboard-perf-fixture-shape.test.ts:36`, fixture `beforeAll` hook; its six tests skipped.
- `tests/unit/architecture/descriptor-coverage.test.ts:415`, manifest BYTE drift assertion.
- `tests/unit/architecture/guard-manifest.test.ts:195`, all required ratchet arms and violating fixtures.
- `tests/unit/architecture/runtime-environment-coverage.test.ts:178`, closed registry and repository occurrence validation.

No limits, configurations, assertions, baselines or source were changed. The previous run's storage singleton failure did not recur. One full coverage rerun was executed alone to remove self-imposed contention as a variable. Overlap is an observation, not a proved timeout root cause. A later green result does not erase this first red.


## Serial rerun and final status

`npm run test:coverage` alone exited **1**: **386/388 files passed, 2 failed; 4,788 tests passed, 1 failed, 6 skipped / 4,795**, duration 146.83 s. Raw log: `.screenshots/separations-2026-09-02/r2-coverage-serial.log`.

- `tests/unit/server/dashboard-perf-fixture-shape.test.ts:36` again failed its 30,000 ms `beforeAll` hook while seeding the fixture; six tests skipped.
- `tests/unit/architecture/guard-manifest.test.ts:195` again timed out at 30,000 ms while executing the required ratchet arms/violating fixtures.
- Descriptor BYTE drift and runtime inventory cases passed this time. The old storage singleton failure did not recur in either R2 pass.

The integrated full gate is **RED**. Coverage percentages and suite-size success are not reported: the failing `vitest` command never advanced to the script chained after it. Test/timeout/coverage-floor values remain unchanged. Current evidence does not prove a root cause. The coordinator assigned focused follow-on R2a ownership for scheduling/performance diagnosis; R2 made no source fix and no additional rerun.

Final `npm run roadmap:check` after coordinator's last status-doc changes exited 0 (`r2-roadmap-final.log`); `git diff --check` exited 0. Runtime restored and UI inspected after all tests, with unchanged write counts; see `storage-after.json` and `ui-inspection.md`.
