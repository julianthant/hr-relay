# Kuali store lessons

Moved verbatim from this directory's instruction pair on 2026-09-04. Search by the
affected surface/task/decision and read the relevant entries before changing the seam.
Historical entries retain their dates; current owning contracts supersede retired mechanisms.
When asked to record a lesson, reconcile it here rather than expanding `AGENTS.md`.

## Lessons learned

- **2026-08-14: a `formKey` is an ADDRESS, not an expectation — and filling the table was necessary,
  not sufficient (chunk 5c).** §9.10 recorded "filling the table is a one-line change"; the live
  capture found the other half. `submitDocumentV2` sends the whole document MODEL keyed by `formKey`,
  and the model holds a `Date` as epoch milliseconds, a `Dropdown`/`Radios` as `{id,label}` and
  `Checkboxes` as an array of them — so writing the nine keys in and leaving the comparison as
  `data[formKey] === "<staged string>"` would have turned every landed save into a post-fence PARK for
  six of ten fields. The check that can only fail is the same defect as the check that cannot, and one
  live fact settles the tempting middle ground of comparing the option `label`: the `Department*`
  option `000719 -  Supply Chain Services` carries a DOUBLE space in Kuali's model while the driver
  reads it through `HTMLOptionElement.text`, which collapses whitespace. Five fields are asserted, five
  are recorded and named, and the controlled commit closes them by OBSERVING the payload rather than
  by asserting a shape nobody has seen. (Side finding: the old table's comment claimed `commit`
  "refuses to click Save while any staged field's key is unknown" — it never did; `stagedWireValues`
  simply skipped them. A comment asserting a fail-closed behaviour the code does not have is worse
  than no comment.)
- **2026-08-14: the page the app itself loads answers the section-ownership question for free.**
  Kuali's `ActionPage` GraphQL query — issued by Kuali on every document route open, so observing it
  costs nothing and sends nothing — carries `details.sectionSettings` (`edit`/`hide` per section id)
  AND `document.form.template` (every gadget's `formKey`, `id`, `type` and owning section) AND
  `document.data` (the model, keyed by `formKey`). Attach a response listener and navigate; do not
  issue a query of your own. That is how 5c settled §4e's caveat — the ten finalization fields sit in
  three sections (`m9LaWN3zL` ×7, `cF6IPyCVw` ×2, `a_Alfq9a2` ×1) and all three report `edit` at BOTH
  live workflow steps — without touching the operator's data.
- **2026-08-12: legacy's `Location` field was never optional — its selector never matched.** S13 is
  recorded as "location absent ⇒ caught, set to `''`, genuinely optional", and that is wrong in the
  most instructive way: legacy asks for the accessible name `"Location  *"` (a space before the
  asterisk) and the live name is `"Location*"` with none, so the recipe resolved **zero nodes on
  every document** and its own `catch` reported the miss as an absent optional field. All three live
  documents have the field populated and marked required. Generalise it: **a `catch` around a read
  makes a broken selector indistinguishable from an empty field**, and the two have opposite
  meanings — which is why every absent arm in the read family is produced only AFTER the control was
  resolved at exactly one node.
- **2026-08-12: a read workflow whose identity is the thing it reads can be run exactly once per
  subject.** A run checkpoint is keyed by `(workflow, itemId, node, attempt)` with no run id, and
  `separations-kuali-read`'s `matchKey` is the document number — so a second run of document 4510 is
  the same ITEM, replays the first run's checkpoint, and then refuses with
  `run checkpoint … already exists with different content`, because the read's `observedAt` differs by
  construction. Chunk 1 hit the same wall and worked around it by varying the Kronos window; there is
  nothing to vary here. Recorded in `docs/migrations/separations.md` §9.4 as a platform item, not a
  chunk defect — the key is right for its purpose and the refusal is right; what is missing is a way
  to say "read it again".
- **2026-08-12: a person field's ARM DISCRIMINATOR is not the person.** The first live receipt read
  `employee.name.state = "sent"` and `employee.name.reason = "alue"` — the `last4` transform applied
  to `"present"` and to a reason string — because the whole `{state, value}` union was declared
  `direct-identifier`. A receipt that states something false is worse than one that shows nothing.
  Only `value` carries the identifier. The cost of the fix is the lesson's other half: **changing the
  evidence classification table moves receipt BYTES for every already-settled run**, and D82's insert
  correctly refuses the divergent rebuild — the two runs that found the defect are permanently frozen
  at their pre-fix derivation.
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
  (ref write-safety §4.1): resolvability now binds to six named semantic checks — workflow identity, descriptor
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
