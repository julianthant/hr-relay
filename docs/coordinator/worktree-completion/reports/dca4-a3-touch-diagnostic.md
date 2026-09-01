# DCA4 A3 — one-command touch diagnostic receive

Status: **diagnosis complete; slot released; candidate restored; no source fix**.
Parent notified immediately after command completion/restoration, before this receipt.
No owned command/browser remains. Parent independently re-pinned the eight candidate hashes,
HEAD, unchanged materializer and whitespace check, and notified coordinator RELEASE NOW.

## Exact red loop and scope

Prior scoped red remains 2 failed / 9 passed / 14.1s. Its Close identity was ambiguous.
This allocation ran only the following command, once:

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts --grep 'verified archived capture evidence paper-ink @ phone-390x844'
```

Explicit command workdir: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
Started 2026-08-30T15:41:04.681Z; exited 2026-08-30T15:41:09.512Z; exit **1**.
Runner selected **1 test / 1 worker**, phone happy case **failed (1.2s)**:
`Expected >=44; Received 41.84375`, instrumented line160 (original restored line107).
No retry, other case, reference update, mutant, light gate, coverage or full parity followed.
The stamped existing bundle was accepted; stamp bytes match gate02.

Used /ui established-product verification and /hr-debug + global debug: existing red,
three falsifiable hypotheses, one bounded observation, exact restoration. No behavioral mutation.
The saved patch adds optional observations to the existing geometry evaluation; only the
selected phone happy case enables it. Thresholds, waits, edge/overlap assertions and product
bytes are untouched. The original full spec was saved before patch application.

## Observed cause, not label-order inference

Actual viewport 390×844, coarse=true, visual viewport scale1, devicePixelRatio1.
DOM ancestor identity distinguished header button from footer button → span → footer.

| Control | Rendered rectangle x,y,width,height | Computed min-width / shrink | Result |
| --- | --- | --- | --- |
| Header Close | 317,72.0859375,44,44 | 44px / 0 | Width and height floor met |
| Footer Previous | 34.65625,727.9140625,98.84375,44 | auto / 0 | Floor met; intentionally pointer-inert |
| Footer Next | 141.5,727.9140625,79,44 | auto / 0 | Floor met; intentionally pointer-inert |
| Footer Download | 228.5,727.9140625,82.65625,44 | auto / 0 | Floor met |
| **Footer Close** | **319.15625,727.9140625,41.84375,44** | **auto / 0** | **Width floor fails** |

Footer Close computed width41.8438px, border-box, horizontal padding6px, border1px,
font11px, min-height44px, offsetWidth42 (rounded), no pseudo-element hit-area extension.
Shared Button already supplies shrink-0. The footer control wrapper is332px wide,
flex-wrap:wrap, gap8px, shrink0; no horizontal overflow.

Ranked hypotheses and dispositions:

1. **Footer intrinsic width with height-only floor — supported.** Its actual class contains
   only `pointer-coarse:min-h-11`; min-width is auto. Header's generated min-width44 applies.
2. **Ancestor independent scale/zoom — falsified for this failure.** Dialog scale1,
   other observed ancestors scale none, all transforms none/zoom1; no active animations.
   Dialog's independent translate centers it without shrinking. No compensating width needed.
3. **Cascade/flex pressure defeats an intended width floor — not supported.** Header floor
   computes44; footer has no width-floor declaration to override, shrink0 and intrinsic width.
   Root16px and --spacing .25rem make11 spacing units exactly44px.

Measured at the same evaluation as existing proof: overflow=false, insideViewport=true,
bodyClearOfFooter=true; all five controls inside and overlap count0. Header Close, Download,
Footer Close all own their sampled edges; disabled Previous/Next are deliberately inert.
Assertions for containment/overlap and earlier controls passed before footer width failed.
Footer height/edge observations were logged but their following assertions were not reached.
This is **not full UI acceptance** and supplies no new reference screenshot. Exact image
decode1440×900, exact downloaded fixture bytes, success and frozen metadata checks preceding
geometry passed in this one case. Later screenshot/a11y capture was not reached.

## Source position and bounded next repair proposal (not implemented)

- `src/dashboard/surfaces/archive.tsx:2306`: local footer Close uses
  `ARCHIVED_CAPTURE_NAV_TOUCH_TARGET`.
- `src/dashboard/surfaces/archive-model.ts:776`: that local constant declares only
  `pointer-coarse:min-h-11`; its preceding comment still describes Previous/Next only.
- `tests/unit/dashboard/archive-render.test.ts:459`: existing declaration regression checks
  footer height only, while checking both header dimensions.

After separate writer authorization: extend that existing regression to require the local
coarse width floor on footer controls, prove red with VITEST_MAX_WORKERS=1, add min-w-11
to the local constant, and update its comment/nearest dashboard AGENTS lesson. No shared DS
change, no larger-than44 compensation, no shrink workaround. Focused unit proof can pin
declarations only: allocated unchanged phone/browser assertions must prove actual44px,
edge ownership, nonoverlap and overflow; desktop keeps fine-pointer24px styling.
No such fix/test was performed in this diagnostic allocation.

## Restoration and evidence

Spec restored in orchestration `finally` immediately after the owned command exited,
then independently hashed before release notification. No restoration error.
Before = after:

- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Spec and preserved original bytes: `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1`
- Tracked diff SHA256, `git diff HEAD -- src tests scripts config`:
  `e6557e0a8a5fc2c8d3efd7619e30356fb2e1da311bb00d3c551369432cc6eafb`
- SHA256 of sorted path→byte-SHA256 map from `git ls-files --cached --others
  --exclude-standard src tests scripts config`, 1626 paths:
  `e1301a6d97d2fb2506521afd0b829be7c44847c98039f4f650b715bc98a41953`

This comparison covers source, tests, scripts, config, fixture/PNG source and reference files.
Product, HTTP helper, shared materializer and all reference bytes stayed unchanged.
Only this receipt and prefixed diagnostic evidence are retained new work.

| Artifact | SHA256 |
| --- | --- |
| [Exact captured stdout/stderr](../evidence/dca4-gates/touch-target-diagnostic-01.log) | `fe3a3d98903216ed7ee52728e5a66d72444935be236d1d9ca33b0ecab971323c` |
| [Temporary observational patch](../evidence/dca4-gates/touch-target-diagnostic-01.patch) | `4bc09d977a459feba403d4c1519025d5e35916075a54880f867acace9d49dc0b` |
| [Preserved original spec](../evidence/dca4-gates/touch-target-diagnostic-01.original.spec.txt) | `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` |
| [Error context](../evidence/dca4-gates/touch-target-diagnostic-01-error-context.md) | `21b9a8da715034ad454da3ae64b29758a2afd2b76456d8e1545028d004f0029f` |
| [Accepted bundle stamp](../evidence/dca4-gates/touch-target-diagnostic-01-build-stamp.json) | `a758962351282f7d3e6651aa4976a9a885d395dd075b8ee1002f0840944d62e0` |

Raw log bytes compared equal to concatenated command output, including trailing whitespace.
Temporary [DEBUG-dca4-touch] code is absent from the exact restored spec; its tag remains
only in intentionally preserved diagnostic evidence. No commit/staging or further gates.
