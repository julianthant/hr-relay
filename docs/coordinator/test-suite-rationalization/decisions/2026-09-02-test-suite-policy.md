# Decisions — lean, risk-owned test suite — 2026-09-02

_Answer positionally: `1 A, 2 C + "note"`, or `all recommended`. Unanswered items stay open._

## 1 · Primary success measure

**Situation.** The current estate is large enough that raw test count, execution time, and regression protection can point in different directions. This decision defines what the rationalization optimizes when those measures conflict.

**Options.**

- **A.** Minimize raw test count — the result is simplest to quantify, but it creates the highest risk of deleting unique regression protection.
- **B.** Minimize runtime — this permits many cheap tests, but can retain duplicated maintenance and misleading assertions.
- **C.** Preserve unique failure protection first, then reduce maintenance and runtime — test count becomes an outcome rather than the target.

**Recommendation.** **C** — unique risk coverage is the safety boundary; maintenance and runtime should improve only after it is mapped.

**Notes.** _(your notes here)_

## 2 · What counts as a duplicate

**Situation.** The same business rule can appear in a pure unit, server boundary, scenario, and browser test. Some repetition is redundant; some independently proves a boundary that another layer cannot reach.

**Options.**

- **A.** The same business rule anywhere is duplicate — keep one assertion even when that removes independent boundary proof.
- **B.** The same failure mode at the same seam with the same oracle is duplicate — cross-layer copies remain only when each proves a boundary the others cannot.
- **C.** Cross-layer repetition is always defense in depth — no cross-layer assertion is ever considered duplicate, increasing maintenance and runtime.

**Recommendation.** **B** — seam and oracle identify duplication more truthfully than shared business wording or layer count.

**Notes.** _(your notes here)_

## 3 · Proof before deleting or merging a test

**Situation.** A green suite after deletion only proves the remaining suite is green; it does not prove the deleted failure mode is still protected. This decision sets the evidence required for every deletion or consolidation.

**Options.**

- **A.** Reviewer judgment plus a green suite — cheapest, but cannot expose a shared blind spot.
- **B.** Unchanged coverage plus a green suite — preserves execution counts, but line coverage does not prove the same failure oracle.
- **C.** A mapped surviving test plus red-capable mutation/negative-control evidence that it catches the deleted test's unique failure, or explicit proof the deleted test could never fail meaningfully — more work, strongest audit trail.

**Recommendation.** **C** — it directly proves retained protection instead of using green status or line coverage as a proxy.

**Notes.** _(your notes here)_

## 4 · Directory structure

**Situation.** Tests need a predictable home for runners and contributors, while workflow-specific behavior still needs visible ownership. Architecture guards are cross-cutting by design.

**Options.**

- **A.** Workflow first — co-locate every runner type for a workflow, simplifying workflow browsing but obscuring runner/gate boundaries.
- **B.** Test type only — use unit/server/scenario/parity with no workflow ownership beneath them, simplifying runners but weakening capability ownership.
- **C.** Hybrid — runner/test type first, then capability/workflow ownership where applicable; keep cross-cutting architecture guards together.

**Recommendation.** **C** — it preserves executable runner boundaries and makes local ownership visible without scattering cross-cutting guards.

**Notes.** _(your notes here)_

## 5 · Scenario scope

**Situation.** Scenarios are more expensive and can make synthetic, authority-backed, and live claims look equivalent when their purpose is unclear. Units can prove pure refusals more cheaply; T2 and T1b exist for boundaries those units cannot reach.

**Options.**

- **A.** Maximize example count and exercise every combination in scenarios — broad examples, high runtime and duplication.
- **B.** Keep one structural scenario per genuinely distinct graph path; put permutations and pure refusals in units; use T2 only for real projection/command seams and T1b only for real-system arms; add no scenario merely for coverage.
- **C.** Retain only happy paths and let units hold all refusals — cheapest scenario estate, but removes boundary-level refusal proof.

**Recommendation.** **B** — it reserves scenarios for graph and boundary risks while keeping pure combinatorics in the cheapest layer.

**Notes.** _(your notes here)_

## 6 · Trigger policy

**Situation.** D191 currently requires full typecheck, lint, and coverage on every commit. The suite is now large enough that local iteration policy and supervisor-integration policy may need distinct triggers, but changing D191 requires explicit owning-document ratification.

**Options.**

- **A.** Continue full typecheck/lint/coverage on every local commit — strongest immediate feedback, slowest iteration.
- **B.** Use targeted affected tests for local iteration/commits, then require full typecheck/lint/coverage at supervisor integration and before merge; require parity for UI changes and live dry-runs only at declared workflow triggers — faster iteration with mandatory full integration proof, and requires D191 ratification.
- **C.** Leave every change to manual judgment with no mandatory full integration gate — fastest, but permits unexecuted checks to drift indefinitely.

**Recommendation.** **B** — it preserves a hard full gate at integration while making local development proportional; adopt only with D191/owning-doc ratification.

**Notes.** _(your notes here)_

## 7 · Runtime budget

**Situation.** Runtime needs a measurable target or it may never improve, but an aggressive target can incentivize deleting unique protection. The budget applies on a declared reference machine after a clean baseline.

**Options.**

- **A.** Set no hard target — remove only proven duplicates, avoiding target-driven cuts but providing no performance constraint.
- **B.** Target affected checks at 30 seconds or less, full coverage at 90 seconds or less, and parity at 75 seconds or less; never delete unique protection merely to hit the number.
- **C.** Require every full gate, including parity, at 60 seconds or less — aggressive feedback, likely requiring larger coverage cuts or more infrastructure work.

**Recommendation.** **B** — it creates useful budgets while explicitly subordinating them to unique failure protection.

**Notes.** _(your notes here)_

## 8 · Naming and file boundaries

**Situation.** Many files and test titles no longer predict the behavior or failure condition they own. The organizing unit can be a production module or a coherent risk family.

**Options.**

- **A.** One test file per production module — predictable code pairing, but unrelated risks can accumulate in very large files.
- **B.** One file per coherent behavior/risk family; filenames predict the family, `describe` names identify the subject, and test names state observable behavior plus condition/refusal.
- **C.** Treat naming as cosmetic and leave it to each contributor — no migration cost, continued search and ownership ambiguity.

**Recommendation.** **B** — risk-family boundaries make failures and maintenance ownership legible without forcing module-shaped files.

**Notes.** _(your notes here)_
