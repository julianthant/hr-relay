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

Pending owned-family gate, repeated timeout checks, and no-residue proof.
