# R3b u18 — consequential R3 review and gate

## Pinned review target

`18e5294de0b07f147349a2d62edcc6a5728fcf15...72ff492e`, changing only:

- `tests/unit/server/worker-pool-composition.test.ts`
- `tests/unit/server/worker-pool-parallel-proof.test.ts`

## Independent and supervisor review

| Axis | Result | Evidence |
| --- | --- | --- |
| Repository standards | 0 findings | Literal `0` uses the existing typed test seam; no production constant, timeout, retry, skip, or fallback changed |
| Originating spec | 0 findings | Matches the R3b brief and `execution-and-sessions` C12 separation |
| Correctness | 0 findings | Independent Terra review: frontend override feeds only preflight; phase boundaries match actual startup/birth/stop/shutdown/reap operations |
| Silent failures | 0 findings | No catch/default/retry added; the original port refusal remains visible in the controlled red and all real assertions remain intact |
| Performance | 0 diff findings; 1 retained program risk | Marker writes are phase-only, not per assertion. Full coverage is 131.80s, above the ratified ≤90s target; R7 must profile without deleting unique protection |
| Tests | 0 findings | Independent Terra review: exact active-5174 red capability, no weakened assertion or mock replacement, and timeout output retains the last begun phase plus existing diagnostics |
| Docs | 0 findings | Production behavior and public commands did not change; run-scoped evidence is recorded in u15/u17/u18/report |
| Security | 0 findings | Test-only literal ports and constant non-secret labels introduce no input, command, credential, or permission path |

Security/concurrency/fail-loud judgment remained supervisor-owned. No simplification pass was run:
the two literal overrides are the minimum fix, and the phase helper prevents duplicated output syntax.

## Gates

| Gate | Result |
| --- | --- |
| controlled red before fix | expected FAIL: 2 files failed; 2 failed / 22 passed; exact project/file/title and frontend-5174 refusal at `compose.ts:1272` |
| focused two-file green | PASS: 2 files / 24 cases; 3.21s |
| focused family | PASS: 10 files / 238 cases; 4.80s |
| labeled W5 | PASS: 1 file / 7 cases; all stable phase begin/complete markers; 2.97s |
| active-port coverage | PASS: 393 files / 4,887 cases; 131.80s; statements 85.40%, branches 76.39%, functions 89.41%, lines 87.34% |
| architecture | PASS: 70 files / 705 cases; 24.85s |
| typecheck | PASS |
| lint | PASS, zero warnings |
| build manifest check | PASS, current |
| roadmap check | PASS, fresh |
| diff check | PASS |

Coverage verbose log: 5,370 lines, SHA-256
`2cf75d71984f67202b7eea472ddcc3fd34b262b6d74d91d940a8d064fd1a262b`. The listener
snapshot before and after was identical: backend PID 59949 on 3938 and frontend PID 59931 on 5174.
No unexpected artifact-reader ENOENT, cleanup aggregate, leaked worker child, test temp root, or run
worktree lock remained.
