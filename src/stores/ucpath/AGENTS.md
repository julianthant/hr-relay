# UCPath store

This store owns the semantic UCPath driver declaration, its page operations, and the tasks that
translate those observations into strict contract outputs. Browser selectors and page-state logic
stay under `driver/`; task modules call only the typed driver surface; `termination-verdict.ts`
contains the pure folds shared by transaction probes and verifiers.

## Structure

- `driver/` — live page operations, the reviewed UI registry, and deterministic UCPath fakes.
- `tasks/` — registered task implementations bound to the store's one `ucpathDriver` declaration.
- `termination-verdict.ts` — pure Smart HR scan-to-verdict folds; no browser access.
- `session.ts` / `session-provider.ts` — UCPath browser-session composition and login ownership.

## Dated lessons

- **2026-08-28 — UCPath diagnostics never embed a raw EID.** Errors, refusal reasons, fake
  mismatches and ledger-facing text use `directIdentifierDigestReference`. Descriptor match keys
  retain their byte-exact established natural-key strings because they are durable item identity,
  not presentation. Exact EIDs remain typed task/driver/authority fields, while query-hash and
  idempotency preimages stay authority-only and are never emitted as prose. The four Smart HR
  mismatch tasks redact both the observed and expected names before calling `ctx.fail`.

- **2026-08-28 — capture an indeterminate settlement before the read lease can close, without
  changing settlement.** The SS Smart HR scan's existing 45-second row/no-match race remains the
  authority over settlement. Only its actual Playwright `TimeoutError` may authorize one best-effort
  page evaluation; an earlier page/context error remains the primary unreadable failure and records
  capture as not attempted. The synchronous categorical/count/boolean evaluation has its own
  one-second bound and returns only classified banner, old-row count, categorical route, iframe and
  proven-error counts, and Search visibility/enabled state. The original timeout remains the
  unreadable reason even if capture fails; capture failure is the fixed `page-evaluation-failed` arm
  and never carries exception text. Treat every unreadable reason as persistence-bound: authored
  text names the failed Smart HR stage, and caught detail loses the exact EID plus any standalone
  last-four form before it crosses the scan boundary. `match-pending-terminations` records that
  redacted diagnostic before folding unreadable to `unknown`, so a preview refusal retains the
  evidence without turning unknown into absence.
