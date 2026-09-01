# DCA4 A3 repair — frozen UI receive receipt

## Status and ownership

2026-08-30. **UI repair implementation and serial light gates complete; DCA4 acceptance remains
partial, awaiting allocated rendered/parity proof and independent rereview.** No staging or commits.
This receipt freezes the UI writer's return and relinquishes sole write ownership. No owned command
or browser session remains active. No coverage, parity, browser, or build command ran in this repair
turn. The earlier A3 receipt remains historical; this receipt supersedes its implementation/gate
status and its inaccurate claim that the evidence fixture was already profile-isolated.

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
- Branch: `feature/dca4-archive-evidence`.
- HEAD before/after: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
- All commands ran with that explicit workdir; all edits were absolute paths within it.
- Backend/domain/root AGENTS/owning references and server tests were not edited. Inherited dirty
  work remains intact. No shared DS, artifact-bytes helper, board, or unrelated corpus edits.
- Skills used: `/ui` established-product Operate/states/hardening/craft route; `/tdd` existing-code
  regression mode at the parent-confirmed UI/fixture seams; `/hr-debug` plus global `/debug` for the
  worker-loss diagnosis. These required red controls, attempt-level proof, and honest deferred browser
  acceptance. No new model/test sibling was needed; private components and hook stay in existing files.

## Independent findings: raw counts and dispositions

These are implementation dispositions, not a claim that independent rereview has cleared them.
Overlapping findings retain their original axis and severity/count.

| Input | Raw finding | Repair and proof |
| --- | --- | --- |
| [Correctness](dca4-a4-ui-correctness.md), medium 1/2 | Stale `image.decode()` completion overwrites the current image | Mounted-image ref plus unique decode-attempt ownership; old success/rejection after current success pinned for next and close/reopen. |
| Correctness, medium 2/2 | URL plus close-only epoch reuses ready on A→B→A | Private preview mounts per capture; A→B→A starts loading even when B is non-image or never decoded. Both red before repair. |
| [Silent failures](dca4-a4-ui-silent-failures.md), medium 1/1 | Readiness survives navigation and an earlier decoder can attach to another capture | Same per-mount/per-attempt repair, independently retained as this axis's one medium. |
| [Performance](dca4-a4-ui-performance.md), medium 1/1 | 128px skeleton shifts metadata when intrinsic image loads | Shared reserved preview frame for metadata check, HTTP load, decode, success and failure. Frozen aspect ratio when present; explicit bounded shell with no invented ratio when absent. Unit shape invariance green; actual pixel invariance prepared, not run. |
| [Tests](dca4-a4-ui-tests.md), medium 1/2 | Immediate resolved decode cannot prove waiting; rejection/zero dimensions unpinned | Deferred decoder, pending-caption absence, rejection, zero width and zero height tests; deliberate premature-ready/dimension-bypass control makes all four red. |
| Tests, medium 2/2 | Old metadata resolves before current, allowing identity rendering to mask a missing active guard | Current success first, then old success/rejection, for next and close/reopen. Removing both active guards makes all four red. |
| [Standards](dca4-a4-standards.md), medium 1/2 | Fixture resource response bypasses owning strict schema | `ArchivedCaptureResourceWireSchema.parse` at the fixture response boundary; named fixture unit suite validates the response and real bytes. |
| Standards, medium 2/2 | Changed byte metadata retains cloned archive fingerprint | Seal a declared canonical durable record with `archivedRunContentDigest`, validate `ArchivedRunRecordSchema`, then project wire. Never hash a partial wire reconstruction. |
| Standards, low 1/2 | No intrinsic dimensions/reserved aspect ratio | Exact frozen width/height and reserved frame; explicit absent-dimensions shell and truthful “dimensions were not recorded” reason. |
| Standards, low 2/2 | Stale comment says viewer can never have bytes | Comment now distinguishes frozen capture metadata from the exact retained-byte read. |
| Parent additional fixture finding | “Dedicated profile” claim contradicted unconditional normal archive route | Explicit `archiveScenario: "evidence"` opt-in through fixture app/server. Default detail/index preserve the original broad corpus; evidence resource/download unavailable without opt-in. |
| Parent locked lint | `archive-model.ts` missing `request` exhaustive dependency | Memoized scalar request identity and effect dependencies `[read, request]`; no suppression. Final full lint green. |

Counts retained: correctness **2 medium**; silent failures **1 medium**; performance **1 medium**;
tests **2 medium**; standards **2 medium + 2 low**. Parent additional findings are separate.

## Code and contract rationale

- `archive-model.ts` derives stable request identity from run ID, artifact ID and viewer epoch, not
  render-sensitive tile object identity. Abort and active guards remain; pre-effect renders refuse
  another identity's resource. The injected client boundary checks BOTH echoed IDs and the exact
  download URL. New foreign-ID regressions retain the correct URL so URL validation cannot mask them.
- The mounted image owns its latest decode attempt; detach/error invalidates pending completion.
  Success requires completed decode and positive natural dimensions. Metadata success alone cannot
  produce the caption. Image HTTP/decode failures stay visible and frozen facts remain accessible.
- `archive.tsx` reserves the same preview slot before and after readiness. Frozen dimensions supply
  the aspect ratio; absent dimensions use `min(20rem, 56dvh)` without an invented ratio. The image
  fits inside the slot; messages/caption do not change its height. Non-image bytes remain download-only.
- **Local focus behavior changed:** `ArchivedRunDetail` records the actual tile button opener and
  schedules focus return on close, guarded by a generation advanced on open/close/run change and by
  connectedness. A stale scheduled close must not steal focus after a newer open. The two full-detail
  regressions retain exact opener identity for footer Close and Escape. Shared Dialog is unchanged.
  This behavior and ownership are recorded in `src/dashboard/AGENTS.md` for correctness/a11y rereview.
- Header Close, footer Close, Download and navigation have local coarse-pointer touch floors. Actual
  effective hit points, 44px rectangles and nonoverlap still need the allocated browser proof.
- Fixture authority starts from the declared durable `ARCHIVED_RUN_WITH_SECTIONS` seed, declares its
  evidence capture/pointer and other complete content facts, seals that canonical record, then
  derives detail/index wires. The original `fixture-archive.ts` is unchanged. Own canonical run ID:
  `99999999-0009-4000-8000-999900000009`; capture ID:
  `aa11bb22-000a-4000-8000-aa11bb22000a`.
- Exact deterministic PNG: **3281 bytes, image/png, 1440×900**; SHA-256
  `f3ede4591dd6034661d8d63aef43ce4734610be67edbc7e30ce68834ebcd3847`.
  Fixture tests compare schema, sealed digest/index/detail, PNG signature/IHDR, download bytes and
  headers. Safe owned ArrayBuffer conversion retains no unchecked BodyInit assertion.
- No production wire/backend contract changes are expected or made; fixtures consume frozen schemas.

## Red-first and mutation evidence

Every Vitest invocation used `VITEST_MAX_WORKERS=1`. No timeouts, assertion limits, thresholds,
watchdogs, worker-count increases, skips, or linter suppressions were added in this repair turn.
Times below are local terminal start times on 2026-08-30.

The base render command was exactly:

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts
```

| Command/selection | Red or negative control | Restored proof |
| --- | --- | --- |
| Base render command | 07:36:55: 6 failed / 26 passed, 3.81s; four stale decoders and two A→B→A cases | 07:37:50: 32 passed, 3.62s |
| Base render command after geometry regressions | 07:38:34: 2 failed / 32 passed, 3.19s; missing loading preview shell | 07:39:35: 34 passed, 3.78s |
| `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-evidence-fixture.test.ts` | 07:40:04: 2 failed / 1 passed, 2.52s; default corpus changed and stale fingerprint | 07:41:32: 5 passed, 2.52s |
| Base render command plus `-t 'declares the coarse-pointer touch floor'` | 07:45:11: 1 failed / 34 skipped, 3.51s; Download missing touch floor | Included in final green |
| Base render command plus `-t 'preserves current metadata'` | 07:50:00: 4 failed / 33 skipped, 3.19s with BOTH active guards temporarily removed | Guards restored; final green |
| Base render command plus `-t 'withholds the verified-image\|keeps decode-rejection\|keeps zero-width\|keeps zero-height'` | 07:50:15: 4 failed / 33 skipped, 2.56s with premature readiness/dimension rejection bypassed | Correct decoder restored; final green |
| Base render command plus `-t 'unrecorded dimensions'` | 07:51:04: 1 failed / 38 skipped, 4.29s; image falsely described as non-image | Truthful absent-dimension reason; final green |

The selection pattern in the decode command uses literal regex alternatives (`|`); table escaping
above is Markdown-only. Negative controls were restored before the final focused run.

### Worker-error diagnosis and retained focus regressions

Original red-capable command:

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts -t 'returns focus to the actual archived capture opener'
```

07:43:30, duration **37.97s**, exit 1: 34 skipped, two unresolved cases (36 total then).
Exact reported error:

```text
Error: [vitest-pool]: Worker forks emitted error.
Caused by: Error: Worker exited unexpectedly
```

The exploratory focus tests were briefly removed before diagnosis; both were restored, diagnosed,
and retained. No meaningful regression was discarded. The global debug loop compared the same
completed interaction with a local focus fix enabled/disabled and equivalent identity assertions:

```sh
/usr/bin/time -l env VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts -t 'returns focus to the actual archived capture opener'
```

| Time / controlled variant | Observation |
| --- | --- |
| 07:46:00, local focus fix enabled, original raw DOM identity assertion | 2 passed / 35 skipped, 3.29s (3.80s wall); maximum RSS **398770176 bytes** |
| 07:46:25, only local scheduled focus return disabled, boolean exact identity assertion | 2 failed / 35 skipped, 2.53s (2.97s wall); maximum RSS **441843712 bytes**; ordinary assertion `closing the archived viewer lost its opener focus`, `false !== true` |

Reproduction of the raw DOM mismatch reporting, still with focus return disabled:

```sh
/usr/bin/time -l env VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts -t 'returns focus to the actual archived capture opener after button$'
```

07:46:44: **23.95s** (24.40s wall), same worker error; maximum RSS **2989621248 bytes**.
Only the owned child (PID 9010) was inspected: RSS 1778688 KiB at about 5s and 1270000 KiB at about
18s with high CPU. All `[DEBUG-dca4]` phase probes had already reached detail mounted, Evidence open,
capture open and capture closed before worker loss.

This controlled differential locates the resource spike/worker death in raw-DOM mismatch reporting,
not a render loop, while also proving a genuine local focus defect. The runner did not expose an OS
exit signal; this receipt does not attribute it to an external scheduler or assert a confirmed OS OOM.
The final tests use `assert.equal(document.activeElement === opener, true, ...)`: the **same exact DOM
identity invariant**, with bounded boolean failure diagnostics. Both Close/Escape cases remain.
Restored full render suite: 07:47:27, 37 passed, 5.33s; final suite adds the foreign-ID cases below.
All `[DEBUG-dca4]` probes were removed. No foreign process was killed; no own watchdog was used.

## Final serial light gates

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/archive-capture-resource-client.test.ts tests/unit/dashboard/archive-view-model.test.ts
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

| Gate | Result |
| --- | --- |
| Final focused command, 07:51:13 | **5 files / 76 tests passed**, 11.45s; archive-render has 39 tests |
| Locked full typecheck | Passed, exit 0 (final owned session 56387) |
| Locked full lint, first pass | Red: parity spec lines 175/282 captured unbound decode methods; production exhaustive-deps finding was resolved |
| Lint repair | Bind native decode to the exact intercepted image element; decoder-refusal override also stays on that element. No prototype-wide override or suppression |
| Locked full lint, final pass | Passed, exit 0 (owned session 78134), zero warnings |
| `git diff --check` | Passed |
| `git diff --exit-code -- tests/parity/helpers/fixture-archive.ts` | Passed; original broad fixture untouched |
| Probe/suppression check | No `[DEBUG-dca4]`, `eslint-disable`, `test.skip` or `it.skip` in repaired source/test paths |

No production/unit changes followed the final focused run. The subsequent changes were limited to
the parity decoder binding and indentation; full typecheck and lint cover the final semantic version.

## UI acceptance ledger and prepared browser proof

`tests/parity/archive-evidence.spec.ts` now prepares **11 tests**, but none ran during this repair.
Only its two existing happy-view reference triplets are capture targets; other tests assert behavior.

| [Ledger](../briefs/dca4-ui-verification.md) item | Passing light proof | Prepared, NOT yet executed rendered proof |
| --- | --- | --- |
| 1. Exact image/download bytes, no substitution | Named fixture suite: strict resource, sealed record, exact bytes/digest/size/media/IHDR | Desktop dark + coarse-touch phone light: actual native decode, natural dimensions, exact href and downloaded stream before screenshot |
| 2. Metadata success is not image success | Deferred decode, rejection, zero dimensions, HTTP failure and stale decoder regressions | Staged native decode barrier with no premature caption; visible image HTTP and decoder refusal after successful resource metadata |
| 3. Reference placement/intake evidence | Parent preserved the bad PNGs; no reference artifacts changed by this repair | Refresh then inspect only the two allocated `tests/parity/references/archive-evidence--*` triplets, then assert without update |
| 4. Available/missing/corrupt/unavailable preserve facts; no invented purge | Existing frozen-fact arms, request failure, non-image download-only; canonical fixture proof | Five named refusal cases: missing, corrupt, request 503, image HTTP abort, decode rejection; frozen IDs/digest/size/media/dimensions/retention visible, no success or fabricated “purged” |
| 5. Stale/foreign/abort | Next and close/reopen abort; current-before-old success/rejection; exact echoed IDs with correct URL; foreign URL; A→B→A; per-mount decode | Browser close/reopen fresh readiness; unit races remain the primary concurrent proof |
| 6. Keyboard/focus/phone/narrow/geometry | Two actual full-detail opener identity tests; coarse class floors; frozen and absent-dimensions frame consistency | Separate desktop Enter/Escape/reopen/footer traversal/focus test; touch+mobile context explicitly asserts `(pointer: coarse)`, all control 44px rectangles, edge hit ownership/nonoverlap; phone/narrow overflow and body/footer separation; desktop/phone resource→HTTP→decode→ready bounding-box equality |
| 7. Typed body and unnecessary assertions | Safe ArrayBuffer conversion retained; full typecheck/lint green | No additional visual assertion needed |

Absent frozen dimensions are explicitly tested as absent (no aspect ratio fabricated). The actual
rendered dimensions-present path is staged in both reference viewports; absent-shell browser proof
is not claimed by a fixture that declares dimensions. Refusal overrides use valid frozen wire arms
or named client transport/decoder failures; none invents server tombstone authority.

The two original broken images are **BAD intake evidence, not current proof**. Parent preserved them
under `docs/coordinator/worktree-completion/evidence/dca4-intake/` and removed the empty old snapshot
directory. Verified original hashes:

- `archive-evidence--graphite-warm--1280x720-darwin.png`:
  `b02cb4260ce632be81ea0c2c81f6ffb8ad38f0eca07a7539204aaf617599dc33`.
- `archive-evidence--paper-ink--phone-390x844-darwin.png`:
  `9f4283369844d0af97cff87519ceda0c6edc0def9bdae6ac491f83ee92b452a8`.

Inherited a11y/meta files are not accepted rendered proof. No PNG or reference refresh is silently
claimed. Actual screenshot inspection, a11y outputs and coarse-pointer geometry remain acceptance
work for the coordinator-allocated parity lane, not a reason to retain sole write ownership now.

## Frozen diff identity

Tracked UI patch identity is the full owned diff **against HEAD**, including inherited A3 UI work,
not an incremental repair-only patch. Exact pathset/hash command:

```sh
git diff --binary -- src/dashboard/AGENTS.md src/dashboard/client/queries.ts src/dashboard/surfaces/archive-model.ts src/dashboard/surfaces/archive.tsx tests/parity/helpers/fixture-bff.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-render.test.ts | shasum -a 256
```

- Received before: `41e10b89b380b1b779471bcb265a352fb720f4f601246c793aca3977de7fd350`.
- Returned after: `d62a186b12275150e1a46c13d49bf165ece44ef404efc29fd9194757f6c9d251`.

| Tracked path | Added / removed vs HEAD |
| --- | --- |
| `src/dashboard/AGENTS.md` | 23 / 0 |
| `src/dashboard/client/queries.ts` | 23 / 0 |
| `src/dashboard/surfaces/archive-model.ts` | 135 / 9 |
| `src/dashboard/surfaces/archive.tsx` | 173 / 21 |
| `tests/parity/helpers/fixture-bff.ts` | 44 / 6 |
| `tests/unit/dashboard/archive-detail-render.test.ts` | 6 / 0 |
| `tests/unit/dashboard/archive-render.test.ts` | 494 / 5 |
| **7 tracked files total** | **898 / 41** |

Four new code/test files, **664 lines total**, separate from that tracked patch hash:

| New path | Before SHA-256 | After SHA-256 | Final lines |
| --- | --- | --- | --- |
| `tests/parity/archive-evidence.spec.ts` | `f382714beed01d8f363a75f39ba11cfb8897a253309656a70a5891b0d82ddeed` | `7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0` | 317 |
| `tests/parity/helpers/fixture-archive-evidence.ts` | `224c7144203e57b66c3130e3be4d72e9f5b80606751c817a00851dff459a32c7` | `3877360ad3540f5579a47c4f4e88be8c366b29332895f4772c53145474792757` | 220 |
| `tests/unit/dashboard/archive-capture-resource-client.test.ts` | `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f` | `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f` | 33 |
| `tests/unit/dashboard/archive-evidence-fixture.test.ts` | `f9fbb19b254032ffccf7aa4ec56e764bd8dcd2bc25e208917c62a46270d059f4` | `1c9dd28762e252ff3108ba933de010fb8399d7e64dbe17d4576dffd5b4688017` | 94 |

Scope total: **11 UI/code/test paths + this receipt**. Existing backend, parent report and reference
files visible in whole-tree status are not part of this writer's returned patch.

## Receive next steps — parent owned

1. Rerun focused acceptance as desired and independent correctness/a11y rereview, explicitly including
   the local focus-return generation and deferred image attempts. Review canonical fixture/profile
   isolation and stable layout against the frozen hashes above.
2. After coordinator allocation only: narrow `npm run test:parity:update -- tests/parity/archive-evidence.spec.ts`,
   inspect the two resulting screenshot/a11y/meta triplets, then
   `npm run test:parity -- tests/parity/archive-evidence.spec.ts` without update. No blanket refreeze.
   Prepared behavior assertions may return concrete browser findings; they are not presumed green.
3. Parent owns required full coverage/full parity and final independent review. No commits until the
   complete required gates pass. Pending logical commit categories: viewer lifecycle/layout/focus
   behavior plus nearest AGENTS, then fixture/regression/parity evidence (with only approved reference
   triplets). Parent may choose category boundaries for inherited changes; no catch-all staging.

**Writer released.** No further write or gate is running, and no backend/product contract expansion
is requested. Browser proof is pending scheduling, not represented as completed acceptance.
