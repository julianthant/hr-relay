# New Kronos store

This store only reads employee search and the separation timecard. It has no commit capability or
external-commit registry elements. Raw browser operations stay in `driver/`; tasks use the one
task-safe declaration. Search is one page visit; opening/proving/ranging/reading the timecard is
another. Do not split one inseparable visit into tasks that assume an unproven browser state.

## Invariants

- Distinguish the explicit no-items sentinel, rendered rows with no exact person match, and no
  signal. A timeout is never an employee-not-found answer. Mechanical failures never become an
  empty timecard or a null last-punch date.
- Read search identities only after every row finishes rendering; skeletons and raw template
  bindings are hydrating, not malformed completed identities. Honor the caller's timeout.
- Prove the timecard's observed subject in its employee anchor after closing search. Page-wide
  text can echo the search input and is not identity proof.
- Prove the applied range by calendar-day values. For the virtualized grid, scroll the body viewport
  and accumulate until every day of that range is covered. Scroll position, no growth, and stall
  bounds may cause refusal; none permits a partial answer.
- Bind columns by unique header names from the data container, not by ordinal or pinned-column
  headers. Refuse ambiguous controls and header/cell count disagreement.
- Return unknown pay codes explicitly; do not drop or classify them by guess. Locator fallbacks,
  range entry, session proof, and top-level/frame search contexts require their recorded live proof.
- Prove replacement on a prefilled range field as well as an empty one; synchronous DOM writes alone do not prove framework settlement.
- Browser-state-producing reads use `always-rerun`; checkpoint replay restores values, not an open timecard.
- Prove login with the application cookie and absent sign-in forms; a host match alone is insufficient.

Before driver changes, read `session.ts` and the relevant `driver/` source.
Read the assigned workflow brief for workflow behavior;
use `docs/rebuild/reference/stores.md` and source contracts for the current task/output inventory.
Root rules apply.
