# DCA4 A4 — standards

Independent native `sup_luna`, high reasoning; reviewer `01a05310-bd69-7630-93b1-88c6c475c29e`.
Frozen whole target matched before/after: backend `5d273caa…728`, UI `41e10b89…350`, recorded
new/test hashes. Read-only; no gates. Reviewer closed.

- `tests/parity/helpers/fixture-bff.ts:221` **medium** — new resource payload bypasses the file's
  declared owning strict-schema parse. Fix: parse `ArchivedCaptureResourceWireSchema` before JSON.
- `tests/parity/helpers/fixture-archive-evidence.ts:94–111` **medium** — changed capture digest,
  length and dimensions retain cloned archive content fingerprint. Fix: derive coherent archived
  content fixture and recompute its archive fingerprint, not a hash of reconstructed wire data.
- `src/dashboard/surfaces/archive.tsx:2218–2224` **low** — no intrinsic dimensions or reserved
  aspect ratio; image load can shift layout. Fix: frozen dimensions or explicit no-guess shell.
- `src/dashboard/surfaces/archive.tsx:2427–2430` **low** — stale comment says viewer can never show
  bytes. Fix: describe separate frozen metadata and exact retained-byte read.

Count: 4 · Worst: medium. Parent confirmed schema bypass, stale comment and geometry. Coherent
fixture authority requires investigation within the original fixture seam; do not fabricate a
digest from wire reconstruction or broaden the archive proof. Parent additionally found the A3
report's “dedicated profile” claim does not match an unconditional evidence fixture route: require
explicit scenario isolation before receiving that claim. No blanket parity refresh is authorized.

## Final frozen re-review — closed

Same independent native reviewer confirmed all four findings resolved: strict wire parse
(`fixture-bff.ts:225`), canonical sealed content before wire/index and opt-in scenario
(`fixture-archive-evidence.ts:130`, `fixture-bff.ts:143`), stable preview/frozen dimensions plus
honest absence (`archive.tsx:2325,2372`, `archive-model.ts:715`), corrected stale comment (`:2460`).
Focus remains opener/generation-bound and hooks remain in the model; no shared-control edit.
Final `d62a186b…251` and all four A3-repair content hashes matched before/after. No gates/browser;
reviewer closed. Remaining Count: 0 · Worst: none · Prior findings closed: 4.
