# sup_sol_dcc1_parity_observer_preparation

2026-08-30. STATUS: preparation complete; temporary source restored. This is NOT a browser capture,
parity pass, reference approval, or product completion. ROLE/MODEL/REASONING: same assigned native
sup_sol / Sol / high, 240k/220k; no new task, worker or worktree. Native tools do not expose task_name.
COMMITS/STAGING: none. Sole light lane explicitly RELEASED to parent after both terminal commands
and exact restoration; all owned processes exited. No further source change or gate after release.

## Authority and scope

Read the [capture approval handoff](../handoffs/2026-08-30-dcc1-parity-capture-approval.md),
[cause receive](dcc1-parity-cause.md), assigned root AGENTS, supplied root project-profile and
coordinator-only board. The board's latest preparation-only allocation and direct operator brief
supersede the handoff's earlier no-patch state. No nearest tests/coordination AGENTS was found.
Used /ui's project parity/browser-evidence route and /hr-debug plus global debug and repo wrapper.
Ref frontend-backend-integration §7.1/D132 and D187 keep semantic evidence, later diagnostic pixels,
and successful pixel assertions distinct. No general UI redesign or live/auth work.

Original red remains the retained actual ae007 parity15690 gate1/logger0: 227 passed/12 failed;
raw SHA256 71ed0d442bf83354f447128b48b7006c4bfcac298c022357f908e55453218300.
Coverage6021 remains gate0/logger0,335 files/3806 tests, raw
cb32fc5f52e2f2421970983db7eb661d586533b412477b62ba1b188200923cc7.
No new reproduction/minimization, browser, test, build, probe or reference update was authorized
or performed. Prior error-context files contain error/test source, not full snapshots.

## Exact retained patch and identities

[Lossless patch/source JSON](../evidence/dcc1-parity-observer-patch.json) contains the complete
baseline source, instrumented source, and exact Git zero-context unified diff as escaped JSON
strings. No raw byte normalization, archive operation, attributes or config change occurred.

| Identity | Exact value |
| --- | --- |
| HEAD | 0c115123a738f62cbe01c9b45f53b7289284479c |
| ordered MERGE_HEAD | 13175b13340fec7b5326207fe54f98078d481d7d |
| unchanged complete index | ae00723e05d20a6c87d0ada500fc77a456870ea9 |
| baseline/restored capture blob | 641378037d2396a6e84003115a5f158f178e17c7 |
| baseline/restored capture SHA256 | 379ce0ad6363b73d92b2af86ed10ac4e1dfc68a81f262c6fd8e66fe7db7d8bb9 |
| instrumented capture blob, stored BEFORE checks | 31776c251399a9b945822c7d796b44468fb6cadd |
| instrumented capture SHA256 | 6472e6bf1d20ffb0608f744e7cfe3f58a77868bfe8bb4b0c94e34a273b13223b |
| exact diff-string SHA256 | bb49d8eaee199691cc432f295625d2fcd631a50fa63a53d6419a5bbcc1eef781 |
| unchanged reference-store blob | 58fec850d0e0140b6ab45fb8fb341d940a16d44f |
| restored execution closure | d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051 |
| instrumented execution closure (in-memory single-row substitution) | 7539930ac1b653fda3c84071d0406efa2313d509d3f71b79fe16e8b55c933bbb |

The instrumented closure is a post-gate virtual/in-memory computation (ce3ea6 exit0), NOT a
contemporaneous gate-time map, staged tree or committed object. It replaces ONLY the capture.ts
entry blob in the original ae007 ls-tree stream, applies the same three coordination-directory
exclusions, and hashes that ordered LF-terminated stream. Gate-time source identity is independently
recorded in both original start/terminal metadata records, not retroactively fabricated.
Only its capture blob was stored
with `git hash-object -w tests/parity/helpers/capture.ts` (4d4cc9 exit0); no index mutation.
Extraction681ae1 exit0 retained exact text. Before restore,0f345e exit0 confirmed the working hash
and stored blob type. Restore used apply_patch, not checkout/reset.049a63 exit0 confirmed baseline
capture/reference-store/index and both diff checks.7f8bba exit0 independently compared stored
baseline/instrumented blob bytes to JSON, checked diff SHA, and checked exact restored bytes.

## Observer mechanism (prepared, NOT executed)

Only tests/parity/helpers/capture.ts was temporarily edited. Public signatures remain unchanged.
Private invocation-local observation state is created ONLY by captureParityPair for the twelve
literal names below. Direct captureA11yReference callers remain unobserved; nonallowlisted pair
calls allocate no observation state, directory, files or diagnostic screenshot.

The original single body ariaSnapshot result passes through the existing nonempty check. That
same string is written to tree.txt unchanged (no appended newline); unchanged reference-store
renderA11yReference and renderMetadataReference serialize actual.a11y.yml and actual.meta.json
BEFORE the same original assertOrUpdateParityReference call. before-assertion.json records separate
systemClock wall time, PID and case name; synthetic metadata/capturedAt is never modified.

Each case claims its own absent directory with nonrecursive mkdir(mode0700). Existing directories
are refused, never adopted. Each file uses wx/mode0600/flush:true. PNG capture returns a buffer,
then that buffer is written exclusively; no screenshot path may overwrite an existing file.
There is no module-load mkdir or capture, no observation of other names and no reference write
introduced by the observer. The future exact command must keep PARITY_UPDATE unset.

| Outcome | Explicit behavior |
| --- | --- |
| ariaSnapshot read throws | Original error propagates; no observer directory/file/PNG; assertion remains uncalled as before. |
| Empty/whitespace-only tree | Existing exact empty-tree Error propagates; no diagnostic artifacts or screenshot; never invent a semantic pair. |
| Tree/meta/timestamp retention fails before assertion | Retain the observation error; STILL invoke the original assertion with the original tree/metadata. Partial evidence is never called complete. |
| Original reference assertion refuses; observer succeeds | Record post-refusal-start.json, capture viewport PNG with animations disabled, write post-refusal.png, record post-refusal-end.json, then rethrow the SAME original error object. |
| Assertion refuses and any observer operation fails | AggregateError errors=[original,...observer errors], cause=original. No fabricated expected red, pass, or error-message substitution. |
| Directory claim fails | No write into that directory, no PNG there; retained claim failure accompanies the original assertion failure (or independently fails an otherwise successful capture). |
| Timestamp/PNG write/capture fails after refusal | Retain that secondary error; no retry/substitute image; original assertion remains primary. Missing end marker means no completed diagnostic-PNG receipt. |
| Semantic assertion succeeds | Original toHaveScreenshot call, name, fullPage option and animations policy remain unchanged. No diagnostic PNG. |
| Semantic/pixel assertions pass but observation failed | Throw explicit observation AggregateError; do not report successful evidence retention. |
| Pixel assertion fails after semantic success | Original pixel error propagates, or is first/cause of AggregateError if pre-assert observation also failed; no post-refusal semantic diagnostic is mislabeled. |

All temporary probes carry [DEBUG-dcc1-observer]. Screenshot timestamps are deliberately later
than refusal; a diagnostic PNG is NOT the screenshot assertion and not proof that pixels passed.
The helper's absence-of-directory return is only the explicit already-retained directory-failure
arm, not successful optional evidence. No public adapter, fixture policy, waits, assertions,
timeouts, masks, thresholds or broad runtime interface changed.

## Twelve exact capture names and future paths

Each name has a distinct directory:
`docs/coordinator/worktree-completion/evidence/dcc1-parity-observer-capture-01--<name>/`.

- `explorer-graph--graphite-warm--1280x720`
- `explorer-transaction--graphite-warm--1280x720`
- `explorer-graph--paper-ink--1280x720`
- `explorer-transaction--paper-ink--1280x720`
- `explorer-graph--graphite-warm--1440x900`
- `explorer-transaction--graphite-warm--1440x900`
- `explorer-graph--paper-ink--1440x900`
- `explorer-transaction--paper-ink--1440x900`
- `explorer-graph--graphite-warm--narrow-1024x768`
- `explorer-transaction--graphite-warm--narrow-1024x768`
- `explorer-graph--paper-ink--narrow-1024x768`
- `explorer-transaction--paper-ink--narrow-1024x768`

Per-case prospective files: tree.txt, actual.a11y.yml, actual.meta.json, before-assertion.json;
on original assertion refusal only, post-refusal-start.json, post-refusal.png,
post-refusal-end.json. Failure can leave a partial subset; report it as partial.

Proposed runner directory: `tests/parity/.output/dcc1-explorer-diagnostic-01`.
Both preflight and restoration checks verified all13 paths ABSENT. None was created. This is
filesystem preparation, NOT capture evidence or an exclusive lease against future same-UID writers.
Admission must recheck/reject collisions and reserve the runner path before a future allocated
command; never reuse a prior runner/diagnostic directory. Original15 outputs remain unchanged.

ONE proposed diagnostic command, NOT EXECUTED; requires independent observer receive and explicit
heavy OPEN:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:parity -- tests/parity/dashboard-reference.spec.ts --grep 'explorer-(graph|transaction)$' --output=tests/parity/.output/dcc1-explorer-diagnostic-01
```

Static spec inspection finds these two state IDs within the three-viewport/two-theme matrix;
twelve-case selection is predicted, not freshly listed or run. No added retry. Proposed future
disk-first process receipts: evidence/dcc1-parity-observer-diagnostic.raw.log and
evidence/dcc1-parity-observer-diagnostic.meta.jsonl (verify absent again at admission).
Read-only packaging receipt92b0db exit0 also verified both proposed process-receipt paths and the
runner directory absent, all report links resolvable, exact nine owned outputs, and indexae007.
Future bundle helper may legitimately restamp; preserve original stamp before any authorized
run, bind instrumented closure explicitly, retain both identities, and do not imply unchanged
instrumentation. Complete12-tree/meta comparison and per-case visual PNG review remain required.

## Executed light commands and raw receipts

Exact sequential commands, instrumented blob31776c25 throughout:

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

| Command | Native session / chunks | UTC start → terminal | Seconds | gate/logger/wrapper |
| --- | --- | --- | ---: | --- |
| typecheck | 65879;766ab6 start,fe6bfb running,bbed48 terminal | 18:01:43.182Z →18:01:59.510Z | 16.323385708 | 0/0/0 |
| lint | 90307;ec782e start,52bd00 running,24f167 terminal | 18:02:06.372Z →18:02:34.098Z | 27.724275875 | 0/0/0 |

Both signals null, logger errors empty. These are typecheck/lint results, no test counts.
[Exact inline logger source](../evidence/dcc1-parity-observer-logger.json) is retained as text;
it was passed via stdin, not installed as a product helper. Both raw/meta destinations were checked
absent and opened wx0600. Child stdout/stderr buffers were fully written and fsynced BEFORE tool
transport, in observed callback arrival order (no stronger cross-pipe ordering claim). Gate and
logger exits are separate terminal metadata; the logger's transported LOGGER_TERMINAL line is
NOT in the raw child file. Metadata also pins command/args/cwd/PID/time/source/index. Native session
IDs come from tool receipts above, not invented child metadata.

Raw output contents consist only of npm's command banners; there were no diagnostics:
typecheck57bytes; lint81bytes. Preflight/restoration JSON is annotated filesystem/command metadata
returned through tool transport and persisted with apply_patch, NOT mislabeled raw process streams.

## Preservation and receipts

[Preflight](../evidence/dcc1-parity-observer-preflight.json):41266a exit0.
[Restoration](../evidence/dcc1-parity-observer-restored.json):7f8bba exit0.
Each confirms1,923 non-coordination tracked blobs (including all603 reference files) against exact
index entries and1,445 retained byte/hash checks:600 bundle inputs,91 outputs,stamp,15 original parity
artifacts,653 coverage artifacts,5 prior gate evidence files and40 original/archive pairs.
The same inventory digests match before/after; original53 coordination outputs and parentdcc1.md
bytes are also preserved. No unresolved entries. Index and both diff checks unchanged.

No new browser artifacts were generated. Original ae007 stamp remains SHA256
20773190626ec0f7bbc914f46c00d5610a0cc1aa58735eef25e27ca43286246e,
input f3b154df374d21e1f107ba31219ef339e2747c0aab53ee89aef127950c06dae4,
output87f1d808ff832b32a1a6ddfb4a99c7088e91bbea7ccd660fbdc21c1c888d5be7.
40 plaintexts and archives remain untouched; no old archival grant was reused.

Preparation read-only receipt limitations: an initial oversized inventory JSON exceeded tool output
transport and JSON parsing failed, before any source edit or gate. It was not a product failure or
usable complete receipt; the smaller digest/count/full-failure-list receipt41266a supersedes it.
A worktree-local board lookup failed; handoff identifies the actual root coordinator board, which
was then read (no write). Neither read-only lookup is labeled a gate red.

## Owned artifacts

Only these eight evidence files and this report are new; all remain unstaged:

| Path (evidence/) | Bytes | SHA256 |
| --- | ---: | --- |
| [dcc1-parity-observer-lint.meta.jsonl](../evidence/dcc1-parity-observer-lint.meta.jsonl) | 1358 | d9c6b39da424eee65f7dd67748abb23778a4c70eb5dea01f2ae83de8088dd475 |
| [dcc1-parity-observer-lint.raw.log](../evidence/dcc1-parity-observer-lint.raw.log) | 81 | cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385 |
| [dcc1-parity-observer-logger.json](../evidence/dcc1-parity-observer-logger.json) | 3020 | ce9238d93e914f4661e8a9ae5d44224973fdcbdeb09da9626dc0d5030e11e238 |
| [dcc1-parity-observer-patch.json](../evidence/dcc1-parity-observer-patch.json) | 26942 | d9c171449348cc55ffe9e058d368bba840ef3480ea7b407c1deb851dc4a751ab |
| [dcc1-parity-observer-preflight.json](../evidence/dcc1-parity-observer-preflight.json) | 23088 | 9feea7219b3cb4f41e4df05cad6d9dd0d1cc16fd44b186421d8f0452750f7972 |
| [dcc1-parity-observer-restored.json](../evidence/dcc1-parity-observer-restored.json) | 31822 | 605c853ac55af0463c09eabfaabf9f71cccaa847d62280e54d185fdfd32684fd |
| [dcc1-parity-observer-typecheck.meta.jsonl](../evidence/dcc1-parity-observer-typecheck.meta.jsonl) | 1378 | 975bcf7a24aedc56f79185a729d7102cd02070611503fa9ed0c59840bba503c1 |
| [dcc1-parity-observer-typecheck.raw.log](../evidence/dcc1-parity-observer-typecheck.raw.log) | 57 | ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036 |

Hashes above precede this report's creation; report self-hash is returned separately.
Source restored; no product/AGENTS/guard/config/migration/history/reference edits survive.

## Remaining review/permission boundaries

Parent receives immutable instrumented blob + exact patch + restoration receipt, then independently
reviews Tests/Standards/UI/Spec. Typecheck/lint do NOT prove behavioral error ordering, exclusive
filesystem failure behavior, actual twelve-case selection, Playwright capture completion or visual
equivalence. No tests/mutations/browser were permitted, so those runtime proofs are unexecuted.
Hidden additional UI differences remain unresolved until actual paired evidence exists; no
fingerprint waiver follows. No heavy reservation or NEXT claim. Migration/D75/shared integration,
merge commit, committed-archive durability and board close-out remain separately owned/open.
