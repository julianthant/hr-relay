# DCC4 m2 — authority disposition

2026-08-30. `sup_analyst` (Terra/high 200k/180k), agent
`01a052f4-72c1-7422-a6c6-771e0b485974`, read-only; supervisor persists findings.
Target: original `49c6206c`, baseline `13175b13340fec7b5326207fe54f98078d481d7d`;
R-DCC `a9b5395f`. M1 covers every one of the 45 unique commits.

| Family | Disposition | Primary evidence |
|---|---|---|
| Protocol/identity | Preserved by complete command-envelope fingerprint; alternate token model superseded | baseline operator-trust §§5.3–5.4; domain/dashboard/explorer.ts:669–690; explorer-override-store.ts:171–180,217–235 |
| SQLite review/outbox | Superseded competing authority, not a missing feature | baseline owns file-first prepared claim/journal; alternate adds explorer_edit_reviews/explorer_edit_outbox and CAS |
| File durability | Real missing safety: combined fsync/close errors, cleanup error cause, post-rename directory-sync replay | baseline explorer-override-store.ts:101–107,401–502 |
| Restart reconciliation | Real missing composition call before serving; existing exact journal/audit/bytes proof is reusable | baseline explorer-override-store.ts:643–687; command-kernel.ts:3463–3476; compose.ts:992–1027; operator-trust:1891–1896 |
| Projection/routes | Preserve label/icon/category hot apply and reviewed source-change briefs; supersede eight-arm alternate runtime edit | baseline explorer-edit-service.ts:250–341; original query:706–850 and query tests:189–239 |

Supervisor verified the cited baseline store sync, applyPrepared, reconcilePending, and composition
code directly. The old AGENTS lesson describing tokens/outbox/broad leaves is superseded by the
explicitly assigned current owner; review token state is not an additional baseline requirement.

## Required bounded repairs

1. Reconcile the frozen baseline into this branch hunk-by-hunk. Preserve its file-first protocol,
   envelope fingerprint, exact descriptor/version/revision, narrow projection and source-change
   briefs. Remove superseded alternate modules (`domain/dashboard/explorer-edit.ts`,
   `infra/explorer-edit-authority.ts`), tables/repos/command wiring and tests only after tracing
   all affected hunks. Retain relevant regression intent in the selected protocol.
2. In `explorer-override-store.ts` and its focused tests, preserve fsync as primary/cause when
   close also fails; aggregate later stage/rename cleanup errors with paths. Exact replay after
   landed replacement must retry directory fsync before audit/finalization.
3. Expose/reuse exact pending-claim startup reconciliation and call it before serving Explorer.
   Exact journal+audit+next bytes may release the claim; absent/partial/divergent evidence remains
   blocking/loud. Prove both store and composition boundaries without adding an outbox.

The analyst proposed taking R-DCC versions wholesale. The supervisor rejects that procedure:
the disposition is a semantic guide, not authorization for blanket ours/theirs. `/worktree-sweep`
requires each hunk's original intent and primary authority recorded, including auto-merged residue.
Nonmutating merge-tree found 16 textual conflicts; SQLite authority and broad query tests auto-merge
and also require explicit reconciliation. No product decision requires operator input.

## Acceptance

Focused failure-capable tests for each missing invariant, then independent review. Final typecheck,
lint, coverage, manifest, parity, roadmap and diff checks. No coverage/parity before coordinator
allocation; mandatory shared OS lock remains. No live workflow/authority or other checkout writes.
Original focused protocol/service tests: 2 files, 19 passed; intake lint also passed.

Coordinator explicitly confirmed TDD seams on 2026-08-30: public override-store API for
fsync/close/cleanup cause preservation and durable exact replay; existing BFF startup/composition
boundary for refusing unproved service before pending-claim/journal/audit/byte reconciliation.
No new edit arm, durability contract or blanket source-inspection test seam. Red/green evidence and
independent Sol-axis review required. Exact-replay recovery must not be accidentally removed.
