# DCC4 Explorer reconciliation — supervisor report

2026-08-30. **Branch-local reconciliation complete; full gates green; shared integration remains blocked separately.**
This is a branch-local report, not approval of shared migration-history integration.

## Ownership and verified intake

- Worktree: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`.
- Branch: `feature/r-dcc-dcc4-exclusive`.
- Original HEAD: `49c6206cbc3d3e30e97603628590823787d120d8`.
- Frozen incoming baseline: `13175b13340fec7b5326207fe54f98078d481d7d`.
- Intake was tracked/untracked clean; only ignored `node_modules/` existed.
- Authorized baseline merge committed only after required full gates: `858bd7d0ff3df4069fef673ed7f6a6d6964f2ef2`.
- Profile/brief/run-plan are the explicit root `docs/coordinator/worktree-completion/` inputs.
  Board is read-only. Every command/edit targets this assigned isolation, never inherited root.

Used `/supervise` with native role policy guard passing all five roles. Native tool exposes no
task-name field; every brief starts with its exact role prefix (tool limitation recorded in intake).
No new supervisor task or subunit worktree was created. `/worktree-sweep` governs hunk-by-hunk
reconciliation and bounded resource accounting; final source-tree removal remains coordinator-owned.
`/tdd` governed operator-confirmed public store/composition seams; `/review` separated all eight
axes. `/ui` governs final parity verification. `codebase-design refactor --diff` governed the
request-local immutable view and shared journal-adapter consolidation.

## Scope and disposition

The 45 branch-only commits were compared with 181 baseline-only commits and the current D283
owner. The newer label/icon/category, file-first exclusive prepared-claim protocol wins over the
older broad SQLite review/outbox runtime. No policy/notification/Edit Data/new-workflow edit arms
were reactivated. See [inventory](dcc4-m1.md), [authority judgment](dcc4-m2.md) and the exact
per-hunk ledger in [reconciliation](dcc4-m3.md).

Preserved missing invariants:

1. Filesystem errors retain primary-first fsync, close and cleanup causes with named paths.
2. Exact replay repeats the directory durability barrier. Real claim unlink followed by a failed
   directory sync cannot become cold-reopen success merely because the claim is absent.
3. Startup reconciles claim/journal/audit/bytes before service; partial/divergent evidence refuses.
   Unjournaled exact-replay-eligible pending work still blocks Explorer GET/validation.
4. Recovery proves next bytes from the prior document plus the complete narrow command; foreign
   workflow/presentation effects and nonempty dependency effects refuse without destroying evidence.
5. Each GET/validation reconciles once and captures one recursively frozen override view inside
   the authority transaction. The next request re-admits; there is no process-global stale cache.
6. Startup, read and command recovery use the same command-kernel-owned journal adapter.

## Immutable history boundary — shared integration remains blocked

Original DCC4 v19 digest remains
`bef14546c5a4bba520dca00f2bd0d950bc6f3824c5f953f54729d233b1701b8d`, introduced by
`854b8733f598a97bf0d7483a37343781480d0c5b`. Exact original SQL/digest, table registry and
storage validators are retained; dormant schema does not reactivate superseded commands/repos.
The original released-history declaration cannot be erased on an assumption of nondeployment.

Temporary-database public boot/validation tests accept original valid historical fingerprints and
lifecycle records and reject malformed ones. Their synthetic CURRENT unexecuted command satisfies
the FK. **This is not proof that retired broad command envelopes boot under today's narrow schema.**
No live database was read or converted by this supervisor. Coordinator's v18 metadata observations
are not universal nondeployment proof. See [history evidence](dcc4-migration-history.md) and the
root coordinator's open `decisions/2026-08-30-migration-history-integration.md`.
No rewrite, drop, renumber, conversion or shared integration disposition is authorized here.

## Unit evidence

| Unit | Native role | Result / evidence |
|---|---|---|
| m1 | sup_scout/high | Unique-history inventory; [report](dcc4-m1.md) |
| m2 | sup_analyst/high | Current-owner invariant judgment; [report](dcc4-m2.md) |
| m3 | sup_sol/high | Per-hunk reconciliation, durability/startup regression repair; [report](dcc4-m3.md) |
| m3b | sup_sol/high | Request-local admission red 7 → green 1; immutable/current request proofs; [report](dcc4-m3b.md) |
| m3c | sup_sol/high | Foreign-effect red missing exception → green 25 store tests, then 104 tests/6 files; [report](dcc4-m3c.md) |
| m3d | sup_luna/high | Faithful readAll adapter forwarding; 14 tests/1 file green; [report](dcc4-m3d.md) |
| m3e | sup_terra/high | Approved narrow Duo composition seam; synthetic red2/6 → green8; [report](dcc4-m3e.md) |
| m3f | sup_sol/high | Exact dormant storage-schema registration, four retention-only external-text exceptions; 122 focused tests green; [report](dcc4-m3f.md), [five-axis review](dcc4-review-m3f.md) |
| m4 | sup_terra/high | Original coverage RED1 retained; repaired coverage3721/3721 and parity239/239 EXIT0; slot released; [report](dcc4-m4.md) |

All execution/review roles use profile 240k/220k, Analyst 200k/180k and Scout120k/105k.
Writers are sequential in the existing isolation; read-only findings are persisted by supervisor.

## Exact regression anchors

All paths below are inside this assigned worktree; tests use temporary files/databases and
synthetic sessions, not live HR execution.

| Boundary | Test name / path |
|---|---|
| Real unlink and cold reopen | `retries durable absence on cold reopen after real claim unlink followed by failed directory sync`, `tests/unit/server/explorer-override-store.test.ts:219` |
| Failed cleanup | `preserves primary and named cleanup causes at every claim and rename boundary`, same file:430; `keeps a staged sync failure primary when removing that stage also fails`, :490 |
| Combined fsync/close | `preserves fsync as primary when closing the same path also fails`, same file:526; single-fault matrix :170 |
| Exact replay barrier | `repeats directory fsync before returning a landed exact replay as applied`, same file:392 |
| Foreign audit effects | `refuses recovered audit dependency effects without changing the prepared claim or override`, same file:309 |
| One admission per request | `serves Explorer with one recovery admission and one document read per %s request`, `tests/unit/server/compose-real-port.test.ts:140` |
| Fresh next-request authority | `keeps the admitted %s view when a new claim lands after admission, then re-admits on the next request`, same file:186 |
| Startup/read refusal and exact replay | `blocks unjournaled Explorer reads after restart while preserving exact command replay (landed=%s)`, same file:273; exact journal/audit/bytes :320; divergence matrix :340 |
| Dormant historical records only | `dormant v19 Explorer boot validation`, `tests/unit/sqlite-authority-database.test.ts:529` |

The real-unlink test repeatedly fails the directory barrier on a fresh store instance, then proves
success only after that same barrier recovers. It asserts no restoration/marker write is attempted;
there is no untested restoration-failure path. Separate cleanup tests aggregate actual attempted
cleanup failures behind their primary cause and retain the claim/evidence.

## Independent review

Final Explorer source tree reviewed: `202a63983e4c843e426a5db1d8851a0fb2b33bc7`.
This tree is not a commit and does not include later test/doc/Duo corrections.
Reviewers ran no gates or mutations. Later delta acceptance must be recorded separately.

Final fixture/Duo candidate `dbd1b32cc6233fb9fdf6f7b577ab4be06098822f` received separate
independent Tests, Security, Correctness and Standards/default reviews: all Count0/Worst none.
Their exact reports append this delta's disposition. No Explorer source changed after202a.
The remaining current-reference sentence correction received independent same-axis Docs closure.

| Axis | Disposition on 202a | Evidence |
|---|---|---|
| Correctness | Count0; foreign dependency-effect HIGH closed | [report](dcc4-review-correctness.md) |
| Security | Count0; tampered-next evidence finding closed | [report](dcc4-review-security.md) |
| Silent failures | Count0; original real-unlink/fsync HIGH independently closed | [report](dcc4-review-silent-failures.md) |
| Performance | Count0; repeated per-workflow admission HIGH closed | [report](dcc4-review-performance.md) |
| Tests | Count0; actual-I/O sensitivity accepted; unsupported mockReset allegation withdrawn | [report](dcc4-review-tests.md) |
| Spec | Count0 | [report](dcc4-review-spec.md) |
| Standards | Count0; duplicate journal callback medium closed | [report](dcc4-review-standards.md) |
| Docs | Count0 after same-axis review of final stale-v15 sentence correction | [report](dcc4-review-docs.md) |

## Gates — do not substitute earlier passes

Earlier e7 candidate had locked typecheck/lint, manifest and focused tests green. Those results
are not the final candidate's gate proof. Coordinator-canceled checks are canceled, not passes.

| Exact final gate | Result |
|---|---|
| `lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck` first attempt | QUEUED75, no check ran; [log](../evidence/dcc4-typecheck.log.gz) |
| Same bounded retry on202a | RED2, TS2741 missing readAll test adapter; [log](../evidence/dcc4-typecheck-final.log.gz) |
| Fresh final locked typecheck | PASS0 on repaired dbd1b32c product; [log](../evidence/dcc4-typecheck-repaired.log.gz) |
| Separately locked final lint | PASS0 on repaired dbd1b32c product; [log](../evidence/dcc4-lint-repaired.log.gz) |
| `npm run build:manifest` + manifest clean | PASS0; [log](../evidence/dcc4-manifest-verified.log.gz); generated manifest unchanged |
| `npm run roadmap` / `npm run roadmap:check` | PASS0, regenerated latest doc correction and verified fresh; [generate](../evidence/dcc4-roadmap-generate.log.gz), [check](../evidence/dcc4-roadmap-check.log.gz) |
| `npm run test:coverage` under allocated heavy lock | RED1 on dbd1b32c, 335 passed/1 failed files; 3717 passed/1 failed tests; 302.97s; [raw log](../evidence/dcc4-coverage.log.gz) |
| `npm run test:parity` | Not run after coverage red; slot released; renewed readiness/allocation required |
| `git diff --check` / `git diff --cached --check` | Passed after202a doc correction |

Every focused Vitest uses VITEST_MAX_WORKERS=1. At most one own light gate is active. Full
typecheck/lint each take the separate light lock. Coverage/parity take the shared heavy lock
only after coordinator allocation; no lock unlink, spin retry, threshold or timeout change.

The sole coverage failure is `redaction-surface-scan.test.ts:173`: declared module dispositions
omit the SURVIVING `src/domain/dashboard/explorer-edit.ts` dormant-v19 storage schemas.
The initial native summary inverted this comparison; the raw failure and subsequent supervisor/
coordinator verification correct it explicitly. The file is not deleted and must remain preserved.
The same focused guard reproduces red1/16 skipped in1.41s; no scanner or assertion was changed.
Proper durable-surface/leaf registration was repaired under `/debug` plus the repo wrapper.
The original branch already omitted this retained module. Both actual authority-validation schemas
are now registered, with all four free-text leaves conservatively classified external-text under
written retention-only exceptions. No inventory deletion, invented harmless origin or new
migration/history authority was used. Schema-identity, missing-origin/exception, dishonest-origin
mutation and forbidden-egress tests prove the repair can fail. Full redaction20 and six related
files pass122 distinct focused tests. Census:26 modules,35 surfaces,608 leaves,608 dispositions.
Full coverage floors and suite-size post-command did not complete; partial test success is not a pass.

Frozen repair tree: `9ede08fa4842eaf9d4e26aa6beeec0b132baf3e8`, same HEAD/MERGE_HEAD as intake.
Five independent final-delta axes (Tests, Standards, Correctness, Security, Silent failures)
accepted Count0; see [exact reviewer receive](dcc4-review-m3f.md). Fresh individually locked
typecheck and lint both EXIT0; [typecheck](../evidence/dcc4-typecheck-m3f.log.gz) and
[lint](../evidence/dcc4-lint-m3f.log.gz). No production source or immutable-history byte changed in M3F.
Fresh `build:manifest` EXIT0 left the manifest unchanged; `roadmap:check` EXIT0 reported fresh.
Both whitespace checks EXIT0, no unmerged entries or unstaged tracked delta. Evidence:
[manifest](../evidence/dcc4-manifest-m3f.log.gz), [roadmap](../evidence/dcc4-roadmap-check-m3f.log.gz).
Old coverage raw SHA256 remains `192d2a098effb567ef5be9ad9d3ac3a3b0f79c7fbff590b85213a5c505261297`.
Renewed explicit allocation was received and both full gates passed on this exact candidate:

| Final M3F full gate | Actual terminal result | Evidence |
|---|---|---|
| Coverage, session95081 | EXIT0;336/336 files,3721/3721 tests;323.84s | [raw coverage archive](../evidence/dcc4-coverage-m3f.log.gz) |
| Asserted parity, session84166 | EXIT0;239/239 cases;3.3m;PARITY_UPDATE unset | [raw parity archive](../evidence/dcc4-parity-m3f.log.gz) |

Coverage:84.68% statements,74.82% branches,88.20% functions,86.62% lines. Configured60%
global and80% safety-critical lines/statements/functions floors passed; branches are report-only.
Suite-size completed: unit249 files/84,334 lines,scenario18/7,124,architecture69/22,237.
HEAD/MERGE_HEAD/index were unchanged before and after each gate. The heavy slot was released
before UI inspection and reporting; no owned heavy process remains. All native units are closed.

`/ui` verification covered Explorer graph/transaction in both themes at1024/1280/1440 through
the full parity lane: maxDiffPixels0 at threshold0.2 and byte-exact a11y/provenance assertions.
No references were refreshed. M4 inspected four representative existing references and main
inspected graphite graph1024 plus paper transaction1440 after the fresh assertion; no new visual
issue identified in those views. These are asserted reference images, not fresh screenshot assets.

Raw gate evidence is preserved in deterministic gzip archives with original/archive hashes,
classifications and read/round-trip instructions in the [manifest](../evidence/dcc4-evidence-manifest.md).
The initial red log remains byte-identical; already-normalized Duo/repaired-light evidence is
explicitly distinguished, never relabeled raw. Plaintext is retained through archive commit
durability and then moved byte-for-byte into owned ignored tests/parity/.output/dcc4-raw-evidence.

## Completion handback

Product merge: `858bd7d0ff3df4069fef673ed7f6a6d6964f2ef2`, with exact parents
`49c6206cbc3d3e30e97603628590823787d120d8` and `13175b13340fec7b5326207fe54f98078d481d7d`.
Its entire committed tree is `9ede08fa4842eaf9d4e26aa6beeec0b132baf3e8`, byte-identical to the
reviewed/full-gate candidate. The later close-out commit contains only DCC4 reports/evidence;
its exact branch-tip SHA is supplied in the supervisor's final handback, avoiding self-reference.

No subunit worktree was created. All native agents are closed. No source worktree, branch,
database or raw evidence was deleted. The assigned source worktree remains for coordinator receive.
Ignored generated coverage/build/parity artifacts and dependencies stay local; raw plaintext is
retained under tests/parity/.output/dcc4-raw-evidence after committed-archive verification, not discarded.
This is existing parity scratch, so future parity may clear local copies; committed archives are
the durable portable evidence. The initially proposed test-results root was not ignored and the
pre-move check stopped before any move; only these documentation paths were corrected.
Final tracked/untracked cleanliness and archive round trips are checked after that scoped move.

Coordinator owns final serial shared integration and source removal only after the history
decision, receive verification and required shared integration gates. Root/master was never
touched and nothing was pushed. This complete branch-local result does not resolve the separate
immutable-v19 lineage conflict or establish retired command-envelope boot compatibility.
