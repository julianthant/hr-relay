STATUS: COMPLETE
ROLE: sup_luna_dcc4_m3d_fixture (sole-writer TEST ADAPTER repair)
MODEL: sup_luna; high reasoning; budget 240k/220k
REASONING: The staged merge's adapter around tests/unit/server/explorer-edit-service.test.ts:273 implemented read, reconcilePending, and replace but omitted the required readAll member. The smallest faithful repair delegates directly to the backing store.
COMMITS: none (explicitly forbidden by dispatch brief)
FILES: tests/unit/server/explorer-edit-service.test.ts; docs/coordinator/worktree-completion/reports/dcc4-m3d.md
GATE: `VITEST_MAX_WORKERS=1 npx vitest run tests/unit/server/explorer-edit-service.test.ts --maxWorkers=1` — PASS; 1 file, 14 tests.
SCOUTS: none
NOTES:

Exact diff:
```diff
@@
     const store = {
       read: (workflowId: string) => backingStore.read(workflowId),
+      readAll: () => backingStore.readAll(),
       reconcilePending: (...args: Parameters<typeof backingStore.reconcilePending>) =>
```

INDEX: `git diff --cached --name-status -- docs/rebuild/reference/dashboard-surfaces.md tests/unit/server/explorer-edit-service.test.ts docs/coordinator/worktree-completion/reports/dcc4-m3d.md` shows the pre-existing staged dashboard doc plus this test (`M`) and report (`A`). `git diff --name-status` is empty (no unstaged tracked changes).
No production files, casts, assertions, fallbacks, lint, typecheck, or other gates were changed or run. Existing staged merge content was preserved, including the supervisor's dashboard doc correction.
