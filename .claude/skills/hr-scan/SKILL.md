---
name: hr-scan
description: Scan HR documents into structured data — scanner PDFs (Xerox Scan_*.pdf), rosters, I-9 stacks, onboarding packets, Kuali/UCPath printouts — by recognizing the document SHAPE first (a remembered catalog in references/document-shapes.md that this skill extends every time it meets a new type), then extracting only the fields that shape carries, in parallel transcribe-only readers, deduping, resolving people to EIDs through person-lookup when asked, flagging ambiguity BY PAGE NUMBER, and emitting the requested artifact (spreadsheet, worklist for hr-manage, intake bundle for the rebuild's OCR/intake gate). Never copies SSNs into transcripts or artifacts. Invoke on `/hr-scan <pdf|dir>`, "read this scan", "make me a spreadsheet of these people", "what documents are in this stack", "add the EIDs".
---

# /hr-scan — documents in, structured data out, faster every time

HR documents are predictable. The skill's memory is **`references/document-shapes.md`**: one entry per document type (how to recognize it, what fields it carries and where, what to ignore, known traps). Read it first; extend it last. A shape you have seen once should never be re-derived.

## 0 · Rails
- **No SSNs** leave the page: never transcribe, store, or echo one (an SSN written as `8462`/`901-73-8462` means blank — say "blank", not the digits). No full DOBs in artifacts unless the artifact's purpose requires one and the operator said so.
- Readers are **transcribe-only**: a reader reports what is on the page; the decision about what it means happens here, in one place.
- Ambiguity is reported **by page number** ("p. 7: 'Hernandez, J.' could be Jose or Juan — two candidates in the lookup"), never resolved by guessing.
- Live lookups are pre-authorized (person-lookup against UCPath/CRM, Duo hands-off) — don't ask.
- `get what you can, leave the rest` — a field the page doesn't carry is `absent`, not invented.

## 1 · Identify the shape (per document / per page block)

1. Open the PDF (Read with `pages`), look at page 1 and a middle page. Match against `references/document-shapes.md` (title text, form id, layout fingerprint). State the match: `shape: onboarding-packet v1 (EE Data Gathering Form + Signed Offer Letter)` or `shape: UNKNOWN`.
2. UNKNOWN → do the extraction by hand this once, then **add the shape** (§5) so next time is a match.
3. A stack (many people / many docs in one scan): split into blocks by the shape's own boundary rule (e.g. I-9: Section 1 page starts a new person; onboarding packet: the offer letter's name line) and list the blocks with page ranges before extracting.

## 2 · Extract (parallel, transcribe-only)

- Dispatch one reader per block (or per ~10 pages): `sup-sonnet` for clean print and `sup-opus` for handwriting or poor scans. Set the exact native `subagent_type` and begin the visible description with `[sup-sonnet] scan` or `[sup-opus] scan`; never use Explore, general-purpose, or another generic role. If the required role is unavailable, stop and report it. Paste the shape's field list and rails above into the brief. Readers return a JSON row per document: `{page_range, fields{...}, confidence, unreadable:[...]}`. Blocks run in parallel; never one agent for the whole stack.
- For the rebuild's own pipeline (spreadsheets/photos destined for a workflow), prefer the platform gate: `npm run cli -- ocr forms | instruction <form> | admit <file.json> | stack <classified.json> <form>` (D151/D158 — the ONE extraction gate) and the intake surface; hr-scan's job is then to classify and hand over, not to parse by hand.
- Merge rows; **dedupe** people by normalized `last, first middle` (+ DOB-year when present); keep the first page each appears on.

## 3 · Resolve (when asked: "add EIDs", "who are these people")

- Person-lookup via the rebuild workflow (`hr-person-lookup` skill if generated, else hr-manage: run `person-lookup` for each name, parallel workers) — N parallel as the operator said (default 5).
- Outcomes per person: `matched (EID, source)` · `ambiguous (k candidates — listed)` · `not-found` · `blocked (system down / needs <label>)`. Ambiguous and not-found rows go to the operator with their page numbers; never pick a candidate.

## 4 · Emit

- **Spreadsheet** (default when the operator says "spreadsheet"/"list"): `.xlsx`/`.csv` with `last, first middle` as the first column, then EID, then the shape's fields, then `page`, `confidence`, `notes`. Unique entries only. Say the path.
- **Worklist** for hr-manage: one row per subject with the label/EID the workflow's `inputRun` expects.
- **Intake bundle**: a classified JSON the platform's `ocr admit`/`stack` accepts, plus the manifest pointer.
- Always end with: total docs, per-shape counts, people found, matched/ambiguous/not-found, pages you could not read.

## 5 · Remember the shape (every run that met something new or learned a trap)

Append/refresh the entry in `references/document-shapes.md` using its template: recognition cues, page structure, field map (name → where on the page → format), boundaries in a stack, traps, and the date. Commit it with the work. This is what makes the next scan faster — a skill that does not write the shape down has not finished.
