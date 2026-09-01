# DCA4-a1 — archived evidence boundary map

2026-08-30. Native `sup_scout` (Luna/high, 120k/105k), thread
`01a052ef-e680-72a2-b138-91fbc8c532a7`; read-only findings persisted by the supervisor.
No product edits, tests or git writes by the scout.

Original acceptance: `docs/plans/2026-08-28-dashboard-completion-runs.md:172`.
Exact original dirty inventory is in `dca4-intake.md`.

| Boundary | Evidence at intake |
| --- | --- |
| Frozen capture metadata | `docs/rebuild/reference/dashboard-surfaces.md:3722`; `src/domain/archive/sections.ts:74` |
| Archived resource lookup | `src/server/dashboard/queries/archive.ts:148`; builds the read ref solely from the archived tile |
| Availability is separate | `src/domain/dashboard/archive.ts:351`; available/missing/error; retention has no purge tombstone |
| Route/client | `src/server/dashboard/routes/api.ts:184`; `src/dashboard/client/queries.ts:169` |
| Metadata viewer | `src/dashboard/surfaces/archive.tsx:2122`; frozen facts survive absence, verified image preview or other-media download |

## Gaps sent to implementation

- Four query tests cover success, missing, corrupt and foreign artifact, but no route-level status,
  header, Range, unavailable capability or host-isolation assertions.
- UI tests and parity cover only available; refusal and late/foreign response cases need proof.
- The fixture resource route substitutes the first byte map entry, and the response body fails
  typechecking. Repair belongs to DCA4, not unrelated baseline debt.
- The two screenshot files are under the standard spec snapshot folder while this repository's
  config expects `tests/parity/references/<name>.png`; matching a11y/meta exist there without PNGs.
- `docs/rebuild/04-close-the-deferrals.md:387` still claims no artifact-byte route; coordinator's
  DCA5 combined closure must reconcile DCA1/DCA2/DCA4 scope without claiming generic/phone delivery.

## Parent baseline proof

At `eda17b2708286e36542e1e18e9f8ef6a06cf3187` plus adopted dirty diff:

- `npm run test -- tests/unit/server/archive-capture-resource.test.ts tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts`
  with `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` → exit 0; 3 files, 22 tests.
- `npm run typecheck` → exit 2; `tests/parity/helpers/fixture-bff.ts:242` typed byte array is not BodyInit.
- `npm run lint` → exit 1; unnecessary assertions at `archive-detail-render.test.ts:30` and
  `archive-render.test.ts:307` (two errors, zero warnings).
- Generated `test-results/.last-run.json` restored exactly to intake HEAD after its sole status
  change was preserved in `dca4-intake.md`; no implementation work removed.
