# R6 report — Playwright parity, performance, smoke, Duo, and generated checks

**Status:** `NEEDS COORDINATOR` for the performance baseline/gate decision and the full-coverage runtime target. The R6 implementation itself is complete, committed, reviewed, and green.

**Branch:** `feature/test-r6-parity-checks`

**Base:** `7982650c`

**Implementation head before this report:** `c320f8cb`

**Policy provenance:** during this run, the coordinator relayed the operator's 2026-09-02 answers to the test-rationalization decision sheet. Those answers set affected parity at ≤30s, the complete parity lane at ≤75s, and full coverage at ≤90s; they also required unique protection to survive every deletion. R7 owns ratification in the canonical authorities, so this report records the relayed policy without editing those authorities.

## Outcome

| Surface | Before | After | Proof |
| --- | ---: | ---: | --- |
| Parity specs | 17 | 17 | Playwright list + full lane |
| Parity cases | 287 | 281 | 281/281 final pass |
| Reference triples | 228 | 222 | 222 PNG + 222 accessibility YAML + 222 metadata JSON |
| Ordinary parity runtime | 83.58s | 68.20s | Same host, 5 workers; 18.4% faster and within the ≤75s target |

The six removed cases were the explicit `run-receipt` theme/viewport family. `run-done` already rendered the same completed run's same default Receipt section with the same two oracles. A temporary product-label mutation made the survivor fail on exact accessibility drift before the deletion was accepted.

The similarly identical-looking `intake-rerun` family was not removed. It had been photographing the default Review tab under the wrong name. Its test now selects and asserts the real Rerun Diff; all six old references failed before a deliberate refresh, and all six replacements were visually inspected. Reduced-motion coverage now directly asserts the media query and ten computed motion tokens; a temporary `1ms` mutation proved it red-capable.

Strict `maxDiffPixels: 0`, the 0.2 per-pixel threshold, paired PNG/accessibility evidence, seeded-versus-fixture independence, five fully parallel workers, and ephemeral servers are unchanged. `package.json`, the coordinator board, product code, canonical specs, and allowance/threshold policy were not changed.

## Check truth and performance

- Parity is an offline browser-integration gate.
- Duo crypto is a 43-case offline self-test: `npm --prefix duo-autopilot test` from the repository root, or `npm test` inside `duo-autopilot/`. Root `npm test` is the rebuild's Vitest suite, not the Duo self-test.
- The selector launcher is `node duo-autopilot/launch-selector-browser.mjs <login-url>`. It is live read-only HR/Duo verification and writes gitignored local profile/config artifacts; the nonexistent root `sel:browser` alias was removed from documentation.
- Document-number smoke is local integration through secure environment admission; live browser login smoke is live read-only. Neither was run in R6.
- UI catalog, build manifest, and roadmap checks are offline generated-freshness checks.
- `perf:dashboard` uses a realistic deterministic fixture and stable counters, but it only reports them; product regressions in those counters do not fail the command.

The final benchmark measured 5,569 day-wire SQL statements, zero day-wire schema parses in a row patch, zero span-event parses in logs, 13 freeze statements, and a preview delta of six. The same structural values appeared across all audit runs; elapsed timings varied materially with host load.

## Final gate table

| Gate | Result |
| --- | --- |
| focused parity repair/survivor set | PASS — 8/8 in 22.3s |
| full `npm run test:parity` | PASS — 281/281 in 68.20s; JSON report mode 0600 |
| full coverage with documented legacy override | PASS — 390 files / 4,838 tests; 85.34% statements, 76.40% branches, 89.32% functions, 87.28% lines; 152.53s |
| typecheck / lint | PASS / PASS |
| focused unit smoke/runner/generated seams | PASS — 5 files / 83 tests in 15.36s |
| focused parity/UI architecture seams | PASS — 2 files / 24 tests in 10.84s |
| Duo crypto | PASS — 43/43 in 0.99s |
| build manifest / roadmap | current / fresh in 6.41s |
| dashboard performance measurement | PASS — stable counters, 23.75s, no comparator |
| independent review | 0 open findings; one medium Docs finding fixed and re-reviewed |
| cleanup | no browser session, owned process, isolation-port listener, or debug probe left |

The first coverage attempt deliberately failed loud because this isolated branch's default relative legacy path was absent. The passing rerun used `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`, as permitted for R6 delta isolation. Because R1 supplies the later self-contained provenance conversion, the coordinator must integrate R1 before R6 and rerun coverage/architecture without this override.

## Coordinator decisions

_Answer positionally: `1 A, 2 A + "note"`, or `all recommended`. Unanswered items remain open._

### 1 · Performance authority baseline

**Situation.** `frontend-backend-integration` §7.4 says the measured counters become gates and records 5,568 day-wire statements. Current code reproducibly measures 5,569 because D269 added `listWorkerPools()` in commit `24b04dfa`. R6 cannot truthfully assert both values.

**Options.**

- **A. Ratify 5,569.** R7 updates §7.4, adds an asserted non-duration check with day-wire ≤5,569 plus the undisputed bounds, and keeps `perf:dashboard` as the detailed report. Cost: one documented baseline increase tied to intentional worker-pool behavior.
- **B. Restore 5,568 in product code.** Require a query removal/combination before asserting the existing number. Cost: product optimization outside R6 and evidence that worker-pool truth remains complete.
- **C. Partially gate.** Assert patch parses = 0, log span parses = 0, log scope ≤2 files, preview delta ≤6, and freeze ≤13, while leaving day-wire report-only. Cost: §7.4 remains only partly enforced.

**Recommendation.** **A** — it reconciles the one-statement increase to its intentional source while converting every agreed structural bound into executable authority.

**Notes.** _(Coordinator notes here.)_

### 2 · Full-coverage runtime target

**Situation.** The uncontended passing coverage run took 152.53s against the operator's ≤90s target. R6 changed no Vitest production path or coverage configuration; removing unique checks merely to meet the number is forbidden.

**Options.**

- **A. Preserve and profile after integration.** Merge R1 before R6, run the self-contained integrated gate, and give R7 ownership of measured scheduling/fixture optimization if it still exceeds 90s. Cost: the current wave remains above target until that work lands.
- **B. Add a dedicated optimization unit now.** Profile and restructure the slowest families without weakening assertions. Cost: expands this coordinated effort and requires new red-capable equivalence proof.
- **C. Revise the 90s target.** Treat 152.53s as acceptable. Cost: weakens an operator-ratified feedback budget and needs explicit authority.

**Recommendation.** **A** — it preserves the suite's unique protection, keeps the 90-second target intact, and measures the self-contained post-R1 composition before assigning optimization work.

**Notes.** _(Coordinator notes here.)_

## R7 authority and wiring work

1. Ratify the coordinator's eight test-rationalization policies in `guards-and-tests`, D191, the paired rule, the decision index, and any required AGENTS/CLAUDE twins.
2. Reconcile stale parity counts/examples in the owning references; R6 found obsolete 139-triple and 289-case-era claims.
3. Apply decision 1 to an asserted performance check and package wiring. Keep elapsed duration observational.
4. Add a root selector-launch alias only if deliberately desired; classify it as live read-only with local artifacts.
5. Integrate R1 before R6 and prove coverage/architecture without `HRAUTO_LEGACY_REPO`; then address the measured 90-second budget under decision 2.

## Commits

- `da4d51ff` — `test(parity): preserve distinct rendered states`
- `28eb0d35` — `docs(test): record R6 audit evidence`
- `afa4e608` — `docs(test): correct parity and Duo runner commands`
- `c320f8cb` — `docs(test): correct Duo audit premise`

## Coordinator-board observation

The read-only board changed externally during this parallel run: intake blob `4b370551223c4cb76091058c8c53056a26671e43`, close-read blob `bc95da170b7888e1fc07872744113641fcafd6f5`, coordinator checkout head `9944a2e6`. Its R6 row still says `running, policy cleared`; this branch did not edit or stage the board.
