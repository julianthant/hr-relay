# Decisions — migration-history integration — 2026-08-30

Status: OPEN. No option is selected or authorized. Branch-local work may continue.
Evidence: ../evidence/schema-history-intake.md and the three assigned supervisor inventories.

## 1 · Combine the conflicting unmerged migration histories

**Situation.** Three unfinished branches used the same database version numbers for different
schema changes, while their guards call those migrations released and immutable. The inspected
root database is at v18, and all 95 retained authority backups are v18 or earlier; this does not
prove that a divergent database exists nowhere else. A single integrated v19 cannot mean three
different schemas, so clean merges and passing branch-local tests alone cannot settle this.

**Options.**

- **A. Authorize a bounded integration-only normalization after v18.** Preserve all original
  commits, SQL and digest evidence; keep the reporting suffix as the proposed primary sequence and
  append only still-required Settings schema changes in a reviewed suffix. Explicitly dispose of
  superseded Explorer schema rather than silently erasing its history. Ratify the exception in the
  owning migration contract and pin the final sequence. Validate v18 upgrades/fresh databases and
  fail loud for divergent pre-existing suffixes; do not convert a real database under this decision.
  Cost: a narrow exception to the branch guards' declared release history, plus dedicated review
  and refusal tests. This chooses no live runtime or HR gate.
- **B. Preserve all three suffixes as supported released lineages.** Design explicit lineage
  recognition and reviewed forward conversion for each before joining them. Cost: a larger
  authority/migration design and verification run, plus an inventory of any retained divergent
  databases; no claim that one simple renumbering suffices.
- **C. Finish branch-local work but defer shared integration.** Keep commits, worktrees and
  evidence intact while the histories remain separate. Cost: this cannot satisfy the requested
  all-worktree completion and cleanup yet.

**Recommendation.** A, subject to explicit operator approval: the bounded local metadata evidence
supports a narrow integration correction, while preserved source histories and fail-loud handling
keep unknown divergent databases from being silently treated as the selected lineage.

**Notes.** _(operator notes here)_

No approval here provisions R2 secrets, selects/copies a live authority database, approves an HR
ALWAYS-GATE, merges master, pushes to a remote, or authorizes automatic conversion of real data.
