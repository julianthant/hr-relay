# DCA4 A4 — UI correctness

Independent native `sup_terra`, high reasoning; reviewer `01a052fb-ba16-7803-82d7-1f7c41c361db`.
Frozen target: A4 ledger UI patch `41e10b89…350` plus its four new-file hashes, base/head `eda17b27`.
All hashes matched before/after. Read-only static review; no execution gates. Reviewer closed.

- `src/dashboard/surfaces/archive.tsx:2235` **medium** — decoder callbacks update shared image state
  without checking whether their image is still current. A pending A decode settling after B—or
  reopened A—has decoded overwrites its ready state; the URL/epoch filter then hides the current
  image indefinitely after its load event already fired. Fix: reject obsolete decoder completions
  using a token bound to the mounted image attempt.
- `src/dashboard/surfaces/archive.tsx:2162` **medium** — readiness survives navigation because epoch
  increments only on close. A → non-image/loading B → A reuses the previous URL/epoch and can expose
  success before the newly mounted A image loads/decodes. Fix: readiness belongs to each image
  mount/selection attempt, not merely URL and close generation.

Count: 2 · Worst: medium. Parent verified the unconditional decoder state writes and close-only
epoch in the current source. Both findings accepted for a bounded UI repair with deferred-decoder
and A→B→A regressions. They are not yet closed.

Separate gate failure: full locked `npm run lint` exited 1 with
`archive-model.ts:859 react-hooks/exhaustive-deps` (missing `request`). This is not a re-ranked
review finding; repair must preserve stable request lifetime, without suppressing the rule.

## Final frozen re-review — closed

Same independent native reviewer, target `d62a186b…251` and four A3-repair hashes, matched before
and after at `eda17b27`; no gates. Both prior medium findings closed: detach/error invalidates
decode ownership (`archive-model.ts:878`), and keyed preview mounts reset A→B→A readiness
(`archive.tsx:2205`). Also checked local opener/generation/connectivity focus return, stable request
memoization, abort cleanup, independent echoed-ID and exact-path checks. Parent verified these
source guards and reran 151 focused tests. Reviewer closed.

Remaining Count: 0 · Worst: none · Prior findings closed: 2. Browser proof remains pending.
