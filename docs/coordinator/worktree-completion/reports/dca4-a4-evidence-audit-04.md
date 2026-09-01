# DCA4 gate04 — parent evidence audit and release

The native worker round-tripped a too-large path→hash map through tool output, then serialized
its truncation marker as an impossible filename. `frozen-before-04.json` retains1,426keys versus
1,622 actual protected paths, including literal `…6853 tokens truncated…`. That per-path object
is INVALID as a complete before manifest. Preserve it and mismatch04 unchanged; never silently
replace it or label a current recomputation as original before evidence.

The separately computed aggregate digest survived intact. Parent independently recomputed it
read-only after exact decoder-control restoration:

1. `git ls-files --cached --others --exclude-standard -z -- src tests scripts config`.
2. Distinct sorted paths; exclude exactly the six assigned Archive reference paths.
3. Read each file, SHA256 exact bytes; insertion-ordered object from sorted path/hash pairs.
4. SHA256 of `JSON.stringify` of that object.

Result: total1,628paths, protected1,622; digest
**68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6**.
It equals the pre-command recorded aggregate exactly. Parent separately re-pinned UI28f06f9b,
HEADeda17b27, exact spec e2c03, all companions, backend19f0a938 and both six-reference generations.
This proves protected file continuity by aggregate; it does not recover the missing before-map rows.
No demonstrated product/corpus mutation, source repair, normalized capture or swallowed error.

### Original provenance verified from retained task history

Parent retrieved native source turn01a05371-5214-7721-be75-520a479a907b. Original read-only command
`exec-21457ef0-7678-4caa-9d8b-18d546c10477` completed exit0/294ms BEFORE the first parity command
`exec-7889f7fd-79ba-478a-ae13-6794b8b433ee` in the recorded sequence. Its recorded stdout prefix
contains exact HEAD/UI/backend/companion identities and protectedHash68ea761f…1b1f6 before the
large map. This is independent of the later incorrectly serialized JSON artifact. The retrieved
stdout is truncated (reported original227408characters); a complete original per-path stdout is
NOT preserved in this audit, and no complete per-path-before proof is claimed.

`parent-original-digest-provenance-04.json` preserves the exact original command record, bounded
stdout prefix, execution id/status, chronological first-gate relation and all five actual heavy
command execution IDs/exits/durations. Parent reran the original digest recipe exactly (newline
git listing, same allowed regex, sorted object, missing-path null arm) with bounded output only:
**same68ea digest,1622paths,zero missing paths,exit0**. The earlier NUL-safe independent recomputation
also matches. Thus original digest provenance and fresh same-recipe continuity are demonstrable;
the broken per-path object remains unusable and unreconstructed.

## Actual sequence / communication correction

Worker stopped after its false path alarm and described the stop in subtask commentary. Parent
had not seen that commentary when approving visual references and saying proceed with assertion.
Worker interpreted that generic message as renewed continuation after the recording problem.
It was NOT informed parent/coordinator reallocation for a new failure. This communication gap is
recorded plainly, not retroactively ratified. Future critical stops must send an immediate app
message to the supervisor, not rely on subtask commentary retrieval.

Parent saw the issue, required no next command while allowing a healthy restored-positive command
to finish, then explicitly RELEASED the logical slot before audit/report polish. No active command
at release. Only these additional commands ran, each separately OS-locked and PARITY_UPDATE unset:

| Command | UTC start→finish | Result |
| --- | --- | --- |
| scoped11 reassertion |16:16:54.871→16:17:05.713|exit0,11passed10.3s|
| approved decoder404 (`--grep 'visible decode refusal'`) |16:17:30.027→16:17:38.350|exit1 at exact missing decode invocation marker, spec409; intended red|
| restored decoder positive (same grep) |16:17:46.548→16:17:50.340|exit0,1passed3.3s|

Parent read full rawlogs, temporary patch and control-progress04 JSON. Only the decoder case's
held response was replaced by404; assertions remained. `finally` immediately restored23317byte
spec and recorded exactBytes=true/SHAe2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0.
Parent independently rehashed it after positive. No refs updated during the control.

Original decoded assertion now has valid expected-red/restored-positive evidence; do not rerun
the completed mutant without new instruction. Abort404/restored positive and fullcoverage/full
asserted parity remain UNRUN. Fresh explicit allocation required before any continuation.
Reference04 direct review plus scoped assertion pass now proves the refreshed pair; broader/full
acceptance remains pending. Original BAD intake and03 unaccepted artifacts retain that status.
