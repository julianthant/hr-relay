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

// ─── drawer fragments (the node's full detail, shown beside the canvas) ────

function renderChip(chip: z.infer<typeof ChipSchema> | undefined, fallback: Status): string {
  if (chip === undefined) return "";
  return `<span class="chip ${chip.tone ?? fallback}">${inline(chip.text)}</span>`;
}

function renderRequires(requires: Requirement[] | undefined, registry: Map<string, Registered>): string {
  if (requires === undefined || requires.length === 0) return "";
  const chips = requires.map((requirement) => {
    const met = requirementMet(requirement, registry);
    if (requirement.kind === "node") {
      const target = registry.get(requirement.ref);
      const title = target === undefined ? requirement.ref : target.title;
      return `<a class="req ${met ? "met" : "open"}" href="#${requirement.ref}" data-go="${requirement.ref}"><i>${met ? "✓" : "○"}</i>${inline(title)}</a>`;
    }
    const cls = requirement.kind === "you" ? (met ? "met" : "you") : met ? "met" : "open";
    const glyph = requirement.kind === "you" ? (met ? "✓" : "!") : met ? "✓" : "○";
    return `<span class="req ${cls}"><i>${glyph}</i>${requirement.kind === "you" ? "<em>you:</em> " : ""}${inline(requirement.text)}</span>`;
  });
  return `<div class="deps"><span class="dl">Needs</span>${chips.join("")}</div>`;
}

function renderUnlocks(id: string, registry: Map<string, Registered>): string {
  const entry = registry.get(id);
  if (entry === undefined || entry.unlocks.length === 0) return "";
  const chips = entry.unlocks.map((target) => {
    const t = registry.get(target);
    return `<a class="req unl" href="#${target}" data-go="${target}"><i>→</i>${inline(t?.title ?? target)}</a>`;
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

interface ResolvedFeature {
  text: string;
  layer: Layer | undefined;
  status: Status;
}

function resolveFeatures(features: Feature[] | undefined, status: Status): ResolvedFeature[] {
  if (features === undefined) return [];
  return features.map((f) => (typeof f === "string" ? { text: f, layer: undefined, status } : { text: f.text, layer: f.layer, status: f.status ?? status }));
}

function renderFeatures(features: ResolvedFeature[], status: Status): string {
  if (features.length === 0) return "";
  const built = features.filter((f) => f.status === "done").length;
  const rollup = status === "done" ? "" : ` <span class="cnt">${String(built)}/${String(features.length)} built</span>`;
  const label = status === "done" ? "Built" : status === "never" ? "Would build" : "Builds";
  const items = features
    .map((f) => {
      const layer = f.layer === undefined ? "" : `<span class="lay ${f.layer}">${LAYER_LABEL[f.layer]}</span>`;
      return `<li class="${f.status}"><i class="fm ${f.status}"></i>${layer}${inline(f.text)}</li>`;
    })
    .join("");
  return `<div class="feat"><div class="dl">${label}${rollup}</div><ul>${items}</ul></div>`;
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

// ─── the tree: every phase is a root on the time spine; its items branch right ─

interface TreeNode {
  key: string;
  kind: "phase" | "item" | "flag";
  status: Status;
  title: string;
  eyebrow: string | undefined;
  chip: z.infer<typeof ChipSchema> | undefined;
  size: Item["size"];
  features: ResolvedFeature[];
  requires: Requirement[];
  detail: string;
  children: TreeNode[];
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rowCenter: number;
}

const NODE_W = 224;
const NODE_H = 60;
const PHASE_H = 88;
const COL_STEP = 248;   // one leaf column
const DEPTH_STEP = 104; // one task row (NODE_H + 44)
const PHASE_DROP = 44;  // phase box bottom → first task row top
const PAD = 28;
const BAND_GAP = 52;    // between phase bands
const FLAG_H = 44;
const TODAY_H = 40;
const CHILD_X = PAD + NODE_W + 64; // tasks start to the right of the phase column

function buildItemNode(item: Item, parentKey: string, index: number, registry: Map<string, Registered>): TreeNode {
  const key = item.id ?? `${parentKey}-${String(index + 1)}`;
  const features = resolveFeatures(item.features, item.status);
  const detail = [
    item.desc === undefined ? "" : `<p class="desc">${inline(item.desc)}</p>`,
    renderFeatures(features, item.status),
    renderRequires(item.requires, registry),
    item.id === undefined ? "" : renderUnlocks(item.id, registry),
    renderTable(item.table),
    renderNotes(item.notes),
  ].join("");
  return {
    key,
    kind: "item",
    status: item.status,
    title: item.title,
    eyebrow: item.date,
    chip: item.chip,
    size: item.size,
    features,
    requires: item.requires ?? [],
    detail,
    children: (item.items ?? []).map((child, i) => buildItemNode(child, key, i, registry)),
    depth: 0, x: 0, y: 0, w: NODE_W, h: NODE_H, rowCenter: 0,
  };
}

function buildPhaseNode(node: PhaseNode, registry: Map<string, Registered>): TreeNode {
  const features = resolveFeatures(node.features, node.status);
  const detail = [
    `<p class="desc">${inline(node.summary)}</p>`,
    renderFeatures(features, node.status),
    renderRequires(node.requires, registry),
    renderUnlocks(node.id, registry),
    renderNotes(node.notes),
  ].join("");
  return {
    key: node.id,
    kind: "phase",
    status: node.status,
    title: node.title,
    eyebrow: `${node.phase} · ${node.when.primary}${node.when.secondary === undefined ? "" : ` · ${node.when.secondary}`}`,
    chip: node.chip,
    size: node.size,
    features,
    requires: node.requires ?? [],
    detail,
    children: node.items.map((item, i) => buildItemNode(item, node.id, i, registry)),
    depth: 0, x: 0, y: 0, w: NODE_W, h: PHASE_H, rowCenter: 0,
  };
}

function leafRows(node: TreeNode): number {
  return node.children.length === 0 ? 1 : node.children.reduce((sum, child) => sum + leafRows(child), 0);
}

/** Tidy top→down placement inside one phase band: leaves take consecutive columns, a parent sits centred over its children. */
function place(node: TreeNode, depth: number, startCol: number, blockLeft: number, bandTop: number): void {
  node.depth = depth;
  node.y = depth === 0 ? bandTop : bandTop + PHASE_H + PHASE_DROP + (depth - 1) * DEPTH_STEP;
  if (node.children.length === 0) {
    node.rowCenter = startCol + 0.5;
  } else {
    let col = startCol;
    for (const child of node.children) {
      place(child, depth + 1, col, blockLeft, bandTop);
      col += leafRows(child);
    }
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    node.rowCenter = first === undefined || last === undefined ? startCol + 0.5 : (first.rowCenter + last.rowCenter) / 2;
  }
  node.x = blockLeft + node.rowCenter * COL_STEP - node.w / 2;
}

function maxDepth(node: TreeNode): number {
  return node.children.length === 0 ? node.depth : Math.max(...node.children.map(maxDepth));
}

function flatten(node: TreeNode, into: TreeNode[]): TreeNode[] {
  into.push(node);
  for (const child of node.children) flatten(child, into);
  return into;
}

function wrapTitle(title: string, width: number, maxLines: number): string[] {
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
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const lastIndex = maxLines - 1;
    kept[lastIndex] = `${(kept[lastIndex] ?? "").slice(0, width - 1)}…`;
    return kept;
  }
  return lines;
}

const N = (value: number): string => String(Math.round(value * 10) / 10);

/** Org-chart rail: parent bottom-centre drops to a rail, the rail spans the children, each child gets a stub. */
function railConnector(parent: TreeNode): string {
  if (parent.children.length === 0) return "";
  const px = parent.x + parent.w / 2;
  const py = parent.y + parent.h;
  const first = parent.children[0];
  const last = parent.children[parent.children.length - 1];
  if (first === undefined || last === undefined) return "";
  const railY = first.y - (first.y - py) / 2;
  const left = Math.min(px, first.x + first.w / 2);
  const right = Math.max(px, last.x + last.w / 2);
  const stubs = parent.children.map((c) => `M${N(c.x + c.w / 2)},${N(railY)} V${N(c.y)}`).join(" ");
  return `M${N(px)},${N(py)} V${N(railY)} M${N(left)},${N(railY)} H${N(right)} ${stubs}`;
}

interface Band {
  kind: "flag" | "today";
  top: number;
  status: Status;
  key: string;
  text: string;
}

function renderCanvas(roadmap: Roadmap, registry: Map<string, Registered>): { svg: string; data: Record<string, { title: string; html: string; requires: string[]; unlocks: string[]; parent: string | null; children: string[] }> } {
  const roots: TreeNode[] = [];
  const bands: Band[] = [];
  let cursor = PAD;
  let flagIndex = 0;
  for (const node of roadmap.spine) {
    if (node.kind === "phase") {
      const root = buildPhaseNode(node, registry);
      place(root, 0, 0, CHILD_X, cursor);
      root.x = PAD;
      root.y = cursor;
      roots.push(root);
      const depth = maxDepth(root);
      const bandHeight = depth === 0 ? PHASE_H : PHASE_H + PHASE_DROP + (depth - 1) * DEPTH_STEP + NODE_H;
      cursor += bandHeight + BAND_GAP;
    } else if (node.kind === "flag") {
      flagIndex += 1;
      bands.push({ kind: "flag", top: cursor, status: node.status, key: `flag-${String(flagIndex)}`, text: node.text });
      cursor += FLAG_H + BAND_GAP / 2;
    } else {
      bands.push({ kind: "today", top: cursor, status: "active", key: "today", text: node.text });
      cursor += TODAY_H + BAND_GAP / 2;
    }
  }
  const all = roots.flatMap((root) => flatten(root, []));
  const width = Math.max(...all.map((n) => n.x + n.w)) + PAD;
  const height = cursor - BAND_GAP + PAD;
  const byKey = new Map(all.map((n) => [n.key, n] as const));
  const spineX = PAD + NODE_W / 2;

  // tree edges (containment) — org-chart rails
  const treeEdges = all
    .filter((parent) => parent.children.length > 0)
    .map((parent) => `<path class="te" d="${railConnector(parent)}"/>`)
    .join("");

  // prerequisite edges (shown on hover/selection, or all at once): a vertical
  // S-curve between rows; an arc below both boxes when they share a row
  const reqEdges = all
    .flatMap((node) =>
      node.requires.flatMap((requirement) => {
        if (requirement.kind !== "node") return [];
        const from = byKey.get(requirement.ref);
        if (from === undefined) return [];
        const met = from.status === "done";
        const fx = from.x + from.w / 2;
        const tx = node.x + node.w / 2;
        let d: string;
        if (Math.abs(from.y - node.y) < NODE_H) {
          const y = Math.max(from.y + from.h, node.y + node.h);
          const dip = y + 26 + Math.min(60, Math.abs(tx - fx) / 40);
          d = `M${N(fx)},${N(from.y + from.h)} C${N(fx)},${N(dip)} ${N(tx)},${N(dip)} ${N(tx)},${N(node.y + node.h)}`;
        } else if (from.y < node.y) {
          const y1 = from.y + from.h;
          const y2 = node.y;
          const dy = Math.max(30, (y2 - y1) / 2);
          d = `M${N(fx)},${N(y1)} C${N(fx)},${N(y1 + dy)} ${N(tx)},${N(y2 - dy)} ${N(tx)},${N(y2)}`;
        } else {
          const y1 = from.y;
          const y2 = node.y + node.h;
          const dy = Math.max(30, (y1 - y2) / 2);
          d = `M${N(fx)},${N(y1)} C${N(fx)},${N(y1 - dy)} ${N(tx)},${N(y2 + dy)} ${N(tx)},${N(y2)}`;
        }
        return [`<path class="rq ${met ? "met" : "open"}" data-from="${from.key}" data-to="${node.key}" d="${d}"/>`];
      }),
    )
    .join("");

  // the spine through every phase root, plus flags / today bands
  const firstRoot = roots[0];
  const lastRoot = roots[roots.length - 1];
  const spine = firstRoot === undefined || lastRoot === undefined
    ? ""
    : `<line class="spine" x1="${N(spineX)}" y1="${N(firstRoot.y + firstRoot.h / 2)}" x2="${N(spineX)}" y2="${N(lastRoot.y + lastRoot.h / 2)}"/>`;
  const bandSvg = bands
    .map((band) => {
      if (band.kind === "today") {
        const y = band.top + TODAY_H / 2;
        return `<g class="today"><line x1="${N(PAD)}" y1="${N(y)}" x2="${N(width - PAD)}" y2="${N(y)}"/><circle cx="${N(spineX)}" cy="${N(y)}" r="7"/><text x="${N(spineX + 16)}" y="${N(y - 8)}">TODAY · ${escapeHtml(band.text)}</text></g>`;
      }
      const y = band.top + FLAG_H / 2;
      const label = wrapTitle(band.text.replace(/\*\*/g, "").replace(/`/g, ""), 110, 1)[0] ?? "";
      return `<a class="nd flag ${band.status}" href="#${band.key}" data-key="${band.key}" aria-label="${escapeHtml(label)}"><g><circle cx="${N(spineX)}" cy="${N(y)}" r="6"/><rect x="${N(spineX + 14)}" y="${N(y - 14)}" width="${N(Math.min(width - spineX - 14 - PAD, 760))}" height="28" rx="14"/><text x="${N(spineX + 28)}" y="${N(y)}" dy="0.35em">${escapeHtml(label)}</text></g></a>`;
    })
    .join("");

  // nodes
  const nodeSvg = all
    .map((node) => {
      const isPhase = node.kind === "phase";
      const available = node.requires.every((r) => requirementMet(r, registry));
      const cls = `nd ${node.kind} ${node.status}${available ? " avail" : " locked"}`;
      const titleLines = wrapTitle(node.title, isPhase ? 27 : 28, 2);
      const titleY = isPhase ? node.y + 36 : node.y + (titleLines.length === 1 ? 24 : 19);
      const title = titleLines
        .map((line, i) => `<tspan x="${N(node.x + 26)}" dy="${i === 0 ? 0 : 15}">${escapeHtml(line)}</tspan>`)
        .join("");
      const eyebrow = isPhase && node.eyebrow !== undefined
        ? `<text class="eb" x="${N(node.x + 12)}" y="${N(node.y + 17)}">${escapeHtml((wrapTitle(node.eyebrow, 30, 1)[0] ?? "").toUpperCase())}</text>`
        : "";
      const dotY = isPhase ? node.y + 32 : node.y + (titleLines.length === 1 ? 20 : 15);
      const dot = `<circle class="st" cx="${N(node.x + 14)}" cy="${N(dotY)}" r="4.5"/>`;
      // the built-by-layer bar: one square per feature, filled when done
      const squares = node.features.slice(0, 14).map((f, i) => {
        const sx = node.x + 26 + i * 11;
        const sy = node.y + node.h - 15;
        return `<rect class="fq ${f.layer ?? "plain"} ${f.status}" x="${N(sx)}" y="${N(sy)}" width="8" height="8" rx="1.5"/>`;
      }).join("");
      const more = node.features.length > 14 ? `<text class="fq-more" x="${N(node.x + 26 + 14 * 11)}" y="${N(node.y + node.h - 8)}">+${String(node.features.length - 14)}</text>` : "";
      const built = node.features.filter((f) => f.status === "done").length;
      const countText = node.features.length === 0 ? "" : node.status === "done" ? `${String(node.features.length)} built` : `${String(built)}/${String(node.features.length)}`;
      const rightText = [node.size, countText].filter((t): t is string => t !== undefined && t.length > 0).join(" · ");
      const right = rightText.length === 0 ? "" : `<text class="meta" x="${N(node.x + node.w - 10)}" y="${N(node.y + node.h - 8)}" text-anchor="end">${escapeHtml(rightText)}</text>`;
      const chip = isPhase && node.chip !== undefined
        ? `<text class="pc ${node.chip.tone ?? node.status}" x="${N(node.x + 12)}" y="${N(node.y + node.h - 11)}">${escapeHtml(node.chip.text.replace(/\*\*/g, "").toUpperCase())}</text>`
        : "";
      const phaseBar = isPhase ? "" : squares + more;
      return `<a class="${cls}" href="#${node.key}" data-key="${node.key}" aria-label="${escapeHtml(`${node.title} — ${node.status}`)}"><g><rect class="bx" x="${N(node.x)}" y="${N(node.y)}" width="${N(node.w)}" height="${N(node.h)}" rx="${isPhase ? "10" : "8"}"/>${eyebrow}${dot}<text class="tt" x="${N(node.x + 26)}" y="${N(titleY)}">${title}</text>${phaseBar}${isPhase ? chip : right}</g></a>`;
    })
    .join("");

  const svg = `<svg id="canvas" class="tree" viewBox="0 0 ${N(width)} ${N(height)}" width="${N(width)}" height="${N(height)}" role="group" aria-label="Roadmap tree">${spine}${treeEdges}${reqEdges}${bandSvg}${nodeSvg}</svg>`;

  const parentOf = new Map<string, string>();
  for (const node of all) for (const child of node.children) parentOf.set(child.key, node.key);
  const data: Record<string, { title: string; html: string; requires: string[]; unlocks: string[]; parent: string | null; children: string[] }> = {};
  for (const node of all) {
    const entry = registry.get(node.key);
    const chip = node.chip !== undefined && node.chip.text.toLowerCase() === node.status ? undefined : node.chip;
    const header = `<div class="dh"><span class="chip ${node.status}">${node.status === "you" ? "needs you" : node.status}</span>${renderChip(chip, node.status)}${node.size === undefined ? "" : `<span class="size">${node.size}</span>`}${node.eyebrow === undefined ? "" : `<span class="eb2">${inline(node.eyebrow)}</span>`}</div>`;
    data[node.key] = {
      title: node.title,
      html: header + node.detail,
      requires: node.requires.flatMap((r) => (r.kind === "node" ? [r.ref] : [])),
      unlocks: entry?.unlocks ?? [],
      parent: parentOf.get(node.key) ?? null,
      children: node.children.map((c) => c.key),
    };
  }
  for (const band of bands) {
    if (band.kind !== "flag") continue;
    data[band.key] = { title: "Milestone", html: `<p class="desc">${inline(band.text)}</p>`, requires: [], unlocks: [], parent: null, children: [] };
  }
  return { svg, data };
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
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;min-height:100vh}
  a{color:var(--info);text-decoration:none} a:hover{text-decoration:underline}
  code{font-family:var(--mono);font-size:.92em;background:var(--well);padding:0 4px;border-radius:3px}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
  button{font:inherit;font-size:12.5px;padding:5px 10px;border-radius:6px;border:1px solid var(--line-strong);background:var(--card);color:var(--fg-2);cursor:pointer} button:hover{border-color:var(--fg-4);color:var(--fg)} button[aria-pressed="true"]{background:var(--accent-quiet);border-color:var(--accent);color:var(--accent)}

  /* ─ masthead ─ */
  .mast{padding:14px 24px 10px;border-bottom:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;gap:8px}
  .mast .hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 18px}
  .eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-3)}
  h1{font-size:22px;line-height:1.15;margin:0;font-weight:600;letter-spacing:-.01em}
  .lede{color:var(--fg-2);max-width:120ch;margin:0;font-size:13px;flex:1 1 40ch} .lede b{color:var(--fg)}
  .tiles{display:flex;flex-wrap:wrap;gap:8px}
  .tile{background:var(--well);border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:120px}
  .tile .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3)}
  .tile .v{font-size:16px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums} .tile .s{font-size:11px;color:var(--fg-3)}
  .tile.hot{border-color:var(--warn-mark);background:var(--warn-quiet)} .tile.hot .v{color:var(--warn)}

  /* ─ toolbar ─ */
  .bar{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center;justify-content:space-between;padding:8px 24px;border-bottom:1px solid var(--line);background:var(--bg)}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--fg-2)} .legend span{display:inline-flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:50%;border:2px solid var(--line-strong);background:var(--card);flex:none}
  .sw.done{background:var(--ok-mark);border-color:var(--ok-mark)} .sw.active{background:var(--info-mark);border-color:var(--info-mark);box-shadow:0 0 0 3px var(--info-quiet)}
  .sw.you{background:var(--warn-mark);border-color:var(--warn-mark)} .sw.proposed{background:var(--accent);border-color:var(--accent)} .sw.never{background:transparent;border-style:dashed}
  .sw.avail{border-color:var(--fg-2);border-width:2.5px} .sw.locked{border-style:dashed}
  .ctl{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .lay{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;font-weight:600;padding:0 5px;border-radius:3px;border:1px solid var(--line);color:var(--fg-3);background:var(--well);display:inline-block;vertical-align:middle;line-height:1.5;margin:0 4px 1px 0}
  .lay.frontend{color:var(--info);border-color:var(--info-quiet);background:var(--info-quiet)} .lay.backend{color:var(--fg-2);border-color:var(--line-strong)}
  .lay.both{color:var(--accent);border-color:var(--accent-quiet);background:var(--accent-quiet)} .lay.wiring{color:var(--warn);border-color:var(--warn-quiet);background:var(--warn-quiet)}
  .sq{display:inline-block;width:9px;height:9px;border-radius:2px;vertical-align:middle;border:1.5px solid var(--fg-3)} .sq.f{background:var(--fg-3)}

  /* ─ workspace: canvas + drawer ─ */
  .work{display:grid;grid-template-columns:minmax(0,1fr) 400px;flex:1;min-height:0}
  @media (max-width:900px){.work{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) 42vh}}
  .canvas{overflow:auto;position:relative;background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--fg) 7%, transparent) 1px, transparent 0) 0 0/22px 22px, var(--bg)}
  .tree{display:block;font-family:var(--sans);transform-origin:0 0}
  .drawer{border-left:1px solid var(--line);background:var(--card);overflow:auto;padding:16px 18px 28px;font-size:13.5px}
  @media (max-width:900px){.drawer{border-left:0;border-top:1px solid var(--line)}}
  .drawer h2{font-size:17px;margin:0 0 6px;line-height:1.3;font-weight:600}
  .drawer .hint{color:var(--fg-3);font-size:13px;max-width:46ch}
  .dh{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px} .eb2{font-family:var(--mono);font-size:11px;color:var(--fg-3)}
  .dnav{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}

  /* ─ svg nodes ─ */
  .tree .spine{stroke:var(--line-strong);stroke-width:2.5}
  .tree .te{fill:none;stroke:var(--line-strong);stroke-width:1.5}
  .tree .rq{fill:none;stroke:var(--accent);stroke-width:1.75;stroke-dasharray:5 4;opacity:0;pointer-events:none;transition:opacity .15s}
  .tree .rq.met{stroke:var(--ok-mark)} .tree .rq.on{opacity:.95} .tree.show-all .rq{opacity:.45} .tree.show-all .rq.on{opacity:1}
  @media (prefers-reduced-motion: reduce){.tree .rq{transition:none}}
  .tree .nd{cursor:pointer} .tree .nd:hover .bx{filter:brightness(.97)} .tree .nd:focus{outline:none} .tree .nd:focus-visible .bx{stroke:var(--accent);stroke-width:2.5}
  .tree .bx{fill:var(--card);stroke:var(--line-strong);stroke-width:1.5}
  .tree .tt{fill:var(--fg);font-size:12.5px;font-weight:500} .tree .phase .tt{font-size:13.5px;font-weight:600}
  .tree .eb{fill:var(--fg-3);font-family:var(--mono);font-size:9.5px;letter-spacing:.06em}
  .tree .meta{fill:var(--fg-3);font-family:var(--mono);font-size:9.5px}
  .tree .pc{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;font-weight:600;fill:var(--fg-3)}
  .tree .pc.done{fill:var(--ok)} .tree .pc.active{fill:var(--info)} .tree .pc.you{fill:var(--warn)} .tree .pc.proposed{fill:var(--accent)}
  .tree .st{fill:var(--card);stroke:var(--line-strong);stroke-width:2}
  .tree .done .st{fill:var(--ok-mark);stroke:var(--ok-mark)} .tree .active .st{fill:var(--info-mark);stroke:var(--info-mark)}
  .tree .you .st{fill:var(--warn-mark);stroke:var(--warn-mark)} .tree .proposed .st{fill:var(--accent);stroke:var(--accent)} .tree .never .st{stroke-dasharray:2 2}
  .tree .done .bx{fill:color-mix(in srgb, var(--ok-mark) 9%, var(--card));stroke:color-mix(in srgb, var(--ok-mark) 55%, var(--line-strong))}
  .tree .active .bx{fill:color-mix(in srgb, var(--info-mark) 10%, var(--card));stroke:var(--info-mark);stroke-width:2}
  .tree .you .bx{fill:color-mix(in srgb, var(--warn-mark) 12%, var(--card));stroke:var(--warn-mark);stroke-width:2}
  .tree .proposed .bx{fill:color-mix(in srgb, var(--accent) 9%, var(--card));stroke:var(--accent);stroke-dasharray:5 3}
  .tree .never .bx{stroke-dasharray:3 3;fill:transparent} .tree .never .tt{fill:var(--fg-3)}
  .tree .planned.locked .bx{stroke-dasharray:4 3} .tree .planned.locked .tt{fill:var(--fg-2)}
  .tree .planned.avail .bx{stroke:var(--fg-2);stroke-width:2}
  .tree .phase .bx{stroke-width:2}
  .tree .nd.sel .bx{stroke:var(--accent);stroke-width:3;stroke-dasharray:none;filter:drop-shadow(0 0 6px var(--accent-quiet))}
  .tree .nd.dim .bx,.tree .nd.dim text,.tree .nd.dim .st,.tree .nd.dim .fq{opacity:.35}
  .tree .fq{fill:var(--card);stroke:var(--fg-4);stroke-width:1.2}
  .tree .fq.frontend{stroke:var(--info-mark)} .tree .fq.both{stroke:var(--accent)} .tree .fq.wiring{stroke:var(--warn-mark)} .tree .fq.backend{stroke:var(--fg-3)} .tree .fq.docs,.tree .fq.proof{stroke:var(--fg-4)}
  .tree .fq.done{fill:var(--fg-3)} .tree .fq.frontend.done{fill:var(--info-mark)} .tree .fq.both.done{fill:var(--accent)} .tree .fq.wiring.done{fill:var(--warn-mark)} .tree .fq.backend.done{fill:var(--fg-3)} .tree .fq.docs.done,.tree .fq.proof.done{fill:var(--fg-4)}
  .tree .fq-more{fill:var(--fg-3);font-family:var(--mono);font-size:9px}
  .tree .flag rect{fill:var(--well);stroke:var(--line)} .tree .flag circle{fill:var(--ok-mark)} .tree .flag text{fill:var(--fg-2);font-size:11.5px}
  .tree .today line{stroke:var(--accent);stroke-width:2;stroke-dasharray:6 5} .tree .today circle{fill:var(--accent)} .tree .today text{fill:var(--accent);font-family:var(--mono);font-size:10.5px;letter-spacing:.06em}

  /* ─ drawer fragments ─ */
  .chip{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
  .chip.done{background:var(--ok-quiet);color:var(--ok)} .chip.active{background:var(--info-quiet);color:var(--info)} .chip.you{background:var(--warn-quiet);color:var(--warn)}
  .chip.planned{background:var(--well);color:var(--fg-3);border-color:var(--line)} .chip.proposed{background:var(--accent-quiet);color:var(--accent)} .chip.never{color:var(--fg-3);border-color:var(--line-strong);border-style:dashed}
  .size{font-family:var(--mono);font-size:10.5px;color:var(--fg-3);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
  .desc{color:var(--fg-2);margin:0 0 8px} .desc b,.note b{color:var(--fg);font-weight:600}
  .dec{font-family:var(--mono);font-size:.9em;color:var(--accent)}
  .dl{font-family:var(--mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3);font-weight:500;margin:10px 0 4px}
  .cnt{font-family:var(--mono);font-size:10.5px;text-transform:none;letter-spacing:0;color:var(--fg-3);margin-left:4px}
  .feat ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}
  .feat li{display:block;color:var(--fg-2)} .feat li.never{color:var(--fg-3)}
  .fm{display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--line-strong);background:var(--card);margin:0 5px 1px 0;vertical-align:middle}
  .fm.done{background:var(--ok-mark);border-color:var(--ok-mark)} .fm.active{background:var(--info-mark);border-color:var(--info-mark)} .fm.you{background:var(--warn-mark);border-color:var(--warn-mark)} .fm.proposed{background:var(--accent);border-color:var(--accent)} .fm.never{border-style:dashed;background:transparent}
  .deps{display:flex;flex-wrap:wrap;align-items:center;gap:5px 6px;margin-top:4px}
  .deps .dl{margin:0;flex-basis:100%}
  .req{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:1px 8px 1px 5px;border-radius:999px;border:1px solid var(--line);color:var(--fg-2);background:var(--card)}
  .req i{font-style:normal;font-family:var(--mono);font-size:11px;width:15px;height:15px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--well);color:var(--fg-3)}
  .req em{font-style:normal;font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--warn)}
  .req.met{border-color:var(--ok-quiet)} .req.met i{background:var(--ok-mark);color:#fff}
  .req.open i{border:1.5px dashed var(--line-strong);background:transparent}
  .req.you{border-color:var(--warn-mark);background:var(--warn-quiet);color:var(--warn)} .req.you i{background:var(--warn-mark);color:#fff}
  .req.unl{border-color:var(--accent-quiet)} .req.unl i{background:var(--accent-quiet);color:var(--accent)}
  a.req:hover{text-decoration:none;border-color:var(--fg-4)}
  .tw{overflow-x:auto;margin-top:10px} table{border-collapse:collapse;width:100%;font-size:12.5px}
  th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--line)}
  td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--fg-2)} td:first-child{font-family:var(--mono);color:var(--fg-3);white-space:nowrap} td b{color:var(--fg)}
  tr.y td{background:var(--warn-quiet)} tr.y td:first-child{color:var(--warn);font-weight:500} tr.g td b{color:var(--ok)}
  .note{margin:10px 0 0;padding:9px 12px;border-radius:8px;background:var(--well);border:1px solid var(--line);font-size:12.5px;color:var(--fg-2)}
  .note.you{border-color:var(--warn-mark);background:var(--warn-quiet)} .note.you b{color:var(--warn)}
  footer{padding:8px 24px;border-top:1px solid var(--line);font-size:11.5px;color:var(--fg-3);background:var(--card)}
`;

const JS = String.raw`
(function(){
  var data = JSON.parse(document.getElementById('rm-data').textContent);
  var svg = document.getElementById('canvas');
  var canvas = document.getElementById('canvas-wrap');
  var drawer = document.getElementById('drawer-body');
  var title = document.getElementById('drawer-title');
  var baseW = parseFloat(svg.getAttribute('width'));
  var baseH = parseFloat(svg.getAttribute('height'));
  var scale = 1;
  var selected = null;
  function nodes(){ return svg.querySelectorAll('.nd'); }
  function edges(){ return svg.querySelectorAll('.rq'); }
  function edgeOn(key, on){
    edges().forEach(function(e){ if (e.getAttribute('data-from') === key || e.getAttribute('data-to') === key) e.classList.toggle('on', on); });
  }
  function clearHover(){ edges().forEach(function(e){ e.classList.remove('on'); }); if (selected) edgeOn(selected, true); }
  function select(key, scroll){
    if (!data[key]) return;
    selected = key;
    nodes().forEach(function(n){ n.classList.toggle('sel', n.getAttribute('data-key') === key); n.classList.remove('dim'); });
    edges().forEach(function(e){ e.classList.remove('on'); });
    edgeOn(key, true);
    var related = {}; related[key] = true;
    data[key].requires.forEach(function(k){ related[k] = true; });
    data[key].unlocks.forEach(function(k){ related[k] = true; });
    (function down(k){ related[k] = true; (data[k] ? data[k].children : []).forEach(down); })(key);
    (function up(k){ var p = data[k] && data[k].parent; if (p) { related[p] = true; up(p); } })(key);
    if (data[key].requires.length + data[key].unlocks.length > 0) {
      nodes().forEach(function(n){ if (!related[n.getAttribute('data-key')]) n.classList.add('dim'); });
    }
    title.textContent = data[key].title;
    var nav = '';
    if (data[key].requires.length + data[key].unlocks.length > 0) nav = '<div class="dnav"><button type="button" id="clear-dim">Show all nodes</button></div>';
    drawer.innerHTML = nav + data[key].html;
    drawer.scrollTop = 0;
    if (history.replaceState) history.replaceState(null, '', '#' + key);
    var cd = document.getElementById('clear-dim');
    if (cd) cd.addEventListener('click', function(){ nodes().forEach(function(n){ n.classList.remove('dim'); }); });
    if (scroll) {
      var el = svg.querySelector('.nd[data-key="' + key + '"] .bx, .nd[data-key="' + key + '"] rect');
      if (el) {
        var x = parseFloat(el.getAttribute('x')) * scale, y = parseFloat(el.getAttribute('y')) * scale;
        canvas.scrollTo({ left: Math.max(0, x - canvas.clientWidth / 2 + 112 * scale), top: Math.max(0, y - canvas.clientHeight / 2 + 30 * scale), behavior: 'smooth' });
      }
    }
  }
  nodes().forEach(function(n){
    n.addEventListener('click', function(ev){ ev.preventDefault(); select(n.getAttribute('data-key'), false); });
    n.addEventListener('mouseenter', function(){ edgeOn(n.getAttribute('data-key'), true); });
    n.addEventListener('mouseleave', clearHover);
  });
  drawer.addEventListener('click', function(ev){
    var a = ev.target.closest('[data-go]');
    if (!a) return;
    ev.preventDefault();
    select(a.getAttribute('data-go'), true);
  });
  function applyScale(){ svg.setAttribute('width', baseW * scale); svg.setAttribute('height', baseH * scale); document.getElementById('zoom-pct').textContent = Math.round(scale * 100) + '%'; }
  document.getElementById('zoom-in').addEventListener('click', function(){ scale = Math.min(2.5, scale * 1.2); applyScale(); });
  document.getElementById('zoom-out').addEventListener('click', function(){ scale = Math.max(0.15, scale / 1.2); applyScale(); });
  document.getElementById('zoom-fit').addEventListener('click', function(){ scale = Math.max(0.25, Math.min(2.5, (canvas.clientWidth - 8) / baseW)); applyScale(); });
  document.getElementById('zoom-all').addEventListener('click', function(){ scale = Math.max(0.15, Math.min(2.5, (canvas.clientWidth - 8) / baseW, (canvas.clientHeight - 8) / baseH)); applyScale(); });
  document.getElementById('zoom-100').addEventListener('click', function(){ scale = 1; applyScale(); });
  var showAll = document.getElementById('show-all');
  showAll.addEventListener('click', function(){ var on = svg.classList.toggle('show-all'); showAll.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  // drag to pan
  var drag = null;
  canvas.addEventListener('mousedown', function(ev){ if (ev.target.closest('.nd')) return; drag = { x: ev.clientX, y: ev.clientY, l: canvas.scrollLeft, t: canvas.scrollTop }; canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', function(ev){ if (!drag) return; canvas.scrollLeft = drag.l - (ev.clientX - drag.x); canvas.scrollTop = drag.t - (ev.clientY - drag.y); });
  window.addEventListener('mouseup', function(){ drag = null; canvas.style.cursor = ''; });
  var initial = location.hash.replace('#', '');
  if (initial && data[initial]) select(initial, true);
})();
`;

function renderPage(roadmap: Roadmap): string {
  const registry = collectRegistry(roadmap);
  const { svg, data } = renderCanvas(roadmap, registry);
  const tiles = roadmap.tiles
    .map((t) => `<div class="tile${t.hot ? " hot" : ""}"><div class="k">${inline(t.label)}</div><div class="v">${inline(t.value)}</div>${t.sub === undefined ? "" : `<div class="s">${inline(t.sub)}</div>`}</div>`)
    .join("");
  const dataJson = JSON.stringify(data).replaceAll("<", "\\u003c");
  return `<meta charset="utf-8">
<title>${escapeHtml(roadmap.meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
<header class="mast">
<div class="eyebrow">${inline(roadmap.meta.eyebrow)}</div>
<div class="hd"><h1>${escapeHtml(roadmap.meta.title)}</h1><p class="lede">${inline(roadmap.meta.lede)}</p></div>
<div class="tiles">${tiles}</div>
</header>
<div class="bar">
<div class="legend" aria-label="Legend">
<span><i class="sw done"></i>complete</span><span><i class="sw active"></i>active</span><span><i class="sw you"></i>needs you</span><span><i class="sw avail"></i>available next</span><span><i class="sw locked"></i>locked</span><span><i class="sw proposed"></i>proposed</span><span><i class="sw never"></i>won't build / deferred</span>
<span>built-by-layer bar: <i class="sq f"></i> built · <i class="sq"></i> not yet · <span class="lay frontend">FE</span><span class="lay backend">BE</span><span class="lay both">BOTH</span><span class="lay wiring">WIRE</span><span class="lay docs">DOCS</span><span class="lay proof">PROOF</span></span>
</div>
<div class="ctl">
<button type="button" id="show-all" aria-pressed="false">Show all prerequisite links</button>
<button type="button" id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-pct" style="font-family:var(--mono);font-size:12px;min-width:38px;text-align:center">100%</span><button type="button" id="zoom-in" aria-label="Zoom in">+</button><button type="button" id="zoom-fit">Fit width</button><button type="button" id="zoom-all">Fit all</button><button type="button" id="zoom-100">100%</button>
</div>
</div>
<div class="work">
<div class="canvas" id="canvas-wrap">${svg}</div>
<aside class="drawer" aria-live="polite">
<h2 id="drawer-title">Select a node</h2>
<div id="drawer-body"><p class="hint">Each box is one piece of the plan: phases stack top-to-bottom on the time spine at the left, and each phase's slices, tracks and chunks fan out to its right, sub-tasks hanging beneath their parent. The small squares inside a box are its features — one per feature, coloured by layer, filled when built — so a node reads as "3 of 5 built, the missing two are wiring". Click a box for its full detail; hover to light up what it needs and what it unlocks (green when the prerequisite is met, dashed when open); drag to pan, zoom with the controls.</p><p class="hint"><b>Needs</b> chips are prerequisites: green-ticked when met, hollow when another node must land first, amber when it is an act only you can take.</p></div>
</aside>
</div>
<footer>${inline(roadmap.meta.footer)} Status as of <span style="font-family:var(--mono)">${escapeHtml(roadmap.meta.asOf)}</span>, HEAD <span style="font-family:var(--mono)">${escapeHtml(roadmap.meta.head)}</span>. Generated by <code>npm run roadmap</code> from <code>docs/roadmap/roadmap.json</code> — edit the JSON, never this file.</footer>
<script type="application/json" id="rm-data">${dataJson}</script>
<script>${JS}</script>
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
