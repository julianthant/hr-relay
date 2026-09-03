# R5a report — scenario inventory, T1 structure, and T1b authority

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622`

**Run:** R05a · units u25, u26, u29

**Branch:** `feature/test-r5a-scenario-authority`

**Base:** `39598d2fb9c0964e3ac819c5b3de3538724a8380`

**Evidence head before this report:** `08d23db59b7356d6122b2463155b59b78f1c101e`

## Outcome

R5a inventories the complete scenario estate and establishes one honest structural T1a source per
registered workflow without deleting a case. The seven workflow structural files contain 81 cases;
the full scenario project contains 17 files / 142 cases. Person lookup's two former files are one
workflow-owned file, and architecture now derives ownership independently from both the executable
manifest and the actual corpus, so an unregistered split file cannot bypass the rule.

The two uncollected T1b declarations now account for their descriptors' current runtime nodes,
including D310's `pending-set` and `filing-presence` additions. Their retained target is honestly
`gone`, so both block before environment/browser composition; neither claims `met`. No browser or
workflow was started. No product contract, descriptor behavior, coverage floor, exclusion, or
runtime authority changed.

## Commits

| Commit | Logical change |
| --- | --- |
| `e9cc3129` | Consolidate/move all workflow structural scenarios, synthesize fixture identities, add one-file ownership enforcement, and update path authorities/instruction twins. |
| `efd9bc96` | Align both T1b declarations with runtime graphs and add exact runtime-node/receipt partition enforcement. |
| `31f69cda` | Close correctness/standards review: dependency-correct finalization order, corpus-derived ownership, current topology row, and deliberate Explorer parity refresh. |
| `eafa0663` | Clarify the dated family census and state explicitly that the two legacy-named cases run real task graphs over synthetic fixtures. |
| `4d5ecd71` | Regenerate the roadmap site through its owning command after the owning test-contract doc changed. |
| `08d23db5` | Persist the complete u25/u26/u29 evidence. |

The report itself is the final logical documentation commit and is the branch tip returned at
handoff. The coordinator owns any `--no-ff` integration and all later worktree/branch/task cleanup.

## Evidence by unit

| Unit | Durable evidence | Result |
| --- | --- | --- |
| u25 | `docs/coordinator/test-suite-rationalization/artifacts/r5/u25-inventory.md` | Complete 17-file/142-case collected matrix plus both uncollected T1b cases; all R5b files marked untouched. |
| u26 | `docs/coordinator/test-suite-rationalization/artifacts/r5/u26-t1.md` | Seven workflow owners / 81 retained cases, exact moves and path updates, controlled ownership red, synthetic authority boundary. |
| u29 | `docs/coordinator/test-suite-rationalization/artifacts/r5/u29-live.md` | Current blocked/gone authority, exact graph deltas, checkpoint/no-write proof, controlled completeness red, and no-live attestation. |

## Verification

| Command / control | Result |
| --- | --- |
| Eight-file pre-move T1a baseline, verbose | PASS · 8 files / 81 cases (`/tmp/r5a-u26-baseline.log`) |
| Controlled u26 red: one-structural-file architecture assertion before moves | EXPECTED RED · 1 failed / 14 passed; diagnostic named `person-lookup` and both old paths (`/tmp/r5a-u26-red.log`) |
| Controlled u29 red: exact T1b runtime-node accounting before manifest fixes | EXPECTED RED · 1 failed / 15 passed; diagnostic named missing `pending-set`/`filing-presence` (`/tmp/r5a-u29-red.log`) |
| Final focused seven T1a files, verbose | PASS · 7 files / 81 cases (`/tmp/r5a-u26-green-final.log`) |
| Final focused scenario/test-target/legacy-capability architecture | PASS · 3 files / 46 cases (`/tmp/r5a-architecture-focused-final.log`) |
| Review-fix focused scenario + architecture | PASS · finalization 10/10; Kronos/Kuali-read 10/10; ownership/target 31/31 |
| `npx vitest run --project scenario --reporter=verbose` | PASS · 17 files / 142 cases; project, file, and full behavior/refusal titles visible |
| `npm run test:architecture` | PASS · 70 files / 705 cases in 23.54 s |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS · zero warnings from ESLint |
| `npm run build:manifest:check` | PASS · generated build manifest current |
| `npm run roadmap:check` | Initial actionable red reported stale generated HTML; `npm run roadmap` changed one generated JSON line; final check PASS |
| `npm run test:parity:update` then `npm run test:parity` | Deliberate path-only refresh reviewed; final assert PASS · 281/281 in 1.1 min |
| `git diff --check 39598d2f..HEAD` | PASS |
| `cmp -s AGENTS.md CLAUDE.md` and scenario twin equivalent | PASS · both pairs byte-identical |

The scenario project's existing unreadable-PDF case emits pdfjs's `Warning: Indexing all PDF
objects` while asserting the named `unreadable-pdf` refusal. It is non-secret and the test passes,
but R7/u38 owns deciding how expected third-party diagnostics are captured under the family-wide
output contract. R5a did not add or globally suppress that warning.

## Independent review

Review used immutable candidate ranges and one owner per axis. Findings were fixed and the original
reviewers rechecked them.

| Axis | Reviewer / result |
| --- | --- |
| Repository standards | `sup_luna` found stale Explorer parity paths and a stale T1a topology row. Both closed in `31f69cda`; targeted parity 12/12 and architecture 15/15. |
| Spec | `sup_terra` found the required R5a evidence absent before close. The three artifacts and this exact report now satisfy that finding; final re-review is recorded at handoff. |
| Correctness | `sup_terra` found `filing-presence` before its `approval` dependency and a manifest-only ownership bypass. Both closed; reviewer confirmed descriptor order and corpus-derived enforcement. |
| Silent failures | `sup_terra`: clean. Blocked/unknown/absent remain distinguishable; no fallback converts missing authority into success. |
| Performance | `sup_terra`: clean. Checks are bounded by registered descriptors/two manifests; consolidation reduces collection starts. |
| Tests | `sup_luna`: clean. All 81 moved cases retained meaningful assertions; guards are failure-capable and no assertion was weakened. |
| Docs | `sup_luna` found mixed census dating and two ambiguous legacy-named test titles. Closed by explicit R5a/R7 census scope and full synthetic-fixture labels. |
| Security | Supervisor-owned review: clean. Added identifiers are synthetic, no secret/environment ingress was added, receipt diagnostics remain redacted, T1b evidence contains no person values, and parity fixtures expose repository paths only. |

No simplification pass was applied after review: the two new guards represent distinct manifest and
actual-corpus directions, and removing either would reopen a demonstrated bypass.

## Scope and integration notes

- R5b-owned dashboard scenario files and `operator-lifecycle.walk.test.ts` were inventoried and run,
  never edited. R5b still owns final scenario layout and family-wide review.
- A documentation review briefly explored renaming two scenario IDs; that would have changed product
  contract/descriptor fingerprints. The coordinator flagged the scope boundary, every uncommitted
  product/generated/parity consequence was restored, and only the in-scope full test-title
  clarification was committed. No product-semantic residue remains.
- Five workflows still lack T1b manifests; T1 `met` remains open. R5a did not manufacture cases or
  choose a replacement canary.
- The broader stale family census/taxonomy and expected-diagnostic policy remain R7-owned exactly as
  the board assigns them; no threshold or guarantee was weakened here.
- The board stayed read-only: blob `066e588b1397a57cb53d41af91514789e7ceedda` at intake and at
  close. The run diff contains no board change.
- The ignored dependency symlink used to make the isolated worktree runnable is removed before final
  status proof. Final handoff verifies an empty `git status --short`, exact branch ancestry from the
  reservation base, and no pushed or merged remote state.

## Coordinator action

Verify this report/artifacts and branch gates, merge the run branch `--no-ff` in the recorded order,
then remove the registered/physical run worktree, delete the run branch, and archive the exact task.
There is no `NEEDS COORDINATOR` product-truth decision from R5a.
