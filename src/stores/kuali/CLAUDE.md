# Kuali store

Kuali Build RRSS Separation Request Form. This store owns Phase 2's transaction proof — the first
`effect:"commit"` contract in the tree — and nothing else. Raw Playwright access and locator recipes
stay under `driver/`; tasks import only the task-safe declaration at `../declaration.ts`.

## The write, and why it is this one

`kuali/save-timekeeper-annotation` sets the `Timekeeper Name:*` field on one document. It is benign
(the legacy flow already fills it on drafts), reversible (prepare returns `previousTimekeeperName`),
and it is the exact field the operator authorized for the 2026-07-23 live write round-trip on doc
4444 (D78). `Send Back` and `Mark Complete` — the buttons that advance a real separation — are not
addressable through this store at all.

## Invariants

- **A positive save signal is worth NOTHING.** Kuali *does* render a `Form saved` status node and
  answers `200` on its `submitDocumentV2` mutation — measured live 2026-08-04 — for a save that
  persisted nothing of the targeted field. So the earlier "the save is UI-silent" framing was too
  kind: the danger is not the absence of a signal, it is the presence of a POSITIVE one that means
  only "the request was accepted" — the mutation that dropped the field answered
  `{"status":"Ok","validations":null}` too. `commit` reports only that it clicked and that the wire
  carried the value; the ONLY landing proof is `verify-timekeeper-annotation`'s reload read-back. Never reintroduce banner detection in either
  direction: legacy deleted the error half 2026-04-10 as false-positive-prone, and the success half
  is a proven false positive.
- **The DOM holding a value is not Kuali holding it.** `submitDocumentV2` serializes the document
  MODEL, and a Kuali Build text gadget is a controlled input over LOCAL state that debounces into
  that model — measured 0/8 carried at ≤600ms, 8/8 at ≥700ms, independent of blur, `Tab`, or
  `fill()`-versus-keystrokes. `stageTimekeeperName` therefore waits for the commit itself (the
  control's React props object identity is replaced at ~723ms; nothing else on the page moves), and
  `commit` re-proves it on the wire against the gadget's **`formKey` `QGJ63YrCom`** — not its DOM id
  `BWmkKqx40`, which is a different string. Step ownership is NOT the constraint: Kuali's own
  `ActionPage` query reports `sectionSettings` `edit` for this field's section at
  `Task 1 - Kristina & TES`, and the checkbox beside it binds instantly.
- **Exactly one match, or throw.** `Save` shares its action group with `Send Back` and
  `Mark Complete`. There is no `.or()` chain and no `.first()`; a match count other than 1 is a
  loud refusal.
- **An `actionId` is not stable across workflow steps.** Doc 4453's 2026-07-23 action id redirected
  to the Action List on 2026-08-04. A run carries the action id AND the document number, and
  `openDocument` proves the number from the level-1 heading before anything else runs.
- **Trim every read.** Kuali inputs return whitespace-padded values (doc #4241 returned
  `" 10772489"`).
- **Staging is read back or thrown.** Kuali controls silently drop `fill()`; the driver retries once
  through key events and then refuses, ported from legacy `fillWithVerify`.
- **A failed check is never an absence.** Every read-back throw becomes `unknown`, which parks.
- **A commit waits for the mutation's RESPONSE, never just its request.** Returning at request time
  let beat ⑥'s `page.reload()` cancel the in-flight POST — a landed-capable save that persisted
  nothing. After the answer arrives, the driver checks it only for a stated REFUSAL (`errors`, a
  `status` other than `Ok`, non-null `validations`); passing that is never landing proof, because
  the mutation that dropped the field entirely also answered `{"status":"Ok","validations":null}`.
- **Post-fence absence is `stabilized`** (`minSinceFenceMs: 30_000`, 2 reads, 5s apart), on four
  authorized write/restore cycles measured 2026-08-04 on doc 4490: click→response 2 459–3 036ms,
  Kuali's own state agreeing on the first ~270ms sample, a browser reload agreeing within ~3s.

## Provenance

Element recipes ported from legacy commit `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`,
`src/systems/kuali/selectors.ts` (blob `1c55c7d307891e07951ca38a89548418bdc23f49`):

- `separationForm.eid()` :96 → `kuali.rrss-document.eid-field`
- `timekeeperTasks.timekeeperName()` :138 → `kuali.rrss-document.timekeeper-field`
- `save.navbarSaveButton()` :223 → `kuali.rrss-document.save-button` (**narrowed**: legacy's
  three-deep `.or()` chain is dropped; only the exact role+name branch is kept)

Also ported: `src/systems/kuali/navigate.ts:16-39` (`fillWithVerify`), `:626-652` (`clickSave`),
`src/config.ts:131-132` (`KUALI_SPACE_URL`), and `src/infra/auth/login.ts:649-755` (the login flow).

NOT a port: the `…/actions/<actionId>` deep-link open. Legacy has no URL builder and only ever
reached a document through the Action List search box; the deep link is live-verified knowledge
(2026-07-23 probe, re-verified read-only 2026-08-04).

## Lessons learned

- **2026-08-04: an `actionId` names a workflow STEP, not a document.** The 2026-07-23 probe recorded
  the deep link as "stable and reload-safe", which is true within a step and misleading across one.
  Re-opening doc 4453's captured action id silently landed on the Action List with a `/view`
  redirect and no form — a page that would have read as "document with no fields" to anything that
  trusted the URL alone. That is why `openDocument` proves the document number from the page and
  refuses on a mismatch, and why the workflow input carries both identifiers.
- **2026-08-04: the Save neighbourhood is the reason the recipe is exact.** The live document showed
  exactly one `button "Save"`, immediately beside `button "Send Back"` and `button "Mark Complete"`.
  Legacy's fallback chain begins with `button:has-text("Save")` — a substring match — inside an
  action bar that on the current DOM does not exist. A fallback that widened by one node here would
  advance a real separation. The port keeps the exact-name branch only and refuses ambiguity.
- **2026-08-04: the controlled commit found THIS DRIVER at fault, twice — and the write lands.**
  The morning's conclusion ("the current step cannot write this field") was wrong and is withdrawn
  (D135). Two defects hid the write: the gadget's debounce into the document model, and `commit`
  returning at request time so the verifier's reload cancelled the save. Both are fixed; doc 4489
  then committed end-to-end in 16.45s with a real reload-read-back proof, the idempotency re-run
  answered `already-present` in 2ms with no browser, and both documents were restored to `""`.
  Two things to carry forward. **A zero-write experiment is the right instrument here:** routing
  `submitDocumentV2` to `route.abort()` lets you read the payload Kuali WOULD send without sending
  it, which is how the section-ownership question was settled without touching the operator's data.
  **A parked write WAS unresolvable once any file in its descriptor's 31-file contract closure
  changed** — `requireDescriptorMatchesRun` compared stored vs current `contractFingerprint` and
  printed ids and versions (which match) rather than fingerprints (which do not). **Fixed by D136**
  (doc 09 §4.1): resolvability now binds to six named semantic checks — workflow identity, descriptor
  version, the transaction node committing this task, the canonical-input schema, the permanent key
  RE-DERIVED from the exact durable input, and the retained binding proof — so an unrelated closure
  edit no longer strands a park, and a genuine move refuses with the whole check table. The
  "resolve parked writes before touching a contract closure" rule is withdrawn.
- **2026-08-04: Kuali Build paints late, and one sample is not an observation.** The space serves a
  body with ZERO `[role]` nodes at `domcontentloaded` and its menubar ~1s later; the document route
  shows `["", "Action", "Action List"]` at ~1.5s — the document heading present and EMPTY beside two
  decoys — and `["4489", …]` at ~3.0s. So "the first h1" reads `""` and "the first non-empty h1"
  reads "Action". The fix is a bounded wait for the same fact plus a NARROWER recipe (exactly one
  level-1 heading whose accessible name is a bare document number), never a widened locator.
- **2026-08-04: the commit output is a claim, not proof.** `save-timekeeper-annotation` returns the
  exact state it clicked Save on so the contract's static round-trip holds and so recovery can
  reconstruct node output from a probe-derived proof. Nothing in the kernel treats it as landing
  evidence — beat ⑥ replaces it with the verifier's reload read-back. Do not "optimise" the verify
  read away because the commit already returned the value.
