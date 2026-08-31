# DCC1 frozen pending-merge gate input

2026-08-30. Readiness snapshot; coverage/parity are **not yet run**. This file is
an evidence output, not part of the frozen index or an execution input.

**Readiness held before any heavy gate:** coordinator comparison found a missing
synthetic Duo injection seam relative to approved845ca5a1. Existing native F7 unit
must first reproduce the focused composition failure, then only the conditionally
authorized exact seven additions may land. This identity remains historical;
renewed readiness requires a new tree/closure, checks and independent reviews.

F7 subsequently produced a **different** red: missing dashboard-activated runtime
generation, before Duo construction (worker and parent both2failed/6passed).
The conditional seven-line patch was withheld; source and this historical executable
closure remain unchanged. Coordinator disposition is required before broadening repair.
See `../reports/dcc1-f7.md` and the candidate review ledger for exact receipts.

## Git identity

- Workdir: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
- Branch: `feature/r-dcc-dcc1-exclusive`.
- First parent / HEAD: `0c115123a738f62cbe01c9b45f53b7289284479c`.
- Ordered second parent / MERGE_HEAD: `13175b13340fec7b5326207fe54f98078d481d7d`.
- Complete frozen index tree: `488fecfabb40df072c4294800b07c3771ba1a20e`.
- Unresolved entries: none. Unstaged tracked changes: none. Untracked files at
  freeze: none. Ignored content: `node_modules/` only; no `.env`, Settings files,
  runtime authority or browser profile in the assigned checkout.

| Frozen subtree | Git tree |
|---|---|
| src | `542ea7d2e8a82fa15ca3b11baf037006fad1b18f` |
| tests | `6fd60bb9d2d83d8934bbb28ad312524036a4e6b1` |
| config | `bb97f70db688e07cdfcc9995890f574274031b98` |
| scripts | `be8b9264a6e8c48ae3d1573f490e11f0a92743a8` |
| docs/rebuild | `ae76371bccc96e5deacaa6c9873d600e57c180ed` |
| docs/roadmap | `075dab18c9f3245a0ff5a04d04c8b6f4e9edfc31` |

The SHA-256 of the complete recursive Git listing, excluding only this run's
`docs/coordinator/worktree-completion/{reports,evidence,handoffs}/`, is
`8670eaea27bfc6eb00848eaa1ea1dbaeda11279169c8b6e2986614cca30ac7b9`.
Canonical docs, AGENTS, all product/test/config/reference files and root tooling
remain included. No source/test/script references this coordination workspace.

```sh
set -o pipefail
git ls-tree -r --full-tree 488fecfabb40df072c4294800b07c3771ba1a20e | rg -v $'\tdocs/coordinator/worktree-completion/(reports|evidence|handoffs)/' | shasum -a 256
```

## Nontracked execution dependencies

- Node `v26.1.0`, npm `11.13.0`, macOS `26.5.2`.
- Installed `node_modules/`: `npm ls --depth=0` exit0. Principal tools:
  TypeScript5.9.3, ESLint10.8.0, Vitest/coverage-v8 4.1.10, tsx4.23.1,
  Vite8.2.2, Playwright1.61.1, React19.2.8, zod4.4.3.
- Tracked package-lock Git blob: `ee52d301c65cb2938eb41f4decd0d3cb50383ab1`.
- Complete installed dependency graph (`npm ls --all --json`, exit0) SHA-256:
  `3d0dc25a77748026d1d6d56a127245cdc89499a81ccb3e48b60140fe444f74df`.
- Installed `node_modules/.package-lock.json` SHA-256:
  `7748ec1b028a665a821e3e718be6d637dc15aa881701cb4c7fecf435e4e8074a`.
- Playwright browser manifest SHA-256:
  `ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942`.
  Chromium/headless-shell revision1228, version149.0.7827.55. The external cached
  binary `/Users/julianhein/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`
  has SHA-256 `11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3`.
- Guard-only legacy data root: `/Users/julianhein/Projects/hr-automation`, HEAD
  `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. It is not a clean external checkout;
  existing tracked dirt below is read-only and is neither copied nor modified:

| Existing legacy path | SHA-256 of observed bytes |
|---|---|
| config/rebuild/legacy-change-accounting.json | `418e0f44ea4aa56f9849d3e392f3f0aef60f40111d52c5ff305c6415faafa93c` |
| config/rebuild/legacy-preservation.json | `e26deafbd20eba9e697df4068c0e1b2ec55de286e530898d36f6fe54dedf2a6a` |
| tests/unit/systems/ucpath/selectors.test.ts | `217deb94a06516e3b12844b1e6380a702fa9b093f6a10577714228fe642d5f54` |

These hashes record observed dependency identity, not an assertion of control
over the external checkout or universal deployment evidence. No live state was read.
Every Vitest invocation explicitly sets `VITEST_MAX_WORKERS=1` and the legacy root.
Parity will explicitly unset `PARITY_UPDATE` with `env -u PARITY_UPDATE`, following
the coordinator's queue instruction; no reference update is authorized by readiness.
Generated coverage, dist/build stamps, test outputs and gate logs are
outputs, not newly authored execution inputs. Existing reference/buildstamp
validation remains enabled.

## Passed pre-heavy checks

- Parent four-file Settings/BFF/client suite107/107 at08:14:51, exit0.
- Parent reader/BFF/capture/compose suite97/97 at08:22:27, exit0.
- Parent worker suite33/33 at08:28:51, exit0.
- Parent kernel suite41/41 at08:35:23, exit0.
- `npm run build:manifest` and `npm run build:manifest:check`: exit0; no manifest
  byte change. `npm run roadmap` and `npm run roadmap:check`: exit0; generated
  index1259619bytes, fresh. The generated two-line substitution is staged.
- Parent `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck`:
  session45236 exit0; `tsc --noEmit`, no diagnostics.
- Parent same lock plus `npm run lint`: session10438 exit0; zero-warning ESLint,
  no diagnostics. No other owned gate process remains active.
- `git diff --check`, `git diff --cached --check`: exit0. Every selected final
  review axis is closed; exact independent receipts are in the review ledger.

## Freeze and commit rule

No product/test/config/reference/canonical-doc input changes through allocated
gates. Gate logs, final reports and consumed recovery-handoff deletion are separately
identified evidence-only changes. Any meaningful input change requires affected
re-review/regating and coordinator allocation. Before/after commit, compare the
complete tested tree and the closure digest above, enumerating every exception.
The coordinator explicitly confirmed this binding satisfies pre-commit sequencing;
an otherwise unchanged tree gaining a commit hash does not require duplicate gates.
Shared migration-history and D75 joins remain coordinator-owned/unapproved residue.
