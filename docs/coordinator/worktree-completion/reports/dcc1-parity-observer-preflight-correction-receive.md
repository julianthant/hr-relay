# DCC1 observer preflight correction — parent receive

Status: one-line correction validated; bounded pin/inventory accounting PASS.
The unchanged full preflight remains exit 1 on its two historical untracked-inventory
checks. Diagnostic browser NOT RUN; allocation RELEASED. DCA2 owns the scoped slot
per the coordinator's latest scheduling message; DCC1 has no NEXT/OPEN.

## Original failure received

Read the complete [worker report](dcc1-parity-observer-diagnostic.md.gz) and
[exact failed script/output](../evidence/dcc1-parity-observer-diagnostic-preflight-failure.json).
Session **95374**, terminal **ee05f8**, exit **1** failed at preservation-array
`.map(info)`: a file record reached `lstatSync` instead of its path.

The inspected script has no explicit file write/copy/mkdir, observer installation,
browser/build spawn or lock acquisition. Git inventory/diff/hash commands and
`npm ls --all --json` are its child commands; this does not audit incidental Git/npm
internals. The exception preceded its final structured print; partial arrays existed
only in process memory. Its start/end wall times remain unknown. Original failure
text is transport-derived, not disk-first raw output. Earlier shape-display error
57bb4d remains separately recorded.

Parent post-stop verifier **4a0fc1 exit0** confirmed preserved 1,923 tracked files,
1,511 retained checks, original thirteen future directories absent, index/closure and
diff checks. **48f725 exit0** confirmed the two diagnostic raw/meta paths absent.
These are independent post-stop checks, not a retroactive preflight pass.
The completed same Sol unit was closed; no replacement worker/task was created.

## Approved correction and exact boundaries

Coordinator subsequently approved only the path projection correction and read-only
validation, with no preservation copies, observer installation, build, browser, heavy
retry, reference/source changes, staging or commit.

```diff
-const preserve=[...old.bundle.outputs,old.bundle.stampFile,...old.parityArtifacts,...old.evidence].map(info);
+const preserve=[...old.bundle.outputs,old.bundle.stampFile,...old.parityArtifacts,...old.evidence].map(x=>info(x.path));
```

[Correction artifact](../evidence/dcc1-parity-observer-preflight-correction.json)
retains both complete command strings and the original failed receipt hash.
The corrected stdin source SHA256 is
`8f358f85b55dc5e301126c672b9ee8768043abe3283f15cbbe102735214cb194`.
Parent c95004 verified this is exactly the sole source substitution. No inventory
predicate was edited.

| Execution | Actual result |
| --- | --- |
| First corrected inventory 71366, exact terminal tool return retained in correction artifact | exit1; output transport truncated at 176,598 original tokens; not a complete retained inventory |
| Identical corrected inventory with output retention 52914 / 04a7c4 | exit1 / logger0; complete structured output, only two inventory failures |
| Parent accounting checker 65d9f5 | exit1: comparator included provenance `kind` absent from filesystem-only record; matching bytes/hash/mode shown; not a product defect |
| Corrected parent accounting checker c95004 | exit0: exact filesystem field comparison and complete bounded accounting PASS |

For the first corrected run, the exact terminal chunk is in the retained tool object;
the table does not substitute a fabricated chunk identifier. Both corrected runs
executed the same inventory logic. The second was for complete output retention, not
a browser retry. Its [wrapper](../evidence/dcc1-parity-observer-preflight-retention-wrapper.json)
only supplied stdin and persisted process output/metadata into exclusive new evidence
files; it changed no child inventory logic.

Direct child-process bytes were written/fsynced before wrapper transport:
[raw JSON output](../evidence/dcc1-parity-observer-preflight-corrected.raw.log),
707,626 bytes, SHA256
`522456007016e7fabc46284bd70581392c934c67b82e79cc361c9388d0e7b341`.
[Metadata](../evidence/dcc1-parity-observer-preflight-corrected.meta.jsonl)
records start **2026-08-30T19:03:33.879Z**, terminal **19:03:35.160Z**,
child exit1/logger0/signal null, and exact command/source SHA.
The bytes are raw output of this inventory process; nested Git/npm stdout fields are
structured representations, not independent raw process logs. No test/browser gate
or logger verdict is invented.

## Why the full preflight is still red

The original script expects exactly 268 untracked files and its original membership.
The immutable failure report and failure JSON made 270 before validation. Retaining
the correction, output wrapper and its raw/meta files made 274 for the fully retained
execution. All six are explicitly named, hashed, sized and mode-pinned in the
[parent receive](../evidence/dcc1-parity-observer-preflight-correction-receive.json).

Its exact failure list is still:

```json
["268 untracked", "untracked exact membership"]
```

All 13 child commands exited0, including a fresh npm graph, both diff checks, legacy
guard-only status/hash reads, and Git inventories. No other accumulated check failed.
The script completed the 112-file preservation PLAN in memory; no copy was made.
The parent independently proved exact current membership = original268 + six named
new evidence files, and equality of all original268 bytes/hashes/modes. This bounded
accounting PASS is **not** a full-preflight PASS, inventory waiver or browser admission.
No future preflight is silently modified to accept these additions.

The raw/meta files were sampled during their own execution, when raw was empty and
metadata contained only its start. Their final hashes are separately verified against
terminal metadata; their final bytes are not falsely equated with in-flight self-pins.

The receive artifact then made275; this report and the new handoff make277; the final
inventory adds its own separately identified output as278. The final inventory records
that chronology and exact membership; no original artifact was overwritten.

## Pinned result

| Fact | Independent receipt |
| --- | --- |
| HEAD / ordered MERGE_HEAD | 0c115123a738f62cbe01c9b45f53b7289284479c / 13175b13340fec7b5326207fe54f98078d481d7d |
| Complete unchanged index | ae00723e05d20a6c87d0ada500fc77a456870ea9 |
| Execution closure | d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051 |
| capture / original architecture test / reference store | 641378037d2396a6e84003115a5f158f178e17c7 / 6bdebc160f537079eeea8c4db6369ad1069ab9e1 / 58fec850d0e0140b6ab45fb8fb341d940a16d44f |
| Fresh npm graph | 3d0dc25a77748026d1d6d56a127245cdc89499a81ccb3e48b60140fe444f74df |
| Tracked / retained | 1,923 exact / 1,511 retained checks |
| Protected future paths | all16 absent: twelve case dirs, runner dir, diagnostic raw/meta, preservation dir |
| Existing originals | old15 parity outputs, old stamp/bundle, 40plaintext/archive pairs and original failure/proof bytes retained |
| Working/index state | 509 staged pending-merge paths; no unmerged entries; only existing parent dcc1.md unstaged; both diff checks0 |

Read-only identity snapshot **eb1ce8 exit0** confirmed branch
`feature/r-dcc-dcc1-exclusive`, 61 pre-existing commits ahead of merge parent, exact
worktree path and no product commits. Shared board SHA at that read:
`de5e73150ded4f0c67653a7684fdbdebdf14af184804034cde857a2a5eb627e2`;
board is read-only, and latest explicit coordinator scheduling controls.

[Final inventory](../evidence/dcc1-parity-observer-preflight-correction-final-inventory.json)
pins the final report/handoff/receipt inputs and new non-execution outputs.
[Resume handoff](../handoffs/2026-08-30-dcc1-preflight-mapping-received.md)
preserves the exact next boundary.

## Proposed next disposition — not performed

Request coordinator receive of the one-line fix and exact named additional-output
ledger, then explicit authority to advance only the preflight's expected non-execution
inventory to that ledger (not a broad exclusion or dropped check), and a renewed
allocation for the same previously approved twelve-case diagnostic. No reference,
observer, product, test, threshold, assertion or wait change is proposed.

The observer31776 remains retained but NOT installed. Original architecture test6bde
stays baseline. The exact single diagnostic command and thirteen exclusive case/runner
paths remain in the prior observer-proof-received handoff. No browser run means no new
actual tree/meta/PNG or visual clearance. Original coverage335files/3806tests green and
parity227pass/12fail stay historical and immutable.

Skills used: /supervise for bounded receive/no new workers, /ui repository parity route
and /hr-debug for evidence distinctions; /handoff for the uncompleted allocation boundary.
Prior handoffs, migration history/D75 residue, pending merge and all40 plaintext originals
remain open recovery dependencies. No cleanup, commit, shared integration or board write.
