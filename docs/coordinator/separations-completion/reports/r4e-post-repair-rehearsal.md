# R4e — document 4495 post-R4d rehearsal and target packet

Date: 2026-09-02

Status: **NEEDS COORDINATOR — the one submit-free 4495 rehearsal proved D309, then exposed a new
D310 browser-function serialization defect before any eligible/protected-set or safe deletion-target
authority existed. Preserve the run; do not retry.**

## Outcome

Exactly one dashboard-started `dryRun=true` separations run used document 4495 after read-only Kuali
availability proof. The final UI confirmation visibly said `Dry run: On`, `Default workflow`, and
the current default browser/capture choices. One actual supported worker drained the item and stopped
idle. No alternate document, workflow retry, gate resolution, actual HR write, runtime-row repair,
registry/environment/source change, board edit, master merge, or push occurred.

Run `1c79c0e3-95f7-4f01-965c-7239620fd91c` / trace `sp-151339-1c79` reached current live Kuali,
UCPath, and New Kronos reads and produced D309 `machine-verification` with no gate. D310 then failed
before current-set authority because the browser-evaluated settlement predicate threw
`ReferenceError: __name is not defined`. This is a deterministic code/runtime serialization defect,
not an empty, eligible, protected, or ambiguous source-system result.

## Run status

| # | Subject | Run / trace | Attempt | State | Gate | Write intent | Result / transaction id | Next action |
|---:|---|---|---:|---|---|---|---|---|
| 1 | Kuali `4495` | `1c79c0e3-95f7-4f01-965c-7239620fd91c` / `sp-151339-1c79` | 3 | terminal failed at `pending-set` | absent | none | `UNEXPECTED_PAGE_STATE` / none | Preserve; do not retry. Brief a fresh repair supervisor for the browser predicate serialization seam. |

Attempt 3 reflects earlier history for match key `separations:4495`; this R4e task issued one fresh
Start command and no retry. A first worker CLI command was rejected before worker admission because
it lacked the required pool index; the corrected supported command created the one actual worker.

## Exact authority

- Plan `54138f57-8744-4f8e-a86c-da1980e08d42`; item
  `829a6aac-7e49-5f55-8514-b73d773c8a20`; dashboard start command
  `9e4d979c-32e2-41ee-8c21-f91984e3dd9e`.
- Failure `59a6b14f-df67-4ae3-80ce-d0e3abd7bcc1`, outer fingerprint
  `d811fe253c4fa59c5eea9dc13b310c8599a9430d85d3e0b60e4f4c1ae1a4f7ab`, code
  `UNEXPECTED_PAGE_STATE`, write state `not-attempted`, exact cause `ReferenceError: __name is not
  defined` inside `page.waitForFunction`.
- Receipt `40a0156b-14d2-5d0f-befc-9c67c1ceb1d0`: result `failed`, confidence `unknown`.
- Replayed verified nodes: `resolve-action`, `document`, `plan`, `termination-type`.
- Attempt-3 verified nodes: `name-search`, `subject`, `job-summary`, `employment`,
  `department-option`, `timecard-search`, `timecard`, `dates`, `comparison`, `approval`.
- D309: `approval.authority=machine-verification`; `identity-approval` absent because its condition
  was false; exact-run gate rows 0.
- D310: `pending-set` unknown. `clear-pending`, `file-termination`, `receipt`, `filing-presence`, and
  `finalize-kuali` were not reached because no current pending-set checkpoint could be formed.

## Zero-write proof

| Authority | Before | After | Exact run | Delta |
|---|---:|---:|---:|---:|
| `write_intents` | 0 | 0 | 0 | 0 |
| `write_attempts` | 0 | 0 | 0 | 0 |
| `durable_outbox` | 0 | 0 | 0 | 0 |

## Target and disposition packet

- Document 4495 is present and its identity mode is supplied/read-back, not name-only. It is only
  conditionally viable for filing/finalization because D310 authority is absent.
- Current eligible Pending set and protected set/count: **unknown**. The predicate exception produced
  no stable `T…` identifiers and no six-grid-fact joins.
- Provably disposable eligible row: **none proved**. Nothing may be inferred from this dry run.
- Disposition: retain document 4495; perform no deletion, filing, restore, or Kuali finalization.
- Exact missing fact: a repaired current-source D310 sweep with every eligible/protected stable
  `T…` ID and complete six-grid-fact keyed-detail join, plus source evidence that one exact eligible
  row is disposable.

The operator-facing R4f authorization request cannot yet name a deletion target and is therefore
blocked. Once the missing fact exists, the one explicit authorization must name that exact `T…` ID
and permit only: delete and keyed-absence/protected-set read-back; file one termination for document
4495's machine-verified subject and verify transaction number plus approval status; retain that
filing; finalize document 4495; and verify the complete Kuali reload read-back. These are operational
authorizations, not additional workflow gates.

Exact identifying values remain only in ignored restricted artifact
`.tracker-rebuild/restricted/r4e/target-disposition-packet.json` (SHA-256
`feafa8fa14d89ec1176d18dea14a582aad5fdfbf207ce6fa49ee8a013d47866d`).

## Evidence and cleanup

- Sanitized authority: [`../evidence/r4e/rehearsal.md`](../evidence/r4e/rehearsal.md).
- Sanitized screenshot inventory: [`../evidence/r4e/screenshots.json`](../evidence/r4e/screenshots.json).
- Restricted run spans: 32,921 bytes, SHA-256
  `c727a5bbd0a312869754d012c91e4f58b744feabedd058309eab3abf99d743b5`.
- `playwright-cli list`: no browsers. The one actual worker exited `stopped: idle`; no owned worker
  remains. Dashboard BFF/Vite remain healthy on 3938/5174 with the required fingerprint.
- Post-run authority and backup are current at schema 29 / generation 2490 with generation gap 0,
  26/26 streams reconciled, and zero pending commands, unresolved write intents, or durable outbox.
- Manifest, roadmap, and diff checks passed. No source/canonical product document changed, so no
  test/lint or implementation-review axis applies.

## Independent review

The fresh Scout mapped the supported command/evidence seams without changes. The fresh Analyst
returned PASS for one dashboard start/no retry/one actual drain, D309, and exact 0/0/0; FAIL for
D310 and therefore the R4f target packet. Its first health snapshot was partial only because the
backup cycle had not yet caught generation 2490; the final close check is current at generation 2490
with gap 0. It pins the repair seam to
`src/stores/ucpath/driver/smart-hr-operation.ts:226-245,527-531` plus a regression that exercises
browser serialization rather than the current direct-callback fixture. The supervisor owns the
live authority, write-safety, and target/disposition judgment. No implementation review applies
because this run changed no source.

## Coordination boundary

Mode: `coordinated-read-only` board at
`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/board.md`.
At intake the primary checkout was `f6f9da02`; the board blob was
`be9542a15f415a638332933ec174e943f2a63c65` (SHA-256
`3bfa1d0b897ad088a9f9b83eda1d5d50eb621b0239541311aff577d22ee7ca3c`). At close the primary
checkout had advanced independently to `b3d75578`, while the exact board retained the same blob and
SHA-256. R4e did not edit, stage, or commit the board, run plan, or project profile. No handoff is
needed because the immutable failure, restricted packet, and this report preserve the complete
recovery boundary.
