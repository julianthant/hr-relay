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

- **Save is UI-silent.** No toast, no banner, no URL change. `commit` reports only that it clicked;
  the ONLY landing proof is `verify-timekeeper-annotation`'s reload read-back. Never reintroduce
  error-banner detection: legacy deleted it 2026-04-10 as false-positive-prone, and the 2026-07-23
  probe independently confirmed why.
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
- **Post-fence absence is `operator-only`.** Not because Kuali's negative read is untrustworthy, but
  because no propagation window has been measured here. It becomes `stabilized` only when the
  controlled commit supplies real numbers.

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
- **2026-08-04: the commit output is a claim, not proof.** `save-timekeeper-annotation` returns the
  exact state it clicked Save on so the contract's static round-trip holds and so recovery can
  reconstruct node output from a probe-derived proof. Nothing in the kernel treats it as landing
  evidence — beat ⑥ replaces it with the verifier's reload read-back. Do not "optimise" the verify
  read away because the commit already returned the value.
