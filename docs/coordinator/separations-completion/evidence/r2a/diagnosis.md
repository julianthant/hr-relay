# R2a gate reliability diagnosis

Initial source: `85d3b082`. Scope: runner scheduling/performance only. No protocol/UI/runtime behavior change.

## Red loop and minimization

Exact original gate: `npm run test:coverage` (run twice in R2). The second ran alone with dashboard stopped: exit 1, 386/388 files passed; 4,788 tests passed, 1 failed, 6 skipped / 4,795. Failures: 30,000 ms `beforeAll` at `tests/unit/server/dashboard-perf-fixture-shape.test.ts:36` and 30,000 ms ratchet test at `tests/unit/architecture/guard-manifest.test.ts:195`. Full raw log: `.screenshots/separations-2026-09-02/r2-coverage-serial.log`. The first R2 run had two additional timeouts while compiler/linter overlapped; neither occurred on the serial repeat.

Minimization command:

```sh
npx vitest run --coverage --reporter=verbose tests/unit/server/dashboard-perf-fixture-shape.test.ts tests/unit/architecture/guard-manifest.test.ts
```

Both files and all **12 tests passed**, total 16.87 s; ratchet assertion **12,419 ms**. The command's exit is **1**, from unchanged whole-repository coverage floors (e.g. statements 15.85% < 60%), expected when only two test files run. That is not called a green integrated gate. It proves the recurring cases finish under their existing deadlines absent the whole-corpus scheduling load. Raw log: `.screenshots/separations-2026-09-02/r2a-focused-covered.log`.

## Ranked falsifiable hypotheses

1. The default ten simultaneous coverage forks contend for resources on this host; full-corpus execution with a bounded fork count should make the original named failures disappear without changing their work. Recurrent timeout at a low fork count would falsify sufficiency of that repair.
2. The fixture/scanner itself has grown beyond the 30-second budget; isolated covered cases would still exceed it. The minimized 12-test run contradicts this on the observed host.
3. A different test interferes with shared state; failure would persist or vary with a particular co-scheduled set after resource concurrency is reduced. If bounded scheduling fails, bisect that set and inspect filesystem/process isolation rather than rewrite algorithms speculatively.

Host observation: Node reports 11 available CPUs, 18 GiB total RAM. Installed Vitest 4.1.10 `getDefaultThreadsCount` in `node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:2354` uses `max(numCpus - 1, 1)` outside watch mode; no repo maxWorkers override existed. Thus the default permits 10 forks. Both projects retain fileParallelism and per-file isolated forks. No environment worker override was introduced.

The next controlled experiment changes only scheduling:

```sh
npx vitest run --coverage --reporter=dot --maxWorkers=4 && npx tsx scripts/suite-size.ts
```

All test membership, coverage includes/exclusions/floors, isolation, assertions and 30-second test/hook limits remain unchanged. The second command runs only if the complete covered corpus passes, matching the default npm gate. `four-worker-snapshot.json` is a read-only process sample showing four worker forks; it is a resource observation, not a production probe.


## Controlled result and selected repair

The four-fork full experiment exited **0** with **388 files / 4,795 tests passed**, no skipped tests, and the normal coverage floors met. Statements **85.26%**, branches **76.34%**, functions **89.13%**, lines **87.20%**. Test duration **169.54 s**; suite-size postcheck passed. Raw log: `.screenshots/separations-2026-09-02/r2a-full-four-workers.log`.

With the same source and complete corpus, changing file-worker scheduling alone removed both recurring timeout failures. This supports excessive concurrent coverage work as the actionable cause on this host; it does not isolate CPU versus memory versus disk pressure or establish a universal optimum. The slower successful wall time versus the 146.83 s failed baseline is an acceptable reliability tradeoff: the failed baseline also skipped six cases and cannot be treated as equivalent work.

Selected repair: `vitest.config.ts` caps worker forks at `Math.min(4, availableParallelism())`. A smaller host is not forced to run four. Per-file fork isolation and both projects' fileParallelism stay enabled; concurrency explicitly created inside tests remains exercised. No fixtures/scanner algorithm or test was edited. Root instruction twins record the rationale. Their pre-existing D308 lesson mismatch was resolved by preserving the existing CLAUDE lesson in both, with coordinator authorization; no D308 semantics changed.

The original default command must still pass after the config change; that final gate, lint/typecheck and restored runtime are reported separately. A config-value-mirroring test would not reproduce the failure: the unchanged full coverage corpus is the regression gate and the original uncapped command already failed twice.


## Original command regression result

After applying the scheduling choice to config, the unchanged `npm run test:coverage` invocation passed: **388 files / 4,795 tests**, no failed or skipped cases, **152.65 s**. Coverage remained statements **85.26%**, branches **76.34%**, functions **89.13%**, lines **87.20%**, all existing global/safety thresholds satisfied; chained suite-size passed. Actual default-command process snapshot shows four forks (`default-worker-snapshot.json`). This is the second successful full corpus at the selected scheduling limit, including the actual npm acceptance command.

`npm run typecheck`, `npm run lint`, `npm run build:manifest:check`, `npm run roadmap:check`, `git diff --check` and twin byte equality passed. No extra full-suite repetitions were needed after this exact acceptance result. Source commit: `5853ef804a59b59fa171bc03a2e005e905f57a22`.

No tagged probes were added to source/tests/config. The only `[DEBUG-r2a]` markers are retained read-only resource observations in this clearly named evidence directory. No throwaway code or browser sessions remain.
