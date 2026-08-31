# Branch and worktree audit — 2026-08-31

Read-only `/worktree-sweep` phase 1 at root commit `094e9a272272e62ba5bfd0b0a2ee50b73f2b7963`.
No branch, worktree, file, process or Git reference was changed by this audit.

The repository has **12 local branches and 8 registered worktrees**. The earlier coordinator phrase
“five branch-local software returns” counted only clean accepted returns; it was not a complete
branch/worktree count.

| Path / branch | HEAD | Ahead of `integration/03b` | Worktree state | Bucket / disposition |
|---|---|---:|---|---|
| root / `master` | `094e9a27` | n/a | clean | coordinator main; keep |
| `integration/03b` | `13175b13` | 0 | no worktree | shared integration target; keep |
| `integration/03a-final` | `b4f62720` | 0 | no worktree | already merged into master and 03b; cleanup candidate only after final sweep |
| `codex/r-dca-dashboard-artifacts` | `7a85bbd5` | 16 | no worktree | retained DCA1/DCA3 source history; active dependency for DCA2/DCA4; keep |
| `codex/r-dcf-dashboard-fidelity` | `cf9884a9` | 4 | no worktree | **unmerged-with-work**: four unique Run modal commits; receive/review in a new isolated worktree |
| `codex/r2-4537-controlled-close` | `63142ae7` | 53 | clean | accepted software; live residue; later serial integration |
| `codex/r-dcr-authority-close` | `8839fddb` | 183 | clean | accepted reporting software; D290 primary suffix; later serial integration |
| `feature/r-dcc-dcc1-exclusive` | `d65d38d5` | 64 | clean | accepted Settings software; D290 suffix normalization; later serial integration |
| `feature/r-dcc-dcc2-exclusive` | `c9af958a` | 72 | clean | accepted preflight/storage software; later serial integration; display residue retained |
| `feature/r-dcc-dcc4-exclusive` | `68386456` | 48 | clean | accepted Explorer software; D290 superseded-schema disposition; later serial integration |
| `feature/dca2-screenshot-gallery` | `eda17b27` | 8 committed | 47 dirty entries | active D291 receive/implementation; do not sweep |
| `feature/dca4-archive-evidence` | `eda17b27` | 8 committed | 54 dirty entries | stopped A10/D292 candidate awaiting D291 return; do not sweep |

## Unmerged branch-only finding

`codex/r-dcf-dashboard-fidelity` contains four commits absent from every other local branch:

1. `e52a22fe` — remove per-start destination.
2. `0972b056` — freeze the destination-free Start Run surface.
3. `376a2675` — preview the workflow path before start.
4. `cf9884a9` — freeze the Start Run workflow timeline.

The range changes 70 files, largely Start Run code, backend bootstrap projection, tests, owner docs
and deliberately refreshed parity references. It is real feature work, not a stale-empty branch.
It lacks a current coordinator receive, so it must be reviewed and gated before integration.

## Parallelism disposition

- DCA2/D291 remains the active artifact lane.
- R-DCF Run modal receive is parallel-ready in a separate worktree: it shares no mutable checkout or
  report path with DCA2. Full gates remain serialized through the existing lock.
- The five clean accepted returns are not five safe parallel merges. They overlap migrations,
  `authority-database.ts`, dashboard composition/routes and shared tests. DCR/DCC1/DCC4 also carry
  the D290 migration-history collision. They form one serial integration run after the Run modal
  receive establishes its exact integration position.
- DCA4 must remain stopped until DCA2 returns the shared D291 implementation.

No cleanup phase is authorized or attempted. `integration/03a-final` is the only presently
already-merged branch candidate; retaining it until final integration costs little and preserves a
clear phase boundary.
