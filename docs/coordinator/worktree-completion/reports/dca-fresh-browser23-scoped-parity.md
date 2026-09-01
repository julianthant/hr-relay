# DCA fresh browser 23 — scoped parity evidence

## Run

- Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- Branch: `feature/dca4-archive-evidence`
- Command (once only):

  ```sh
  /usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/diagnostic-bundle-dialog.spec.ts tests/parity/archive-evidence.spec.ts tests/parity/run-captures.spec.ts
  ```

- Update mode: unset (`env -u PARITY_UPDATE`); no reference-update command was run.
- Started/finished (UTC): `2026-08-31T21:29:17Z` / `2026-08-31T21:29:50Z`.
- Exit: `0`; lock released when the `lockf` process exited.
- Result: 37 expected, 37 passed; 0 skipped, unexpected, or flaky; duration `32852.201ms`.
- Raw command log: `evidence/dca-fresh-browser23-20260831T212917Z/parity.log` (SHA-256 `f64e1633bd4a2889390b69e4811970bd112feb7820acda9dc1f091c7be60d083`).
- Frozen JSON result: `evidence/dca-fresh-browser23-20260831T212917Z/results.json` (SHA-256 `30e3eeb7794506c3083145e7600b45dbda7d17a60cf6278d0073606ea0fb5466`).

## Per-test result

Every selected test expected `passed`, returned `passed`, and has Playwright status `expected`.
Required evidence is body-backed only where named below; `—` means the selected test declared none.

| File | Test | Expected | Result | Status | Required a11y evidence |
| --- | --- | --- | --- | --- | --- |
| archive-evidence.spec.ts | desktop keyboard opens, closes with Escape, reopens and returns focus from footer Close | passed | passed | expected | — |
| archive-evidence.spec.ts | narrow viewport keeps the footer and preview inside the dialog | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen facts accessible for a visible missing refusal | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen facts accessible for a visible corrupt refusal | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen facts accessible for a visible request refusal | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen facts accessible for a visible image-http refusal | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen facts accessible for a visible decode refusal | passed | passed | expected | — |
| archive-evidence.spec.ts | verified archived capture evidence graphite-warm @ 1280x720 | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen metadata stationary across resource, HTTP and decode readiness | passed | passed | expected | — |
| archive-evidence.spec.ts | verified archived capture evidence paper-ink @ phone-390x844 | passed | passed | expected | — |
| archive-evidence.spec.ts | keeps frozen metadata stationary across resource, HTTP and decode readiness | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | opens the strict bundle dialog, opens its exact gallery resource, restores focus, and downloads served bytes | passed | passed | expected | diagnostic-lightbox-keyboard-focus.a11y.yml |
| diagnostic-bundle-dialog.spec.ts | captures the exact-identity screenshot gallery with attributable fixture metadata | passed | passed | expected | diagnostic-lightbox--graphite-warm--1280x720.a11y.yml |
| diagnostic-bundle-dialog.spec.ts | captures the exact-identity screenshot gallery in paper ink | passed | passed | expected | diagnostic-lightbox--paper-ink--1280x720.a11y.yml |
| diagnostic-bundle-dialog.spec.ts | re-reads the exact bundle after an image failure and names its typed authority outcome | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | does not reopen when a delayed bundle verification settles after Escape | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | isolates two failed screenshots and accepts their rechecks out of order | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | continues parent-owned verification after lightbox Escape without leaving a dead loading state | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | a parent footer close invalidates a delayed image reread before the same bundle reopens | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | refuses content-digest drift on image reread instead of granting a browser-only download | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | refuses screenshot-metadata drift on image reread instead of granting a browser-only download | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | does not fetch the offscreen gallery eagerly and admits only visible thumbnails | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | keeps a genuine loading state and no download until the selected image decodes | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | keeps restricted JPEG bytes, dimensions and warning honest on the lightbox download | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | keeps the requested dialog identity when a strict response carries a foreign bundle id | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | an unknown reread error never grants a screenshot download | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | portrait screenshot gallery and lightbox stay within 320px with touch-sized actions | passed | passed | expected | diagnostic-lightbox--portrait--320x844.a11y.yml |
| diagnostic-bundle-dialog.spec.ts | portrait screenshot gallery and lightbox stay within 390px with touch-sized actions | passed | passed | expected | diagnostic-lightbox--portrait--390x844.a11y.yml |
| diagnostic-bundle-dialog.spec.ts | keeps the absent diagnostic-bundle arm explanatory and does not expose a dead action | passed | passed | expected | — |
| diagnostic-bundle-dialog.spec.ts | keeps the lg dialog inside the mobile viewport with touch-sized actions | passed | passed | expected | — |
| run-captures.spec.ts | full Receipt keeps exact JPEG/data captures, native bytes and keyboard focus | passed | passed | expected | run-captures-full-graphite-desktop.a11y.yml; run-capture-jpeg-graphite-desktop.a11y.yml |
| run-captures.spec.ts | full Receipt renders in Paper Ink at the desktop viewport | passed | passed | expected | run-captures-full-paper-desktop.a11y.yml |
| run-captures.spec.ts | image refusal keeps the preview frame and metadata stationary | passed | passed | expected | — |
| run-captures.spec.ts | closing during image load invalidates the dialog and restores its opener | passed | passed | expected | — |
| run-captures.spec.ts | served absence makes no speculative capture request | passed | passed | expected | — |
| run-captures.spec.ts | short Receipt preserves all origins and literal failure framing | passed | passed | expected | run-capture-png-paper-phone.a11y.yml |
| run-captures.spec.ts | short Receipt renders in Graphite Warm at the phone viewport | passed | passed | expected | run-captures-short-graphite-phone.a11y.yml |

## Attachment verification

All 10 required body-backed `.a11y.yml` attachments were decoded to safe, unique names under `evidence/dca-fresh-browser23-20260831T212917Z/a11y-attachments/`. Each body is valid UTF-8 and has the same SHA-256 as its test annotation. The full machine-readable per-test evidence is `evidence/dca-fresh-browser23-20260831T212917Z/a11y-evidence-verification.json` (SHA-256 `31ba2974895129a215562fc72b7d2b81f2e894055413d12fcb015ec864883327`).

| Required evidence | Annotation/body SHA-256 | Bytes | UTF-8 |
| --- | --- | ---: | --- |
| diagnostic-lightbox-keyboard-focus.a11y.yml | d8ac64585ae9307f85ba1629ee776ed534fbf3b9598f742b0a7654fb0837bdda / equal | 675 | yes |
| diagnostic-lightbox--graphite-warm--1280x720.a11y.yml | 84126fddae629341f545259a748a9ab4ccdace8f385d5bee366dcf4e86fa6fe0 / equal | 682 | yes |
| diagnostic-lightbox--paper-ink--1280x720.a11y.yml | 84126fddae629341f545259a748a9ab4ccdace8f385d5bee366dcf4e86fa6fe0 / equal | 682 | yes |
| diagnostic-lightbox--portrait--320x844.a11y.yml | 2755917f413bf3ea49cb0c6cfc711c6acf7526a3359796d1ce4fb41f6f2dcbfa / equal | 672 | yes |
| diagnostic-lightbox--portrait--390x844.a11y.yml | 2755917f413bf3ea49cb0c6cfc711c6acf7526a3359796d1ce4fb41f6f2dcbfa / equal | 672 | yes |
| run-captures-full-graphite-desktop.a11y.yml | 59285298960000dd6258341771cdd6b095bc7c11c8d2f9bd5b04d75e204bc699 / equal | 14269 | yes |
| run-capture-jpeg-graphite-desktop.a11y.yml | 64ab1693e36c8a0704ba9bb2673e2f157863104051cf13c6a62bd940d979049c / equal | 1141 | yes |
| run-captures-full-paper-desktop.a11y.yml | 0473cd69dab0f86279b327a423878a0bd93b5854a48d1bdad2a010b6e7f9c028 / equal | 14273 | yes |
| run-capture-png-paper-phone.a11y.yml | 02e2a3663a351becfe9c6d059eddc39fd63d3480b695caf37c0f3140eb2bc854 / equal | 1422 | yes |
| run-captures-short-graphite-phone.a11y.yml | 90ad31767e736ba06717bb056308c2bc3d2bf2eac85713b4a1f3f3c224ee6e1a / equal | 13211 | yes |

## Immutable references and preserved output

The scoped Gallery/Archive/Receipt set comprises 36 reference files. Its before and after SHA-256 manifests are byte-identical (each manifest SHA-256: `b477ccd9d347b87478213a7d081e7e604a12eb4284bf65e452d971b30486ebd0`); `reference-hash-comparison.txt` records `UNCHANGED`.

- Before: `evidence/dca-fresh-browser23-20260831T212917Z/reference-hashes-before.sha256`
- After: `evidence/dca-fresh-browser23-20260831T212917Z/reference-hashes-after.sha256`
- Complete post-run `tests/parity/.output` copy: `evidence/dca-fresh-browser23-20260831T212917Z/output/`
- Complete 22-file copied-output inventory: `evidence/dca-fresh-browser23-20260831T212917Z/output-inventory.txt`
- Invocation, update-mode, timing, exit, and release record: `evidence/dca-fresh-browser23-20260831T212917Z/invocation.txt`

No source, test, reference, package, or config files were edited, staged, or committed by this lane.

## Supervisor visual and accessibility inspection

The supervisor opened every distinct preserved product render from this run (five diagnostic
lightboxes and five Receipt/capture views), plus all four asserted outer Gallery/Archive reference
images. Desktop and phone layouts remain inside their viewports; modal headers and footers stay
available; 320 px actions wrap without overlap; the Archive phone view preserves the frozen facts
and fixed footer; both Graphite Warm and Paper Ink retain legible hierarchy, focus framing, and
download/close affordances. No clipped action, overlapping control, stale loading state, missing
preview, or obvious contrast regression was visible.

The decoded accessibility bodies expose the required semantic roots: every diagnostic preview is a
named `dialog` with a matching level-2 heading, named image, Back button, and Download link; every
capture preview is a named `dialog` with a matching heading, `figure`, and Download link; the full
and short Receipt views retain the selected Receipt tab and named `Run captures` region. The
asserted Archive references independently retain a named dialog, banner/heading, named preview
figure, complete frozen-fact term/definition sequence, and content-info actions. Gallery references
retain a named bundle dialog, named `Diagnostic screenshots` region, status, and manifest link.

UI setup observed for this verification: React 19 + Vite 8 + TypeScript + Tailwind 4 with
Radix/Lucide; no Next.js and no `components.json`/shadcn installation. The live Web Interface
Guidelines document used by the UI route had SHA-256
`5a775e7525bdce4bed1528981f7f2a3a4ba2b22df741c7465594492f077fbb50`.
