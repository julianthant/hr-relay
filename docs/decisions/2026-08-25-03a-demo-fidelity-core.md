# Decisions — Phase 3a demo fidelity: shell, queue, and start — 2026-08-25
_Answer positionally: `1 A, 2 C + "note"`, or "all recommended". Anything unanswered stays open._

## 1 · Settings container
**Situation.** The top-bar gear opens a large dialog, while the demo changes the whole dashboard to a Settings page with a PageHeader and Back path. The settings contract names the sections but does not choose this container.
**Options.**
- **A.** Use the demo's full-page Settings takeover — exact visual and navigation parity; changing settings keeps a dedicated place in history.
- **B.** Keep the dialog — less navigation disruption, but it remains an unexplained demo divergence.
- **C.** Defer the container decision — preserves the current mismatch and prevents a fidelity re-freeze.
**Recommendation.** A — exact parity has no stated authority, safety, or accessibility conflict.
**Notes.** _(your notes here)_

## 2 · Shell geometry and toast floor
**Situation.** The app root differs in overflow/min-width behavior, rail-entry spacing differs, and the toast viewport is not positioned above the Session bar because its CSS variable cannot reach the provider-owned viewport. These are one visible shell contract, not independent cosmetic tweaks.
**Options.**
- **A.** Restore the demo geometry, provider nesting, and toast floor as one port — removes overlapping toasts and all listed unruled spacing drift.
- **B.** Fix only the toast overlap — leaves the root and rail differences uncited and may preserve a fragile ownership boundary.
- **C.** Keep the current shell — no implementation work, but it knowingly retains a documented visual collision.
**Recommendation.** A — it is the smallest coherent parity repair and improves rather than weakens accessibility.
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

## 3 · Rebuild-only shell affordances
**Situation.** Search consumes a first Escape to clear text, and the toolbar exposes Import spreadsheet because no Run-modal handoff exists. Neither behavior has a ruling or demo counterpart, but removing the import route could strand intake.
**Options.**
- **A.** Keep Escape-clear and the toolbar import, recording each as an intentional usability/route deviation — preserves useful behavior and the only served intake door.
- **B.** Restore demo parity by removing both — exactness improves, but intake loses its current reachable entry point.
- **C.** Keep Escape-clear but move or replace the import handoff before removing the toolbar button — cleaner parity later, but requires additional navigation work.
**Recommendation.** A — keep the real access path and benign Escape behavior, but make their divergence explicit.
**Notes.** _(your notes here)_

## 4 · Small visible shell copy defects
**Situation.** The status chip has singular/plural disagreement at one worker, and an app semver is drawn beside help text that only explains two version components. Both are visible operator-facing claims.
**Options.**
- **A.** Port the demo wording/format exactly, including its stable plural wording and two-part version display — removes the defects with no data-model change.
- **B.** Keep semver and revise the explanatory text — preserves a richer version but intentionally diverges from the demo.
- **C.** Leave both — no work, but the displayed copy remains internally inconsistent.
**Recommendation.** A — exact demo wording is adequate and avoids misleading unexplained copy.
**Notes.** _(your notes here)_

## 5 · Bulk-result truth and action feedback
**Situation.** The bulk strip hides zero buckets, uses unruled headings/order/list shape, omits both closing assurances, and lacks the persistent command-result feed and applied toast despite real command results now being served. A partial or clean batch must not read as a one-number success claim.
**Options.**
- **A.** Restore the demo's complete vector, irreversible-last order, bounded skipped-row disclosure, closing copy, result feed, and applied toast — exact fidelity and strongest operator truth.
- **B.** Keep the current compact result strip — smaller surface, but retains the demo's explicitly rejected misleading aggregate presentation.
- **C.** Add only the feed/toast — improves feedback while leaving the bulk result itself incomplete and unruled.
**Recommendation.** A — the complete vector and explanations are load-bearing operator truth, not decoration.
**Notes.** _(your notes here)_

## 6 · Queue “checked by you” state
**Situation.** The demo marks members checked and shows a well tally and drill-in state. The rebuild has no such state; the real choice is whether an operator check is ephemeral client context or durable, per-actor evidence.
**Options.**
- **A.** Port it as client-only state that resets on reload — exact demo behavior and no new authority claim.
- **B.** Add durable per-actor checks — survives reload, but creates a new authoritative workflow fact, storage contract, and privacy/retention decision.
- **C.** Omit the feature — avoids state design, but deliberately loses a demo triage aid.
**Recommendation.** A — it matches the demo without inventing durable evidence.
**Notes.** _(your notes here)_

## 7 · Queue fact-chip primitive
**Situation.** Queue rows reimplement a fact chip although the shared design-system Chip provides the demo's shape, truncation, and label treatment. The local fork visibly changes height, padding, and label ink.
**Options.**
- **A.** Replace the local fork with the shared Chip — restores exact parity and keeps the primitive contract single-sourced.
- **B.** Keep the local fork and record it as a queue-specific variant — preserves current pixels but creates a deliberate component divergence.
- **C.** Change the shared primitive to match the queue fork — affects every consumer for a one-surface preference.
**Recommendation.** A — the demo itself established that the shared primitive is the intended surface.
**Notes.** _(your notes here)_

## 8 · Start-modal plan and result continuity
**Situation.** The plan is a table instead of demo cards; its provenance line prints a raw ISO instant; typed input and shape facts disappear at Plan stage; changing a setting leaves a stale Result visible; and a contract conflict offers no reload path. These choices determine whether an operator can see, correct, and trust the command they authorize.
**Options.**
- **A.** Restore demo cards and clock formatting, keep input/shape visible through Plan, clear stale results on edits, and provide Reload the form on conflict — exact parity and the clearest recovery path.
- **B.** Keep the staged table flow — less content on screen, but authorisation can lack its input context and conflict has no exit.
- **C.** Keep the table but restore continuity and reload — addresses safety/usability while retaining one deliberate presentation divergence.
**Recommendation.** A — no serving or authority limitation requires the current staged omissions.
**Notes.** _(your notes here)_

## 9 · Start-modal extra and declaration-driven arms
**Situation.** The modal adds no-workflow and zero-system empty states, hides two required reasons in hover-only tooltips, shows Dismiss instead of Close on success, and renders an empty Safety & mode group with incorrect numbering. The empty states are honest additions; the hidden reasons conflict with the stated read-only-with-reason rule.
**Options.**
- **A.** Keep the two honest empty states with recorded rationale; otherwise restore demo labels, visible reasons, conditional group rendering, and numbering — preserves valid absent-state truth while restoring fidelity/accessibility.
- **B.** Remove every non-demo arm — exact pixels, but removes useful honest no-workflow/zero-system explanations.
- **C.** Keep all current behavior — no work, but leaves inaccessible reasons and an empty declaration-driven scaffold.
**Recommendation.** A — it is the narrow exception required by honest valid absence and accessibility.
**Notes.** _(your notes here)_
