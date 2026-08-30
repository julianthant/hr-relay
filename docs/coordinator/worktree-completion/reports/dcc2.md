# DCC2 — preflight worktree reconciliation

Status: **bounded backend reconciliation complete, committed and fully gated; independent final evidence receive passed; open pre-existing UI follow-up explicitly retained**.
This report is authoritative for this bounded supervisor only. Coordinator owns final shared
integration and source-worktree removal. No board updates were authored: incoming historical-board
blobs are exactly the frozen baseline, and the shared coordinator board was untouched.

## Identity and scope

| Fact | Verified value |
|---|---|
| Worktree | `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2` |
| Branch | `feature/r-dcc-dcc2-exclusive` |
| Initial HEAD | `ac40292b8e3e8ff9b66242bbf8f8288554335f40` |
| Frozen incoming baseline | `13175b13340fec7b5326207fe54f98078d481d7d` |
| Merge base | `80da38158dea35f781eb69d5e682a779935f9c96` |
| Reviewed product tree | `56ba105f1841097927a444d6454686c954b4e9db` |
| Product merge commit | `0b9a4de73504aeb1dc354e82927e0423960b0a37` |
| Product merge tree | `56ba105f1841097927a444d6454686c954b4e9db`, exactly the tested candidate |
| Product merge parents | Initial ac40292b and frozen 13175b13, in that order |
| Original dirty/untracked state | None; ignored coverage and node_modules retained |
| Functional delta to frozen baseline | 48 paths; 6,170 insertions / 1,330 deletions |

The initial branch had 70 unique commits versus 181 baseline-only commits. It was real divergent
work, not a stale worktree. All original history is retained through the verified two-parent merge.
[History inventory](dcc2-history.md), [intake](dcc2-intake.md), [merge preview](dcc2-merge-preview.md).

## Unit results

| Unit | Native high role | Outcome / proof |
|---|---|---|
| M1 | sup_scout, 120k/105k | Complete history and seam map; [M1](dcc2-m1.md) |
| M2 | sup_analyst, 200k/180k | Owner-backed equivalence/supersession dispositions; [M2](dcc2-m2.md) |
| M3 | sup_sol, 240k/220k | Reconciliation and red-capable corrections; 28 conflict paths / 70 hunk dispositions; [M3](dcc2-m3.md) |
| M3F | same sup_sol unit | Approved synthetic Duo fixture forwarding, seven exact code/test additions; [M3F](dcc2-m3f.md) |
| Review | independent sup_luna / sup_terra / sup_sol, high | Eight axes, reviewed correction chain; [findings ledger](dcc2-findings-ledger.md) |
| M4 | sup_terra, 240k/220k | Full gates and loaded-detail `/ui` inspection complete; owned browser/server closed; [M4](dcc2-m4.md) |
| Final receive | same sup_luna Docs unit, high | Independent evidence/ancestry/retraction/whitespace audit Count 0; [receive review](dcc2-final-receive-review.md) |

No generic agent, model override, new user task or new worktree was used. Native tool adapter lacks
a task-name argument, so exact role-prefixed names were supplied and applied through thread titles.
Only M3 wrote product files; reviewers were read-only. Each artifact writer owns its exact path.

## Reconciled invariants

- One baseline `src/domain/preflight.ts` authority/executor; timeout and caller cancellation wait
  for actual detector settlement. Exact successful, active and failed command replay; surplus-runner
  refusal; serialized refresh; non-evicting bounded identity retention. No alternate executor left.
- Loopback Host/Origin validation, streamed JSON cap, rate limit and rerun single-flight admission
  remain enforced through actual settlement. Owned Vite proof binds the launch nonce, not markers alone.
- Descriptor-relative no-follow bounded corpus traversal and immutable complete queued-root tuples
  retained. Forward/archive checks and reverse current non-archived missing-root checks share one
  transaction. Malformed authority withholds absence classification, as the baseline requires.
- Exact task-parent validation, field-only span contradictions, safe unknown-error summaries,
  hashed untrusted filenames and ordinal intermediate path labels. Configured-root basename policy
  and existing authority identity-mismatch diagnostics are unchanged, not overclaimed as new privacy guarantees.
- Malformed-resolution deduplication is linear via exact-key Set. Orphan inspection streams strict
  records without a history-sized array/sort, still validates released records and remains O(history) I/O.
- Newer Settings, Explorer, reporting and all dashboard product source equal frozen baseline.
  Parity source changes only doctor trust-root options; no reference corpus regeneration.

Superseded duplicate modules are removed from the candidate but recoverable from Git parents:
core/preflight-executor; server/dashboard/preflight-authority and preflight-runners;
domain/preflight-wire, preflight-check and runtime-capability; baseline marker-only
infra/providers/dashboard-frontend-http-probe. Their selected contracts are preserved in the single
authority and nonce-backed provider. No HR workflow or live authority was executed or changed.

## Independent review close

All eight axes finish with zero open findings across their pinned code scopes. This is not a
zero-open-product-gap claim: the named pre-existing UI follow-up below remains OPEN. Explicit retractions matter:
the claimed archived-task correctness defect and requested malformed/absence union were disproved
against baseline owners and withdrawn by their reviewers. The nested-schema-key formatter mutation
passes because Zod's union path is root: it is a negative control, never claimed as a red regression.
Every raw finding, correction and final independent delta remains in the linked ledger.

The last M3 production delta was diagnostic-only; Standards/Security reviewed it, Tests reviewed its
test changes and exact-message followup, and Spec reviewed owner wording. A subsequent test-only
typing correction removed one custom nested-root CLI fixture that its fixed runtime contract cannot
represent; Tests/Security independently verified that all 18 applicable CLI cases and their assertions
remain. Doctor/browser retain the two nested-root cases. Previously cleared authority, concurrency
and performance code was unchanged. No broader repeat audit was implied.

The subsequent M3F fixture-forwarding delta received four fresh independent axes: Tests, Security,
Correctness and Silent failures. All returned zero and traced the preserved production default.

## Acceptance gates

Current full coverage on `56ba105f` exited 0: **339 files / 3,831 tests passed**, 320.74s.
Statements 84.61%, branches 74.97%, functions 88.25%, lines 86.54%; all enforced floors passed.
Raw log: `../evidence/dcc2-m4/coverage.log`. Separately locked parity exited 0: **239 tests passed**
in 3.4 minutes (205,150ms process duration), with all references unchanged. Raw log:
`../evidence/dcc2-m4/parity.log`. The supervisor verified actual completed-process exit 0 and released
the logical heavy slot before the optional Storage health detail browser check.

Historically, supervisor proactive preflight on e4ab found the same credential-free fixture defect
reported by DCR: `dry-run-scenario-composition.test.ts` exited 1 with 2 failures / 6 passes because
its synthetic sessions did not inject the Duo gate and the runtime did not forward that option.
No live workflow ran and no credentials were provisioned. Log:
`../evidence/dcc2-m3/supervisor-dry-run-composition-preflight.log` (07:57:27 PDT, 3.07s).
That readiness was explicitly withdrawn. Coordinator approved only the four runtime / three test line
port from 845ca5a1/964c9636 plus nearest AGENTS note; the existing native worker completed that correction.
The resulting candidate is `56ba105f`; the same focused command passes 8/8 and fresh individually
locked typecheck/lint both exit 0. Tests, Security, Correctness and Silent failures independent
delta reviews all return zero. Both runtime and test files match the approved source blobs exactly;
the CLI still omits the optional fixture factory and retains fail-loud credential-backed behavior.
The supervisor independently reran the same focused acceptance (8/8, 2.56s) and locked lint;
both passed, combined command session 53572 exited 0. New heavy readiness was submitted for 56ba105f.

Loaded UI detail was inspected; its exact limitation is recorded below. The product merge is committed.
Initial HEAD checks do not substitute for the final
candidate gates above. Earlier focused scope passed 417/418 before the one stale expected
message was corrected; the affected 92-test storage suite then passed. Current diagnostic boundary
suite: 56 passed (19 doctor, 19 browser wire, 18 CLI). The composed applicable focused proof is 417
tests across 25 files; the final full coverage now supersedes that composed proof. Historical nested-component
mutation had 3 failures, including the later-retired unsupported CLI fixture; it must not imply that
such CLI configuration is supported. Vite wrong-reason mutation: 2 failures. Current full typecheck
and lint both passed exit 0 under the shared light lock. Detailed historical red/green and logs are in M3.

Old full checks canceled by coordinator SIGTERM are **CANCELED (143)**, not passed. A light-lock
timeout is **QUEUED (75)**. Coverage/parity may start only after explicit coordinator allocation and
OS-lock acquisition. No test, assertion, timeout or coverage floor was weakened.

## Receive and resources

No shared integration or source-worktree removal has happened in this supervisor. There are no
new subunit worktrees to remove. Existing ignored outputs are retained for coordinator disposition.
All native units are closed. M4's owned browser/server PIDs 59590/60215/60026 and listener 60189
were independently checked absent. No foreign process or browser session was touched.
The product merge preserves exact tested tree 56ba105f and both original/frozen parents. A separate
documentation-category commit records this report and raw evidence without changing product/test/
reference closure. [Closure ledger](dcc2-closure.md) records exact ancestry and source equality;
the containing evidence commit's final clean HEAD is sent to the coordinator after commit.
Never force-delete this divergent source branch or merge it into master from this assignment.

Retained ignored paths: original `coverage/`, `node_modules/`; generated `dist/`,
`tests/parity/.output/`, `.playwright-cli/`. Captured acceptance evidence is durably included in the
documentation commit. No ignored path was deleted or assumed safe for deletion. Coordinator must
inspect/preserve any remaining useful outputs before removing this source worktree after integration.

Exact next receive: coordinator verifies the returned final branch HEAD, merge parents and product
tree, then serially merges `feature/r-dcc-dcc2-exclusive` with `--no-ff` into `integration/03b`
under the shared program's dependency order and integration gates. Only after successful durable
integration and ignored-artifact disposition may the coordinator remove this worktree/merged branch.
No master merge, push, migration rewrite, live execution or shared-board mutation is authorized here.

The product whitespace gate passed. The evidence-only diff check exits **2**, with **667 diagnostics
in 74 original artifacts**, not a passing whole-diff check. [Exact whitespace ledger](dcc2-evidence-whitespace.md)
names every path/line; raw output and independent review formatting remain unchanged under explicit
coordinator instruction. No gate configuration or Git whitespace override was applied.

## Loaded UI evidence and scope caveat

`/ui` required separate loaded-detail inspection because the frozen General/hazard screenshot and
heading-only parity assertion do not prove diagnostic detail. The supervisor viewed the actual
[1440x900 Paper Ink screenshot](../evidence/dcc2-m4/storage-detail-loaded-paper-ink-1440x900.png)
and inspected its [snapshot](../evidence/dcc2-m4/storage-detail-loaded-paper-ink-1440x900.yml) and
[HTTP 200 doctor response](../evidence/dcc2-m4/doctor-response-verified.log). Authority schema v18,
generation 37/176 pages, durable counts, missing backup, no service run, zero restore candidates,
and six retained preflight checks are legible. No live HR runtime or preflight rerun was exercised.

The same payload reports degraded `spanAuthority` and four malformed span-stream diagnoses;
`DoctorReport` does not display them. Both original ac40292 and frozen baseline 13175 omit that
field, and the final dashboard tree equals baseline. This is an observed pre-existing display gap,
not a DCC2 regression or proof that those diagnoses are visible. Owner §2.5 specifies exact wire
diagnoses; §9.8's explicit rendered inventory lists authority, counts, backup, service and restore
candidates, not span authority. M2 directed preservation of newer baseline UI. Coordinator independently
verified the sources and evidence and explicitly classified this as non-blocking for this exact
backend reconciliation, without accepting/fixing the presentation gap globally. No new frontend
implementation was inferred.

**OPEN follow-up: `dcc-storage-span-visibility`**, coordinator-owned under
`docs/rebuild/reference/dashboard-surfaces.md` §9.8. Served degraded span authority has 11 stream
runs / 7 live runs and four malformed `span_stream` problems that are not rendered. Loaded-detail
proof covers authority/counts/backup/service/restore only; retained preflight controls were observed,
not executed. Do not downgrade the degraded wire or claim unconditional UI completeness.

The first response helper failed with an unsupported `URL` global; its raw attempt remains beside
the successful new capture. The console contains one synthetic-server favicon 404, not a clean
console claim. The initial long session name failed socket admission; the shorter owned session
completed and was closed. Raw logs retain original whitespace and failures; no evidence was normalized.
