import type { Layer, Status } from "./schema.js";

/**
 * The plan notation: `docs/roadmap/roadmap.md` → the `Roadmap` shape.
 *
 * Side-effect-free on purpose — `parsePlan` is a pure `string → unknown`, so
 * `scripts/generate-roadmap.ts` (which owns the readFile / render / write /
 * `--check` / `--json` entry) and any architecture guard can both import it.
 * Validate the result with `RoadmapSchema` from `./schema.js`.
 *
 *   # Title                      asOf: / head: / eyebrow: / footer: / source: (repeatable) / > lede
 *   tiles:  - Label | value | sub   (a leading "!" marks the hot tile)
 *   <!-- roadmap:start -->
 *   ## Phase title {#id}         phase: / status: / when: primary | secondary / size: / chip: / chip-tone: /
 *                                doc: / open: yes|no
 *   > summary                    builds: - [x] BE text   needs: - id · - you: text · - you(met): text · - fact: text · - fact(met): text
 *   ### Task title {#id}         status: / date: / size: / chip: / chip-tone: / doc:     (#### and ##### nest further)
 *   > desc · builds: · needs: · log: · note: text · note!: text · a markdown table whose first cell may start with ! (you) or ✓ (done)
 *   ## flag: when | text         a ratified milestone on the spine
 *   ## today: text               the TODAY rule
 *   <!-- roadmap:end -->         everything after is prose and is not rendered
 *
 * The three binding/journal shapes, in full:
 *
 *   doc: 3.1 §2.1 · ref:write-safety §5 · 0
 *     An ATTRIBUTE line (so it sits in the attribute block under the heading,
 *     beside `status:`), legal on a phase, a task or a sub-task. Its value is
 *     one or more refs joined by " · " (the split happens only before a doc token, so a section may contain " · "). A ref is `<doc>` or `<doc> §<section>`,
 *     and `<doc>` is one of exactly two things:
 *       · a PHASE doc number — `0`–`6`, decimal parts such as `1.6`, or lettered parts such as `5A`,
 *         the actionable `docs/rebuild/plans/phase-N/<subphase-directory>/README.md` overviews;
 *         append `/task-6-name` (a file stem) to bind one task/topic file inside a subphase;
 *         a bare phase number names `phase-N/README.md`;
 *       · `ref:<slug>` — a spec under `docs/rebuild/reference/`, cited by name
 *         because it is unnumbered: `ref:write-safety`, `ref:decisions`. The
 *         slug is syntactically a kebab-case filename stem; whether that file
 *         EXISTS is the `roadmap-doc-binding` guard's business, not the
 *         parser's, which is the same split as the section below.
 *     A section is anything after " §" that carries no " · " and no edge
 *     whitespace: dotted numbers (`5.4`), a range (`5.4–5.6`), or a heading
 *     NAME (`Phase summary`) — the phase docs number no headings, so naming
 *     one is the only way to cite it. Rendered as a muted
 *     `doc 3.1 §2.1 · ref write-safety §5` line under the drawer title.
 *     Absence is legal HERE — presence is a guard's business.
 *
 *   log:
 *   - YYYY-MM-DD | <session> | <text>
 *     A BLOCK, same grammar shape as `builds:` / `needs:`, legal on any node.
 *     Exactly two " | " separators per line: a real ISO date, a non-empty
 *     session name, and non-empty text (inline markup and D-numbers allowed).
 *     Rendered newest-first as the drawer's last section, "Session log".
 *
 * Every line inside the region must be one of those shapes — anything else
 * fails loud with its line number.
 */

export const PLAN_SOURCE_PATH = "docs/roadmap/roadmap.md";

/** The checklist box vocabulary, shared by `builds:` lines and the docs' `roadmap-status` items. */
export const BOX_STATUS: Record<string, Status> = { x: "done", " ": "planned", "~": "active", "?": "proposed", "-": "never", "!": "you" };
const LAYER_TOKEN: Record<string, Layer> = { FE: "frontend", BE: "backend", BOTH: "both", WIRE: "wiring", DOCS: "docs", PROOF: "proof" };

const HEADING_RE = /^(#{2,5}) (.*?)(?: \{#([a-z0-9][a-z0-9-]*)\})?\s*$/;
/**
 * `<doc>` or `<doc> §<section>` — `<doc>` a phase-doc number (`0`…`3.1`…`6`)
 * or `ref:<slug>` naming a `docs/rebuild/reference/` spec. The section admits
 * spaces because the phase docs number no headings; it may not carry the ` · `
 * that separates refs, and may not have edge whitespace.
 */
const DOC_REF_RE = /^([0-6]|(?:[0-3]\.[1-9]\d*|[4-6][A-Z])(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?|ref:[a-z][a-z0-9-]*)(?: §(\S(?:.*\S)?))?$/;
// Refs are joined by " · "; a section may itself contain " · " (phase-doc headings mirror node titles such as
// "Order 0 · person-lookup"), so the split happens only before a DOC TOKEN, never inside a section.
const DOC_REF_SPLIT_RE = / · (?=(?:[0-6]|(?:[0-3]\.[1-9]\d*|[4-6][A-Z])(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)(?:\s|$)|ref:[a-z])/;

/** Currently admitted phase overviews and subphase docs; the guard requires each file. */
export const PHASE_DOC_NUMBERS = ["0", "0.1", "0.2", "0.3", "1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "2", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "3", "3.1", "3.2", "3.3", "3.4", "3.5", "4", "4A", "5", "5A", "5B", "6", "6A", "6B", "6C", "6D", "6E", "6F"] as const;

/** Canonical path pattern for a validated phase document token. */
export function phaseDocPattern(doc: string): string {
  const [phase = "", leaf] = doc.split("/");
  const file = phase.length === 1 ? "README.md" : `${phase}-*/${leaf ?? "README"}.md`;
  return `docs/rebuild/plans/phase-${phase[0]}/${file}`;
}

interface RawDocRef {
  doc: string;
  kind: "phase" | "reference";
  section?: string;
  raw: string;
}

interface RawLogEntry {
  date: string;
  session: string;
  text: string;
}

interface RawNode {
  level: number;
  title: string;
  id: string | undefined;
  attrs: Record<string, string>;
  docs: RawDocRef[];
  quote: string[];
  features: Record<string, unknown>[];
  requires: Record<string, unknown>[];
  notes: string[];
  log: RawLogEntry[];
  table: { columns: string[]; rows: Record<string, unknown>[] } | undefined;
  items: RawNode[];
}

function fail(lineNo: number, message: string): never {
  throw new Error(`${PLAN_SOURCE_PATH}:${String(lineNo)}: ${message}`);
}

/** `YYYY-MM-DD` AND a real calendar day — `2026-02-31` parses as a date object and is not one. */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function parseDocRefs(value: string, lineNo: number): RawDocRef[] {
  const refs = value.split(DOC_REF_SPLIT_RE).map((ref) => ref.trim());
  return refs.map((raw) => {
    const match = DOC_REF_RE.exec(raw);
    if (match === null) {
      fail(
        lineNo,
        `a doc: ref must be "<doc>" or "<doc> §<section>", refs joined by " · ", where <doc> is a phase doc number (${PHASE_DOC_NUMBERS.join(" ")}) optionally followed by "/<task-or-topic-file-stem>" for a subphase, or "ref:<slug>" naming a docs/rebuild/reference/ spec: "${raw}"`,
      );
    }
    const doc = match[1] ?? "";
    const section = match[2];
    return { doc, kind: doc.startsWith("ref:") ? "reference" : "phase", ...(section === undefined ? {} : { section }), raw };
  });
}

/** One `- YYYY-MM-DD | <session> | <text>` line: exactly two " | " separators, a real date, both halves non-empty. */
function parseDatedEntry(body: string, lineNo: number, what: string, shape: string): RawLogEntry {
  const parts = body.split(" | ");
  if (parts.length !== 3) {
    fail(lineNo, `${what} must carry exactly two " | " separators (${shape}): "${body}"`);
  }
  const date = (parts[0] ?? "").trim();
  const session = (parts[1] ?? "").trim();
  const text = (parts[2] ?? "").trim();
  if (!isRealIsoDate(date)) fail(lineNo, `${what} needs a real ISO date (YYYY-MM-DD) first: "${date}"`);
  if (session.length === 0) fail(lineNo, `${what} needs a non-empty session name between the separators: "${body}"`);
  if (text.length === 0) fail(lineNo, `${what} needs non-empty text after the second separator: "${body}"`);
  return { date, session, text };
}

export function parsePlan(text: string): unknown {
  const lines = text.split("\n");
  const start = lines.indexOf("<!-- roadmap:start -->");
  const end = lines.indexOf("<!-- roadmap:end -->");
  if (start < 0 || end < 0 || end < start) throw new Error(`${PLAN_SOURCE_PATH}: missing <!-- roadmap:start --> / <!-- roadmap:end --> markers`);

  // ── meta ──
  const meta: Record<string, unknown> = {};
  const sources: string[] = [];
  const lede: string[] = [];
  const tiles: Record<string, unknown>[] = [];
  let inTiles = false;
  for (let i = 0; i < start; i++) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0 || line.startsWith("<!--")) { inTiles = false; continue; }
    if (line.startsWith("# ")) { meta.title = line.slice(2).trim(); continue; }
    if (line.startsWith("> ")) { lede.push(line.slice(2).trim()); continue; }
    if (line === "tiles:") { inTiles = true; continue; }
    if (inTiles && line.startsWith("- ")) {
      const parts = line.slice(2).split(" | ").map((p) => p.trim());
      const label = parts[0] ?? "";
      const hot = label.startsWith("!");
      tiles.push({ label: hot ? label.slice(1) : label, value: parts[1] ?? "", ...(parts[2] === undefined ? {} : { sub: parts[2] }), hot });
      continue;
    }
    const kv = /^([a-zA-Z]+): (.*)$/.exec(line);
    if (kv === null) fail(i + 1, `unrecognised line before roadmap:start: "${line}"`);
    const [, key, value] = kv;
    if (key === "source") sources.push(value ?? "");
    else meta[key ?? ""] = value;
  }
  meta.sources = sources;
  meta.lede = lede.join(" ");

  // ── region ──
  const spine: unknown[] = [];
  const stack: RawNode[] = [];
  let current: RawNode | undefined;
  let mode: "attrs" | "body" | "builds" | "needs" | "log" | "table" = "body";

  const finishNode = (): void => {
    // nothing to do eagerly; nodes are attached on creation
  };

  for (let i = start + 1; i < end; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      finishNode();
      const level = (heading[1] ?? "").length;
      const title = (heading[2] ?? "").trim();
      const id = heading[3];
      if (level === 2 && title.startsWith("flag: ")) {
        const [when, ...rest] = title.slice(6).split(" | ");
        if (rest.length === 0) fail(lineNo, "flag needs `when | text`");
        spine.push({ kind: "flag", status: "done", when: (when ?? "").trim(), text: rest.join(" | ").trim() });
        current = undefined;
        stack.length = 0;
        continue;
      }
      if (level === 2 && title.startsWith("today: ")) {
        spine.push({ kind: "today", text: title.slice(7).trim() });
        current = undefined;
        stack.length = 0;
        continue;
      }
      const node: RawNode = { level, title, id, attrs: {}, docs: [], quote: [], features: [], requires: [], notes: [], log: [], table: undefined, items: [] };
      if (level === 2) {
        if (id === undefined) fail(lineNo, `phase "${title}" needs an {#id}`);
        stack.length = 0;
        stack.push(node);
        spine.push(node);
      } else {
        while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
        const parent = stack[stack.length - 1];
        if (parent === undefined || parent.level !== level - 1) fail(lineNo, `"${title}" (level ${String(level)}) has no parent one level up`);
        parent.items.push(node);
        stack.push(node);
      }
      current = node;
      mode = "attrs";
      continue;
    }
    if (current === undefined) {
      if (line.trim().length === 0) continue;
      fail(lineNo, `text outside any node: "${line}"`);
    }
    if (line.trim().length === 0) { if (mode !== "table") mode = "body"; else mode = "body"; continue; }
    if (mode === "attrs") {
      const kv = /^([a-z-]+): (.*)$/.exec(line);
      if (kv !== null && !line.startsWith("note")) {
        const key = kv[1] ?? "";
        const value = (kv[2] ?? "").trim();
        if (key === "doc") {
          if (current.docs.length > 0) fail(lineNo, `node "${current.title}" already carries a doc: line — join refs with " · " on one line`);
          current.docs = parseDocRefs(value, lineNo);
          continue;
        }
        current.attrs[key] = value;
        continue;
      }
      mode = "body";
    }
    if (line === "builds:") { mode = "builds"; continue; }
    if (line === "needs:") { mode = "needs"; continue; }
    if (line === "log:") { mode = "log"; continue; }
    if (mode === "builds") {
      const f = /^- \[(x| |~|\?|-|!)\] (FE|BE|BOTH|WIRE|DOCS|PROOF) (.+)$/.exec(line);
      if (f === null) fail(lineNo, `a builds: line must be "- [x| |~|?|-|!] LAYER text": "${line}"`);
      current.features.push({ text: (f[3] ?? "").trim(), layer: LAYER_TOKEN[f[2] ?? ""], status: BOX_STATUS[f[1] ?? ""] });
      continue;
    }
    if (mode === "needs") {
      const yf = /^- (you|fact)(\(met\))?: (.+)$/.exec(line);
      if (yf !== null) { current.requires.push({ kind: yf[1], text: (yf[3] ?? "").trim(), met: yf[2] !== undefined }); continue; }
      const ref = /^- ([a-z0-9][a-z0-9-]*)$/.exec(line);
      if (ref === null) fail(lineNo, `a needs: line must be "- <id>", "- you: text", "- you(met): text", "- fact: text" or "- fact(met): text": "${line}"`);
      current.requires.push({ kind: "node", ref: ref[1] });
      continue;
    }
    if (mode === "log") {
      const entry = /^- (.+)$/.exec(line);
      if (entry === null) fail(lineNo, `a log: line must be "- YYYY-MM-DD | <session> | <text>": "${line}"`);
      current.log.push(parseDatedEntry((entry[1] ?? "").trim(), lineNo, "a log: line", '"- YYYY-MM-DD | <session> | <text>"'));
      continue;
    }
    if (line.startsWith("> ")) { current.quote.push(line.slice(2).trim()); continue; }
    if (line.startsWith("note!: ")) { current.notes.push(`!${line.slice(7).trim()}`); continue; }
    if (line.startsWith("note: ")) { current.notes.push(line.slice(6).trim()); continue; }
    if (line.startsWith("|")) {
      const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
      if (current.table === undefined) { current.table = { columns: cells, rows: [] }; mode = "table"; continue; }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const first = cells[0] ?? "";
      const tone = first.startsWith("!") ? "you" : first.startsWith("✓") ? "done" : undefined;
      const stripped = tone === undefined ? cells : [first.slice(1), ...cells.slice(1)];
      current.table.rows.push({ cells: stripped, ...(tone === undefined ? {} : { tone }) });
      continue;
    }
    fail(lineNo, `unrecognised line inside node "${current.title}": "${line}"`);
  }
  finishNode();

  const chipOf = (attrs: Record<string, string>): Record<string, unknown> | undefined =>
    attrs.chip === undefined ? undefined : { text: attrs.chip, ...(attrs["chip-tone"] === undefined ? {} : { tone: attrs["chip-tone"] }) };
  const toItem = (node: RawNode): Record<string, unknown> => {
    const chip = chipOf(node.attrs);
    return {
      ...(node.id === undefined ? {} : { id: node.id }),
      status: node.attrs.status,
      title: node.title,
      ...(node.attrs.date === undefined ? {} : { date: node.attrs.date }),
      ...(chip === undefined ? {} : { chip }),
      ...(node.attrs.size === undefined ? {} : { size: node.attrs.size }),
      ...(node.docs.length === 0 ? {} : { docs: node.docs }),
      ...(node.quote.length === 0 ? {} : { desc: node.quote.join(" ") }),
      ...(node.features.length === 0 ? {} : { features: node.features }),
      ...(node.requires.length === 0 ? {} : { requires: node.requires }),
      ...(node.table === undefined ? {} : { table: node.table }),
      ...(node.notes.length === 0 ? {} : { notes: node.notes }),
      ...(node.log.length === 0 ? {} : { log: node.log }),
      ...(node.items.length === 0 ? {} : { items: node.items.map(toItem) }),
    };
  };
  const toPhase = (node: RawNode): Record<string, unknown> => {
    const chip = chipOf(node.attrs);
    const [primary, ...secondary] = (node.attrs.when ?? "").split(" | ");
    return {
      kind: "phase",
      id: node.id,
      status: node.attrs.status,
      when: { primary: (primary ?? "").trim(), ...(secondary.length === 0 ? {} : { secondary: secondary.join(" | ").trim() }) },
      phase: node.attrs.phase,
      title: node.title,
      ...(chip === undefined ? {} : { chip }),
      ...(node.attrs.size === undefined ? {} : { size: node.attrs.size }),
      ...(node.docs.length === 0 ? {} : { docs: node.docs }),
      summary: node.quote.join(" "),
      open: node.attrs.open === "yes",
      ...(node.features.length === 0 ? {} : { features: node.features }),
      ...(node.requires.length === 0 ? {} : { requires: node.requires }),
      items: node.items.map(toItem),
      ...(node.notes.length === 0 ? {} : { notes: node.notes }),
      ...(node.log.length === 0 ? {} : { log: node.log }),
    };
  };
  return {
    meta,
    tiles,
    spine: spine.map((entry) => ("level" in (entry as object) ? toPhase(entry as RawNode) : entry)),
  };
}
