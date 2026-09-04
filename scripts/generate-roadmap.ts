import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PLAN_SOURCE_PATH, parsePlan } from "./roadmap/parse-plan.js";
import { bindDocsToPlan, scanDocs, type DocBindingIndex, type NodeDocBinding } from "./roadmap/scan-docs.js";
import {
  RoadmapSchema,
  type Chip,
  type DocHeading,
  type DocRef,
  type DocStatusBlock,
  type Feature,
  type Item,
  type Layer,
  type LogEntry,
  type PhaseNode,
  type Requirement,
  type Roadmap,
  type Status,
  type Table,
} from "./roadmap/schema.js";

/**
 * `npm run roadmap` — render `docs/roadmap/index.html` from the plan itself:
 * `docs/roadmap/roadmap.md`, written in the roadmap notation (documented in
 * `scripts/roadmap/parse-plan.ts`, which owns the grammar; `scripts/roadmap/schema.ts`
 * owns the shape it parses into).
 *
 * The plan is the website's single source: phases → tasks → sub-tasks, what
 * every node BUILDS (`builds:` checklist, one layer tag per line) and what it
 * NEEDS (`needs:`) — from which this script derives each node's "unlocks" and
 * the prerequisite links. The phase docs `docs/rebuild/00`–`05` stay normative;
 * plan + site + owning docs are edited together (notation: docs/roadmap/notation.md).
 *
 * The page also renders the DOC side of the binding: every
 * `<!-- roadmap: <id> -->` tag and `<!-- roadmap-status: <id> -->` block the
 * rebuild docs carry (`scripts/roadmap/scan-docs.ts`) shows up in that node's
 * drawer under "From the docs". So `--check` covers the docs too — ticking a
 * status box in a doc makes the committed html stale, exactly as editing the
 * plan does, and `npm run roadmap` is the one way to re-render either.
 *
 *   npm run roadmap            # regenerate docs/roadmap/index.html
 *   npm run roadmap -- --check # fail if the committed html is stale (plan OR docs moved)
 *   npm run roadmap -- --json  # print the parsed plan + doc bindings (schema-validated) as JSON
 */

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
  displayName: string;
  status: Status;
  requires: Requirement[];
  unlocks: string[];
  order: number;
}

interface DisplayIdentity {
  code: string;
  title: string;
  name: string;
}

function displayTitle(title: string): string {
  const withoutCode = title
    .replace(/^Phase\s+\d+\s+exit\s*[—-]\s*/i, "")
    .replace(/^Phase\s+\d+\s*·\s*/i, "")
    .replace(/^(?:\d+[a-z](?:-spine)?)(?:\s*·\s*\d+[a-z](?:-spine)?)*\s*[—-]\s*/i, "")
    .replace(/^\d+(?:\.\d+)*(?:-\d+)?(?:[a-z])?\s*·\s*/i, "")
    .trim();
  return withoutCode.length === 0 ? title : withoutCode[0]?.toUpperCase() + withoutCode.slice(1);
}

function collectDisplayIdentities(roadmap: Roadmap): Map<string, DisplayIdentity> {
  const identities = new Map<string, DisplayIdentity>();
  const add = (key: string, code: string, sourceTitle: string): void => {
    const title = displayTitle(sourceTitle);
    identities.set(key, { code, title, name: `${code} · ${title}` });
  };
  const walk = (items: Item[], parentKey: string, parentCode: string): void => {
    items.forEach((item, index) => {
      const key = item.id ?? `${parentKey}-${String(index + 1)}`;
      const localCode = /^(\d+(?:-\d+)?(?:[A-Z])?)\s*·\s*/.exec(item.title)?.[1];
      const code = localCode === undefined ? `${parentCode}.${String(index + 1)}` : `${parentCode}.${localCode}`;
      add(key, code, item.title);
      walk(item.items ?? [], key, code);
    });
  };
  roadmap.spine.forEach((node, phaseIndex) => {
    if (node.kind !== "phase") return;
    const phaseNumber = /\d+/.exec(node.phase)?.[0] ?? String(phaseIndex);
    add(node.id, `Phase ${phaseNumber}`, node.title);
    node.items.forEach((item, index) => {
      const key = item.id ?? `${node.id}-${String(index + 1)}`;
      const phasePart = new RegExp(`^${phaseNumber}[A-Z]\\s*·\\s*`).exec(item.title)?.[0]?.match(/^\d+[A-Z]/)?.[0];
      const code = phasePart ?? `${phaseNumber}.${String(index + 1)}`;
      add(key, code, item.title);
      walk(item.items ?? [], key, code);
    });
  });
  return identities;
}

function collectRegistry(roadmap: Roadmap, identities: Map<string, DisplayIdentity>): Map<string, Registered> {
  const registry = new Map<string, Registered>();
  let order = 0;
  const add = (id: string | undefined, title: string, status: Status, requires: Requirement[] | undefined): void => {
    if (id === undefined) return;
    if (registry.has(id)) throw new Error(`roadmap.json: duplicate id "${id}"`);
    registry.set(id, { id, title, displayName: identities.get(id)?.name ?? title, status, requires: requires ?? [], unlocks: [], order: order++ });
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

function renderChip(chip: Chip | undefined, fallback: Status): string {
  if (chip === undefined) return "";
  return `<span class="chip ${chip.tone ?? fallback}">${inline(chip.text)}</span>`;
}

function renderRequires(requires: Requirement[] | undefined, registry: Map<string, Registered>): string {
  if (requires === undefined || requires.length === 0) return "";
  const chips = requires.map((requirement) => {
    const met = requirementMet(requirement, registry);
    if (requirement.kind === "node") {
      const target = registry.get(requirement.ref);
      const title = target === undefined ? requirement.ref : target.displayName;
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
    return `<a class="req unl" href="#${target}" data-go="${target}"><i>→</i>${inline(t?.displayName ?? target)}</a>`;
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

function renderTable(table: Table | undefined): string {
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

/**
 * The node's binding to the plan SSOT, as a muted line under the drawer title.
 * The site is ONE static file with no server behind it, so a ref is not a link
 * — it is a `title` naming the file on disk, which is what a reader needs to
 * open it. A PHASE ref reads `doc 03.1 §2.1` and titles `docs/rebuild/03.1-*.md`;
 * the glob stands in for the slug on purpose, because this renderer is pure and
 * reading the directory to resolve `01` → `01-build-the-spine.md` would put I/O
 * in a function whose whole job is formatting. A REFERENCE ref reads
 * `ref write-safety §5` and needs no glob — an unnumbered spec IS its filename.
 */
function renderDocs(docs: DocRef[] | undefined): string {
  if (docs === undefined || docs.length === 0) return "";
  const refs = docs.map((ref) => {
    const reference = ref.kind === "reference";
    const slug = reference ? ref.doc.slice("ref:".length) : ref.doc;
    const file = reference ? `docs/rebuild/reference/${slug}.md` : `docs/rebuild/${slug}-*.md`;
    const title = ref.section === undefined ? file : `${file} §${ref.section}`;
    const label = `${reference ? "ref" : "doc"} ${slug}${ref.section === undefined ? "" : ` §${ref.section}`}`;
    return `<span class="docref" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
  });
  return `<p class="docrefs">${refs.join(" · ")}</p>`;
}

/**
 * What each session landed on this node, newest first. The sort is by date
 * only and `Array.prototype.sort` is stable, so two entries dated the same day
 * keep the order they were written in — the plan's own sequence, which is the
 * only ordering the notation records within a day.
 */
function renderLog(log: LogEntry[] | undefined): string {
  if (log === undefined || log.length === 0) return "";
  const ordered = [...log].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const items = ordered
    .map((entry) => `<li><span class="sd">${escapeHtml(entry.date)}</span> · <span class="ss">${escapeHtml(entry.session)}</span> — ${inline(entry.text)}</li>`)
    .join("");
  return `<div class="slog"><div class="dl">Session log</div><ul>${items}</ul></div>`;
}

// ─── the doc side: what the rebuild docs say about this node ───────────────

/**
 * A node's doc checklist, rolled up. `sections` counts only blocks that carry
 * at least one item — an empty block is a section nobody has assessed yet, and
 * counting it would report progress against a denominator of nothing.
 * `firstOpen` is the first not-done item in reading order (this node's docs,
 * then each child's in turn): the honest answer to "where do I start".
 */
interface DocProgress {
  done: number;
  total: number;
  sections: number;
  firstOpen: { text: string; doc: string } | undefined;
}

const NO_DOC_PROGRESS: DocProgress = { done: 0, total: 0, sections: 0, firstOpen: undefined };

/** One row of "From the docs": everything ONE document says about this node. */
interface DocSectionRow {
  doc: string;
  headings: DocHeading[];
  block: DocStatusBlock | undefined;
}

/**
 * One row per document, sorted by path so the page is a pure function of the
 * scan. A doc may tag the node from more than one section (the tags carry the
 * headings, joined) while the format allows it only ONE status block, which is
 * why the block is a single slot and the headings are a list.
 */
function docSectionRows(binding: NodeDocBinding | undefined): DocSectionRow[] {
  if (binding === undefined) return [];
  const rows = new Map<string, DocSectionRow>();
  const rowFor = (doc: string): DocSectionRow => {
    const existing = rows.get(doc);
    if (existing !== undefined) return existing;
    const fresh: DocSectionRow = { doc, headings: [], block: undefined };
    rows.set(doc, fresh);
    return fresh;
  };
  for (const tag of binding.tags) rowFor(tag.doc).headings.push(tag.heading);
  for (const block of binding.statuses) {
    const row = rowFor(block.doc);
    if (row.headings.length === 0) row.headings.push(block.heading);
    row.block = block;
  }
  return [...rows.values()].sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : 0));
}

function ownDocProgress(rows: DocSectionRow[]): DocProgress {
  let done = 0;
  let total = 0;
  let sections = 0;
  let firstOpen: DocProgress["firstOpen"];
  for (const row of rows) {
    const items = row.block?.items ?? [];
    if (items.length > 0) sections += 1;
    for (const item of items) {
      total += 1;
      if (item.box === "done") done += 1;
      else if (firstOpen === undefined) firstOpen = { text: item.text, doc: row.doc };
    }
  }
  return { done, total, sections, firstOpen };
}

function mergeDocProgress(a: DocProgress, b: DocProgress): DocProgress {
  return {
    done: a.done + b.done,
    total: a.total + b.total,
    sections: a.sections + b.sections,
    firstOpen: a.firstOpen ?? b.firstOpen,
  };
}

function docHeadingLabel(heading: DocHeading): string {
  return heading.section === undefined ? inline(heading.text) : `§${escapeHtml(heading.section)} ${inline(heading.text)}`;
}

/**
 * "From the docs": per document, the section that names this node and that
 * section's own checklist — ticks muted once done, notes newest-first like the
 * session log. A tagged section whose block is empty says so IN WORDS: "not yet
 * assessed" is a different fact from "nothing to do", and the drawer must not
 * make them look alike. A node no doc names renders nothing at all — that gap
 * is the `roadmap-doc-binding` guard's to report, not the page's.
 */
function renderFromDocs(rows: DocSectionRow[], rollup: DocProgress | undefined): string {
  if (rows.length === 0 && rollup === undefined) return "";
  const roll = rollup === undefined
    ? ""
    : `<p class="droll">docs: <b>${String(rollup.done)} of ${String(rollup.total)}</b> items done across ${String(rollup.sections)} section${rollup.sections === 1 ? "" : "s"}${
        rollup.firstOpen === undefined
          ? ""
          : ` · first open: ${inline(rollup.firstOpen.text)} <span class="dpath">${escapeHtml(rollup.firstOpen.doc)}</span>`
      }</p>`;
  const body = rows
    .map((row) => {
      const head = `<div class="dsh"><span class="dpath">${escapeHtml(row.doc)}</span> ${row.headings.map(docHeadingLabel).join(" · ")}</div>`;
      const items = row.block?.items ?? [];
      const notes = row.block?.notes ?? [];
      if (items.length === 0 && notes.length === 0) return `<div class="dsec">${head}<p class="dna">not yet assessed</p></div>`;
      const ticks = items.length === 0
        ? ""
        : `<div class="feat"><ul>${items.map((item) => `<li class="${item.box}"><i class="fm ${item.box}"></i>${inline(item.text)}</li>`).join("")}</ul></div>`;
      const ordered = [...notes].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const log = ordered.length === 0
        ? ""
        : `<div class="slog"><ul>${ordered
            .map((note) => `<li><span class="sd">${escapeHtml(note.date)}</span> · <span class="ss">${escapeHtml(note.session)}</span> — ${inline(note.text)}</li>`)
            .join("")}</ul></div>`;
      return `<div class="dsec">${head}${ticks}${log}</div>`;
    })
    .join("");
  return `<div class="fdocs"><div class="dl">From the docs</div>${roll}${body}</div>`;
}

// ─── the tree: phases run down the spine; phase parts run across; tasks run down ─

interface TreeNode {
  key: string;
  /** The node's DECLARED `{#id}`, where it has one — `key` may be a synthesised positional key, and a doc binds ids. */
  nodeId: string | undefined;
  kind: "phase" | "item" | "flag";
  status: Status;
  title: string;
  code: string;
  eyebrow: string | undefined;
  whenSecondary: string | undefined;
  chip: Chip | undefined;
  size: Item["size"];
  docs: DocRef[] | undefined;
  features: ResolvedFeature[];
  requires: Requirement[];
  detail: string;
  /** "From the docs", filled by `attachDocs` once the subtree exists — a roll-up needs its children. */
  docHtml: string;
  docProgress: DocProgress;
  children: TreeNode[];
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rowCenter: number;
}

const NODE_W = 252;
const NODE_H = 96;
const PHASE_H = 108;
const COL_STEP = 276;   // one phase-part column (NODE_W + 24)
const SUB_GAP = 12;     // between stacked sub-tasks
const INDENT = 18;      // each nesting level steps right and narrows by this
const PAD = 28;
const BAND_GAP = 72;    // between phase bands
const FLAG_H = 44;
const TODAY_H = 40;
const CHILD_X = PAD + NODE_W + 64; // tasks start to the right of the phase column

function buildItemNode(item: Item, parentKey: string, index: number, registry: Map<string, Registered>, identities: Map<string, DisplayIdentity>): TreeNode {
  const key = item.id ?? `${parentKey}-${String(index + 1)}`;
  const identity = identities.get(key) ?? { code: key, title: item.title, name: item.title };
  const features = resolveFeatures(item.features, item.status);
  const detail = [
    item.desc === undefined ? "" : `<p class="desc">${inline(item.desc)}</p>`,
    renderFeatures(features, item.status),
    renderRequires(item.requires, registry),
    item.id === undefined ? "" : renderUnlocks(item.id, registry),
    renderTable(item.table),
    renderNotes(item.notes),
    renderLog(item.log),
  ].join("");
  return {
    key,
    nodeId: item.id,
    kind: "item",
    status: item.status,
    title: identity.title,
    code: identity.code,
    eyebrow: item.date,
    whenSecondary: undefined,
    chip: item.chip,
    size: item.size,
    docs: item.docs,
    features,
    requires: item.requires ?? [],
    detail,
    docHtml: "",
    docProgress: NO_DOC_PROGRESS,
    children: (item.items ?? [])
      .filter((child) => child.status !== "never")
      .map((child, i) => buildItemNode(child, key, i, registry, identities)),
    depth: 0, x: 0, y: 0, w: NODE_W, h: NODE_H, rowCenter: 0,
  };
}

function buildPhaseNode(node: PhaseNode, registry: Map<string, Registered>, identities: Map<string, DisplayIdentity>): TreeNode {
  const features = resolveFeatures(node.features, node.status);
  const identity = identities.get(node.id) ?? { code: node.phase, title: node.title, name: node.title };
  const parts = node.items
    .filter((item) => item.status !== "never")
    .map((item, i) => buildItemNode(item, node.id, i, registry, identities));
  parts.sort((left, right) => {
    const leftCode = /^(\d+)([a-z])\b/i.exec(left.title);
    const rightCode = /^(\d+)([a-z])\b/i.exec(right.title);
    if (leftCode === null || rightCode === null) return 0;
    const phaseDifference = Number(leftCode[1]) - Number(rightCode[1]);
    return phaseDifference !== 0
      ? phaseDifference
      : (leftCode[2] ?? "").localeCompare(rightCode[2] ?? "", "en", { sensitivity: "base" });
  });
  const detail = [
    `<p class="desc">${inline(node.summary)}</p>`,
    renderFeatures(features, node.status),
    renderRequires(node.requires, registry),
    renderUnlocks(node.id, registry),
    renderNotes(node.notes),
    renderLog(node.log),
  ].join("");
  return {
    key: node.id,
    nodeId: node.id,
    kind: "phase",
    status: node.status,
    title: identity.title,
    code: identity.code,
    eyebrow: `${node.phase} · ${node.when.primary}`,
    whenSecondary: node.when.secondary,
    chip: node.chip,
    size: node.size,
    docs: node.docs,
    features,
    requires: node.requires ?? [],
    detail,
    docHtml: "",
    docProgress: NO_DOC_PROGRESS,
    children: parts,
    depth: 0, x: 0, y: 0, w: NODE_W, h: PHASE_H, rowCenter: 0,
  };
}

/**
 * Hang the docs' own status on the tree, bottom-up: every node's `docProgress`
 * covers its WHOLE SUBTREE (a phase's count is its tasks' counts, which is the
 * only reading that answers "how much of this phase have the docs closed"), and
 * a node with children also prints the roll-up line. Mutates in place like the
 * layout pass does, and for the same reason: a roll-up is a fact about a node
 * AND its descendants, so it cannot be computed while the node is being built.
 */
function attachDocs(node: TreeNode, docs: DocBindingIndex): DocProgress {
  const rows = docSectionRows(node.nodeId === undefined ? undefined : docs.get(node.nodeId));
  let progress = ownDocProgress(rows);
  for (const child of node.children) progress = mergeDocProgress(progress, attachDocs(child, docs));
  node.docProgress = progress;
  node.docHtml = renderFromDocs(rows, node.children.length > 0 && progress.total > 0 ? progress : undefined);
  return progress;
}

/** Stack a phase part's tasks beneath it; deeper detail stays in the same readable column. */
function stack(node: TreeNode, depth: number, yCursor: number): number {
  let y = yCursor;
  for (const child of node.children) {
    child.depth = depth;
    child.w = NODE_W - INDENT * (depth - 1);
    child.h = NODE_H;
    child.x = node.x + INDENT;
    child.y = y;
    y = stack(child, depth + 1, y + NODE_H + SUB_GAP);
  }
  return y;
}

/**
 * A phase band follows one grammar at every scale: the phase sits on the left
 * spine, its named parts form one horizontal row, and each part owns one
 * vertical task list. Parts never wrap into an ambiguous second row.
 */
function layoutPhase(root: TreeNode, bandTop: number): number {
  root.depth = 0;
  root.x = PAD;
  root.y = bandTop;
  root.w = NODE_W;
  root.h = PHASE_H;
  let bottom = bandTop + PHASE_H;
  root.children.forEach((task, index) => {
    task.depth = 1;
    task.w = NODE_W;
    task.h = NODE_H;
    task.x = CHILD_X + index * COL_STEP;
    task.y = bandTop + (PHASE_H - NODE_H) / 2;
    const end = stack(task, 2, task.y + NODE_H + SUB_GAP) - SUB_GAP;
    bottom = Math.max(bottom, end);
  });
  return bottom - bandTop;
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

function nodeStatusLabel(node: TreeNode, available: boolean): string {
  if (node.status === "done") return "COMPLETE";
  if (node.status === "active") return "ACTIVE";
  if (node.status === "you") return "NEEDS YOU";
  if (node.status === "proposed") return "PROPOSED";
  if (node.status === "never") return "DEFERRED";
  return available ? "READY" : "BLOCKED";
}

const N = (value: number): string => String(Math.round(value * 10) / 10);

/** The phase's rail: one straight reading line from the phase into its ordered parts. */
function busConnector(root: TreeNode): string {
  if (root.children.length === 0) return "";
  const py = root.y + root.h / 2;
  const last = root.children[root.children.length - 1];
  if (last === undefined) return "";
  return `M${N(root.x + root.w)},${N(py)} H${N(last.x)}`;
}

/** A task list: one vertical rail down from its phase part, with short stubs into each task. */
function stackConnector(parent: TreeNode): string {
  if (parent.children.length === 0) return "";
  const x = parent.x + 10;
  const last = parent.children[parent.children.length - 1];
  if (last === undefined) return "";
  const stubs = parent.children.map((c) => `M${N(x)},${N(c.y + 20)} H${N(c.x)}`).join(" ");
  return `M${N(x)},${N(parent.y + parent.h)} V${N(last.y + 20)} ${stubs}`;
}

interface Band {
  kind: "flag" | "today";
  top: number;
  status: Status;
  key: string;
  text: string;
}

function renderCanvas(roadmap: Roadmap, registry: Map<string, Registered>, docs: DocBindingIndex, identities: Map<string, DisplayIdentity>): { svg: string; data: Record<string, { title: string; html: string; requires: string[]; unlocks: string[]; parent: string | null; children: string[] }> } {
  const roots: TreeNode[] = [];
  const bands: Band[] = [];
  let cursor = PAD;
  let flagIndex = 0;
  for (const node of roadmap.spine) {
    if (node.kind === "phase") {
      if (node.status === "never") continue;
      const root = buildPhaseNode(node, registry, identities);
      attachDocs(root, docs);
      const bandHeight = layoutPhase(root, cursor);
      roots.push(root);
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

  // tree edges (containment): the phase bus, then stacked lists under every task
  const treeEdges = [
    ...roots.map((root) => `<path class="te" d="${busConnector(root)}"/>`),
    ...all.filter((n) => n.kind === "item" && n.children.length > 0).map((n) => `<path class="te" d="${stackConnector(n)}"/>`),
  ].join("");

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

  // the spine through every phase root, plus milestone and today bands
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
      const pillW = N(Math.min(width - spineX - 14 - PAD, 760));
      const y = band.top + FLAG_H / 2;
      const label = wrapTitle(band.text.replace(/\*\*/g, "").replace(/`/g, ""), 110, 1)[0] ?? "";
      return `<a class="nd flag ${band.status}" href="#${band.key}" data-key="${band.key}" aria-label="${escapeHtml(label)}"><g><circle cx="${N(spineX)}" cy="${N(y)}" r="6"/><rect x="${N(spineX + 14)}" y="${N(y - 14)}" width="${pillW}" height="28" rx="14"/><text x="${N(spineX + 28)}" y="${N(y)}" dy="0.35em">${escapeHtml(label)}</text></g></a>`;
    })
    .join("");

  // nodes
  const nodeSvg = all
    .map((node) => {
      const isPhase = node.kind === "phase";
      const available = node.requires.every((r) => requirementMet(r, registry));
      const cls = `nd ${node.kind} ${node.status}${available ? " avail" : " locked"}`;
      const stateLabel = nodeStatusLabel(node, available);
      const titleLines = wrapTitle(node.title, isPhase ? 27 : Math.floor((node.w - 32) / 7.3), 2);
      const titleY = isPhase ? node.y + 49 : node.y + 42;
      const title = titleLines
        .map((line, i) => `<tspan x="${N(node.x + 16)}" dy="${i === 0 ? 0 : 17}">${escapeHtml(line)}</tspan>`)
        .join("");
      const eyebrow = isPhase && node.eyebrow !== undefined
        ? `<text class="eb" x="${N(node.x + 16)}" y="${N(node.y + 21)}">${escapeHtml(wrapTitle((`${node.code} · ${node.eyebrow.replace(/^Phase\s+\d+\s*·\s*/i, "")}`).toUpperCase(), Math.floor((node.w - 32) / 5.8), 1)[0] ?? "")}</text>`
        : `<text class="task-code" x="${N(node.x + 16)}" y="${N(node.y + 20)}">${escapeHtml(node.code)}</text>`;
      const dotY = isPhase ? node.y + node.h - 17 : node.y + 17;
      const stateX = isPhase ? node.x + 28 : node.x + node.w - 16;
      const dotX = isPhase ? node.x + 16 : stateX - stateLabel.length * 6.1 - 10;
      const dot = `<circle class="st" cx="${N(dotX)}" cy="${N(dotY)}" r="4.5"/>`;
      const state = `<text class="state" x="${N(stateX)}" y="${N(dotY)}" dy="0.35em"${isPhase ? "" : ' text-anchor="end"'}>${stateLabel}</text>`;
      // the info line: an item's chip (in its tone) or its date / decision
      const infoText = !isPhase && node.chip !== undefined ? node.chip.text.replace(/\*\*/g, "") : !isPhase && node.eyebrow !== undefined ? node.eyebrow : undefined;
      const infoTone = !isPhase && node.chip !== undefined ? (node.chip.tone ?? node.status) : "meta";
      const info = infoText === undefined
        ? ""
        : `<text class="info ${infoTone}" x="${N(node.x + 16)}" y="${N(node.y + 72)}">${escapeHtml(wrapTitle(infoText, Math.floor((node.w - 32) / 5.8), 1)[0] ?? "")}</text>`;
      const built = node.features.filter((f) => f.status === "done").length;
      const countText = node.features.length === 0 ? "" : `${String(built)} / ${String(node.features.length)} built`;
      const rightText = [node.size, countText].filter((t): t is string => t !== undefined && t.length > 0).join(" · ");
      const right = rightText.length === 0 ? "" : `<text class="meta" x="${N(node.x + node.w - 16)}" y="${N(node.y + node.h - 9)}" text-anchor="end">${escapeHtml(rightText)}</text>`;
      // Phase chips summarize several child states and do not fit beside the
      // phase status. Their complete text remains first-class in the
      // inspector; the card keeps one unambiguous state line.
      const phaseBar = isPhase ? "" : info;
      // the doc-progress tick: a hairline along the card's bottom edge, below
      // the card's metadata, so it adds a reading without
      // taking any room. Absent when no doc has assessed this node's subtree.
      const doc = node.docProgress;
      const tickW = node.w - 24;
      const tick = doc.total === 0
        ? ""
        : `<rect class="dpt" x="${N(node.x + 12)}" y="${N(node.y + node.h - 4)}" width="${N(tickW)}" height="2" rx="1"/><rect class="dpt on" x="${N(node.x + 12)}" y="${N(node.y + node.h - 4)}" width="${N((tickW * doc.done) / doc.total)}" height="2" rx="1"/>`;
      const spokenProgress = node.features.length === 0 ? "" : `, ${String(built)} of ${String(node.features.length)} outputs built`;
      return `<a class="${cls}" href="#${node.key}" data-key="${node.key}" aria-label="${escapeHtml(`${node.code}, ${node.title}, ${stateLabel.toLowerCase()}${spokenProgress}`)}"><g><rect class="bx" x="${N(node.x)}" y="${N(node.y)}" width="${N(node.w)}" height="${N(node.h)}" rx="8"/>${eyebrow}${dot}${state}<text class="tt" x="${N(node.x + 16)}" y="${N(titleY)}">${title}</text>${phaseBar}${isPhase ? "" : right}${tick}</g></a>`;
    })
    .join("");

  const svg = `<svg id="canvas" class="tree" viewBox="0 0 ${N(width)} ${N(height)}" width="${N(width)}" height="${N(height)}" role="group" aria-label="Roadmap tree">${spine}${treeEdges}${reqEdges}${bandSvg}${nodeSvg}</svg>`;

  const parentOf = new Map<string, string>();
  for (const node of all) for (const child of node.children) parentOf.set(child.key, node.key);
  const data: Record<string, { title: string; html: string; requires: string[]; unlocks: string[]; parent: string | null; children: string[] }> = {};
  for (const node of all) {
    const entry = registry.get(node.key);
    const chip = node.chip !== undefined && node.chip.text.toLowerCase() === node.status ? undefined : node.chip;
    const docn = node.docProgress.total === 0
      ? ""
      : `<span class="docn" title="doc checklist items done — this node and everything under it">${String(node.docProgress.done)}/${String(node.docProgress.total)} docs</span>`;
    const header = `<div class="dh"><span class="chip ${node.status}">${node.status === "you" ? "needs you" : node.status}</span>${renderChip(chip, node.status)}${node.size === undefined ? "" : `<span class="size">${node.size}</span>`}${docn}${node.eyebrow === undefined ? "" : `<span class="eb2">${inline(node.eyebrow)}${node.kind === "phase" && node.whenSecondary !== undefined ? ` · ${inline(node.whenSecondary)}` : ""}</span>`}</div>`;
    data[node.key] = {
      title: `${node.code} · ${node.title}`,
      // title → chip/status + n/m docs → doc: refs → summary → builds → needs
      // → unlocks → table → notes → session log (`detail`) → from the docs
      html: header + renderDocs(node.docs) + node.detail + node.docHtml,
      requires: node.requires.flatMap((r) => (r.kind === "node" ? [r.ref] : [])),
      unlocks: entry?.unlocks ?? [],
      parent: parentOf.get(node.key) ?? null,
      children: node.children.map((c) => c.key),
    };
  }
  for (const band of bands) {
    if (band.kind === "flag") {
      data[band.key] = { title: "Milestone", html: `<p class="desc">${inline(band.text)}</p>`, requires: [], unlocks: [], parent: null, children: [] };
      continue;
    }
  }
  return { svg, data };
}

// ─── page ──────────────────────────────────────────────────────────────────

/*
 * THESIS: A roadmap should read like an operations map, not a miniature dashboard trapped inside every node.
 * OWN-WORLD: Cool paper and ink, one cobalt action accent, semantic green/amber/blue, fine route lines.
 * STORY: Scan the phase spine, follow one workstream, inspect a node, then return to the full plan without losing place.
 * FIRST VIEWPORT: Compact command bar and facts above a full-height map, with a stable inspector rail at the right.
 * FORM: Desktop master-detail operations map; predictable structure, dense data, and no modal interruption.
 */
const CSS = String.raw`
  :root {
    color-scheme:light dark;
    --bg:#f3f6f8; --grid:rgba(28,45,61,.08); --card:#ffffff; --well:#edf2f5; --fg:#13202b; --fg-2:#3b4b59; --fg-3:#607180; --fg-4:#8996a3;
    --line:#dce3e8; --line-strong:#aebbc5; --accent:#2457d6; --accent-quiet:#e8eefc;
    --ok:#087554; --ok-mark:#0b8f67; --ok-quiet:#e1f3ed; --info:#096b9b; --info-mark:#1293cf; --info-quiet:#e2f2fa;
    --warn:#9a5700; --warn-mark:#d97706; --warn-quiet:#fff0d8; --danger:#b42318;
    --scrim:rgba(14,25,35,.18); --sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; --mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#0e151b; --grid:rgba(206,225,239,.07); --card:#172129; --well:#111a21; --fg:#edf4f7; --fg-2:#c2ced5; --fg-3:#93a3ad; --fg-4:#687984;
    --line:#283640; --line-strong:#4b5d68; --accent:#86a8ff; --accent-quiet:#1f335f;
    --ok:#50c89b; --ok-mark:#32b487; --ok-quiet:#153a30; --info:#66b9df; --info-mark:#42a7d5; --info-quiet:#17394a;
    --warn:#f5af54; --warn-mark:#e89023; --warn-quiet:#493018; --danger:#ff8d83; --scrim:rgba(0,0,0,.34);
  } }
  :root[data-theme="dark"] {
    --bg:#0e151b; --grid:rgba(206,225,239,.07); --card:#172129; --well:#111a21; --fg:#edf4f7; --fg-2:#c2ced5; --fg-3:#93a3ad; --fg-4:#687984;
    --line:#283640; --line-strong:#4b5d68; --accent:#86a8ff; --accent-quiet:#1f335f;
    --ok:#50c89b; --ok-mark:#32b487; --ok-quiet:#153a30; --info:#66b9df; --info-mark:#42a7d5; --info-quiet:#17394a;
    --warn:#f5af54; --warn-mark:#e89023; --warn-quiet:#493018; --danger:#ff8d83; --scrim:rgba(0,0,0,.34);
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;min-width:1024px;background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;min-height:100dvh;overflow:hidden}
  a{color:var(--info);text-decoration:none} a:hover{text-decoration:underline}
  code{font-family:var(--mono);font-size:.92em;background:var(--well);padding:0 4px;border-radius:3px}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  button{min-height:34px;font:600 12px/1 var(--sans);padding:0 11px;border-radius:6px;border:1px solid var(--line-strong);background:var(--card);color:var(--fg-2);cursor:pointer}
  button:hover{border-color:var(--fg-3);background:var(--well);color:var(--fg)} button:active{background:var(--accent-quiet)} button[aria-pressed="true"]{background:var(--accent-quiet);border-color:var(--accent);color:var(--accent)}
  .skip{position:fixed;inset:8px auto auto 8px;z-index:10;transform:translateY(-150%);padding:8px 12px;background:var(--card);border:1px solid var(--accent);color:var(--fg)} .skip:focus{transform:none}

  /* App chrome */
  .mast{padding:12px 18px;border-bottom:1px solid var(--line);background:var(--card);display:flex;align-items:center;justify-content:space-between;gap:20px;flex:none}
  .hd{min-width:0}.title-line{display:flex;align-items:baseline;gap:12px}.hd p{margin:4px 0 0;max-width:72ch;color:var(--fg-3);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  h1{font-size:20px;line-height:1.15;margin:0;font-weight:650;letter-spacing:-.025em;text-wrap:balance}
  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3);white-space:nowrap}
  .ctl{display:flex;gap:8px;align-items:center;flex:none}.control-group{display:flex;align-items:center}.control-group button{border-radius:0;margin-left:-1px}.control-group button:first-child{border-radius:6px 0 0 6px;margin-left:0}.control-group button:last-child{border-radius:0 6px 6px 0}.icon-control{width:34px;padding:0;font-size:17px;font-weight:400}.pct{height:34px;min-width:52px;border-block:1px solid var(--line-strong);display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;color:var(--fg-3);background:var(--well)}
  .tiles{display:flex;gap:8px;padding:8px 18px;border-bottom:1px solid var(--line);background:var(--bg);overflow-x:auto;flex:none}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 10px;min-width:max-content;display:flex;align-items:baseline;gap:8px;font-size:12px}
  .tile .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3)}
  .tile .v{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums} .tile .s{font-size:11px;color:var(--fg-3)}
  .tile.hot{border-color:var(--warn-mark);background:var(--warn-quiet)} .tile.hot .v{color:var(--warn)}
  .legend{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px;font-size:12.5px;color:var(--fg-2);margin:8px 0 14px}.legend span{display:flex;align-items:center;gap:7px}
  .sw{width:11px;height:11px;border-radius:50%;border:2px solid var(--line-strong);background:var(--card);flex:none}
  .sw.done{background:var(--ok-mark);border-color:var(--ok-mark)} .sw.active{background:var(--info-mark);border-color:var(--info-mark)}
  .sw.you{background:var(--warn-mark);border-color:var(--warn-mark)} .sw.proposed{background:var(--accent);border-color:var(--accent)} .sw.never{background:transparent;border-style:dashed}
  .sw.avail{border-color:var(--fg-2);border-width:2.5px} .sw.locked{border-style:dashed}
  .lay{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;font-weight:600;padding:1px 5px;border-radius:3px;border:1px solid var(--line);color:var(--fg-3);background:var(--well);display:inline-block;vertical-align:middle;line-height:1.5;margin:0 4px 1px 0}
  .lay.frontend{color:var(--info);border-color:var(--info-quiet);background:var(--info-quiet)} .lay.backend{color:var(--fg-2);border-color:var(--line-strong)}
  .lay.both{color:var(--accent);border-color:var(--accent-quiet);background:var(--accent-quiet)} .lay.wiring{color:var(--warn);border-color:var(--warn-quiet);background:var(--warn-quiet)}
  .work{display:grid;grid-template-columns:minmax(0,1fr) 420px;flex:1;min-height:0;overflow:hidden}.work.panel-closed{grid-template-columns:minmax(0,1fr) 0}
  .canvas{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;background:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px),var(--bg);background-size:24px 24px;cursor:grab}
  .canvas:active{cursor:grabbing}
  .tree{display:block;font-family:var(--sans);transform-origin:0 0}
  .drawer{min-width:0;overflow:auto;background:var(--card);border-left:1px solid var(--line);padding:18px 20px 28px;font-size:13.5px}
  .drawer[hidden]{display:none}
  .dtop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--line);position:sticky;top:-18px;background:var(--card);z-index:1;padding-top:18px}
  .drawer h2{font-size:18px;margin:0;line-height:1.25;font-weight:650;letter-spacing:-.015em;text-wrap:balance}
  #drawer-close{width:34px;padding:0;font-size:17px;line-height:1;flex:none}
  .drawer .hint{color:var(--fg-2);font-size:13px;margin:0 0 10px;max-width:65ch}
  .dh{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px} .eb2{font-family:var(--mono);font-size:11px;color:var(--fg-3)}
  .key-section{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.key-section h3{font-size:13px;margin:0 0 8px;font-weight:650}.key-list{display:grid;gap:8px;margin:0}.key-row{display:grid;grid-template-columns:92px 1fr;gap:12px;align-items:start}.key-row dt{font:600 11px/1.5 var(--mono);color:var(--fg-3)}.key-row dd{margin:0;color:var(--fg-2);font-size:12.5px}.sample-line{display:inline-block;width:30px;border-top:2px solid var(--line-strong);vertical-align:middle;margin-right:5px}.sample-line.req-open{border-color:var(--accent);border-top-style:dashed}.sample-line.req-met{border-color:var(--ok-mark)}
  .doc-rule{display:inline-block;width:48px;height:4px;background:linear-gradient(90deg,var(--fg-3) 60%,var(--line-strong) 60%);border-radius:2px;vertical-align:2px;margin-right:5px}

  /* Roadmap map */
  .tree .spine{stroke:var(--line-strong);stroke-width:2.5}
  .tree .te{fill:none;stroke:var(--line-strong);stroke-width:1.5}
  .tree .rq{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:5 4;opacity:0;pointer-events:none}
  .tree .rq.met{stroke:var(--ok-mark)} .tree .rq.on{opacity:.95} .tree.show-all .rq{opacity:.45} .tree.show-all .rq.on{opacity:1}
  .tree .nd{cursor:pointer}.tree .nd:hover{text-decoration:none}.tree .nd:hover .bx{fill:var(--well);stroke:var(--fg-3)}.tree .nd:focus{outline:none}.tree .nd:focus-visible .bx{stroke:var(--accent);stroke-width:2.5}
  .tree .bx{fill:var(--card);stroke:var(--line-strong);stroke-width:1.25}
  .tree .tt{fill:var(--fg);font-size:13.5px;font-weight:620;letter-spacing:-.01em}.tree .phase .tt{font-size:15px;font-weight:680}
  .tree .eb{fill:var(--fg-3);font-family:var(--mono);font-size:9.5px;letter-spacing:.06em}
  .tree .task-code{fill:var(--accent);font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.045em}
  .tree .state{fill:var(--fg-3);font-family:var(--mono);font-size:9px;font-weight:650;letter-spacing:.06em}.tree .done .state{fill:var(--ok)}.tree .active .state{fill:var(--info)}.tree .you .state{fill:var(--warn)}.tree .proposed .state{fill:var(--accent)}
  .tree .meta{fill:var(--fg-3);font-family:var(--mono);font-size:9px;font-variant-numeric:tabular-nums}
  .tree .info{font-family:var(--mono);font-size:9.5px;fill:var(--fg-3)} .tree .info.done{fill:var(--ok)} .tree .info.active{fill:var(--info)} .tree .info.you{fill:var(--warn)} .tree .info.proposed{fill:var(--accent)} .tree .info.never{fill:var(--fg-4)}
  .tree .st{fill:var(--card);stroke:var(--line-strong);stroke-width:2}
  .tree .done .st{fill:var(--ok-mark);stroke:var(--ok-mark)} .tree .active .st{fill:var(--info-mark);stroke:var(--info-mark)}
  .tree .you .st{fill:var(--warn-mark);stroke:var(--warn-mark)} .tree .proposed .st{fill:var(--accent);stroke:var(--accent)} .tree .never .st{stroke-dasharray:2 2}
  .tree .done .bx{stroke:color-mix(in srgb,var(--ok-mark) 45%,var(--line-strong))}
  .tree .active .bx{fill:var(--info-quiet);stroke:var(--info-mark);stroke-width:2}
  .tree .you .bx{fill:var(--warn-quiet);stroke:var(--warn-mark);stroke-width:2}
  .tree .proposed .bx{stroke:var(--accent);stroke-dasharray:5 3}
  .tree .never .bx{stroke-dasharray:3 3;fill:transparent} .tree .never .tt{fill:var(--fg-3)}
  .tree .planned.locked .bx{stroke-dasharray:4 3} .tree .planned.locked .tt{fill:var(--fg-2)}
  .tree .planned.avail .bx{stroke:var(--fg-2);stroke-width:2}
  .tree .phase .bx{stroke-width:2}
  .tree .nd.sel .bx{stroke:var(--accent);stroke-width:3;stroke-dasharray:none}.tree .nd.rel:not(.sel) .bx{stroke:var(--accent);stroke-width:1.75}
  /* The doc-progress rule is deliberately quiet and is explained in the guide. */
  .tree .dpt{fill:var(--line-strong)} .tree .dpt.on{fill:var(--fg-3)}
  .tree .flag rect{fill:var(--well);stroke:var(--line)} .tree .flag circle{fill:var(--ok-mark)} .tree .flag text{fill:var(--fg-2);font-size:11.5px}
  .tree .today line{stroke:var(--accent);stroke-width:2;stroke-dasharray:6 5} .tree .today circle{fill:var(--accent)} .tree .today text{fill:var(--accent);font-family:var(--mono);font-size:10.5px;letter-spacing:.06em}

  /* Inspector content */
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
  .docrefs{margin:-4px 0 10px;font-family:var(--mono);font-size:11px;color:var(--fg-4);line-height:1.7}
  .docref{color:var(--fg-3);border-bottom:1px dotted var(--line-strong);cursor:help;white-space:nowrap}
  .slog{margin-top:4px} .slog ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
  .slog li{color:var(--fg-2);font-size:12.5px;padding-left:9px;border-left:2px solid var(--line)}
  .slog .sd{font-family:var(--mono);font-size:11px;color:var(--fg-3);font-variant-numeric:tabular-nums}
  .slog .ss{font-family:var(--mono);font-size:11px;color:var(--accent)}
  /* ─ from the docs: the doc sections' own checklists ─ */
  .docn{font-family:var(--mono);font-size:10.5px;color:var(--fg-3);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
  .droll{margin:0 0 2px;font-size:12.5px;color:var(--fg-2)} .droll b{color:var(--fg);font-weight:600}
  .fdocs .dsec{margin-top:9px;padding-left:9px;border-left:2px solid var(--line)}
  .fdocs .dsh{font-family:var(--mono);font-size:10.5px;line-height:1.6;color:var(--fg-3);overflow-wrap:anywhere}
  .fdocs .dsh code{font-size:1em;background:none;padding:0}
  .fdocs .dpath{color:var(--fg-4)}
  .fdocs .feat{margin-top:3px} .fdocs .feat li{font-size:12.5px} .fdocs .feat li.done{color:var(--fg-4)}
  .fdocs .slog{margin-top:6px} .fdocs .slog li{border-left:none;padding-left:0}
  .fdocs .dna{margin:2px 0 0;font-size:12px;color:var(--fg-4);font-style:italic}
  .note{margin:10px 0 0;padding:9px 12px;border-radius:8px;background:var(--well);border:1px solid var(--line);font-size:12.5px;color:var(--fg-2)}
  .note.you{border-color:var(--warn-mark);background:var(--warn-quiet)} .note.you b{color:var(--warn)}
  footer{padding:5px 18px;border-top:1px solid var(--line);font-size:10.5px;color:var(--fg-3);background:var(--card);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
`;

const JS = String.raw`
(function(){
  var data = JSON.parse(document.getElementById('rm-data').textContent);
  var svg = document.getElementById('canvas');
  var canvas = document.getElementById('canvas-wrap');
  var drawer = document.getElementById('drawer-body');
  var panel = document.getElementById('drawer');
  var work = document.getElementById('work');
  var aboutBtn = document.getElementById('about');
  var aboutHtml = drawer.innerHTML;
  var title = document.getElementById('drawer-title');
  var baseW = parseFloat(svg.getAttribute('width'));
  var baseH = parseFloat(svg.getAttribute('height'));
  var scale = 1;
  var selected = null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function nodes(){ return svg.querySelectorAll('.nd'); }
  function edges(){ return svg.querySelectorAll('.rq'); }
  function openPanel(){ panel.hidden = false; work.classList.remove('panel-closed'); aboutBtn.setAttribute('aria-expanded', 'true'); }
  function edgeOn(key, on){
    edges().forEach(function(e){ if (e.getAttribute('data-from') === key || e.getAttribute('data-to') === key) e.classList.toggle('on', on); });
  }
  function clearHover(){ edges().forEach(function(e){ e.classList.remove('on'); }); if (selected) edgeOn(selected, true); }
  function clearSelection(){
    selected = null;
    nodes().forEach(function(n){ n.classList.remove('sel'); n.classList.remove('rel'); });
    edges().forEach(function(e){ e.classList.remove('on'); });
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }
  function showGuide(){
    clearSelection();
    title.textContent = 'How to read this roadmap';
    drawer.innerHTML = aboutHtml;
    drawer.scrollTop = 0;
    openPanel();
    aboutBtn.setAttribute('aria-pressed', 'true');
  }
  function closePanel(){
    clearSelection();
    panel.hidden = true;
    work.classList.add('panel-closed');
    aboutBtn.setAttribute('aria-pressed', 'false');
    aboutBtn.setAttribute('aria-expanded', 'false');
  }
  function select(key, scroll){
    if (!data[key]) return;
    selected = key;
    nodes().forEach(function(n){ n.classList.toggle('sel', n.getAttribute('data-key') === key); n.classList.remove('rel'); });
    edges().forEach(function(e){ e.classList.remove('on'); });
    edgeOn(key, true);
    var related = {}; related[key] = true;
    data[key].requires.forEach(function(k){ related[k] = true; });
    data[key].unlocks.forEach(function(k){ related[k] = true; });
    (function down(k){ related[k] = true; (data[k] ? data[k].children : []).forEach(down); })(key);
    (function up(k){ var p = data[k] && data[k].parent; if (p) { related[p] = true; up(p); } })(key);
    nodes().forEach(function(n){ if (related[n.getAttribute('data-key')]) n.classList.add('rel'); });
    openPanel();
    aboutBtn.setAttribute('aria-pressed', 'false');
    title.textContent = data[key].title;
    drawer.innerHTML = data[key].html;
    drawer.scrollTop = 0;
    if (history.replaceState) history.replaceState(null, '', '#' + key);
    if (scroll) {
      var el = svg.querySelector('.nd[data-key="' + key + '"] .bx, .nd[data-key="' + key + '"] rect');
      if (el) {
        var x = (parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2) * scale;
        var y = (parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2) * scale;
        canvas.scrollTo({ left: Math.max(0, x - canvas.clientWidth / 2), top: Math.max(0, y - canvas.clientHeight / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
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
  document.getElementById('drawer-close').addEventListener('click', closePanel);
  aboutBtn.addEventListener('click', showGuide);
  window.addEventListener('keydown', function(ev){ if (ev.key === 'Escape') { if (selected) showGuide(); else closePanel(); } });
  var showAll = document.getElementById('show-all');
  showAll.addEventListener('click', function(){ var on = svg.classList.toggle('show-all'); showAll.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  // drag to pan
  var drag = null;
  var dragged = false;
  canvas.addEventListener('mousedown', function(ev){ if (ev.target.closest('.nd')) return; drag = { x: ev.clientX, y: ev.clientY, l: canvas.scrollLeft, t: canvas.scrollTop }; dragged = false; });
  window.addEventListener('mousemove', function(ev){ if (!drag) return; if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 4) dragged = true; canvas.scrollLeft = drag.l - (ev.clientX - drag.x); canvas.scrollTop = drag.t - (ev.clientY - drag.y); });
  window.addEventListener('mouseup', function(){ drag = null; });
  canvas.addEventListener('click', function(ev){
    if (ev.target.closest('.nd')) return;
    if (dragged) { dragged = false; return; }
    if (selected) showGuide();
  });
  var initial = location.hash.replace('#', '');
  if (initial && data[initial]) select(initial, true); else showGuide();
})();
`;

function renderPage(roadmap: Roadmap, docs: DocBindingIndex): string {
  const identities = collectDisplayIdentities(roadmap);
  const registry = collectRegistry(roadmap, identities);
  const { svg, data } = renderCanvas(roadmap, registry, docs, identities);
  const tiles = roadmap.tiles
    .map((t) => `<div class="tile${t.hot ? " hot" : ""}"><div class="k">${inline(t.label)}</div><div class="v">${inline(t.value)}</div>${t.sub === undefined ? "" : `<div class="s">${inline(t.sub)}</div>`}</div>`)
    .join("");
  const dataJson = JSON.stringify(data).replaceAll("<", "\\u003c");
  const aboutHtml = `<p class="hint">${inline(roadmap.meta.lede)}</p>
<section class="key-section"><h3>Read the structure</h3><p class="hint">Numbered phases run down the left spine. Phase parts run left to right, and each part's tasks stack beneath it. Every task name starts with its full path, so <code>3.1.1</code> is serial task 1 inside part 3.1. Parallel peers share a wave number: <code>3.1.9-1</code> and <code>3.1.9-2</code> are separate supervisor tasks executed together in wave 9. Select any node to inspect its full record; click blank map space to return here.</p></section>
<section class="key-section"><h3>Node status</h3><div class="legend" aria-label="Node status legend">
<span><i class="sw done"></i>Complete</span><span><i class="sw active"></i>Active now</span><span><i class="sw you"></i>Needs you</span><span><i class="sw avail"></i>Ready next</span><span><i class="sw locked"></i>Blocked</span><span><i class="sw proposed"></i>Proposed</span>
</div></section>
<section class="key-section"><h3>Inside each node</h3><dl class="key-list">
<div class="key-row"><dt><span class="lay frontend">FE</span> <span class="lay backend">BE</span></dt><dd>Frontend and backend work. <span class="lay both">BOTH</span> is a vertical slice; <span class="lay wiring">WIRE</span> connects existing halves; <span class="lay docs">DOCS</span> changes authority; <span class="lay proof">PROOF</span> is measured or live evidence.</dd></div>
<div class="key-row"><dt>S / M / L / XL</dt><dd>Estimated implementation size.</dd></div>
<div class="key-row"><dt>7 / 9 built</dt><dd>Outputs landed at the roadmap's recorded HEAD.</dd></div>
<div class="key-row"><dt>D329</dt><dd>A ratified decision in the decision index.</dd></div>
<div class="key-row"><dt><i class="doc-rule"></i></dt><dd>The thin bottom rule is documentation progress: dark is complete, light is still open.</dd></div>
</dl></section>
<section class="key-section"><h3>Lines and controls</h3><dl class="key-list">
<div class="key-row"><dt><i class="sample-line"></i></dt><dd>Solid gray lines show the plan hierarchy.</dd></div>
<div class="key-row"><dt><i class="sample-line req-met"></i></dt><dd>Green dependency lines mean the prerequisite is complete.</dd></div>
<div class="key-row"><dt><i class="sample-line req-open"></i></dt><dd>Dashed blue dependency lines are still open.</dd></div>
</dl><p class="hint">Hover or select a node to reveal its dependencies. Drag blank space to pan. Use the toolbar to zoom. Press <code>Esc</code> once to leave a node, or again to collapse this guide.</p></section>`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(roadmap.meta.title)}</title>
<link rel="icon" href="data:,">
<style>${CSS}</style>
<a class="skip" href="#canvas-wrap">Skip to roadmap</a>
<header class="mast">
<div class="hd"><div class="title-line"><h1>${escapeHtml(roadmap.meta.title)}</h1><span class="eyebrow">As of ${escapeHtml(roadmap.meta.asOf)} · HEAD ${escapeHtml(roadmap.meta.head)}</span></div><p>${inline(roadmap.meta.eyebrow)}</p></div>
<div class="ctl">
<button type="button" id="about" aria-pressed="true" aria-expanded="true" aria-controls="drawer">Guide</button>
<button type="button" id="show-all" aria-pressed="false">Show all dependencies</button>
<div class="control-group" aria-label="Zoom controls"><button type="button" class="icon-control" id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-pct" class="pct" aria-live="polite">100%</span><button type="button" class="icon-control" id="zoom-in" aria-label="Zoom in">+</button></div>
<div class="control-group"><button type="button" id="zoom-fit">Fit width</button><button type="button" id="zoom-all">Overview</button><button type="button" id="zoom-100">Actual size</button></div>
</div>
</header>
<div class="tiles">${tiles}</div>
<main class="work" id="work">
<div class="canvas" id="canvas-wrap" tabindex="0" aria-label="Roadmap canvas. Drag blank space to pan.">${svg}</div>
<aside class="drawer" id="drawer" aria-live="polite" aria-labelledby="drawer-title">
<div class="dtop"><h2 id="drawer-title">How to read this roadmap</h2><button type="button" id="drawer-close" aria-label="Collapse inspector" title="Collapse inspector">×</button></div>
<div id="drawer-body">${aboutHtml}</div>
</aside>
</main>
<footer>${inline(roadmap.meta.footer)}</footer>
<script type="application/json" id="rm-data">${dataJson}</script>
<script>${JS}</script>
`;
}

// ─── entry ─────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, PLAN_SOURCE_PATH);
const TARGET = resolve(ROOT, "docs/roadmap/index.html");

async function publish(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${String(process.pid)}.staging`;
  await writeFile(staging, content, "utf8");
  await rename(staging, path);
}

const argv = process.argv.slice(2);
if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check" && argv[0] !== "--json")) {
  throw new Error("usage: npm run roadmap [-- --check | --json]");
}
const raw: unknown = parsePlan(await readFile(SOURCE, "utf8"));
const roadmap = RoadmapSchema.parse(raw);
const docs = bindDocsToPlan(roadmap, await scanDocs(ROOT));
const html = renderPage(roadmap, docs);

if (argv[0] === "--json") {
  // the parsed plan plus the docs' side of the binding, for inspection and for
  // tools that want the structure without the page
  process.stdout.write(`${JSON.stringify({ ...roadmap, docs: Object.fromEntries(docs) }, null, 2)}\n`);
} else if (argv[0] === "--check") {
  const committed = await readFile(TARGET, "utf8").catch(() => "");
  if (committed !== html) {
    throw new Error("docs/roadmap/index.html is stale — run `npm run roadmap` and commit the result");
  }
  process.stdout.write("docs/roadmap/index.html is fresh.\n");
} else {
  await publish(TARGET, html);
  process.stdout.write(`Rendered docs/roadmap/index.html (${String(html.length)} bytes).\n`);
}
