# DCC4 independent Performance review

`sup_terra`, agent `01a0531c-efec-7e92-9d15-83466a82fb3b`, high/read-only.
Target `e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64` vs baseline `13175b13`.
17-file scope inspected, including query/compose/store/kernel, historical schema and tests/docs.

`src/server/dashboard/compose.ts:1026` **high** — each Explorer GET maps seven registry modules;
each override read invokes recovery, opening an authority `BEGIN IMMEDIATE` transaction and
synchronously syncing the directory when no claim exists. A read takes seven write admissions
and fsyncs, blocks the event loop, and serializes command/worker writers. Fix: admit/reconcile once
per GET and build the complete wire from one consistent immutable override read view.

Evidence: query `:912`, composition `:1026`, authority-database `:2373`, store `:754–755`.
Supervisor checked these call sites directly. Count: 1 · Worst: high. Not yet closed.
No gates, database runtime, edits or commits by reviewer. This is a structural I/O cost claim,
not an invented benchmark measurement. Recovery and fail-closed barriers must not be weakened.

## Independent final follow-up — 202a63983e4c843e426a5db1d8851a0fb2b33bc7

`sup_terra`, agent `01a0532b-1780-7560-8527-1a9dea9d0177`, high/read-only.
Previous HIGH CLOSED. Count: 0 · Worst: none. Composition line1025 captures one immutable
readAll view inside one authority admission per GET/validation; query line905 consumes it once.
The next request re-admits. Real HTTP counter tests pin at most one BEGIN IMMEDIATE,
directory fsync and document read; the crossing-claim test proves fresh next-request admission.
No benchmark, gate, database runtime, or mutation performed by reviewer.
