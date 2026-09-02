# R4c — document 4495 post-repair rehearsal and target packet

Date: 2026-09-02

Status: **NEEDS COORDINATOR — the one submit-free 4495 rehearsal proved R4b and D309, then failed
at D310 before it could establish the current eligible/protected set or a safe deletion target.**

## Outcome

Exactly one dashboard-started `dryRun=true` separations run used document 4495. Kuali availability
was proved first, the final UI confirmation visibly said `Dry run: On`, and all ordinary steps were
included. One supported worker drained the item and stopped idle. No retry, gate resolution, actual
HR write, runtime repair, registry/environment/source change, board edit, master merge, or push
occurred.

Run `26e7eaa2-1111-4a88-be5e-b71e4432b4f7` / trace `sp-132417-26e7` reached live Kuali, UCPath,
and New Kronos reads; R4b's `dates.source` provenance repair held in the durable checkpoint. D309
then produced durable `machine-verification` authority, with no gate row and no operator decision.
The next task, D310's `ucpath/read-pending-termination-set`, failed because SS Smart HR rendered
neither a result row nor its explicit no-results marker within 45 seconds.

## Run status

| # | Subject | Run / trace | Attempt | State | Gate | Write intent | Result / transaction id | Next action |
|---:|---|---|---:|---|---|---|---|---|
| 1 | Kuali `4495` | `26e7eaa2-1111-4a88-be5e-b71e4432b4f7` / `sp-132417-26e7` | 2 | terminal failed at `pending-set` | absent | none | `UNEXPECTED_PAGE_STATE` / none | Preserve; do not retry. Re-establish current D310 exact-set authority in a separately admitted run before R4d. |

Attempt 2 reflects prior history for match key `separations:4495`; this R4c task issued exactly one
Start action, and receipt authority records `retryOf: absent`.

## Exact authority

- Failure `85895513-780e-445f-87c3-6a5a42f69eb5`, fingerprint
  `d811fe253c4fa59c5eea9dc13b310c8599a9430d85d3e0b60e4f4c1ae1a4f7ab`, code
  `UNEXPECTED_PAGE_STATE`, write state `not-attempted`.
- Receipt `1d4d3577-c843-5cf5-87e9-40174183a7cd`: result `failed`, confidence `unknown`.
- Verified durable nodes: `resolve-action`, `document`, `plan`, `termination-type`, `name-search`,
  `subject`, `job-summary`, `employment`, `department-option`, `timecard-search`, `timecard`,
  `dates`, `comparison`, `approval`.
- D309: `identity-approval` absent by its evidence condition; `approval.authority` is
  `machine-verification`; exact-run gate rows 0.
- D310: `pending-set` unknown. `clear-pending`, `file-termination`, `receipt`, `filing-presence`, and
  `finalize-kuali` were not reached.

## Zero-write proof

| Authority | Before | After | Exact run | Delta |
|---|---:|---:|---:|---:|
| `write_intents` | 0 | 0 | 0 | 0 |
| `write_attempts` | 0 | 0 | 0 | 0 |
| `durable_outbox` | 0 | 0 | 0 | 0 |

## Target and disposition packet

- Document 4495 is present and reached exact supplied/read-back machine verification. It is
  conditionally viable as the filing/finalization document, but **not viable for R4d yet** because
  the D310 exact-set precondition is absent.
- Current eligible Pending set: **unknown**. Current protected set/count: **unknown**. The source
  scan produced neither a result row nor the authoritative empty marker, so no stable T identifiers
  or six-grid-fact digest exist.
- Provably disposable eligible row: **none proved**. No deletion target may be inferred.
- Disposition: retain document 4495; perform no delete, file, restore, or Kuali finalization from
  this packet.
- Missing fact: a current D310 scan that returns the complete eligible/protected sets and stable T
  identifiers with six-grid-fact evidence, or the explicit no-results state.

An actionable R4d authorization request cannot be named honestly until that missing fact supplies an
exact deletion target. Once it does, the operator-facing request must name that exact stable T
identifier and authorize one controlled sequence: delete only the proved eligible Pending target,
file one termination for document 4495's machine-verified subject, verify the resulting UCPath
receipt/read-back, retain the new filing, finalize Kuali document 4495, and verify its full read-back.
Those are run-level operations under one explicit authorization, not additional workflow gates.

Exact identifying values remain only in ignored restricted artifact
`.tracker-rebuild/restricted/r4c/target-disposition-packet.json` (SHA-256
`6ba5bfdceb005fdbab476035102656a221c61d277166e8fa402b1b71f8afe6ec`).

## Evidence and cleanup

- Sanitized authority: [`../evidence/r4c/rehearsal.md`](../evidence/r4c/rehearsal.md).
- Sanitized screenshot inventory: [`../evidence/r4c/screenshots.json`](../evidence/r4c/screenshots.json).
- Restricted run spans: 47 events / 48,975 bytes, SHA-256
  `5a0158174254bad4604179ac7a7665a60bc6b600c7dd4da384bde1eaa7236142`.
- `playwright-cli list`: no browsers. The owned worker exited `stopped: idle`; no owned worker
  process remains. The dashboard remains healthy on 3938/5174 with the required fingerprint.
- Post-run storage: healthy/current, schema 29, generation 2405, 25/25 streams reconciled, zero
  pending commands, unresolved write intents, or durable outbox rows.
- Manifest, roadmap, and diff checks passed. No source/canonical-product document changed, so no
  test/lint or implementation review axis applies.

Residue: the new immutable failed run, failure, and receipt remain authority. Four existing leases,
three existing run-terminal-outbox rows, and one pre-existing expired worker lease needing attention
were visible before and after R4c; this run did not clear or mutate unrelated runtime history.

## Coordination boundary

Mode: `coordinated-read-only` board. Intake primary HEAD `eade8626`, close primary HEAD `e1a1b8ad`;
the board blob remained `58d9b66fbbdcd94b35ddfd0cc64e18ce38aeb4f0` and SHA-256
`9ca8f137a090e372b92aa39e2f37a259e23ca9a63222dc1e94d5bf092da8f698`. R4c did not edit, stage,
or commit the board. The coordinator must reconcile this report against its newer primary HEAD.

The fresh `sup_scout` operational map and fresh `sup_analyst` authority reconciliation are
read-only units; the Analyst returned PASS across one-start/no-retry, D309/R4b, D310, zero-write,
cleanup, and redaction checks. The supervisor owns the live authority and target/disposition
judgment. No handoff was created because the immutable failure, restricted packet, and this report
preserve the complete recovery boundary.
