# Decisions — Phase 3a demo fidelity: standing product surfaces — 2026-08-25
_Answer positionally: `1 A, 2 C + "note"`, or "all recommended". Anything unanswered stays open._

## 1 · Archive virtualisation
**Situation.** The archive claims to support the demo's 800-row case but lacks its virtual list, spacers, overscan, and shared table body. Large archives therefore have no established rendering bound.
**Options.**
- **A.** Port the demo virtualised index — restores the stated scale behavior and one coherent list model.
- **B.** Keep non-virtual sections — simpler implementation, but the 800-row claim remains unsupported.
- **C.** Defer virtualisation with a named archive-size trigger — avoids present work but records that the demo-scale contract is not met.
**Recommendation.** A — the demo behavior is the stated target and no contract blocks it.
**Notes.** _(your notes here)_

## 2 · Major and minor version bumps
**Situation.** `kind` is currently a label: a minor bump can archive runs and be blocked, opposite to the demo's semantic distinction. This is authority behavior, not a visual divergence.
**Options.**
- **A.** Implement the demo semantics: major archives and may be blocked; minor archives nothing and cannot be blocked — makes the stored kind truthful.
- **B.** Remove the minor option until it has real behavior — avoids a false choice, but narrows the currently served change-record model.
- **C.** Keep the label-only control — no implementation work, but permits a record to claim minor while performing major consequences.
**Recommendation.** A — exact demo parity is also the only option that preserves authority truth.
**Notes.** _(your notes here)_

## 3 · Design-system specimen page
**Situation.** The demo has a full seven-section component specimen page; this tree has no page or standalone mount. The current design document records that absence and points to this open decision, so the live choice is whether to build a reviewable specimen surface or defer it with a trigger.
**Options.**
- **A.** Port the specimen page and add a parity scene — restores the review surface and makes the documentation true.
- **B.** Defer it with a named trigger — honest, but leaves no visual primitive review surface until that trigger fires.
- **C.** Leave the page absent without a trigger — no implementation work, but makes the parity gap easy to forget.
**Recommendation.** A — the page is the demo's intended proof surface and fills a current parity blind spot.
**Notes.** _(your notes here)_

## 4 · Catalog vocabulary surface
**Situation.** The demo catalog describes row variants, containment, rollups, and panel kinds that the rebuild does not serve as one product surface. The old demo Shell is explicitly no longer a direct port target, so copying it blindly would create a false product promise.
**Options.**
- **A.** Build a rebuild-specific catalog only for vocabulary that is actually served, with unserved concepts named as absent — preserves truth while giving operators/designers a reference.
- **B.** Port the demo catalog verbatim — richer-looking surface, but would claim unsupported row/panel semantics.
- **C.** Record a named deferral — avoids a new surface, but leaves no home for the vocabulary question.
**Recommendation.** A — authority truth requires a served-vocabulary catalog, not a verbatim demo artifact.
**Notes.** _(your notes here)_

## 5 · Settings page and Help route
**Situation.** Settings lacks both the demo's page container and the promised Help → Keyboard destination; the shortcut popover has no caller. The shape and the recovery of keyboard help must be decided together because the deleted top-bar glyph was justified by that destination.
**Options.**
- **A.** Use the demo full-page Settings takeover and add Help → Keyboard there — restores both halves of the documented interaction.
- **B.** Keep the dialog and add Help → Keyboard inside it — restores reachability but keeps the container divergence.
- **C.** Restore the top-bar keyboard glyph instead — makes help reachable, but reverses the stated reason it was removed.
**Recommendation.** A — it gives the existing justification a real destination and restores demo navigation.
**Notes.** _(your notes here)_

## 6 · Read-only Settings sections
**Situation.** System hosts and Workflow capabilities can be rendered now from bootstrap/descriptors, but `settingsSections` names only storage. These are missing served facts, not an authority or wire gap.
**Options.**
- **A.** Add both demo sections as read-only views — restores useful status facts without adding configuration writes.
- **B.** Keep storage only — smaller surface, but leaves already-served status facts inaccessible.
- **C.** Defer all sections until editable settings — couples read-only visibility to a separately deferred write feature.
**Recommendation.** A — exact demo parity fits the present authority boundary.
**Notes.** _(your notes here)_

## 7 · Operator desktop for phone capture
**Situation.** The rebuild has the phone flow but no desktop view of a capture session after QR scan: no phase, expiry, unreadable-page warning, or contact sheet. The demo is specifically the operator-facing half, and no decision retired it.
**Options.**
- **A.** Build the operator desktop surface with an authority-backed session read and explicit absent/error states — restores the missing half without fabricating capture facts.
- **B.** Defer it to the byte-path phase with a named trigger — keeps phase scope narrow, but leaves a completed phone capture invisible to the operator.
- **C.** Treat the phone as the only surface — no work, but abandons the demo's operational review flow.
**Recommendation.** A — the operator cannot safely assess capture progress from a phone-only process.
**Notes.** _(your notes here)_

## 8 · Intake Manifest and rerun stages
**Situation.** Intake already renders a compact enqueued-manifest block with the served manifest, source, artifact, created, and row facts, and its rerun banner already shows the served same-plan or changed-axis diff. The remaining operator-owned gap is the explicit Manifest/Rerun-diff review framing: there is no stage or equivalent panel for the comparison entry, the no-prior-intake state, or the closing replay-safety note. Per-source dispositions and added/removed item lists remain unserved producer fields and are not choices to invent in this brief.
**Options.**
- **A.** Add equivalent Manifest and Rerun-diff review panels to the current workspace around the facts and axis changes already served, including explicit compare, empty, and closing-safety states — restores the operator review path without fabricating producer-owned detail.
- **B.** Keep the compact facts and axis-change banner as-is and defer only the missing operator-owned framing — avoids surface work, but leaves prior-intake review incomplete.
- **C.** Defer all remaining framing until the unserved per-row and added/removed fields exist — keeps the surface smaller, but withholds review states that need no new wire facts.
**Recommendation.** A — it completes the operator-owned review path while keeping absent detailed data explicitly out of the UI.
**Notes.** _(your notes here)_

## 9 · Intake unresolved-rejection gate
**Situation.** The Run button is enabled beside unresolved rejected rows, although the contract says the operator must review them and the kernel refuses the command. A client that offers a knowingly refused send is misleading even if the server remains safe.
**Options.**
- **A.** Restore the demo review checkbox, disabled Run state, and courtesy blocker reason — exact parity with the ratified intake contract.
- **B.** Keep the enabled button and rely on the kernel refusal — authority remains safe, but the UI advertises an action it knows will fail.
- **C.** Hide rejected rows before Run — removes the visible contradiction but hides unresolved operator work.
**Recommendation.** A — it makes the client truthfully reflect the authoritative eligibility rule.
**Notes.** _(your notes here)_

## 10 · Archived-capture viewer and bump-plan list
**Situation.** Archive capture tiles cannot be opened or described, and a version-bump review shows only a count rather than the affected runs. Both withhold the concrete artifacts an operator needs before acting.
**Options.**
- **A.** Add the demo's non-byte “What it was”/purged-state viewer and the scrolling list of archivable runs — restores reviewability while respecting pointers-only storage.
- **B.** Add only the bump list — improves a destructive decision but leaves archive capture evidence inert.
- **C.** Keep counts and inert tiles — compact, but asks operators to act without the underlying list/evidence.
**Recommendation.** A — neither feature requires inventing content, and both improve operator verification.
**Notes.** _(your notes here)_

## Answers (2026-08-26)

| Item | Chosen | Notes |
|---:|:---:|---|
| 1 | A | |
| 2 | A | |
| 3 | A | |
| 4 | A | |
| 5 | A | |
| 6 | A | |
| 7 | A | |
| 8 | A | |
| 9 | A | |
| 10 | A | |
