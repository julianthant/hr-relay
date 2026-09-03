# R2 u12 — cross-seam consolidation and review record

## Before and after

| Measure | Intake | R2 result | Delta |
| --- | ---: | ---: | ---: |
| R2-owned files | 81 | 82 | +1 |
| R2-owned cases | 1,151 | 1,156 | +5 |
| deleted/merged cases | 0 | 0 | 0 |
| test-output label corrections | 0 | 5 | +5 |

The objective is unique protection, not a smaller count. Independent Scout and Analyst passes found
no evidence-safe deletion. Every apparent overlap below reaches a different public seam or oracle.

| Candidate | Same-looking fact | Distinct failure boundary | Decision |
| --- | --- | --- | --- |
| recipe conformance vs equivalence | descriptor/task membership | generic registry/compiler drift vs fixed public person-lookup/separations behavior | retain both |
| write recovery vs parked round trip | confirmed-present/absent settlement | direct resolution executor vs command-kernel durable lifecycle/result | retain both |
| late span root tests | authority reconstruction | repair mutation vs doctor validation vs ordinary writer prevention | retain all three |
| planner/kernel/fan-out omission tests | omitted steps stay omitted | each transition can independently drop or manufacture the omission | retain each seam |
| intake mapping refusal | unknown target/column | pure binding validator vs command rejection with no authority mutation | retain; disambiguate title |

## Accepted changes

- Added `workflow-transaction-outcome.test.ts`, five cases covering both durable dispositions, exact
  nested output/proof schema hashes, and matching-hash value parsing.
- Renamed three recipe suite labels to say `transitional`, matching workflow-model §1.6 and avoiding
  a false claim that the interim recipe name is the final D317 authoring API.
- Renamed the write-safety suite to name its schema/negative-settlement seam and the intake command
  case to name its pre-mutation command refusal.

## Negative control and baseline

Reversing `projectTransactionOutcome`'s commit-output hash comparison made all five new cases fail
with labeled project/file/full-title output and exact source locations. Restoring the production line
returned 5/5 green; no production mutation remains.

The untouched full ordinary-unit baseline collected 306 files / 4,041 tests and passed 305 files /
4,040 tests in 126.45 seconds. Its only failure was the existing 30-second
`tests/unit/server/archive-capture-routes.test.ts` client-disconnect timeout, owned by R3. R2 neither
suppressed nor modified it.

## Retained-case proof protocol

The u07–u11 ledgers are exhaustive over the 82 owned source files. Within those files, the committed
`describe > it` title is the case-level failure condition and is emitted with the `unit` project and
file by the focused verbose gate. Each retained case maps to the required proof fields as follows:

| Required field | Exhaustive evidence for every retained case |
| --- | --- |
| unique contract/risk | the owning u07–u11 seam row plus the case's full behavior/refusal title |
| cheapest adequate layer | ordinary unit: pure/schema/task/core cases call the public function directly; storage/event cases use the real temp-file or SQLite adapter without server, browser, or scenario composition |
| failure condition | the exact full title and its asserted output, refusal, ordering, identity, or durable-state consequence in the listed source file |
| negative-control/equivalent proof | refusal cases supply malformed/foreign/stale/duplicate input; recovery and concurrency cases inject the named failure or competitor; positive cases assert exact non-default values and durable state; no equivalence proof substitutes for a retained assertion |

Parameterized storage cases count as their expanded titled invocations, not as one declaration. This
is why the ledgers and final gate report 312 u07, 157 u08, 219 u09, 230 u10, and 238 u11 cases. The
82-file verbose gate passed every one: 1,156/1,156 in 17.24 seconds. The source titles and assertions
remain the durable case ledger; duplicating 1,156 test bodies into this artifact would create a
second authority that could drift.

The added projection test received an additional independent negative review: its first positive
case initially reused fixture defaults, which could not disprove hard-coded re-derivation. It now
round-trips distinct valid output/proof transaction ids; the focused file passes 5/5.

## Final gates

| Gate | Result |
| --- | --- |
| owned R2 family | PASS — 82/82 files, 1,156/1,156 cases, 17.24s |
| transaction-outcome focused recheck | PASS — 1/1 file, 5/5 cases, 1.28s |
| ordinary unit baseline | RED outside R2 — 305/306 files and 4,040/4,041 cases passed; Archive disconnect timed out |
| ordinary unit final | RED outside R2 — 305/307 files and 4,039/4,046 cases passed, six skipped after a setup timeout; Archive disconnect test and dashboard perf fixture setup timed out |
| coverage, first attempt | INVALID contention diagnostic — another worktree's compiler overlapped; 382/394 files and 4,871/4,888 cases passed, 11 tests timed out, six skipped, one fork-start error; 2,072.35s |
| coverage, uncontended | RED outside R2 — 394/395 files and 4,890/4,891 cases passed in 144.60s; sole failure was the reserved-port-3938 refusal in `compose-real-port.test.ts` |
| architecture | PASS — 70/70 files, 703/703 cases, 39.24s |
| typecheck / lint | PASS / PASS |
| build manifest / roadmap | current / fresh |
| `git diff --check` | PASS |

The same R3-owned Archive timeout before and after R2 isolates it from this diff. The final full run's
R3-owned dashboard performance fixture also exhausted its 30-second `beforeAll`; R2 does not weaken,
skip, or lengthen either check. The first coverage attempt overlapped a compiler in another worktree,
so it is retained only as diagnostic evidence. After that compiler exited, the uncontended rerun's
sole red was the run plan's carried-in active-port hermeticity defect. The coordinator assigned the
ordinary-unit failures to R3a/u13–u14 and the coverage failure to R3a/u16, and accepted R2's green
owned lane as return evidence.

## Review disposition

The preliminary independent review of `a638e8c3...b6dedad2` passed repository standards, found the
missing final artifact/report expected at that interim target, and found one test-quality defect:
the positive projection case could not disprove hard-coded default values. Commit `f7b9fd95` fixed
that defect. On the complete target, Standards required the repository-level coverage invocation;
the uncontended result above resolved that omission, with its sole failure assigned to R3a/u16.
Spec and Tests re-review passed with no remaining R2-local finding. The final pinned-target axes are
recorded in the R2 report. Server-projection relocation and the final D317 recipe deletion/rename
remain R3/R7 and active Phase 3c residue respectively.
