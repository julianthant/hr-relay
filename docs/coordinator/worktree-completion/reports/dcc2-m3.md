# DCC2-m3 — historical reconciled pending-merge candidate

> Historical checkpoint: coordinator withdrew `e4ab3837` readiness after the synthetic Duo
> composition failure. M4 is paused. The approved bounded repair and replacement candidate are
> tracked in [dcc2-m3f.md](dcc2-m3f.md); all M3 gate/pin/lane claims below describe the prior checkpoint.

## Current state — supersedes earlier pin/gate claims

**Reconciled candidate implemented, staged, light-gated and frozen. Light-gate lane returned.**
Heavy coverage/parity and the merge commit remain coordinator-owned and unallocated here. The current tree is
`e4ab3837feef579e8462b59e27eb9eb3015d0f65`. Earlier pins and successful checks below are historical
unless explicitly attributed to the current source. No canceled, queued or failed command counts as passed.

| Fact | Exact value |
|---|---|
| Role / model / reasoning | sup_sol / native Sol / high |
| Workspace | /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2 |
| Branch | feature/r-dcc-dcc2-exclusive |
| HEAD | ac40292b8e3e8ff9b66242bbf8f8288554335f40 |
| MERGE_HEAD | 13175b13340fec7b5326207fe54f98078d481d7d |
| Current git write-tree | e4ab3837feef579e8462b59e27eb9eb3015d0f65 |
| Initial review pin | d8bf813e71925756f1f238dd142886410ba3e5ff |
| Merge base | 80da38158dea35f781eb69d5e682a779935f9c96 |
| Unmerged paths / unstaged tracked changes | 0 / 0 |
| Original conflicts | 28 paths / 70 hunks |
| Commits / pushes / child agents | None / none / none |

The authorized `git merge --no-ff --no-commit 13175b13340fec7b5326207fe54f98078d481d7d` was run
after branch/HEAD verification and complete assigned-input/skill reading. No abort, ours/theirs,
whole-side checkout, reset, clean, stash or broad staging. Only explicit paths were staged.
Supervisor-owned untracked artifacts, including M2 and all review reports, remain untouched.
This owned report/evidence stay untracked so recording the tree does not change it.

## Exact post-pin correction history

The complete 13-path delta from `d8bf813e` is in
[post-pin-delta.patch](../evidence/dcc2-m3/post-pin-delta.patch), with
[post-pin-inventory.txt](../evidence/dcc2-m3/post-pin-inventory.txt).
These are corrections to selected contracts, not new authority/policy.

| Pin | Exact change after predecessor |
|---|---|
| c9a2041227d6b415b4226db68ff20a1e4b2b7d28 | Initial bounded correction set after d8bf813e; 13 paths |
| 55bdd6ab9b52c941bc9b0a5594d6e24f543cb1a8 | One storage-recovery assertion: exact safe parentSpanPath message |
| 877254acdce78a4425b6561dc2140a27d4861adc | One BFF test line normalizes request("40") with Promise.resolve; TS2339 correction |
| a85b83f8022b72cdb10d48210bdb6b239411ced7 | Remove unused canonicalJsonStringify/message helper and test HASH_A/HASH_B imports; no behavior change |
| ebbb5f3fddc323c603f59be44df65d6c4eb34485 | Intermediate directories use ordinal labels; real nested-path regressions; otherwise-valid schema-key fixture plus nested issue-path precondition; corresponding docs |
| 45a935d7f59d6d649a8db4bb5ab4e44a20e1c17b | Docs-only qualification: corpus/stream diagnostics do not echo workflows; existing authority identity-mismatch diagnostics unchanged |
| a296aa29b7308d318c6fc4a8a9ba9642acbe9082 | One existing symlink-race test expectation: intermediate name → ordinal 1; no production change |
| e4ab3837feef579e8462b59e27eb9eb3015d0f65 | Test-only TS2345 repair: real literal rebuildRuntimeIsolation for CLI; nested-root case only at doctor/browser, whose options can represent it. All 18 valid CLI cases retained; no cast/contract broadening. |

The transient, unpublished `59e6597b` tree was the same docs clarification before capitalizing
“Unrecognized”; `45a935d7` supersedes it. No behavior source changed after `ebbb5f3f`.

## Bounded correction dispositions

| Finding / paths | Kept / changed / why and proof |
|---|---|
| Exact task-parent / doctor + storage reconciliation tests | Restore baseline taskScoped parentSpanPath === root.queued.traceId for task start/end, transaction.fenced and data.observed. Absent/nested parents ran red then green. |
| Abort timer / preflight-runtime-dependencies test | Timer remains armed before actual settlement and disarms afterward. Removing deadline.cancel fails the test; early admission release fails independent sibling-settlement proof. |
| Malformed dedupe / doctor + storage reconciliation test | Exact table + NUL + run-id Set replaces per-row roots scan. Mixed rooted/rootless malformed records emitted once; no invented absences. |
| Orphan inspection / process locks + new test | Optional inspector streams every record with one-record memory, validates released records, observes every unreleased owner, and closes on failure. O(history) time; no history-sized array/sort. Existing record parser/byte policy and acquisition/recovery authority unchanged. Two tests red on old implementation, green after fix. |
| Path diagnostics / doctor + authority database + boundary tests | Remove all observed/expected spanPath and parentSpanPath values from contradiction messages. Keep precise field names. No supplied workflow value in corpus/stream-structure diagnostics; existing authority identity-mismatch formatter unchanged. |
| Raw errors / doctor + boundary tests | Injected readSync errors reproduced raw Error-message escape through the bounded-read catch and outer corpus catch. Only private internally authored safe messages cross verbatim; unknown errors use closed OS errno vocabulary. |
| Typed components / doctor + boundary tests | Untrusted filenames receive grouped SHA-256 IDs; groups cannot accidentally form an eight-digit person marker. Schema-owned top-level fields only, not dynamic keys/messages. Configured trust-anchor/final state-root basenames remain permitted; intermediate components use ordinals. The real symlinked intermediate fixture ran red before ordinal fix. Its doctor/browser cases are valid; the fabricated nested CLI configuration was later retired because RuntimeIsolation permits only the direct .tracker-rebuild child. |
| Schema-key test correction | The control queued event now passes the whole schema. Its sole queued-arm defect is invalid_key at [resolvedInstance, synthetic marker] inside invalid_union.errors. The test asserts that precondition and top-level empty path. Restoring the OLD nonrecursive full-path formatter still passes all 3 boundary cases, because it sees only the union root. No red mutation result or current nested-key leak is claimed. The safe formatter is restored. Changing schema/error traversal solely to force red was not authorized. |
| Concrete Vite transport / two runner suites | Closed allocated loopback port gives probe-request-failed; real occupied socket that refuses transport maps through default concrete probe to unhealthy ownership. Both tests fail under wrong-reason mutation; provider restored unchanged. Existing nonce/deadline/byte bounds retained. |
| Malformed absence docs / dashboard-surfaces + AGENTS | Any malformed current/archive record withholds missing and missing-span for that inspection; “names every problem” qualified to established diagnoses. Implementation unchanged. |
| Retracted archive finding | Current non-archived-only reverse scope retained, matching baseline and normative current-authority-run wording; no implementation change. |

All markers are synthetic. No live HR workflow, credentials, subjects, production authority or external
network was used. No timeout/assertion was relaxed for resource contention. Existing unsafe-value
diagnostic expectations were replaced by exact safe identities/field/ordinal messages, not dropped.

## Reconciled implementation

- **One authority:** `src/domain/preflight.ts` owns executor, strict shared report semantics,
  registry selection, actual detector settlement, late-health rejection, ordered primary-first
  aggregation, config+descriptor CAS and exact successful/in-flight/failed command replay.
  Ported surplus runner refusal, serialized refresh and the non-evicting 256-identity capacity
  (successes, failures and active identities). Baseline duplicate/missing checks retained.
- **One runner composition:** `src/server/preflight/dashboard-runners.ts` combines baseline
  retained config/lease checks with alternate package-lock root identity, filesystem-safe errors,
  process-record inspection and nonce-backed Vite proof. Startup uses one authority and waits for
  backup health publication; bound backend ownership is registered on the same runner set.
- **Ingress:** baseline route now preserves alternate loopback Host/parsed Origin checks,
  4-KiB streamed UTF-8 JSON limit, distinct body refusals, six starts/minute and one active rerun.
  Route active admission spans actual settlement, including after deadlines.
- **Ownership:** alternate launch nonce provider, dev launcher, Vite ownership endpoint and
  runtime-environment registration retained. Public Vite markers alone cannot prove ownership.
  Preflight runtime/filesystem/process errors use closed safe summaries, not caught raw messages.
- **Storage:** alternate descriptor-relative no-follow bounded corpus traversal, immutable complete
  root tuple, exact live/archive tuple and terminal/failure validation, one prepared lookup pair
  and transaction identity checks retained. Baseline reverse current-run missing-span and malformed
  row diagnosis moved into the same read transaction as forward resolution. Malformed rows do not
  turn into absence; a record diagnosed both directions is emitted once. Queue refusal unchanged.
- **Wire/redaction:** baseline `StorageDiagnosticMessageSchema` and redaction-audit coverage retained
  on the richer reconciliation wire with explicit `span_stream`, `missing-span` and
  `malformed-authority` arms. Parser messages at exact authority-read boundaries replaced with
  closed record/identity-validation summaries. Missing, archived and malformed remain distinct.
- **Baseline preservation:** no Settings/Explorer/reporting/client/UI implementation changes relative
  to frozen integrated baseline. `src/dashboard/client/commands.ts` was deduplicated back to baseline.
  The parity helper only changes doctor trust-root options; no reference corpus edited/generated.
  Worker-pool/capture fixture adaptations are direct startup/doctor dependents, not new features.
  Normative docs/nearest root AGENTS identify the actual authority and remove stale UI-open claims.

Removed superseded modules: `src/core/preflight-executor.ts`,
`src/server/dashboard/preflight-authority.ts`, `src/server/dashboard/preflight-runners.ts`,
`src/domain/preflight-wire.ts`, `src/domain/preflight-check.ts`,
`src/domain/runtime-capability.ts`, and the baseline marker-only
`src/infra/providers/dashboard-frontend-http-probe.ts`. Their selected functionality is in the
single domain authority, baseline runner location, shared baseline preflight-contract/semantics
and nonce-backed local-vite-probe. All are recoverable from the two git parents.

Skills: mandatory worktree-sweep conflict procedure used; tdd tests mode used at the authorized seams
with preserved/red-capable regression tests; ui route used to inspect and preserve current surface
structure, not redesign. Browser/parity execution is deferred by the explicit gate restriction.
The debug loop reproduced raw span-path egress and injected raw filesystem error egress before the
closed-boundary fixes. No debugging workaround, instrumentation residue or unrelated seam was introduced.

## Gate evidence — actual exits, not inferred from log contents

All invocations explicitly use the assigned workspace. Vitest always uses
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1`.
Full typecheck/lint use `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run <gate>`.
At most one owned light command at a time. Coverage/parity/browser: NOT RUN; no allocated heavy slot.

### Current-source verification

| Evidence / session | Tree / time | Actual outcome |
|---|---|---|
| diagnostic-final-green.log / 53117 | ebbb5f3f source; 2026-08-30 07:43:06 PDT | Historical exit 0; 57 cases, including 1 subsequently retired unsupported CLI configuration. Current proof is 56 below. |
| focused-final-candidate.log / 63254 | Same final production source; started 2026-08-30 07:43:29 PDT | Exit 1; 417 passed / 1 stale ordinal expectation failed, 418 total / 25 files |
| focused-final-followup.log / 78965 | a296aa29; started 2026-08-30 07:45:42 PDT, 9.64s | **Exit 0; 92/92 passed**, clearing the sole prior failure |
| Earlier combined focused proof | a296aa29 | 418 cases passed by full run plus 92-test follow-up; includes one later-retired invalid CLI configuration |
| diagnostic-cli-contract-final.log / 26888 | e4ab3837; 2026-08-30 07:49:13 PDT, 3.72s | **Exit 0; 56/56 passed**, including all 18 valid CLI cases and 2 applicable nested-root cases |
| Final applicable focused/dependent scope | e4ab3837 | **417 distinct tests / 25 files green**, composed from unchanged full-source tests, storage follow-up and final 56-case rerun; one impossible CLI fixture explicitly retired |
| lint-final-authorized-locked.log / 70994 | a296aa29; started about 14:46:57Z, exit collected 14:47:56Z | **Exit 0**, zero warnings/errors |
| typecheck-final-authorized-locked.log / 14850 | a296aa29; started about 14:47:57Z | **Exit 2**, TS2345: fabricated CLI stateRoot violates literal RuntimeIsolation; test-only repair above |
| typecheck-cli-contract-final-locked.log / 36455 | e4ab3837; completion collected 14:50:07Z | **Exit 0**, current-candidate full typecheck |
| lint-cli-contract-final-locked.log / 4581 | e4ab3837; started about 14:50:18Z, exit collected 14:50:57Z | **Exit 0**, current-candidate full lint; zero errors/warnings |
| final-manifest-generate.log / final-manifest-check.log | a296aa29; 14:46:09Z–14:46:13Z | **Exit 0 each**; no generated changes |
| final-roadmap-generate.log / final-roadmap-check.log | a296aa29; 14:46:09Z–14:46:13Z | **Exit 0 each**; no generated changes |
| manifest-current-candidate-check.log / roadmap-current-candidate-check.log | e4ab3837; 14:51:15Z–14:51:19Z | **Exit 0 each**, current tree remains fresh |
| git diff --check / git diff --cached --check | e4ab3837; 14:51:19Z | **Exit 0 each**; zero unstaged tracked edits |

### Historical checkpoints and red-capable proof

| Evidence | Exit / count / exact disposition |
|---|---|
| preflight-red.log → preflight-green.log | Exit 1 / 4 failures → exit 0 / 35 passed |
| storage-reconciliation-red.log → storage-reconciliation-green.log | Exit 1 / 4 failures → exit 0 / 18 passed |
| focused-1.log | Exit 1; 221 passed / 13 failed |
| focused-2.log | Exit 1; 235 passed / 2 failed; both later cleared |
| typecheck-2.log | Exit 2; 5 diagnostics, corrected |
| typecheck-3.log / session 75310 / PID 45909 | CANCELED by coordinator SIGTERM; collected exit 143; never passed |
| lint-initial.log | Exit 1; intermediate merge/import state, not final proof |
| lint-2.log / session 77333 / PID 42041 | CANCELED by coordinator SIGTERM; collected exit 143; never passed |
| preservation-green.log | Exit 0; 58 passed (38 preflight + 20 storage); parent regression first ran red (2 failures) |
| caller-disarm-mutation-red.log / independent-settlement-mutation-red.log | Exit 1 each, one corresponding failure; code restored |
| focused-final.log at 07:26 | Exit 0; 23 files / 356 passed; BEFORE post-correction edits, not final proof |
| performance-regression-red.log → performance-regression-green.log | Exit 1 / 2 failures + 21 passed → exit 0 / 23 passed |
| security-red.log | Exit 1; 36 real boundary failures |
| standards-read-red.log | Exit 1; 6 real injected-error failures |
| security-standards-green.log / 85359 | Exit 1; 89 passed BUT architecture import failed (missing legacy env); not a passed suite |
| diagnostic-components-red.log | Exit 1; 6 real filename leaks + 3 bad fixture outcome failures; fixture corrected to done; 3 incomplete dynamic-key controls passed |
| diagnostic-components-green.log | Exit 0; 54 passed, diagnostic-only proof, BEFORE nested-path correction |
| vite-transport-green.log → vite-transport-mutation-red.log | Exit 0 / 2 passed → exit 1 / same 2 failed with wrong reason; production restored |
| focused-corrected.log / 93929 | Exit 1; 24 files / 409 passed + 1 stale parent wording assertion; 410 total |
| focused-corrected-followup.log / 78470 | Exit 0; 97 passed (92 storage + 5 bootstrap); 07:37:54 PDT at 55bdd6ab |
| typecheck-corrected-locked.log / 81317 | Exit 2; TS2339 BFF Response-or-Promise test |
| typecheck-corrected-final-locked.log / 47589 | Exit 0 on 877254ac; started 14:39:23Z, completion collected 14:39:52Z |
| lint-corrected-final-locked.log / 92469 | Exit 1; 3 unused-symbol errors + 1 warning; exact cleanup staged in a85b83f |
| lint-corrected-clean-locked.log / 39534 | Exit 75, QUEUED; lock timed out, lint did not run; no spin retry |
| nested-component-red.log / 2905 | Exit 1; 2 supported doctor/browser nested-path failures + 1 later-retired unsupported CLI configuration failure; 3 schema-key controls passed |
| schema-key-old-formatter-mutation.log / 36254 | Exit 0; 3 passed under old nonrecursive formatter; requested red proof not established, production restored |
| Earlier manifest generation/check and roadmap generation/check | Exit 0 each before final corrections; current-candidate checks also passed above |
| Earlier diff checks | Exit 0; final staged/unstaged diff checks also passed above |

### Process accountability and remaining work

**Currently running owned sessions/commands: NONE. The light-gate lane is returned.**
Session 4581 completed **exit 0** (full locked lint) after session 36455 completed **exit 0**
(full locked typecheck), both on e4ab3837. The final 56-case focused rerun exited 0. Current-tree
manifest/roadmap checks and both diff checks exited 0. No light test/check remains pending.

The earlier lint lock timeout remains **QUEUED exit 75**, not passed or code-red. Old full checks
75310/77333 remain **CANCELED exits 143**, never passed. The old a296 typecheck remains **exit 2**,
repaired only in the test fixture. No checks overlapped within this executor's lane; no foreign
process was killed by this agent.

Coordinator confirms all eight initial axes and the bounded follow-up reviews are cleared, including
final independent Tests and Security **Count 0 / Worst none on e4ab3837**. Production behavior is
unchanged since ebbb5f3f; later source-tree deltas were docs, exact diagnostic expectations and valid
test setup. No open implementation blocker. **Heavy coverage/parity are genuinely pending and were
not run; merge commit/push were not performed.** Supervisor owns those gates and final integration.

The schema-key sample is an explicit negative control, **not a proven egress regression**:
otherwise-valid queued arm has exactly invalid_key at the nested marker path, but both old
nonrecursive and new safe formatters see only the top-level union path. Old formatter mutation:
3 PASS, never claimed RED. Safe formatter restored. Coordinator verified that limitation.
Independent review disposition and all heavy coverage/parity gates remain coordinator-owned.

Exact final gate commands and exit ledger:
[final-gate-commands.md](../evidence/dcc2-m3/final-gate-commands.md).

## Test-intent disposition (including retired assertions)

No duplicate/missing/surplus membership, failed replay or retained identity behavior was intentionally
discarded. Exact branch test titles below distinguish semantic retirement from relocated proof.

| Original intent / test | Candidate disposition |
|---|---|
| produces exact registered dashboard report | Retained in domain suite, exact six-result literals |
| refuses runner outside selected registry | Retained; reproduced RED before surplus check |
| refuses duplicate detector ownership | Retained against sole domain authority |
| missing selected runner | Baseline implementation retained; added explicit standalone constructor-refusal test, passed focused-2 |
| retains exact completed report for bootstrap readback | Retained |
| replays exact command; refuses divergent id reuse | Retained alongside baseline descriptor CAS and in-flight coalescing |
| replays failed command without re-execution | Retained; reproduced RED before failed-identity map |
| serializes refreshes one pass at a time | Retained; reproduced RED before serialization |
| bounds retained identities without evicting replay | Retained; reproduced RED before 256 cap |
| rejects schema-valid wrong-check observation | Retained |
| keeps single-flight after timeout until non-cooperative I/O settles | Prompt-return/hasSettlingDetectorIo interface retired; actual-settlement executor + new route admission test preserve exclusion; route test passed focused-2 |
| retains admission until every independently settling runner finishes | Prompt report/refuse-second-refresh expectation retired; replacement awaits both siblings, rejects ordered timeout aggregate and starts queued refresh only after both settle. Passed; premature admission-release mutation fails. |
| returns exact timeout observation despite late healthy detector | Observation-return semantics retired by M2; baseline test awaits actual settlement then rejects registered timeout, passed |
| aborts non-cooperative detector and returns without awaiting settlement | Intentionally retired: directly contradicts M2 actual-settlement authority. Baseline test proves promise stays pending until release. |
| propagates caller abort and disarms deadline | Prompt rejection of never-settling runner retired. Replacement proves forwarded abort, pending promise, late-health rejection; passed focused-2. Direct deadline-disarm assertion after actual settlement now passes and fails under deadline.cancel removal. |
| baseline all-pass bootstrap projection smoke | Replaced with branch exact six-row pass/warning/impact and blocking-failure projection; stronger explicit ordering/details, baseline rendering preserved |
| baseline marker-only frontend HTTP probe cases | Retired with superseded adapter; branch real HTTP nonce/markers, wrong nonce, failure, byte bounds and deadline cases retained in server/preflight-runners |
| baseline mixed current/archive/missing/unaccounted synthetic inventory test | Rehomed to real SQLite+doctor current/missing/unaccounted boundaries. Synthetic queued/nonterminal-as-archived acceptance retired because it contradicts required archive terminal validation. Valid archive cases retained in architecture/storage-recovery. |
| baseline malformed current-row inventory helper test | Rehomed through actual doctor malformed authority with no root; removed duplicate inventory API, not malformed-row behavior |
| baseline standalone exact archived synthetic inventory test | Superseded by real retained terminal task + frozen archive tuple tests in architecture/storage-recovery; no separate inventory authority retained |
| baseline canonical instance ordering, tuple mismatch, duplicate roots, three requeue cases, foreign workflow/trace/attempt/task root, task end-before-start, root ordering, queue refusal | Retained/re-expressed against real doctor boundary; storage-reconciliation-green 18/18 |
| branch malformed retained-task/parser detail assertions (envelope/expected object and Invalid input) | Invalid-row refusal retained; raw parser string assertions replaced by closed safe record/identity-validation summary. No malformed row accepted or silently omitted. |
| real Settings revision/restart and BFF editable Settings tests | Preserved; fixtures now contain actual package+lock and loopback Host/actual runtime CAS |
| Intermediate-pin nested-root CLI fixture | Retired only the fabricated nested RuntimeIsolation case after TS2345. Public CLI isolation permits exactly .tracker-rebuild directly beneath its trust anchor, so intermediate relative components are not a route input. Doctor/browser nested-root cases and all 18 valid CLI synthetic redaction cases retained; no production schema widened. |
| Raw span basename/path/ancestor diagnostic assertions | Replaced by exact safe grouped file identifiers, field-only mismatch messages and ordinal intermediate components; file/line, refusal, no-follow and offending-field assertions preserved. No unsafe-value echo contract retained. |
| exact snapshot equality in storage-recovery | Preserved with explicit empty missingSpanRunIds/malformedRecords fields, not loosened to partial matching |

## Full original per-hunk disposition

A is alternate branch `ac40292`; B is frozen integrated baseline `13175b1`.
Coordinates are **original conflict-start lines**, not final source line numbers. Complete original
A/B hunk text is preserved in [original-conflict-hunks.md](../evidence/dcc2-m3/original-conflict-hunks.md).
Selecting an import/shape in this table did not mean whole-side checkout; unmarked duplicate
implementations were separately reconciled by the family decisions above.

| File / original hunk | A intent | B intent | Kept / why |
|---|---|---|---|
| `AGENTS.md` H1 @389 | Preflight/nonce/storage hardening lessons | Settings/Explorer and baseline storage lessons | Both; replace detached-timeout wording; add sole-authority/reverse-accounting lesson. |
| `docs/rebuild/04-close-the-deferrals.md` H1 @287 | Settings executor/UI still deferred; branch backend landed | DCC1–DCC3 bounded Settings closure | B; preserve already integrated Settings delivery. |
| `docs/rebuild/04-close-the-deferrals.md` H2 @335 | Only backend landed; UI still open | Executor, service and UI units landed | B; remove stale branch status. |
| `docs/rebuild/04-close-the-deferrals.md` H3 @352 | Backend-only completion and absent TopBar wiring | Existing typed Settings/preflight UI | B; no new UI work or redesign. |
| `docs/rebuild/04-close-the-deferrals.md` H4 @536 | Editable settings still deferred | Bounded resolver-owned edit/preflight closure | B; preserve integrated status. |
| `docs/rebuild/reference/clock-config-secrets.md` H1 @1003 | Separate server authority and runner locations | Domain authority, baseline runner path and actual settlement | B + A safety details; document membership, replay cap, ingress and nonce without prompt timeout. |
| `docs/rebuild/reference/clock-config-secrets.md` H2 @1068 | Serialized branch server authority and bounded prompt execution | Exact CAS/replay and all-runner actual settlement | B; adapt A admission/retention protections onto this authority. |
| `docs/rebuild/reference/dashboard-surfaces.md` H1 @1349 | Rich reconciled arm determines healthy doctor exit | Semantic healthy reconciliation plus verified backup | Both equivalent judgment; rich arm remains only healthy state. |
| `docs/rebuild/reference/dashboard-surfaces.md` H2 @1431 | Same rich-state CLI exit condition | Same semantic CLI health condition | Both; shared helper and CLI consume rich reconciliation. |
| `docs/rebuild/reference/frontend-backend-integration.md` H1 @148 | Startup backend served, modal projection absent | Retained preflight served | B; preserve baseline producer/caller status. |
| `docs/rebuild/reference/frontend-backend-integration.md` H2 @328 | TopBar not connected | Baseline TopBar/Settings typed caller contract | B; retire stale unconsumed/UI-gap claims. |
| `docs/rebuild/reference/frontend-backend-integration.md` H3 @609 | apply-settings deferred | Resolver-owned apply-settings active | B; unrelated integrated Settings authority preserved. |
| `docs/rebuild/reference/frontend-backend-integration.md` H4 @682 | Read-only Settings plus backend preflight | Atomic Settings, UI and preflight delivered | B; preserve completion and explicit broader exclusions. |
| `docs/rebuild/reference/frontend-backend-integration.md` H5 @822 | Loopback/size/rate/replay protections; UI still absent | Bounded served Settings/preflight routes | B plus A ingress protections documented in clock-config-secrets; no UI regression. |
| `docs/rebuild/reference/frontend-backend-integration.md` H6 @943 | Shell lacks preflight callback | Shell typed caller consumes preflight | B; preserve baseline shell/reporting. |
| `docs/rebuild/reference/frontend-backend-integration.md` H7 @955 | Start modal preflight absent; other surface statuses | Integrated Start/Settings/capture surface statuses | B; no collateral surface-status rollback. |
| `docs/rebuild/reference/frontend-backend-integration.md` H8 @986 | Backend complete, Settings and TopBar open | Integrated Settings and preflight complete | B; retain narrow residual scope. |
| `docs/roadmap/roadmap.md` H1 @1648 | Backend-only preflight, Settings/UI open | Completed Settings/preflight tree | B; update log to name reconciled hardening without reversing completion. |
| `src/domain/dashboard/bootstrap.ts` H1 @226 | Branch producer supplies report | Optional only for read-forward compatibility | B; strict current producer always supplies retained report. |
| `src/domain/dashboard/storage.ts` H1 @92 | Rich reconciled/degraded/unavailable wire, span_stream | Reverse missing-span/unaccounted and safe diagnostic strings | A shape + B safe schema/name and reverse missing-span/malformed-record arms. |
| `src/domain/dashboard/storage.ts` H2 @173 | Doctor binds branch wire name | Doctor binds baseline wire name | Baseline public name bound to reconciled rich shape; one field only. |
| `src/domain/preflight.ts` H1 @4 | Separate command-id result declaration | Fingerprint-bound authority | B; remove duplicated alternate result schema. |
| `src/domain/preflight.ts` H2 @25 | Alternate preflight-wire leaves and runtime registry schemas | Browser-safe preflight-contract plus shared semantics | B; remove alternate wire/check/capability modules. |
| `src/domain/preflight.ts` H3 @79 | Projection only; core executor elsewhere | Actual-settlement executor in domain | B; sole executor retains cancellation, awaits completion, rejects late health. |
| `src/domain/preflight.ts` H4 @166 | Second report semantic refinement | One shared report semantic contract | B; preserve shared semantics; add valid branch admission/replay invariants to domain authority. |
| `src/domain/runtime-dependencies.ts` H1 @26 | Separate check/capability leaves | Shared preflight-contract exports | B; one schema authority; nonce registration retained in runtime-environment. |
| `src/infra/sqlite/authority-database.ts` H1 @237 | Full root/snapshot/resolution types | Independent current/archive identity inventory | A; add reverse scan into same transaction; no second inventory reader. |
| `src/infra/sqlite/authority-database.ts` H2 @2222 | Transaction-bound identity/root readers | Separate identity inventory static entry point | A; port B missing/malformed row accounting into exact snapshot. |
| `src/infra/sqlite/authority-health-runner.ts` H1 @27 | Rich reconciliation imports | Baseline health summarizer import | A rich-state vocabulary; shared helper adapted for other consumers. |
| `src/infra/sqlite/authority-health-runner.ts` H2 @55 | Rich span authority health and safe cause code | Baseline finding-count health summary | A; preserve failure severity and safe output; missing-span degrades. |
| `src/infra/sqlite/recovery-contracts.ts` H1 @130 | Immutable full queued-root schema | Common projected authority identity fields | A exact root schema; forward and reverse accounting share it. |
| `src/infra/sqlite/recovery-contracts.ts` H2 @140 | Root spanPath | Projected attempt | A path plus explicit initial/final attempt; not a reduced identity. |
| `src/infra/sqlite/recovery-contracts.ts` H3 @149 | Queued retryOf | No corresponding common-field entry | A; full immutable tuple retained. |
| `src/infra/sqlite/recovery-contracts.ts` H4 @157 | Snapshot identity/full attempts/resolution contracts | Separate current/archive identity inventory | A snapshot plus B reverse missing/malformed evidence; no duplicate authority. |
| `src/infra/sqlite/recovery-contracts.ts` H5 @258 | reconciled/degraded/unavailable rich union | complete/malformed/unavailable finding union | A rich vocabulary with B missing-span and malformed-authority semantics. |
| `src/infra/sqlite/storage-doctor.ts` H1 @1 | Descriptor-relative no-follow bounded filesystem primitives | Unbounded stream reader imports | A; preserve traversal and caps. |
| `src/infra/sqlite/storage-doctor.ts` H2 @29 | Exact transaction-bound adapter | Separate inventory/error reader and all-lines stream reader | A; retire second inventory route; reverse scan moved inside exact snapshot. |
| `src/infra/sqlite/storage-doctor.ts` H3 @45 | Full immutable root schema import | No root schema import | A; validate every queued root. |
| `src/infra/sqlite/storage-doctor.ts` H4 @54 | Root type import | Old reconciliation type import | A root type; keep inferred public summary typing appropriate to rich union. |
| `src/infra/sqlite/storage-doctor.ts` H5 @1108 | Explicit trust anchor + state root | Old spanRoot option | A; adapt every direct caller/fixture. |
| `src/infra/sqlite/storage-doctor.ts` H6 @1124 | Initial/intermediate/final identity checks and bounded reconciliation | Separate reverse reconciliation plus malformed-row catch | A traversal/identity protocol + B reverse/malformed/event-lifecycle checks. Exact baseline task-parent predicate restored in post-pin correction with red→green regression. |
| `src/server/dashboard/compose.ts` H1 @576 | Create artifact root with enforced owner-only permissions | Ordinary mkdir of existing artifactRoot | A permission enforcement; remove duplicate variable. |
| `src/server/dashboard/compose.ts` H2 @760 | Backup request, early refusal, unawaited publication | Await backup and health publication before preflight | B; startup blocking report still retained later; no detached backup publication. |
| `src/server/dashboard/compose.ts` H3 @1343 | Boolean backend ownership flag | Runner marks actual bound port owned | B; sole runner location receives actual server port. |
| `src/server/dashboard/queries/bootstrap.ts` H1 @11 | Type-only preflight/zod imports | Value parse of retained strict report | B; remove duplicate alternate report projection, preserve baseline bootstrap. |
| `src/server/dashboard/routes/api.ts` H1 @46 | Alternate server authority interface | Domain execute-only authority dependency | B; one authority, no detached-settlement interface. |
| `src/server/dashboard/routes/api.ts` H2 @260 | Loopback Host/Origin; streamed byte cap; distinct refusals; rate/single-flight | Minimal strict rerun execute route | A secure ingress invoking B authority; active finally releases only after actual settlement. |
| `src/server/storage/compose.ts` H1 @393 | Success only for rich reconciled arm | Success for semantic healthy helper | A equivalent condition; text rendering exhaustively handles all richer problem arms. |
| `tests/fixtures/preflight-seams.ts` H1 @2 | Real authority harness for ingress/replay | Healthy strict transport fixtures for baseline surfaces | Both; rebind real harness to domain authority and preserve baseline fixtures. |
| `tests/parity/helpers/seeded-bff.ts` H1 @66 | Real authority harness import | Baseline healthy report/executor fixtures | B; parity fixture truth unchanged except explicit doctor trust-root options. No parity regeneration. |
| `tests/unit/architecture/storage-recovery.test.ts` H1 @101 | Branch passive scheduler type/name | Baseline never-deadline fixture | A fixture naming, rebind to domain executor. |
| `tests/unit/architecture/storage-recovery.test.ts` H2 @3866 | Branch scheduler invocation and health assertions | Same health assertions with baseline scheduler | Both intents; all branch storage hardening cases preserved; richer snapshot expectations adapted. |
| `tests/unit/architecture/strict-boundary-schemas.test.ts` H1 @885 | Strict trust-anchor/state-root options | Old spanRoot options | A; strict-boundary fixture matches actual option contract. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H1 @12 | Executor imported from alternate core/server elsewhere | Domain authority/executor/request imports | B sole location. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H2 @42 | Manual scheduler supporting detached-timeout tests | Manual actual-settlement scheduler | B; additional multi-runner scheduler scoped to retained invariant test. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H3 @357 | Report, duplicate/surplus, replay and serialization cases | Exact report/CAS baseline cases | Both valid intents preserved; nine branch cases rehomed plus missing-runner check. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H4 @661 | Independently settling prompt-timeout recovery | Baseline report/CAS body | B execution shape; independent-settlement invariant rehomed with await semantics. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H5 @731 | Bounded retained identity replay | Strict result/request/CAS assertions | Both; capacity test retained in separate case. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H6 @891 | Alternate passive scheduler name | Domain scheduler name | B naming only; same injected detector assertion. |
| `tests/unit/preflight-runtime-dependencies.test.ts` H7 @903 | Wrong-check guard; prompt timeout/caller return behavior | Wait for timeout settlement and reject late health | Keep wrong-check guard and B timeout test; prompt-return semantics retired with explicit test ledger below. |
| `tests/unit/server/bff-flow.test.ts` H1 @27 | RunRecord import for real storage stream | EditableSettings schema import | Both; retain storage and baseline Settings test bodies. |
| `tests/unit/server/bff-flow.test.ts` H2 @66 | Real authority harness + strict result schema | Healthy report/executor transport fixtures | A real harness here; B healthy fixtures remain for other suites; baseline rerun case binds actual harness identity and loopback Host. |
| `tests/unit/server/bff-flow.test.ts` H3 @865 | Real span_stream diagnosis through doctor | Baseline exact report rerun route test | Both; secure ingress and storage cases plus Settings tests preserved. |
| `tests/unit/server/bootstrap-start-surface.test.ts` H1 @38 | Real authority harness import | Healthy strict report fixture | B; final file equals baseline. |
| `tests/unit/server/bootstrap-storage-arms.test.ts` H1 @21 | Strict constructed report schema | Registry selection helper | A explicit report cases; one projection contract. |
| `tests/unit/server/bootstrap-storage-arms.test.ts` H2 @94 | Exact six rows including warning/impact and blocking failure | Selected all-pass projection smoke | A stronger explicit literals preserve B ordering/projection intent; baseline impact rendering retained. |
| `tests/unit/server/compose-real-port.test.ts` H1 @9 | Package-copy/stat helpers for permission test | Read/write helpers for Settings restart test | Both needed imports; package fixtures now truthful package+lock copies. |
| `tests/unit/server/compose-real-port.test.ts` H2 @36 | Owner-only artifact root test | Applied Settings revision/restart test | Both; isolated test port overrides, all Settings assertions retained. |
| `docs/roadmap/index.html` H1 @165 | Generated alternate roadmap data | Generated integrated roadmap data | Regenerated from reconciled owning Markdown via `npm run roadmap`; no hand-picked generated payload. |
| `docs/roadmap/index.html` H2 @181 | Generated alternate roadmap data | Generated integrated roadmap data | Same regeneration; `roadmap:check` passed. |

## Staged / unstaged inventory

392 staged paths relative to HEAD include incoming baseline advancements; only 46 differ from frozen
integrated baseline. Lists: [final-staged-inventory.txt](../evidence/dcc2-m3/final-staged-inventory.txt),
[final-baseline-delta.txt](../evidence/dcc2-m3/final-baseline-delta.txt).
All other paths equal baseline. The post-pin delta is **13 paths, +453 / −90 lines** against d8bf813e.
The old staged-inventory/baseline-delta files describe initial pin only. Current untracked inventory:
[final-untracked-inventory.txt](../evidence/dcc2-m3/final-untracked-inventory.txt).

Zero unmerged paths; zero unstaged tracked edits. Only owned report/evidence and untouched supervisor
reports remain untracked. No broad staging included them. No parity reference corpus was changed by
this agent. The merge remains pending; no commit/push. Supervisor owns final review disposition,
heavy-gate allocation, merge commit and final integration report.

Final immutable review target: **e4ab3837feef579e8462b59e27eb9eb3015d0f65**, HEAD
**ac40292b8e3e8ff9b66242bbf8f8288554335f40**. Source/index frozen; no owned session remains.
