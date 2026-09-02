# R4e document 4495 post-R4d rehearsal evidence

Date: 2026-09-02 (America/Los_Angeles)

## Admission and one-start boundary

- Runtime base: `f6f9da02`; report branch: `feature/r4e-post-r4d-4495-rehearsal`.
- Dashboard BFF and Vite answered on `127.0.0.1:3938` and `127.0.0.1:5174`; the existing matching
  stack was not restarted.
- Served separations fingerprint:
  `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`.
- Pre-run storage was healthy/current, schema 29, generation 2407, and span authority reconciled
  25/25. Pending commands, unresolved write intents, and durable outbox were zero.
- A read-only Kuali Action List search returned exactly one row for document `4495`; no alternate
  candidate was inspected or chosen.
- The final dashboard confirmation visibly said workflow `Separations`, input `4495`, `1 run`,
  `Default workflow`, and `Dry run: On · Browser: Headed · Browser screenshots: On`.
- Plan `54138f57-8744-4f8e-a86c-da1980e08d42` named run
  `1c79c0e3-95f7-4f01-965c-7239620fd91c`, item
  `829a6aac-7e49-5f55-8514-b73d773c8a20`, and trace `sp-151339-1c79` before Start.
- Exactly one dashboard start command was issued: `9e4d979c-32e2-41ee-8c21-f91984e3dd9e`, family
  `start`, type `start-run`, source `dashboard`. The bounded command window contains only that row;
  it contains no retry or gate command.

## Worker boundary

The first CLI invocation omitted the now-required pool index and was rejected before worker
admission, claim, or run effect. It is not a workflow retry. The corrected supported command started
exactly one actual worker, `separations-worker-1`, with pool index 1 and `--drain`; it exited
`stopped: idle` with outcome `failed`. The durable run is attempt 3 because the match key has prior
history; this run was newly started and not retried.

## Exact failure authority

Run `1c79c0e3-95f7-4f01-965c-7239620fd91c` / trace `sp-151339-1c79` terminated failed at node
`pending-set`:

- failure `59a6b14f-df67-4ae3-80ce-d0e3abd7bcc1`;
- code `UNEXPECTED_PAGE_STATE`;
- outer fingerprint `d811fe253c4fa59c5eea9dc13b310c8599a9430d85d3e0b60e4f4c1ae1a4f7ab`;
- exact cause: `page.waitForFunction: ReferenceError: __name is not defined` in the D310 SS Smart HR
  settlement predicate;
- write state `not-attempted` and failure classified non-transient.

This is not an empty or ambiguous source-system set. It is a deterministic browser-function
serialization defect at the R4d settlement wait. The outer fingerprint matches the earlier generic
pending-set wrapper, but the exact R4e cause is distinct from R4c's 45-second unreadable-state
timeout. The immutable run was not retried and no source or runtime row was changed.

The independent review pins the repair seam to
`src/stores/ucpath/driver/smart-hr-operation.ts:226-245,527-531`: a module-scope `const` callback
containing a nested function reaches `page.waitForFunction`, and its transpiled source references
esbuild's unavailable browser helper `__name`. The existing unit fixture at
`tests/unit/ucpath-smart-hr-operation.test.ts:186-245` invokes the callback directly and therefore
does not exercise browser serialization. A fresh repair must add that serialization-capable
regression rather than weaken the D310 settlement contract.

Receipt `40a0156b-14d2-5d0f-befc-9c67c1ceb1d0` is `failed` / confidence `unknown`.

## Reached and not reached

| Node | Exact disposition |
|---|---|
| `resolve-action`, `document`, `plan`, `termination-type` | verified; replayed from the prior valid checkpoint lineage |
| `name-search`, `subject`, `job-summary`, `employment`, `department-option` | verified; observed in attempt 3 |
| `timecard-search`, `timecard`, `dates`, `comparison` | verified; observed in attempt 3 |
| `approval` | verified in attempt 3 with `machine-verification` authority |
| `identity-approval` | absent because its evidence condition was false; no gate opened and no decision/result row exists |
| `pending-set` | unknown; no checkpoint because the browser predicate threw before current set authority existed |
| `clear-pending`, `file-termination`, `receipt`, `filing-presence`, `finalize-kuali` | not reached because `pending-set` failed; all receipt verdicts remain unknown |
| completion terminal result | absent; the run terminalized as failure authority, not as a workflow result |

## D309 and D310

D309 is current and durable: the source document supplied an identifier, UCPath independently read
it back, `approval.authority` is `machine-verification`, the conditional identity gate was absent,
and exact-run gate rows are zero. Identifying values remain only in restricted evidence.

D310 is not established. The run produced no current eligible set, protected set, stable `T…`
identifier, or six-grid-fact keyed-detail join. The predicate exception cannot be interpreted as an
empty set. No eligible row is therefore proved disposable.

## Submit-free invariant

| Authority | Before global | After global | Exact run | Delta |
|---|---:|---:|---:|---:|
| `write_intents` | 0 | 0 | 0 | 0 |
| `write_attempts` | 0 | 0 | 0 | 0 |
| `durable_outbox` | 0 | 0 | 0 | 0 |

The exact-run span extract contains 32,921 bytes; SHA-256
`c727a5bbd0a312869754d012c91e4f58b744feabedd058309eab3abf99d743b5`.

## Target and disposition boundary

- Document 4495 is present and reached supplied/read-back machine verification. It is conditionally
  viable as the filing/finalization document, but R4f is not admitted without D310 authority.
- Current eligible set and protected set/count: unknown. No stable `T…` IDs or six-fact joins exist
  for this run.
- Provably disposable eligible row: none proved. A dry run cannot itself prove disposability, and
  this run did not even establish the current set.
- Disposition: retain document 4495. Do not delete, file, restore, or finalize anything from this
  evidence.
- Exact missing fact: a repaired current-source D310 sweep must enumerate every eligible and
  protected row with its stable `T…` ID and complete six-grid-fact keyed-detail join, followed by
  source evidence proving one exact eligible row disposable.

An actionable R4f request is blocked because it cannot yet name an exact deletion target. Once that
missing fact exists, one explicit authorization must name the exact disposable `T…` ID and permit
this sequence only: delete that row; prove its keyed absence and every protected row unchanged; file
one termination for document 4495's machine-verified subject; verify the new UCPath transaction
number and approval status; retain that filing; finalize Kuali document 4495; and verify the complete
Kuali reload read-back. These are run-level operations, not workflow gates.

The restricted exact packet is
`.tracker-rebuild/restricted/r4e/target-disposition-packet.json`, SHA-256
`feafa8fa14d89ec1176d18dea14a582aad5fdfbf207ce6fa49ee8a013d47866d`.

## Cleanup and verification

- `playwright-cli list`: no browsers.
- The one actual worker exited `stopped: idle`; no owned worker process remains.
- Dashboard BFF/Vite remain available on 3938/5174 with the required fingerprint.
- Post-run authority and backup are current at schema 29 / generation 2490, quick check `ok`, zero
  foreign-key or invariant violations, and 26/26 span streams reconciled. The first close check saw
  the ordinary backup interval still catching up; the existing cycle reached exact generation 2490
  with gap 0 at `2026-09-02T22:23:05.284Z`.
- Post-run pending commands, unresolved write intents, and durable outbox: 0/0/0.
- `npm run build:manifest:check`, `npm run roadmap:check`, and `git diff --check` passed on the exact
  runtime base. No source or canonical product document changed, so no test/lint implementation
  gate or code-review axis applies.

## Independent review

| Check | Result | Basis |
|---|---|---|
| one dashboard start / no retry or gate command / one actual drain | PASS | sole bounded command row plus worker-invocation authority |
| D309 machine verification | PASS | `approval` verified; conditional gate absent; zero exact-run gate rows |
| D310 exact set | FAIL | serialized predicate defect before source authority |
| exact-run submit-free invariant | PASS | before/after/exact-run `0/0/0` |
| R4f target packet | FAIL | no eligible/protected set or disposable target |
| cleanup/health | PASS at final close check | authority/backup both generation 2490; 26/26 streams; no browsers or worker residue |

The Analyst's operator call is: do not authorize R4f. Repair the predicate/test/guard seam, then run
one fresh exact D310 scan; only that evidence can name a deletion target and its retain/restore
read-back disposition.

## Restricted authority inventory

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `before-write-counts.json` | 137 | `c12b9d4634a5f05d8b71c7c70588908b3e65171722800e3bb152635d6915b343` |
| `after-write-counts.json` | 137 | `a2e033ceaefa0bced469d8189dfe8270e9e7d19fd04a09a2d73e70e231d43d5f` |
| `exact-run-write-counts.json` | 60 | `99fa5dc08979f834d30b4ea6d075aec75285ff884c2773074dc81843e4171ed5` |
| `checkpoints.json` | 38,237 | `ea4eee7684a2812de041379581045339d2e0d544f06527f85e4b0c5f3e2dd43d` |
| `explain-record.json` | 10,294 | `ef1377713eee5de2df6344e15283085e8615f2c0e9844397dbf2b458160ffbc6` |
| `failures.json` | 3,013 | `b834f14d1c881c259beca1bb17c57b14dddde6afc4356d35e46276c7d8b33ee3` |
| `receipts.json` | 134,880 | `e25956d1b9b81527bf3765018e3b82e59bf12b88bac810bf399df8dfcc2e5c84` |
| `post-doctor.json` | 104,254 | `e52bed3cca6acf09964af938378ccf8523a0be79609b1c47c84991c02eac58f3` |
| `run-window-commands.json` | 937 | `22b84edf448e93cbcac1bd963da248db2fdc34590b303ebec5f0b8ff8ba4817a` |
| `spans.jsonl` | 32,921 | `c727a5bbd0a312869754d012c91e4f58b744feabedd058309eab3abf99d743b5` |
| `target-disposition-packet.json` | 3,408 | `feafa8fa14d89ec1176d18dea14a582aad5fdfbf207ce6fa49ee8a013d47866d` |
| `worker-invocations.json` | 612 | `c2c16425345cb3abf581ad93dc454de896de040ff6c42cddc9942dba73e9eb3b` |
