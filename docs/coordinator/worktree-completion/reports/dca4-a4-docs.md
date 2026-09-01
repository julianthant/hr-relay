# DCA4 A4 — docs

Independent native `sup_luna`, high reasoning; reviewer `01a05310-5a72-7203-9886-f28ea5cf757f`.
Whole frozen backend/UI target in A4 ledger at `eda17b27`, hashes matched before/after.
Read-only; no gates. Reviewer closed.

- `docs/rebuild/reference/frontend-backend-integration.md:798,810` **medium** — malformed-ID
  HTTP 400 text omits the handlers' earlier uncomposed-capability HTTP 409 check
  (`src/server/dashboard/routes/api.ts:190–196,204–210`). Fix: document capability-check precedence,
  or change validation order to match the claimed contract.

Count: 1 · Worst: medium. Parent verified the route ordering. Chosen bounded disposition:
document the existing capability-first behavior and pin malformed-ID-plus-missing-store coverage;
no reason to change runtime precedence or infer authority when capability is absent.

## Focused re-review — closed

Same independent native reviewer confirmed the clarification at `:798` and table `:813–814`
matches unchanged handlers `api.ts:190,204`. Four regressions at route-test `:173` assert no-store
409, zero lookup and zero byte opens for both routes × both malformed IDs.
Documentation hash `a5efeff5a72529c8c472c14c90ba1efdbbe314f3ec586360930f68adc3fbf1f7`, diff hash
`1d17f52c4f98f0a1b6552a87d12d44ed8d5516553ecddc7ec340a248576680a6`, and route-test hash
`e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30` all matched before/after.
No gate or UI inspection; reviewer closed.

Remaining Count: 0 · Worst: none · Prior finding closed: 1.

## Final UI documentation delta

Same independent reviewer found one additional **low** stale comment at `archive-model.ts:694`:
the formatter comment still called the viewer “never an image” and its description the whole
product. New dashboard AGENTS notes otherwise matched implemented request/image/focus/fixture
ownership. Target `d62a186b…251` and four content hashes matched before/after. Count: 1 · Worst: low.

Parent verified and made only that trivial comment correction: the formatter is byte-independent;
the separate exact-resource read may display retained bytes without replacing frozen facts.
Final UI hash `54895c9b4210a5444cd9bdb9dbf02ef4be56f8562329bc5f9e882c31875c1f44`;
model file `3ffb7ec82322d934af11380a8a5bac19f3c3f86ba05964867cb45e877f6e2df0`.
TypeScript ESNext transpilation with comments removed hashes identically before/after:
`565c751d143c681bc098f89a206eeeccfbb87d44f707b3ada7307ab10bbdcc0e`.
No runtime/test change; focused comment re-review and source lint are pending.

Focused source lint exited 0 under the shared light lock. Same independent reviewer verified the
final comment and both file/aggregate hashes before/after; low finding closed. All four new-file
hashes remain unchanged. Reviewer closed. Final Docs remaining Count: 0 · Worst: none.
