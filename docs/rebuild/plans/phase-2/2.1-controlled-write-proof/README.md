# Phase 2.1 · Controlled write proof

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 2.1 · Controlled write proof
<!-- roadmap: p2-proof -->

### Task 1 · Build the proving transaction
<!-- roadmap: p2a-transaction -->

### Task 2 · Execute and record the controlled proof
<!-- roadmap: p2a-proof -->

The historical record below covers both tasks together: the minimal proving workflow and the live
dry-run/mismatch/commit/read-back/idempotent-repeat evidence.

<!-- roadmap-status: p2-proof -->
- [x] `kuali/save-timekeeper-annotation` is the one-transaction-node proving workflow — one benign, restorable field on a real Kuali RRSS document, with a reload read-back verifier because Kuali's save is UI-silent (D122; `src/domain/contracts/kuali/save-timekeeper-annotation.ts`)
- [x] **dry run**: 6.6 s, staged preview and subject observation, ZERO durable rows — no intent, no fence, no checkpoint (D135, 2026-08-04)
- [x] **forced subject mismatch**: refused at beat ②, zero fence and zero click (D135)
- [x] **ONE controlled commit** on real doc **4489**, 16.45 s, producing a `committed` intent, a transaction checkpoint whose proof is the verifier's reload read-back, both durable outbox rows and the terminal span (D135)
- [x] **idempotent re-run**: `already-present` in 2 ms, no browser and no second click (D135)
- [x] the propagation window MEASURED over four write/restore cycles on doc **4490**, moving this contract's `recoveryAbsence` from `operator-only` to `stabilized` — `minSinceFenceMs: 30_000`, 2 consistent reads 5 s apart, same source state required (`save-timekeeper-annotation.ts:119-125`)
- [x] both documents restored to their captured original `""`, each restore proved by reload read-back (D135)
- [x] the mutation-capability registry lives in `src/base/mutation-capability.ts` and `src/core/write-sequencer.ts` is the ONLY permitted mint, over a runtime-unforgeable WeakSet; `task-driver-boundary` refuses a `commit` outside a capability-validating store driver, against a violating fixture (D127; `commit-routes-through-mutation` retired into it by D188)
- [x] preview / binding / fenced write / read-back / parked-write resolution all reach the operator through the SAME production client (`ref frontend-backend-integration` §6.4, its own `p2-proof` block)
- [x] the proof is RECORDED, not re-runnable — re-running it would be a second real HR write (`ref guards-and-tests` §10.1)
> 2026-08-21 | docs-cohesion 02 | verified against `src/domain/contracts/kuali/save-timekeeper-annotation.ts`, `src/core/write-sequencer.ts`, `src/base/mutation-capability.ts` and the `p2-proof` blocks in `reference/{frontend-backend-integration,guards-and-tests}.md`; left: nothing in this node — each workflow still owes its OWN controlled-commit proof at its migration

<!-- /roadmap-status -->

**What had to be proven, and how.** Choose the smallest controlled record whose prepare and commit
paths are real and whose outcome is independently queryable; build its transaction pair; run the dry
run first and prove staged preview plus subject observation with zero intent and zero commit; inject
a wrong displayed subject and prove zero fence and zero click; then, and only under the explicit
Phase-2 test protocol, perform ONE controlled commit and prove permanent-key dedupe, typed recovery
proof, atomic outboxes, serialized ledger projection and context cleanup. The crash matrix covers an
early `absent`, a repeated but not-yet-aged absence, conflicting observations, stabilized absence,
positive proof, malformed proof and an unavailable target — only the policy-qualified stabilized arm
may create a new intent generation, and every indeterminate arm parks. Had no safe independently
verifiable target existed, Phase 2 would have been blocked and write-heavy migration could not have
begun.

**It is MET live on the operator's own documents (D135, 2026-08-04).** Every number above was
measured on real Kuali documents, not fixtures. `recoveryAbsence: stabilized` is scoped to **this
contract only** — it is a measured property of Kuali's save propagation, not a platform default:
`ucpath/create-termination` and `ucpath/delete-pending-terminations` both remain `operator-only`
precisely because nobody has measured a UCPath window, and inventing a `minSinceFenceMs` is the
banned unverified constant. (`kuali/save-separation-finalization` later inherited a stabilized
policy from its own separately measured window — chunk 5c — not from this one.)

**D128 was wrong the same day, and is withdrawn.** D128 concluded that the operator's documents sat
at a workflow step — `Task 1 - Kristina & TES` — that does not own the `Timekeeper Name:*` field.
Kuali's own `ActionPage` query reports that step's `sectionSettings` as `edit` for the section
holding the field, and the checkbox beside it binds instantly. The two real causes were defects in
**this** repository's driver: a Kuali text gadget debounces into the document model (~700 ms) and
the run fenced and clicked INSIDE that window, and `commit` returned at REQUEST time so the
verifier's `page.reload()` cancelled the in-flight save. Both are fixed and both are now proven on
the wire per run. The generalizable half is the one D128 got right before its conclusion went wrong:
a field being rendered and editable is not evidence the step can write it, and a positive save
signal — HTTP `200` plus a rendered *Form saved* — is worth nothing on its own.

**What the kernel did while the target was still disqualified.** During the D128 run the kernel
behaved exactly as designed: it fenced durable before the click, read back `absent`, parked the
intent `unknown`, wrote ZERO checkpoint / ledger / terminal-span rows, and a later run on the same
key refused in 1 ms with no browser. That is the proof's second result and it is worth as much as
the first — the write path is fail-closed under a target that cannot be written.

**What is still owed.** Write-heavy workflow migration is unblocked, and **each workflow still owes
its own §3.2 controlled-commit proof at its own migration** — the kernel is proven, a store's
receipt/probe policy is not. UCPath and ServiceNow targets are named per migration; OnBase is gated
on the next real upload. Full evidence, measured numbers and durable row ids:
`ref write-safety` §Phase-2 controlled-commit as-built.
