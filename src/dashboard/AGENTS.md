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

- **2026-08-28 — a required full EID is structured presentation, never an opaque diagnostic.** The
  identity ceremony may render the served candidate EID directly as a React child because the human
  must compare it; error/reason strings carry only its digest reference. Do not rebuild the visible
  candidate label with string interpolation or copy a raw EID into toast/error text.

- **2026-08-28 — launcher customization belongs in the path, not behind a gear.** The Run Modal's
  ordinary path is `Input -> Options -> Confirm`. Options always renders and owns `Customize steps`;
  enabling it inserts `Steps` after Options. The server serves each descriptor timeline and accepts
  only selections it can translate through the workflow's declared boolean input condition. Required
  steps stay selected and disabled, so a surface change cannot invent graph surgery the planner ignores.
  At container widths of at least 480px, `Customize steps` and `Dry run` share the first row, while
  active-run policy and priority share the next; do not add a production control the planner cannot honor.
- **2026-08-28 — Settings edits bind persisted identity, while preflight binds the running identity.**
  The editable-settings document is server-listed from the settings file and the sole resolver: it
  carries the persisted revision/schema/fingerprint, effective value and provenance for each allowed
  leaf. The wire binds every path to its precise input kind and section, then cross-checks its
  top-level persisted and active identities against runtime status; a plausible mixed revision is a
  malformed authority document, not a client reconciliation job. An environment-owned leaf is visible
  but disabled; the browser never creates an alternate override. Numeric controls accept canonical
  integer text only — clearing a zero-allowed control is a visible refusal, never a quiet zero — and
  mutating requests take their timestamp from `systemClock`
  at the click, not the bootstrap instant. After an atomic apply, persisted readback can differ from the active runtime until restart,
  so the preflight rerun control uses only the runtime identity and refuses while restart is required.
  Keep the entire draft page-scoped and issue one exact expected-revision N-leaf command; never save a
  section independently. The draft owner registers one exit guard with the shell, so Back, TopBar
  shell/history navigation, native Back/Forward `popstate`, and `beforeunload` all preserve the same
  draft until an explicit discard; a route/unload cannot silently lose it. Guard the full transition,
  not only its route write: a cancelled history move leaves the history cursor, workflow, tab and
  applying flag untouched. Browser history entries carry a stable route cursor: return to dirty
  Settings with a suppressed, direction-aware `history.go`, never `replaceState` over the pending
  destination. Keeping the draft therefore preserves that target for retry, while discard replays
  the exact target after the explicit choice. (DCC3, D282)

- **2026-08-28 — served authority and available controls are separate facts.** Current dashboard
  bootstrap always supplies the retained preflight report; its optional wire arm exists only for
  read-forward compatibility with an older producer. The strict rerun route can be served while
  this screen's typed callback is absent until DCC3, so disabled copy names the unavailable screen
  control and never claims the backend authority is missing.

- **2026-08-28 — browser preflight transport is a semantic contract seam, not the server registry.**
  The dashboard imports `preflight-contract.ts`'s strict report and command schemas plus the Node-free
  `preflight-semantics.ts` check identity/mandatory-authority expectation. The server-only runner
  registry and its runtime/config/secrets closure stay behind `preflight.ts`, but audit that registry
  against the same semantic authority in both directions. Config provenance follows the same rule.
  Never pull the resolver into a browser entry merely to reuse a schema. (DCC6)

- **2026-08-28 — Explorer edits are identity-bound and presentation-only at apply.** Every draft
  carries the exact descriptor version, contract fingerprint and current override revision. The
  server derives its editable inventory from the live descriptor; presentation label/icon/category
  changes may hot-apply; timeline presentation has no complete reader and is named unavailable.
  Apply is one typed command-kernel arm whose durable identity is the complete strict envelope:
  command id, requested-at/by, source, reason, exact descriptor/override bases and changes. The override
  and its prepared prior/next file claim bind that envelope's fingerprint; the claim remains blocking
  through file apply until journal/audit transaction commit. Restart reconciliation requires an exact
  applied audit plus exact live bytes before release. Policy and descriptor-allowlisted Edit Data
  changes produce a reviewed code-change brief; notification preferences remain unavailable.
  Executable code, selectors, page state, matchers, mutation/proof/idempotency fields, secrets and new
  workflows are outside the strict draft union. (D186/D283, ref operator-trust §5.3–§5.5)

- **2026-08-28 — an Explorer edit control belongs to the presentation field it changes.** Keep the
  graph, node facts and contract field census read-only. The three hot-apply presentation fields each
  own one 44px edit door in their exact row; review shows the served descriptor version, contract
  fingerprint and override revision, while unavailable timeline/notification/policy/Edit Data arms
  name their authority by reason. A command acknowledgement alone is not applied readback: refresh the
  Explorer projection and require the exact reviewed label/icon/category plus the advanced override
  revision before announcing success. (DCC5 / D283)

- **2026-08-28 — a ready Explorer validation belongs only to the editor that requested it.** Give every
  validation a generation plus the exact draft, reason and operator identity; invalidate it on close,
  target/value/reason change and refuse a ready response whose returned draft or bases differ. An
  acknowledged command whose refresh fails is **applied but unverified**, never “not applied”: retain the
  command id, suppress re-apply, and require a later exact projection readback (workflow id, descriptor
  version/fingerprint, override revision and all reviewed presentation values) before success. The
  Radix dialog's focus return only works when Explorer keeps the exact field-row trigger and restores it
  after close. (DCC5 / D283)

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
