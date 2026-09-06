# Phase 2.2 · Evidence and operator trust

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 2.2 · Evidence and operator trust
<!-- roadmap: p2-2g -->

### Task 1 · Build durable trust records and diagnostic capture
<!-- roadmap: p2b-evidence -->

### Task 2 · Derive receipts and wire notification, knowledge, and ledger services
<!-- roadmap: p2b-services -->

The historical status block records the combined delivery; later uncomposed producer/projector
residuals remain assigned to their actual later owners.

<!-- roadmap-status: p2-2g -->
- [x] **schema v10** — the five durable trust tables plus the indexed `failures.fingerprint` (D134; `src/infra/sqlite/migrations.ts`)
- [x] **automatic redacted diagnostic capture**, two-phase: `prepare` redacts and writes attachments to the content-addressed store with nothing durable moved, then the bundle `persist`s inside the SAME authority transaction as the terminal CAS (D137)
- [x] the **durable actor-keyed notification inbox** — the row commits before ANY OS delivery, a repeat FOLDS in place on `(actorId, dedupeFingerprint)`, and the trigger union is ids, closed codes and counts with no free-text argument (D134/D138; `notification-durability` active)
- [x] **knowledge / fix admission** audited INSIDE the insert transaction; insert-only, supersession expressed forward by the new record (D139; `knowledge-fix-integrity` active)
- [x] the **ordered actor-attributed ledger projector** — five ordered durable facts, `seq` assigned BEFORE the append so the window is repairable, partitioned by the entry's own `confirmedAt` in UTC (D145; `ledger-projector` active)
- [x] **D82's `RunEvidenceReceipt` DERIVED from authority**, not minted at settlement — a pure function of the run record, terminal result/failure, checkpoints + provenance and write intents, with declared per-field redaction and an UNDECLARED leaf failing loud (D140–D143)
- [x] the receipt survived three later corrections without changing shape: the stamp must be a fact about the RUN (D199), a gate's durable record is not a checkpoint (D203/D204), an unreachable wire arm is a false absence (D237)
- [ ] `createLedgerProjector` has **no production caller** — beat ⑦ writes the durable ledger OUTBOX row, so the audit floor is intact, but nothing drains it to a file and the composed read half reads an empty corpus (`ref dashboard-surfaces` §1.2); **unowned, reported**
- [ ] FIVE of the seven notification trigger arms have no publisher — `run-failed`, `subject-mismatch`, `write-parked`, `repeating-failure`, `verified-done`; the two that shipped are D222's backup-health watch and D262's open-operator-gate watch (`ref dashboard-surfaces` §2.6) → `{#dash-defaults}` and the per-workflow `*-dash` nodes
- [ ] the knowledge PROJECTION has no caller, so no `KNOWLEDGE.md` exists, and `explain failure <fingerprint>` is not built (`ref operator-trust` §4.1/§4.2); **unowned, reported**
> 2026-08-21 | docs-cohesion 02 | verified against the `p2-2g` blocks in `reference/{operator-trust,dashboard-surfaces,frontend-backend-integration,guards-and-tests}.md` and spot-checked in `src/core/{evidence-receipt,diagnostic-capture}.ts`, `src/services/notifications/**`, `src/infra/ledger/ledger-projector.ts`, `src/infra/sqlite/migrations.ts`; left: the three unwired producers above

<!-- /roadmap-status -->

**What 2g was.** The rest of the event/trust layer over 1f's minimal durable `FailureRecord` and
terminal-result authorities: automatic redacted diagnostic bundles, rich failure/evidence
projections, terminal run evidence receipts and `explain run`, the durable actor-keyed notification
inbox (read/unread and snooze per D79b), knowledge/fix records, and ordered actor-attributed ledger
projection with recovery verification. **D82's acceptance test applies to this tail:** the receipt
must let the operator complete their double-check without opening UCPath.

**COMPLETE 2026-08-04 → 08-08 (D134–D145).** Its normative contracts are `ref operator-trust` §2,
§4, §6, §6.1 and §6.3, and `ref dashboard-surfaces` §2.6 (the notification model) — each carries its
own `p2-2g` status block, and those blocks are the per-contract truth this section indexes.

**Two shapes 2g established that the rest of the program reuses.** First, **a durable record is
stamped with a fact about ITSELF** — which is why the receipt is derived rather than minted, why
`evidenceReceipts.insert` refuses a divergent rebuild by name, and why D199 later had to move the
stamp off the reading process's build fingerprint and onto the run's own retained one. Second, **when
a durable row and a reader disagree about a fact's shape, the READER moves** — D144's transaction
node as terminal evidence is the first instance, and D203/D204's gate-as-evidence and D237's
`gate_results` reader are the second and third. Both rules exist because the alternative in each
case was making a durable row lie about its own contents.

**The mutable row is deliberate and bounded.** The notification inbox is the ONE authority row that
is UPDATED: a repeated identical trigger folds into the row its `(actorId, dedupeFingerprint)` owns,
advancing `count`, `lastSeenAt` and a version by exactly one, because the folded firings leave no
rows to derive those values from and `ref dashboard-surfaces` §2.6 forbids spamming the inbox.
Identity and `createdAt` are frozen by trigger. The ledger tables in the SAME migration go the other
way — abort-on-delete, one `assigned → appended` transition, immutable seq/digest/partition. That
asymmetry is the point, and it must not leak: nothing that records what was actually filed is
mutable.

**D82 was met, but not on the day the receipt became derivable.** The receipt has been derivable
since D140–D144; the panel that renders it was **two pixels wide** at every viewport from 1i-spine
until 2j found it (D187), so the acceptance bar was unmet ON SCREEN through a dozen green gates. The
fix and its lesson belong to §2j below; what belongs here is that a derivation being correct is not
the same claim as an operator being able to read it.
