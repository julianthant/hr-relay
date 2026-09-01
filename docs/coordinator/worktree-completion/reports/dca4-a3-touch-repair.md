# DCA4 A3 — local Archive footer touch-floor repair

**Implementation and permitted light gates complete; frozen for parent review.**
No active owned command/browser. No commit/staging. Browser acceptance remains pending an allocated
rerun; this receipt does not turn the earlier browser reds into green.

## Scope and rationale

Used /ui (established Operate surface, hardening/craft floor), /hr-debug's completed diagnosis,
and /tdd loop at the parent-confirmed rendered-footer seam. The observed origin was missing local
minimum width, not flex shrink or ancestor scale. Prior evidence stays intact:
[detailed diagnosis](dca4-a3-touch-diagnostic.md), [raw one-case browser red](../evidence/dca4-gates/touch-target-diagnostic-01.log),
and [gate02 receive](dca4-a3-gates-02.md).

Exactly three existing files changed relative to this unit's received candidate: **+19 / −12**.

| File | Delta | Reason |
| --- | --- | --- |
| `src/dashboard/surfaces/archive-model.ts:766` | +6/−9 | One production declaration adds `pointer-coarse:min-w-11` beside existing min-h-11. Comment now covers all footer actions and both dimensions. |
| `tests/unit/dashboard/archive-render.test.ts:459` | +7/−3 | Render actual viewer; pin all four footer labels, then require independent literal coarse height/width classes on every action. Check footer Close first so the observed defect is the named red. Existing header checks remain. |
| `src/dashboard/AGENTS.md:29` | +6/−0 | Dated observed-cause lesson; distinguishes DOM declarations from real browser rectangles and forbids shared DS compensation. |

Read-only usage search found this constant consumed only by Archive viewer footer Previous,
Next, Download and Close (`archive.tsx:2271,2284,2298,2306`). Existing wiring already covers
all four, so no JSX edit was needed. No shared Button/Dialog/CSS change, no fixed-width text
clipping, and no unconditional/fine-pointer size change. Root16px/spacing .25rem was observed
in the diagnostic; 11 units retain the exact44px floor, never a compensating larger value.

The regression observes rendered DOM instead of comparing an exported constant to itself.
Exact label-array assertion prevents a missing Close, missing Download or empty control query
from passing. Both dimensions are asserted on all four controls; the header checks are retained.
jsdom does **not** prove layout, hit testing, overflow or effective44px rectangles.
No additional test case count was added; the existing height-only regression was strengthened.
No refactor beyond the owning comment was needed.

## Red → green → old-constant negative → restored final green

All commands explicitly used workdir `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
Every Vitest invocation sets VITEST_MAX_WORKERS=1. One command at a time, no timeout changes.

Repeated focused regression command (red, green, negative):

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts -t 'declares both dimensions of the coarse-pointer touch floor'
```

| Step | UTC start → finish | Result | Raw evidence |
| --- | --- | --- | --- |
| Test first, production unchanged | 2026-08-30T15:43:36.795Z → 2026-08-30T15:43:40.665Z | exit1; **1 failed / 38 skipped**,3.36s; `footer Close has no 44px minimum width` | [red](../evidence/dca4-gates/touch-repair-red.log) |
| Minimum local fix | 2026-08-30T15:44:05.614Z → 2026-08-30T15:44:10.324Z | exit0; **1 passed / 38 skipped**,4.20s | [green](../evidence/dca4-gates/touch-repair-green.log) |
| Negative control: remove only added min-w-11 | 2026-08-30T15:44:23.604Z → 2026-08-30T15:44:26.960Z | exit1; **same named width failure**,2.67s | [negative](../evidence/dca4-gates/touch-repair-negative.log) |
| Fix restored; full five focused files | 2026-08-30T15:44:44.549Z → 2026-08-30T15:44:52.893Z | exit0; **5 files / 80 tests passed**,7.76s | [final focused](../evidence/dca4-gates/touch-repair-final-focused.log) |
| Full locked typecheck | 2026-08-30T15:44:52.902Z → 2026-08-30T15:45:07.967Z | exit0 | [typecheck](../evidence/dca4-gates/touch-repair-typecheck.log) |
| Full locked lint, max-warnings0 | 2026-08-30T15:45:07.971Z → 2026-08-30T15:45:43.408Z | exit0 | [lint](../evidence/dca4-gates/touch-repair-lint.log) |

Negative control restored the fixed constant in orchestration `finally` immediately after the
owned command exited. All three fixed file hashes matched their pre-negative values before the
final five-suite run. The negative deliberately changed only the constant value; no test or
assertion was relaxed. The exact browser44px assertion was never touched.

Exact final commands, serial:

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/archive-capture-resource-client.test.ts tests/unit/dashboard/archive-view-model.test.ts
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Final `git diff --check` also exit0. Raw log files match complete concatenated command output
byte-for-byte, including trailing whitespace. No browser/parity/reference update/404 mutant/
full coverage command was run in this repair unit.

## Frozen identity

HEAD unchanged: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
The browser spec remains exactly `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` (all11 cases unchanged).

| Existing file | Received SHA256 | Final SHA256 |
| --- | --- | --- |
| `src/dashboard/surfaces/archive-model.ts` | `3ffb7ec82322d934af11380a8a5bac19f3c3f86ba05964867cb45e877f6e2df0` | `52af2d9261568bc6e8bbd2089b15afa0659bff518da130466ccba593b4bb3097` |
| `tests/unit/dashboard/archive-render.test.ts` | `b0fa290520be0b06147f3f9d22b7bcefebbc8a24c1f8fc5f275b82aa5ef7c851` | `5a10fce54df965c3727989ba275e9eaa49cd1ef89a635ac1fc982159cacd5979` |
| `src/dashboard/AGENTS.md` | `6b18e5483c89c44ecc7e29623a724f449a0f1bcd6b6f22c6f6d8d82d05d78379` | `b723d2302cd311948b57900020334ca268ee3db4ef8eca5e3e9cd7e4d281c662` |

- Tracked UI seven-path aggregate before: `2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0`
- Tracked UI seven-path aggregate after: `2cae368f56de44b7f6c89665fc08fa1d13e1fbe36510266c198d8fa94c19212d`
- `git diff HEAD -- src tests scripts config` before: `e6557e0a8a5fc2c8d3efd7619e30356fb2e1da311bb00d3c551369432cc6eafb`
- Same aggregate after: `9349bc13ddf206a263b0378b363b15e9c5d697aa92e4b80a8f37ca1a4c2e2422`
- Sorted path→SHA256 map (1626 tracked/untracked candidate files under those roots)
  before: `e1301a6d97d2fb2506521afd0b829be7c44847c98039f4f650b715bc98a41953`; after: `8ac9b3a25792804cac4735d35bb14f758c3f51463f704eeb2cbf89658e00549f`.
- Excluding only the three authorized paths, protected-map hash **unchanged**:
  `0a9a9008183968ab39f0edda5b1721c2ea5b70ddb6980543fee9df4e0bb4b67a`. This covers JSX, client, backend/domain/runtime, shared DS,
  HTTP fixture, PNG source, materializer, all browser assertions and references.
- [Isolated received→final patch](../evidence/dca4-gates/touch-repair-delta.patch):
  `65cc3e9868da17ba2b3e3db0060e168ab3e62b0fde8cd1dffd7f94d840e51b34`. Generated with `git diff --no-index` against the preserved
  byte-exact received files, so inherited changes are not attributed to this unit.

UI seven-path aggregate is SHA256 of `git diff HEAD --` these paths in order:
`src/dashboard/client/queries.ts`, `src/dashboard/surfaces/archive-model.ts`,
`src/dashboard/surfaces/archive.tsx`, `src/dashboard/AGENTS.md`,
`tests/unit/dashboard/archive-render.test.ts`, `tests/unit/dashboard/archive-detail-render.test.ts`,
`tests/parity/helpers/fixture-bff.ts`.

New evidence files (all under `evidence/dca4-gates/`; receipt is the only other new file):

| Artifact | SHA256 |
| --- | --- |
| [touch-repair-before-AGENTS.md.txt](../evidence/dca4-gates/touch-repair-before-AGENTS.md.txt) | `6b18e5483c89c44ecc7e29623a724f449a0f1bcd6b6f22c6f6d8d82d05d78379` |
| [touch-repair-before-archive-model.ts.txt](../evidence/dca4-gates/touch-repair-before-archive-model.ts.txt) | `3ffb7ec82322d934af11380a8a5bac19f3c3f86ba05964867cb45e877f6e2df0` |
| [touch-repair-before-archive-render.test.ts.txt](../evidence/dca4-gates/touch-repair-before-archive-render.test.ts.txt) | `b0fa290520be0b06147f3f9d22b7bcefebbc8a24c1f8fc5f275b82aa5ef7c851` |
| [touch-repair-delta.patch](../evidence/dca4-gates/touch-repair-delta.patch) | `65cc3e9868da17ba2b3e3db0060e168ab3e62b0fde8cd1dffd7f94d840e51b34` |
| [touch-repair-final-focused.log](../evidence/dca4-gates/touch-repair-final-focused.log) | `5bcd294c5b0873f22283ef819a907ae3db1a52f45b4061b3476575bf67a1c914` |
| [touch-repair-green.log](../evidence/dca4-gates/touch-repair-green.log) | `3a5ae474284b0dc81d0abafb524d0a13f7f45366f962164678774cd2bf6c4197` |
| [touch-repair-lint.log](../evidence/dca4-gates/touch-repair-lint.log) | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |
| [touch-repair-negative.log](../evidence/dca4-gates/touch-repair-negative.log) | `e71728e225c341a13d0b7686ba32407167a294d9db89d3a9e7f66548d7e4072b` |
| [touch-repair-red.log](../evidence/dca4-gates/touch-repair-red.log) | `c45e1bf8964fe057d9c48ce5b3d5b458fc08e8923f7e2ad0a7bec3b4dbff59aa` |
| [touch-repair-typecheck.log](../evidence/dca4-gates/touch-repair-typecheck.log) | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |

## Pending acceptance and commit disposition

Parent owns affected Correctness/Performance/Tests/Standards/Docs review, independent light reruns,
and a new browser allocation. On the reviewed candidate, unchanged coarse390×844 browser assertions
must still prove both44px dimensions, actual edge hit ownership, no control overlap/overflow,
metadata/footer separation and decoded readiness. Desktop/fine-pointer visual parity also awaits
that allocation. Prior gate02 remains **2 failed / 9 passed**; diagnostic remains **1 failed**,
not current accepted screenshots. Reference-only disposition and approved refusal-oracle negatives
remain separate allocated work; no broader reference refresh is implied. Full coverage/full
asserted parity remain required before any commit.

Coherent pending local commit category: `fix(dashboard): enforce both Archive footer touch dimensions`
(the three-path delta and its focused proof/lesson; no unrelated inherited backend changes).
No commits made. Writer ownership relinquished with this frozen receive.
