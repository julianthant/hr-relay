# DCC4 — renewed full-gate readiness

Coordinator verified 2026-08-30. **Heavy slot OPEN** after DCA4's one-command diagnostic release.
This is readiness/allocation, not branch acceptance or shared migration-history approval.

Source: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`.
HEAD `49c6206cbc3d3e30e97603628590823787d120d8`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`;
frozen index `9ede08fa4842eaf9d4e26aa6beeec0b132baf3e8`.

| Claim | Classification | Evidence checked |
|---|---|---|
| Exact pending-merge candidate | Proved | Index-to9ede/working-to-index diffs empty; no unmerged paths; parents verified again at allocation |
| Bounded repair | Proved | dbd1→9ede changes five files:112 helper/test/owner/AGENTS additions plus162-line M3F report, no deletions |
| Runtime/history unchanged | Proved | src and migration-history-immutability test delta empty; only guard registration/test/documentation changed |
| Existing exception mechanism applies | Proved from owner/source | guards-and-tests §3.15 already permits named external-text exceptions for durable-authority; prior operator-trust §5.4 requires preserved dormant-v19 stored-record validation |
| Exact schemas and four historical labels | Proved by source inspection plus focused proof | Helper registers actual review-token/outbox record schemas; tests bind object identity to authority registry, exact four free-text leaves, historical-versus-current canary behavior, missing origins/exceptions and refused egress |
| No weakened guard | Proved in additive delta | Existing two-way scanner, matrix, auditor and old assertions unchanged; conservative external-text does not pretend historical labels had current rejection protection |
| Independent delta review | Recorded outcomes verified | Assigned reports/dcc4-review-m3f.md: five native Tests/Standards/Correctness/Security/Silent axes Count0 on dbd1→9ede |
| Focused proof | Proved from raw exit records | evidence/dcc4-redaction-m3f-green.log:20 redaction tests plus six related files,122 distinct tests; exact red/mutation receipts preserved in M3F report/log |
| Fresh light gates | Supervisor completed-exit receipts checked | dcc4.md records separately locked typecheck/lint EXIT0 on9ede; corresponding m3f logs contain expected command output, not standalone exit metadata |
| Freshness and whitespace | Proved | Coordinator roadmap:check0; staged/worktree diffcheck0; manifest generation/no-delta receipt checked against unchanged source |
| Original full failure retained | Proved | evidence/dcc4-coverage.log SHA256192d2a098effb567ef5be9ad9d3ac3a3b0f79c7fbff590b85213a5c505261297 unchanged |

The four named exceptions cover only retained historical bytes. They authorize no new writes,
projection/export, current overrides, migration conversion or retired command-envelope compatibility.
The final shared-history decision remains OPEN/UNAPPROVED. New documentation makes existing
retention accounting explicit; it does not change the matrix or add a new origin category.

Same native M4 may run full coverage then separately locked asserted parity, with PARITY_UPDATE
unset and VITEST_MAX_WORKERS=1 for coverage. Each heavy command requires the existing nonblocking
OS lock. No own concurrent light command. Preserve raw old failure and new gate outputs separately;
release immediately on repair pause or final heavy result, before report/manual UI/cleanup.
Final merge commit stays held until gates; eventual shared receive/removal remains coordinator-owned.

After heavy terminal release, new raw logs may be packaged as deterministic `gzip -n` archives
with a tracked per-file manifest (original/archive paths and hashes, command/exit, classification),
exact decompression byte/hash proof and reader instructions. Preserve plaintext through verified
archive durability, do not rewrite existing committed history or change ignore/gate policy.
Already-normalized Duo logs remain explicitly normalized; compression cannot make them original
raw output. Final coordinator receive must verify round trips before accepting the packaging.
