# The roadmap notation

`docs/roadmap/roadmap.md` is written in this notation; `npm run roadmap` renders it to `docs/roadmap/index.html`
(never hand-edit the site). Moved here from the retired `custom-update-plan` skill on 2026-08-21 — the notation is
governance, the skill was procedure. Procedure, in short: edit the plan in this notation → `npm run roadmap` →
`npm run roadmap:check` → land any owning-doc change for a decision in the SAME commit.


The parser is `parsePlan` in `scripts/roadmap/parse-plan.ts` (pure, importable — `scripts/generate-roadmap.ts` owns the read/render/write entry, and the binding guard imports the same function); every line inside the region must be one of these shapes or the build fails loud with the line number. The parsed plan is then validated by `RoadmapSchema` in `scripts/roadmap/schema.ts` — the same strict zod schema the page renders from.

### Notation

```
# HR Rebuild Roadmap                      ← title
asOf: 2026-08-20                          ← meta lines (asOf, head, eyebrow, footer; source: repeatable)
head: 5f6713f
> one-paragraph lede (one line)
tiles:
- Label | value | sub                     ← a tile; a leading "!" makes it the hot (amber) tile

<!-- roadmap:start -->

## Per-workflow migration — separations first {#phase-3}     ← a PHASE: "## Title {#id}" (id required)
phase: Phase 3                             ← eyebrow
status: active                             ← done | active | you | planned | proposed | never
when: 08-12 → today | nine days so far     ← primary | secondary (secondary optional)
size: XL                                   ← S | M | L | XL (optional)
chip: active                               ← optional; chip-tone: overrides the colour
doc: 03c §Phase summary · ref:write-safety §5   ← the doc sections that OWN this node's contracts
open: yes                                  ← yes | no (unused by the tree; kept for the doc)

> summary — one line; more "> " lines are joined with a space

builds:                                    ← what this node BUILDS, one feature per line
- [x] BE text                              ← box = the feature's own status: [x] done · [ ] planned · [~] active · [?] proposed · [-] never · [!] needs you
- [ ] FE text                              ← LAYER = FE (React only) · BE (BFF/kernel only) · BOTH (vertical slice) · WIRE (connecting two halves that exist) · DOCS · PROOF (a live run / measurement)

needs:                                     ← what this node NEEDS
- sep-6c                                   ← another node's id (met when that node is done)
- you: name the §4f2 canary target(s)      ← an act only the operator can take (amber); you(met): once answered
- fact: capability register at zero open   ← a fact; fact(met): when true

note: text                                 ← a note block; note!: an amber (operator) note

log:                                       ← the node's session journal, newest-first in the drawer
- 2026-08-20 | docs-cohesion step 2b | what landed (`ea7704e0`) · what is left

### Track A · separations backend completion {#track-a}     ← a TASK under the phase: "### Title {#id}" (id optional; needed for needs:/links)
status: you
date: D196 · D205 live 08-13               ← the item's info line (dates, decisions)
size: L
chip: blocked at A1 — needs you
doc: ref:write-safety §14 · ref:workflow-model §1.1   ← same attribute on a task or sub-task

> desc
builds: … / needs: … / log: … / note: …
| # | Step | Status |                      ← a markdown table; first cell may start with ! (amber row) or ✓ (done row)
|---|---|---|
| !A1 | You name the canary | **YOU** |

#### 1 · new-kronos timecard read {#sep-1}   ← a SUB-TASK (#### and ##### nest one level each)

## flag: 2026-08-12 | D193 — scope and entry …   ← a dated RATIFIED milestone on the spine
## session: 2026-08-20 | docs-cohesion steps 1–2 | the plan moved …   ← a dated WORKING session on the spine
## today: 2026-08-20 · HEAD 5f6713f · …          ← the TODAY rule

<!-- roadmap:end -->
```

### The three binding / journal shapes, in full

Verbatim from the parser's own banner (`scripts/roadmap/parse-plan.ts`) — the grammar is what the parser enforces, line by line:

```
doc: 03a §2.1 · ref:write-safety §5 · 00
  An ATTRIBUTE line (so it sits in the attribute block under the heading,
  beside `status:`), legal on a phase, a task or a sub-task. Its value is
  one or more refs joined by " · " (the split happens only before a doc token, so a section may contain " · "). A ref is `<doc>` or `<doc> §<section>`,
  and `<doc>` is one of exactly two things:
    · a PHASE doc number — `00` `01` `02` `03a` `03b` `03c` `03d` `04` `05` `06`,
      the actionable `docs/rebuild/NN-*.md` docs (the number IS the phase,
      and phase 3 is four docs, so bare `03` is not one of them);
    · `ref:<slug>` — a spec under `docs/rebuild/reference/`, cited by name
      because it is unnumbered: `ref:write-safety`, `ref:decisions`. The
      slug is syntactically a kebab-case filename stem; whether that file
      EXISTS is the `roadmap-doc-binding` guard's business, not the
      parser's, which is the same split as the section below.
  A section is anything after " §" that carries no " · " and no edge
  whitespace: dotted numbers (`5.4`), a range (`5.4–5.6`), or a heading
  NAME (`Phase summary`) — the phase docs number no headings, so naming
  one is the only way to cite it. Rendered as a muted
  `doc 03a §2.1 · ref write-safety §5` line under the drawer title.
  Absence is legal HERE — presence is a guard's business.

log:
- YYYY-MM-DD | <session> | <text>
  A BLOCK, same grammar shape as `builds:` / `needs:`, legal on any node.
  Exactly two " | " separators per line: a real ISO date, a non-empty
  session name, and non-empty text (inline markup and D-numbers allowed).
  Rendered newest-first as the drawer's last section, "Session log".

## session: YYYY-MM-DD | <session> | <text>
  A spine marker, like `## flag:` but for a working session rather than a
  ratified milestone — same three fields as a `log:` line, drawn with a
  hollow dot and a "SESSION" eyebrow so the two never read alike.
```

- **`doc:`** — WHERE this node's contracts are written; the tree's half of the two-way binding below. One line per node; a second is refused.
- **`log:`** — WHAT each session did to this node, so the next agent reads the node's own history instead of `git log`.
- **`## session:`** — the same for the program: one dated marker per working session, on the spine beside the ratified `## flag:`s.

Rules that keep the tree honest:
- **Every `builds:` line carries a layer tag** — it is how the operator tells "not built yet" from "built and sloppy".
- **A feature marked `[x]` must be landed at HEAD**; cite the commit/decision in its text. Never pre-mark.
- **`you:` items are the operator's** — switch to `you(met):` only on their explicit answer.
- **Ids are stable anchors** (`order-3`, `track-a`, `sep-6c`) — never rename one; links and deep links bind to them. `needs:` refs must resolve; cycles fail loud.
- **The doc binding is two-way** (D263, `docs/roadmap/roadmap.md` §Governance) — every node carries a `doc:` line naming the phase-doc (`03a §2.1`) and reference (`ref:write-safety §5`) sections that OWN its contracts, and every doc section that describes a node carries `<!-- roadmap: <id> -->` on the line directly under its heading. The phase docs stay normative: where the tree and the doc disagree, the doc is right and the tree is corrected. The `roadmap-doc-binding` guard (landing as step 3 of `docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md`) refuses a `doc:` ref that resolves to no such section and a `<!-- roadmap: id -->` tag that names no such node — so a rename on either side fails the gate instead of rotting.
- **`log:` lines are append-only.** Never edit or delete another session's line; a wrong one is corrected by a NEW line that says so. The block is a journal, not a status field.
- Inline markup in any text: `` `code` ``, `**bold**`; D-numbers are auto-highlighted. No other markdown inside the region.
- The plan records **what is built and what is required**; it does not invent scope. An unplanned feature is a finding for `docs/findings/`, not a roadmap line.

Also bump `asOf:` and `head:` (the HEAD you are updating FROM), the `## today:` line, and any tile the change moves.

### The doc-side status block

The other half of the binding carries its own checklist. Immediately under a tagged section's prose (one block per node id per doc):

```
<!-- roadmap-status: sep-1 -->
- [x] the virtualized timecard read terminates on range coverage (D205, 2026-08-13)
- [ ] the Kronos controlled commit — waits for 08-28
> 2026-08-20 | docs-cohesion 05-separations | verified against src/stores/kronos/…; left: the commit proof
<!-- /roadmap-status -->
```

Lines are `- [x| |~|?|-|!] text` (the same boxes as `builds:`, **no layer tag** — these are the doc's own checklist, not the plan's) and `> YYYY-MM-DD | session | note`. Blank lines are allowed; anything else in the block fails the render by line number. An EMPTY block is legal and renders as "not yet assessed" — say it rather than leaving the section silent.

- **One block per node per doc.** A second block for the same id in the same file is refused; a tag may sit on any section, the block belongs to the one that owns the work.
- **`[x]` only for what is landed at HEAD**, with its commit or D-number in the line's own text — the same bar as a `builds:` box.
- **Notes are append-only**, like `log:` lines: correct a wrong one with a new one.
- **`npm run roadmap -- --check` goes stale when a doc's status moves**, because the drawer renders these blocks ("From the docs", with a per-phase roll-up). Ticking a box in a doc and not regenerating fails the gate — which is the point.

## Step 1b — the `session` class (end-of-session procedure)

Run this when a working session is ending — yours or a subagent's you are closing out. It is the whole class; the steps below replace nothing above, they order it.

1. **Tick what LANDED.** For every node you touched this session, flip `builds:` boxes — `[x]` **only** for what is landed at HEAD, with the commit hash or D-number cited in the line's own text. A thing that is written but uncommitted, or committed on a branch that is not merged, is not `[x]`.
1b. **Tick the status blocks of the doc sections you worked**, and leave a `>` note — same bar as a `builds:` box (`[x]` only at HEAD, commit/D cited), notes append-only.
2. **One `log:` line per touched node**, appended to that node's `log:` block (create the block if the node has none):
   `- YYYY-MM-DD | <session> | what landed (commit) · what is left`
   The `<session>` name is the slug somebody can find later — the plan or handoff slug, or the dispatch unit (`docs-cohesion step 2b`, `separations 6c`, `track-d ratified`). Say what is LEFT as well as what landed; a line that only celebrates is a line the next agent cannot use.
3. **One `## session:` spine marker for the whole session** — placed after the last `## flag:` / `## session:` and before `## today:`, one line, naming the nodes touched:
   `## session: YYYY-MM-DD | <session> | <what moved, node ids named>`
   One per session, not one per commit.
4. **Bump the facts** — `asOf:`, `head:` (the HEAD you are updating FROM), the `## today:` line, and any tile the session moved (decisions range, guard/test counts, workflows migrated, the critical-path blocker).
5. **Regenerate and check** — Step 2 below (`npm run roadmap` then `npm run roadmap -- --check` printing `fresh`).
6. **Commit** — `docs(roadmap): session <name> — plan + site`, staging only `docs/roadmap/roadmap.md`, `docs/roadmap/index.html` and any owning docs the session ratified. Never `git add -A`; never push.
7. **Republish** the hosted copy to the existing URL — Step 5 below.

Three standing rules for this class:

- **`log:` lines are append-only.** A prior session's line is history: never edit it, never delete it. Correct it with a new line that names what the old one got wrong.
- **A session that changed nothing on the tree still leaves its `## session:` marker if it touched the docs.** "The docs moved and the tree did not" is a fact worth being able to read; silence is indistinguishable from a session that never happened.
- **The next agent reads first.** Before starting, read the newest `log:` lines of the nodes it is assigned (`npm run roadmap -- --json` if you want them structured) — the node's own journal is where the last agent said what is left.
