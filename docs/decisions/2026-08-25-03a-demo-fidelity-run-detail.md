# Decisions — Phase 3a demo fidelity: run detail — 2026-08-25
_Answer positionally: `1 A, 2 C + "note"`, or "all recommended". Anything unanswered stays open._

## 1 · Run identity vocabulary and rename behavior
**Situation.** The detail identity area adds `wf`, a middot, Config and Attempt facts; has a different fallback/placeholder; and adds a validation-error/disabled rename flow. The error behavior is honest, but the extra facts and copy are not ruled.
**Options.**
- **A.** Restore demo identity wording and omit Config/Attempt; retain the explicit rename error only as an accessibility/safety exception — removes redundant facts while preserving a visible validation failure.
- **B.** Keep all rebuild additions and record them — exposes more provenance, but duplicates removed affordances and diverges from the demo's deliberately trimmed help.
- **C.** Port the demo rename behavior too — exact visual parity, but may hide why a valid-looking rename cannot be sent.
**Recommendation.** A — demo parity applies to prose/provenance density, while visible validation protects accessibility and fail-loud interaction.
**Notes.** _(your notes here)_

## 2 · Timeline control and duration vocabulary
**Situation.** Timeline segments are non-focusable, an orphaned wait can disappear, the hover card drops Status, and the axis changes working/waiting facts. These are navigation and prioritisation semantics, not merely color or spacing.
**Options.**
- **A.** Restore the demo button, orphan-gate segment, hover Status row, untimed dim, and working-plus-waiting axis — preserves keyboard access and the demo's explicit non-vanishing-wait rule.
- **B.** Keep the present span/elapsed model — simpler markup, but leaves disclosure unreachable by keyboard and changes the meaning of the measure.
- **C.** Restore focusability only — fixes accessibility while retaining unexplained timeline vocabulary divergence.
**Recommendation.** A — parity and accessibility point to the same implementation.
**Notes.** _(your notes here)_

## 3 · Log-stream additions that remain open
**Situation.** The rebuild now groups contiguous producer rows under sticky step-and-task headings; that resolved hierarchy is not an operator choice here. The remaining divergence is the empty-stream message, the cursor-backed “Load more lines” control, and the wider design-system search input. These are visible states and controls, so the choice is whether to restore the demo treatment while preserving truthful absence and pagination.
**Options.**
- **A.** Restore the demo search geometry, while keeping explicit empty and paginated states when served facts require them — improves parity without hiding real absence or additional pages.
- **B.** Keep the current search, empty, and paging presentation — avoids a port, but leaves three unruled interaction and disclosure differences.
- **C.** Restore only the search geometry — improves the common path, but leaves valid empty and paginated results unexplained.
**Recommendation.** A — the resolved grouping stays intact, and the remaining additions should be both demo-shaped and truthful about served state.
**Notes.** _(your notes here)_

## 4 · Outcome and decision age cues
**Situation.** The shared live/idle dot is absent and an open decision card prints only the clock while the demo prints both age and clock. The current placement splits two related urgency facts across separate surfaces.
**Options.**
- **A.** Restore the dot and the decision card's `open {age} · since {clock}` pair — exact parity and an immediately comparable wait signal.
- **B.** Keep age only in the outcome bar and clock only in the card — less duplication, but an unruled split that loses the demo's paired context.
- **C.** Restore only the dot — improves liveness indication but leaves the decision timing divergence.
**Recommendation.** A — both facts are already served and no authority constraint blocks their display.
**Notes.** _(your notes here)_

## 5 · Context-rail ownership, labels, and hierarchy
**Situation.** Two components own `dataExpanded`, producing a visibly inconsistent reopened rail. The rail also changes its accessible name and wording, uses `written`, and drops the demo's Well/recessed-band/divided-row hierarchy.
**Options.**
- **A.** Give one model ownership of expansion and restore demo labels, accessible name, and group chrome — fixes an actual state bug and restores the reading hierarchy.
- **B.** Preserve the split model and current text — no refactor, but the rail can describe a state it does not have.
- **C.** Fix ownership only — resolves correctness while retaining unrecorded fidelity differences.
**Recommendation.** A — the owner split is a functional defect, and the remaining changes have no countervailing contract.
**Notes.** _(your notes here)_

## 6 · Refusal and save feedback in Edit Data
**Situation.** The rebuild flattens a refusal, omits the assurance that edits remain, duplicates a blocked reason, and adds `Saving…`. A refusal must stay distinguishable from a normal validation message and must not imply lost edits.
**Options.**
- **A.** Restore the coded Refusal and preserved-edits feedback, remove the duplicate reason, and retain `Saving…` only as an explicit async accessibility exception — makes the server outcome legible without losing live-operation feedback.
- **B.** Restore the demo exactly, including no saving state — exact pixels, but an asynchronous save has no in-progress indication.
- **C.** Keep current behavior — compact, but collapses a refusal and leaves an unsupported duplicated explanation.
**Recommendation.** A — authority/refusal truth and accessible asynchronous feedback justify the single non-demo addition.
**Notes.** _(your notes here)_

## 7 · Receipt evidence cues
**Situation.** The receipt omits or changes confidence, identity, dry-run, commit/prepare, criterion, and uncertainty cues even though those facts are served by the trust wire. The invariant banner is structurally unrepresentable for this schema, and the old placeholder comment has already been corrected; neither is an operator choice. The remaining question is how much of the true evidence vocabulary to show.
**Options.**
- **A.** Restore every demo cue that is a true served fact, while omitting the unrepresentable invariant banner — parity without fabricating an authority arm.
- **B.** Restore all cues unconditionally — visually exact, but risks displaying a state the wire cannot truthfully represent.
- **C.** Keep the current receipt vocabulary — avoids port work, but leaves served evidence less legible.
**Recommendation.** A — restore served evidence and preserve the already-proven schema boundary.
**Notes.** _(your notes here)_

## 8 · Failure-record framing and remediation
**Situation.** The record uses a category rather than the demo's fact header, drops permanent/write-state/remediation/first-seen cues, changes observed-subject emphasis, and is always expanded. The demo's disclosure prevents a long diagnostic dump from burying the stream.
**Options.**
- **A.** Restore the demo disclosure, fact framing, tones, state arms, remediation wording, and first-seen arm wherever served — preserves scanability and makes failure evidence explicit.
- **B.** Keep the always-expanded record — fewer clicks, but it can bury the log stream and keeps numerous uncited semantic changes.
- **C.** Add only the disclosure — repairs density while retaining all other vocabulary divergence.
**Recommendation.** A — all proposed facts are presentation of existing truth; no safety or authority rule favors the current drift.
**Notes.** _(your notes here)_

## 9 · Park-resolution footer metadata
**Situation.** The parked-write dialog adds a footer containing run id, revision, and generation even though generation is already a nearby fence chip. The demo has no equivalent footer.
**Options.**
- **A.** Remove the footer metadata — exact parity and less duplicated fence information.
- **B.** Keep it and document why the repeated identity is necessary — retains a debugging cue but adds unruled visual density.
- **C.** Keep only run id — a compromise, but still a new unexplained placement.
**Recommendation.** A — the nearby fenced facts are already sufficient and authoritative.
**Notes.** _(your notes here)_

## 10 · Shared refusal notice
**Situation.** Park resolution and identity approval have nearly identical refusal notices implemented as separate components. Prior dashboard work found forked near-copies drift readily, but the wording differs where the underlying outcome differs.
**Options.**
- **A.** Extract one shared refusal-notice primitive with parameterized truthful outcome copy — preserves the distinct messages while preventing visual/behavioral drift.
- **B.** Keep two local components — direct local control, but repeats a known fork pattern.
- **C.** Force identical copy as well as shared code — maximizes uniformity, but can misstate whether the gate remains open or nothing was recorded.
**Recommendation.** A — share the pattern, not an inaccurate outcome claim.
**Notes.** _(your notes here)_
