# R4d — Smart HR pending-set settlement diagnosis and repair

Date: 2026-09-02

Status: **COMPLETE — the read-only live diagnosis proved PeopleSoft's single-result auto-drill,
and the bounded driver repair now classifies that state without weakening D310 or performing a
workflow retry or write. R4e remains the separately admitted live verification.**

## Outcome

The R4c failure was deterministic, not an authoritative empty-set result. PeopleSoft returned one
match by navigating directly to its transaction detail page. The old settlement waiter recognized
only result-grid rows and the explicit no-results marker, so it waited the full 45 seconds and
reported `UNEXPECTED_PAGE_STATE`.

The repair adds the live-proved auto-detail response as a third mutually exclusive settlement arm.
It requires one stable transaction identifier, performs the existing keyed detail reread, and keeps
the six-grid-fact D310 join unchanged. Result rows now carry their own transaction identifiers;
whole-page text cannot lend an unrelated identifier to a row. Hidden, duplicated, stale,
incomplete, or co-present states fail loud. All diagnostic paths redact EID/person/transaction
values.

No workflow was started or retried. No gate was resolved, no HR write was attempted, and no runtime
row, registry, environment, coordinator board, master branch, or remote was changed.

## Immutable R4c run

| Subject | Run / trace | Workflow state | Gate | Writes | Next |
|---|---|---|---|---|---|
| Kuali 4495 | `26e7eaa2-1111-4a88-be5e-b71e4432b4f7` / `sp-132417-26e7` | failed at `pending-set`; failure `85895513-780e-445f-87c3-6a5a42f69eb5`, `UNEXPECTED_PAGE_STATE` | absent | not attempted; zero intents, attempts, and durable outbox | Preserve immutable authority. R4e owns one fresh controlled verification after coordinator integration. |

## Commits

| Commit | Category |
|---|---|
| `6231381c` | admit the live-proved single-result auto-drill |
| `4a1e09a9` | redact Smart HR transaction identifiers from scan errors |
| `860dd7bb` | refuse ambiguous settlement states |
| `ddbb2e9f` | prove settlement from current visible evidence |
| `2257d219` | bind identifiers to their result rows |
| `685c1304` | refresh affected parity fingerprints |
| `722ef8c8` | cover every stale settlement marker |
| `7802a7a7` | make the settlement fixture execute the real predicate |
| `84b91bf0` | record the dated UCPath page-state lesson |
| `bf8b5dca` | refresh fingerprints after the documented source closure |
| `acbfe304` | prove hidden keyed receipts and every per-row D310 fact |

The final evidence/report commit is intentionally listed by the coordinator from branch history,
because a commit cannot truthfully contain its own identifier.

## Verification

| Gate | Result |
|---|---|
| Focused UCPath + separations tests | passed: 3 files / 67 tests |
| `npm run typecheck` | passed |
| `npm run lint` | passed, zero warnings |
| Full coverage | passed: 390 files / 4,838 tests; statements 85.34%, branches 76.40%, functions 89.32%, lines 87.28% |
| Manifest | regenerated where required; `npm run build:manifest:check` passed |
| Roadmap | `npm run roadmap:check` passed |
| Parity | final assertion mode passed 287/287 |
| Patch hygiene | `git diff --check` passed; no `[DEBUG-*]` tags remain |

The first full-coverage attempt failed at setup because this worktree did not have the legacy
checkout at the default sibling location. Rerunning with the repository's documented
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` override passed the entire gate.

Parity first failed only on twelve expected Explorer implementation-fingerprint strings. The
coordinator explicitly authorized `test:parity:update` after inspection proved every diff was a
one-line hash-only change. A later update-mode attempt encountered an unrelated
`apiResponse.json: Response has been disposed` failure after the references were written; the
controlling final assertion-mode run passed all 287 references.

## Independent review

| Axis | Outcome |
|---|---|
| D310 boundary | PASS: driver-only repair is sufficient; exact-set, six-fact, keyed reread, write, and replay contracts remain unchanged |
| Correctness | final count 0 after fixing ambiguity, orphan waits, stale markers, row/identifier binding, and hidden-row cases |
| Silent failures | final count 0 after making every indeterminate or co-present state unreadable |
| Performance | count 0; one bounded 45-second predicate wait, no losing background waits |
| Tests | fixture findings closed by executing the real predicate and covering positive, empty, ambiguous, hidden, stale, timeout, and redaction paths |
| Docs | promised evidence path supplied; UCPath instruction twins remain byte-identical |
| Standards | ratchets, manifest, diff check, and paired-instruction checks pass |
| Security | no new capability or write path; restricted captures remain ignored; committed evidence contains counts and hashes only |
| Spec closure | count 0; D310 authority is not widened or weakened |

## Evidence, runtime, and cleanup

- Sanitized live proof: [`../evidence/r4d/live-smart-hr-settlement.md`](../evidence/r4d/live-smart-hr-settlement.md).
- Restricted captures remain in the primary checkout under
  `.tracker-rebuild/restricted/r4d/`; their hashes are recorded in the sanitized evidence.
- `playwright-cli list` reported no browsers after the dedicated session closed.
- Storage authority remained healthy at schema 29 / generation 2405, quick check `ok`, with 25/25
  streams reconciled and 0/0/0 pending commands, unresolved write intents, and durable outbox. The
  final doctor command was nonzero only for a stale backup whose generation gap was zero.
- The primary dashboard was quiesced only for read-only evidence and gate isolation, then restored
  and verified on ports 3938/5174 from the primary checkout. Its bootstrap reported healthy/current
  storage and the integration-line separations fingerprint
  `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`.
- The closing worktree-sweep audit found only the coordinator's primary checkout and this active R4d
  checkout. The native review agents created no branch or worktree, so there was no worker residue
  to merge, remove, or delete; both task-owned worktrees were kept.

## Coordination boundary

Mode: coordinated, board read-only. The exact authority path is
`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/board.md`.
At intake, base and primary HEAD were `454e9387`; the board blob was
`af04622f08488862f33e8d010c75e65c8643ca09` (SHA-256
`5fb8b3f1a26669c6bfebc4aadd926c8cc02764ea9016e62658f4c37a08daefe5`). At close the primary
checkout had advanced independently to `3193929c`, while that exact board retained the identical
blob and SHA-256. R4d did not edit, stage, commit, or merge the board.

No handoff is needed: the repair, tests, live evidence, immutable R4c boundary, and R4e next action
are all durable in this branch.
