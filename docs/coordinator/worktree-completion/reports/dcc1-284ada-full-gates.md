# sup_sol_dcc1_284ada_frozen_full_gates

## Status and binding

PASS — both required read-only freshness checks, full coverage, and full asserted parity completed with gate/logger/wrapper exits **0/0/0**. This is a gate receipt for the frozen candidate, not a product commit or shared-integration completion.

Role/model/reasoning: existing native `sup_sol` / Sol / high, assigned 240k/220k profile; no new worker, task, worktree, or reviewer. The inherited tool role/task-name schema limitation is unchanged. Commits: **none**. Staging: **none**.

Every shell command used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1` as cwd. Only owned coordination artifacts and authorized generated gate/preservation outputs were created. No source, test, configuration, reference, migration, history, or parent-report edits.

| Candidate fact | Exact value |
| --- | --- |
| HEAD | `0c115123a738f62cbe01c9b45f53b7289284479c` |
| MERGE_HEAD | `13175b13340fec7b5326207fe54f98078d481d7d` |
| Complete index | `284ada7ef313321287eb3f8cd6c28813ecf7a81c` |
| Ordered execution-closure SHA256 | `d4002cf5ac793cc7fdf7050a6102d4a5fd7735c0ef39294353a843ef12070e9a` |
| Reference subtree | `34d7c96e0f10154ea10e7d56475988a850debbe1` |
| Working capture.ts | `641378037d2396a6e84003115a5f158f178e17c7` |
| Architecture test | `6bdebc160f537079eeea8c4db6369ad1069ab9e1` |
| Reference store | `58fec850d0e0140b6ab45fb8fb341d940a16d44f` |

All 1,923 non-coordination tracked inputs matched the complete index; all 603 reference files remained exact. Parent's prior staging of the twelve reviewed a11y references changed their indexBlob fields from ae007 to 284ada, not their already-reviewed working bytes or actual d400 execution closure. Only parent-owned `reports/dcc1.md` remained tracked unstaged. Both diff checks and the unmerged check returned zero.

## Exact commands and results

Commands ran serially, each once. Freshness scripts were read before execution: their `--check` branches compare in memory/read-only; no regeneration was invoked.

```sh
npm run build:manifest:check
npm run roadmap:check
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:parity -- --output=tests/parity/.output/dcc1-284ada-full-parity-01
```

| RUN_CONFIG | Native session; launch → terminal tool chunk | UTC start → end (2026-08-30) | Elapsed seconds | Gate/logger/wrapper | Actual result |
| --- | --- | --- | --- | --- | --- |
| manifest | 65481; aa01f6 → c04984 | 19:45:49.114 → 19:45:50.756 | 1.642975292 | 0/0/0 | generated-build-manifest.ts is current |
| roadmap | 75747; 67d082 → 19a817 | 19:46:01.292 → 19:46:01.709 | 0.419797166 | 0/0/0 | roadmap/index.html is fresh |
| coverage | 79293; 22dee5 → 156173 | 19:46:08.226 → 19:51:19.604 | 311.415849458 | 0/0/0 | 335 files, 3,806 tests passed |
| parity | 69502; 62ba7b → cfb975 | 19:52:55.894 → 19:56:14.828 | 198.934327708 | 0/0/0 | 239 tests passed using one worker |

Coverage's Vitest duration was 310.09s; wrapper elapsed also includes the existing suite-size script. Statements 84.53% (24959/29525), branches 74.86% (12891/17219), functions 88.26% (5099/5777), lines 86.51% (23017/26606). Suite-size output: unit 248 files/87129 lines, scenario 18/7124, architecture 69/22189. Ordinary PDF, experimental localStorage, React act, and color-environment warnings remain in the raw logs; they are not suppressed or reclassified as failures.

This was the entire asserted parity suite: no grep, observer, supplemental harness, update switch, mask, threshold, wait, assertion, or reference change. All twelve Explorer graph/transaction cases passed within that full run. Earlier red gates and diagnostic observations remain historical, immutable evidence, not relabeled passes.

## Direct raw logs and metadata

Each child stdout/stderr buffer was written and fsynced before tool transport. Raw files preserve the bytes received from both streams in arrival order (not separate-stream timestamps). Annotated JSONL records separately retain exact command/args/env/cwd, full contemporary 1,923-input map, ordered closure stream, dependencies, stamp, prior gate receipts, spawn PID, and true terminal gate/logger exits. Raw and metadata files were exclusively created with mode 0600. Native wrapper exit receipts are separately retained in postflight JSON; tool-rendered output is not called raw.

- **manifest**: [raw](../evidence/dcc1-284ada-manifest.raw.log), 162 bytes, SHA256 `1746f0c03e199925381c274f5c9e72134e36b5068dacc7450271b8167a86e8d0`; [metadata](../evidence/dcc1-284ada-manifest.meta.jsonl), 771979 bytes, SHA256 `3e596a7413c5aae3de6980288de30a73512e3b30e19d2f7021e77bb2136c6c53`.
- **roadmap**: [raw](../evidence/dcc1-284ada-roadmap.raw.log), 122 bytes, SHA256 `5f1fc3bf701099ca19ea3a53dbb9c5f686c1f79210542607773331a523270f37`; [metadata](../evidence/dcc1-284ada-roadmap.meta.jsonl), 773198 bytes, SHA256 `53d8ccc2c1f84ddb3dae6824211dd6869c03847b895b1109fdabe39a37fed91c`.
- **coverage**: [raw](../evidence/dcc1-284ada-coverage.raw.log), 47416 bytes, SHA256 `43d815e38ccfd07c883d1ec82a5a08d9a3ed62820e886b61f190d2c3abc8c4d1`; [metadata](../evidence/dcc1-284ada-coverage.meta.jsonl), 774873 bytes, SHA256 `9be80c58a605ac314411be61ffc8ccfefb22d70e4c54f3b3b7845689970e30cb`.
- **parity**: [raw](../evidence/dcc1-284ada-parity.raw.log), 29683 bytes, SHA256 `fdf87ec7651676c273a52b1105cd369a452c64980bfc8c15282e80cc02997a3c`; [metadata](../evidence/dcc1-284ada-parity.meta.jsonl), 890233 bytes, SHA256 `139aaa6f62a30ef9c09bd435b61d34557298005c5b49bb2e29e917d4937e9798`.

The coverage terminal tool chunk was transport-truncated; its complete 47,416 raw bytes were already retained on disk. The original preflight 47028/55e892 exited 0 but its large tool response contained a transport omission, so it could not be parsed. A compact-output read-only preflight 7a6025 exited 0 with every predicate retained and complete inventory retained in the artifact. Neither event is a product/gate failure. The original truncation receipt and exact compact script are explicitly recorded, not represented as a complete raw transcript.

## Admission, preservation, and postflight

The scoped parent receive was fully read and pinned: report SHA256 `121c02b45d9790830567e35836b4457214dfdef944a86736726a4b06726e6d3a`, JSON `9f3151f408d41ca37ee00253a5a970b311f3b87e58a0c336539b0c9ba9e0f16f`. Existing Spec review Count0 is parent evidence, not a new worker review.

Preflight verified exact current 410 Git-visible entries (parent's 408 plus its two explicitly declared receipts), all retained inputs, source/index, reference bytes, dependencies, browser and guard-only legacy metadata. No live legacy authority/auth/HR state was read.

Before coverage could regenerate outputs, exclusive preservation session 47278 (05d961 → 987163, exit0) copied all 653 pinned old coverage files to `evidence/dcc1-284ada-coverage-preserved/<original repo-relative path>`. Each file was regular/non-symlink, copied without overwrite, fsynced, and verified byte/hash/mode-equal; physical walk equaled the exact manifest. All 653 are ignored by the existing `.gitignore:41 coverage/` rule; that is derived provenance, not a visibility/count exemption. No ignore/config changes were made. Original outputs were untouched by copying; the subsequent ordinary coverage command was authorized to regenerate them.

The older 112-copy preservation root was verified in place, not recopied or cleaned. Original forty plaintext artifacts and archives, historical raw/meta, 84 diagnostic observations, prior runners and retained bundle/stamp stayed exact under their pinned manifests. The new 653 generated coverage outputs are inventoried in preparity JSON and stayed unchanged through parity; they are not falsely required to equal old generated output bytes.

Fresh preparity session 63899 (53aa31 → 3bf89a, exit0) reverified coverage gate0/logger0/raw identity, candidate, dependencies, both physical preservation roots, and exclusive parity paths before spawning. Postflight session 15722 (be7b9e → a46c82, exit0) verified the same at **2026-08-30T19:56:26.977Z**, after terminal RELEASE.

Exact inventory relation remains `GitUntracked = O ∪ R ∪ (C − I)`, with unique/disjoint sets, actual byte/hash/mode checks, and I derived only from exact C using Git ignore provenance. Postflight's pre-artifact boundary has O278, R124, C765, I745, visible C−I20, hence 422 Git-visible / 1,167 physical declared files. This postflight artifact and this report are the only remaining declared additions at that boundary; their subsequent hashes are measured after creation, without self-hash recursion. Counts summarize verified sets, not policy or broad exclusions.

## Build/dependency and actual output provenance

Installed npm graph (`npm ls --all --json`, exit0): 136478 bytes, SHA256 `3d0dc25a77748026d1d6d56a127245cdc89499a81ccb3e48b60140fe444f74df`. Installed lock `7748ec1b028a665a821e3e718be6d637dc15aa881701cb4c7fecf435e4e8074a`; browser manifest `ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942`; Chromium headless executable `11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3`. Exact paths, sizes, modes and guard-only legacy HEAD/status/three dirty-file pins are in preflight and gate metadata.

Bundle stamp remained byte-identical: 266 bytes, SHA256 `20773190626ec0f7bbc914f46c00d5610a0cc1aa58735eef25e27ca43286246e`; original builtAt `2026-08-30T17:39:58.194Z`. Input digest (600 files) `f3b154df374d21e1f107ba31219ef339e2747c0aab53ee89aef127950c06dae4`; output digest (91 files) `87f1d808ff832b32a1a6ddfb4a99c7088e91bbea7ccd660fbdc21c1c888d5be7`. Existing stamped bundle was reused; this report does not invent a fresh build timestamp.

The new full-parity runner contains exactly three retained files:
- `tests/parity/.output/dcc1-284ada-full-parity-01/.last-run.json`: 45 bytes, mode 0644, SHA256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.
- `tests/parity/.output/dcc1-284ada-full-parity-01/observed-log-ui-observed-l-42cf0-ble-and-contained-at-mobile/observed-log-mobile.png`: 64158 bytes, mode 0644, SHA256 `0a14bb2bb6a81c9b162652ae84ca49096450f44db36daf4a61a39177dfb61d76`.
- `tests/parity/.output/dcc1-284ada-full-parity-01/observed-log-ui-observed-l-9d7f3-le-and-contained-at-desktop/observed-log-desktop.png`: 175099 bytes, mode 0644, SHA256 `36eeec6f88ef9f3b4371cc84f96822d301aa1a1b118ccf8d512dc009237c79af`.

No failure snapshots/error contexts were generated. No extra manual browser review was performed by this gate worker. The two saved observed-log PNGs are ordinary test artifacts; the evidence of asserted reference acceptance is the executed complete parity gate, not an invented saved image for every passing case.

## Durable artifact map

All paths below are under the assigned coordination workspace. Complete execution scripts, inventory maps, receipts and hashes are retained; no new product helper was added.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| [dcc1-284ada-preflight.json](../evidence/dcc1-284ada-preflight.json) | 1056129 | `4b8c76ba2c5293e47d4b68f9c693a8f3e19f6fa606f50dc12ea207c4eef666f9` |
| [dcc1-284ada-command.json](../evidence/dcc1-284ada-command.json) | 17837 | `c7f536575be7d76360a5aaded581ebf451347e83096136018083881964cef880` |
| [dcc1-284ada-preservation.json](../evidence/dcc1-284ada-preservation.json) | 431597 | `e489a8f9ce8b148e823a72643ec756bf20fd1a3cc0d10c3eefa5070c63f913ee` |
| [dcc1-284ada-preparity.json](../evidence/dcc1-284ada-preparity.json) | 1209461 | `09d4a2c2d0ce78a991495e0de910ae037cf15f223b53496d244da4918f5a2841` |
| [dcc1-284ada-postflight.json](../evidence/dcc1-284ada-postflight.json) | 1386314 | `138e7f0153fd947e7af48409327303f5d475e0c6fbad4d01c413ad91adfe9a17` |

In addition: eight raw/meta files linked above; exact 653-file preservation manifest/root; this report; and the three unique normal parity-runner files. The two explicit read-only freshness checks are the only added check family; no fresh lint/typecheck was requested or run. Historical unchanged-code light results remain attributed to their original executions.

## Release, limits, and handoff

Immediately on parity terminal cfb975, before postflight or report work, actual RELEASE was delivered through the app to parent `01a052ed-faf3-7a33-b0be-9fd404bc4cc6` and coordinator `01a04b28-14a3-7362-8778-4543583d9a16`. Both lockf commands and their loggers exited naturally; no lock unlink, kill, spin, retry, concurrent owned light gate, or NEXT reservation. All owned gate processes have exited. Any later coordination work is evidence packaging/read-only verification, not retained gate ownership.

No product/source/reference repair was needed or authorized. No stage or commit. Parent must receive this exact candidate-bound evidence before its commit decision; commit hash movement alone does not justify rerunning an unchanged execution tree. Migration/D75 cross-run compatibility and final shared integration remain outside this gate receipt; see preserved dcc1-migrations and coordinator disposition evidence. No global compatibility or deployment claim is made.
