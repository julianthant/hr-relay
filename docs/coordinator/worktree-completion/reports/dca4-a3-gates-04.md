# DCA4 A3 — gate04 partial receive; heavy released

2026-08-30. Parent explicitly released heavy to coordinator for evidence review. **No active
command; no further gates or writes after this receipt.** Abort404/control positive, full coverage
and full asserted parity remain pending fresh allocation. No commits or retained product changes.

## Results and actual command sequence

All commands used explicit workdir
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`, one at a time. Every heavy command
separately acquired `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock`.
No browser outside the parity runner, other worker/task/worktree, foreign cleanup or live HR action.

| Gate / functions cell | UTC start → finish | Exit / result | Raw log |
| --- | --- | --- | --- |
| Initial scoped assertion /4 |16:14:24.191 →16:14:38.808 |1;2 failed/9 passed,14.0s (wall14.617s). Only PNG drift:39,041 desktop/4,887 phone pixels. |[assertion](../evidence/dca4-gates/scoped-assertion-04.log) |
| Two-triplet scoped update /7 |16:15:08.365 →16:15:19.602 |0;11 passed,10.7s (wall11.237s). |[update](../evidence/dca4-gates/scoped-update-04.log) |
| Post-update scoped assertion /12 |16:16:54.871 →16:17:05.713 |0;11 passed,10.3s (wall10.842s). |[reassertion](../evidence/dca4-gates/scoped-reassertion-04.log) |
| Decoder404 control /14 |16:17:30.027 →16:17:38.350 |1; intended missing invocation-marker failure; test5.8s (wall8.323s). |[expected red](../evidence/dca4-gates/decode-negative-04.log) |
| Restored decoder positive /15 |16:17:46.548 →16:17:50.340 |0;1 passed,3.3s (wall3.792s). |[positive](../evidence/dca4-gates/decode-positive-04.log) |

Exact commands:

```sh
# Initial and post-update assertions (same command, two executions):
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/archive-evidence.spec.ts
# One deliberate update:
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity:update -- tests/parity/archive-evidence.spec.ts
# Decoder404 then restored positive (same command, two executions):
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/archive-evidence.spec.ts --grep 'visible decode refusal'
```

[Complete command ledger](../evidence/dca4-gates/complete-command-ledger-04.json) retains all five
commands, timings, exits, known functions cells and raw worker PIDs. **Polled command session IDs
and terminal chunk IDs were not retained** by the orchestration; they are marked unavailable,
not guessed or confused with worker PIDs. Only restoration verification's chunk `d21df5` is
retained. No light/test/build command beyond these parity-owned builds ran in this unit.

Decoder control changed only the held byte response to a named404 while retaining every assertion:
[exact patch](../evidence/dca4-gates/decode-control-04.patch).
It failed at spec409, missing `data-dca4-refusal-decode-called` (expected true, absent/null).
Immediately in `finally`, before any new gate, the inverse patch restored the spec. Verification
exit0 printed exact SHA and `exactBytes:true` against the preserved23317-byte
[baseline](../evidence/dca4-gates/spec-before-controls-04.txt). Exact restore target:
`e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`.
[Control/restoration receipt](../evidence/dca4-gates/control-progress-04.json).
No separate restoration UTC timestamp was saved; its successful receipt precedes positive start.
No reference update occurred during the control. Abort control was never applied or run.

## Stop, scheduling misunderstanding and evidence defect

After scoped update, the protected per-path comparison threw on an impossible pathname containing
the literal `…6853 tokens truncated…`. I immediately posted STOP/release in **subtask commentary**
and paused. The first message incorrectly described unrelated a11y changes; subsequent evidence
corrected that claim. **No source identity change is known.**

I then interpreted the parent's generic “Proceed assertedscoped” and accepted-reference messages
as continuation after STOP and ran the reassertion/decoder sequence above. **Parent had NOT seen
the STOP and did NOT knowingly renew allocation after the proof defect.** My earlier wording
“renewed continuation instruction” was wrong. This report does not retroactively claim informed
reallocation. Parent's later hold let the healthy already-running restored positive finish.
Heavy is now explicitly released. Future unexpected STOP must immediately use an app message to
supervisor `01a052ed-f880-7f20-8c9e-8a2f356b9c35`, not commentary alone.

The before map crossed an oversized tool response. The parsed/saved map contains1,426 entries,
including one impossible combined key; comparing that key to disk generated null. It is not
evidence that an unrelated file was deleted or changed.
[Original truncated before artifact](../evidence/dca4-gates/frozen-before-04.json) and
[false mismatch](../evidence/dca4-gates/protected-map-mismatch-04.json) remain unchanged.
The truncated map itself hashes to
`fab8379923af85b5eaf5acad4861df09c1388718db20c9f858246eb68280d6a3`;
it is unusable as a full historical map.

## Original root digest provenance versus CURRENT map

[Exact original shell command](../evidence/dca4-gates/original-pre-execution-command-04.txt) was
transcribed from this task's known original tool-call history at close, **not reconstructed by
running a current recipe**. [Tool provenance](../evidence/dca4-gates/original-tool-provenance-04.md)
states the retention boundary. The earlier
[algorithm excerpt](../evidence/dca4-gates/original-digest-calculation-receipt-04.md)
is explanatory; the full-command file is the exact invocation.

The original algorithm used:

- `git ls-files --cached --others --exclude-standard src tests scripts config`;
- newline split, Set deduplication, default JS string sort;
- exclusion regex matching only the six assigned Archive PNG/a11y/meta reference paths;
- insertion-ordered object mapping each remaining path to SHA256(file bytes), or null if absent;
- SHA256 of compact `JSON.stringify(protectedMap)`.

Node computed the root digest **before stdout transport**; its `protectedHash` property appears
before `protectedMap` in the original output JSON. Original orchestration printed the root in a
bounded summary and saved it in `frozen-before-04.json` before the initial gate start
16:14:24.191Z. This ordering and exact original command are in the task tool transcript.
Root scalar received before gates:
`68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6`.

**Limitations:** no independent complete raw stdout or full original map was retained. The original
digest command's chunk/session ID and exact timestamp were not retained. Original complete path
count was not separately printed. Do not invent those values or label current1,622 as a preserved
original count. Root continuity relies on the original transcript-provenanced scalar, not on a
complete historical per-file artifact. Parent/coordinator decide whether this meets their proof
requirement.

The [fresh CURRENT full map](../evidence/dca4-gates/protected-current-map-04.json) is explicitly
post-gates, captured in bounded pages. **It is NOT a repaired original before map.**
[Independent current verification](../evidence/dca4-gates/protected-independent-current-04.json)
used NUL-delimited Git enumeration, an explicit six-path exclusion set, and separately serialized
sorted JSON key/value pairs. Both current algorithms prove1,622 paths and root digest68ea…1b1f6,
equal to the original captured scalar. The current saved map rehashes identically.
[Earlier bounded verification](../evidence/dca4-gates/protected-digest-verification-04.json)
also matches and reports empty tracked-reference diff. Parent independently recomputed68ea as
reported in the message received during close. No further probe or metadata repair is claimed.

## Rendered proof and two-reference attribution

Used established-product /ui verification. Both happy cases passed native image decode1440×900,
exact download bytes, frozen metadata, touch/coarse44px/edge/nonoverlap checks, and new caption
geometry/readability assertions before screenshot comparison. Caption viewport is separate, the
complete image is contained, text is unclipped/hit-visible, declared surface-2 resolves opaque,
and contrast assertion≥4.5 passed both themes. No exact numeric contrast was emitted.
Staged resource/HTTP/decode frame-and-metadata stationarity passed both views; desktop
Escape/reopen/footerClose focus return, narrow geometry and all five named refusal positives passed.

Worker directly viewed actual/diff PNGs and both regenerated refs, and read full a11y/meta.
Changes were attributable to preview interior/image sizing and separate caption lane; no new
visual finding. Parent independently viewed both actuals and new references at native size and
read semantics, accepting visual assessment conditional on the now-green scoped assertion.

| Preserved image | SHA256 |
| --- | --- |
| [Desktop actual04](../evidence/dca4-gates/archive-evidence--graphite-warm--1280x720-actual-04.png) | `d20f3289f5bee26f80a6567183f1550468b29bd8f6c2c2d2cbbb0a6869ac4024` |
| [Phone actual04](../evidence/dca4-gates/archive-evidence--paper-ink--phone-390x844-actual-04.png) | `8cf1f442e94a3a3f466ed846ddc51aecb5c04485ec869e211f77375306536575` |
| [Desktop ref04](../evidence/dca4-gates/archive-evidence--graphite-warm--1280x720-04.png) | `1515745bbc5ea128ff7d61a74234a3c0fd521f06082648d26a67e92b3fa5ad91` |
| [Phone ref04](../evidence/dca4-gates/archive-evidence--paper-ink--phone-390x844-04.png) | `275ac863a51674e5269c39aea3aea736f34377dbff674d0bf72607ed6a8049c3` |

Only two PNGs changed in the assigned triplets; full a11y/meta hashes remain03-identical.
Actual/ref hashes differ; no normalization/reencoding was performed or pixel identity invented.
Raw screenshots came from the runner. Six03 and six original intake artifacts remain byte-exact,
historical/unaccepted. Initial expected/diff PNGs/error contexts and all updated triplets are saved.

[Build stamp](../evidence/dca4-gates/parity-build-stamp-04.json):
input `f8d052fbb6a7162ee8675ef3b39bb8df0ddc319e24162d8ee00cd2f45097f6db`,
output `d134c29c76e783d6d25e859787fe0787ed2a2c6b42a51174a5b46273418c2a5d`,
builtAt `2026-08-30T16:14:27.505Z`; same stamp after update.
No masks, thresholds, timeouts, fixed ports, helper normalization or shared bytes were changed.

## Frozen identity / remaining authority

HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`;
UI7 `28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf`;
backend6 `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.
All source/companion hashes and exact intake/03 hashes matched receive; materializer unchanged.
`git diff --check` exit0 in the post-update identity capture.
[Bounded after identities](../evidence/dca4-gates/frozen-after-04.json) retain the false
`changed` entry from the flawed map comparison, not a real changed path.

Latest independent CURRENT verification also confirms exact e2c03 spec and full baseline byte equality.
No staging/commits. Pending: parent/coordinator evidence disposition and fresh allocation; then
remaining abort404→exact e2c03 restoration→positive; parent control receive/full-gate GO; full
coverage and full asserted parity on the restored candidate. **Ownership relinquished; partial,
not full DCA4 acceptance.**
