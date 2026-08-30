# DCC2 raw-evidence whitespace ledger

Product merge `0b9a4de73504aeb1dc354e82927e0423960b0a37` preserves exact tested tree
`56ba105f1841097927a444d6454686c954b4e9db`; its product/index diff check passed before commit.
The subsequent evidence-only staged diff check exits **2**, with **667 diagnostics in 74 files**.
This is not recorded as a passing whole-evidence whitespace gate. Original raw command/patch output,
history captures and independent Markdown review transcripts are intentionally retained byte-for-byte
under coordinator instruction; no normalization, git configuration or attribute override was applied.
Coverage's 412 trailing-whitespace lines are original reporter output. Review transcript two-space
line endings preserve their Markdown hard breaks. Blank final lines and patch context are also retained.

Reproduce after documentation commit with `git diff --check 0b9a4de73504aeb1dc354e82927e0423960b0a37 HEAD`.
Line numbers below refer to the exact retained files; ranges compact consecutive diagnostics only.

| Artifact relative to worktree-completion | Diagnosis | Count | Exact lines |
|---|---|---:|---|
| `evidence/dcc2-m3/baseline-delta.txt` | new blank line at EOF. | 1 | 47 |
| `evidence/dcc2-m3/caller-disarm-mutation-red.log` | new blank line at EOF. | 1 | 35 |
| `evidence/dcc2-m3/diagnostic-cli-contract-final.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/diagnostic-components-green.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/diagnostic-components-red.log` | new blank line at EOF. | 1 | 138 |
| `evidence/dcc2-m3/diagnostic-final-green.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/focused-1.log` | new blank line at EOF. | 1 | 375 |
| `evidence/dcc2-m3/focused-2.log` | new blank line at EOF. | 1 | 65 |
| `evidence/dcc2-m3/focused-corrected-followup.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/focused-corrected.log` | new blank line at EOF. | 1 | 37 |
| `evidence/dcc2-m3/focused-final-candidate.log` | new blank line at EOF. | 1 | 36 |
| `evidence/dcc2-m3/focused-final-followup.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/focused-final.log` | new blank line at EOF. | 1 | 11 |
| `evidence/dcc2-m3/independent-settlement-mutation-red.log` | new blank line at EOF. | 1 | 35 |
| `evidence/dcc2-m3/lint-2.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3/lint-cli-contract-final-locked.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3/lint-corrected-final-locked.log` | new blank line at EOF. | 1 | 16 |
| `evidence/dcc2-m3/lint-final-authorized-locked.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3/lint-followup-delta.patch` | trailing whitespace. | 1 | 16 |
| `evidence/dcc2-m3/lint-initial.log` | new blank line at EOF. | 1 | 184 |
| `evidence/dcc2-m3/nested-component-red.log` | new blank line at EOF. | 1 | 83 |
| `evidence/dcc2-m3/original-conflict-hunks.md` | new blank line at EOF. | 1 | 2729 |
| `evidence/dcc2-m3/performance-regression-green.log` | new blank line at EOF. | 1 | 10 |
| `evidence/dcc2-m3/performance-regression-red.log` | new blank line at EOF. | 1 | 57 |
| `evidence/dcc2-m3/post-55-review-delta.patch` | trailing whitespace. | 3 | 14, 32, 49 |
| `evidence/dcc2-m3/post-pin-delta.patch` | trailing whitespace. | 29 | 24, 61, 92, 117, 170, 185, 271, 293, 437, 550, 605, 612, 619, 628, 639, 646, 655, 672, 683, 692, 704, 741, 765, 859, 866, 1045, 1049, 1084, 1088 |
| `evidence/dcc2-m3/preflight-green.log` | new blank line at EOF. | 1 | 10 |
| `evidence/dcc2-m3/preflight-red.log` | new blank line at EOF. | 1 | 87 |
| `evidence/dcc2-m3/preservation-green.log` | new blank line at EOF. | 1 | 10 |
| `evidence/dcc2-m3/schema-key-old-formatter-mutation.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/security-red.log` | new blank line at EOF. | 1 | 135 |
| `evidence/dcc2-m3/security-standards-green.log` | new blank line at EOF. | 1 | 22 |
| `evidence/dcc2-m3/staged-inventory.txt` | new blank line at EOF. | 1 | 392 |
| `evidence/dcc2-m3/standards-read-red.log` | new blank line at EOF. | 1 | 83 |
| `evidence/dcc2-m3/storage-reconciliation-green.log` | new blank line at EOF. | 1 | 10 |
| `evidence/dcc2-m3/storage-reconciliation-red.log` | new blank line at EOF. | 1 | 151 |
| `evidence/dcc2-m3/supervisor-dry-run-composition-preflight.log` | new blank line at EOF. | 1 | 93 |
| `evidence/dcc2-m3/task-parent-red.log` | new blank line at EOF. | 1 | 35 |
| `evidence/dcc2-m3/typecheck-3.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3/typecheck-cli-contract-final-locked.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3/typecheck-corrected-final-locked.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3/vite-transport-green.log` | new blank line at EOF. | 1 | 9 |
| `evidence/dcc2-m3/vite-transport-mutation-red.log` | new blank line at EOF. | 1 | 80 |
| `evidence/dcc2-m3f/candidate.patch` | trailing whitespace. | 2 | 54, 56 |
| `evidence/dcc2-m3f/focused-green.log` | new blank line at EOF. | 1 | 10 |
| `evidence/dcc2-m3f/focused-red.log` | new blank line at EOF. | 1 | 93 |
| `evidence/dcc2-m3f/lint-locked.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m3f/typecheck-locked.log` | new blank line at EOF. | 1 | 4 |
| `evidence/dcc2-m4/browser-close.log` | new blank line at EOF. | 1 | 2 |
| `evidence/dcc2-m4/coverage.log` | trailing whitespace. | 412 | 76, 78-488 |
| `evidence/dcc2-supervisor/m3f-focused.log` | new blank line at EOF. | 1 | 10 |
| `evidence/dcc2-supervisor/m3f-lint.log` | new blank line at EOF. | 1 | 4 |
| `reports/dcc2-cli-delta-tests.md` | trailing whitespace. | 8 | 5-12 |
| `reports/dcc2-delta-correctness.md` | trailing whitespace. | 8 | 5-7, 17-21 |
| `reports/dcc2-delta-docs.md` | trailing whitespace. | 8 | 5-8, 16-19 |
| `reports/dcc2-delta-performance.md` | trailing whitespace. | 7 | 7-8, 15-19 |
| `reports/dcc2-delta-silent-failures.md` | trailing whitespace. | 9 | 5-13 |
| `reports/dcc2-delta-standards.md` | trailing whitespace. | 8 | 5-12 |
| `reports/dcc2-delta-tests.md` | trailing whitespace. | 8 | 5-12 |
| `reports/dcc2-final-delta-standards.md` | trailing whitespace. | 8 | 3-10 |
| `reports/dcc2-final-delta-tests.md` | trailing whitespace. | 8 | 5-12 |
| `reports/dcc2-history.md` | new blank line at EOF. | 1 | 130 |
| `reports/dcc2-m2.md` | new blank line at EOF. | 1 | 38 |
| `reports/dcc2-m3f-review-correctness.md` | trailing whitespace. | 8 | 3-5, 18-22 |
| `reports/dcc2-m3f-review-silent-failures.md` | trailing whitespace. | 8 | 3-5, 10-14 |
| `reports/dcc2-m3f-review-tests.md` | trailing whitespace. | 6 | 3-8 |
| `reports/dcc2-merge-preview.md` | new blank line at EOF. | 1 | 100 |
| `reports/dcc2-review-correctness.md` | trailing whitespace. | 19 | 7-9, 19-23, 32-36, 38-43 |
| `reports/dcc2-review-docs.md` | trailing whitespace. | 8 | 5-7, 9, 14-17 |
| `reports/dcc2-review-performance.md` | trailing whitespace. | 8 | 5-7, 14-18 |
| `reports/dcc2-review-silent-failures.md` | trailing whitespace. | 9 | 5-13 |
| `reports/dcc2-review-spec.md` | trailing whitespace. | 16 | 9-10, 15-18, 27-31, 33-37 |
| `reports/dcc2-review-standards.md` | trailing whitespace. | 8 | 5-12 |
| `reports/dcc2-review-tests.md` | trailing whitespace. | 8 | 5-12 |
