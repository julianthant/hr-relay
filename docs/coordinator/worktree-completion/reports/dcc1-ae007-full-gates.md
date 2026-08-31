# sup_sol_dcc1_ae007_frozen_full_gates — terminal gate receipt

2026-08-30. **STATUS: coverage GREEN; asserted parity RED; lane RELEASED; no commit.**
ROLE/MODEL/REASONING: same native `sup_sol` / Sol / high, assigned 240k/220k profile.
Sequential gate-only execution; no dispatch, source repair, reference update, staging or commit.
This is a failed full-gate candidate receipt, not product completion or permission to commit.

## Frozen identity and admission

Every command ran with workdir `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Branch `feature/r-dcc-dcc1-exclusive`; HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`;
ordered MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Complete index before and after both gates:
`ae00723e05d20a6c87d0ada500fc77a456870ea9`.
Execution closure before and after:
`d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051`.
No tracked working-tree delta, unresolved entry, source/reference delta, new commit or index change.
Both unstaged and cached diff checks exited 0 at preflight and postflight.

The coordinator's explicit OPEN in the assignment superseded the pending-allocation wording in
the fully read [queue handoff](../handoffs/2026-08-30-dcc1-f8b-frozen-gate-queue.md) and
[freeze](../evidence/dcc1-f8b-gate-freeze.md). `/ui` and the playwright-cli/playwright-tests
references routed rendered verification through the existing asserted project parity lane.
No manual browser session, general UI audit or UI/source edit occurred.
An initial lookup at `playwright-tests/REFERENCE.md` was absent; the actual linked
`playwright-cli/references/playwright-tests.md` was then read completely. That read-only lookup
failure was not a product gate or preflight failure.

[Preflight](../evidence/dcc1-ae007-preflight.json), session **98755**, exit **0**:
159 read-only subprocess receipts, 415 checks passed, 17:33:37.329Z–17:33:38.946Z.
It repinned every supplied blob/subtree, npm graph, installed lock, browser manifest/executable,
reference tree, legacy GUARD HEAD/status/three dirty-file hashes, freeze/handoff, packaging manifest,
all 40 plaintext/archive pairs, working/index/untracked inventory and absence facts.
Exactly 42 pre-existing untracked outputs were present: the 40 original plaintexts plus freeze and
queue handoff. Only `node_modules/` was ignored then; `.env`, `.auth`, `.tracker-rebuild` and `dist`
were absent. All seven new output paths were checked absent before creation.
Legacy reads were only the approved Git/guard metadata, never live authority or HR data.

## Exact commands and terminal results

Commands were spawned directly as `/usr/bin/lockf` with the following exact argument vectors,
serially, with independent nonblocking lock acquisition. `PARITY_UPDATE` was removed by `env -u`.

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:parity
```

| Gate | Tool session | UTC start → natural terminal | Gate / logger / wrapper exits | Actual result |
| --- | --- | --- | --- | --- |
| Coverage | 6021 | 17:33:58.010Z → 17:39:25.821Z | 0 / 0 / 0; signal null | 335/335 files, 3806/3806 tests; Vitest 326.42s; complete command 327.810404875s |
| Asserted parity | 15690 | 17:39:50.935Z → 17:43:30.417Z | 1 / 0 / 1; signal null | 227 passed, 12 failed of 239, one worker; Playwright 3.6m; complete command 219.457482542s |

Coverage: statements **84.53% (24959/29525)**; branches **74.86% (12891/17219)**;
functions **88.26% (5099/5777)**; lines **86.51% (23017/26606)**.
The existing command's coverage thresholds passed and its suite-size step ran:
unit 248 files/87129 lines; scenario 18/7124; architecture 69/22189.
Suite size describes itself as reviewed at phase exits, not a hard gate.
PDF, localStorage and React `act(...)` warnings remain in the raw output; no warning was
rewritten into a test failure or silently removed.

Between gates, session **69966** exited **1**, accurately retained in coverage metadata:
its unchanged-preflight ignored-inventory expectation saw `coverage/` added alongside
`node_modules/`. All other 407 checks matched. This was generated coverage output, not source,
dependency, reference, freeze or other execution-input drift. A separate assertion and annotated
classification receipt (tool chunk `a96a9d`, exit 0, 17:39:50.795Z) required exactly that one mismatch
and coverage gate/logger 0/0 before admitting parity. The original verifier exit and expectation
were not relabeled green. No source or test change was made to accommodate it.

No additional lint/typecheck was run in this gate-only lane. Fresh parent focused/typecheck/lint
proof is supplied by the frozen receive (parent session18205); no standalone test-without-lint
completion claim replaces that evidence.

## Named parity failures — observed output, not diagnosis

All 12 failures are at `tests/parity/dashboard-reference.spec.ts:474:9`, with
`a11y reference drift` thrown by `helpers/reference-store.ts:150` through the existing capture path.
Each cell below names one failed case; there were no other reported failing cases.

| Theme / viewport | Failed case | Failed case |
| --- | --- | --- |
| graphite-warm / 1280x720 | explorer-graph | explorer-transaction |
| paper-ink / 1280x720 | explorer-graph | explorer-transaction |
| graphite-warm / 1440x900 | explorer-graph | explorer-transaction |
| paper-ink / 1440x900 | explorer-graph | explorer-transaction |
| graphite-warm / narrow-1024x768 | explorer-graph | explorer-transaction |
| paper-ink / narrow-1024x768 | explorer-graph | explorer-transaction |

The reported first differing a11y line in each graph case is line150, region
`ucpath/search-person-org`, with implementation fingerprint **reference `fe99beff4f72` → actual
`843937a26347`**. Each transaction case reports line143, region `ucpath/read-job-summary`,
**reference `692804fed6ae` → actual `847db5229dea`**. These are the gate's observed differences,
not a claim that all remaining bytes match, that the references should change, or that their cause
has been diagnosed. A failing a11y capture does not prove its later screenshot assertions passed.
No reference update, timeout/assertion change, minimized reproduction, mutation or repair was run.

First-red notices went directly to parent and coordinator while session15690 remained running;
ownership was retained until natural terminal. **Immediately after terminal, before any postflight,
artifact inspection or report work**, successful app messages explicitly released both logical
heavy/light lanes to coordinator `01a04b28-14a3-7362-8778-4543583d9a16` and parent
`01a052ed-faf3-7a33-b0be-9fd404bc4cc6`, carrying command/session/exits/counts/timing/failures/raw hash.
`lockf` had exited; this unit held no OS lock. No lock probe/unlink or foreign process intervention
was needed or performed. Both gate sessions are closed; no follow-on gate was launched.

## Disk-first evidence and provenance

Inline Node logging exclusively created each log and metadata file (`wx`, mode0600).
Every child stdout/stderr chunk was fully written synchronously and `fsync` completed **before**
forwarding that chunk to tool transport. Child bytes are unmodified and merged in callback-arrival
order: per-pipe ordering is retained; no unsupported total ordering between separate pipes is claimed.
Raw files contain child output only, not wrapper receipt text. The in-process logger separately
records its own capture status; it is not a fictitious second logger subprocess.
Metadata start/spawn/terminal events include cwd, executable/args, intended environment changes,
source identity, PIDs, wall/monotonic timing, gate exit/signal, logger exit/errors and raw byte hash.
All metadata writes were also fsynced. Both logger statuses are 0 with empty error arrays.
Postflight recomputed raw sizes/hashes and matched the terminal records exactly.

Tool transport truncated portions of large coverage/parity output. The files below retain the full
raw bytes independently of that transport. JSON preflight/postflight and JSONL metadata are
**annotated structured receipts**, not raw child streams. This Markdown is a derived summary.
Prior F7/F8 normalized receipts and all historical verdicts retain their original provenance.

| Retained file | Bytes | SHA256 |
| --- | ---: | --- |
| [Preflight JSON](../evidence/dcc1-ae007-preflight.json) | 637675 | `0e9cde854ec1b5751fd9dd96c38e49439592d205f9ee308f6b91a336ea65e1f1` |
| [Coverage raw](../evidence/dcc1-ae007-coverage.raw.log) | 47416 | `cb32fc5f52e2f2421970983db7eb661d586533b412477b62ba1b188200923cc7` |
| [Coverage metadata](../evidence/dcc1-ae007-coverage.meta.jsonl) | 605778 | `eff9b4c97c8f0dc27b2801f6e335534407eb505e76af4d7e4e39a7168ad1fa48` |
| [Parity raw](../evidence/dcc1-ae007-parity.raw.log) | 75758 | `71ed0d442bf83354f447128b48b7006c4bfcac298c022357f908e55453218300` |
| [Parity metadata](../evidence/dcc1-ae007-parity.meta.jsonl) | 1786 | `cf979ecb695a40b980a7ad5d533584380c96039f89b32cdf5008110a18e4c771` |
| [Postflight JSON](../evidence/dcc1-ae007-postflight.json) | 905565 | `00b5c499f65d9459c58f82992d2a186c123b6430522943782581d39810388bd5` |

Primary execution tool receipts: preflight `512fa5` / terminal `e5ddf6`; coverage start `5b8684` /
terminal `71e69e`; between-gate `e140b0` / terminal `4a073c`; parity start `1a9498` /
terminal `e2158e`; postflight `dbf7fd` / terminal `dd3af5`.
Exact subprocess invocations and complete stdout/stderr strings for metadata repinning are retained
inside preflight/postflight, with between-gate capture in coverage metadata. Gate tool-session IDs
were assigned outside the child logger and are correlated here and in postflight.

## Postflight, bundle and preserved outputs

Postflight session **36114**, exit **0**, ran only after release:
17:44:06.245Z–17:44:08.014Z, 159 read-only subprocess receipts and 414 passing checks.
All frozen identities, dependency/browser/legacy GUARD pins, references, all 40 original bytes and
archive bytes/index identities/roundtrips matched. The full freeze/handoff hashes also matched
preflight. Neither original plaintexts nor their archives were moved, rewritten, staged or deleted.
The old0b5 coverage failure and its raw SHA256 `6db1a56603ad76aa3b859445e315a76ee2b1701bbb23ac72d5b573dd6de311e8`
remain unchanged historical evidence, not overwritten by this green coverage run.

Postflight explicitly distinguishes generated ignored `coverage/`, `dist/` and `tests/parity/.output/`
from the unchanged `node_modules/` dependency root; there is no ignore/config edit.
It inventories 653 coverage artifacts and 15 parity artifacts (12 error-context Markdown files,
`.last-run.json`, two observed-log screenshots) with exact path/size/SHA256. These remain in their
original generated locations. No images were manually opened or modified; no generated artifact
was promoted into a reference. The six new evidence files and this report remain untracked.

The existing parity helper built the previously absent bundle itself, not by a manual build command.
Its preserved stamp is `dist/dashboard/parity-build-stamp.json` (266 bytes), SHA256
`20773190626ec0f7bbc914f46c00d5610a0cc1aa58735eef25e27ca43286246e`:

- `stampVersion: 1`, `buildScript: web:build`, `builtAt: 2026-08-30T17:39:58.194Z`.
- Input digest `f3b154df374d21e1f107ba31219ef339e2747c0aab53ee89aef127950c06dae4`.
- Output digest `87f1d808ff832b32a1a6ddfb4a99c7088e91bbea7ccd660fbdc21c1c888d5be7`.

Read-only postflight recomputation used the existing helper's sorted relative-path/NUL/file-SHA/LF
recipe over all600 input files and91 emitted files, excluding only the stamp from output digest;
both matched. Full input/output file hash inventories are retained in postflight. No bundle
freshness claim substitutes for the failed asserted references.

## Return boundary / limits

COMMITS: none. Explicitly owned outputs: the six linked evidence files and this report only.
Product, tests, AGENTS, guard, reference bytes, migrations, D75 semantics and all other reports are
untouched. Fresh raw logs are not covered by the earlier 40-file archive grant and remain raw.
No live workflow/state/auth provisioning, board write, new worker/tree, remote push or cleanup.
No owned gate process remains; postflight commands also exited. Foreign process state is not
claimed. The parent receives these exact raw/metadata receipts; diagnosis, repair, reference
disposition, re-review/reallocation, final gated commit, archive durability and shared integration
remain parent/coordinator decisions. Cross-run migration collision/deployment uncertainty and D75
final-join residue remain open and unchanged. **No globally green readiness or commit approval.**
