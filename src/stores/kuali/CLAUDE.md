# Kuali store

Kuali Build RRSS Separation Request Form. This store owns Phase 2's transaction proof — the first
`effect:"commit"` contract in the tree — and, since separations chunk 2, the **separation-document
read family** beside it. Raw Playwright access and locator recipes stay under `driver/`; tasks import
only the task-safe declaration at `../declaration.ts`.

## Two families, ONE driver declaration (D197)

| Task | Effect | What it visits |
|---|---|---|
| `kuali/read-separation-document` | read | the whole RRSS separation form, in one page visit |
| `kuali/read-timekeeper-annotation` | read | the timekeeper field, as the write's beat-① probe |
| `kuali/fill-timekeeper-annotation` | prepare | stages the timekeeper value |
| `kuali/save-timekeeper-annotation` | **commit** | clicks `Save` |
| `kuali/verify-timekeeper-annotation` | read | the reload read-back — the ONLY landing proof |

**The read family is a SIBLING on the same `DriverDeclaration`, not a second store.**
`defineTask(driver, contract, impl)` binds the store's exact invariant declaration, so a second
declaration for one store is what `task-driver-boundary` exists to refuse. The read's schemas live in
their own module (`src/domain/ui/kuali-separation-document.ts`) because they are an order of
magnitude wider than the write's three fields — the DECLARATION stays one.

**The two families have different SUBJECTS, and both are unambiguous.** The write binds a PERSON
(`kuali.rrss-document.displayed-eid`); the read binds the DOCUMENT
(`kuali.rrss-document.displayed-number`, doc 01's `artifact`/`document-id` kind), because a run names
a document and DISCOVERS the person. The registry audit's old "exactly one subject-authoritative
observation" rule is now one PER SUBJECT IDENTITY — narrowed per kind rather than relaxed.

## The write, and why it is this one

`kuali/save-timekeeper-annotation` sets the `Timekeeper Name:*` field on one document. It is benign
(the legacy flow already fills it on drafts), reversible (prepare returns `previousTimekeeperName`),
and it is the exact field the operator authorized for the 2026-07-23 live write round-trip on doc
4444 (D78). `Send Back` and `Mark Complete` — the buttons that advance a real separation — are not
addressable through this store at all.

## Read-family invariants

- **The form TYPE is read and compared, never inferred from a timeout (S2).** Kuali's document route
  titles itself `Form - <form name> - Kuali`, which is the only unambiguous read of the form's name
  on the page — the same string also renders in the space's app list and in every Action-List row.
  Legacy discovers a non-separation document as a 5s locator timeout on the employee-name field,
  which is indistinguishable from a slow page.
- **Blank is the COMMON case, and it is data.** Every field an operator may leave blank carries an
  explicit `{state:"absent", reason}` arm. Live doc 4502 (2026-08-12) was blank in five fields and
  sat on Kuali's `- - -` sentinel in a sixth; a rich read without absent arms would fail every
  document the department has not yet worked.
- **A malformed non-blank value still refuses.** An unparseable date is `unparseable-date` naming the
  field and the value (S8), and the parse rejects a rolled-over date — `new Date("2026-02-31")` is a
  valid `Date` meaning 3 March, which would file a plausible, wrong separation date.
- **Every dropdown's COMPLETE option list is returned as observed** (§3.2's MAP-EVERYTHING). That is
  what lets `workflow:separations/match-termination-type` refuse a republished control on the first
  run that stands in front of it, instead of on the first run that happens to select a new option.
- **The termination type is returned VERBATIM and mapped nowhere here.** The `{template, reasonCode}`
  decision is pure domain (`src/domain/separations/termination-type.ts`), so no driver can file a
  reason code.
- **It writes NOTHING.** No fill, no save, no draft. S61 is legacy's own dry run mutating the live
  document on an argument stated in a comment and verified nowhere.
- **Controls legacy has no key for stay DRIVER-INTERNAL.** Division, Employee Type, Student Title
  Code, the optional comments box and three of the four Final Pay radios are read through their exact
  live accessible names, listed in one named block in the interpreter, each re-asserting the
  exactly-one count. Publishing them would fabricate a port row — the rule `new-kronos` set.

## Write-family invariants

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
`src/systems/kuali/selectors.ts` (blob `1c55c7d307891e07951ca38a89548418bdc23f49`).

**The write surface (verified 2026-08-04):**

- `separationForm.eid()` :96 → `kuali.rrss-document.eid-field`
- `timekeeperTasks.timekeeperName()` :138 → `kuali.rrss-document.timekeeper-field`
- `save.navbarSaveButton()` :223 → `kuali.rrss-document.save-button` (**narrowed**: legacy's
  three-deep `.or()` chain is dropped; only the exact role+name branch is kept)

**The read surface (fourteen keys, each live re-verified 2026-08-12 against real documents
4510 / 4502 / 4495, counted at exactly one node):** `separationForm.employeeName()` :90 ·
`separationForm.lastDayWorked()` :102 · `separationForm.separationDate()` :108 (**narrowed** — legacy
matches the loose regex `/Separation Date/`; the live name is the full literal
`"Separation Date (Last day actively employed)*"`, and a helper paragraph on the same page also
contains those words) · `separationForm.terminationType()` :114 · `separationForm.location()` :120
(**name corrected** — see the lesson below) · `timekeeperTasks.requestAcknowledgedCheckbox()` :131 ·
`timekeeperTasks.timekeeperComments()` :145 · `finalTransactions.terminationEffDate()` :156 ·
`finalTransactions.department()` :163 · `finalTransactions.payrollTitleCode()` :170 ·
`finalTransactions.payrollTitle()` :177 · `transactionResults.submittedTemplateCheckbox()` :188 ·
`transactionResults.transactionNumber()` :195 · `transactionResults.doesNotNeedFinalPayRadio()` :202.

**Driver-internal, deliberately not registry elements** (no legacy key exists, so a port row would be
fabricated): `Division*`, `Employee Type*`, `Student Title Code*`,
`Additional Separation Comments (Optional)`, and the `Submitted Final Pay Request` /
`Does not need Final Pay (transfer employee)` / `Other` radios.

**NOT ported:** the whole `actionList.*` family (`menuItem`, `docLink`, `docLinks`, `searchInput`,
`searchGoButton`). A run names its document and opens the deep link; enumerating the Action List is a
candidate-discovery surface no chunk needs yet. The live Action List DOES carry a
**Document Type** column, which is worth remembering when one does.

Also ported: `src/systems/kuali/navigate.ts:16-39` (`fillWithVerify`), `:626-652` (`clickSave`),
`src/config.ts:131-132` (`KUALI_SPACE_URL`), and `src/infra/auth/login.ts:649-755` (the login flow).

NOT a port: the `…/actions/<actionId>` deep-link open. Legacy has no URL builder and only ever
reached a document through the Action List search box; the deep link is live-verified knowledge
(2026-07-23 probe, re-verified read-only 2026-08-04).

## Lessons learned

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
