# DCA4 A10.2 — app-owned Receipt capture consumer

2026-08-30. **Implemented, focused-proof complete, frozen uncommitted delta. Writer/light ownership
relinquished on this return.** No active owned process remains. DCA4 product acceptance and historical
full-coverage-05 are NOT green; no browser, coverage, build, parity, reference update or commit was run.

## STATUS / ROLE / MODEL / REASONING / COMMITS

- Role: sup_terra_dca4_a10_receipt_consumer, requested native Terra/high, 240k/220k.
- One seam: LoadedApp → capture-local hook → LogPanel → full/short Receipt → native capture controls.
- HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; branch `feature/dca4-archive-evidence`; index empty.
- Every shell command explicitly used `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`; every edit was absolute within it.
- Read the binding root implementation brief/profile/board/run-plan, A10.1 authority receipt,
  parent A10 consumer report, relevant AGENTS/DESIGN and full /ui + existing-system Operate
  references, /tdd + good-tests. Operator-confirmed D292 seams needed no new decision.
- /ui preserved the existing Dialog/Button/token vocabulary, local coarse floors, separated image
  viewport/caption/metadata and explicit refusal. /tdd drove actual-app red→green increments and
  exact-restored lifecycle/literal-frame controls. No shared primitive or aggregate-hook changes.
- No backend/schema/client/guard/fixture-HTTP/parity fixture/spec/reference/materializer/writer/
  migration/auth/live-HR change. No root or board writes, staging, commits, merge, foreign workers
  or new tasks. Existing A5–A8 and A10.1 product work is preserved.

## Delivered behavior

`LoadedApp` passes explicit requested `route.run`, loaded detail run/revision and effective active
Receipt tab to `useRunCaptures`. This is separate from unmodified `usePanelSections` and
`useRunDetail`. It does not infer requested identity from the detail that the shared hook may
temporarily retain. Same-key detail object recreation is not a new product owner.

Read/selection generations invalidate during render before old native URLs can commit. Each
request has an AbortController and a live/owner publication boundary; late success AND rejection
cannot overwrite current run, revision or reopened Receipt success even if transport ignores abort.
Unmount aborts. Inactive or unadvertised sections do not fetch. Missing live availability,
availability/advertisement disagreement, authority errors, malformed/wrong-section/foreign-run
responses and count disagreement remain local visible refusals, never fabricated empty data.

The real client/parser supplies the capture list and its one-ID `artifactUrl` builder to native
download links and selected native images. Both full receipt and honest short receipt contain the
same capture section. No Screenshots tab, Review producer, Gallery redirect or new data authority.
All bundle ids/origin labels and complete served byte/presentation metadata remain reachable;
restricted captures keep their warning. Data and PDFs are download-only, with PDF page count.
A tile and its selected preview use failure framing iff at least one origin literally is
`failure`; the four other origins stay neutral even on a failed run. Mixed memberships retain all
five labels, not a chosen winner.

Selected images have explicit eager loading, width/height, exact native src and object-contain.
Each mounted DOM image owns its decoder attempt. Readiness is absent before decoder settlement
and requires natural dimensions exactly equal to the declared positive dimensions. Load errors,
decoder rejection, synchronous decoder failure, zero dimensions and dimension disagreement keep
metadata/download reachable without success text. Detach/error invalidate old decoder completion.
Close/Escape return focus to the exact opener; run/revision/tab replacement closes selection.
The DS dialog/body/footer structure, declared surface token and persistent caption lane are local
declarations, not a claim of measured browser layout.

Nearest dashboard AGENTS gained the dated D292 ownership/decoder/focus lesson. Only the two
owning D292 as-built blocks were updated, explicitly retaining pending browser/guard/integration
proof. Other sections of the long reference documents were not rewritten.

## Exact frozen delta and source pins

Isolated patch against preserved dirty intake bytes, **not against HEAD**:
[delta.patch](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-delta.patch) — **66,825 bytes**, SHA256
`41c589ddc6fec62397da4c6a57c820ea5c3f77182bd9b8c0eb37adb2426a684b`, **10 paths / 980 insertions / 4 deletions**.
Five new files, five modified files. Read-only reverse-apply check and full `git diff --check`
both exit0; exact individual statuses are in [patch-check.json](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-patch-check.json) (chunk6f6238).

[before.json](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-before.json) SHA256 `231fe7b2eccd54d58b284506efe98b806f9858b1f14c991fec6282025cf0f1dc` retains the original ten-path
before identity and saved bytes for pre-existing files. [after.json](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-after.json) SHA256
`5c88ea5bfe41984850a270a4d55a16d3aae9c1213b2c6cf66b6aa06f1c32ee05` records the following complete after hashes:

| Path relative to assigned tree | Lines | SHA256 |
|---|---:|---|
| src/dashboard/surfaces/run-captures-model.ts | 131 | `001c9058ff9b42a867bb83f5c1503b5f9c6797cb8c9c60624b172e88f532e391` |
| src/dashboard/surfaces/run-captures.tsx | 89 | `2daa099d3ece6c6a8d812ecee002393d7144051bde8294a1f8826c7a9fb89187` |
| src/dashboard/app/dashboard-app.tsx | 1867 | `8bbb8db545bfba2cc84418a29c3905c84835542da59d1a9306994ea2ec4c1415` |
| src/dashboard/surfaces/log-panel.tsx | 2558 | `4d8a0afd36edeb5a4f74576351c19d2d56457f3c40c2965a3899693fada05b16` |
| tests/unit/dashboard/run-captures-app.test.ts | 441 | `cd76f80e7d4ebee08b3e565444bdad1238ebc70f093a443b0259619a7b68672e` |
| tests/unit/dashboard/run-captures-lifecycle.test.ts | 61 | `a4261b95c82ddf6c7778f26e87848b5edc08ea0353696a921d4ee284e83498bf` |
| tests/unit/dashboard/fixtures/run-captures-app-fixture.ts | 212 | `98cf75764380c1da9cb0bf636002f6d61a0d7c72fcc1193f49386e834888cc4e` |
| src/dashboard/AGENTS.md | 130 | `7839162f0ab31e49ac47516660eab016765cb985355d77c57d80435ab1254e82` |
| docs/rebuild/reference/dashboard-surfaces.md | 5037 | `06aff60c1fab7f9a6025932f396737901ca14453d6eb724e1beffac1fb95710b` |
| docs/rebuild/reference/frontend-backend-integration.md | 2594 | `d6718e51a81e6242c14b055a6d3c68da1f96040d1f1997dc12e440653948ce73` |

Protected non-coordinator inventory: **1,857** paths, before = after digest
`843361eca38113e12ace58078f1b6ed93da65d1ddf7c67899cf25d094fac4579`.
Recipe: unique sorted `git ls-files -z --cached --others --exclude-standard` paths, excluding
only the exact ten owned paths and `docs/coordinator/`; SHA256 each extant file (null if absent),
then SHA256 compact `JSON.stringify` of the insertion-ordered path→hash object.
Original bounded before record and current verification agree; no giant map was transported or
reconstructed. After verification chunk6fe38c exit0. This includes frozen A10.1 source/tests,
shared hooks/DS/guards, Archive product, all six active refs and shared materializer. Coordinator
receipts are outside this inventory; only unique A10.2 receipt names were written here.

Important frozen pins:
- Archive spec `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`,
  23,317 bytes; no 404 controls repeated.
- A10.1 run-detail schema `6e988a9379b0446891c0b030dbe94aad4ec0e175653acb1c4fcd66e85c4a5777`.
- A10.1 client queries `0fdcaeb5f555bf06b0b05ab35cde4c455ed6235fd1d40d72004932eb7ac7db61`.
- A10.1 run-detail query `97b26234cf19e2764bddbb85d3038e8b722ac0f2cda1e1af471226ee414b2e07`.
- Build manifest `66d399b7cc1370018778a9101dd9fedd6dcc478b02bd35b214aabe60288a5a49`;
  not regenerated (no source-closure edit and no build allocation).

## GATE — actual execution and retained raw proof

All process stdout/stderr was captured directly by command-owned `tee` with `set -o pipefail`.
Every log has a sibling `-execution.json` containing the exact invocation, explicit workdir,
UTC start/finish, actual session/chunk IDs and final exit. [gate-index.json](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-gate-index.json) indexes
all retained red/green logs and hashes; no raw log was reconstructed from tool output.

| Raw log | Session | Exit | Result | Raw SHA256 |
|---|---:|---:|---|---|
| [focused-final-02](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-focused-final-02.log) | 49605 | 0 | Tests  126 passed (126) | `26fa8874061a73d1a8850b511ba23a6dd5597d76151dc660c31f316b7dd6af1f` |
| [typecheck-02](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-typecheck-02.log) | 72960 | 0 | Passed | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |
| [lint-01](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-lint-01.log) | 67697 | 0 | Passed | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |
| [lifecycle-control-red](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-lifecycle-control-red.log) | 88417 | 1 | Tests  6 failed | 31 skipped (37) | `a8821832ce385a022234e6480ce5e47b16d04c3b954ce6f47b4606b09286e7c5` |
| [lifecycle-restored-positive](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-lifecycle-restored-positive.log) | 11327 | 0 | Tests  6 passed | 31 skipped (37) | `08120d6866753dd35c0a1851210ca486c8ff368238f0242c9b04c201d606b2ba` |
| [literal-frame-control-red](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-literal-frame-control-red.log) | 55519 | 1 | Tests  2 failed | 35 skipped (37) | `d9841657122f11cb459352b7c7bd794598e066c925049a84b8f3ee95de363e93` |
| [literal-frame-restored-positive](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-literal-frame-restored-positive.log) | 39665 | 0 | Tests  2 passed | 35 skipped (37) | `4d11d41261400fc8158e14a07f3df1ade78bd225cd38f05ac1f8c8dfb4de7c34` |

Final focused command (session49605, final chunk842b05, 5.67s):

```sh
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/dashboard/run-captures-app.test.ts tests/unit/dashboard/run-captures-lifecycle.test.ts tests/unit/dashboard/run-detail-captures-client.test.ts tests/unit/dashboard/log-panel-model.test.ts tests/unit/dashboard/receipt-body-cues.test.ts tests/unit/dashboard/receipt-identity-line.test.ts tests/unit/dashboard/receipt-action-proof-render.test.ts tests/unit/dashboard/receipt-invariant-unrepresentable.test.ts tests/unit/dashboard/takeover-frame-focus.test.ts
```

**9 files / 126 tests passed.** New proof is **37 actual whole-app cases + 3 first-commit hook/DOM
cases = 40**. Existing client, receipt, panel and takeover-focus cases also passed. The final run
followed the fixture input-type correction and both exact restorations.

Full locked commands, separately and serially:

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Typecheck02 session72960 exit0, 13.42s command interval; lint01 session67697 exit0,
27.39s command interval and zero warnings. Final focused repeat changed no source after these
lights. Every Vitest used one worker and the explicit legacy guard path. No locks spun or
foreign processes touched.

### Red-first and negative-control disposition

The initial actual-app test first failed because Receipt had no capture region (first-red,
session91620, exit1). Successive independent reds pinned absent state, native non-image href,
missing live availability, authority error, count and section disagreement, missing native Preview,
literal frame, mismatched image dimensions, then synchronous decoder refusal. Matching green logs
are retained by their names in the gate index. Assertions/timeouts were not weakened.

- **Lifecycle source control:** removed BOTH `live` and owner publication checks, retaining actual
  client/parser/AbortSignal flow. All six current-success-then-old-resolve/reject cases failed:
  run, loaded revision and Receipt revisit. Exact patch [lifecycle-control.patch](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-lifecycle-control.patch).
  Model immediately restored in `finally`; SHA256
  `001c9058ff9b42a867bb83f5c1503b5f9c6797cb8c9c60624b172e88f532e391`,
  6,732 bytes, verified chunk7920d2 exit0 in [lifecycle-restoration.json](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-lifecycle-restoration.json);
  restored six cases passed before next control.
- **Literal-frame source control:** forced the helper's condition false (neutral frame), keeping
  tests and native rendering unchanged. Separate tile AND preview assertions failed by name.
  Exact patch [literal-frame-control.patch](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-literal-frame-control.patch). Immediate `finally` restoration to the same
  model hash/bytes, chunk803ff0 exit0 in [literal-frame-restoration.json](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-receipt-literal-frame-restoration.json); restored two
  cases passed. All four non-failure-kind tests also pass in the final forty.
- The layout-effect probe records the first committed native href before passive request effects
  for requested-run mismatch, loaded revision replacement and inactive tab. A fresh same-key
  detail object does not refetch. It does not simulate or assert CSS geometry.

Non-semantic defects are not claimed as product regression evidence: image-green.log first selected
the app's other dialog, so the harness was corrected to the exact Run capture heading; no check
was deleted. Typecheck01 found six branded-output-vs-raw-input fixture type errors. The helper now
accepts `Partial<z.input<typeof RunDetailWireSchema>>` and parses it, without casts. Both raw reds
remain. The synchronous decoder red included its real uncaught event error; moving invocation into
the promise refusal boundary fixed it, with no global error suppression.

## Reusable whole-app fixture interface for A10.3

New test-only helper:
`tests/unit/dashboard/fixtures/run-captures-app-fixture.ts`.

```ts
mountCaptureApp({
  runId,
  section?: "logs" | "receipt",
  runs: ReadonlyMap<string, {
    detail: () => unknown;
    captures: (request: {
      url: string;
      signal: AbortSignal | null | undefined;
    }) => Promise<Response>;
    receipt?: () => unknown;
  }>,
})
// returns { client, host, requests, unmount, navigate(runId), publishDay(day) }
```

It mounts the actual DashboardApp/provider using the real typed client/parser and a closed
synthetic HTTP/SSE response boundary. No app hook/component/client method is replaced.
Unexpected URLs throw and are asserted at cleanup; synthetic bootstrap/day/detail use strict
schemas. `captureDetail`, `captureData`, `captureImage`, exact A/B run/artifact/bundle ids,
`captureButton`, `pressCaptureControl`, `captureDialog`, `deferredResponse` and
`captureDayRevision` are reusable. `publishDay` enters through the real parsed SSE stream.
Unmount aborts/subscription closes and restores only this helper's global descriptors/history/host.
Declaration-only ResizeObserver and synthetic image natural dimensions are explicitly NOT layout
or browser decoder proof. Metadata samples are synthetic declared refs, not a purported PNG or
content-addressed canonical record; fixture HTTP bytes belong to the following unit.

The A10.3 guard can mount either identity, activate native Receipt/Preview controls, observe
native download href and img src, and always `await unmount()`. It should preserve failures on
unexpected requests and cleanup instead of replacing this boundary with a blanket fake client.

## REVIEW-HINT / remaining acceptance

Independent affected reviews should inspect the isolated patch, especially synchronous ownership,
same-key detail stability, real app tab choice, all-origin framing at both DOM sites, detached
decoder ownership, metadata after refusal, and declared geometry/focus behavior.

Prior A10.1 wire-connectivity result remains the last measured result: **2 failed / 23 passed**,
not “generic-only.” The synchronous census does not observe the new async availability, and
mounted generic resource accounting still needs A10.3. This unit did not rerun or edit that guard,
remove another pending binding, add a fake caller, or claim it green merely because hrefs render.

Browser/HTTP/bytes/pixel acceptance is unexecuted. Proposed following allocated browser cases:
full/short Receipt exact image+download bytes for two identities; both themes with complete
origin labels and literal-failure tile/preview; actual positive natural dimensions and decoder
refusal; current-success then stale run/tab/selection; keyboard open/Close/Escape/exact focus;
coarse-pointer phone 44px effective hit rectangles, edge/nonoverlap, contained image and separate
readable caption, stationary outer frame/metadata/footer through loading→decoded/refusal. No
browser spec was added in this source-only unit, so no nonexistent command is claimed executable.

A10.3 fixture/guard receive, independent coherent-A10 review, D291 shared serving/join, derived
checks and separately allocated full coverage/asserted parity remain parent/coordinator work.
Historical full-coverage05/raw gate receipts and Archive references remain preserved. No new
rendered proof or commit permission is inferred from these light results. Ready for parent
receive; source is frozen and sole writer/light lane is released on return.

