# `reference/write-safety.md` — the two Phase-1c stage deltas (superseded)

> **Superseded.** `reference/write-safety.md` §2 (the contract and its authority shell) and §3
> (the kernel write sequence and beat ⑦) now state what these blocks described, as built rather
> than as a stage boundary. The "Phase 1c remains in progress" / "Phase 1 is not complete" framing
> died with Phase 1 on 2026-08-04. Kept verbatim; never cite as normative.

These two blocks stood above `## 0.` in `docs/rebuild/09-write-safety.md` (now
`reference/write-safety.md`) and recorded what Phase 1c Stage A and Stage D had landed on
2026-07-31 and 2026-08-01: the dependency-free strict shell (`ProbeVerdict`, the negative-settlement
policy union, the closed `SubjectProof | UnscopedBindingProof` union, the intent/attempt record
schemas, the ledger and outbox payload arms) and the storage-level invariants (`BEGIN IMMEDIATE`
unseen-key fencing, the durable `(system,idempotency_key)` uniqueness constraint, the Clock-injected
negative-settlement evaluator, the four-row atomic commit primitive).

---

## Phase 1c Stage A as-built contract delta (2026-07-31)

`src/domain/write-safety.ts` now implements the dependency-free strict shell described below:
evidence-qualified `ProbeVerdict`, stabilized versus operator-only negative-settlement policy, a
Clock-injected pure evaluator, the closed `SubjectProof | UnscopedBindingProof` union, reviewed
unscoped-reason registry, and permanent intent/attempt record schemas. A bare `absent`, an early or
single negative, an ambiguous/unknown/present verdict, a different key/query/source/state, or an
operator-only policy cannot produce `safe-to-retry`.

`src/domain/ledger.ts` and `src/domain/outbox.ts` add strict schema-hash-bound ledger payloads and
the two closed atomic beat-⑦ payload arms (`ledger-entry` and `write-committed-span`). They are
durable shapes only. Stage A includes no browser commit task, mutation capability, fence store,
sequencer, projector, recovery service, or external HR call, and therefore does not claim the write
sequence is implemented. Phase 1c remains in progress.

---

## Phase 1c Stage D as-built authority-write delta (2026-08-01)

Stage D implements the storage-level write-safety invariants item 1c owns. Natural idempotency keys
are strict, system-scoped values; their SHA-256 digest is derived with a versioned domain separator
and is revalidated anywhere an intent, ledger payload, or terminal span crosses a schema boundary.
Binding-proof digests are derived from canonical parsed proof JSON and revalidated on both intent
and attempt. The native authority adapter serializes unseen-key fencing with `BEGIN IMMEDIATE` and
the durable `(system,idempotency_key)` uniqueness constraint, so later sequential starters and
independently opened competing connections observe the original intent across `attempting`,
`committed`, and `observed-present` states. A live `observed-present` record creates no attempt and
no write ledger/span outbox.

The Clock-injected negative-settlement evaluator now counts only distinct, schema-valid
observations at or after `fencedAt + minSinceFenceMs`, separated by at least
`minBetweenReadsMs`, and bound to the exact fenced digest, authoritative query, observation source,
and source state. Early or single observations have zero retry authority. Duplicate, future,
out-of-order, wrong-boundary, present, ambiguous, unknown, malformed, or operator-only evidence
cannot become `safe-to-retry`; inconsistent evidence parks and malformed boundary input fails loud.

The strict generic `TransactionOutcome` and atomic-commit contracts bind the accepted completion
proof to both durable outbox arms and require the ledger and terminal-span arms to carry one trace
identity. At commit, subject-scoped ledger evidence must exactly equal the fenced proof's expected
subject; an explicitly unscoped proof requires an explicitly absent ledger subject. One native
transaction updates the current intent and attempt and inserts the ledger and terminal-span outboxes. Failure injected after each storage step proves
all-or-none rollback with no generation advance. The active `permanent-key-dedupe`,
`recovery-negative-proof-settlement`, and `atomic-write-outbox` guards pin these properties over
real temporary SQLite databases and manual-Clock boundaries.

This completes **Phase 1c's type and authority-storage shell only**. No commit task, mutation
capability, browser click, live probe, positive-recovery service, parked-intent command, worker,
sequencer/projector, route, UI, or external HR transaction exists yet. The complete kernel write
sequence remains item 1f; ordered ledger/span projection remains 1g-spine; controlled external-write
proof remains Phase 2. Phase 1d is next, and Phase 1 is not complete.
