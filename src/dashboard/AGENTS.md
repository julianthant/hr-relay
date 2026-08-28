# Dashboard

Dashboard surfaces are component-only `.tsx` modules. Keep hooks, folds, vocabulary maps and value
formatters in the matching `*-model.ts` sibling so Fast Refresh remains a leaf boundary. Import design
atoms from `ds/ui.tsx`; do not fork local visual vocabularies.

## Logs

The Logs tab renders the strict lazy `LogRowWire` union. `observed` rows carry directions and redacted
value facts, plus a system only when their one descriptor origin declares a browser system; an absent
system stays absent and draws no chip or accessibility claim. `transaction-fenced` is an authority beat
and must never borrow any observation fields. Keep server `sequence` order, append only immutable cursor
pages, and group only contiguous rows by their real producer. Notes stay notes.

Continuation ownership is the exact `(runId, cursor, initial snapshot)` that launched the request.
A refresh or run switch supersedes that owner: its stale response changes neither rows, loading nor
error for the current snapshot. The live panel requires `rows`; notes-only pages belong to frozen
archive readers and must fail here with the run and cursor.

The app-wide storage hazard is a full-bleed shell band, not a region card: the full-width `main` owns
it above one inner sidebar/content row, so persisted-sidebar mode cannot inset it. It mounts above
the takeover switch on queue and takeover routes, uses `Banner shape="band"` for a bottom edge with
no radius, and renders only when authority storage is unavailable. `Banner` remains a bordered,
rounded card by default; never change its default to repair the storage site (D276.4 / D281.7,
legacy `1ec1d870` `RebuildDemo.tsx:654`, `DemoSettings.tsx:1204-1237`).

### Dated lessons

- **2026-08-28 — Explorer edits are identity-bound and presentation-only at apply.** Every draft
  carries the exact descriptor version, contract fingerprint and current override revision. The
  server derives its editable inventory from the live descriptor; presentation label/icon/category
  and timeline label/order changes may hot-apply through the atomic override, while policy and
  descriptor-allowlisted Edit Data changes produce one reviewed code-change brief. Notification
  preferences have no descriptor owner today and remain unavailable. Executable code, selectors,
  page state, matchers, mutation/proof/idempotency fields, secrets and new workflows are outside the
  strict draft union. (D186/D283, ref operator-trust §5.3–§5.5)

- **2026-08-27 — every window-replacing dashboard surface enters through one frame.** Settings,
  Archive, Explorer, Activity, Spreadsheet intake and the UI catalog root directly in
  `TakeoverFrame`; the shell adds no inset wrapper, and no surface repeats its enter transition.
  The frame owns full-bleed geometry, the named region and focus-on-enter, so its first descendant
  stays the truthful first Tab destination. Intake and catalog close across a route unmount: retain
  the stable toolbar-door id until the queue remounts, then focus that door or the persistent main
  region; missing both must throw rather than strand focus on `body`. This changes no intake-column
  composition: D278 owns that separate layout. (D275.2 / UF-FU-1)

- **2026-08-26 — a rejection acknowledgement belongs to the exact served set, not a sticky boolean.** Intake may acknowledge only the current session version, validation instant and rejected-row identities; a later authority read invalidates that acknowledgement before the sticky outcome band can offer Run. Keep the courtesy blocker client-side and name it, but leave final enqueue eligibility to the kernel. The demo-shaped table may show a redacted cell representation, never promote it into an editor default or a fabricated original value. (IN95, IN99–IN122)
- **2026-08-26 — queue triage is local context, while outcomes are authority.** “Checked by you” may help one operator work through members, but it is neither a member outcome nor durable evidence: keep it in browser state, reset it on reload, count only the loaded members of the current well, and never send it over the wire. A full roster/drill-in still requires its served People route; do not fabricate one from the day projection. Bulk results likewise keep every zero bucket and their named skipped set, because a clean count alone cannot say what a batch did not do. (ledger 1 B57/B80/B155/B164/B165/B172–B174/B195/B196)

- **2026-08-25 — bounded list ownership includes its observed size.** A rerun membership list can
  shrink while its prior-manifest owner stays the same, so an owner-only page selection can leave a
  formerly valid final page outside the new bound. Validate the stored selection against its own
  exact count first, then reset for a new owner or clamp for a changed count; otherwise refreshing
  evidence either throws or hides malformed state behind a plausible page.

- **2026-08-25 — compact evidence still needs an exact reachable value.** A title attribute and a
  painted hash prefix do not serve touch or keyboard operators. Keep the short value for scanning,
  but put the full identifier, hash or parsed input in the existing Popover vocabulary behind a
  44×44 semantic trigger. Bound intake evidence locally in exact 10-row pages; that is not D9's
  proposed shared virtualization primitive, and must never be described as such. (IN123–IN143)

- **2026-08-25 — a reserved identity is not a terminal record.** The intake upload reserves a manifest id before the irreversible enqueue, but calling it committed would tell the operator that runs exist when authority has written none. Keep reservation and terminal projections in separate total-fold arms; a missing rerun is likewise a named empty state, and a changed input shows hashes only rather than leaking a parsed value. (IN123–IN143)

- **2026-08-25 — an exact descriptor origin need not be a browser origin.** The first live observed-log
  proof reached `workflow:separations/read-separation-plan`: one exact data origin existed, but it was a
  service task and correctly declared no browser system. Making every log producer carry a system turned
  an honest absence into a 500. Preserve that absence exactly as the Context rail does; refuse zero or
  multiple origins, never invent a system for one exact origin that declares none. (D252 / D270)

- **2026-08-25 — a fence is not a page observation.** A producer's task system resolves the origin of
  an observed row, but a durable `transaction.fenced` beat is not an observed read or write. Rendering
  its producer system, a direction arrow, or a placeholder pill would turn authority timing into false
  page evidence; leave those details absent. (D270 / observed-logs)

- **2026-08-25 — a bounded log page is not the D9 virtualization primitive.** The live query serves at
  most 200 rows per page. This surface proves that exact bound renders one-for-one, remains searchable,
  and never fetches a continuation eagerly; its contiguous grouping fold is linear. Queue/log/archive
  virtualization remains D9's shared `ds/` primitive behind D9's trigger, and this unit claims none of
  it.
