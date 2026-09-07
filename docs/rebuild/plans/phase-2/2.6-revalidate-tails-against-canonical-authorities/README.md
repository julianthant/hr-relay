# Phase 2.6 · Revalidate tails against canonical authorities

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 2.6 · Revalidate tails against canonical authorities

**D341 input foundation (approved 2026-09-07).** Consume the completed pre-1.6.7 detour’s shared
fixture/configuration interface and explicit private-test source bindings. Tests do not provision
canaries through Settings. Trust/data/operator consumers must preserve redaction and captured-input
identity without reading current private configuration to reconstruct an existing run. The actual
operator database was reset; recovery proofs use reproducible synthetic fresh/v29 fixture recipes
handed off by Task 7, never the removed operator database or backup. The detour completes fixture
consolidation; this part consumes it and retains its existing adapter-retirement ownership.
<!-- roadmap: p2-authority-revalidation -->

This reopened part starts only after 1.6 closes. It changes downstream read models, joins, and
operator services that consume run/settings authority; it does not change the canonical stores,
rewrite append-only evidence, repeat D135's controlled write, or improvise a new contract.

**Execution order and wave ruling (2026-09-04).** The part runs as wave 1
(`1-1` ∥ `1-2` ∥ `1-3`) → Task 2 → Task 3. The three wave members consume the same frozen
1.6 authorities but own disjoint downstream seams: trust/evidence projections, intake/data
projections, and generic lifecycle/operator read models. Diagnostic capture belongs to 1-1;
intake/OCR/manifest/prior-run value projection belongs to 1-2; archive/current/queue lifecycle status and counts
belong to 1-3. A wave member may test another seam's stable `runId` contract, but may not edit that
seam. Shared composition roots, served aggregate contracts, guard inventory, generated artifacts,
and phase-close docs receive one owner in the coordinator run plan before dispatch; if a newly found
dependency requires two members to edit one file or contract, it becomes a serial prerequisite or a
new remediation task rather than an overlapping change.

Each member branches from the same master commit containing 1.6's verified close and runs in a
dedicated worktree. Before dispatch, the 2.6 coordinator records the exact base SHA, task/agent,
branch, absolute worktree, file and artifact scope, red-capable gate, and peer integration order.
Task 2 starts only after all three wave branches are verified, integrated `--no-ff`, and fully
closed. This is scheduling under D328, not authority redesign.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes D330 (`ref dashboard-surfaces` §9.2), D331
> plus D332's settings half (`ref clock-config-secrets` §3), D332 (`ref dashboard-surfaces` §2.5) and
> the adapter roster (`ref guards-and-tests` §5.2) exactly as 0.3 landed them. This part READS those
> contracts; it amends none of them. A proposed contract change returns to a newly numbered 0.3 task
> and is never improvised here.

### Task 1-1 · Revalidate trust and evidence consumers
<!-- roadmap: p2f-trust -->

- [ ] Rewire notification, receipt, failure, capture, log, gate, and parked-write run joins.
- [ ] Prove durable linkage through retry, archive, and tombstone without rewriting evidence.
- [ ] Stay behind the stable run/evidence boundary; do not edit intake data projections or generic
  lifecycle status/count/archive projections owned by Tasks 1-2 and 1-3.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.9's evidence-linkage invariants:
> spans/logs, receipts, failures, captures and gate records are evidence ABOUT a run and link to it by
> the stable `runId` alone, so no reader joins evidence to evidence to reach a lifecycle fact and the
> span fold contributes no lifecycle arm (§D330.12 item 1). Existence stays §D330.2's three-way answer
> (`absent` · `present` live/archived · `deleted`), and §D330.8's tombstone governs deletion — a
> deleted run's gate records leave WITH the run. The notification inbox row stays run-linked. No
> redesign.

### Task 1-2 · Revalidate data, intake, and prior-run value consumers
<!-- roadmap: p2f-data -->

- [ ] Rewire only actual run/settings dependencies across intake, OCR, manifests, mappings, and the
  D334 Rerun prefill source.
- [ ] Serve every descriptor-allowed completed-step value with exact source run/version, step/node,
  field path and provenance; preserve artifact readability and fail loud on missing canonical linkage.
  Also serve read-only completed/failed/unfinished step classification and completed-transaction evidence
  coordinates for D335 defaults/warnings. Never infer completion from an omitted-step assertion or grant
  repeat consent in this projection; 1.6.4 owns the already-built backend authorization boundary.
- [ ] Keep the projection read-only: it offers prefill candidates and never writes a lifecycle row,
  checkpoint, start plan or modal value. Redact/withhold any value the ordinary operator-suppliable
  schema does not admit.
- [ ] Treat diagnostic capture projection as Task 1-1's seam and generic lifecycle/operator reads as
  Task 1-3's seam; consume their stable contracts without editing them.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.9 — intake, OCR, manifest, mapping
> and Edit Data rows are evidence linked by `runId` and decide no lifecycle fact — together with
> `ref clock-config-secrets` §D331.8 (a leaf has exactly one source, so no intake or Edit Data path
> writes settings or a lifecycle row) and §D332.7 item 4 (the upgrade leaves evidence and its
> immutability rules untouched, so existing artifacts stay readable across it). No redesign.
>
> 2026-09-05 | D334 operator correction | the old `run.edit-checkpoint` consumer is retired by 1.6.4.
> This task owns only the replacement READ: completed-step values and their exact provenance for the
> source-bound Rerun modal. Prove partial/missing/malformed/deleted/archived sources, copied
> versus operator-entered provenance, transaction outputs represented as assertions rather than new
> write proof, and a byte-identical source run. Task 3.1.11-2 owns all modal state and submission.

### Task 1-3 · Revalidate operator read models
<!-- roadmap: p2f-operator -->

- [ ] Rewire archive, Activity, Explorer, doctor, preflight, and settings-status reads.
- [ ] Prove current/queue/archive/delete counts converge and protected settings never read back.
- [ ] Own shared lifecycle status/count envelopes and the A2/A3 deletions; do not edit the trust
  evidence or intake data projections owned by Tasks 1-1 and 1-2.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.5: `read` and `list` are the ONLY
> lifecycle reads — never a span fold, never `runs_view`. This task lands adapter A2's deletion, so the
> `run-status-fold-contributes-no-lifecycle-arm` unit test lands in the SAME commit that deletes the two
> `run-status.ts` fold arms (§D332.9 rule 4; `ref guards-and-tests` §5.2 A2); A3's `runs_view` table is
> removed with the projector's rewire, its `runs-view-has-no-reader` arm already active from 1.6.
> Settings status reads only `ref clock-config-secrets` §D331.6's presence/revision tuple; doctor and
> preflight follow §D331.11 P16 and report the `authority_upgrades` phases (§D332.5/§D332.6). No
> redesign.

### Task 2 · Run the non-mutating migration and recovery proof

**Task 1.6.6 deletion handoff.** Delete the migration-only
`src/infra/compat/{upgrade-sources,pre-floor-settings,settings-source-recovery,settings-database-upgrade}.ts`
modules and their stopped upgrade entry after the required recovery proof. Activate
`authority-upgrade-adapters-retired` with module-absence and named legacy-input refusal tests.
`sqlite-settings-authority` remains active; `authority-upgrade-adapters-isolated` retires when its
subjects are deleted. Preserve the strict v1/v2 historical-backup readers
`backup-inspection.ts`, `d331-settings-current.ts`, `d331-settings-root.ts`, and
`d331-protected-journal.ts`, plus permanent immutable journal schemas
`src/domain/commands-history.ts` and `src/domain/config/settings-v29-schema.ts`.
These historical readers never reintroduce runtime settings-file authority.

<!-- roadmap: p2f-proof -->

> **D336 (2026-09-06):** consume Task 1.6.6's verified SQLite-settings format, database restore
> behavior and independently read credential availability. The older paired-file rollback and
> `settings-root-single-pathname` target below are superseded. Delete only the migration adapters
> actually admitted by Task 6's revised proof/expiry mapping. Preserve downstream reconciliation,
> evidence readability, redaction and unknown-write refusal; no second live write is authorized.


- [ ] Run migrated-copy restore, scenario, concurrency, redaction, and direct-authority reconciliation
  gates; cite D135 rather than performing a second controlled write.
- [ ] Prove displaced sources cannot alter a response.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D332.4's restore-and-rollback admission
> with §D332.11 M17 (`restore-rollback-pairs-with-evidence`) and M22
> (`pre-floor-manifest-readable-for-restore`), re-run over a migrated COPY, and §D332.7 item 6 — a run
> left `authority-unknown` by a restore is never re-admitted. This task deletes adapters A0 and A1 and
> flips `authority-upgrade-adapters-retired` and `settings-root-single-pathname` from `planned` to
> `active` in that same deletion commit (`ref guards-and-tests` §5.2, intended entries 1–2). Task 1.6.6
> previously upgraded the real root; the operator subsequently reset it. Prove §D332.9 rule 5’s
> `authority-below-floor` refusal with a synthetic pre-floor artifact after adapter retirement;
> the deleted operator root/backup is not an input. D135 is cited; no second controlled write. No
> redesign.

### Task 3 · Close tail revalidation and hand fixtures to 3.1
<!-- roadmap: p2f-close -->

- [ ] Pass targeted/full/generated/production-route gates and an adversarial deletion-test review.
- [ ] Hand 3.1 stable contracts, representative fixtures, and an unresolved-defect ledger.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | hands 3.1 `ref clock-config-secrets` §D331.10 (the
> Settings/Setup edit contract), the served observed/active `display` pair (§D331.10's `derived-host`
> row on §D331.5's bootstrap/readback wire), and P40/A8 — the eleven frozen parity references carrying
> the Settings surface's `settings.json: not set` line are re-frozen DELIBERATELY at 3.1, not here —
> alongside the fixture matrix. No redesign.
