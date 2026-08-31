# DCC4 independent Correctness review

`sup_terra`, agent `01a0531c-eedd-71f3-af86-10e32b29f702`, high/read-only.
Pinned `e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64` vs `13175b13`.
Inspected store recovery, kernel, startup/query admission, historical v19 records and tests/docs.

`src/server/dashboard/commands/explorer-override-store.ts:735` **high** — recovery accepts an
Explorer applied audit carrying nonempty `affectedDependencyIds`, despite the reviewed command
having no dependency effects, then releases the claim. Fix: require the exact empty vector,
as settings reconciliation already does. Count: 1 · Worst: high. No gates/edits by reviewer.
Supervisor verified the result/target/version checks do not yet constrain that effect vector.
Separate sequential store regression/fix follows the read-admission performance repair.
Original v19 digest remains unchanged; dormant tables have no active command/repository.

## Same-axis final follow-up — 202a63983e4c843e426a5db1d8851a0fb2b33bc7

Original high **CLOSED**. Count: 0 · Worst: none. Store line723 rejects nonempty
`affectedDependencyIds`; the regression preserves exact claim/override bytes on refusal.
Composition line1025 captures one recursively frozen view inside one admission transaction,
shared by GET/validation; command and read recovery share the journal adapter. Reviewer inspected
the final e7→202a delta and relevant baseline context with no new Correctness finding.
Original migration/registry/storage blobs remain byte-identical to `49c6206c`.
No gate, live DB, mutation or outbox runtime reactivation in review.

## Fixture/Duo final delta — dbd1b32cc6233fb9fdf6f7b577ab4be06098822f

Independent `sup_terra`, agent `01a05335-8d6b-73b0-afb8-637a1e8b2031`, high/read-only.
Count: 0 · Worst: none. Runtime173 forwards the explicitly supplied factory; unchanged worker504
retains production credential checks on omission and CLI composition cannot supply the fixture seam.
Synthetic tests348/423 retain real lease-backed gates; Explorer test275 faithfully delegates readAll.
Same-command retained red2/6→green8, exact845ca5a1 composition blobs, no CLI/core/auth/wire/history/
timeout changes. Reviewer ran no gates or mutations. Docs/history integration boundary unchanged.
