# R2 cleanup and retained-artifact inventory

Verified 2026-08-30 in `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild`. No foreign worktree or browser fleet was cleaned. No remote push.

## Removed owned subunit

| Target | Verified state / disposition |
|---|---|
| `/Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final` | Clean tip `7b05b0571b9af7a75f24c40bb553bb36addccbdd`, ancestor of reviewed `--no-ff` merge `54060ded`; removed with ordinary `git worktree remove` only after parent full gates passed. |
| `feature/r2-u1-parity-final` | Deleted with `git branch -d` after removal; code, references and report remain recoverable in merge ancestry. |
| Child final parity artifacts | Preserved under `docs/coordinator/worktree-completion/evidence/r2/child-parity/` before removal. |
| Child remaining ignored directories | Only reproducible `coverage/`, `dist/`, `node_modules/`; removed with the child. No assigned HR authority, credentials or auth profile was present. |

## Parent retained — coordinator-owned removal

The R2 parent is retained. Its current ignored inventory includes `.playwright-cli/`, `coverage/`, `dist/`, `node_modules/`, and `tests/parity/.output/`. Gate logs and child fixture evidence are committed. The generated dependency/build/coverage/parity directories are reproducible; **the four pre-existing browser diagnostic files below are NOT classified as disposable**.

Per the coordinator's explicit instruction, only relative filenames, byte sizes, and SHA-256 digests were recorded. File contents were neither displayed nor copied, and files remain untouched in place. They predate this recovery (August 29). The coordinator will retain the parent until integrated acceptance and explicit evidence preservation.

| Relative filename | Bytes | SHA-256 |
|---|---:|---|
| `.playwright-cli/console-2026-08-29T07-23-05-546Z.log` | 291 | `37669c13d5502a839a244d9b76de65cf3425950ef57e738abf54af015b06c1d3` |
| `.playwright-cli/page-2026-08-29T07-23-05-753Z.yml` | 2,576 | `960bd8aad29cbb41a145534aafb570fdcfbb87ce931dd94a6835a6801dd47d26` |
| `.playwright-cli/page-2026-08-29T07-23-11-805Z.yml` | 10,230 | `9cee72cc8978387c91faa782f10fc658c6b7fff638c47ade3655a62efb34511b` |
| `.playwright-cli/page-2026-08-29T07-23-12-999Z.yml` | 11,244 | `a57be516430c6064f92b526b12c4efe11551a82b7fbe68f03e34ced479d4df08` |

Verification used `stat -f '%N %z'` and `shasum -a 256` against those four explicit paths only. No contents entered reports or git.

## Other retained recovery material

- The original three recovery/decision documents are committed at `15623402`; detailed original attribution remains available at its established paths.
- Two pre-recapture fixture PNGs remain at `/tmp/r2-p2-archive-parity.YvibtW/`; this path was not removed. The committed final reference pair is `50007d66`.
- No `.env`, `.tracker-rebuild`, `.auth`, or `.auth-rebuild` was present at final operational inventory. No runtime provisioning, copying, migration, or browser action is authorized by this cleanup report. No further runtime actions follow the coordinator's stop direction.
- All other repository worktrees and the existing R2 source branch remain under coordinator ownership. No global worktree prune was performed.
