# DCA4 A4 — UI security

Independent native `sup_sol`, high reasoning; reviewer `01a052fb-b984-73e0-bbf5-ed19d516706b`.
Frozen target: A4 ledger UI patch `41e10b89…350` plus four new-file hashes, base/head `eda17b27`.
Before/after hashes matched. Read-only static review; no tests/browser/gate. Reviewer closed.

Zero security findings. Count: 0 · Worst: none.

Reviewed exact response IDs and encoded download path, stale response invalidation and abort,
React text rendering of errors, PNG/JPEG-only inline display, native checked download link,
fixture ID isolation, and exact supplied-byte ArrayBuffer copy. No untrusted URL or filesystem path
is admitted to the viewer by the changed boundary. Backend not re-reviewed. Inherited broken
snapshots were not accepted as proof. Browser/parity evidence remains pending.

## Final frozen delta review

Same independent native `sup_sol` reviewer verified final `d62a186b…251` plus four A3-repair hashes
before/after. Zero findings: exact IDs/path remain mandatory, PNG/JPEG only, mounted image attempt
is invalidated, focus requires current generation/connected opener, canonical fixture projection
excludes immutable input, and evidence profile plus exact IDs gates fixture access. No tests/browser
or mutations. Reviewer closed. Count: 0 · Worst: none; no browser-security claim.
