# sup_sol_dcc1_durable_evidence_closeout

## Result and boundary

Prepared and verified **40 new lossless archives**: 36 new raw logs and four exact historical Markdown files whose preserved bytes trigger `git diff --check`. Originals are untouched. No JSON, clean report, source, reference, test, configuration, AGENTS, historical receipt, or handoff was rewritten.

Role/model/reasoning: same native `sup_sol` / Sol / high, assigned 240k/220k; no spawned unit. New commits/staging/gates/browser/live work/moves/deletions: **none**. Parent owns staging, commits, and `reports/dcc1.md`; that exact mutable path is excluded from stable-byte expectations, not the reports directory.

Parent's tested product merge is verified as:

- commit `a67c4e1bbd0a16e11370539f01a59772c6a0be35`;
- complete tree/index `284ada7ef313321287eb3f8cd6c28813ecf7a81c`;
- parents `0c115123a738f62cbe01c9b45f53b7289284479c`, `13175b13340fec7b5326207fe54f98078d481d7d`;
- execution closure `d4002cf5ac793cc7fdf7050a6102d4a5fd7735c0ef39294353a843ef12070e9a`.

The product merge already contains the prior 40 archives and their original manifest. The **new** archives/manifest/report are not committed yet: this is a durability preparation receipt, not a claim that parent acceptance or evidence commitment has occurred.

## Exact outputs and stage proposal

- [Inventory](../evidence/dcc1-closeout-inventory.json): complete pre-archive 427 Git-visible files, hashes/modes/blobs, exact target reasons, all physical retention files, output declarations, full proposed move and stage lists.
- [Manifest / historical-path resolver](../evidence/dcc1-closeout-manifest.json): all 80 original→archive mappings, actual hashes/modes, historical command/session/verdict provenance, deterministic archive receipts, and **371 explicit proposed stage paths**.
- [Final receipt](../evidence/dcc1-closeout-receipt.json): actual final preservation/roundtrip/stage-freshness checker, exact returned result, and file hashes.
- This report and the exact 40 archive paths enumerated in the manifest. No other new outputs.

The proposed stage list is `manifest.proposedStageList` (also pinned in inventory). It explicitly includes the 40 new archives, all pending plain coordination metadata/reports/handoffs/proofs/unique diagnostic artifacts, and the four closeout artifacts. It excludes all 80 archived plaintext originals, the prior 40 already-committed archive set, all 765 physical preservation-copy paths, and parent-owned tracked `dcc1.md`. It is a proposal for parent receive, **not an executed git-add command**. Git-visible copies nested under the preservation root are not accidentally included.

## Historical-path resolver

For any literal historical path, match `entries[].original.path` (new set) or `old40[].original.path` (prior committed set) in the manifest. The corresponding `archive.path` is the lossless retained representation. Read without changing any file:

```sh
/usr/bin/gzip -d -c <exact-archive-path>
```

All original paths still exist now. Four archive links are provided here because only these historical Markdown bytes require archival:

| Exact historical artifact | Current immutable archive | Reason |
| --- | --- | --- |
| handoffs/2026-08-30-dcc1-observer-proof-received.md | [archive](../handoffs/2026-08-30-dcc1-observer-proof-received.md.gz) | extra blank line at EOF |
| reports/dcc1-parity-observer-diagnostic.md | [archive](dcc1-parity-observer-diagnostic.md.gz) | two preserved trailing-space lines |
| reports/dcc1-parity-observer-diagnostic-renewed.md | [archive](dcc1-parity-observer-diagnostic-renewed.md.gz) | two preserved trailing-space lines |
| reports/dcc1-parity-observer-diagnostic-two-inventory.md | [archive](dcc1-parity-observer-diagnostic-two-inventory.md.gz) | extra blank line at EOF |

This is not catchall report compression. The full exact whitespace diagnostics are in the inventory. No original byte was normalized to make a diff check pass. The active recovery handoff remains recoverable in **both original and archive**, not consumed or deleted; all other handoffs remain untouched.

Parent has separately declared a later, after-return three-link correction in its diagnostic-parent-receive, final-parent-receive and preflight-correction-receive reports, with before-images and chronology retained first. Those link edits have **not** occurred during this receipt and are not worker changes. Current pins describe the worker-time originals.

## Historical executions preserved, not rerun

Each of the 36 new log entries retains its exact metadata path/hash, executable/args/environment (and stdin source where relevant), native session or explicit synchronous/no-session fact, gate/logger/wrapper exits, original start/end, and anchored summary lines. Native receipts copied from reports/JSON are identified as transport-derived; separate direct raw bytes remain authoritative. Old log/patch provenance is carried from the **committed** original manifest without changing its earlier statuses.

| Historical family | Preserved actual result |
| --- | --- |
| ae007 full coverage / parity | 6021:335 files/3806 tests,0/0;15690:227 passed/12 failed,1/0 |
| observer preparation | typecheck65879 and lint90307:0/0 |
| corrected inventory | 52914:1/0; failed inventory, not browser execution |
| renewed inventory | synchronous tool0f0a5f:0/0; no yielded session |
| observer no-browser proof | 21 worker runs including eight separate meaningful mutant reds and restored greens; 2 parent runs17765/34458 remain separately attributed |
| real diagnostic | 70130:12 failures,1/0; diagnostic post-refusal PNGs are not screenshot assertion passes |
| deliberate scoped update / assertion | 98135 and48831:12 passed each,0/0 |
| final284ada freshness | manifest65481 androadmap75747:0/0 |
| final284ada full coverage / parity | 79293:335 files/3806 tests;69502:239 passed;0/0 each |

Here `0/0` denotes gate/logger exits, not a new closeout test. All individual wrapper exits and native provenance are in the manifest. The 36 new logs contain 11 exit1 histories and25 exit0 histories; logger exits are0. Failed tooling without a complete disk-first browser log (95374 and c006ea) remains retained in original JSON/Markdown, with its transport limitations; no missing raw log is invented.

Important distinctions stay intact:

- original F8b baseline and pinned runs were9failed/9passed/28skipped trigger failures;
- the filename `baseline-precedence-green` actually records3failed/15passed/28skipped audit refinement, not green;
- verified baseline18passed/28skipped is separate;
- unmatched prior-filter47skipped is not red/green sensitivity proof;
- ten old F8b meaningful mutations and eight later observer-proof mutations are different sets;
- old87688 coverage red remains red despite the later335/3806 full green.

Raw log provenance is not inferred from filenames. The admission JSON stream was buffered until child terminal, then written/fsynced before transport: its start facts were observed before spawn but its metadata was persisted later. The corrected preflight stream is raw child JSON containing nested encoded command outputs, not a separately raw stream for each nested command. Other direct logs retain their original disk-first callback-order semantics. Metadata and Markdown are annotated/transport-derived evidence, not raw child streams.

## Archive proofs

The exact target list was persisted before compression. Mechanical execution used only:

```text
/usr/bin/gzip -n -k <exact absolute original path>
/usr/bin/gzip -d -c <exact absolute archive path>
/usr/bin/gzip -n -c <exact absolute original path>
```

No `-f`, overwrite, attributes/config/ignore change, plaintext rewrite, or cleanup. Before the first archive all original hashes/modes/regular-file identity and destination absence were checked. Every archive was fsynced, fully decompressed and byte-compared to its original, then independently recompressed and byte-compared. Header MTIME=0; FNAME and FCOMMENT absent.

Archive creation tool **0db939**, synchronous wrapper exit0 (no yielded session), **2026-08-30T20:07:00.086Z–20:07:00.501Z**. All40 gzip creation,40 decompression and40 recompression subprocesses exited0. There is no separate archival logger process; its loggerExit is explicitly not applicable, not fabricated0. Apple gzip479. Original total **1,741,746 bytes** → archives **411,321 bytes**.

The prior40 set was independently fetched with `git show a67c4e1:<exact archive path>`, compared to working archive bytes, fully decompressed against untouched plaintext, checked against original manifest hashes, and deterministically recompressed. Its manifest was likewise compared byte-for-byte with the committed blob. That proves existing Git durability for that prior set; it does not confer commitment on the new archives.

Inventory/checker limitations are explicit. The first read-only inventory stopped on the non-log whitespace-target review guard before any write. A subsequent exit0 inventory response was transport-truncated and not parsed as complete; a compact return retained identical validation predicates and all required inventory data. A read-only nearest-AGENTS search returned rg1 for no matches under docs; no docs-local AGENTS was found. These are not gate failures. Complete selected old-history data references the immutable committed manifest, rather than pretending a truncated tool print was full evidence.

## Physical retention and proposed later moves

The exact files and modes/hashes are in inventory:

- older preservation root:112 files (92 ignored,20 Git-visible);
- old coverage preservation root:653 files, all ignored;
- current generated coverage:653 files;
- current dashboard bundle+stamp:92 files;
- saved parity runner outputs:33 files.
- unique84 real diagnostic observation artifacts and retained no-browser proof fixtures remain unchanged; their Git-visible unique files are explicitly proposed for durable staging.

Thus **765 physical preservation copies are not 765 ignored files**: actual Git classification is745 ignored plus20 visible. Both physical walks and Git-visible accounting are retained separately. Neither preservation root is moved, cleaned, overwritten or rearchived.

`manifest.proposedMoves` gives each of the80 plaintext originals' exact original→archive→proposed retained path:
`dist/dcc1-archived-evidence-originals-2026-08-30/<original repo-relative path>`.
All destinations were absent and classified by the existing `dist/` ignore rule; none was created. This is a **recoverable AFTER-durability proposal only**: parent must independently verify committed archives+manifest and full roundtrip first, then separately authorize and verify any move without overwrite. No worktree removal is authorized or safe while retained physical evidence lacks its final coordinator disposition.

## Return

### Explicit disposition of the 20 visible preservation copies

These are **not** part of the 80 archived originals and are intentionally absent from the371-path stage proposal. `manifest.proposedCopyRelocations` enumerates every exact physical before-path, bytes/hash/mode and proposed destination under `dist/dcc1-archived-evidence-originals-2026-08-30/preservation-copies/<original physical repo-relative path>`. All20 destinations were absent and matched the existing `.gitignore:45 dist/` rule in read-only tool5b94b0 exit0. No directory or file was created there; no additional archive was made.

After independent committed evidence verification, parent can recoverably relocate exactly these20 files without overwrite and verify every destination byte/hash/mode. The other745 copies remain in place:653 coverage copies plus92 already-ignored older copies. All765 remain physically retained. The original fixed112-copy manifest stays immutable as historical before-path provenance; after a future move its20 relocated logical paths must be resolved through this explicit table and a parent post-move receipt, not passed to the old physical-walk check unchanged.

The clean-handback accounting is exact and disjoint: **471 currently visible paths = 371 proposed staged paths + 80 archived originals for later retention + 20 protected-copy paths for separate later retention**. Therefore no20-file untracked/whitespace debt is silently abandoned. Current state is still intentionally untracked: clean handback is conditional on parent staging/committing and verifying the separately authorized recoverable moves. This worker performs none of them. Raw-copy whitespace bytes stay untouched in ignored retention; metadata commits their exact locations and hashes.

All owned commands are terminal; no light/heavy lane requested or retained. Parent independently receives archive semantics and actionable links with the existing Docs reviewer, then owns explicit staging/commit and any later durability-verified moves. No changes to migration/D75/shared-integration residue, source ownership, live authority, board, or branch integration are implied.
