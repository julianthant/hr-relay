# DCC1 ae007 — parent gate receive

2026-08-30. Coverage received GREEN; asserted parity received RED. Heavy slot released immediately
at terminal before postflight/report/artifact analysis; no repair, reference update or commit.

Read the complete [gate-unit receipt](dcc1-ae007-full-gates.md) for exact commands, sessions,
start/end times, raw-vs-metadata provenance and all twelve named cases.

| Proof | Independently received result |
| --- | --- |
| Preflight98755 | 415 checks, no errors, pass true;637675bytes/SHA256 `0e9cde854ec1b5751fd9dd96c38e49439592d205f9ee308f6b91a336ea65e1f1` |
| Coverage6021 | gate0/logger0,335files/3806tests,326.42s Vitest/327.810s command;47416bytes/SHA256 `cb32fc5f52e2f2421970983db7eb661d586533b412477b62ba1b188200923cc7` |
| Between-gate69966 | verifier1 solely because generated ignored coverage/ appeared; other407 checks exact; separately recorded generated-output classification, not relabeled green |
| Parity15690 | gate1/logger0,signalnull,227passed/12failed of239,219.457s;75758bytes/SHA256 `71ed0d442bf83354f447128b48b7006c4bfcac298c022357f908e55453218300` |
| Postflight36114 | 414 checks all actual==expected, no errors,159 subprocesses all0;905565bytes/SHA256 `00b5c499f65d9459c58f82992d2a186c123b6430522943782581d39810388bd5` |

Parent read raw summary lines, coverage percentages and suite-size output, actual terminal metadata,
all twelve parity failure headers and representative complete error blocks. Coverage statements
84.53%,branches74.86%,functions88.26%,lines86.51%; the suite-size step ran and is informational,
not independently relabeled a hard gate. The original historical0b5 coverage red is untouched.

The twelve cases are explorer-graph and explorer-transaction, each in both graphite-warm/paper-ink
at1280x720,1440x900,narrow1024x768. All report a11y reference drift at dashboard-reference.spec.ts474.
Graph's first printed difference is search-person-org implementation fe99beff4f72→843937a26347;
transaction's is read-job-summary692804fed6ae→847db5229dea. These are observations, not proof
that they are the only changed lines or authorization to update references.

`captureParityPair` asserts accessibility before screenshot comparison. No passing screenshot
claim applies to those failed cases. Preserved postflight inventory contains12 error-context
Markdown files, `.last-run.json` and two observed-log PNGs, not twelve completed Explorer PNG captures.
Correction: parent initially described those error contexts as postfailure snapshots. Read-only
inspection85bf53 verified that ALL12 contain only Instructions/Test info/Error details/Test source,
with no Page snapshot or YAML block. Full actual accessibility trees, actual metadata and failed-case
PNGs are not retained. Full twelve-snapshot equivalence and absence of later differences cannot
be established from these files. No new capture is authorized by this finding.
The bundle stamp and all600 input/91 output file hashes are retained; current input
digestf3b154df374d21e1f107ba31219ef339e2747c0aab53ee89aef127950c06dae4 and output
87f1d808ff832b32a1a6ddfb4a99c7088e91bbea7ccd660fbdc21c1c888d5be7 match postflight.

Parent verification correction: command chunk0d761c exited1 because it incorrectly expected
metadata event `end` with `gate/logger`, whereas this logger uses `terminal` with
`gateExit/loggerExit`. Corrected read-only chunkcac548 verified actual0/0 and the sole between-gate
ignored-output mismatch. This was a parent receipt-parser error, not a product failure or rerun.
Large JSON/tool display truncation was handled by selective reads; complete retained files remain
the evidence, and no truncated transport text is relabeled raw.

Complete tested index remainsae00723e05d20a6c87d0ada500fc77a456870ea9 with execution closure
d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051. HEAD0c115123 and ordered
MERGE13175 unchanged. No executable/reference/input mutation occurred. All40 plaintext originals
and archives remain intact; new gate logs/metadata/output artifacts are retained without cleanup
or archival transformation. New parent report evidence is not an execution input.

Coordinator authorized only bounded read-only /ui+/hr-debug saved-output/source/provenance
diagnosis through the same native Sol unit. Four falsifiable hypotheses were shown first:
reviewed closure movement with stale references; wrong bundle/fixture; unpinned nondeterminism;
additional differences hidden behind the first mismatch. No new browser reproduction, gate,
source/ref fix, mask, normalization, threshold change, staging or commit is authorized.
Migration history/D75/shared integration boundaries are unchanged. Full-green readiness remains open.
