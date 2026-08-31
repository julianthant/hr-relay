# DCC1 renewed diagnostic — parent receive and two-inventory proposal

Status: source restored; no browser command ran. Heavy allocation CLOSED; no NEXT.
No launcher repair, retry, new review, source/reference change, stage, commit or cleanup.

Read complete [worker report](dcc1-parity-observer-diagnostic-renewed.md.gz), exact retained
[launcher](../evidence/dcc1-parity-observer-diagnostic-command.json), and
[postflight](../evidence/dcc1-parity-observer-diagnostic-postflight.json).
Parent scripts, complete path partitions and evidence are in
[one receive record](../evidence/dcc1-parity-observer-diagnostic-parent-receive.json).

## Outcomes, not inferred passes

| Operation | Evidence / outcome |
| --- | --- |
| Advanced exact278 preflight | 0f0a5f exit0, inventory0/logger0, 1923tracked/1511retained/112planned; only approved inventory block changed |
| Preservation | 02f655 exit0; all112 original and destination bytes/modes match |
| Launcher | c006ea exit1 before map persistence, log opens, runner reservation or lockf/browser child |
| Worker restoration | f35d25 source checks exact, but overall record remains pass:false on guessed107 ignored-count check |
| Parent priority restoration | 4644cb exit0: capture641/test6bde/ref58, all1923 working blobs, original278, indexae/closured681,15futurepaths absent |
| Parent physical/visible partition | b0f1d8 exit0: exact112 physical files,92 ignored by named rule,20 visible |
| Parent combined receive | e2e833 exit0: exact all original/current receipts, copies, raw/meta, approved source delta, failed launcher identity and complete two-inventory relation |

The successful admission's source SHA is
`6ba0063f6e3ed91fe79124cf1559bb0a41650a49a7e8966026e896227bdde7c7`.
Its complete raw JSON is708854bytes SHA
`abb4c4b52f084ff249917d407f1622e3b008b5b571384b0bbead66e33fcfce5f`;
metadata7987bytes SHA
`42bdb4ebfb4e2b5785710b54a4cc0210967878464684a77a8b7b2ee53ed31918`.
Start19:09:44.862Z/end19:09:45.711Z, child0/logger0. Raw buffers and separate observed
start facts were persisted AFTER terminal and BEFORE tool transport. Not falsely
described as metadata fsynced before child spawn.

Launcher command artifact14073bytes SHA
`ae87e77b313c47fd584e21657fc8cd637cb647dd77c3df59fb363d542fcecb85`
contains the exact executed source. Its returned assertion text was transport-truncated
(10242 original tokens); there is no complete raw launcher log. No browser gate/logger
exit, actual instrumented map or screenshot is invented. Its failure check precedes
all output creation and child spawn in the inspected source.

Worker postflight542248bytes SHA
`8dd76a36f3a28971892c2759ab21530b2157aae72dbe7f49c9ee684c1661420b`
remains `pass:false`, `failures:["107 preserved ignored files"]`. Its exit0 proves
script completion only. Parent checks are independent, not a rewritten worker verdict.
Original95374 and corrected52914 failures remain immutable too.

## Exact cause and smallest proposal

The launcher mixed two different sets. Git's `--exclude-standard` listing does not
include ignored files, while its expected list contained every physical preservation
copy. The fixed [copy manifest](../evidence/dcc1-parity-observer-diagnostic-admission.json)
is141187bytes SHA
`5f70e731063fa20a7023c35ee7be87be64c6c547bd75def30ea95177114dbce4`.

All112 copies exist with exact original bytes/SHA256/mode. Of these,92 under copied
`dist/` are ignored by **.gitignore:45:dist/**;20 remain Git-visible. The copied
`.output` descendants are visible. Initial “dist/.output” inference was too broad.

Proposed replacement for the ONE conflated predicate, not applied:

```text
C = exact destination paths from the fixed112 copy manifest
I = exact members of C classified ignored by git check-ignore -v -z --stdin
O = pinned original non-execution input paths
R = exact separately declared receipt paths

walk(copyRoot).files == C
every C entry: regular non-symlink, exact original bytes/hash/mode
I is a unique subset of C; retain each exact ignore-rule provenance
GitUntracked == O ∪ R ∪ (C − I)
```

No hard-coded ignored count, count adjustment, broad path/report exclusion, ignore
configuration change, deleted copy, or weakened hash/source/reference predicate.
Physical membership is checked independently so ignored extras, missing or changed
copies still refuse. Byte/mode checks do not depend on Git visibility.

At launcher time: O278 + R4 + C112 =394 physical declared files,302 Git-visible.
At independent receive after the worker's report/postflight: O278 + R6 + C112 =396,
304 visible. Parent receipt/report/handoff add exactly three separately declared
non-execution paths, yielding399 physical declared /307 visible after packaging.
These are observed lifecycle totals, not constants to make a test green.

## Verified restored identity

HEAD0c115123a738f62cbe01c9b45f53b7289284479c;
ordered MERGE_HEAD13175b13340fec7b5326207fe54f98078d481d7d;
indexae00723e05d20a6c87d0ada500fc77a456870ea9;
closured681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051.
capture641378037d2396a6e84003115a5f158f178e17c7;
test6bdebc160f537079eeea8c4db6369ad1069ab9e1;
reference-store58fec850d0e0140b6ab45fb8fb341d940a16d44f.
Only pre-existing parent dcc1.md is unstaged; no unmerged entries, both diff checks0.
All original278 bytes/modes,112 copies and corresponding originals, reference bytes,
old stamp and40 plaintext/archive originals retained. No new build stamp exists.

The same native sup_sol/high240k220k completed and was closed. No process remains.
Only minimal launcher correction/renewed allocation is pending coordinator disposition;
there is no new reviewer/preparation request. Existing successful no-browser proof and
review closures stay valid, without claiming UI/pixel acceptance.

[Recovery handoff](../handoffs/2026-08-30-dcc1-two-inventory-received.md) preserves the
blocked boundary. /supervise governs the bounded receive; /ui and /hr-debug preserve
semantic/visual evidence limits; /handoff records this partial stop. Earlier handoffs
remain because pending merge/full parity/archive durability/history/D75/board closure
are unresolved. No cleanup authority is inferred.
