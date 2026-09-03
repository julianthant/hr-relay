# R6 u33 — performance benchmark audit

## Finding

`npm run perf:dashboard` is a useful deterministic measurement instrument, but it is not currently a failure-capable performance gate. It prints counters and durations and compares none of them to a budget.

Two unchanged runs took 16.08s and 17.44s. Their stable structural counters were:

| Metric | Both runs | Assessment |
| --- | ---: | --- |
| day-wire SQL statements | 5,569 | Stable, but normative text records 5,568 |
| patch JSON parses | 0 | Suitable exact budget |
| logs span parses | 0 | Suitable exact budget |
| freeze SQL statements | 13 | Suitable upper budget |
| preview SQL delta | 6 | Suitable upper budget |

The duration samples were noisy (for example, one measured section moved from 171.70ms to 272.36ms), so machine-local elapsed timings should remain observational. The fixture shape is representative and deterministic: 1,240 day rows, a 108-member operation, 20,800 notes, real migrations/writers/projection, and an ordinary unit test that pins the shape.

## Baseline conflict

`docs/rebuild/reference/frontend-backend-integration.md` §7.4 records a post-cap day-wire count of 5,568. Current code consistently measures 5,569 because D269 added `listWorkerPools()` in commit `24b04dfa` (the read is now part of `run-queue-projection.ts`). R6 therefore did not invent a threshold, change the benchmark, or add package wiring.

## R7 recommendation and coordinator choice

Retain `perf:dashboard` as the report-only measurement command and add a separate asserted check for the machine-independent counters. Candidate budgets with direct evidence are patch parses = 0, log span parses = 0, log scope ≤2 files, preview delta ≤6 SQL statements, and freeze ≤13 SQL statements. The day-wire cap must first be reconciled.

`NEEDS COORDINATOR`: choose whether the authority should ratify 5,569 as the intentional D269 baseline (recommended by the audit), require product query work to restore 5,568, or leave only that one counter report-only while asserting the undisputed budgets. No R6 code or threshold depends on this choice.
