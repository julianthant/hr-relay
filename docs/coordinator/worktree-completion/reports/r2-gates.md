# R2 gate evidence

## Pre-integration lightweight gate

2026-08-30, parent `3e12b3e0`; assigned workdir `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild`.

```sh
npm run typecheck && npm run lint && npm run build:manifest && npm run roadmap:check && git diff --check && git status --short
```

Exit 0. TypeScript and zero-warning ESLint passed. Manifest regenerated without a tracked change; `docs/roadmap/index.html is fresh.` Whitespace check passed; status empty. Evidence: supervisor execution session `85018`.

## Shared resource admission

The first p2 nonblocking parity-update lock attempt returned `already locked`; no test ran and no pass is claimed. Both temporary PNG removals were restored byte-identically. Coordinator subsequently reserved the next logical R2 slot after root coverage, retaining the required OS lock for every parity/coverage command. The final integrated-tree outcomes appear below.

## Child assertion and integration

Child final HEAD `7b05b0571b9af7a75f24c40bb553bb36addccbdd`, clean. Worker supplied exact commands:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock sh -c 'cd /Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final && npm run test:parity:update -- tests/parity/dashboard-reference.spec.ts --grep "archive-version-bump @"'
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock sh -c 'cd /Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final && npm run test:parity'
```

Worker terminal evidence: update `2 passed (6.6s)`; successful assert execution session `3344`, exit 0, `239 passed (3.2m)`. A prior attempt lacked a retained completion and is not accepted as evidence. Supervisor independently read the final child `tests/parity/.output/.last-run.json`: `{"status":"passed","failedTests":[]}`, verified four child commits and clean status, and directly inspected both new Archive PNGs. A later worker note describing stale failed metadata conflicts with that actual read and is not used; the observed final file is preserved verbatim under `evidence/r2/child-parity/.last-run.json` with its two fixture-based observed-log screenshots.

Independent Spec/UI review covers all 437 reference paths with zero findings. Supervisor merged `--no-ff` at `54060ded8eaa7263f0e95c468ad9b00e681b242c` (parents `821baccd`, `7b05b057`), verified child-tip ancestry, and ran its own integrated-parent coverage plus lightweight checks. After the complete parent gate, including assert-mode parity, the clean merged child and its branch were removed; see [cleanup inventory](r2-cleanup-inventory.md).

## Integrated parent gate — 54060ded

All commands explicitly ran in the assigned parent, with `set -o pipefail` when piping to the preserved log.

```sh
npm run typecheck && npm run lint && npm run build:manifest && npm run roadmap:check && git diff --check && git diff --exit-code -- src/domain/workflow/generated-build-manifest.ts
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage
```

- Lightweight chain: exit 0, source manifest unchanged, roadmap fresh. [Raw log](../evidence/r2/parent-lightweight.log).
- Coverage: exit 0; **341/341 files, 3,761/3,761 tests**; duration 857.32s. Statements 84.6%, branches 74.83%, functions 88.21%, lines 86.54%. Suite-size report completed: unit 254 files/85,231 lines; scenario 18/7,142; architecture 69/23,878. [Raw log](../evidence/r2/parent-coverage.log).
- Runtime warnings in coverage (PDF parsing, Node localStorage, React act environment) are retained in the log; no tests failed and no threshold was altered.
- Final parent assert-mode parity: **239/239 passed (6.3m), exit 0**, execution `1722`. [Raw log](../evidence/r2/parent-parity.log). Exact command:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity
```

The R2 logical heavy-gate slot was explicitly released to the coordinator immediately after parity completed. No full/focused Vitest run was added outside serial admission. Future focused Vitest requires `VITEST_MAX_WORKERS=1`; future full-repo lint/typecheck requires `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock`, one light command at a time, per the updated profile. R2's already completed lightweight checks were not canceled and remain valid.

## Post-documentation verification

The following focused command ran serially with one worker in the assigned parent; each run exited 0 with **2 files / 29 tests passed**. The three focused logs omit only the terminal's final extra blank line; all result text is retained:

```sh
env VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/architecture/test-target-registry.test.ts --reporter=dot
```

| Tested HEAD | Execution | Evidence |
|---|---|---|
| `05247b9bc640e894795fe2fe99cdb3e29cde4bdc` | `73374` | [Post-doc log](../evidence/r2/post-doc-guards.log) |
| `72e13b34a0e43f1674c2bb19f9d34e29e936dcef` | `43115` | [Post-review log](../evidence/r2/post-review-doc-guards.log) |
| `e3cca014f846e5cf664ace464a97012bb485c93e` | `17312` | [Final doc log](../evidence/r2/final-doc-guards.log) |

At final substantive HEAD `e3cca014`, `npm run roadmap:check` passed and the following comparison exited 0 with no output:

```sh
git diff --exit-code 54060ded8eaa7263f0e95c468ad9b00e681b242c..HEAD -- src tests scripts config package.json package-lock.json
```

Thus the full coverage, parity, lint, typecheck and manifest proofs still cover the unchanged executable/test/reference closure. Later changes are owning documentation, generated roadmap and recorded evidence only; the focused guards cover the changed document bindings. No heavy gate was reacquired and no threshold or timeout changed.

Final range hygiene is reported precisely: unrestricted `git diff --check 6f79b4457ae8e54407ac81c9503b03937abd7430..HEAD` exits 2 solely for 413 padding lines in the verbatim `evidence/r2/parent-coverage.log` table. The raw evidence is intentionally not rewritten. The same command excluding that exact raw log exits 0; staged and working-diff checks pass. This is a terminal-log formatting exception, not a product gate pass falsely attributed to the unrestricted command.
