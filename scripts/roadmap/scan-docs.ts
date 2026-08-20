import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { BOX_STATUS, PLAN_SOURCE_PATH, isRealIsoDate } from "./parse-plan.js";
import {
  DocBindingsSchema,
  type DocBindings,
  type DocHeading,
  type DocStatusBlock,
  type DocStatusItem,
  type DocTag,
  type Item,
  type LogEntry,
  type Roadmap,
} from "./schema.js";

/**
 * The doc side of the plan ↔ docs binding (D263, plan R7): every
 * `<!-- roadmap: <id> -->` tag and every `<!-- roadmap-status: <id> -->` block
 * the rebuild docs carry, keyed by the plan node they name.
 *
 * `parseDocBindings` is a pure `(path, text) → DocBindings`; `scanDocs` is the
 * one entry that touches the filesystem (`readdir` + `readFile`, nothing else).
 * The scan is PATH-AGNOSTIC on purpose — it walks `docs/rebuild/**` recursively
 * (skipping the superseded-history folders named in `DOC_SCAN_SKIP_DIRS`) plus
 * `docs/migrations/**`, so renaming, renumbering or re-foldering a doc changes
 * nothing here. No filename is hardcoded, and the plan source is not read from
 * this module at all.
 *
 * The two shapes, in full:
 *
 *   <!-- roadmap: <id> -->
 *     A TAG: "the section above this line describes plan node <id>". It must be
 *     the whole line and it must sit under a heading — the nearest heading
 *     ABOVE it is the section the drawer names, with its number when the
 *     heading starts with one (`## 3.1 Foo` → §3.1). The plan file's own region
 *     markers `<!-- roadmap:start -->` / `<!-- roadmap:end -->` are NOT tags and
 *     are skipped: a tag always has a space after the colon, a marker never
 *     does.
 *
 *   <!-- roadmap-status: <id> -->
 *   - [x| |~|?|-|!] text
 *   > YYYY-MM-DD | session | text
 *   <!-- /roadmap-status -->
 *     A STATUS BLOCK: the doc section's own checklist for that node, plus dated
 *     append-only notes. Boxes are the `builds:` vocabulary (`BOX_STATUS`) with
 *     NO layer tag — these are the doc's items, not the plan's. Blank lines are
 *     allowed; ANY other non-blank line fails loud with its line number, as do
 *     an unclosed block, a close with no open, and a second block for one id in
 *     one file. An EMPTY block (open, close, nothing between) is LEGAL and means
 *     "this section has not been assessed yet" — which the drawer says in those
 *     words, because a silent absence and a deliberate "not yet" are different
 *     facts.
 *
 * Lines inside a fenced code block are examples, not tags, and are skipped —
 * that is what a fence means in markdown.
 *
 * `bindDocsToPlan` is the join: it refuses any tag or block naming an id the
 * plan does not declare, and returns the per-node index the generator renders.
 */

/** Scanned recursively, relative to the repo root. A missing directory fails loud. */
export const DOC_SCAN_DIRS = ["docs/rebuild", "docs/migrations"] as const;
/**
 * Skipped by DIRECTORY NAME at any depth: superseded narrative describes what a
 * doc USED to say, so a tag inside it would bind the wrong section to a node.
 * Two names because the folder is mid-rename — matching the name rather than a
 * path means neither spelling can slip through.
 */
export const DOC_SCAN_SKIP_DIRS: readonly string[] = ["reviews", "history"];

const TAG_RE = /^<!--\s+roadmap:\s+([a-z0-9][a-z0-9-]*)\s+-->$/;
const STATUS_OPEN_RE = /^<!--\s+roadmap-status:\s+([a-z0-9][a-z0-9-]*)\s+-->$/;
const STATUS_CLOSE_RE = /^<!--\s+\/roadmap-status\s+-->$/;
/** The plan file's own region markers — a colon with no space after it. Skipped, never bound. */
const REGION_MARKER_RE = /^<!--\s+roadmap:(?:start|end)\s+-->$/;
/** A comment whose first token is one of ours: it must be one of the four shapes above or it is a typo, not prose. */
const NEAR_MISS_RE = /^<!--\s*\/?roadmap(?:-status)?\b/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
/** `3.1 Foo` → `3.1`; `0. Foo` → `0.`; `13 — Foo` is a title, not a numbered section. */
const SECTION_RE = /^(\d+(?:\.\d+)+|\d+\.)\s+(.*)$/;
const FENCE_RE = /^(?:```|~~~)/;
const STATUS_ITEM_RE = /^- \[(x| |~|\?|-|!)\] (.+)$/;
const NOTE_RE = /^> (.+)$/;

interface OpenBlock {
  id: string;
  line: number;
  heading: DocHeading;
  items: DocStatusItem[];
  notes: LogEntry[];
}

function splitHeading(text: string): DocHeading {
  const numbered = SECTION_RE.exec(text);
  if (numbered === null) return { text };
  const section = (numbered[1] ?? "").replace(/\.$/, "");
  const rest = (numbered[2] ?? "").trim();
  return rest.length === 0 ? { text, section } : { text: rest, section };
}

/**
 * One markdown file's tags and status blocks. Pure: `doc` is only the
 * repo-relative path stamped onto every entry and printed in every refusal.
 */
export function parseDocBindings(doc: string, text: string): DocBindings {
  // annotated on the DECLARATION, not just the arrow: that is what makes the
  // compiler treat a `fail(...)` call as terminating control flow
  const fail: (lineNo: number, message: string) => never = (lineNo, message) => {
    throw new Error(`${doc}:${String(lineNo)}: ${message}`);
  };
  const lines = text.split("\n");
  const tags: DocTag[] = [];
  const statuses: DocStatusBlock[] = [];
  const blockIds = new Map<string, number>();
  let heading: DocHeading | undefined;
  let fenced = false;
  let open: OpenBlock | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const lineNo = i + 1;

    if (fenced) {
      if (FENCE_RE.test(line)) fenced = false;
      continue;
    }

    if (open !== undefined) {
      if (STATUS_CLOSE_RE.test(line)) {
        statuses.push({ id: open.id, doc, heading: open.heading, line: open.line, items: open.items, notes: open.notes });
        open = undefined;
        continue;
      }
      if (line.length === 0) continue;
      const item = STATUS_ITEM_RE.exec(line);
      if (item !== null) {
        const boxChar = item[1] ?? "";
        const box = BOX_STATUS[boxChar];
        if (box === undefined) fail(lineNo, `unknown status box "${boxChar}"`);
        open.items.push({ box, text: (item[2] ?? "").trim() });
        continue;
      }
      const note = NOTE_RE.exec(line);
      if (note !== null) {
        open.notes.push(parseNote((note[1] ?? "").trim(), lineNo, fail));
        continue;
      }
      return fail(
        lineNo,
        `inside the roadmap-status block opened for "${open.id}" at line ${String(open.line)} only "- [x| |~|?|-|!] text" items, "> YYYY-MM-DD | session | text" notes and blank lines are allowed — close the block first: "${line}"`,
      );
    }

    if (FENCE_RE.test(line)) {
      fenced = true;
      continue;
    }
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch !== null) {
      heading = splitHeading((headingMatch[2] ?? "").trim());
      continue;
    }
    if (REGION_MARKER_RE.test(line)) continue;
    const tag = TAG_RE.exec(line);
    if (tag !== null) {
      if (heading === undefined) fail(lineNo, `a <!-- roadmap: ${tag[1] ?? ""} --> tag must sit under a heading — it names that section`);
      tags.push({ id: tag[1] ?? "", doc, heading, line: lineNo });
      continue;
    }
    const opening = STATUS_OPEN_RE.exec(line);
    if (opening !== null) {
      const id = opening[1] ?? "";
      if (heading === undefined) fail(lineNo, `a <!-- roadmap-status: ${id} --> block must sit under a heading — it is that section's checklist`);
      const first = blockIds.get(id);
      if (first !== undefined) fail(lineNo, `a second roadmap-status block for "${id}" — one block per node per doc; the first is at line ${String(first)}`);
      blockIds.set(id, lineNo);
      open = { id, line: lineNo, heading, items: [], notes: [] };
      continue;
    }
    if (STATUS_CLOSE_RE.test(line)) fail(lineNo, "<!-- /roadmap-status --> closes a block that was never opened");
    if (NEAR_MISS_RE.test(line)) {
      fail(
        lineNo,
        `unrecognised roadmap comment — the legal shapes are "<!-- roadmap: <id> -->", "<!-- roadmap-status: <id> -->" and "<!-- /roadmap-status -->": "${line}"`,
      );
    }
  }
  if (open !== undefined) {
    fail(open.line, `the roadmap-status block for "${open.id}" is never closed — add "<!-- /roadmap-status -->"`);
  }
  return DocBindingsSchema.parse({ tags, statuses });
}

/** `YYYY-MM-DD | session | text`, exactly two separators — the same shape a `log:` line carries. */
function parseNote(body: string, lineNo: number, fail: (lineNo: number, message: string) => never): LogEntry {
  const parts = body.split(" | ");
  if (parts.length !== 3) {
    fail(lineNo, `a status note must carry exactly two " | " separators ("> YYYY-MM-DD | session | text"): "${body}"`);
  }
  const date = (parts[0] ?? "").trim();
  const session = (parts[1] ?? "").trim();
  const text = (parts[2] ?? "").trim();
  if (!isRealIsoDate(date)) fail(lineNo, `a status note needs a real ISO date (YYYY-MM-DD) first: "${date}"`);
  if (session.length === 0) fail(lineNo, `a status note needs a non-empty session name between the separators: "${body}"`);
  if (text.length === 0) fail(lineNo, `a status note needs non-empty text after the second separator: "${body}"`);
  return { date, session, text };
}

async function collectMarkdown(dir: string, into: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (DOC_SCAN_SKIP_DIRS.includes(entry.name)) continue;
      await collectMarkdown(join(dir, entry.name), into);
      continue;
    }
    if (entry.name.endsWith(".md")) into.push(join(dir, entry.name));
  }
}

/**
 * Every tag and status block under `DOC_SCAN_DIRS`, in sorted path order so the
 * rendered page is a pure function of the tree's bytes. The only I/O in this
 * module; a missing scan directory throws rather than scanning nothing.
 */
export async function scanDocs(rootDir: string): Promise<DocBindings> {
  const files: string[] = [];
  for (const dir of DOC_SCAN_DIRS) await collectMarkdown(join(rootDir, dir), files);
  files.sort();
  const tags: DocTag[] = [];
  const statuses: DocStatusBlock[] = [];
  for (const file of files) {
    const doc = relative(rootDir, file).split(sep).join("/");
    const parsed = parseDocBindings(doc, await readFile(file, "utf8"));
    tags.push(...parsed.tags);
    statuses.push(...parsed.statuses);
  }
  return { tags, statuses };
}

/** What one plan node's docs say about it: which sections name it, and their checklists. */
export interface NodeDocBinding {
  tags: DocTag[];
  statuses: DocStatusBlock[];
}

/** Node id → its doc binding. Only ids the plan declares appear; the rest is a refusal. */
export type DocBindingIndex = ReadonlyMap<string, NodeDocBinding>;

function planNodeIds(roadmap: Roadmap): Set<string> {
  const ids = new Set<string>();
  const walk = (items: Item[]): void => {
    for (const item of items) {
      if (item.id !== undefined) ids.add(item.id);
      if (item.items) walk(item.items);
    }
  };
  for (const node of roadmap.spine) {
    if (node.kind !== "phase") continue;
    ids.add(node.id);
    walk(node.items);
  }
  return ids;
}

/**
 * The join, and the half of the two-way binding this module owns: a tag or a
 * status block naming an id the plan does not declare is a dangling reference,
 * so it throws with the doc, the line and the id. (The other half — a node no
 * doc describes — belongs to the `roadmap-doc-binding` guard, which can see the
 * whole plan; a generator that refused it could not render a growing tree.)
 */
export function bindDocsToPlan(roadmap: Roadmap, bindings: DocBindings): DocBindingIndex {
  const ids = planNodeIds(roadmap);
  const index = new Map<string, NodeDocBinding>();
  const entryFor = (id: string): NodeDocBinding => {
    const existing = index.get(id);
    if (existing !== undefined) return existing;
    const fresh: NodeDocBinding = { tags: [], statuses: [] };
    index.set(id, fresh);
    return fresh;
  };
  for (const tag of bindings.tags) {
    if (!ids.has(tag.id)) {
      throw new Error(`${tag.doc}:${String(tag.line)}: <!-- roadmap: ${tag.id} --> names no node in ${PLAN_SOURCE_PATH}`);
    }
    entryFor(tag.id).tags.push(tag);
  }
  for (const block of bindings.statuses) {
    if (!ids.has(block.id)) {
      throw new Error(`${block.doc}:${String(block.line)}: <!-- roadmap-status: ${block.id} --> names no node in ${PLAN_SOURCE_PATH}`);
    }
    entryFor(block.id).statuses.push(block);
  }
  return index;
}
