# DCC1 evidence packaging

STATUS: verified lossless archive candidate; independent packaging/docs review and parent index replacement/freeze pending.
ROLE: `sup_sol_dcc1_evidence_packaging`; native Sol/high, assigned240k/220k. No dispatch, source changes, staging or commit.

## Result

Exactly the40 paths approved in [parent inventory](../evidence/dcc1-packaging-inventory.json)
were copied to corresponding deterministic `.gz` archives using **`/usr/bin/gzip -n -k ORIGINAL_ABSOLUTE_PATH`**,
without `-f`. All39 logs and the retained patch remain byte-for-byte untouched.
All40 archives passed decompression equality and deterministic recompression; gzip header flags and
mtime are zero (no stored name/comment/timestamp). No extra archive paths were created.
Totals: **736,731 original bytes → 191,960 archive bytes**. This is packaging, not a new gate verdict,
durability certification, staged index replacement, or committed integration.

[Self-contained manifest](../evidence/dcc1-packaging-manifest.json) records each exact original/absolute/archive
path, original staged blob, both lengths/SHA256, historical command/session/gate+logger status and
provenance, original metadata, and round-trip/recompression receipts. Historical literal raw filenames
resolve through that mapping without rewriting old commands or metadata.
The original plaintexts remain present; parent may separately replace their index entries after review.

## Exact verification and tool receipts

All commands used workdir
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Preflight validated the complete inventory BEFORE the first archive:
40 distinct paths;39rawlogs+1patch; every stage0 entry newly ADDED relative to HEAD;
working bytes equal original staged blob and inventory size/SHA256; regular non-symlink files
and non-symlink checkout ancestry; every destination absent; owned manifest/report absent.
No source/test/AGENTS/guard/migration, Git attributes/config/ignore, or historical metadata was edited.

| Operation | Tool chunk/session | Outcome |
| --- | --- | --- |
| Complete read-only preflight | `0b058f`; completed initial call, no session ID | exit0;40originals verified; index/closure matched |
| Exact40 archive creation plus first verification | `946865`; completed initial call, no session ID | exit0;17:16:53.924–17:16:54.222Z; every child gzip exit0 |
| Compact read-only re-verification | `e1b81d`; completed initial call, no session ID | exit0;40roundtrips and40 deterministic recompressions, no extras |

Creation/check invocations for each exact inventory item:

```sh
/usr/bin/gzip -n -k ORIGINAL_ABSOLUTE_PATH
/usr/bin/gzip -d -c ARCHIVE_ABSOLUTE_PATH
/usr/bin/gzip -n -c ORIGINAL_ABSOLUTE_PATH
```

The last two commands write only captured process output, not files. The verifier compares whole
Buffers, independently calculates SHA256/length, and checks original inode/mode/mtime unchanged.
Exact argv/cwd and inline Node orchestration scripts are in the manifest. Gzip implementation:
`Apple gzip 479`. Determinism was verified against this same implementation; no promise of
identical compressed bytes from other gzip implementations is made.

Two recorder limitations are explicit, not product failures: the first read-only preflight's JSON
parse was contaminated by `gzip --version` on inherited stderr (no archive created); the repeat
captured both streams and passed. The successful creation wrapper's verbose JSON exceeded tool
transport output limits. It returned0 after all checks; no archive recreation was attempted.
A compact second read-only check returned complete per-file lengths/hashes/results. Packaging
verification is tool-derived evidence, not falsely labeled disk-first raw gate logging. There was
no separate packaging logger process; its logger status is N/A. Historical gate/logger statuses
remain separately recorded in each manifest entry.

Final packaging-only metadata verification (`ef43de`, initial-call completion, exit0 at
17:20:02.351Z) rehashed all40 originals/archives, verified historical metadata unchanged and
compared both edited reports against their indexed originals after removing only the archival
note and resolving archive link substitutions. No other report content changed; index/closure
still match below. Manifest SHA256: `a42a2661b798ea2dd3f44cc2b4d2e266d2d5aa787830887e6f7c26882fa1bb2a`.
One erroneous apply_patch target at a nonexistent `reports/does-not-exist` path was rejected before
any write; no file was created or changed there.

Parent separately reported all40 original/index/hash, gunzip equality, recompression and header
checks passed and retained [its independent receipt](../evidence/dcc1-packaging-parent-receipt.json).
That artifact is parent-owned and was not edited by this worker. It does not imply index replacement.

## Provenance and verdict preservation

- **38 raw child-output logs:** original disk-first process bytes; original hashes unchanged.
  F8b stdout/stderr chunks preserve cross-stream arrival order.
- **One annotated preflight transcript:** child buffers recorded before transport plus recorder
  COMMAND/STDOUT/STDERR/EXIT/CHECK labels. Its `.raw.log` filename does not make it one raw child
  stream. Thirty exact recorded command/argv/cwd/exit tuples are retained. Outer launcher/session
  and independent logger exit are unknown in the cited persisted artifacts; not invented.
- **One retained patch:** derived diff text transported and written with apply_patch, not a raw
  process log. It preserves F8b's three-path diff against0b5, including context whitespace.
- Original reports' historical postflight prose remains normalized/transport-derived where labeled.
  Archival notes and Markdown links alone were added/updated in this worker's F8b/full-gates reports.
  Parent owns other report updates.

F8b baseline and pinned each remain **9failed/9passed/28skipped** from current advance-trigger setup.
The misleading `baseline-precedence-green` filename remains **3failed/15passed/28skipped** from
audit-schema refinement; verified baseline remains18passed. The two unmatched prior filters remain
47skipped each, not red/green proof. All10 meaningful mutant red/restored proofs retain exact blobs,
commands and outcomes. Full coverage87688 remains1failed/334passed files,1failed/3786passed tests;
parity was withheld. No F8b full-gate pass is inferred.

Parent freshness20355 exit0 **before evidence staging** and later full cached-check exit2 with52
diagnostics are separate facts. Parent inventory recorded exit0 only when excluding these exact40
paths. This worker neither reran npm checks nor claimed the final staged whitespace gate is fixed:
plaintext entries remain staged until parent explicitly replaces them.

## Archive map

Links below point to archives. Counts and gate/logger statuses describe original evidence, not
archiving subprocesses; unknown/N/A is explained per entry in the manifest.

| Original evidence → archive | Original → compressed bytes | Historical gate/logger |
| --- | --- | --- |
| [dcc1-0b5-coverage.raw.log](../evidence/dcc1-0b5-coverage.raw.log.gz) | 13719 → 1586 | 1/0 |
| [dcc1-0b5-preflight.raw.log](../evidence/dcc1-0b5-preflight.raw.log.gz) | 659201 → 168103 | 0/unknown/N/A |
| [dcc1-f8-focused.raw.log](../evidence/dcc1-f8-focused.raw.log.gz) | 1447 → 662 | 1/0 |
| [dcc1-f8-lint.raw.log](../evidence/dcc1-f8-lint.raw.log.gz) | 81 → 93 | 0/0 |
| [dcc1-f8b-baseline-precedence-green.raw.log](../evidence/dcc1-f8b-baseline-precedence-green.raw.log.gz) | 2297 → 912 | 1/0 |
| [dcc1-f8b-baseline-precedence-pinned.raw.log](../evidence/dcc1-f8b-baseline-precedence-pinned.raw.log.gz) | 3524 → 754 | 1/0 |
| [dcc1-f8b-baseline-precedence-verified.raw.log](../evidence/dcc1-f8b-baseline-precedence-verified.raw.log.gz) | 455 → 305 | 0/0 |
| [dcc1-f8b-baseline-precedence.raw.log](../evidence/dcc1-f8b-baseline-precedence.raw.log.gz) | 3524 → 755 | 1/0 |
| [dcc1-f8b-break-audit-identity-red.raw.log](../evidence/dcc1-f8b-break-audit-identity-red.raw.log.gz) | 1279 → 629 | 1/0 |
| [dcc1-f8b-break-audit-identity-restored.raw.log](../evidence/dcc1-f8b-break-audit-identity-restored.raw.log.gz) | 465 → 317 | 0/0 |
| [dcc1-f8b-break-current-identity-red.raw.log](../evidence/dcc1-f8b-break-current-identity-red.raw.log.gz) | 1279 → 626 | 1/0 |
| [dcc1-f8b-break-current-identity-restored.raw.log](../evidence/dcc1-f8b-break-current-identity-restored.raw.log.gz) | 465 → 317 | 0/0 |
| [dcc1-f8b-duplicate-file-acquisition-red.raw.log](../evidence/dcc1-f8b-duplicate-file-acquisition-red.raw.log.gz) | 1242 → 607 | 1/0 |
| [dcc1-f8b-duplicate-file-acquisition-restored.raw.log](../evidence/dcc1-f8b-duplicate-file-acquisition-restored.raw.log.gz) | 412 → 305 | 0/0 |
| [dcc1-f8b-duplicate-observation-red.raw.log](../evidence/dcc1-f8b-duplicate-observation-red.raw.log.gz) | 1438 → 676 | 1/0 |
| [dcc1-f8b-duplicate-observation-restored.raw.log](../evidence/dcc1-f8b-duplicate-observation-restored.raw.log.gz) | 457 → 313 | 0/0 |
| [dcc1-f8b-extract-command-green.raw.log](../evidence/dcc1-f8b-extract-command-green.raw.log.gz) | 506 → 298 | 0/0 |
| [dcc1-f8b-final-focused.raw.log](../evidence/dcc1-f8b-final-focused.raw.log.gz) | 669 → 344 | 0/0 |
| [dcc1-f8b-ignore-audit-only-red.raw.log](../evidence/dcc1-f8b-ignore-audit-only-red.raw.log.gz) | 1129 → 603 | 1/0 |
| [dcc1-f8b-ignore-audit-only-restored.raw.log](../evidence/dcc1-f8b-ignore-audit-only-restored.raw.log.gz) | 431 → 297 | 0/0 |
| [dcc1-f8b-lint.raw.log](../evidence/dcc1-f8b-lint.raw.log.gz) | 81 → 93 | 0/0 |
| [dcc1-f8b-observation-bound-green.raw.log](../evidence/dcc1-f8b-observation-bound-green.raw.log.gz) | 457 → 316 | 0/0 |
| [dcc1-f8b-observation-outside-exclusion-red.raw.log](../evidence/dcc1-f8b-observation-outside-exclusion-red.raw.log.gz) | 1634 → 731 | 1/0 |
| [dcc1-f8b-observation-outside-exclusion-restored.raw.log](../evidence/dcc1-f8b-observation-outside-exclusion-restored.raw.log.gz) | 412 → 308 | 0/0 |
| [dcc1-f8b-ordinary-precedence-red.raw.log](../evidence/dcc1-f8b-ordinary-precedence-red.raw.log.gz) | 3666 → 984 | 1/0 |
| [dcc1-f8b-ordinary-precedence-restored.raw.log](../evidence/dcc1-f8b-ordinary-precedence-restored.raw.log.gz) | 465 → 315 | 0/0 |
| [dcc1-f8b-owned.diff](../evidence/dcc1-f8b-owned.diff.gz) | 17332 → 4450 | unknown/N/A/unknown/N/A |
| [dcc1-f8b-parent-focused.raw.log](../evidence/dcc1-f8b-parent-focused.raw.log.gz) | 669 → 343 | 0/0 |
| [dcc1-f8b-parent-lint.raw.log](../evidence/dcc1-f8b-parent-lint.raw.log.gz) | 81 → 93 | 0/0 |
| [dcc1-f8b-parent-typecheck.raw.log](../evidence/dcc1-f8b-parent-typecheck.raw.log.gz) | 57 → 77 | 0/0 |
| [dcc1-f8b-prepared-precedence-red.raw.log](../evidence/dcc1-f8b-prepared-precedence-red.raw.log.gz) | 3141 → 933 | 1/0 |
| [dcc1-f8b-prepared-precedence-restored.raw.log](../evidence/dcc1-f8b-prepared-precedence-restored.raw.log.gz) | 451 → 311 | 0/0 |
| [dcc1-f8b-shared-observation-green.raw.log](../evidence/dcc1-f8b-shared-observation-green.raw.log.gz) | 667 → 344 | 0/0 |
| [dcc1-f8b-skip-pre-settlement-authentication-red.raw.log](../evidence/dcc1-f8b-skip-pre-settlement-authentication-red.raw.log.gz) | 1332 → 667 | 1/0 |
| [dcc1-f8b-skip-pre-settlement-authentication-restored.raw.log](../evidence/dcc1-f8b-skip-pre-settlement-authentication-restored.raw.log.gz) | 431 → 297 | 0/0 |
| [dcc1-f8b-skip-prior-authentication-matched-red.raw.log](../evidence/dcc1-f8b-skip-prior-authentication-matched-red.raw.log.gz) | 10405 → 2196 | 1/0 |
| [dcc1-f8b-skip-prior-authentication-matched-restored.raw.log](../evidence/dcc1-f8b-skip-prior-authentication-matched-restored.raw.log.gz) | 465 → 317 | 0/0 |
| [dcc1-f8b-skip-prior-authentication-red.raw.log](../evidence/dcc1-f8b-skip-prior-authentication-red.raw.log.gz) | 454 → 304 | 0/0 |
| [dcc1-f8b-skip-prior-authentication-restored.raw.log](../evidence/dcc1-f8b-skip-prior-authentication-restored.raw.log.gz) | 454 → 302 | 0/0 |
| [dcc1-f8b-typecheck.raw.log](../evidence/dcc1-f8b-typecheck.raw.log.gz) | 57 → 77 | 0/0 |

## Git/source boundary and next owner

HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Index remains **`cc9d04b6ef59ca781ca6cb706b53b97dcd630a37`**.
Execution closure remains **`d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051`**,
excluding only coordination reports/evidence/handoffs.
Source `f0746f5f649d5c0bcea055852b9d3345d72c45e5`, test `7edb5c38b5fb112c8ced91a2895d225349a4e644`,
AGENTS `28a672ae2317d66acb058e4df0fe9163de2410f4`, guard `dc10fa414fc60b4f0115ae943cef9f58919bd8b0`
remain unchanged. Parent main/review-report changes, inventory and handoff are preserved.

Owned outputs only:40archives, manifest, this report, and archival-only updates to `dcc1-f8b.md`
and `dcc1-full-gates.md`. No archive/original was deleted, moved, overwritten or normalized.
All owned packaging processes exited. No reviewer was resumed; no light/heavy/npm/browser/live
workflow was run. Independent packaging/docs review, exact parent index replacement, renewed
freeze and coordinator allocation remain required. Migration collisions and D75 residue are unchanged.
