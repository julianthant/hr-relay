# DCA4 A5 — explicit Archive image loading (frozen receive)

2026-08-30. **Local repair and authorized light gates complete; writer closed for parent receive.**
One production attribute, one actual-render regression and one nearest lesson; no commits.
Full DCA4 acceptance is still pending the separately owned gate05 failures and future full gates.

## Scope, evidence and smallest change

Every command used explicit workdir
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`; edits were absolute within that tree.
Read the complete A5 brief/profile, full /ui, /hr-debug/global debug/local wrapper, /tdd and test-quality
reference. UI route: established Operate surface → states/hardening + craft floor. Existing identity,
tokens, image geometry, decode generation/ref/error ownership and resource authority stay unchanged.

Gate-first evidence was fullcoverage05's unchanged architecture ratchet:
`archive.tsx: image without explicit loading`. The AST guard requires an explicit native JSX
loading attribute. The bounded checks distinguished omission from wrapper prop loss (direct native
img) or comment/text false positive (AST JSX inspection). Actual rendered DOM confirmed omission.

| File / seam | Isolated change |
| --- | --- |
| `src/dashboard/surfaces/archive.tsx:2373` | Add `loading="eager"` to the existing requested capture img; no other production edit. |
| `tests/unit/dashboard/archive-render.test.ts:416` | Mount real CaptureViewerDialog through its existing harness; valid available-resource boundary; independently assert actual img `getAttribute("loading") === "eager"`. |
| `src/dashboard/AGENTS.md:29` | Dated lesson: explicit eager declaration, unchanged decode readiness, no lazy substitution/guard exemption. |

TDD loop: test first, real DOM red `null !== 'eager'` at line419 → one attribute → same test green.
This assertion also rejects lazy or omitted declarations, not a copied source constant.
No own component mock, timeout change, DOM harness rewrite, refactor or temporary instrumentation.
The test proves the DOM declaration, **not browser request timing**. No browser/build/parity was
authorized or run; no new rendered screenshot proof is claimed for this candidate.

## Exact light gates and honest attempt accounting

All logs were captured directly via `set -o pipefail` and `2>&1 | tee '<absolute unique log>'`.
No log was reconstructed from truncated tool output. The corresponding
`loading-<name>-execution.json` stores exact full command, UTC times, session/chunk IDs and exit.
[After receipt](../evidence/dca4-gates/loading-after.json) includes every raw-log byte count/SHA256.

| Step / raw log | Session / exit | Result |
| --- | --- | --- |
| [DOM red](../evidence/dca4-gates/loading-dom-red.log) |87142 /1 |1 failed,40 skipped;2.46s. Actual loading attr null, expected eager. |
| [Initial ratchet attempt](../evidence/dca4-gates/loading-ratchet-red.log) |inline chunkfc53ca /1 |Suite initialization failed: default legacy sibling missing; no tests collected. NOT ratchet proof. |
| [Ratchet red with profile legacy path](../evidence/dca4-gates/loading-ratchet-red-explicit-legacy.log) |69216 /1 |1 failed,5 skipped;2.41s. Exact image-without-explicit-loading violation. |
| [DOM green](../evidence/dca4-gates/loading-dom-green.log) |47779 /0 |1 passed,40 skipped;2.11s. |
| [Unchanged ratchet green](../evidence/dca4-gates/loading-ratchet-green.log) |50514 /0 |1 passed,5 skipped;2.59s. Every required arm and its violating fixture executed by the existing case. |
| [Initial focused selection](../evidence/dca4-gates/loading-focused-final.log) |88025 /0 |4 files/60 passed;5.07s. Requested nonexistent archive-model.test.ts did not collect a fifth file; not represented as5-file proof. |
| [Corrected final regression set](../evidence/dca4-gates/loading-focused-final-corrected.log) |93187 /0 |**5 files/82 passed;5.73s**. Actual sibling is archive-view-model.test.ts. |
| [Full locked typecheck](../evidence/dca4-gates/loading-typecheck.log) |87593 /0 |No diagnostics; UTC16:32:36.291–16:32:49.001Z. |
| [Full locked lint](../evidence/dca4-gates/loading-lint.log) |61903 /0 |No diagnostics/warnings; UTC16:32:49.004–16:33:14.681Z. |
| `git diff --check` |0 |Empty output in after receipt. |

Commands before the direct-log pipeline:

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts -t 'explicitly loads the requested archived image eagerly'
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/guard-manifest.test.ts -t 'executes every required rebuild ratchet arm'
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-capture-resource-client.test.ts tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/archive-view-model.test.ts
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

DOM and ratchet commands each ran red then green. The initial ratchet command omitted the profile
legacy override and failed before tests; retry only supplied the authorized read-only legacy guard
path. No credentials copied or auth runtime touched. Initial focused typo and its exact output remain
preserved, followed by the actual5-file set. Every Vitest set VITEST_MAX_WORKERS=1; all commands serial.

## Frozen before/after and exact delta

HEAD unchanged `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
UI7 before `28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf`;
UI7 after `3c89958afe63d1b8c0b5b8e8d01fffff25e94d89a2cbbc517ec7b799cdb4d461`.
Backend6 unchanged `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.

| File | Before SHA256 | After SHA256 |
| --- | --- | --- |
| `src/dashboard/surfaces/archive.tsx` | `2618ad6247718de74b0847a271abfb80a864bb3359f6679e21e02d0e7c2fa392` | `e464397d2800ec3601da9e2214ce1701979f6b8bbb6547487d5b95c5dbc5c3ca` |
| `tests/unit/dashboard/archive-render.test.ts` | `e7139505e5d31fd872f3d5d37d5969f645fc845cb07e984bc87bf0d48032651f` | `af83d4b84f2968d1a8779ce863ddffcc219368d90dcfe7df61f6bcfa48c8e1cf` |
| `src/dashboard/AGENTS.md` | `58ba56deecbea58dde295b0747a1cde30a684f3837e99a8ba6b7c5c78aad9f57` | `241294808ee906972a1e29c5f67c0ca7ab7671ea2a58fc2bfc5a5af5a6a3fbee` |

**3 files, +12/−0:** production+1, test+6, lesson+5.
[Isolated delta](../evidence/dca4-gates/loading-delta.patch) SHA256
`be50b42e0b50854b71e307aedf207a50ae0a7e756bb0d8fe83cf55db2900c381`.
Generated with `diff -u -L before/<path> -L after/<path> <preserved original> <current>`,
concatenated in production/test/AGENTS order, no timestamps or normalization.
The saved patch was rehashed to verify exact bytes.

[Before identity](../evidence/dca4-gates/loading-before.json) identifies byte-exact preserved
`loading-before-archive.tsx.txt`, `loading-before-archive-render.test.ts.txt` and
`loading-before-dashboard-AGENTS.md.txt`; all original copy hashes were rechecked after gates.
[After identity/log hashes](../evidence/dca4-gates/loading-after.json) freezes candidate and evidence.

Protected CURRENT scope is source/tests/scripts/config excluding ONLY the three authorized files,
so its1,625-path count differs deliberately from gate05's six-reference exclusion.
Before/after protected digest both
`e94cd71949ebcda7ea1829d1045844437a16b9446cadcaf74aece1cb17fca625`.
No refs/companions/shared ratchet files changed. All three source edits are accounted for by the
isolated patch; no inherited dirty work discarded.

Browser spec remains `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`,
**23317 bytes**. All six reference hashes remain exactly those in loading-before.json:
desktop PNG1515745bbc5ea128ff7d61a74234a3c0fd521f06082648d26a67e92b3fa5ad91;
phone PNG275ac863a51674e5269c39aea3aea736f34377dbff674d0bf72607ed6a8049c3;
a11y/meta unchanged. Prior05 raw logs, before/ref evidence and failed gate remain preserved.

## Receive / deferred work

No shared DS/materializer/backend/domain/guard/config/spec/PNG/credential edit, no full gate,
no own watchdog, no assertion or threshold weakening, no commit. Nearest lesson updated per /ui
and repository rules; /tdd forced original DOM red before the one-line source edit.
The unchanged ratchet now passes locally; no claim that other fullcoverage05 failures are resolved.
Coherent pending category: Archive preview explicit eager loading + rendered regression + lesson.

Parent receives this frozen delta before independent Tests/Standards review. Those reviews and
subsequent required full gates belong to parent/coordinator. **Sole writer ownership relinquished;
no active command and no further writes after receipt.**
