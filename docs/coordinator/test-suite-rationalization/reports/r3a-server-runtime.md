# R3a report — server/BFF/runtime tests and real-port hermeticity

**Status:** `COMPLETE`

**Branch:** `feature/test-r3a-server-runtime`

**Base:** `39598d2fb9c0964e3ac819c5b3de3538724a8380`

**Implementation head before this report:** `322ac84e5bfda24314b93fcc54248fcf6de6c5bc`

## Outcome

| Surface | Result | Proof |
| --- | --- | --- |
| u13 BFF/server | retained 38 files / 717 cases | verbose owned-family pass in 8.55s |
| u14 runtime/process | retained 11 files / 151 cases | verbose owned-family pass in 13.17s |
| u16 real-port seam | 1 test harness repaired; no production code changed | occupied-port red, focused green, exact-port rebind |
| deletions/moves/merges | 0 files / 0 cases | no same-seam, same-risk, same-oracle equivalence found |

The only implementation change is in `tests/unit/server/compose-real-port.test.ts`. A test-local
wrapper supplies both literal-zero overrides to the existing composition seam, so all 64 cases own
OS-assigned backend and frontend ports. The end-to-end bootstrap/day/SSE case no longer converts
port collisions into success; it propagates startup/request failures, awaits subscription/runtime
teardown, and proves release by rebinding the exact ephemeral backend port.

Production isolation remains unchanged at 3938/5174. The legitimate dashboard stayed active with
PID 95609 on 3938 and PID 95590 on 5174 through the focused and owned-family gates.

## Ownership and retained-risk audit

- u13 owns the 38 BFF route, wire, query, projection, archive-resource, and verified-byte files
  listed in `artifacts/r3/u13-bff.md`.
- u14 owns the 11 composition, preflight, Settings-reader, CLI, process-orphan, performance-fixture,
  and Vite-proxy files listed in `artifacts/r3/u14-runtime.md`.
- u16 overlaps `compose-real-port.test.ts` only and records its red/green/rebind evidence in
  `artifacts/r3/u16-ports.md`.
- `worker-pool-composition.test.ts`, `worker-pool-parallel-proof.test.ts`, and
  `worker-supervisor.test.ts` remain exclusively R3b-owned and were not edited.

Each retained-file ledger names one unique boundary risk and direct failure oracle. The exact
verbose family commands emit the `unit` project, file, and complete behavior/refusal title. No
deletion or consolidation needed a survivor/equivalence record because none occurred.

## Carried timeout classification

The Archive client-disconnect case completed in 362ms through the real Node HTTP adapter and
production byte reader. The six-case performance fixture kept its ≥20,000-note corpus and completed
without setup or case timeout. The exact 49-file/868-case owned union passed under the repository's
supported four-fork cap while the legitimate dashboard occupied both reserved ports.

The historical 30-second timeouts are therefore classified as full-suite contention, not a
deterministic retained cleanup defect. R3a did not add a retry, skip, timeout increase, fixture
reduction, or runner-parallelism change.

A broader diagnostic intentionally included the three R3b-reserved worker files. With 5174
occupied, `worker-pool-composition.test.ts` and `worker-pool-parallel-proof.test.ts` still failed
their real-runtime shutdown paths; the failed worker composition also emitted a cleanup-time
artifact-reader `ENOENT`. This is recorded residue, not an R3a gate: the exact brief assigns R3b the
full active-port coverage gate.

## Final gates

| Gate | Result |
| --- | --- |
| controlled red | FAIL as intended — real client test refused occupied 3938/5174 at `compose.ts:1272` |
| focused green | PASS — 1 file; 1 passed / 63 skipped; 2.71s |
| u13 final family | PASS — 38 files / 717 cases; 8.55s |
| u14 final family | PASS — 11 files / 151 cases; 13.17s |
| exact owned union | PASS — 49 distinct files / 868 cases across the two final commands |
| `npm run typecheck` | PASS — 16.13s |
| `npm run lint` | PASS — zero warnings; 30.53s |
| `npm run test:architecture` | PASS — 70 files / 703 cases; 37.31s |
| `npm run build:manifest:check` | PASS — generated manifest current |
| `npm run roadmap:check` | PASS — generated roadmap fresh |
| `git diff --check` | PASS |

`npm run test:coverage` is not an R3a exit gate: the exact R3a brief assigns the full active-port
coverage gate to R3b, whose reserved files still contain the known failures above. Treating that
expected foreign red as an R3a gate would cross the explicit ownership boundary.

## Teardown and residue proof

After final owned-family verification:

- no process command referenced this worktree;
- no `/tmp/hrauto-compose-*`, `/tmp/hrauto-dashboard-*`, or `/tmp/hrauto-perf-*` directory remained;
- `.tracker-rebuild/locks` contained no entry;
- the same legitimate dashboard PIDs still owned 3938/5174; and
- the focused test rebound its exact ephemeral backend port after `runtime.stop()`.

The temporary ignored `node_modules` symlink used to access the already-installed workspace
dependencies is removed before the final clean-tree proof. No unrelated process is killed.

## Review

The implementation target was `39598d2f...322ac84e`. Independent preliminary Performance and Tests
reviews found the same medium resource-lifetime defect: the first two post-compose assertions were
outside the teardown `finally`. Commit `322ac84e` moved them inside the cleanup boundary. Focused
Vitest and ESLint passed afterward, and the required post-fix reviews found no remaining issue.

| Axis | Result |
| --- | --- |
| Standards | Count 0 · Worst none |
| Spec | Three medium evidence-completion findings resolved in the final ledgers/report; no implementation-shape or scope finding |
| Correctness | Post-fix Count 0 · Worst none |
| Silent failures | Post-fix Count 0 · Worst none |
| Performance | One medium cleanup-boundary finding fixed; post-fix Count 0 · Worst none |
| Tests | Same medium cleanup-boundary finding fixed; post-fix Count 0 · Worst none |
| Docs | Count 0 · Worst none; final evidence re-review follows this report commit |
| Security | Count 0 · Worst none — supervisor review found no auth, credential, permission, untrusted-input, dependency, command-execution, or production trust-boundary change |
| Simplify | Skipped — no user request; the one-file test delta uses the existing two-override seam and is already minimal |

Security stayed supervisor-owned. The wrapper accepts no caller input, exposes no non-loopback
listener, and reaches only the existing test-only literal-zero overrides. Test fixtures contain no
live identifier or secret, and production port/config/auth behavior is byte-unchanged.

Reviewers used native high-reasoning roles: Luna for Standards, Tests, and Docs; Terra for Spec,
Correctness, Silent failures, and Performance. The initial read-only inventory used two Luna Scouts
(u13 and u14) and one Terra Analyst (u16). No reviewer or inventory agent committed a change.

## Change provenance

Implementation commits:

- `37b01aaf` — `test(server): isolate composed runtime ports`
- `322ac84e` — `test(server): guarantee teardown after startup assertions`

Evidence commit before implementation:

- `75d16dd2` — `docs(test): record R3a pre-edit ownership ledger`

The subsequent report-closing commit contains the completed evidence ledgers and this report. The
final response supplies its exact hash.

## Coordinator action

No product-truth or guarantee tradeoff requires coordinator judgment. Integrate the branch only
after independently verifying the commits and gates above. R3b should consume the exact reserved-
worker active-port residue; R3a does not prescribe its implementation.

## Coordinator-board observation

The read-only board blob was `066e588b1397a57cb53d41af91514789e7ceedda` at intake and at the
close read. This branch does not edit, stage, or commit the board.
