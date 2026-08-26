# Decisions — Phase 3a demo fidelity: standing-surface conventions — 2026-08-25
_Answer positionally: `1 A, 2 C + "note"`, or "all recommended". Anything unanswered stays open._

## 1 · Catalog entry route
**Situation.** The reference contract says catalog entry is two ghost buttons beside Import spreadsheet, but no such controls exist; the catalog is reachable only by manually typing a query parameter. This is a route-repair decision, not permission to claim an absent feature is reachable.
**Options.**
- **A.** Restore the two documented toolbar entries and keep the direct route as a deep link — makes the declared path real.
- **B.** Replace the contract with a single documented deep link — smaller UI, but treats an operator-facing catalog as hidden navigation.
- **C.** Remove the catalog route entirely — avoids a surface decision, but removes the only current access path.
**Recommendation.** A — the documented demo-adjacent entry is the most discoverable exact parity choice.
**Notes.** _(your notes here)_

## 2 · Shared takeover wrapper
**Situation.** Archive, Activity, and Explorer consistently add a Panel wrapper and enter transition around demo takeovers. It may improve labeling/motion, but no decision establishes the convention or its accessibility rationale.
**Options.**
- **A.** Keep the wrapper as a documented cross-surface accessibility/motion convention — preserves a consistent, named divergence.
- **B.** Remove it and use the demo's bare takeover containers — restores exact structure but loses the added labels/transition uniformly.
- **C.** Decide per surface — maximum local flexibility, but makes a cross-surface convention drift again.
**Recommendation.** A — the consistent wrapper has an accessibility purpose and can be explicitly governed.
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

## 3 · Horizontal table overflow
**Situation.** Rebuild tables add `overflow-x-auto` wrappers where the demo leaves tables bare. On narrow viewports, the wrapper can preserve columns; without a rule, it is an unexplained interaction change.
**Options.**
- **A.** Keep wrappers only where a responsive proof shows clipping otherwise, and document that condition — preserves reachable data without making every table scrollable by default.
- **B.** Remove all wrappers for exact demo markup — simple parity, but risks clipping dense operator facts.
- **C.** Keep wrappers everywhere — uniform implementation, but can create nested scrolling even when unnecessary.
**Recommendation.** A — accessibility justifies a bounded exception, not an unconditional divergence.
**Notes.** _(your notes here)_

## 4 · Async loading and refusal panes
**Situation.** Archive and Activity add Skeleton and Refusal panes that the static demo has no counterpart for. Real asynchronous reads can be loading or refused, and a blank or fabricated success state would violate the fail-loud rule.
**Options.**
- **A.** Keep explicit loading and refusal panes as a documented honest-async convention — retains truthful states the demo cannot exercise.
- **B.** Remove them for visual parity — exact static screenshots, but leaves real load/refusal states unspecified.
- **C.** Replace refusal panes with empty states — compact, but conflates “could not load” with “nothing exists.”
**Recommendation.** A — authority truth and fail-loud behavior override static-demo parity here.
**Notes.** _(your notes here)_

## 5 · Explorer surplus facts
**Situation.** Explorer adds node labels beside ids, a contracts count, and a rerun sentence beyond the owning trust contract. These may help scanability, but they alter the demo's information density and risk wording unsupported by authority.
**Options.**
- **A.** Restore the demo fields only, unless each extra fact is added to the owning contract with a purpose — keeps the explorer contract-led.
- **B.** Keep all extras and record a presentation convention — useful density, but expands the surface beyond its listed trust facts.
- **C.** Hide ids in favor of labels — friendlier copy, but removes stable technical identity an operator may need for support.
**Recommendation.** A — the explorer should not mint a second vocabulary beside its owning contract.
**Notes.** _(your notes here)_

## 6 · Explorer field edit affordance
**Situation.** The demo marks editability on the field's own row; the rebuild moves it to facts below the table. This changes the relationship between a value and the action that can affect it.
**Options.**
- **A.** Return the pencil/affordance to the editable field row — exact parity and the clearest local association.
- **B.** Keep the lower FactRows — separates read and action areas, but reverses the demo's stated explanation.
- **C.** Remove editability from this read-only phase — avoids suggesting a currently deferred action, but removes the declared future posture.
**Recommendation.** A — it describes the field accurately without enabling the deferred edit operation.
**Notes.** _(your notes here)_

## 7 · Archive copy and surface shapes
**Situation.** The archive has a large, linked set of unruled labels, empty states, table/ledger shapes, capture geometry, relaunch wording, and Versions banners. Treating each as an independent fork would invite inconsistent terminology.
**Options.**
- **A.** Port the demo archive copy and shapes as one fidelity pass, except where an already-ratified authority fact requires different wording — coherent parity and one review/re-freeze.
- **B.** Keep the current copy and record a general archive voice — avoids a large port, but requires a new semantic style decision for many already-designed elements.
- **C.** Resolve rows individually — precise, but expensive and likely inconsistent across a single workflow surface.
**Recommendation.** A — these rows are one surface language, not independent product decisions.
**Notes.** _(your notes here)_

## 8 · Intake information architecture
**Situation.** Intake changes the demo's rejection list, fix/exclude editors, exclusions Well, and result-banner families. The same operator needs to find rejected data, correct/exclude it, and understand what the eventual enqueue did.
**Options.**
- **A.** Restore the demo list, editors, Well, and banner shapes as one flow — exact parity and a stable review path.
- **B.** Keep the compact card/inline/chip shapes — less screen structure, but an unexplained deviation across the whole correction flow.
- **C.** Mix patterns by stage — local optimization, but makes one intake flow change interaction grammar midstream.
**Recommendation.** A — coherence across correction and enqueue is more valuable than isolated compactness.
**Notes.** _(your notes here)_

## 9 · Version-bump dialog fidelity outside the semantic arms
**Situation.** Beyond major/minor behavior and the archived-run list, the bump dialog differs in mounting, size, scope copy, radio control, defaults, fields, validation, result/refusal, and footer. These are one authoring transaction and must not obscure the real server refusal/no-force rule.
**Options.**
- **A.** Port the demo dialog as one transaction, preserving truthful async/refusal feedback and the no-force rule — restores complete parity without weakening server authority.
- **B.** Keep the current simplified dialog — fewer components, but retains a large set of uncited workflow-shaping differences.
- **C.** Port only labels — partial visual improvement, but leaves the control and outcome semantics inconsistent.
**Recommendation.** A — the demo design already treats these pieces as one bounded authoring flow.
**Notes.** _(your notes here)_

## 10 · Small Activity, Settings-storage, DS, and catalog drifts
**Situation.** Activity has group/spacing drift; Settings storage has header/banner/card/table drift; two DS primitives add behavior/layout; and catalog metadata uses a different thesis. These are low-risk but still unruled current divergences.
**Options.**
- **A.** Restore exact demo copy, tokens, and primitive shapes in one small fidelity pass — minimizes future local forks.
- **B.** Keep them as informal implementation refinements — no immediate work, but leaves the phase's exact-or-ruled bar unmet.
- **C.** Create separate decisions for each token — maximum granularity, but disproportionate operator overhead for linked visual details.
**Recommendation.** A — no listed change improves authority, safety, or accessibility over the demo.
**Notes.** _(your notes here)_
