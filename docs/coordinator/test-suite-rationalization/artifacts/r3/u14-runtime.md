# R3a u14 — runtime, CLI, process, and fixture audit

## Pre-edit ownership ledger

Recorded on 2026-09-02 before any R3a source/test edit, at base
`39598d2fb9c0964e3ac819c5b3de3538724a8380`.

| Retained test file | Unique boundary risk / failure oracle |
| --- | --- |
| `tests/unit/server/bootstrap-start-surface.test.ts` | Bootstrap’s start-plan admission surface and refusal wire |
| `tests/unit/server/compose-real-port.test.ts` | Full dashboard composition over temp authority, real HTTP/SSE, settings recovery, and shutdown |
| `tests/unit/server/dashboard-dev-proxy-origin.test.ts` | Dev proxy origin/Host contract without binding production ports |
| `tests/unit/server/dashboard-perf-fixture-shape.test.ts` | §7.4 benchmark fixture’s declared row/member/note/status shape |
| `tests/unit/server/preflight-runners.test.ts` | Composed runtime preflight runner behavior and failure propagation |
| `tests/unit/server/settings-runtime-reader.test.ts` | Locked Settings snapshot identity, freshness, and writer exclusion |
| `tests/unit/preflight-dashboard-runners.test.ts` | Dashboard dependency/port ownership observations over ephemeral fixture listeners |
| `tests/unit/preflight-runtime-dependencies.test.ts` | CLI/runtime dependency admission and actionable refusal output |
| `tests/unit/runtime-composition.test.ts` | CLI command routing and exact production isolation values |
| `tests/unit/runtime-process-orphans.test.ts` | Process-lock/orphan inspection without mutating live ownership |
| `tests/unit/vite-dashboard-proxy.test.ts` | Vite loopback/proxy configuration contract |

The historical Archive disconnect and dashboard fixture `beforeAll` timeouts do not reproduce in
focused runs at this base. The Archive route passes repeatedly through the real HTTP adapter and
production verified-byte reader; the fixture passes with its ≥20,000-note corpus. Both also pass
while a legitimate dashboard owns 3938/5174. Current evidence points to the earlier full-suite CPU
contention, not a deterministic retained cleanup defect; the repository now caps Vitest at four
isolated file forks. R3a will not add retries, skips, longer timeouts, or a smaller fixture.

## Verification record

No file or case was deleted, moved, or merged. Each table row names the retained boundary and its
direct failure oracle. The verbose gate printed the `unit` project, every file, and every complete
behavior/refusal title:

```text
u14_tests=(${(f)"$(sed -n '/| Retained test file |/,/^$/p' \
  docs/coordinator/test-suite-rationalization/artifacts/r3/u14-runtime.md \
  | rg -o 'tests/unit(?:/server)?/[^`]+\.test\.ts' | sort -u)"})
npm exec vitest run -- --project unit ${u14_tests[@]} --reporter=verbose

Test Files  11 passed (11)
Tests       151 passed (151)
Duration    13.17s (real 13.64s)
```

The six-case performance fixture passed with its declared ≥20,000-note corpus; its individual
cases completed in 12–178ms. The full 64-case composition file, including real settings recovery,
HTTP/SSE, process-launch injection, and shutdown, also passed. Together with u13 this is the exact
49-file/868-case owned family.

The earlier 30-second Archive and performance failures are classified as historical full-suite
contention, not deterministic retained defects: both focused files, the owned family, and the later
uncontended R2 coverage run pass at the supported four-fork cap. R3a changed no timeout, retry,
skip, fixture size, or production runner setting.

After the final family run, no process command referenced this worktree, no
`/tmp/hrauto-{compose,dashboard,perf}-*` directory remained, and `.tracker-rebuild/locks` contained
no entry. The legitimate dashboard listeners remained the same PIDs 95609/95590, proving the test
run neither killed nor replaced them.
