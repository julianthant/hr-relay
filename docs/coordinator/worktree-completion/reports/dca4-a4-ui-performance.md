# DCA4 A4 — UI performance

Independent native `sup_terra`, high reasoning; reviewer `01a052ff-414f-79b3-bc5d-fa871c2457dd`.
Frozen target: A4 ledger UI patch `41e10b89…350` plus four new-file hashes, base/head `eda17b27`.
All hashes verified before/after. No tests, lint, tsc, or browser. Reviewer closed.

- `src/dashboard/surfaces/archive.tsx:2217` **medium** — loading reserves a 128px skeleton, while
  decoded content has intrinsic image height capped at 56dvh. No stable preview slot reserves final
  space, so delayed decode changes height and displaces frozen metadata. Fix: use one stable preview
  slot for loading/ready/error, using frozen dimensions where present.

Count: 1 · Worst: medium. Parent verified `h-32` loading versus image `max-h-[56dvh] w-full`;
accepted for scoped UI fix and gated geometry proof. No other structural performance finding.
Backend performance review remains a separate zero-finding report, not a claim to have repaired
the shared inherited byte materializer (which DCA4 never edited).

## Final frozen structural re-review

Same independent native reviewer confirmed the shared reserved frame (`archive.tsx:2324`) resolves
the differing-height structure across resource loading, HTTP load, decode, success and failure.
Prepared geometry stages (`archive-evidence.spec.ts:171`) still need browser execution. Reviewed
cancellation, image ownership, focus lifetime, render dependencies and fixture costs; no additional
structural defect. Final `d62a186b…251` and four A3-repair hashes matched before/after; no gates/browser;
reviewer closed. Remaining structural Count: 0 · Worst: none. Actual geometry proof remains pending.
