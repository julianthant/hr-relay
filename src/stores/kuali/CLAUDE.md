# Kuali store

Kuali Build RRSS Separation Request Form. This store owns Phase 2's transaction proof — the first
`effect:"commit"` contract in the tree — and, since separations chunk 2, the **separation-document
read family** beside it. Raw Playwright access and locator recipes stay under `driver/`; tasks import
only the task-safe declaration at `../declaration.ts`.

## Two families, ONE driver declaration (D197)

| Task | Effect | What it visits |
|---|---|---|
| `kuali/search-separation-action` | read | the Action List, filtered to ONE document number — resolves its action id |
| `kuali/read-separation-document` | read | the whole RRSS separation form, in one page visit |
| `kuali/read-timekeeper-annotation` | read | the timekeeper field, as the write's beat-① probe |
| `kuali/fill-timekeeper-annotation` | prepare | stages the timekeeper value |
| `kuali/save-timekeeper-annotation` | **commit** | clicks `Save` |
| `kuali/verify-timekeeper-annotation` | read | the reload read-back — the ONLY landing proof |
| `kuali/match-separation-finalization` | read | the finalization's beat-① probe |
| `kuali/stage-separation-finalization` | prepare | stages ALL TWELVE finalization fields in one pass |
| `kuali/save-separation-finalization` | **commit** | the ONE `Save` that commits the finalization |
| `kuali/verify-separation-finalization` | read | the reload read-back over all twelve fields |

**The read family is a SIBLING on the same `DriverDeclaration`, not a second store.**
`defineTask(driver, contract, impl)` binds the store's exact invariant declaration, so a second
declaration for one store is what `task-driver-boundary` exists to refuse. The read's schemas live in
their own module (`src/domain/ui/kuali-separation-document.ts`) because they are an order of
magnitude wider than the write's three fields — the DECLARATION stays one.

**The two families have different SUBJECTS, and both are unambiguous.** The write binds a PERSON
(`kuali.rrss-document.displayed-eid`); the read binds the DOCUMENT
(`kuali.rrss-document.displayed-number`, ref task-contract's `artifact`/`document-id` kind), because a run names
a document and DISCOVERS the person. The registry audit's old "exactly one subject-authoritative
observation" rule is now one PER SUBJECT IDENTITY — narrowed per kind rather than relaxed.

## The write, and why it is this one

`kuali/save-timekeeper-annotation` sets the `Timekeeper Name:*` field on one document. It is benign
(the legacy flow already fills it on drafts), reversible (prepare returns `previousTimekeeperName`),
and it is the exact field the operator authorized for the 2026-07-23 live write round-trip on doc
4444 (D78). `Send Back` and `Mark Complete` — the buttons that advance a real separation — are not
addressable through this store at all.

## The Action-List resolve (D261)

`kuali/search-separation-action` turns the ONE number an operator knows into the address Kuali
answers to. It exists because D260 measured `separations` as needing two varying values per run and
therefore as having no typed start box; the operator ruled *"document number should work. no need
action id."*, and the id became a graph output.

- **It is strictly read-only, and cheaper than legacy's.** Legacy CLICKS the row to open the document
  and reads the resulting URL. The action id is already on the page as the row's link `href`, so this
  filters, reads, and navigates nowhere.
- **TWO matched links for one document is the ORDINARY row**, not an ambiguity: Kuali publishes the
  number in both `Document #` and `Document Title`. The invariant is one distinct ACTION, which is
  why the verification scenario claims `recipe-resolves` and deliberately not `exactly-one-visible` —
  a claim of one node would be false of every real row.
- **The anchored name match is the safety property.** Kuali's Action-List search is SUBSTRING-based
  (legacy's own comment: a search for `414` returns 4140–4149), so the link recipe matches
  `^\s*<n>\s*$`. Unanchored, this would open a neighbouring person's separation.
- **The read classifies nothing** (D201). `classifyKualiActionResolution` is a pure fold with four
  named refusals and no arm that answers with an id the page did not show. `parseKualiActionHref`
  requires the WHOLE path including the space — "the last path segment" would read an id out of a
  pagination link — and returns `undefined` rather than throwing, so the caller decides.
- **A document nobody holds an action on is a REFUSAL, not an empty answer.** A completed workflow
  step leaves the Action List, which is real and common; the refusal names the numbers the list did
  show, because "not found" alone is a sentence nobody can act on.
- **Resolving the id does not weaken the D129 check — it doubles it.** The document number is now
  compared against the page twice: once as the anchored accessible name of the link the id came from,
  and once as the level-1 heading `openDocument` proves before anything else runs.

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

## The finalization family (chunk 5a) — §4e's staged-variables model

`docs/migrations/separations.md` §4e is normative and the module header of
`src/domain/ui/kuali-separation-finalization.ts` restates it: every read lands first as a typed
variable, ONE prepare stages every field from those variables, ONE save, ONE reload read-back that
compares every written field against the EXACT staged variables. Nothing re-reads a value to compute
with it.

- **Nine variables, three ratified assertions.** `requestAcknowledged` and
  `submittedTerminationTemplate` are checked unconditionally (legacy steps 10b and 16), and the
  final-pay radio is **§4g**'s operator-ratified business assertion of 2026-08-12 — *Does not need
  Final Pay (student employee)* on every RRSS separation, with no data behind it and the residual
  risk named rather than hidden. They are constants, not inputs, so a caller cannot vary them, and
  `tests/unit/kuali-finalization-fields.test.ts` pins the value — which is precisely what S58 said
  legacy lacked.
- **The comparison is EXACT, with no tolerance arm.** A department option that merely contains the
  code is a different department; a comments field that kept a prefix has dropped somebody's note.
  A mismatch names the field, and `<empty>` / `unchecked` / `<none selected>` render distinguishably
  because they are three different observations.
- **S57 does not port.** Legacy, finding the transaction number blank, fills everything except it and
  saves the document "blank for manual entry". Here the number is a required `T`+6–12-digit variable,
  so an empty one refuses before a control is touched.
- **S56 is strengthened.** The prepare re-reads the comments control and refuses when it no longer
  holds what the read this run composed from saw. That re-read decides a REFUSAL, never a value.
- **`Last Day Worked` / `Separation Date` ARE staged — §4e's amendment of 2026-08-14.** They were
  deliberately absent through chunk 5; the operator answered the question (*"collect all data first
  and then fill in the forms at the end"*), so legacy's step-13 write-backs join the ONE staged pass.
  Both come from the `dates` node's RECONCILED values and both are staged **unconditionally**:
  legacy's "only when it moved" is a property of its incremental drafts, and under one-pass staging a
  conditional field would need an expectation composed from the page's own prior value — the re-read
  §4e forbids. When nothing moved the two are equal, so the save writes the same string back and the
  read-back proves it either way. **What this owed the next live pass is DISCHARGED (chunk 6b,
  2026-08-14, §9.16)**: both controls are now live-verified EDITABLE, both `formKey`s are captured,
  and the section that owns them was read — so §4e's section caveat is discharged for all twelve.
- **The write paths ARE live-verified — all TWELVE.** Ten by chunk 5c (2026-08-14): each resolved to
  exactly one EDITABLE node on the editable page of real docs 4502 / 4510 / 4495 / 4524, and the live
  dry run staged every one of them from the run's variables and read every one back on real doc 4524
  in **8.06 s**, then abandoned by hard reload and re-read the document unchanged (S61 proved live).
  The two date write-backs by chunk 6b the same day: one node each, visible / editable / enabled, on
  two OPEN documents at BOTH live workflow steps (4510 at `Task 1 - Jan`, 4495 at
  `Task 1 - Kristina & TES`). Both `// live-verify:` markers are discharged; a marker is only
  discharged by the pass that actually verified the control.
- **All twelve `formKey`s are known; only FIVE may be asserted on the wire.** The keys came off
  Kuali's
  own `ActionPage` query (read-only, 2026-08-14) and the extraction is validated twice over —
  `timekeeperName` returning `QGJ63YrCom` byte-identical to the 2026-08-04 capture, and each date
  gadget's sibling DOM id in the form template (`ORt4nOmlp` / `bKTJvewkM`) matching the id the live
  editability probe read back off the rendered control. But `submitDocumentV2` sends the
  document MODEL, and only a `Text`/`Textarea` gadget holds the staged STRING there — a `Date` holds
  epoch milliseconds, a `Dropdown`/`Radios` holds `{id,label}` and `Checkboxes` an array of them.
  `KUALI_RRSS_FINALIZATION_WIRE_ASSERTED` is therefore five fields and `kualiFinalizationWireUnasserted()`
  names the other seven — including the two dates, whose keys are now known and whose SHAPE still is
  not (`06/10/2026` is `1781049600000` in the model). `kualiFinalizationFormKeysMissing()` is empty.
  The controlled commit is what closes the shapes, by OBSERVING the payload. The landing proof is
  unaffected — it was always the reload read-back, over all twelve.

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

**The Action-List surface — THREE of five keys ported (D261, live-verified 2026-08-20):**
`actionList.searchInput()` :67 → `kuali.action-list.search-input` (**narrowed** — legacy's
`.kp-input-group:has(.kp-input-button-right)` CSS scope is dropped; this registry has no CSS arm and
the live page renders exactly one `textbox "Search"`, so `exactlyOne` refuses ambiguity instead of
silently picking) · `actionList.searchGoButton()` :79 →
`kuali.action-list.search-go-button` · `actionList.docLink()` :33 →
`kuali.action-list.document-link` (**narrowed** — the link is READ for its `href` rather than
clicked; the ANCHORED accessible-name match is ported verbatim and is the safety half).

**Still NOT ported, with reasons:** `actionList.menuItem()` — the Action List's own route
(`…/build/space/<space>/actions`) replaces the menu click, live-verified 2026-08-20 at **1 100 ms**
to a rendered search box; and `actionList.docLinks()` — enumerating every pending document is
candidate discovery no workflow here performs. `docLinks`' recipe IS read driver-internally, for one
purpose: a miss reports *"4502 is not here — 4537, 4495 are"*. The live Action List carries
**Document Type**, **Submitted By**, **Workflow Step**, **Created On** and **Action Requested**
columns beside the number; none is modelled, because binding a column needs a row-scoped locator
vocabulary this registry does not have and binding by ordinal is exactly D205's defect.

Also ported: `src/systems/kuali/navigate.ts:16-39` (`fillWithVerify`), `:626-652` (`clickSave`),
`src/config.ts:131-132` (`KUALI_SPACE_URL`), and `src/infra/auth/login.ts:649-755` (the login flow).

NOT a port: the `…/actions/<actionId>` deep-link open. Legacy has no URL builder and only ever
reached a document through the Action List search box; the deep link is live-verified knowledge
(2026-07-23 probe, re-verified read-only 2026-08-04).

## Lessons learned

Before changing this module, search [LESSONS.md](LESSONS.md) for the affected seam or decision
and read the matching entries. The former inline lesson bodies are preserved there verbatim.
When asked to record a lesson, write it to that ledger, including when an older helper names
this section as its destination. Keep current rules here and keep the instruction pair concise.
