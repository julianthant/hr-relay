# DCC4 independent Standards review

`sup_luna`, agent `01a0531e-765a-7561-9a96-52fb3d4908b6`, high/read-only.
Pinned `e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64` vs `13175b13`.

`src/core/command-kernel.ts:3490` **medium** — startup uses new `createExplorerCommandJournal`
adapter at line296 while ordinary recovery repeats its command/audit callback inline. Route that
callback through the shared adapter to avoid duplicated read logic and drift. Count: 1 · Worst: medium.

Supervisor verified the duplicate. Both callbacks are physically in the permitted command-kernel
owner; the finding is duplicated logic, not a claim that an unauthorized second module reads audits.
The small consolidation accompanies the exact recovered-audit-effect unit after read-admission repair.
No gates/edits by reviewer. Historical v19 SQL/digest matches original. Other axes not adjudicated here.

## Independent final follow-up — 202a63983e4c843e426a5db1d8851a0fb2b33bc7

`sup_luna`, agent `01a0532d-28d0-7bc1-8f02-f7f30baf74aa`, high/read-only.
Previous duplicate-reader medium CLOSED. Count: 0 · Worst: none. Both kernel3492 and
composition577 use createExplorerCommandJournal. Composition1025–1027 captures one admitted
whole-document view, recursively frozen at store752; query905/914 consumes that single view.
No duplicate schema, speculative abstraction or historical migration change. Exact tree blobs
reviewed; no gates or edits by reviewer.

## Fixture/Duo final delta — dbd1b32cc6233fb9fdf6f7b577ab4be06098822f

Independent `sup_luna`, agent `01a05335-8de9-7c90-ba97-db8248b6e834`, high/read-only.
Count: 0 · Worst: none. Typed optional factory forwarding (runtime13/47/173) preserves unchanged
production default (worker504); explicit fixture injections and direct readAll delegation introduce
no duplication, bypass or ownership violation. Reviewed scoped docs; no gates or mutations.
