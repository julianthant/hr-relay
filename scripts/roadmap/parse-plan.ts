import type { Layer, Status } from "./schema.js";

/**
 * The plan notation: `docs/rebuild/14-roadmap.md` → the `Roadmap` shape.
 *
 * Side-effect-free on purpose — `parsePlan` is a pure `string → unknown`, so
 * `scripts/generate-roadmap.ts` (which owns the readFile / render / write /
 * `--check` / `--json` entry) and any architecture guard can both import it.
 * Validate the result with `RoadmapSchema` from `./schema.js`.
 *
 *   # Title                      asOf: / head: / eyebrow: / footer: / source: (repeatable) / > lede
 *   tiles:  - Label | value | sub   (a leading "!" marks the hot tile)
 *   <!-- roadmap:start -->
 *   ## Phase title {#id}         phase: / status: / when: primary | secondary / size: / chip: / chip-tone: / open: yes|no
 *   > summary                    builds: - [x] BE text   needs: - id · - you: text · - you(met): text · - fact: text · - fact(met): text
 *   ### Task title {#id}         status: / date: / size: / chip: / chip-tone:     (#### and ##### nest further)
 *   > desc · builds: · needs: · note: text · note!: text · a markdown table whose first cell may start with ! (you) or ✓ (done)
 *   ## flag: when | text         a dated milestone on the spine
 *   ## today: text               the TODAY rule
 *   <!-- roadmap:end -->         everything after is prose and is not rendered
 *
 * Every line inside the region must be one of those shapes — anything else
 * fails loud with its line number.
 */

export const PLAN_SOURCE_PATH = "docs/rebuild/14-roadmap.md";

const BOX_STATUS: Record<string, Status> = { x: "done", " ": "planned", "~": "active", "?": "proposed", "-": "never", "!": "you" };
const LAYER_TOKEN: Record<string, Layer> = { FE: "frontend", BE: "backend", BOTH: "both", WIRE: "wiring", DOCS: "docs", PROOF: "proof" };

const HEADING_RE = /^(#{2,5}) (.*?)(?: \{#([a-z0-9][a-z0-9-]*)\})?\s*$/;

interface RawNode {
  level: number;
  title: string;
  id: string | undefined;
  attrs: Record<string, string>;
  quote: string[];
  features: Record<string, unknown>[];
  requires: Record<string, unknown>[];
  notes: string[];
  table: { columns: string[]; rows: Record<string, unknown>[] } | undefined;
  items: RawNode[];
}

function fail(lineNo: number, message: string): never {
  throw new Error(`${PLAN_SOURCE_PATH}:${String(lineNo)}: ${message}`);
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
  let mode: "attrs" | "body" | "builds" | "needs" | "table" = "body";

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
      const node: RawNode = { level, title, id, attrs: {}, quote: [], features: [], requires: [], notes: [], table: undefined, items: [] };
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
      if (kv !== null && !line.startsWith("note")) { current.attrs[kv[1] ?? ""] = (kv[2] ?? "").trim(); continue; }
      mode = "body";
    }
    if (line === "builds:") { mode = "builds"; continue; }
    if (line === "needs:") { mode = "needs"; continue; }
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
      ...(node.quote.length === 0 ? {} : { desc: node.quote.join(" ") }),
      ...(node.features.length === 0 ? {} : { features: node.features }),
      ...(node.requires.length === 0 ? {} : { requires: node.requires }),
      ...(node.table === undefined ? {} : { table: node.table }),
      ...(node.notes.length === 0 ? {} : { notes: node.notes }),
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
      summary: node.quote.join(" "),
      open: node.attrs.open === "yes",
      ...(node.features.length === 0 ? {} : { features: node.features }),
      ...(node.requires.length === 0 ? {} : { requires: node.requires }),
      items: node.items.map(toItem),
      ...(node.notes.length === 0 ? {} : { notes: node.notes }),
    };
  };
  return {
    meta,
    tiles,
    spine: spine.map((entry) => ("level" in (entry as object) ? toPhase(entry as RawNode) : entry)),
  };
}
