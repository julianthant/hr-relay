# DCA4 A3 — allocated Archive gate03 receive

**PARTIAL / VISUAL REFUSAL. Heavy slot release requested immediately after direct PNG review;
no source fix or further gate.** No active owned command/browser. No commits or staging.
The two refreshed triplets remain **unaccepted candidate evidence**, not approved baselines.

## Executed sequence and exact output

Workdir for every command: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
Binding updated `briefs/dca4-gate-resume.md` read fully. Used /ui repository parity verification.
Parent supplied allocation; only two serial heavy commands ran, each under the required lock.

| Command | UTC start → end | Outcome |
| --- | --- | --- |
| `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts` | 2026-08-30T15:54:21.837Z → 2026-08-30T15:54:36.682Z | exit1; **2 failed / 9 passed (14.2s)**. Exclusively the two assigned a11y reference differences. |
| `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity:update -- tests/parity/archive-evidence.spec.ts` | 2026-08-30T15:54:55.304Z → 2026-08-30T15:55:06.704Z | exit0; **11 passed (10.9s)**. Deliberately created only the two missing assigned PNGs and refreshed their semantic triplets. |

- [Raw asserted run](../evidence/dca4-gates/scoped-assertion-03.log), SHA256
  `590a978d75f0b922dc60cad92d05db59ea96a8852eac2f8dfff496912b6572c3`.
- [Raw deliberate update](../evidence/dca4-gates/scoped-update-03.log), SHA256
  `3f0ac6b0bc278306850869b0247b08af61b77b8d1b4375db9a36f767811f5aaf`.
- [Desktop error context](../evidence/dca4-gates/desktop-error-context-03.md),
  [phone error context](../evidence/dca4-gates/phone-error-context-03.md).
- [Accepted build stamp](../evidence/dca4-gates/scoped-assertion-build-stamp-03.json):
  builtAt2026-08-30T15:54:25.425Z; input206cc47904dbd47e03e807703ad56d90653d812e1ae9263836a842c3636d1914,
  output1df11de50a7b86b4023c74470ff06400fdea1a483490fb718239fb720c6bb302.
  The update reused this matching stamped bundle.

PARITY_UPDATE was verified unset before assertion and remains unset after the update subprocess.
No waits, thresholds, masks, scripts, fixed ports, shared helpers or assertions changed.
Both raw logs match concatenated command output byte-for-byte.

## Stop reason: direct rendered review is not the update command

Both newly generated PNGs were directly opened at native viewport size, with the complete
a11y differences and metadata read. Both show the exact grayscale synthetic capture rather
than the inherited broken image. Phone has separated footer controls and readable metadata
in the scrolling body. Desktop retains the modal/DS identity and fixed footer.

**New visual concern requiring parent disposition:** in desktop graphite-warm, the success caption
is drawn across the light lower edge of the image. It is visibly over image content with reduced
legibility; do not treat the green update run as approval of this presentation.

Source inspection (no edit) confirms the geometry:
`src/dashboard/surfaces/archive.tsx:2376` gives the image
`absolute inset-0 h-full w-full object-contain`; line2381 gives its sibling caption
`absolute inset-x-0 bottom-0` within the same preview frame (line2315).
No separate caption row is reserved. The caption declares a background token, but its computed
resolution/opacity/contrast has **not** been probed; no numeric contrast claim or token diagnosis
is made here. The original image bytes are not the repair target.

This was discovered only after deliberate reference generation made actual PNG inspection possible.
Parent received live PNG paths promptly, then a RELEASE notice before receipt work. No additional
browser command, diagnostic instrumentation, normalization, source repair or reference rewrite followed.

### Preserved actual images (unaccepted)

- [Desktop1280×720](../evidence/dca4-gates/archive-evidence--graphite-warm--1280x720-03.png)
  — `826127529d8ec9e3724c51b16e8a0f3241c09ec7f1b5e6c190e8357d80d99992`.
- [Phone390×844](../evidence/dca4-gates/archive-evidence--paper-ink--phone-390x844-03.png)
  — `0b6626ded1f052a0e2d10511cd87f50a175193e1a7b06fe6b0536d2b96005fc4`.

These evidence copies are byte-identical to the active candidate PNG files in
`tests/parity/references/`. Each candidate's a11y/meta bytes are also preserved with
`-03.a11y.yml` / `-03.meta.json` names under this evidence directory.
Earlier six BAD intake/provenance artifacts remain intact and were hash-checked before/after.

## Reference attribution (allowed two-triplet scope only)

[Full two-a11y diff](../evidence/dca4-gates/reference-attribution-03.patch), SHA256
`77fdef4837bffe84770dde126e129b8ab05113f73a8c27bfa5ec8a0e351e2807`.

Both semantic changes have the same reviewed origins:

- Canonical evidence fixture replaces the earlier broad fixture clone: run label/id,
  ucpath-person step, ucpath system, operator-request origin,10AM time, exact3281-byte size
  and digestf3ede459…ebcd3847; Download path binds the actual canonical run and artifact.
- Reviewed UI copy separates frozen pointer facts from exact byte checks.
- Stable preview figure name is `Archived capture preview`, distinct from readiness caption.
- Kind/image/png/1440×900, sensitivity, artifact/bundle ids, retention and footer actions retained.
- Metadata provenance files remained byte-identical (same fixtureId/theme/viewport/appVersion/
  descriptorHash/date/variant).
- Two PNGs were absent from active references; they were created deliberately, not copied from
  the BAD intake screenshots. No other corpus reference changed.

| Assigned active file | SHA256 after update |
| --- | --- |
| `tests/parity/references/archive-evidence--graphite-warm--1280x720.a11y.yml` | `be60674f973994ef46749b1c143c42f0b7798caef950bf1c8d8f4ce345155ee6` |
| `tests/parity/references/archive-evidence--graphite-warm--1280x720.meta.json` | `c9f7c4d5f4d00ac261fe8025369603f9c75dd6eaa5a9da0e81f3415a607c7e69` |
| `tests/parity/references/archive-evidence--graphite-warm--1280x720.png` | `826127529d8ec9e3724c51b16e8a0f3241c09ec7f1b5e6c190e8357d80d99992` |
| `tests/parity/references/archive-evidence--paper-ink--phone-390x844.a11y.yml` | `c455a509f8eef7b08a9e7d22ed4160d5871595c81f2c970db23aa7863d660223` |
| `tests/parity/references/archive-evidence--paper-ink--phone-390x844.meta.json` | `469e7558722db7ef27ddccc7773df09e08eec1e324940d3ade2f4507aeb51c7e` |
| `tests/parity/references/archive-evidence--paper-ink--phone-390x844.png` | `0b6626ded1f052a0e2d10511cd87f50a175193e1a7b06fe6b0536d2b96005fc4` |

## What passed, and what remains unproved

| UI acceptance item | Evidence / boundary |
| --- | --- |
| Exact PNG load/decode and download bytes | Both happy cases passed decode1440×900, exact Buffer equality, URL and frozen metadata checks before reference comparison; update also passed both. |
| Coarse phone44px height AND width | Unchanged assertControlGeometry passed all five header/footer controls in both runs, unlike gate02. This is actual390×844 touch/coarse context. |
| Edge hits/nonoverlap/overflow/body-footer separation | Existing browser assertions passed on happy phone/desktop and narrow case. No limits weakened. |
| Loading→resource→HTTP→decode metadata geometry | Both viewport barrier tests passed; frozen metadata/preview rectangles remained equal. |
| Keyboard close/reopen/Escape/focus return | Existing desktop keyboard case passed. |
| Missing/corrupt/request/HTTP/decode refusal | All five passed visible refusal and preserved frozen metadata checks. Decoder invocation and1440×900 dimensions, exact abort requestfailed tuple passed. |
| Readiness caption legibility/placement | **Direct desktop PNG review refused; parent disposition/repair pending.** |
| Asserted screenshots against refreshed triplets | **NOT RUN** after visual concern; update-mode pass is not an asserted-reference pass. |
| Two approved404 negative controls + restored positives | **NOT RUN**; no spec mutation occurred. |
| Full coverage / full asserted parity | **NOT RUN**; parent full-gate GO not sought while visual concern remains. |

## Exact frozen source identity / release

HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`, branch `feature/dca4-archive-evidence` unchanged.
UI seven-path aggregate stays `2cae368f56de44b7f6c89665fc08fa1d13e1fbe36510266c198d8fa94c19212d`.
Backend six-path aggregate stays `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.
Spec stays exact `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` throughout; no restoration was necessary.
All five companion hashes matched the received brief before commands and remain covered by the
unchanged protected map.

[frozen-before](../evidence/dca4-gates/frozen-before-03.json) /
[frozen-after](../evidence/dca4-gates/frozen-after-03.json) retain receipt values.
SHA256 of sorted tracked/untracked path→hash map under src/tests/scripts/config,
excluding only the two authorized triplets, is unchanged:
`a456997fd76e7853baa20eb472615cd551271ee5d5eccc05b4b4153d62f0ccf7`.
This covers all product files, shared DS, HTTP fixture/PNG source, materializer, test spec,
capture helper/config thresholds and unrelated references. Root/backend owning files were
not edited. Final `git diff --check` exit0. Original six intake hashes still match.

Only the authorized two triplets plus own uniquely named coordination evidence/report were written.
No further gate or fix while holding the slot; parent owns independent rendered assessment and next
bounded repair/requeue. **Gate unit closed and ownership relinquished.**
