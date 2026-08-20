import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

/**
 * `npm run roadmap` — render `docs/roadmap/index.html` from the ONE structured
 * roadmap source, `docs/roadmap/roadmap.json`.
 *
 * The JSON is the website's single source of truth: the timeline (phases →
 * tracks → chunks), what every node BUILDS (`features`), and what every node
 * REQUIRES (`requires`) — from which this script derives each node's
 * "unlocks" list and the dependency tree. `ROADMAP.md` and
 * `docs/rebuild/07-master-plan.md` stay the prose authorities; the
 * `/custom-update-plan` skill edits all three together.
 *
 *   npm run roadmap            # regenerate docs/roadmap/index.html
 *   npm run roadmap -- --check # fail if the committed html is stale
 */

// ─── schema ────────────────────────────────────────────────────────────────

const StatusSchema = z.enum(["done", "active", "you", "planned", "proposed", "never"]);
type Status = z.infer<typeof StatusSchema>;

const ChipSchema = z.object({ text: z.string().min(1), tone: StatusSchema.optional() }).strict();

const RequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), ref: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("you"), text: z.string().min(1), met: z.boolean() }).strict(),
  z.object({ kind: z.literal("fact"), text: z.string().min(1), met: z.boolean() }).strict(),
]);
type Requirement = z.infer<typeof RequirementSchema>;

const LayerSchema = z.enum(["frontend", "backend", "both", "wiring", "docs", "proof"]);
type Layer = z.infer<typeof LayerSchema>;

/**
 * A feature is what a node BUILDS. The layer says WHERE it lives so a gap on a
 * surface can be read as "not built yet" versus "built, and sloppy": `frontend`
 * is React only, `backend` is the BFF/kernel only, `both` is a vertical slice,
 * `wiring` is the connection between two halves that already exist. `docs` and
 * `proof` (a live run, a measurement) are the non-code kinds. A feature's own
 * status defaults to its node's, so a node can be active while three of its
 * five features are already done.
 */
const FeatureSchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), layer: LayerSchema, status: StatusSchema.optional() }).strict(),
]);
type Feature = z.infer<typeof FeatureSchema>;

const TableSchema = z
  .object({
    columns: z.array(z.string().min(1)).min(1),
    rows: z.array(
      z.object({ cells: z.array(z.string()).min(1), tone: z.enum(["you", "done"]).optional() }).strict(),
    ),
  })
  .strict();

interface Item {
  id?: string;
  status: Status;
  title: string;
  date?: string;
  chip?: z.infer<typeof ChipSchema>;
  size?: "S" | "M" | "L" | "XL";
  desc?: string;
  features?: Feature[];
  requires?: Requirement[];
  table?: z.infer<typeof TableSchema>;
  notes?: string[];
  items?: Item[];
}

const ItemSchema: z.ZodType<Item> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
      status: StatusSchema,
      title: z.string().min(1),
      date: z.string().optional(),
      chip: ChipSchema.optional(),
      size: z.enum(["S", "M", "L", "XL"]).optional(),
      desc: z.string().optional(),
      features: z.array(FeatureSchema).optional(),
      requires: z.array(RequirementSchema).optional(),
      table: TableSchema.optional(),
      notes: z.array(z.string().min(1)).optional(),
      items: z.array(ItemSchema).optional(),
    })
    .strict(),
);

const WhenSchema = z.object({ primary: z.string().min(1), secondary: z.string().optional() }).strict();

const PhaseNodeSchema = z
  .object({
    kind: z.literal("phase"),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    status: StatusSchema,
    when: WhenSchema,
    phase: z.string().min(1),
    title: z.string().min(1),
    chip: ChipSchema.optional(),
    size: z.enum(["S", "M", "L", "XL"]).optional(),
    summary: z.string().min(1),
    open: z.boolean(),
    features: z.array(FeatureSchema).optional(),
    requires: z.array(RequirementSchema).optional(),
    items: z.array(ItemSchema),
    notes: z.array(z.string().min(1)).optional(),
  })
  .strict();
type PhaseNode = z.infer<typeof PhaseNodeSchema>;

const FlagNodeSchema = z
  .object({ kind: z.literal("flag"), status: StatusSchema, when: z.string().min(1), text: z.string().min(1) })
  .strict();

const TodayNodeSchema = z.object({ kind: z.literal("today"), text: z.string().min(1) }).strict();

const RoadmapSchema = z
  .object({
    meta: z
      .object({
        title: z.string().min(1),
        asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        head: z.string().min(1),
        eyebrow: z.string().min(1),
        lede: z.string().min(1),
        sources: z.array(z.string().min(1)).min(1),
        footer: z.string().min(1),
      })
      .strict(),
    tiles: z.array(
      z.object({ label: z.string().min(1), value: z.string().min(1), sub: z.string().optional(), hot: z.boolean() }).strict(),
    ),
    spine: z.array(z.discriminatedUnion("kind", [PhaseNodeSchema, FlagNodeSchema, TodayNodeSchema])),
  })
  .strict();
type Roadmap = z.infer<typeof RoadmapSchema>;

// ─── inline markup: escape first, then `code`, **bold**, auto D-numbers ────

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(text: string): string {
  const codes: string[] = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${String(codes.length - 1)}\uE000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/\b(D\d{1,3}(?:\s?[–/-]\s?D?\d{1,3})*[a-z]?)\b/g, '<span class="dec">$1</span>');
  out = out.replace(/\uE000(\d+)\uE000/g, (_m, index: string) => {
    const code = codes[Number(index)];
    if (code === undefined) throw new Error(`inline(): code placeholder ${index} has no slot`);
    return code;
  });
  return out;
}

// ─── the registry: every id, its status, title and anchor; plus reverse edges ─

interface Registered {
  id: string;
  title: string;
  status: Status;
  requires: Requirement[];
  unlocks: string[];
  order: number;
}

function collectRegistry(roadmap: Roadmap): Map<string, Registered> {
  const registry = new Map<string, Registered>();
  let order = 0;
  const add = (id: string | undefined, title: string, status: Status, requires: Requirement[] | undefined): void => {
    if (id === undefined) return;
    if (registry.has(id)) throw new Error(`roadmap.json: duplicate id "${id}"`);
    registry.set(id, { id, title, status, requires: requires ?? [], unlocks: [], order: order++ });
  };
  const walk = (items: Item[]): void => {
    for (const item of items) {
      add(item.id, item.title, item.status, item.requires);
      if (item.items) walk(item.items);
    }
  };
  for (const node of roadmap.spine) {
    if (node.kind !== "phase") continue;
    add(node.id, node.title, node.status, node.requires);
    walk(node.items);
  }
  for (const entry of registry.values()) {
    for (const requirement of entry.requires) {
      if (requirement.kind !== "node") continue;
      const target = registry.get(requirement.ref);
      if (target === undefined) {
        throw new Error(`roadmap.json: "${entry.id}" requires unknown id "${requirement.ref}"`);
      }
      target.unlocks.push(entry.id);
    }
  }
  return registry;
}

function requirementMet(requirement: Requirement, registry: Map<string, Registered>): boolean {
  if (requirement.kind === "node") {
    const target = registry.get(requirement.ref);
    return target !== undefined && target.status === "done";
  }
  return requirement.met;
}

// ─── html rendering ────────────────────────────────────────────────────────

function renderChip(chip: z.infer<typeof ChipSchema> | undefined, fallback: Status): string {
  if (chip === undefined) return "";
  return `<span class="chip ${chip.tone ?? fallback}">${inline(chip.text)}</span>`;
}

function renderSize(size: Item["size"]): string {
  return size === undefined ? "" : `<span class="size">${size}</span>`;
}

function renderRequires(requires: Requirement[] | undefined, registry: Map<string, Registered>): string {
  if (requires === undefined || requires.length === 0) return "";
  const chips = requires.map((requirement) => {
    const met = requirementMet(requirement, registry);
    if (requirement.kind === "node") {
      const target = registry.get(requirement.ref);
      const title = target === undefined ? requirement.ref : target.title;
      return `<a class="req ${met ? "met" : "open"}" href="#${requirement.ref}"><i>${met ? "✓" : "○"}</i>${inline(title)}</a>`;
    }
    const cls = requirement.kind === "you" ? (met ? "met" : "you") : met ? "met" : "open";
    const glyph = requirement.kind === "you" ? (met ? "✓" : "!") : met ? "✓" : "○";
    return `<span class="req ${cls}"><i>${glyph}</i>${requirement.kind === "you" ? "<em>you:</em> " : ""}${inline(requirement.text)}</span>`;
  });
  return `<div class="deps"><span class="dl">Needs</span>${chips.join("")}</div>`;
}

function renderUnlocks(id: string | undefined, registry: Map<string, Registered>): string {
  if (id === undefined) return "";
  const entry = registry.get(id);
  if (entry === undefined || entry.unlocks.length === 0) return "";
  const chips = entry.unlocks.map((target) => {
    const t = registry.get(target);
    return `<a class="req unl" href="#${target}"><i>→</i>${inline(t?.title ?? target)}</a>`;
  });
  return `<div class="deps"><span class="dl">Unlocks</span>${chips.join("")}</div>`;
}

const LAYER_LABEL: Record<Layer, string> = {
  frontend: "FE",
  backend: "BE",
  both: "BOTH",
  wiring: "WIRE",
  docs: "DOCS",
  proof: "PROOF",
};

function renderFeatures(features: Feature[] | undefined, status: Status): string {
  if (features === undefined || features.length === 0) return "";
  const resolved = features.map((f) => (typeof f === "string" ? { text: f, layer: undefined, status } : { ...f, status: f.status ?? status }));
  const built = resolved.filter((f) => f.status === "done").length;
  const rollup = status === "done" ? "" : ` <span class="cnt">${String(built)}/${String(resolved.length)} built</span>`;
  const label = status === "done" ? "Built" : status === "never" ? "Would build" : "Builds";
  const items = resolved
    .map((f) => {
      const layer = f.layer === undefined ? "" : `<span class="lay ${f.layer}">${LAYER_LABEL[f.layer]}</span>`;
      return `<li class="${f.status}"><i class="fm ${f.status}"></i>${layer}${inline(f.text)}</li>`;
    })
    .join("");
  return `<div class="feat"><span class="dl">${label}${rollup}</span><ul>${items}</ul></div>`;
}

function renderTable(table: z.infer<typeof TableSchema> | undefined): string {
  if (table === undefined) return "";
  const head = table.columns.map((c) => `<th>${inline(c)}</th>`).join("");
  const rows = table.rows
    .map((row) => {
      const cls = row.tone === "you" ? ' class="y"' : row.tone === "done" ? ' class="g"' : "";
      return `<tr${cls}>${row.cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderNotes(notes: string[] | undefined): string {
  if (notes === undefined) return "";
  return notes.map((n) => `<p class="note${n.startsWith("!") ? " you" : ""}">${inline(n.replace(/^!/, ""))}</p>`).join("");
}

function renderItem(item: Item, registry: Map<string, Registered>): string {
  const anchor = item.id === undefined ? "" : ` id="${item.id}"`;
  const cls = item.status === "you" ? ' class="leaf-you"' : "";
  const date = item.date === undefined ? "" : `<span class="d">${inline(item.date)}</span>`;
  const children = item.items === undefined || item.items.length === 0
    ? ""
    : `<ul>${item.items.map((child) => renderItem(child, registry)).join("")}</ul>`;
  return `<li${anchor}${cls}>
<div class="row"><i class="mark ${item.status}"></i><span class="n">${inline(item.title)}</span>${date}${renderChip(item.chip, item.status)}${renderSize(item.size)}</div>
${item.desc === undefined ? "" : `<p class="desc">${inline(item.desc)}</p>`}
${renderFeatures(item.features, item.status)}
${renderRequires(item.requires, registry)}
${renderUnlocks(item.id, registry)}
${renderTable(item.table)}
${renderNotes(item.notes)}
${children}
</li>`;
}

function renderPhase(node: PhaseNode, registry: Map<string, Registered>): string {
  const when = `<div class="when"><b>${inline(node.when.primary)}</b>${node.when.secondary === undefined ? "" : inline(node.when.secondary)}</div>`;
  return `<article class="node ${node.status}" id="${node.id}">
${when}
<span class="dot" aria-hidden="true"></span>
<details class="card"${node.open ? " open" : ""}>
<summary>
<div class="ttl"><span class="ph">${inline(node.phase)}</span> ${inline(node.title)} ${renderChip(node.chip, node.status)} ${renderSize(node.size)}</div>
<span class="chev">▶</span>
<div class="sub">${inline(node.summary)}</div>
</summary>
<div class="body">
${renderFeatures(node.features, node.status)}
${renderRequires(node.requires, registry)}
${renderUnlocks(node.id, registry)}
<ul class="tree">${node.items.map((item) => renderItem(item, registry)).join("")}</ul>
${renderNotes(node.notes)}
</div>
</details>
</article>`;
}

// ─── the dependency tree (talent-tree view), laid out in columns by depth ──

interface GraphNode {
  key: string;
  title: string;
  status: Status;
  shape: "box" | "you";
  depth: number;
  row: number;
  href: string | undefined;
  available: boolean;
}

function layoutGraph(registry: Map<string, Registered>): { nodes: GraphNode[]; edges: [string, string][] } {
  const participating = new Set<string>();
  for (const entry of registry.values()) {
    if (entry.requires.length > 0 || entry.unlocks.length > 0) participating.add(entry.id);
  }
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string, trail: string[]): number => {
    const memo = depthMemo.get(id);
    if (memo !== undefined) return memo;
    if (trail.includes(id)) throw new Error(`roadmap.json: dependency cycle ${[...trail, id].join(" → ")}`);
    const entry = registry.get(id);
    if (entry === undefined) throw new Error(`roadmap.json: unknown id "${id}"`);
    let depth = 0;
    for (const requirement of entry.requires) {
      if (requirement.kind === "node") depth = Math.max(depth, depthOf(requirement.ref, [...trail, id]) + 1);
      else depth = Math.max(depth, 1);
    }
    depthMemo.set(id, depth);
    return depth;
  };
  const nodes: GraphNode[] = [];
  const edges: [string, string][] = [];
  const ordered = [...registry.values()].filter((e) => participating.has(e.id)).sort((a, b) => a.order - b.order);
  for (const entry of ordered) {
    const depth = depthOf(entry.id, []);
    const available = entry.requires.every((r) => requirementMet(r, registry));
    nodes.push({ key: entry.id, title: entry.title, status: entry.status, shape: "box", depth, row: 0, href: `#${entry.id}`, available });
    entry.requires.forEach((requirement, index) => {
      if (requirement.kind === "node") {
        edges.push([requirement.ref, entry.id]);
        return;
      }
      const key = `${entry.id}__req${String(index)}`;
      nodes.push({
        key,
        title: requirement.text,
        status: requirement.met ? "done" : requirement.kind === "you" ? "you" : "planned",
        shape: requirement.kind === "you" ? "you" : "box",
        depth: Math.max(0, depth - 1),
        row: 0,
        href: `#${entry.id}`,
        available: requirement.met,
      });
      edges.push([key, entry.id]);
    });
  }
  // Rows: a three-sweep barycenter ordering (left→right on predecessors,
  // right→left on successors, left→right again) keeps an edge short and a
  // prerequisite beside the thing it unlocks, instead of document order.
  const byKey = new Map(nodes.map((n) => [n.key, n] as const));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const [from, to] of edges) {
    preds.set(to, [...(preds.get(to) ?? []), from]);
    succs.set(from, [...(succs.get(from) ?? []), to]);
  }
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) columns.set(node.depth, [...(columns.get(node.depth) ?? []), node]);
  const assignRows = (column: GraphNode[]): void => column.forEach((node, index) => { node.row = index; });
  for (const column of columns.values()) assignRows(column);
  const barycenter = (node: GraphNode, neighbours: Map<string, string[]>): number | undefined => {
    const rows = (neighbours.get(node.key) ?? []).map((k) => byKey.get(k)?.row).filter((r): r is number => r !== undefined);
    return rows.length === 0 ? undefined : rows.reduce((a, b) => a + b, 0) / rows.length;
  };
  const sweep = (depths: number[], neighbours: Map<string, string[]>): void => {
    for (const depth of depths) {
      const column = columns.get(depth);
      if (column === undefined) continue;
      const keyed = column.map((node, index) => ({ node, bary: barycenter(node, neighbours) ?? node.row, index }));
      keyed.sort((a, b) => a.bary - b.bary || a.index - b.index);
      assignRows(keyed.map((k) => k.node));
    }
  };
  const ascending = Array.from({ length: maxDepth + 1 }, (_v, i) => i);
  sweep(ascending, preds);
  sweep([...ascending].reverse(), succs);
  sweep(ascending, preds);
  return { nodes, edges };
}

function wrapTitle(title: string, width: number): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > width && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length > 2) {
    const tail = lines.slice(1).join(" ");
    return [lines[0] ?? "", `${tail.slice(0, width - 1)}…`];
  }
  return lines;
}

function renderGraph(registry: Map<string, Registered>): string {
  const { nodes, edges } = layoutGraph(registry);
  if (nodes.length === 0) return "";
  const colW = 236;
  const rowH = 74;
  const boxW = 196;
  const boxH = 50;
  const padX = 20;
  const padY = 16;
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const maxRows = Math.max(...nodes.map((n) => n.row)) + 1;
  const width = padX * 2 + (maxDepth + 1) * colW - (colW - boxW);
  const height = padY * 2 + maxRows * rowH - (rowH - boxH);
  const position = (node: GraphNode): { x: number; y: number } => ({
    x: padX + node.depth * colW,
    y: padY + node.row * rowH,
  });
  const byKey = new Map(nodes.map((n) => [n.key, n] as const));
  const edgeSvg = edges
    .map(([from, to]) => {
      const a = byKey.get(from);
      const b = byKey.get(to);
      if (a === undefined || b === undefined) return "";
      const pa = position(a);
      const pb = position(b);
      const x1 = pa.x + boxW;
      const y1 = pa.y + boxH / 2;
      const x2 = pb.x;
      const y2 = pb.y + boxH / 2;
      const dx = Math.max(24, (x2 - x1) / 2);
      const met = a.status === "done";
      return `<path class="edge ${met ? "met" : "open"}" d="M${String(x1)},${String(y1)} C${String(x1 + dx)},${String(y1)} ${String(x2 - dx)},${String(y2)} ${String(x2)},${String(y2)}"/>`;
    })
    .join("");
  const nodeSvg = nodes
    .map((node) => {
      const { x, y } = position(node);
      const lines = wrapTitle(node.title, node.shape === "you" ? 22 : 26);
      const text = lines
        .map((line, i) => `<tspan x="${String(x + 14)}" dy="${i === 0 ? (lines.length === 1 ? "0.35em" : "-0.25em") : "1.2em"}">${escapeHtml(line)}</tspan>`)
        .join("");
      const cls = `gn ${node.status} ${node.shape}${node.available ? " avail" : " locked"}`;
      const shape = node.shape === "you"
        ? `<rect x="${String(x)}" y="${String(y)}" width="${String(boxW)}" height="${String(boxH)}" rx="25"/>`
        : `<rect x="${String(x)}" y="${String(y)}" width="${String(boxW)}" height="${String(boxH)}" rx="8"/>`;
      const badge = node.shape === "you" ? `<text class="gb" x="${String(x + boxW - 12)}" y="${String(y + boxH / 2)}" text-anchor="end" dy="0.35em">YOU</text>` : "";
      const inner = `<g class="${cls}">${shape}<text x="${String(x + 14)}" y="${String(y + boxH / 2)}">${text}</text>${badge}</g>`;
      return node.href === undefined ? inner : `<a href="${node.href}">${inner}</a>`;
    })
    .join("");
  return `<svg class="graph" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}" role="img" aria-label="Dependency tree">${edgeSvg}${nodeSvg}</svg>`;
}

// ─── page ──────────────────────────────────────────────────────────────────

const CSS = String.raw`
  :root {
    --bg:#f6f8fa; --card:#ffffff; --well:#f1f4f8; --fg:#0b0f19; --fg-2:#334155; --fg-3:#475569; --fg-4:#94a3b8;
    --line:#e4e7ec; --line-strong:#cbd2dc; --accent:#4338ca; --accent-quiet:rgba(67,56,202,.10);
    --ok:#065f46; --ok-mark:#059669; --ok-quiet:rgba(5,150,105,.12); --info:#0369a1; --info-mark:#0ba5ec; --info-quiet:rgba(11,165,236,.12);
    --warn:#b54708; --warn-mark:#f79009; --warn-quiet:rgba(247,144,9,.14); --danger:#b42318;
    --shadow:0 1px 2px rgba(11,15,25,.06),0 4px 16px rgba(11,15,25,.05);
    --sans:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif; --mono:"IBM Plex Mono","SFMono-Regular",Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#09090b; --card:#18181b; --well:#121215; --fg:#fafafa; --fg-2:#d4d4d8; --fg-3:#a1a1aa; --fg-4:#6b6b74;
    --line:rgba(255,255,255,.08); --line-strong:rgba(255,255,255,.18); --accent:#a5b4fc; --accent-quiet:rgba(165,180,252,.14);
    --ok:#12b76a; --ok-mark:#12b76a; --ok-quiet:rgba(18,183,106,.14); --info:#4ea1f3; --info-mark:#4ea1f3; --info-quiet:rgba(78,161,243,.14);
    --warn:#f79009; --warn-mark:#f79009; --warn-quiet:rgba(247,144,9,.16); --danger:#f97066; --shadow:0 1px 2px rgba(0,0,0,.4);
  } }
  :root[data-theme="dark"] {
    --bg:#09090b; --card:#18181b; --well:#121215; --fg:#fafafa; --fg-2:#d4d4d8; --fg-3:#a1a1aa; --fg-4:#6b6b74;
    --line:rgba(255,255,255,.08); --line-strong:rgba(255,255,255,.18); --accent:#a5b4fc; --accent-quiet:rgba(165,180,252,.14);
    --ok:#12b76a; --ok-mark:#12b76a; --ok-quiet:rgba(18,183,106,.14); --info:#4ea1f3; --info-mark:#4ea1f3; --info-quiet:rgba(78,161,243,.14);
    --warn:#f79009; --warn-mark:#f79009; --warn-quiet:rgba(247,144,9,.16); --danger:#f97066; --shadow:0 1px 2px rgba(0,0,0,.4);
  }
  *{box-sizing:border-box} html{scroll-behavior:smooth}
  @media (prefers-reduced-motion: reduce){ html{scroll-behavior:auto} .chev{transition:none} }
  body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
  a{color:var(--info);text-decoration:none} a:hover{text-decoration:underline}
  code{font-family:var(--mono);font-size:.92em;background:var(--well);padding:0 4px;border-radius:3px}
  .mono{font-family:var(--mono);font-size:.92em}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
  .page{max-width:1180px;margin:0 auto;padding:40px 28px 96px}
  .mast{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;padding-bottom:22px;border-bottom:1px solid var(--line)}
  @media (max-width:820px){.mast{grid-template-columns:1fr}.sources{text-align:left}}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-3)}
  h1{font-size:30px;line-height:1.15;margin:6px 0 8px;font-weight:600;letter-spacing:-.01em;text-wrap:balance}
  h2{font-size:20px;font-weight:600;margin:44px 0 6px;letter-spacing:-.01em}
  .lede{color:var(--fg-2);max-width:68ch;margin:0} .lede b{color:var(--fg)}
  .sources{font-size:12.5px;color:var(--fg-3);text-align:right;line-height:1.7}
  .strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:22px 0 34px}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:var(--shadow)}
  .tile .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3)}
  .tile .v{font-size:22px;font-weight:600;line-height:1.15;margin-top:4px;font-variant-numeric:tabular-nums}
  .tile .s{font-size:12px;color:var(--fg-3);margin-top:3px}
  .tile.hot{border-color:var(--warn-mark);background:linear-gradient(0deg,var(--warn-quiet),var(--warn-quiet)),var(--card)} .tile.hot .v{color:var(--warn);font-size:17px}
  .bar{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:center;justify-content:space-between;margin-bottom:18px}
  .legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:12.5px;color:var(--fg-2)} .legend span{display:inline-flex;align-items:center;gap:7px}
  .sw{width:12px;height:12px;border-radius:50%;border:2px solid var(--line-strong);background:var(--card);flex:none}
  .sw.done{background:var(--ok-mark);border-color:var(--ok-mark)} .sw.active{background:var(--info-mark);border-color:var(--info-mark);box-shadow:0 0 0 3px var(--info-quiet)}
  .sw.you{background:var(--warn-mark);border-color:var(--warn-mark)} .sw.proposed{background:var(--accent);border-color:var(--accent)} .sw.never{background:transparent;border-style:dashed}
  button{font:inherit;font-size:12.5px;padding:5px 10px;border-radius:6px;border:1px solid var(--line-strong);background:var(--card);color:var(--fg-2);cursor:pointer} button:hover{border-color:var(--fg-4);color:var(--fg)}
  .ctl{display:flex;gap:8px}
  .spine{position:relative;padding-left:148px} .spine::before{content:"";position:absolute;left:119px;top:0;bottom:0;width:2px;background:var(--line-strong)}
  .node{position:relative;margin-bottom:26px}
  .node>.when{position:absolute;left:-148px;width:112px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--fg-3);padding-top:15px;line-height:1.35}
  .node>.when b{display:block;color:var(--fg);font-weight:500}
  .node>.dot{position:absolute;left:-35px;top:17px;width:14px;height:14px;border-radius:50%;background:var(--card);border:2.5px solid var(--line-strong);z-index:1}
  .node.done>.dot{background:var(--ok-mark);border-color:var(--ok-mark)} .node.active>.dot{background:var(--info-mark);border-color:var(--info-mark);box-shadow:0 0 0 4px var(--info-quiet)}
  .node.you>.dot{background:var(--warn-mark);border-color:var(--warn-mark)} .node.proposed>.dot{background:var(--accent);border-color:var(--accent)}
  .flag{position:relative;margin:-8px 0 26px;padding:4px 0}
  .flag>.when{position:absolute;left:-148px;width:112px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--fg-3);top:3px}
  .flag>.tick{position:absolute;left:-31px;top:9px;width:6px;height:6px;border-radius:50%;background:var(--line-strong)} .flag.done>.tick{background:var(--ok-mark)}
  .flag p{margin:0;font-size:13.5px;color:var(--fg-2)} .flag p b{color:var(--fg)}
  .today{position:relative;margin:10px 0 30px;height:0;border-top:2px dashed var(--accent)}
  .today>span{position:absolute;left:-148px;top:-10px;width:112px;text-align:right;font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:500}
  .today>i{position:absolute;left:-35px;top:-8px;width:14px;height:14px;border-radius:50%;background:var(--accent)}
  .today>em{position:absolute;left:0;top:-10px;font-style:normal;font-size:11.5px;color:var(--accent);background:var(--bg);padding:0 6px 0 0}
  @media (max-width:720px){.spine{padding-left:40px}.spine::before{left:11px}.node>.when,.flag>.when,.today>span{position:static;width:auto;text-align:left;margin-bottom:4px;padding-top:0}.node>.dot,.today>i{left:-34px}.flag>.tick{left:-30px}}
  details.card{background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);overflow:hidden}
  details.card>summary{list-style:none;cursor:pointer;padding:14px 18px;display:grid;grid-template-columns:1fr auto;gap:6px 16px;align-items:start}
  details.card>summary::-webkit-details-marker{display:none} details.card>summary:hover{background:var(--well)}
  .ttl{font-size:17px;font-weight:600;line-height:1.3;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
  .ttl .ph{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-3);font-weight:500}
  .sub{grid-column:1/-1;color:var(--fg-2);font-size:13.5px;max-width:84ch} .sub b{color:var(--fg)}
  .chev{color:var(--fg-4);font-size:12px;transition:transform .15s;padding-top:4px} details[open]>summary .chev{transform:rotate(90deg)}
  .body{border-top:1px solid var(--line);padding:14px 18px 16px}
  .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
  .chip.done{background:var(--ok-quiet);color:var(--ok)} .chip.active{background:var(--info-quiet);color:var(--info)} .chip.you{background:var(--warn-quiet);color:var(--warn)}
  .chip.planned{background:var(--well);color:var(--fg-3);border-color:var(--line)} .chip.proposed{background:var(--accent-quiet);color:var(--accent)} .chip.never{color:var(--fg-3);border-color:var(--line-strong);border-style:dashed}
  .size{font-family:var(--mono);font-size:10.5px;color:var(--fg-3);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
  ul.tree,ul.tree ul{list-style:none;margin:0;padding:0} ul.tree ul{margin-left:13px;padding-left:18px;border-left:1.5px solid var(--line)}
  ul.tree li{position:relative;padding:7px 0 7px 14px} ul.tree li::before{content:"";position:absolute;left:0;top:16px;width:10px;height:1.5px;background:var(--line)}
  ul.tree>li{padding-left:0} ul.tree>li::before{display:none}
  ul.tree li.leaf-you{border-left:3px solid var(--warn-mark);margin-left:-3px;padding-left:14px;background:linear-gradient(90deg,var(--warn-quiet),transparent 55%);border-radius:0 6px 6px 0} ul.tree li.leaf-you::before{display:none}
  .row{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px} .row .n{font-weight:600} .row .d{font-family:var(--mono);font-size:11.5px;color:var(--fg-3)}
  .desc{color:var(--fg-2);font-size:13.5px;margin:2px 0 0;max-width:86ch} .desc b,.sub b,.note b,.feat b{color:var(--fg);font-weight:600}
  .dec{font-family:var(--mono);font-size:.9em;color:var(--accent)}
  .mark{display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid var(--line-strong);background:var(--card);flex:none;margin-right:2px}
  .mark.done{background:var(--ok-mark);border-color:var(--ok-mark)} .mark.active{background:var(--info-mark);border-color:var(--info-mark)} .mark.you{background:var(--warn-mark);border-color:var(--warn-mark)}
  .mark.proposed{background:var(--accent);border-color:var(--accent)} .mark.never{border-style:dashed;background:transparent}
  .dl{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3);font-weight:500;margin-right:4px;flex:none;min-width:52px}
  .feat{display:flex;gap:8px;align-items:baseline;margin-top:6px;font-size:13px;color:var(--fg-2)} .feat .dl{min-width:52px;white-space:nowrap}
  .feat ul,ul.tree .feat ul{margin:0;padding:0;border:0;list-style:none;display:flex;flex-wrap:wrap;gap:3px 16px}
  .feat li,ul.tree .feat li{display:block;position:static;padding:0;max-width:60ch} ul.tree .feat li::before{display:none} .feat li.never{color:var(--fg-3)}
  .fm{display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--line-strong);background:var(--card);margin:0 5px 1px 0;vertical-align:middle}
  .fm.done{background:var(--ok-mark);border-color:var(--ok-mark)} .fm.active{background:var(--info-mark);border-color:var(--info-mark)} .fm.you{background:var(--warn-mark);border-color:var(--warn-mark)} .fm.proposed{background:var(--accent);border-color:var(--accent)} .fm.never{border-style:dashed;background:transparent}
  .lay{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;font-weight:600;padding:0 5px;border-radius:3px;border:1px solid var(--line);color:var(--fg-3);background:var(--well);display:inline-block;vertical-align:middle;line-height:1.5;margin:0 5px 1px 0}
  .lay.frontend{color:var(--info);border-color:var(--info-quiet);background:var(--info-quiet)} .lay.backend{color:var(--fg-2);border-color:var(--line-strong)}
  .lay.both{color:var(--accent);border-color:var(--accent-quiet);background:var(--accent-quiet)} .lay.wiring{color:var(--warn);border-color:var(--warn-quiet);background:var(--warn-quiet)}
  .cnt{font-family:var(--mono);font-size:10.5px;text-transform:none;letter-spacing:0;color:var(--fg-3);margin-left:4px}
  .deps{display:flex;flex-wrap:wrap;align-items:center;gap:5px 6px;margin-top:6px}
  .req{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:1px 8px 1px 5px;border-radius:999px;border:1px solid var(--line);color:var(--fg-2);background:var(--card)}
  .req i{font-style:normal;font-family:var(--mono);font-size:11px;width:15px;height:15px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--well);color:var(--fg-3)}
  .req em{font-style:normal;font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--warn)}
  .req.met{border-color:var(--ok-quiet)} .req.met i{background:var(--ok-mark);color:#fff}
  .req.open i{border:1.5px dashed var(--line-strong);background:transparent}
  .req.you{border-color:var(--warn-mark);background:var(--warn-quiet);color:var(--warn)} .req.you i{background:var(--warn-mark);color:#fff}
  .req.unl{border-color:var(--accent-quiet)} .req.unl i{background:var(--accent-quiet);color:var(--accent)}
  a.req:hover{text-decoration:none;border-color:var(--fg-4)}
  .tw{overflow-x:auto;margin-top:10px} table{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}
  th{text-align:left;font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3);font-weight:500;padding:6px 10px;border-bottom:1px solid var(--line)}
  td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--fg-2)} td:first-child{font-family:var(--mono);color:var(--fg-3);white-space:nowrap} td b{color:var(--fg)}
  tr.y td{background:var(--warn-quiet)} tr.y td:first-child{color:var(--warn);font-weight:500} tr.g td b{color:var(--ok)}
  .note{margin:10px 0 0;padding:10px 14px;border-radius:8px;background:var(--well);border:1px solid var(--line);font-size:13px;color:var(--fg-2);max-width:90ch}
  .note.you{border-color:var(--warn-mark);background:var(--warn-quiet)} .note.you b{color:var(--warn)}
  .gwrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:10px}
  .graph{display:block;font-family:var(--sans);font-size:12.5px}
  .graph .edge{fill:none;stroke:var(--line-strong);stroke-width:1.5} .graph .edge.met{stroke:var(--ok-mark);opacity:.7} .graph .edge.open{stroke-dasharray:4 4}
  .graph .gn rect{fill:var(--card);stroke:var(--line-strong);stroke-width:1.5} .graph .gn text{fill:var(--fg);font-weight:500}
  .graph .gn.done rect{fill:var(--ok-quiet);stroke:var(--ok-mark)} .graph .gn.done text{fill:var(--ok)}
  .graph .gn.active rect{fill:var(--info-quiet);stroke:var(--info-mark);stroke-width:2} .graph .gn.active text{fill:var(--info)}
  .graph .gn.you rect{fill:var(--warn-quiet);stroke:var(--warn-mark)} .graph .gn.you text{fill:var(--warn)} .graph .gb{fill:var(--warn);font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;font-weight:600}
  .graph .gn.proposed rect{fill:var(--accent-quiet);stroke:var(--accent);stroke-dasharray:5 3} .graph .gn.proposed text{fill:var(--accent)}
  .graph .gn.planned.locked rect{stroke-dasharray:4 3} .graph .gn.planned.locked text{fill:var(--fg-3)}
  .graph .gn.planned.avail rect{stroke:var(--fg-2);stroke-width:2}
  .graph .gn.never rect{stroke-dasharray:2 3;fill:transparent} .graph .gn.never text{fill:var(--fg-4)}
  .graph a:hover rect{filter:brightness(.96)}
  .glegend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:12.5px;color:var(--fg-2);margin:8px 0 12px} .glegend span{display:inline-flex;align-items:center;gap:7px}
  footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--fg-3);line-height:1.7}
`;

function renderPage(roadmap: Roadmap): string {
  const registry = collectRegistry(roadmap);
  const spine = roadmap.spine
    .map((node) => {
      if (node.kind === "phase") return renderPhase(node, registry);
      if (node.kind === "flag") {
        return `<div class="flag ${node.status}"><span class="when">${inline(node.when)}</span><span class="tick" aria-hidden="true"></span><p>${inline(node.text)}</p></div>`;
      }
      return `<div class="today" role="separator" aria-label="Today"><span>today</span><i aria-hidden="true"></i><em>${inline(node.text)}</em></div>`;
    })
    .join("\n");
  const tiles = roadmap.tiles
    .map((t) => `<div class="tile${t.hot ? " hot" : ""}"><div class="k">${inline(t.label)}</div><div class="v">${inline(t.value)}</div>${t.sub === undefined ? "" : `<div class="s">${inline(t.sub)}</div>`}</div>`)
    .join("");
  const sources = roadmap.meta.sources.map((s) => inline(s)).join("<br>");
  return `<meta charset="utf-8">
<title>${escapeHtml(roadmap.meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
<div class="page">
<header class="mast">
<div>
<div class="eyebrow">${inline(roadmap.meta.eyebrow)}</div>
<h1>${escapeHtml(roadmap.meta.title)}</h1>
<p class="lede">${inline(roadmap.meta.lede)}</p>
</div>
<div class="sources">${sources}</div>
</header>
<section class="strip" aria-label="At a glance">${tiles}</section>
<div class="bar">
<div class="legend" aria-label="Legend">
<span><i class="sw done"></i>complete</span><span><i class="sw active"></i>active</span><span><i class="sw you"></i>needs you</span><span><i class="sw"></i>planned</span><span><i class="sw proposed"></i>proposed</span><span><i class="sw never"></i>won't build / deferred</span>
<span><span class="size">S · M · L · XL</span>&nbsp;relative size (sessions ≈ 1 · 2–4 · 5–10 · 10+)</span>
<span>layers: <span class="lay frontend">FE</span> React only · <span class="lay backend">BE</span> BFF / kernel only · <span class="lay both">BOTH</span> vertical slice · <span class="lay wiring">WIRE</span> connecting two halves that exist · <span class="lay docs">DOCS</span> · <span class="lay proof">PROOF</span> live run / measurement</span>
</div>
<div class="ctl"><button type="button" onclick="document.querySelectorAll('details.card').forEach(d=>d.open=true)">Expand all</button><button type="button" onclick="document.querySelectorAll('details.card').forEach(d=>d.open=false)">Collapse all</button></div>
</div>
<main class="spine">
${spine}
</main>
<h2 id="tree">Dependency tree — what unlocks what</h2>
<p class="lede" style="margin-bottom:10px">Every node that declares a prerequisite, laid out left → right by how many things must land before it. A solid outline is <b>available now</b> (every prerequisite met); a dashed outline is <b>locked</b>; a pill marked <b>YOU</b> is an operator act no code can take. Click a node to jump to it on the timeline.</p>
<div class="glegend"><span><i class="sw done"></i>done</span><span><i class="sw active"></i>active</span><span><i class="sw you"></i>your call</span><span><i class="sw"></i>available next</span><span><i class="sw never"></i>locked</span><span><i class="sw proposed"></i>proposed</span></div>
<div class="gwrap">${renderGraph(registry)}</div>
<footer>${inline(roadmap.meta.footer)}<br>Status as of <span class="mono">${escapeHtml(roadmap.meta.asOf)}</span>, HEAD <span class="mono">${escapeHtml(roadmap.meta.head)}</span>. Generated by <code>npm run roadmap</code> from <code>docs/roadmap/roadmap.json</code> — edit the JSON, never this file.</footer>
</div>
`;
}

// ─── entry ─────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, "docs/roadmap/roadmap.json");
const TARGET = resolve(ROOT, "docs/roadmap/index.html");

async function publish(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${String(process.pid)}.staging`;
  await writeFile(staging, content, "utf8");
  await rename(staging, path);
}

const argv = process.argv.slice(2);
if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) {
  throw new Error("usage: npm run roadmap [-- --check]");
}
const raw: unknown = JSON.parse(await readFile(SOURCE, "utf8"));
const roadmap = RoadmapSchema.parse(raw);
const html = renderPage(roadmap);

if (argv[0] === "--check") {
  const committed = await readFile(TARGET, "utf8").catch(() => "");
  if (committed !== html) {
    throw new Error(`docs/roadmap/index.html is stale — run \`npm run roadmap\` and commit the result`);
  }
  process.stdout.write("docs/roadmap/index.html is fresh.\n");
} else {
  await publish(TARGET, html);
  process.stdout.write(`Rendered docs/roadmap/index.html (${String(html.length)} bytes).\n`);
}
