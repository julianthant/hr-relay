# DCC4 independent Security review

Reviewer `sup_sol`, agent `01a0530e-4f5c-7352-aba4-4e5a4124f783`, high, read-only.
Target tree `c6ee685216ddba8fa604fc145346c05fa5889bb6`; baseline `13175b13`.
Scope: store durability and dormant historical schema; startup/core correction excluded until follow-up.

`src/server/dashboard/commands/explorer-override-store.ts:259` **medium** — prepared-claim
validation binds metadata, not the reviewed presentation values. Altering `next.presentation.label`
and matching live JSON while preserving command/fingerprint can permit no-command reconciliation
to release the claim against unchanged journal/audit. Fix: derive complete expected next document
from previous state plus closed command changes; reject changed presentation and unrelated next
workflow mutations. This is a local persisted-state integrity failure, not a claimed remote exploit.

Count: 1 · Worst: medium. Supervisor verified cited parser/prepare code directly and assigned
a focused public-store regression/fix; not yet closed. The parser gap predates the diff, but the
new no-command startup/read path depends on it. Do not overstate protection against arbitrary
coordinated modification of every trusted local file; preserve the invariants this protocol can prove.

Reviewed eight requested store/schema/migration/test paths. No tests or mutations by reviewer.
Migration and migration-guard blobs exactly match original `49c6206c` (independently supervisor-checked).
Existing tests cover descriptor metadata, sync/cleanup barriers and dormant repository absence;
they did not cover the substituted presentation value. Startup and final fixed-tree review remain.

## Independent follow-up — e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64

Same reviewer: original medium **CLOSED**, Count: 0 open · Worst: none. Inspected all 17 changed
source/test/owning-doc files in the requested scope. Store line307 now checks complete next bytes
against prior state plus exact closed command changes. Test line256 covers four tampering arms
(requested label, unrelated insertion/mutation/removal) with unchanged journal/audit; line289
proves valid multi-edit replay. Kernel read-only adapter and startup transaction preserve ownership.

Cold-reopen test line199 performs real unlink, injected directory failure and repeated refusal
until fsync succeeds, asserting no restoration/marker writes; line181 preserves an appearing claim.
Historical SQL/digest exact; dormant schemas storage-only. Public TEMP-DB validator cases reject
malformed records without active repositories. No new Security finding; reviewer ran no gates.
Historical fixtures still do not prove retired command-envelope compatibility; integration block remains.

## Final delta — 202a63983e4c843e426a5db1d8851a0fb2b33bc7

Independent `sup_sol`, agent `01a0532b-1839-7b93-8265-628df6e9a017`, reviewed exact e7→202a
15-file delta plus baseline context. Count: 0 · Worst: none. Original tampered-next medium remains
closed (store:269,310). Audit proof at :710 retains envelope/target/revision and empty dependency
effects. Composition:1025 and :1248 create fresh transaction-scoped request views; store:752
recursively freezes parsed bytes. Current-workflow/descriptor checks remain; command/read recovery
share kernel journal adapter. Original migration/digest blobs identical. No new fallback, cache,
marker, protocol or active broad authority found. Static review only, no gates or DB execution.

## Fixture/Duo final delta — dbd1b32cc6233fb9fdf6f7b577ab4be06098822f

Independent `sup_sol`, agent `01a05335-8c42-7df1-92d0-532ed5c6188d`, high/read-only,
reviewed exact202a→dbd delta. Count: 0 · Worst: none. Runtime48/173 exposes typed in-process
injection only and forwards unchanged when present; production compose97 omits it and worker504
retains credential-backed factory. Unchanged core364/secrets458 still throw on invalid identity.
Synthetic fixtures348/423 use existing lease-backed gates, preserve real drains and safety/redaction
assertions; Explorer test275 directly delegates readAll. Both approved composition blobs match845ca5a1.
Retained red2/6 and green8 logs contain no credential contents/live HR data. No reviewer gate,
mutation or new integration/retired-envelope compatibility claim.
