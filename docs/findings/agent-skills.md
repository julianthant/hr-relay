# Agent skills — external sources and local gaps

## Four-repository comparison — 2026-09-04

**Status:** researched; recommendations only, not approved implementation.
**Question:** Which ideas from the four supplied repositories improve the existing Claude/Codex skill surface without adding duplicate commands or undermining output/context savings?
**Scope:** Personal skill inventories and selected local references as read on 2026-09-04. Current GitHub snapshots below. Repository runtime and live HR state are out of scope.
**Method:** Read all four repository landing pages and source trees, then selected primary skill files. Compare against local skills management, planning, supervision, UI references and existing eval fixtures. No upstream code, hooks, model sessions or benchmarks executed. This is a targeted comparison, not an exhaustive ECC audit.

### 1. Extend the existing skills router with quality judgments

**Answer:** ECC's stocktake adds useful Keep/Improve/Update/Retire/Merge judgments, concrete reasons, and changed-skill re-evaluation. Our skills router already inventories exposure, hashes, adapters, references and synchronization. Add quality judgments to `/skills audit`; retain the existing small operator menu. Re-evaluate changed skills and affected callers when shared rules change. Keep low-use safety skills when they have unique value.
**Evidence:** [ECC stocktake](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/skill-stocktake/SKILL.md); local `~/.agents/skills/skills/SKILL.md` and `scripts/audit.py`.
**Confidence:** high for source behavior; medium for expected benefit.
**Why:** Direct source comparison; no outcome benchmark. ECC's automatic general-purpose subagent dispatch conflicts with our explicit delegation policy and must not be copied.

### 2. Test skill behavior and routing, including the changes just installed

**Answer:** Add an explicitly invoked `/skills eval` mode, using existing fixtures plus executable outcome checks. Include supportive, neutral and conflicting prompts; negative cases should verify that irrelevant skills do not activate. Track success, required clarification, unauthorized actions, tokens and latency under fixed model/effort and input conditions.
**Evidence:** [ECC evaluation framework](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/eval-harness/SKILL.md), [behavioral compliance](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/skill-comply/SKILL.md); local `~/.agents/skills/{phase-plan,supervise}/evals/evals.json`.
**Confidence:** high for the missing cases in the inspected fixtures; medium for the proposed evaluation design.
**Why:** The existing four planner and five supervisor cases omit the newly added sizing/progress behavior. Add cases for one cohesive assignment, two independent assignments, overlapping schema requiring sequence, named worktrees and merge conditions, failed steps remaining visible, and review still pending after green tests. Use isolated fixtures; never rerun HR transactions for an eval. Skill-format validation is not behavioral proof.

### 3. Fix an existing UI worker-role conflict before adding design rules

**Answer:** Codex's UI router assigns bounded frontend units to `sup_terra`, including implementation. Supervise reserves Terra for exact mechanical work. Claude's UI router also uses vague supervisor tiers. Align both UI adapters with their native substantive worker roles and keep consequential judgment with the current supervisor.
**Evidence:** `~/.agents/skills/ui/SKILL.md:90`, `~/.agents/skills/supervise/SKILL.md:60`; `~/.claude/skills/ui/SKILL.md:91`, `~/.claude/skills/supervise/SKILL.md` Supporting workers.
**Confidence:** high.
**Why:** Direct conflicting local instructions. Role-policy scripts passed previously, but did not establish that every skill caller follows the role policy.

### 4. Measure context and output separately

**Answer:** Add `/skills budget` to distinguish always-visible metadata/global rules, invoked skill bodies, conditional references, and tool schemas. Report actual token usage when available; label static estimates. Compare successful task cost and rework before/after Caveman; shorter output alone is insufficient.
**Evidence:** [ECC context audit](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/context-budget/SKILL.md), [cost tracking](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/cost-tracking/SKILL.md), [iterative retrieval](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/iterative-retrieval/SKILL.md).
**Confidence:** high for source mechanisms; medium for savings potential.
**Why:** ECC includes rough word/tool-schema estimates; these do not establish actual current-session overhead. Adapt its gap-driven retrieval, but never treat a fixed search-cycle limit as permission to guess. Our focused-session reference already requires bounded reads and native compaction.

### 5. Karpathy: absorb small missing rules into existing owners

**Answer:** The four principles are assumption management, simple solutions, focused changes and verified outcomes. Existing planning, debug, design, review and global rules cover much of this. Strengthen request-to-diff traceability and removing only dead code created by the current change. Put reuse-before-building in the planner's implementation inspection, drawing on ECC search-first. Avoid another always-loaded coding skill.
**Evidence:** [Karpathy guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines/SKILL.md), [ECC search-first](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/search-first/SKILL.md); local global instructions and `phase-plan`, `supervise`, `codebase-design`, `debug`, `review` entry points.
**Confidence:** high for source principles; medium for incremental benefit.
**Why:** This is consolidation. Adapt the upstream stop-and-ask rule to real material ambiguity; preserve your authorized autonomous work and repository-required failure handling.

### 6. Taste: update selectively behind the existing UI router

**Answer:** The main Taste skill explicitly targets landing pages, portfolios and redesigns, excluding dashboards and multi-step product UI. Our internal UI library already identifies design-taste-frontend and redesign-existing-projects as sources, and includes design dials, density bands, contrast, state coverage and visual inspection. Diff upstream changes against those owners; import only missing, relevant checks. Keep HR dashboard behavior under Operate-mode priorities.
**Evidence:** [Taste main skill](https://github.com/Leonxlnx/taste-skill/blob/ccbc15639c97057cbfcf32ecebc38ef716e4bb37/skills/taste-skill/SKILL.md), [GPT variant](https://github.com/Leonxlnx/taste-skill/blob/ccbc15639c97057cbfcf32ecebc38ef716e4bb37/skills/gpt-tasteskill/SKILL.md), [output variant](https://github.com/Leonxlnx/taste-skill/blob/ccbc15639c97057cbfcf32ecebc38ef716e4bb37/skills/output-skill/SKILL.md); local `ui-design/references/{_conventions,05-layout-and-density,16-preflight}.md`.
**Confidence:** high.
**Why:** Main skill source is 87,253 UTF-8 bytes at this snapshot. GPT variant mandates simulated Python output and GSAP motion; reject fabricated execution and universal aesthetic mandates. Output variant's exhaustive chat policy conflicts with output savings; retain complete file edits without dumping files into chat.

### 7. Awesome plugins: discovery input only

**Answer:** The repository is a ranked plugin/repository directory with adoption/popularity fields. Use it to find candidates when a capability gap exists, then inspect each candidate's source and compatibility. Ranking does not prove quality or benefit for this workflow.
**Evidence:** [Pinned directory](https://github.com/quemsah/awesome-claude-plugins/blob/48fc0029fdd7bd07c32ae00d34e52f74f5fbe232/README.md).
**Confidence:** high for directory contents; medium for the recommendation.
**Why:** The inspected ranking is not a behavioral evaluation.

### 8. Continuous learning is a later, narrower option

**Answer:** ECC's scoped observations, evidence and promotion ideas could improve requested lesson updates. Keep candidate lessons at their module owner; promote shared rules only after repeated evidence and explicit review. Do not introduce an automatic observer or parallel memory authority by default.
**Evidence:** [ECC continuous learning](https://github.com/affaan-m/ECC/blob/e04ea0b9cc8248686edf5ac751cadff550e162b8/skills/continuous-learning-v2/SKILL.md); repository instruction requiring lessons in the linked module ledger.
**Confidence:** high for source mechanism; medium for suitability.
**Why:** Its hooks capture session observations and its promotion workflow adds ongoing machinery. Current scope needs better validation first.

### Recommended implementation order (inference)

1. Resolve UI role conflicts; add the missing planner/supervisor eval cases.
2. Extend `/skills audit` and add explicit `/skills eval` and `/skills budget` modes with shared core and native adapters.
3. Consolidate the small Karpathy/search-first improvements; selectively refresh existing UI references.
4. Consider scoped lesson promotion only after the first three show value.

No new top-level skill is recommended. Personal operator inventories currently match: 18 on each platform; repository operator inventories match at four. Eight personal skills on each platform already contain eval fixtures. Full behavioral runs, runtime token savings and comprehensive upstream script safety remain unverified. No skills, hooks, configuration or product code were changed during this comparison.
