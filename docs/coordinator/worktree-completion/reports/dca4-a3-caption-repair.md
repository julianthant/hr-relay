# DCA4 A3 — bounded caption/image repair

**Implementation/light-ready; frozen for parent review. No rendered acceptance claimed.**
No active owned command/browser, no staging/commits. Source ownership relinquished on return.
Gate03 receipt/images and active unaccepted references are unchanged.

## Confirmed seam and diagnosis disposition

Read complete `briefs/dca4-caption-repair.md`, gate03 receive, both preserved PNGs and nearest
AGENTS/tokens. Used /ui Operate hardening/craft floor, /hr-debug and the full /tdd loop at the
explicitly parent-confirmed rendered Archive preview seam. No additional worker/task/worktree.

Independent parent review **1 medium accepted**: image and caption overlap in both PNGs, and
the intended inset background token was undeclared. Gate03's update command passed11 but direct
visual inspection refused its output; that evidence is preserved, not retroactively declared green.

Ranked source/evidence hypotheses and dispositions:

1. Full-frame absolute image + bottom-absolute caption share painted space. Supported by saved
   PNGs and actual source structure; a distinct persistent lane is absent. New actual-render
   regression fails on original implementation and again on the bounded old-implementation control.
2. Undeclared `--ds-bg-inset` leaves the intended caption backing unresolved. Parent source/token
   review and local search agree: the declared inset token is `--ds-surface-2`. Correcting a
   background alone cannot partition the overlapping image/caption geometry. Numeric contrast
   remains a browser measurement, not a source diagnosis.
3. Transient decode/animation alone causes overlap. Not supported: both saved views had completed
   positive-dimension decode, readiness and stable-frame gates; absolute siblings have the same
   overlap by construction. No waits, animation overrides or thresholds changed.

The newly executed red-capable command is recorded below. It observes the real mounted viewer,
not a model constant or substituted component. The browser red/visual evidence still awaits its
new allocated rerun.

## Minimal local repair and exact scope

Four existing files changed relative to received candidate: **+159 / −25**.

| Path | Delta | Disposition |
| --- | --- | --- |
| `src/dashboard/surfaces/archive.tsx` | +25/−25 | Preview frame gains flex-column interior and declared surface-2 background. Image lives in a relative min-h-0 flex-1 viewport; semantic figcaption is its non-shrinking wrapping sibling, reserving one line-height plus existing vertical padding when empty. |
| `tests/unit/dashboard/archive-render.test.ts` | +32/−0 | One actual-viewer regression pins separate image/caption structure, proper token, object-contain and empty pending lane; same caption node fills only after decode and empties on failure. |
| `tests/parity/archive-evidence.spec.ts` | +95/−0 | Additive caption geometry/color helper called in both existing happy cases; all original11 cases and assertions retained. |
| `src/dashboard/AGENTS.md` | +7/−0 | Concise dated lesson distinguishing stable outer frame from safe internal layout, declared tokens and browser proof. |

Outer frame width/max-height/border/radius and frozen aspect-ratio/absent-dimension height declarations
are unchanged. Its internal layout changes; actual unchanged outer geometry is still a pending
browser assertion, not inferred from class tests. Caption can wrap and expand its lane inside that
frame, reducing the contained-image viewport rather than obscuring image content. It remains a
direct figure child. **No hidden SUCCESS text** is used to size the pending lane.

The exact image ref/onLoad/onError ownership, natural dimensions, download and frozen metadata
logic remain unchanged. Refusal Banner is scrollable within the image viewport; caption empties.
Resource loading/refusal uses the same outer frame. No model constant/sibling was needed.
The unrelated capture tile's old token was deliberately left untouched.

**Unchanged:** shared DS/Button/Dialog/tokens/helpers, materializer, fixture routing and canonical
PNG bytes, runtime/backend authority, touch footer, theme/viewports, masks, thresholds, timeouts,
all existing staged geometry/keyboard/refusal assertions. Protected-file hash below verifies scope.

## Red → green → old implementation → restored final gates

All shell commands explicitly use `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
Every Vitest sets VITEST_MAX_WORKERS=1. Commands were serial; full lights acquired the required lock.

Focused command, used for red, green and negative:

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts -t 'reserves a separate readiness-caption lane'
```

| Step | UTC start → finish | Result | Raw output |
| --- | --- | --- | --- |
| red | 2026-08-30T16:02:22.335Z → 2026-08-30T16:02:26.315Z | exit1; 1 failed / 39 skipped,3.42s; missing persistent caption lane before decode | [red](../evidence/dca4-gates/caption-red.log) |
| green | 2026-08-30T16:03:20.299Z → 2026-08-30T16:03:23.679Z | exit0; 1 passed / 39 skipped,2.80s | [green](../evidence/dca4-gates/caption-green.log) |
| negative | 2026-08-30T16:03:40.433Z → 2026-08-30T16:03:43.227Z | exit1; same missing-lane failure,2.33s | [negative](../evidence/dca4-gates/caption-negative.log) |
| final-focused | 2026-08-30T16:05:15.149Z → 2026-08-30T16:05:22.548Z | exit0; 5 files / 81 tests passed,6.82s | [final-focused](../evidence/dca4-gates/caption-final-focused.log) |
| typecheck | 2026-08-30T16:05:22.551Z → 2026-08-30T16:05:36.554Z | exit0; full tsc --noEmit | [typecheck](../evidence/dca4-gates/caption-typecheck.log) |
| lint | 2026-08-30T16:05:36.557Z → 2026-08-30T16:06:06.092Z | exit0; full eslint, max-warnings0 | [lint](../evidence/dca4-gates/caption-lint.log) |

Exact red: `AssertionError: the image preview has no persistent caption lane before decode`
at archive-render.test.ts:452. The old local preview implementation was temporarily restored
without touching tests, then restored to the fix in orchestration `finally`.
Fixed source SHA256 `2618ad6247718de74b0847a271abfb80a864bb3359f6679e21e02d0e7c2fa392`
matched before and after that control. Final five-file suite ran on the restored implementation.

Exact final commands:

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/archive-capture-resource-client.test.ts tests/unit/dashboard/archive-view-model.test.ts
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Final `git diff --check` exit0. Raw logs match complete captured output byte-for-byte.
No browser, build, parity, reference update,404 mutant or coverage command ran in this unit.

## Prepared browser assertions (not executed)

Added only to the existing graphite-warm desktop and paper-ink coarse-phone happy cases:

- Require decoded positive natural dimensions, object-fit contain, centered position, zero image
  padding/border and a positive-size image element wholly inside its own viewport.
- Require that viewport and caption are separate siblings, inside the frame's floating-point
  border-adjusted interior; image/viewport bottom must not pass caption top. A contained,
  unobstructed element with object-fit contain preserves the complete decoded image.
- Require nonempty caption text lines within the caption, no scroll clipping, and actual text-line
  center hit testing returning the caption; no overlapping overlay may hide it.
- Resolve computed foreground/background and declared surface-2 through an unattached1px sRGB
  canvas (supports modern CSS colors); reject unresolved colors/context absence. Require matching
  declared background, opaque foreground/background, caption opacity1 and contrast≥4.5.
  **No numeric contrast value has been measured or claimed yet.**
- Existing resource→HTTP→decode outer-frame/metadata equality checks remain byte-identical.
  Existing44px/edge/nonoverlap/overflow, keyboard, exact download bytes and refusal checks remain.

The color conversion is confined to this spec; no shared helper or production instrumentation.
Removing only the added helper and its one call site from the new spec reproduces the old spec
byte-for-byte, statically verified. No original assertion was deleted or weakened.
Browser case count remains11; unit archive-render count is now40.

## Frozen hashes and new restoration identity

HEAD unchanged: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
UI seven-path aggregate before `2cae368f56de44b7f6c89665fc08fa1d13e1fbe36510266c198d8fa94c19212d`;
after `28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf`.

**NEW complete browser spec restoration SHA256:**
`e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`.

**Future approved404 controls must restore this reviewed new spec, never old d158e014.**
The old spec is preserved only as before evidence, not the next gate candidate.

| File | Before SHA256 | After SHA256 |
| --- | --- | --- |
| `src/dashboard/surfaces/archive.tsx` | `333ce70655b9c9c2130495e4dd51dd0dfd73ba8114f65ea90fbb7a3404b37d7b` | `2618ad6247718de74b0847a271abfb80a864bb3359f6679e21e02d0e7c2fa392` |
| `tests/unit/dashboard/archive-render.test.ts` | `5a10fce54df965c3727989ba275e9eaa49cd1ef89a635ac1fc982159cacd5979` | `e7139505e5d31fd872f3d5d37d5969f645fc845cb07e984bc87bf0d48032651f` |
| `tests/parity/archive-evidence.spec.ts` | `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` | `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0` |
| `src/dashboard/AGENTS.md` | `b723d2302cd311948b57900020334ca268ee3db4ef8eca5e3e9cd7e4d281c662` | `58ba56deecbea58dde295b0747a1cde30a684f3837e99a8ba6b7c5c78aad9f57` |

Byte-exact before files and before/after hash maps are preserved under `evidence/dca4-gates/caption-*`.
[Isolated received→final patch](../evidence/dca4-gates/caption-delta.patch) SHA256:
`0fde7a729c6648d971821633ab0894984dca3b25612da94cd9220a86662c39e4`. Produced by git diff --no-index against those before bytes.

Protected sorted path→SHA256 map under src/tests/scripts/config excluding only these four paths
is unchanged: `87cae4c3d5c19a8aeacd7afb0caab251e790f89ec460bb3d54a854a4518e0836` (1628 candidate paths before exclusion).
This includes model/touch constant, shared DS/helpers, bytes/materializer and every reference.

Gate03 immutable receipt and desktop/phone evidence still hash, respectively:
`158f27c3822ab9be8457504beacf71669dd53864aaa2ed1d108221d0184ee223`,
`826127529d8ec9e3724c51b16e8a0f3241c09ec7f1b5e6c190e8357d80d99992`,
`0b6626ded1f052a0e2d10511cd87f50a175193e1a7b06fe6b0536d2b96005fc4`.

### New evidence artifacts

| Artifact | SHA256 |
| --- | --- |
| [caption-after-hashes.json](../evidence/dca4-gates/caption-after-hashes.json) | `c87ddd2a954559d439f0fddd88cc9d0bc4d46955fa91b8a0b21d0db8813ca928` |
| [caption-before-AGENTS.md.txt](../evidence/dca4-gates/caption-before-AGENTS.md.txt) | `b723d2302cd311948b57900020334ca268ee3db4ef8eca5e3e9cd7e4d281c662` |
| [caption-before-archive-evidence.spec.ts.txt](../evidence/dca4-gates/caption-before-archive-evidence.spec.ts.txt) | `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` |
| [caption-before-archive-render.test.ts.txt](../evidence/dca4-gates/caption-before-archive-render.test.ts.txt) | `5a10fce54df965c3727989ba275e9eaa49cd1ef89a635ac1fc982159cacd5979` |
| [caption-before-archive.tsx.txt](../evidence/dca4-gates/caption-before-archive.tsx.txt) | `333ce70655b9c9c2130495e4dd51dd0dfd73ba8114f65ea90fbb7a3404b37d7b` |
| [caption-before-hashes.json](../evidence/dca4-gates/caption-before-hashes.json) | `6edab836846c3d3df853827049b5d2bc8bec8d236e6c9b353189335e16b93be5` |
| [caption-delta.patch](../evidence/dca4-gates/caption-delta.patch) | `0fde7a729c6648d971821633ab0894984dca3b25612da94cd9220a86662c39e4` |
| [caption-final-focused.log](../evidence/dca4-gates/caption-final-focused.log) | `afe2017dea1d08d81deb71c335daa46c88f5412efcde21b3e7ae21991f836348` |
| [caption-green.log](../evidence/dca4-gates/caption-green.log) | `cbdb3d76aa6620000d4703ee4742fe4ee269d6f1fe84a05071596d85b8105214` |
| [caption-lint.log](../evidence/dca4-gates/caption-lint.log) | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |
| [caption-negative.log](../evidence/dca4-gates/caption-negative.log) | `ba184627f4176c7b73f75993c3ac3aa5bed4d018998fe1ecedba772f74b0206a` |
| [caption-red.log](../evidence/dca4-gates/caption-red.log) | `64600f40789247b5fa71585e10f7a2de933271b3608e37ecba3dc0c536e205c6` |
| [caption-typecheck.log](../evidence/dca4-gates/caption-typecheck.log) | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |

## Pending receive / acceptance

Parent owns frozen-diff reviews and fresh light reruns, then coordinator reallocation.
The new browser geometry/color assertions are prepared but unexecuted. Original visual evidence
remains BAD/unaccepted; no after-PNG exists. Rendered caption separation, actual color contrast,
complete image display and stable outer frame must pass in the allocated11-case run before
reference attribution/direct PNG review and subsequent asserted parity.

Both approved404 negatives/restored positives, full coverage and full asserted parity remain
pending separately authorized heavy work. No acceptance waived.
Pending coherent category: `fix(dashboard): separate archived imagery from readiness caption`
with this four-file delta, regression and evidence. **No commit; writer closed after this receive.**
