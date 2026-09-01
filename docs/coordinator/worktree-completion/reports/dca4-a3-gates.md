# DCA4 A3 scoped gate return — RED, slot released

2026-08-30. **Scoped assertion exited 1: 6 failed / 5 passed, 52.6s.** These are non-reference
browser failures. The command exited before the parent was immediately notified; no repair, retry,
reference update, coverage or further parity command followed. Parent acknowledged and notified the
coordinator to release the slot. This gate unit is closed and relinquishes ownership for separately
authorized diagnosis/repair/requeue. No active owned command or separately launched browser remains.

## Exact invocation and evidence

Workdir for every command: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts
```

- Started: `2026-08-30T15:08:24.357Z` (08:08:24 PDT).
- Exit received: `2026-08-30T15:09:20.158Z` (08:09:20 PDT).
- Exit code: **1**. Runner: **11 tests, one worker**, normal configured assertion timeouts.
- Raw complete stdout/stderr tool stream: [scoped-assertion-01.log](../evidence/dca4-gates/scoped-assertion-01.log).
  Saved text was compared exactly to the accumulated command output, including its final newline.
  SHA-256: `29c8acc928c4353538021af20632999c0ac17b300a2768af0e5d31999e85ff97`.
- The six original error contexts were copied byte-for-byte into the same evidence directory.
  Generated context instructions are retained as evidence, not executed as authority.

| Case | Exact failure / outcome | Preserved artifact |
| --- | --- | --- |
| Desktop dark image | spec line 129: image role not found; `toBeVisible`, 5000ms | [desktop-image](../evidence/dca4-gates/desktop-image-error-context.md) |
| Desktop geometry | line 215: `data-dca4-decode-started` never becomes `true`; repeated locator has hidden image and no marker, 5000ms | [desktop-geometry](../evidence/dca4-gates/desktop-geometry-error-context.md) |
| Coarse-touch phone light image | line 129: same ready-image absence, 5000ms | [phone-image](../evidence/dca4-gates/phone-image-error-context.md) |
| Phone geometry | line 215: same missing decoder-start marker, 5000ms | [phone-geometry](../evidence/dca4-gates/phone-geometry-error-context.md) |
| Desktop keyboard | line 238: initial success caption absent, before close/reopen/focus assertions, 5000ms | [desktop-keyboard](../evidence/dca4-gates/desktop-keyboard-error-context.md) |
| Narrow viewport | line 260: success caption absent before geometry assertions, 5000ms | [narrow](../evidence/dca4-gates/narrow-error-context.md) |
| Missing / corrupt / request / image-http / decode refusal | Each reported passed (712 / 715 / 718 / 749 / 751ms) | Raw log |

The five passing labels are not proof that the decoder override actually ran: its expected visible
failure can also be reached through an earlier image HTTP failure. This run does prove those refusal
assertions passed, but does **not** independently prove the named decoder injection was exercised.

## Safe observed state; HTTP evidence limits

Desktop/phone image, keyboard and narrow error contexts include the rendered accessibility state:

- Dialog `screenshot at ucpath-person`, capture 1 of 1.
- Visible alert: **“Capture image could not be displayed”**, followed by the existing explanation
  that the browser could not load or decode the retained image.
- Frozen facts remain: `image/png`, **3281 bytes**, **1440 × 900**, digest
  `f3ede4591dd6034661d8d63aef43ce4734610be67edbc7e30ce68834ebcd3847`, exact artifact/bundle IDs and retention text.
- Exact Download URL:
  `/artifacts/v1/archive/99999999-0009-4000-8000-999900000009/aa11bb22-000a-4000-8000-aa11bb22000a`.
- Geometry logs show that same `img.src`, frozen width/height, `aria-hidden="true"`, empty alt and
  opacity-zero class. No success claim is observed.

**No HTTP status, response headers, body bytes or network trace is present in these error contexts.**
No additional server, curl request or browser was launched after red. The next section is source
evidence and ranked hypotheses, not a claim to have captured an actual HTTP 404 or inspected a response.

## Source hypotheses — no changes made

1. **Strongest: the fixture HTTP adapter does not dispatch the artifact route to Hono.**
   `tests/parity/helpers/fixture-bff.ts:237` declares the exact byte handler on the Hono app.
   But `startFixtureServer` at line 499 dispatches only paths beginning `/api/` to `app.fetch`;
   all other non-SSE paths reach `serveStatic` at line 512. The requested `/artifacts/v1/archive/...`
   path therefore bypasses that byte handler. `serveStatic` (lines 419–433) returns 404 `not found`
   if its disk read fails, and the built-file inventory contains no `/artifacts/` path. A static
   404 is consequently the strongest source-derived explanation, **not captured HTTP evidence**.
   The earlier unit fixture proof calls the Hono app directly, so it does not exercise this server
   dispatch boundary. A future authorized diagnostic should establish actual status/media/body
   from this boundary before any repair. No static fallback or fixed-port workaround is proposed.
2. **Lower-ranked alternative: image ownership/load processing prevents the decoder call.**
   `archive.tsx:2379` calls `decodeImage` from the image's load event; the model checks mounted-image
   ownership. The geometry marker proves the overridden decoder was not called, but alone cannot
   distinguish a pre-load byte failure from an ownership refusal. The real visible failure alert and
   concrete server dispatch gap favor hypothesis 1. No lifecycle changes are authorized by this return.
3. **Not established: corrupt fixture PNG or download headers rejected by the browser.**
   Existing pinned bytes/schema tests and unchanged byte source do not establish the live adapter's
   HTTP behavior. This run does not justify replacing the PNG or changing its digest/headers. First
   verify whether these bytes reach the browser through the declared route at all.

## Frozen inputs and build provenance

- HEAD before/after: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
- UI tracked patch before/after:
  `54895c9b4210a5444cd9bdb9dbf02ef4be56f8562329bc5f9e882c31875c1f44`.
- Backend tracked patch before/after:
  `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.
- Four new UI files match the A3 repair receipt; spec SHA-256 remains
  `7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0`.
- `PARITY_UPDATE` was unset. The existing one-worker parity configuration, zero changed-pixel
  allowance, threshold 0.2, timeouts, capture/reference helpers and assertions were not modified.
- Shared `artifact-bytes.ts` is unchanged. No source/test/reference edits, staging or commits.
- The unchanged parity entry builds through `ensureParityBundle` and refuses an unstamped server.
  Its [preserved stamp](../evidence/dca4-gates/scoped-assertion-01-build-stamp.json) was built at
  `2026-08-30T15:08:31.146Z`, script `web:build`, input digest
  `e6bd902dd41aa22c76010650044ac671b952b4b955b4445db59dcb1c8492c5d3`, output digest
  `043c90f5eabde8ade223303fcecd732eed8b6af5ad496d6e461a341b28dcc95f`.
  No stamp bypass, manual build normalization or port change occurred.

## Reference and acceptance disposition

All **six** inherited intake/provenance files were hash-verified against
[the intake manifest](../evidence/dca4-intake/README.md) before this run. The four active a11y/meta
files still matched their preserved originals. The two broken PNGs remain BAD intake evidence at:

- `docs/coordinator/worktree-completion/evidence/dca4-intake/archive-evidence--graphite-warm--1280x720-darwin.png`
- `docs/coordinator/worktree-completion/evidence/dca4-intake/archive-evidence--paper-ink--phone-390x844-darwin.png`

**No new screenshot was produced.** Both happy tests failed before `captureParityPair`; no reference
comparison or deliberate reference update was reached. No current image paths can be handed back as
successful proof. Actual decode/download, keyboard close/reopen/focus, final geometry, coarse-pointer
hit rectangles and the two triplets remain unaccepted. This is not reference-only drift.

No full coverage or full asserted parity is authorized by this red return. Parent owns repair
dispatch and later reallocation. Future code/fixture changes require their own focused proof and
rereview before the heavy sequence resumes. **Gate unit closed; slot and write ownership released.**
