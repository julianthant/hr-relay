---
name: hr-lesson
description: >-
  Record a lesson learned in the hr-automation-rebuild repo — routes it to the right ledger (root `docs/rebuild/reference/lessons.md` for kernel / cross-cutting lessons, the module or store `CLAUDE.md` "Lessons learned" section for scoped ones), in the dated-bullet format, newest first, naming the decision(s) it came from. Before appending it dedupes and supersedes: an existing lesson on the same thing is updated, a contradicted lesson is corrected or removed in the same edit. USER-INVOKED ONLY — the operator says when a lesson is worth marking; never auto-trigger.
disable-model-invocation: true
---

# /hr-lesson — record a lesson (user-invoked only)

The operator decides when something is a lesson. When invoked, you do three things: **route** it, **reconcile** it with what is already written, **write** it in the house format. The ledgers are maintained, not append-only.

## 1 · Route — where does it go?

| Topic | Ledger | Format |
|---|---|---|
| Kernel, authority, write-safety, executor, projection, dashboard wire, guards, docs process, anything cross-cutting | `docs/rebuild/reference/lessons.md` (`ref lessons`) | dated bullet, **newest first**, directly under the header block |
| A store / system driver (selector, page-state fact, login recipe, Duo, a system's quirk) | `src/stores/<system>/CLAUDE.md` → `## Lessons learned` | dated bullet |
| Dashboard surface / model / parity lane | `src/dashboard/CLAUDE.md` → `## Lessons learned` | dated bullet |
| Another module with its own `CLAUDE.md` | that file's `## Lessons learned` (create the section if absent) | dated bullet |

Touches several? Primary ledger gets the entry; the others get ONE line pointing at it (`see ref lessons 2026-08-21 "<title>"`). Never duplicate the body.

## 2 · Reconcile — dedupe and supersede BEFORE writing

1. Grep the target ledger (and `ref lessons`) for the decision number, the subsystem, and 2–3 distinctive terms of the new lesson.
2. **Same lesson already recorded** → update/extend that entry (keep its date, add `updated YYYY-MM-DD:` inside) instead of adding a second.
3. **New lesson contradicts an old one** → fix the old entry in the SAME edit: either rewrite it to the corrected fact, or delete it and let the new entry carry a one-clause note of what it supersedes (`supersedes the 2026-08-04 note that …`). Two contradicting lessons standing side by side is the failure this step exists to prevent.
4. Only append when the failure mode is genuinely new.

Report what you reconciled (updated / removed / none) in your reply.

## 3 · Write — the house format

```markdown
- **YYYY-MM-DD: <the gotcha in one line — what looked safe and what it actually did> (D<nnn>[/D<nnn>]).**
  <One paragraph. What was tried, why it failed (root cause, specific), what fixed it and where the
  fix lives (file/function/guard), and the generalizable rule — the sentence the next reader should
  carry out of here. Name values, ids, numbers where they make the lesson checkable.>
```

- Title first, date-prefixed, bolded, ending with the decision(s) in parentheses when there is one.
- Concrete beats abstract: "`.or()` is a union under strict mode, so waiting on one claims its arms are mutually exclusive" beats "be careful with `.or()`".
- One paragraph; if it needs more, the lesson is two lessons or the detail belongs in the owning reference doc (cite it: `ref write-safety §3.4`).
- Newest first in `ref lessons`; module `CLAUDE.md` sections follow whatever order that file already uses.

## 4 · Verify

- The ledger still parses as a list (no broken bullet, no orphan continuation line).
- If a module `CLAUDE.md` changed, nothing else in it moved.
- `npm run lint` is unaffected (markdown is not linted, but a stray edit to a `.ts` file would be) — only run the gate if you touched code.

## Legacy repo note

In `/Users/julianhein/Projects/hr-automation` the ledgers are `src/systems/<system>/LESSONS.md` (four required subsections `**Tried:** / **Failed because:** / **Fix:** / **Tags:**`, enforced by `lessons-format.test.ts`) and the root `LESSONS.md`. This skill lives in the rebuild repo; if the operator asks for a legacy lesson, use that format and run `npm run test:architecture` there afterwards.
