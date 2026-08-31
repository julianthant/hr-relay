# Supervisor brief — D290 DCR/DCC history integration

Invoke `/supervise`. This is the bounded final-history integration run approved by D290. It joins
the already received DCR and DCC branches on an isolated branch from the current shared target,
normalizes only their conflicting post-v18 migration suffix, preserves the D75 refusal boundary,
and returns a fully gated candidate to the coordinator. It does not own `integration/03b` itself.

## Exact assignment

- Project profile: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md`
- Coordinator board, read only: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md`
- Decision: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/decisions/2026-08-30-migration-history-integration.md` item 1, final `A`
- Intake evidence: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/evidence/schema-history-intake.md`
- Owned worktree: `/Users/julianhein/.codex/worktrees/03b-history-integration`
- Owned branch/base: `codex/r-03b-history-integration` at `9900e123724fb73423ff30150a62696f5d6c6b73`
- DCR source: `codex/r-dcr-authority-close` at `8839fddb8f592fbdf70d00407c03544ef9b6a622`
- DCC1 source: `feature/r-dcc-dcc1-exclusive` at `d65d38d5286dd3fa59eb3ec8072ba489788b934f`
- DCC2 source: `feature/r-dcc-dcc2-exclusive` at `c9af958a1452cabbc6721a5318f0b8b07388a280`
- DCC4 source: `feature/r-dcc-dcc4-exclusive` at `68386456f5858dbab4ea1aeb7e0a1ce4ef51f0d6`
- Receive reports: `dcr-receive.md`, `dcc1-final-receive.md`, `dcc2-receive.md`,
  `dcc2-ui-disposition.md`, `dcc4-receive.md` under the coordination reports directory
- Final report: `docs/coordinator/worktree-completion/reports/dcr-dcc-history-integration.md`
- Partial-stop handoff only if needed: `docs/coordinator/worktree-completion/handoffs/2026-08-31-dcr-dcc-history-integration.md`

Verify every exact source tip, clean source worktree and receive report before editing. Preserve the
source branches, commits, SQL statement bytes, digests and retained evidence. Merge only inside the
owned branch, with explicit `--no-ff` ancestry and hunk-by-hunk authority resolution. Never use
blanket ours/theirs, `-s ours`, reset, rebase, force, cherry-pick flattening or history rewrite.

## Product and history ruling

D290 is the one narrow exception to the ordinary immutable migration suffix:

- v1-v18 remain byte-for-byte fixed;
- DCR's reporting suffix is the integrated primary sequence;
- append only still-required DCC1 Settings schema changes after that sequence, preserving their
  original ordered SQL and digest as source-lineage evidence while assigning unambiguous integrated
  release versions and new reviewed integrated digests;
- explicitly record DCC4's Explorer schema as superseded; do not silently erase the source lineage
  and do not ship its conflicting v19 as the integrated release;
- prove fresh creation, exact-v18 upgrade, and fail-loud refusal of each recognized divergent DCR,
  DCC1 and DCC4 post-v18 suffix. Do not convert, select, copy or mutate any real database.

The integration also preserves the accepted product seams from every received branch. DCR D75 must
reject a valid-envelope `requestedBy` mismatch with HTTP 403 `REQUEST_IDENTITY_REFUSED` before
dispatch, replay or effects; DCC1 provenance stamping must never overwrite a foreign claim. DCC2's
backend storage/preflight contract may integrate with its documented presentation caveat. The open
`dcc-storage-span-visibility` UI follow-up remains out of scope and must not be presented as fixed.

Carry D290's normative owner text and pointer from root by intent into this branch. D291/D292 belong
to the separate active DCA run; do not copy or implement them here. Preserve D293 and the integrated
destination-only Run modal exactly.

## Units and proof

1. **H1 — exact join map and red gates.** Reconcile the four source tips, accepted product commits,
   migration tuples, overlapping files and evidence-only tails. Build red-capable tests for fresh,
   exact-v18 and divergent-suffix cases before changing migration authority. Record the merge order
   and every explicit supersession in the report.
2. **H2 — DCR primary sequence and D290 guard.** Merge DCR ancestry into the owned branch. Preserve
   its reporting behavior and original suffix as primary, implement the integration-only suffix
   identity/refusal mechanism, update the literal migration guard and pin exact statements/digests.
3. **H3 — DCC1 Settings and D75 ingress join.** Merge DCC1 ancestry, append only required Settings
   schema after the reporting suffix, and reconcile request provenance so a mismatched actor refuses
   before replay/effects. Prove exact replay and correct same-actor stamping still work.
4. **H4 — DCC2/DCC4 dispositions.** Merge accepted DCC2 storage/preflight behavior and DCC4
   Explorer behavior/ancestry without reintroducing a conflicting Explorer release suffix. Preserve
   all non-superseded current behavior and carry the span-visibility UI gap as explicit residue.
5. **H5 — independent review and full proof.** Review standards, D290/spec correctness, silent
   failures, migration safety, D75/security, performance, tests and docs. Run focused migration and
   ingress tests, locked lint/typecheck, manifest/roadmap/diff checks, then serialized full coverage
   and asserted parity. Commit logical categories with exact-path staging, leave the owned branch
   clean, and report exact ancestry, source dispositions, gates, residue and coordinator merge order.

Use only native `sup_scout`, `sup_analyst`, `sup_luna` and `sup_terra` roles with exact prefixes and
budgets. The Sol supervisor owns the normalization design, conflict resolution, integration commits,
consequential review and final proof. Do not touch any source worktree, the DCA worktrees,
`integration/03b`, master, legacy source, live HR/runtime authority or any remote. No source cleanup,
push, master merge, real database migration or live action.
