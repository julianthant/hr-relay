# DCC1 final full-gate parent receive

2026-08-30. Parent read the complete [native report](dcc1-284ada-full-gates.md) and independently received its exact retained bytes, input maps, dependencies, references and preservation copies. This is branch-local acceptance, not shared integration or migration approval.

| Proof | Actual result |
|---|---|
| Manifest 65481; roadmap 75747 | gate/logger/wrapper 0/0/0 each |
| Full coverage 79293 | 335 files, 3806 tests; 0/0/0; 310.09s Vitest |
| Full asserted parity 69502 | 239 passed; 0/0/0; 198.934327708s |
| Parent read-only receive 6bd920 | exit0; 2593 unique file checks; all 1923 execution inputs and 603 references exact |
| Preserved copies | full physical walks of older112 and coverage653, bytes/modes and exact ignore provenance |
| Inventory | 424 Git-visible outputs / 1169 physically declared files at receipt boundary |
| Freshness | both diff checks0, no unmerged entries, no active Git hooks |

Exact pending merge: HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`, ordered MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`, index `284ada7ef313321287eb3f8cd6c28813ecf7a81c`, execution closure `d4002cf5ac793cc7fdf7050a6102d4a5fd7735c0ef39294353a843ef12070e9a`. Both full gates ran on this exact identity; no rerun for an unchanged tree gaining a commit hash.

Full raw outputs were written before tool transport and remain immutable. The [parent ledger](../evidence/dcc1-284ada-parent-receive.json) retains exact checker scripts/returns and distinguishes two checker failures: nonexistent wrapper field (e13782), and an overbroad substring check matching a **passed** failed-run case (0133e5). Both were read-only checker errors, not failed product gates. Two subsequent successful but transport-truncated outputs were not treated as complete evidence; 6bd920 returned the complete compact receipt without truncation. Compact output refers to the complete pinned postflight for native/full partition records; no verification predicate was skipped.

All commands are terminal; heavy allocation released before report polish. Historical full reds, diagnostic reds, failed tooling and original evidence remain retained. Only this new receipt/ledger and the already modified parent report are outside the tested index. Product merge commit will bind exactly the tested tree; evidence/docs follow separately. Migration versions and D75 cross-run join remain coordinator-owned, unresolved residue. No live work, push, source-worktree removal, board write-back or shared integration occurred.
