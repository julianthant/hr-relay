_History — superseded by `reference/dashboard-surfaces.md` §1.1, §2.3, §2.4 and §2.5 (see
`history/README.md`); kept verbatim as written on 2026-07-31 and 2026-08-01._

# `reference/dashboard-surfaces.md` — the four Phase 1c stage deltas

Four dated as-built blocks that stood above `## 0.` in this doc from 2026-07-31 until the
2026-08-20 rewrite (cohesion plan step 5.1b). They recorded Phase 1c landing in four stages —
A the domain shell, B the native storage adapter and migration v1, C the verified online backup
and the offline restore primitive, D the authority-write seam and migration v2 — and each closed
with a sentence about what Phase 1c still owed.

**Why they moved.** Their normative residue is in the code and is restated by the sections that own
it today: the authority/projection table classification and the generation rule by §2.3
(`src/domain/authority.ts`, `src/infra/sqlite/authority-database.ts`), the command families by §2.4
(`src/domain/commands.ts`), backup/doctor/restore by §2.5 and its D181 as-built
(`src/infra/sqlite/offline-restore.ts`, `recovery-stop-proof.ts`, `runtime-process-locks.ts`), and
beat ⑦ by `ref write-safety` §5 — the four-row primitive is now a storage step inside
`executeSequencedWriteCommit` (`src/core/write-sequencer.ts`), not a stage of its own. What does not
survive is their framing: *"Phase 1c remains in progress"*, *"Phase 1d is next"*. Phase 1 closed
2026-08-04 and Phase 2 on 2026-08-09, so a reader arriving at these blocks first — they sat at the
top of the doc — met a four-stage progress report before the contract it was reporting on.

Nothing here was deleted from the product; these are the stage NARRATIVES.

---

## Phase 1c Stage A as-built contract delta (2026-07-31)

Stage A lands the domain shell, not the storage service. `src/domain/authority.ts` now classifies an
exhaustive, recursively frozen registry of authority versus rebuildable projection table names;
there is deliberately no DDL, `node:sqlite`, repository, backup, doctor, or restore implementation
yet. Strict Zod-derived schemas now cover dependency records and immutable delegation manifests,
schema-hash-bound gate results, actor-keyed notifications, command results/audits, and the closed
atomic write-outbox arms.

`src/domain/commands.ts` implements D95's nine exhaustive target families and actor-stamped
idempotent envelope. Run `bump` is priority-only, version/archive uses only
`plan-version-bump` → `apply-version-bump`, and run `rename` accepts only the bounded normalized
display-name payload in §2.4. These are type shells: no route, handler, projector, worker, or UI
uses them in Stage A. Phase 1c remains in progress; the native authority/recovery implementation is
a later Stage-B delta.

---

## Phase 1c Stage B as-built storage delta (2026-07-31)

Stage B lands the native authority adapter, deterministic schema migration, and narrow repository
surface in `src/infra/sqlite/`. The runtime remains Node `>=26.0.0`; the Node 26 declaration package
is pinned exactly to the official-registry release `@types/node@26.1.2`. One
`AuthorityDatabase` privately owns its `node:sqlite` `DatabaseSync`; callers receive only typed
authority/projection repositories, transaction callbacks, schema inspection, and metadata. No raw
connection, SQL callback, or `DatabaseSync` type crosses the adapter boundary.

Schema version 1 creates every table in the Stage-A authority registry with its exact authority or
projection classification. Opening configures WAL, foreign keys, a positive busy timeout, and
`synchronous=FULL`; migration runs under `BEGIN EXCLUSIVE`, records/validates its owner marker, and
fails loud for empty or foreign existing files, newer/contradictory versions, a retained migration
marker, corruption, foreign-key violations, or registry/schema drift. It never replaces an invalid
existing file with a fresh database.

Every successful outer transaction that actually mutates authority increments
`authority_generation` once in the same commit. Nested authority repositories use real SQLite
savepoints, so an outer callback that catches a failed nested fence/commit cannot retain that
operation's partial rows or dirty-generation state; empty/idempotent transactions and projection
upsert/clear do not increment it, and rollback changes neither records nor generation. Permanent write-intent insertion deduplicates by the durable
idempotency-key digest for both `committed` and preflight `observed-present` records. Authority
repositories deliberately expose no cleanup/delete operation; projection repositories alone expose
`clear`.

This is not the recovery service. Stage B includes no backup, manifest/checksum, doctor,
read-only-degraded boot mode, restore, worker, command handler, projector loop, browser, route, UI,
or live-system wiring. Phase 1c therefore remains in progress; those later stages must not infer
completion from the existence of `state.db` authority.

---

## Phase 1c Stage C as-built recovery delta (2026-08-01)

Stage C adds a verified online-backup path around the private native SQLite adapter. It uses
Node's official online-backup API, writes a unique temporary copy, opens that copy read-only for
quick-check, foreign-key, registry, schema, typed-JSON, write-attempt, generation, and page-count
inspection, then fsyncs and atomically renames it. A strict self-describing manifest pins the
source identity, authority generation, schema/application identity, byte size, SHA-256 digest,
copy fingerprint, and verification result. The public surface still exposes neither the raw
database handle nor a SQL callback, and there is no `VACUUM INTO` or filesystem-copy fallback.
Concurrent requests coalesce behind one flight; a generation watermark can cause exactly one
follow-up copy, and failure to reach that watermark fails loud.

Existing authority files are inspected read-only before writable boot. Empty, corrupt, foreign,
newer-schema, foreign-key-invalid, or invariant-invalid files enter structured
`degraded-read-only` mode without being replaced; enqueue, claim, commit, and control mutation
entry points all fail with the same typed storage-health cause. The read-only doctor reports exact
pending command/write/outbox/notification counts and explicit restore candidates. It verifies
every discovered manifest and treats the newest invalid candidate as an invalid backup state
instead of silently falling back to an older plausible copy.

Inspection parses every durable `record_json` through the strict schema registered for its authority
table; JSON validity alone is never backup, doctor, or restore authority. Offline restore is
deliberately only a stopped-system primitive. It first verifies the exact requested manifest/copy
without mutation, then atomically consumes a fresh one-time proof issued from the isolated rebuild
process-lock root. The proof binds source-database identity, `hrauto-rebuild`, current runtime
generation, and current server/worker lock generations; stale, replayed, mismatched, or active-lock
proofs fail before suspect preservation or staging. A valid restore preserves the suspect authority
file and exact WAL/SHM companions, stages in the live directory, invokes an injected projection
rebuild, then proves the authority generation and content fingerprint did not change before the
atomic swap. It does not stop processes, choose a backup, delete preserved evidence, expose an
HTTP/UI surface, or contact a live system. Phase 1c remains incomplete until the later Stage-D spine work.

---

## Phase 1c Stage D as-built authority-write delta (2026-08-01)

Stage D closes item 1c's authority-write storage seam. The committed Stage-B version-1 DDL remains
immutable; schema migration 2 adds and backfills the strict natural idempotency-key columns beside
the derived digest and adds the unique `(system,idempotency_key)` index. An exact old-v1 fixture is
opened, migrated, validated, read, and written in the focused suite. The public adapter offers only narrow permanent-key operations:
record an unseen `observed-present` intent, fence one consistent intent/attempt pair, read by exact
permanent key, and commit the current fenced attempt. Standalone attempt insertion, durable-outbox
insertion, raw SQL, and native handles remain private.

`commitWriteAttempt` performs the 1c-owned portion of beat ⑦ in one outer authority transaction:
the intent becomes `committed`, its current attempt records the same accepted proof, and one valid
ledger outbox plus one valid terminal-span/generic-outcome outbox become durable together. Injected
failure after each of those four storage steps rolls back every row and leaves
`authority_generation` unchanged. An unseen live `present` result remains permanently
click-blocking while creating no attempt and no ledger/span outbox. Sequential and independently
opened competing connections resolve the same `(system,idempotency_key)` to the original permanent
intent; mismatched natural-key, key-digest, binding-proof, generation, proof, outcome, or outbox
identity fails before authority can advance. The ledger and terminal-span arms must share one trace
identity, and ledger subject evidence must exactly match the fenced subject proof (or be explicitly
absent for an unscoped proof).

This completes **Phase 1c**, not Phase 1. The command handler, enqueue/CAS services, task workers,
browser mutation seam, run/checkpoint state changes, full recovery orchestrator, write sequencer,
ledger/span projectors, HTTP routes, dashboard, and live-system wiring remain owned by 1d–1i-spine
or Phase 2. In particular, Stage D does not implement 1f's probe→prepare→bind→click sequence or
1g's outbox sequencing/projection; it makes the authority operations those later consumers must use
atomic and fail-closed. Phase 1d is next.
