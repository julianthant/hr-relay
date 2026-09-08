/**
 * roadmap-doc-binding — D263 (`docs/roadmap/roadmap.md` §Governance), the plan's
 * two-way binding to the docs that own its contracts.
 *
 * The plan has two forms: the prose in `docs/rebuild/**` (normative) and the
 * tree in `docs/roadmap/roadmap.md` (the operator's tracking view, and the
 * source the site is generated from). Two forms of one plan drift unless
 * something mechanical holds them together, so D263 binds them BOTH ways:
 *
 *   plan → docs   every node carries `doc:` — the sections that own what it
 *                 builds; each ref must resolve to a real file AND, when it
 *                 names a `§section`, to a real heading in that file.
 *   docs → plan   every `<!-- roadmap: <id> -->` tag and every
 *                 `<!-- roadmap-status: <id> -->` block must name a node the
 *                 plan declares, and every node must be described by at least
 *                 one tagged section somewhere.
 *
 * Neither half alone is enough. Refs alone let a doc section describe a node
 * that no longer exists; tags alone let a node be invented with no owning
 * contract. A rename on either side then fails this gate instead of rotting
 * quietly, which is the whole point — the disagreement is CAUGHT rather than
 * argued (roadmap §Governance), and doc 07's successors stay normative.
 *
 * The arms, in the order they run:
 *
 *   (a) every `doc:` ref on every node resolves. A phase ref (`3.1`) names
 *       exactly one `docs/rebuild/plans/phase-3/3.1-name/README.md`; a reference ref (`ref:write-safety`)
 *       names `docs/rebuild/reference/write-safety.md`. A `§section` matches a
 *       heading's NUMBER (`§5.4` → `## 5.4 …`, `## 5.4. …`) or its TEXT
 *       (`§Phase summary` → `## Phase summary`) — the phase docs number no
 *       headings, so naming one is the only way to cite it — or, for a range
 *       (`§2–3`), both endpoints must be heading numbers.
 *   (b) every tag and every status-block id names a node. This is
 *       `bindDocsToPlan`, the generator's own join, CALLED rather than
 *       restated: the guard and the site must refuse the same thing, and a
 *       second implementation of one rule is a second opinion that can drift
 *       (D252).
 *   (c) every non-phase node carries at least one `doc:` ref. A phase may omit
 *       one — a phase is a container, its children carry the contracts.
 *   (d) every node is described by at least one tagged doc section.
 *   (e) every `builds:` line carries a layer tag. `parsePlan` refuses a line
 *       without one, so this arm is belt-and-braces over the parsed shape; its
 *       negative control is the `builds-without-layer` fixture, which proves
 *       the refusal happens at all (a `Feature` may be a bare string in the
 *       schema, so the check is not vacuous at the type level).
 *   (f) D326/D328's Phase 0–3 execution grammar is structural: every part uses the
 *       same decimal label (`0.1`, `1.1`, `2.1`, `3.1`), each part requires the
 *       preceding part, and immediate task ordinals advance consecutively.
 *       Parallel waves use consecutive numeric hyphen members at task depth;
 *       the coordinator run plan still owns their execution bindings.
 *
 * Arms (c) and (d) ship as RATCHETS, because at HEAD the `doc:` column has been
 * pasted onto exactly one node (step 2b's dogfood) and step 5.0 of
 * `docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md` applies the rest.
 * A ratchet only shrinks: an allowlisted id that has since gained its binding
 * fails as STALE, so the list cannot outlive the gap it records.
 *
 * Everything the guard decides is a pure function of `(planText, files)` —
 * `auditRoadmapDocBinding` never touches the filesystem — so the real tree and
 * every violating fixture go through the identical code. `collectDocTree`
 * supplies both: for the repo it reads `DOC_SCAN_DIRS`, for a fixture it reads
 * that fixture's own mini `docs/` tree, which is a miniature repo with the same
 * layout. That is what makes a fixture evidence rather than decoration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { PHASE_DOC_NUMBERS, PLAN_SOURCE_PATH, parsePlan, phaseDocPattern } from "../../../scripts/roadmap/parse-plan.js";
import {
  DocRefSchema,
  RoadmapSchema,
  type DocRef,
  type DocStatusBlock,
  type DocTag,
  type Feature,
  type Item,
  type Roadmap,
} from "../../../scripts/roadmap/schema.js";
import {
  DOC_SCAN_DIRS,
  DOC_SCAN_SKIP_DIRS,
  bindDocsToPlan,
  parseDocBindings,
  scanDocs,
} from "../../../scripts/roadmap/scan-docs.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

const FIXTURE_ROOT = "tests/unit/architecture/fixtures/roadmap-binding";
const packageScripts = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
}).scripts;

/**
 * Arm (c)'s ratchet: the nodes that carry no `doc:` ref at HEAD.
 *
 * Every entry has the SAME reason — the notation grew `doc:` on 2026-08-20
 * (step 2a) and only `{#phase-0}` was bound by the dogfood commit; step 5.0
 * pasted the node map's `doc:` column onto the rest (81bf48dd), so this list is
 * EMPTY from 5.0 on. It is a subset assertion in both directions: a node that gains its ref
 * must be deleted from here (stale), and a node that loses one, or a new node
 * that never had one, fails immediately.
 */
const ALLOW_MISSING_DOC_REF: readonly string[] = [];

/**
 * Arm (d)'s ratchet, and it is EMPTY on purpose: step 3a's skeletons gave all
 * 66 nodes a tagged section in their phase doc, so "a node no doc describes"
 * is already a zero. The constant stays so the arm keeps the same shape as (c)
 * — and so a future planning gap has to be written down here, in the guard,
 * rather than argued in a review.
 */
const ALLOW_UNTAGGED: readonly string[] = [];

/** One node of the plan tree, flattened. A `phase` is a level-2 spine entry; everything under it is not. */
interface PlanNode {
  readonly id: string | undefined;
  readonly isPhase: boolean;
  readonly title: string;
  readonly docs: readonly DocRef[];
  readonly features: readonly Feature[];
}

/** A heading, as arm (a) has to compare it: by number, or by any of its text forms. */
interface DocHeadingRow {
  readonly section: string | undefined;
  readonly texts: readonly string[];
}

export interface RoadmapBindingRatchets {
  readonly missingDocRef: readonly string[];
  readonly untagged: readonly string[];
}

export interface RoadmapBindingAudit {
  readonly violations: readonly string[];
  readonly nodeIds: readonly string[];
  /** Observed, before the ratchet is applied — the raw gap, for reporting. */
  readonly missingDocRef: readonly string[];
  readonly untagged: readonly string[];
  readonly scannedDocs: readonly string[];
  readonly tags: readonly DocTag[];
  readonly statuses: readonly DocStatusBlock[];
  readonly docRefCount: number;
  readonly featureCount: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
/**
 * The generator's own section grammar (`scripts/roadmap/scan-docs.ts`):
 * `3.1 Foo` and `2. Foo` are numbered sections, `13 — Foo` is a title. Kept
 * character-identical to it so a section that renders in the drawer is a
 * section this guard can resolve.
 */
const SECTION_RE = /^(\d+(?:\.\d+)+|\d+\.)\s+(.*)$/;
/** `3.1 · Finish the dashboard` and `09 — Write-Safety: …`: the doc's own number, then its name. */
const DOC_NUMBER_PREFIX_RE = /^\d{2}(?:\.\d+)?\s*[·—–-]\s*(.+)$/;
const RANGE_RE = /^(\d+(?:\.\d+)*)[–—-](\d+(?:\.\d+)*)$/;
const FENCE_RE = /^(?:```|~~~)/;

/** Every heading in one markdown file, fenced code excluded — a `# comment` in a bash block is not a section. */
function docHeadings(text: string): DocHeadingRow[] {
  const headings: DocHeadingRow[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = HEADING_RE.exec(line);
    if (heading === null) continue;
    const body = (heading[2] ?? "").trim();
    const numbered = SECTION_RE.exec(body);
    const section = numbered === null ? undefined : (numbered[1] ?? "").replace(/\.$/, "");
    const rest = numbered === null ? body : (numbered[2] ?? "").trim();
    const texts = [body, rest].filter((candidate) => candidate.length > 0);
    const withoutDocNumber = DOC_NUMBER_PREFIX_RE.exec(rest);
    if (withoutDocNumber !== null) texts.push((withoutDocNumber[1] ?? "").trim());
    headings.push({ section, texts: [...new Set(texts)] });
  }
  return headings;
}

/**
 * The candidates a refused section was NEAREST to. A bare "no such heading" is
 * a sentence nobody can act on (D261): the phase docs are cited by heading TEXT
 * and their headings carry parentheticals, so the common miss is a citation
 * that is right about the section and short of its full title. Naming what the
 * file DOES have turns the refusal into the fix.
 */
function nearestHeadings(section: string, headings: readonly DocHeadingRow[]): string[] {
  const numbers = [...new Set(headings.flatMap((heading) => (heading.section === undefined ? [] : [heading.section])))]
    .filter((number) => number.startsWith(section))
    .map((number) => `§${number}`);
  const candidates = [...new Set(headings.flatMap((heading) => heading.texts))].filter(
    (text) => text.startsWith(section) || text.includes(section),
  );
  // A heading the citation is a PREFIX of is the likelier intent than one that
  // merely contains the words, so it is offered first.
  const texts = [
    ...candidates.filter((text) => text.startsWith(section)),
    ...candidates.filter((text) => !text.startsWith(section)),
  ].map((text) => `"${text}"`);
  return [...numbers, ...texts].slice(0, 3);
}

function sectionResolves(section: string, headings: readonly DocHeadingRow[]): boolean {
  const numbers = new Set(headings.flatMap((heading) => (heading.section === undefined ? [] : [heading.section])));
  const texts = new Set(headings.flatMap((heading) => heading.texts));
  if (numbers.has(section) || texts.has(section)) return true;
  const range = RANGE_RE.exec(section);
  return range !== null && numbers.has(range[1] ?? "") && numbers.has(range[2] ?? "");
}

/** The file a ref names, or the reason it names none. Phase refs glob, reference refs are exact. */
function resolveDocFile(
  ref: DocRef,
  files: ReadonlyMap<string, string>,
): { readonly path: string } | { readonly reason: string } {
  if (ref.kind === "reference") {
    const path = `docs/rebuild/reference/${ref.doc.slice("ref:".length)}.md`;
    return files.has(path) ? { path } : { reason: `names no ${path}` };
  }
  const separator = ref.doc.indexOf("/");
  if (separator !== -1) {
    const subphase = ref.doc.slice(0, separator);
    const overview = resolveDocFile({ kind: "phase", doc: subphase, raw: subphase }, files);
    if (!("path" in overview)) return overview;
    const leaf = ref.doc.slice(separator + 1);
    const path = `${overview.path.slice(0, -"README.md".length)}${leaf}.md`;
    return files.has(path) ? { path } : { reason: `names no ${path}` };
  }
  const pattern = phaseDocPattern(ref.doc);
  const matcher = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
  const matches = [...files.keys()].filter((path) => matcher.test(path));
  if (matches.length === 1) return { path: matches[0] ?? "" };
  if (matches.length === 0) {
    return { reason: `names no ${phaseDocPattern(ref.doc)} (the phase docs are ${PHASE_DOC_NUMBERS.join(" ")})` };
  }
  return { reason: `matches ${String(matches.length)} phase docs — ${matches.join(", ")}; exactly one may carry a number` };
}

function flattenPlan(roadmap: Roadmap): PlanNode[] {
  const nodes: PlanNode[] = [];
  const walk = (items: readonly Item[]): void => {
    for (const item of items) {
      nodes.push({ id: item.id, isPhase: false, title: item.title, docs: item.docs ?? [], features: item.features ?? [] });
      if (item.items !== undefined) walk(item.items);
    }
  };
  for (const entry of roadmap.spine) {
    if (entry.kind !== "phase") continue;
    nodes.push({ id: entry.id, isPhase: true, title: entry.title, docs: entry.docs ?? [], features: entry.features ?? [] });
    walk(entry.items);
  }
  return nodes;
}

const FOUNDATIONAL_PHASE_PARTS = [
  { phaseId: "phase-0", phaseNumber: 0, parts: ["phase0-charter", "phase0-governance", "phase0-authority-reset"] },
  {
    phaseId: "phase-1",
    phaseNumber: 1,
    parts: ["p1-base", "p1-authority", "p1-kernel", "p1-spine", "p1-exit", "p1-authority-implementation"],
  },
  {
    phaseId: "phase-2",
    phaseNumber: 2,
    parts: ["p2-proof", "p2-2g", "p2-2h", "p2-2i", "p2-2j", "p2-authority-revalidation"],
  },
  {
    phaseId: "phase-3",
    phaseNumber: 3,
    parts: ["dash-defaults", "workflow-authoring-model", "workflow-live-acceptance", "optional-document-tools", "claude-operator"],
  },
] as const;
const SUPERVISOR_TASK_RE = /^(\d+)(?:-(\d+))? · /;

/** D326/D328's shared grammar over the immediate Phase 0–3 part/task hierarchy. */
export function auditPhaseThreeExecutionOrder(roadmap: Roadmap): string[] {
  const violations: string[] = [];
  for (const expectedPhase of FOUNDATIONAL_PHASE_PARTS) {
    const phase = roadmap.spine.find((entry) => entry.kind === "phase" && entry.id === expectedPhase.phaseId);
    if (phase === undefined || phase.kind !== "phase") continue;
    const decimalPrefix = `${String(expectedPhase.phaseNumber)}.`;
    const parts = phase.items.filter((part) => part.title.startsWith(decimalPrefix));
    const actualPartIds = parts.map((part) => part.id ?? "<missing-id>");
    if (actualPartIds.join("\u001f") !== expectedPhase.parts.join("\u001f")) {
      violations.push(
        `Phase ${String(expectedPhase.phaseNumber)} decimal parts must be exactly ${expectedPhase.parts.join(" → ")}; found ${actualPartIds.join(" → ")}`,
      );
    }

    // Only the explicitly admitted D342 subtree is optional. A dependency
    // from required work would turn the menu back into a release gate.
    const optionalPart = parts.find((part) => part.id === "optional-document-tools");
    if (optionalPart !== undefined) {
      const optionalIds = new Set<string>();
      const collectOptional = (node: Item): void => {
        if (node.id !== undefined) optionalIds.add(node.id);
        for (const child of node.items ?? []) collectOptional(child);
      };
      collectOptional(optionalPart);
      const checkRequired = (node: Pick<Item, "id" | "requires" | "items">): void => {
        if (node.id !== undefined && optionalIds.has(node.id)) return;
        for (const requirement of node.requires ?? []) {
          if (requirement.kind === "node" && optionalIds.has(requirement.ref)) {
            violations.push(
              `D342 required node {#${node.id ?? "missing-id"}} must not require optional feature {#${requirement.ref}}`,
            );
          }
        }
        for (const child of node.items ?? []) checkRequired(child);
      };
      for (const entry of roadmap.spine) {
        if (entry.kind === "phase") checkRequired(entry);
      }
    }

    for (const [partIndex, expectedPartId] of expectedPhase.parts.entries()) {
      const part = parts.find((candidate) => candidate.id === expectedPartId);
      if (part === undefined) continue;
      const expectedLabel = `${String(expectedPhase.phaseNumber)}.${String(partIndex + 1)}`;
      if (!part.title.startsWith(`${expectedLabel} · `)) {
        violations.push(
          `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} must start with "${expectedLabel} · "; found "${part.title}"`,
        );
      }
      if (partIndex > 0) {
        // D342: the optional document menu occupies 3.4, but cooperation
        // still depends directly on controlled acceptance, not optional delivery.
        const previousPartId = expectedPartId === "claude-operator"
          ? "workflow-live-acceptance"
          : expectedPhase.parts[partIndex - 1];
        const requirements = new Set(
          (part.requires ?? []).flatMap((requirement) => (requirement.kind === "node" ? [requirement.ref] : [])),
        );
        if (previousPartId !== undefined && !requirements.has(previousPartId)) {
          violations.push(
            `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} must require preceding part {#${previousPartId}}`,
          );
        }
      }

      let expectedOrdinal = 1;
      let activeWaveOrdinal: number | undefined;
      let expectedWaveMember = 1;
      let activeWaveMembers = 0;
      const closeWave = (): void => {
        if (activeWaveOrdinal === undefined) return;
        if (activeWaveMembers < 2) {
          violations.push(
            `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} parallel ordinal ${String(activeWaveOrdinal)} must contain at least two contiguous members`,
          );
        }
        expectedOrdinal = activeWaveOrdinal + 1;
        activeWaveOrdinal = undefined;
        expectedWaveMember = 1;
        activeWaveMembers = 0;
      };

      for (const task of part.items ?? []) {
        const match = SUPERVISOR_TASK_RE.exec(task.title);
        if (match === null) {
          violations.push(
            `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} immediate task {#${task.id ?? "missing-id"}} must start with a serial number such as "2 · " or a parallel member such as "2-1 · "; found "${task.title}"`,
          );
          continue;
        }
        const ordinal = Number(match[1]);
        const member = match[2] === undefined ? undefined : Number(match[2]);

        if (member === undefined) {
          closeWave();
          if (ordinal !== expectedOrdinal) {
            violations.push(
              `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} tasks must advance by consecutive serial/wave ordinals from 1; expected ${String(expectedOrdinal)}, found ${String(ordinal)}`,
            );
          }
          expectedOrdinal += 1;
          continue;
        }

        if (activeWaveOrdinal !== undefined && ordinal !== activeWaveOrdinal) closeWave();
        if (activeWaveOrdinal === undefined) {
          if (ordinal !== expectedOrdinal) {
            violations.push(
              `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} tasks must advance by consecutive serial/wave ordinals from 1; expected ${String(expectedOrdinal)}, found ${String(ordinal)}`,
            );
          }
          activeWaveOrdinal = ordinal;
          expectedWaveMember = 1;
        }
        if (member !== expectedWaveMember) {
          violations.push(
            `Phase ${String(expectedPhase.phaseNumber)} part {#${expectedPartId}} parallel task members for ordinal ${String(ordinal)} must be consecutive from -1; expected ${String(ordinal)}-${String(expectedWaveMember)}, found ${String(ordinal)}-${String(member)}`,
          );
        }
        expectedWaveMember += 1;
        activeWaveMembers += 1;
      }
      closeWave();
    }
  }

  return violations;
}

/** `{#id}` when the node has one, its title when it does not — every message names the node somehow. */
function label(node: PlanNode): string {
  return node.id === undefined ? `"${node.title}"` : `{#${node.id}} "${node.title}"`;
}

/**
 * The ratchet, in both directions. An unallowed gap is a violation; an
 * allowlisted id that no longer HAS the gap is a stale entry, which is what
 * makes the list shrink instead of drifting. An entry naming no node at all is
 * reported as its own thing — a renamed node and a closed gap are different
 * facts, and the fix differs.
 */
function ratchetViolations(
  observed: readonly string[],
  allowed: readonly string[],
  nodeIds: ReadonlySet<string>,
  listName: string,
  gapMessage: (id: string) => string,
  closedMessage: (id: string) => string,
): string[] {
  const allowedSet = new Set(allowed);
  const observedSet = new Set(observed);
  const violations: string[] = [];
  for (const id of observed) if (!allowedSet.has(id)) violations.push(gapMessage(id));
  for (const id of allowed) {
    if (observedSet.has(id)) continue;
    violations.push(
      nodeIds.has(id)
        ? `${listName} lists "${id}", but ${closedMessage(id)} — delete the entry; the ratchet only shrinks`
        : `${listName} lists "${id}", which names no node in ${PLAN_SOURCE_PATH} — a renamed or removed node, not a closed gap`,
    );
  }
  return violations;
}

/**
 * The whole guard, as a pure function of the plan's text and the scanned docs'
 * text. Parse failures (a malformed plan, a malformed status block) are NOT
 * collected — they throw, because a plan that does not parse has no bindings
 * to audit and the parser's message already names the file and the line.
 */
export function auditRoadmapDocBinding(
  planText: string,
  files: ReadonlyMap<string, string>,
  ratchets: RoadmapBindingRatchets,
): RoadmapBindingAudit {
  const roadmap = RoadmapSchema.parse(parsePlan(planText));
  const nodes = flattenPlan(roadmap);
  const identified = nodes.filter((node) => node.id !== undefined);
  const nodeIds = new Set(identified.flatMap((node) => (node.id === undefined ? [] : [node.id])));
  const violations: string[] = [];

  const scannedDocs = [...files.keys()].sort();
  const tags: DocTag[] = [];
  const statuses: DocStatusBlock[] = [];
  for (const doc of scannedDocs) {
    const parsed = parseDocBindings(doc, files.get(doc) ?? "");
    tags.push(...parsed.tags);
    statuses.push(...parsed.statuses);
  }

  // (b) — the generator's own join, called rather than restated.
  try {
    bindDocsToPlan(roadmap, { tags, statuses });
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error));
  }

  // (a) — every ref resolves to a file, and to a heading when it names a section.
  const headingsByDoc = new Map<string, DocHeadingRow[]>();
  let docRefCount = 0;
  for (const node of identified) {
    for (const ref of node.docs) {
      docRefCount += 1;
      const resolved = resolveDocFile(ref, files);
      if (!("path" in resolved)) {
        violations.push(`${PLAN_SOURCE_PATH} node ${label(node)}: doc: ref "${ref.raw}" ${resolved.reason}`);
        continue;
      }
      if (ref.section === undefined) continue;
      const headings = headingsByDoc.get(resolved.path) ?? docHeadings(files.get(resolved.path) ?? "");
      headingsByDoc.set(resolved.path, headings);
      if (sectionResolves(ref.section, headings)) continue;
      const nearest = nearestHeadings(ref.section, headings);
      violations.push(
        `${PLAN_SOURCE_PATH} node ${label(node)}: doc: ref "${ref.raw}" resolves to ${resolved.path}, which has no heading numbered or titled "${ref.section}" (${String(headings.length)} headings read${nearest.length === 0 ? "" : `; nearest: ${nearest.join(" · ")}`})`,
      );
    }
  }

  // (c) — a non-phase node with no owning doc section.
  const missingDocRef = identified
    .filter((node) => !node.isPhase && node.docs.length === 0)
    .flatMap((node) => (node.id === undefined ? [] : [node.id]))
    .sort();
  violations.push(
    ...ratchetViolations(
      missingDocRef,
      ratchets.missingDocRef,
      nodeIds,
      "ALLOW_MISSING_DOC_REF",
      (id) =>
        `${PLAN_SOURCE_PATH} node {#${id}} carries no doc: ref — every non-phase node names the doc sections that own its contracts (D263); ${String(missingDocRef.length)} of ${String(identified.filter((node) => !node.isPhase).length)} non-phase nodes are still unbound`,
      (id) => `{#${id}} now carries a doc: ref`,
    ),
  );

  // (d) — a node no doc section describes.
  const tagged = new Set(tags.map((tag) => tag.id));
  const untagged = identified
    .flatMap((node) => (node.id === undefined || tagged.has(node.id) ? [] : [node.id]))
    .sort();
  violations.push(
    ...ratchetViolations(
      untagged,
      ratchets.untagged,
      nodeIds,
      "ALLOW_UNTAGGED",
      (id) =>
        `node {#${id}} is described by no doc section — no "<!-- roadmap: ${id} -->" tag exists under ${DOC_SCAN_DIRS.join(" or ")} (${String(scannedDocs.length)} docs scanned)`,
      (id) => `{#${id}} is now tagged`,
    ),
  );

  // (e) — belt and braces over `parsePlan`'s own refusal.
  for (const node of nodes) {
    for (const feature of node.features) {
      if (typeof feature !== "string") continue;
      violations.push(
        `${PLAN_SOURCE_PATH} node ${label(node)}: builds: entry "${feature}" carries no layer tag (FE · BE · BOTH · WIRE · DOCS · PROOF)`,
      );
    }
  }

  // (f) — D326/D328's shared decimal part order and supervisor-session task grammar.
  violations.push(...auditPhaseThreeExecutionOrder(roadmap));

  return {
    violations,
    nodeIds: [...nodeIds].sort(),
    missingDocRef,
    untagged,
    scannedDocs,
    tags,
    statuses,
    docRefCount,
    featureCount: nodes.reduce((total, node) => total + node.features.length, 0),
  };
}

/** One tree — the repo's, or a fixture's mini copy of it — read exactly the way the generator reads the repo's. */
function collectDocTree(rootDir: string): { readonly planText: string; readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (DOC_SCAN_SKIP_DIRS.includes(entry.name)) continue;
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      files.set(relative(rootDir, path).split(sep).join("/"), readFileSync(path, "utf8"));
    }
  };
  for (const dir of DOC_SCAN_DIRS) walk(join(rootDir, dir));
  return { planText: readFileSync(join(rootDir, PLAN_SOURCE_PATH), "utf8"), files };
}

const NO_RATCHET: RoadmapBindingRatchets = { missingDocRef: [], untagged: [] };

function auditFixture(name: string, ratchets: RoadmapBindingRatchets = NO_RATCHET): RoadmapBindingAudit {
  const tree = collectDocTree(join(REPO_ROOT, FIXTURE_ROOT, name));
  return auditRoadmapDocBinding(tree.planText, tree.files, ratchets);
}

function sortBindings<T extends { readonly doc: string; readonly line: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.doc === b.doc ? a.line - b.line : a.doc.localeCompare(b.doc)));
}

describe("roadmap-doc-binding (D263 — roadmap §Governance)", () => {
  const tree = collectDocTree(REPO_ROOT);
  const audit = auditRoadmapDocBinding(tree.planText, tree.files, {
    missingDocRef: ALLOW_MISSING_DOC_REF,
    untagged: ALLOW_UNTAGGED,
  });

  it("binds the plan and the rebuild docs to each other, both ways", () => {
    expect(audit.violations, audit.violations.join("\n")).toEqual([]);
  });

  it("reads a non-empty tree — every phase doc, the migrations records, and no superseded history", () => {
    // A walker that resolved nothing would report every arm clean, so the scan
    // itself is asserted: each admitted phase/subphase has exactly one canonical file, and
    // `history/` + `reviews/` describe what a doc USED to say and are skipped.
    for (const number of PHASE_DOC_NUMBERS) {
      const resolved = resolveDocFile({ kind: "phase", doc: number, raw: number }, tree.files);
      expect(resolved, `${phaseDocPattern(number)} must resolve uniquely`).toHaveProperty("path");
      if (!("path" in resolved)) throw new Error(resolved.reason);
      expect(audit.scannedDocs).toContain(resolved.path);
    }
    expect(audit.scannedDocs.some((path) => path.startsWith("docs/rebuild/migrations/"))).toBe(true);
    expect(audit.scannedDocs.filter((path) => /\/(?:history|reviews|findings|guides)\//.test(path))).toEqual([]);
    expect(audit.nodeIds.length, "the plan must declare nodes").toBeGreaterThan(0);
    expect(audit.tags.length, "the docs must carry tags").toBeGreaterThan(0);
    expect(audit.statuses.length, "the docs must carry status blocks").toBeGreaterThan(0);
    expect(audit.docRefCount, "arm (a) must have resolved at least one doc: ref").toBeGreaterThan(0);
  });

  it("scans exactly what the generator scans (one scanner, one verdict)", async () => {
    const generator = await scanDocs(REPO_ROOT);
    expect(sortBindings(audit.tags)).toEqual(sortBindings(generator.tags));
    expect(sortBindings(audit.statuses)).toEqual(sortBindings(generator.statuses));
  });

  it("uses the same folder, file and title convention for every phase and subphase", () => {
    for (const label of PHASE_DOC_NUMBERS) {
      const ref: DocRef = { kind: "phase", doc: label, raw: label };
      const resolved = resolveDocFile(ref, tree.files);
      expect("path" in resolved, JSON.stringify(resolved)).toBe(true);
      if (!("path" in resolved)) throw new Error(resolved.reason);
      expect(tree.files.get(resolved.path)?.split("\n")[0]).toMatch(new RegExp(`^# Phase ${label.replace(".", "\\.")} · .+`));
      const labelPattern = label.replace(".", "\\.");
      const filePattern = label.length === 1 ? "README" : `${labelPattern}-[a-z0-9]+(?:-[a-z0-9]+)*/README`;
      expect(resolved.path).toMatch(new RegExp(`^docs/rebuild/plans/phase-${label[0]}/${filePattern}\\.md$`));
    }
  });

  it("refuses duplicate or misplaced subphase files and noncanonical doc labels", () => {
    const path = "docs/rebuild/plans/phase-3/3.1-the-dashboard/README.md";
    const files = new Map([[path, "# Phase 3.1 · Dashboard"]]);
    const ref: DocRef = { kind: "phase", doc: "3.1", raw: "3.1" };
    expect(resolveDocFile(ref, files)).toEqual({ path });
    files.set("docs/rebuild/plans/phase-3/3.1-duplicate/README.md", "# Duplicate");
    expect(resolveDocFile(ref, files)).toHaveProperty("reason", expect.stringContaining("matches 2 phase docs"));
    expect(resolveDocFile(ref, new Map([["docs/rebuild/plans/phase-2/3.1-misplaced/README.md", "# Wrong phase"]])))
      .toHaveProperty("reason", expect.stringContaining("names no"));
    for (const label of ["03.1", "0A", "4.1", "7A", "1.0", "3/task-1", "3.1/../escape", "3.1/task-1/extra", "3.1/Task-1"]) {
      expect(() => parsePlan(tree.planText.replace(/^doc: .+$/m, `doc: ${label}`))).toThrow("a doc: ref");
    }
  });

  it("resolves task and topic bindings only inside their named subphase", () => {
    const taskDoc = "3.1/task-9-1-shell";
    const topicDoc = "5A/settings";
    const taskPath = "docs/rebuild/plans/phase-3/3.1-dashboard/task-9-1-shell.md";
    const topicPath = "docs/rebuild/plans/phase-5/5A-readiness/settings.md";
    const taskOverview = "docs/rebuild/plans/phase-3/3.1-dashboard/README.md";
    const overviews = [
      [taskOverview, "# Phase 3.1 · Dashboard"],
      ["docs/rebuild/plans/phase-5/5A-readiness/README.md", "# Phase 5A · Readiness"],
    ] as const;
    const files = new Map<string, string>([...overviews, [taskPath, "# Task 9-1 · Shell"], [topicPath, "# Settings"]]);
    for (const [doc, path] of [[taskDoc, taskPath], [topicDoc, topicPath]]) {
      const ref = DocRefSchema.parse({ kind: "phase", doc, raw: doc });
      expect(resolveDocFile(ref, files)).toEqual({ path });
      expect(resolveDocFile(ref, new Map())).toHaveProperty("reason", expect.stringContaining("names no"));
    }
    const ref: DocRef = { kind: "phase", doc: taskDoc, raw: taskDoc };
    expect(resolveDocFile(ref, new Map<string, string>([...overviews, [taskPath.replace("3.1-dashboard/", "3.1-dashboard/nested/"), "# Wrong depth"]])))
      .toHaveProperty("reason", expect.stringContaining("names no"));
    expect(resolveDocFile(ref, new Map<string, string>([...overviews, [taskPath.replace("3.1-dashboard", "3.2-dashboard"), "# Wrong subphase"]])))
      .toHaveProperty("reason", expect.stringContaining("names no"));
    // A same-label folder without the canonical overview must never become a second task owner.
    const orphanPath = taskPath.replace("3.1-dashboard", "3.1-other");
    expect(resolveDocFile(ref, new Map<string, string>([...overviews, [orphanPath, "# Orphan task"]])))
      .toEqual({ reason: `names no ${taskPath}` });
    expect(resolveDocFile(ref, new Map([[taskPath, "# Task without an overview"]])))
      .toHaveProperty("reason", expect.stringContaining("README.md"));
    files.set(taskOverview.replace("3.1-dashboard", "3.1-duplicate"), "# Duplicate overview");
    files.set(taskPath.replace("3.1-dashboard", "3.1-duplicate"), "# Duplicate");
    expect(resolveDocFile(ref, files)).toHaveProperty("reason", expect.stringContaining("matches 2"));
  });

  it("parses mixed overview, task and topic refs without splitting dotted task headings", () => {
    const parsed = RoadmapSchema.parse(parsePlan(tree.planText.replace(/^doc: .+$/m,
      "doc: 1.6 §Shared scope · 1.6/task-2-1-run-records §Task 2-1 · Run records · 5A/settings · ref:write-safety §5")));
    expect(flattenPlan(parsed)[0]?.docs).toEqual([
      { kind: "phase", doc: "1.6", raw: "1.6 §Shared scope", section: "Shared scope" },
      { kind: "phase", doc: "1.6/task-2-1-run-records", raw: "1.6/task-2-1-run-records §Task 2-1 · Run records", section: "Task 2-1 · Run records" },
      { kind: "phase", doc: "5A/settings", raw: "5A/settings" },
      { kind: "reference", doc: "ref:write-safety", raw: "ref:write-safety §5", section: "5" },
    ]);
    for (const doc of ["1/task-1", "1.6/../task-1", "1.6/task-1/nested", "1.6/Task-1", "1.6/task--1"]) {
      expect(DocRefSchema.safeParse({ kind: "phase", doc, raw: doc }).success).toBe(false);
    }
  });

  it("registers the roadmap freshness check against the generator's check mode", () => {
    expect(packageScripts["roadmap:check"]).toBe("tsx scripts/generate-roadmap.ts --check");
  });

  it("records the unbound nodes as a ratchet that can only shrink", () => {
    // Arm (c)'s allowlist is a gap register, not a waiver: it must be exactly
    // the set of nodes that are unbound at HEAD (step 5.0 empties it), and the
    // audit above already fails on either direction of a mismatch.
    expect([...ALLOW_MISSING_DOC_REF].sort()).toEqual([...ALLOW_MISSING_DOC_REF]);
    expect(new Set(ALLOW_MISSING_DOC_REF).size).toBe(ALLOW_MISSING_DOC_REF.length);
    expect(audit.missingDocRef).toEqual([...ALLOW_MISSING_DOC_REF]);
    expect(audit.untagged, "step 3a tagged every node; ALLOW_UNTAGGED must stay empty").toEqual([]);
    expect(ALLOW_UNTAGGED).toEqual([]);
  });

  it("passes a clean mini tree, and sees enough of it to have decided anything", () => {
    const clean = auditFixture("clean");
    expect(clean.violations, clean.violations.join("\n")).toEqual([]);
    expect(clean.nodeIds).toEqual(["fx-phase", "fx-range", "fx-task"]);
    expect(clean.docRefCount).toBe(4);
    expect(clean.tags.length).toBeGreaterThanOrEqual(4);
    expect(clean.statuses).toHaveLength(1);
    // Non-binding folders carry dangling tags. Reading them would promote
    // historical text, findings, or guide examples into the plan's authority.
    expect(clean.scannedDocs.some((path) => /\/(?:history|reviews|findings|guides)\//.test(path))).toBe(false);
    expect(clean.scannedDocs.some((path) => path.startsWith("docs/rebuild/migrations/"))).toBe(true);
  });

  it("binds a nested migration once without importing findings or guide tags", async () => {
    const fixtureRoot = join(REPO_ROOT, FIXTURE_ROOT, "clean");
    const bindings = await scanDocs(fixtureRoot);
    const migrationPath = "docs/rebuild/migrations/fixture-workflow.md";
    expect(bindings.tags.filter((tag) => tag.doc === migrationPath)).toEqual([
      { id: "fx-task", doc: migrationPath, heading: { text: "What the migration did" }, line: 7 },
    ]);
    expect([...bindings.tags, ...bindings.statuses].filter(
      (entry) => /\/(?:history|reviews|findings|guides)\//.test(entry.doc),
    )).toEqual([]);
    const clean = auditFixture("clean");
    expect(sortBindings(bindings.tags)).toEqual(sortBindings(clean.tags));
    expect(sortBindings(bindings.statuses)).toEqual(sortBindings(clean.statuses));
  });

  it("refuses a doc: ref that names no phase doc", () => {
    const { violations } = auditFixture("dangling-phase-doc");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("{#fx-task}");
    expect(violations[0]).toContain('doc: ref "3.2 §Phase summary"');
    expect(violations[0]).toContain("names no docs/rebuild/plans/phase-3/3.2-*/README.md");
  });

  it("refuses a doc: ref whose section names no heading in the file it resolves to", () => {
    const { violations } = auditFixture("dangling-section");
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("{#fx-task}");
    expect(violations[0]).toContain("docs/rebuild/plans/phase-3/3.1-the-dashboard/README.md");
    expect(violations[0]).toContain('no heading numbered or titled "Not a heading here"');
    // A section the file has under a LONGER title is the common miss — the
    // phase docs are cited by heading text and their titles carry
    // parentheticals — so the refusal names the heading it nearly matched.
    expect(violations[1]).toContain("{#fx-range}");
    expect(violations[1]).toContain('no heading numbered or titled "Phase"');
    expect(violations[1]).toContain("nearest: ");
    expect(violations[1]).toContain('"Phase summary"');
  });

  it("refuses a doc: ref naming a reference slug with no spec behind it", () => {
    const { violations } = auditFixture("unknown-reference-slug");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("{#fx-task}");
    expect(violations[0]).toContain("names no docs/rebuild/reference/no-such-spec.md");
  });

  it("refuses a <!-- roadmap: id --> tag that names no node", () => {
    const { violations } = auditFixture("tag-names-no-node");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("docs/rebuild/plans/phase-3/3.1-the-dashboard/README.md:");
    expect(violations[0]).toContain("<!-- roadmap: fx-ghost -->");
    expect(violations[0]).toContain(`names no node in ${PLAN_SOURCE_PATH}`);
  });

  it("refuses a <!-- roadmap-status: id --> block that names no node", () => {
    const { violations } = auditFixture("status-names-no-node");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("docs/rebuild/plans/phase-3/3.1-the-dashboard/README.md:");
    expect(violations[0]).toContain("<!-- roadmap-status: fx-ghost -->");
    expect(violations[0]).toContain(`names no node in ${PLAN_SOURCE_PATH}`);
  });

  it("refuses a non-phase node with no doc: ref, and lets the ratchet hold exactly that node", () => {
    const { violations } = auditFixture("node-without-doc-ref");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("{#fx-task} carries no doc: ref");
    expect(violations[0]).toContain("1 of 1 non-phase nodes are still unbound");
    // The same tree with the gap recorded is clean — and the phase node beside
    // it proves the exemption is real rather than an empty set.
    expect(auditFixture("node-without-doc-ref", { missingDocRef: ["fx-task"], untagged: [] }).violations).toEqual([]);
  });

  it("refuses a ratchet entry whose gap has closed, so the list cannot outlive it", () => {
    const stale = auditFixture("clean", { missingDocRef: ["fx-task"], untagged: ["fx-range"] });
    expect(stale.violations).toHaveLength(2);
    expect(stale.violations.join("\n")).toContain('ALLOW_MISSING_DOC_REF lists "fx-task", but {#fx-task} now carries a doc: ref');
    expect(stale.violations.join("\n")).toContain('ALLOW_UNTAGGED lists "fx-range", but {#fx-range} is now tagged');
    // And an entry naming a node the plan no longer declares says so instead.
    const renamed = auditFixture("clean", { missingDocRef: ["fx-renamed"], untagged: [] });
    expect(renamed.violations).toHaveLength(1);
    expect(renamed.violations[0]).toContain('lists "fx-renamed", which names no node');
  });

  it("refuses a node no doc section describes", () => {
    const { violations } = auditFixture("node-with-no-tag");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("node {#fx-task} is described by no doc section");
    expect(violations[0]).toContain("<!-- roadmap: fx-task -->");
  });

  it("refuses a builds: line with no layer tag (the parser owns the refusal)", () => {
    // Arm (e) is structural inside the audit — a `Feature` may still be a bare
    // string in the schema — but the refusal that actually fires is the
    // parser's, at the line, so the fixture proves THAT: a plan whose builds:
    // line drops its layer never becomes a Roadmap at all.
    expect(() => auditFixture("builds-without-layer")).toThrow(
      /a builds: line must be "- \[x\| \|~\|\?\|-\|!\] LAYER text"/,
    );
    // Positive control: the clean fixture's builds: lines DO carry layers, so
    // the refusal above is about the missing tag and not about `builds:` itself.
    const clean = auditFixture("clean");
    expect(clean.featureCount).toBeGreaterThan(0);
    expect(clean.violations).toEqual([]);
  });

  it("refuses working-session markers on the phase spine", () => {
    const fixture = readFileSync(join(REPO_ROOT, FIXTURE_ROOT, "clean", "docs/roadmap/roadmap.md"), "utf8");
    const withSessionMarker = fixture.replace(
      "<!-- roadmap:end -->",
      "## session: 2026-09-03 | roadmap-redesign | history does not belong on the phase spine\n\n<!-- roadmap:end -->",
    );
    expect(() => parsePlan(withSessionMarker)).toThrow(/phase .* needs an \{#id\}/);
  });

  it("keeps D342 document features outside required cooperation and release dependencies", () => {
    const roadmap = RoadmapSchema.parse(parsePlan(tree.planText));
    expect(auditPhaseThreeExecutionOrder(roadmap)).toEqual([]);
    const phase = roadmap.spine.find((entry) => entry.kind === "phase" && entry.id === "phase-3");
    if (phase === undefined || phase.kind !== "phase") throw new Error("test fixture has no Phase 3");
    const cooperation = phase.items.find((part) => part.id === "claude-operator");
    if (cooperation === undefined) throw new Error("test fixture has no cooperation part");
    cooperation.requires = [{ kind: "node", ref: "optional-document-tools" }];
    expect(auditPhaseThreeExecutionOrder(roadmap).join("\n")).toContain(
      "must require preceding part {#workflow-live-acceptance}",
    );
    expect(auditPhaseThreeExecutionOrder(roadmap).join("\n")).toContain(
      "must not require optional feature {#optional-document-tools}",
    );
    cooperation.requires = [{ kind: "node", ref: "workflow-live-acceptance" }];
    const migrations = roadmap.spine.find((entry) => entry.kind === "phase" && entry.id === "migrations");
    if (migrations === undefined || migrations.kind !== "phase") throw new Error("test fixture has no Phase 4");
    migrations.requires = [{ kind: "node", ref: "optional-semantic-search" }];
    expect(auditPhaseThreeExecutionOrder(roadmap).join("\n")).toContain(
      "D342 required node {#migrations} must not require optional feature {#optional-semantic-search}",
    );
  });

  it("refuses Phase 0–3 parts or supervisor tasks that leave D326/D328's shared execution grammar", () => {
    const reordered = RoadmapSchema.parse(parsePlan(tree.planText));
    const phase = reordered.spine.find((entry) => entry.kind === "phase" && entry.id === "phase-3");
    expect(phase?.kind).toBe("phase");
    if (phase === undefined || phase.kind !== "phase") throw new Error("test fixture has no Phase 3");
    const part = phase.items.find((item) => item.id === "workflow-authoring-model");
    if (part?.items === undefined) throw new Error("test fixture has no Phase 3.2 tasks");
    [part.items[0], part.items[3]] = [part.items[3], part.items[0]];
    expect(auditPhaseThreeExecutionOrder(reordered).join("\n")).toContain(
      "tasks must advance by consecutive serial/wave ordinals from 1",
    );

    const lettered = RoadmapSchema.parse(parsePlan(tree.planText));
    const letteredPhase = lettered.spine.find((entry) => entry.kind === "phase" && entry.id === "phase-3");
    if (letteredPhase === undefined || letteredPhase.kind !== "phase") throw new Error("test fixture has no Phase 3");
    const task = letteredPhase.items
      .find((item) => item.id === "workflow-authoring-model")
      ?.items?.find((item) => item.title.startsWith("1 · "));
    if (task === undefined) throw new Error("test fixture has no Phase 3.2 Task 1");
    task.title = task.title.replace(/^1 · /, "1A · ");
    expect(auditPhaseThreeExecutionOrder(lettered).join("\n")).toContain(
      'must start with a serial number such as "2 · " or a parallel member such as "2-1 · "',
    );

    const skippedMember = RoadmapSchema.parse(parsePlan(tree.planText));
    const skippedMemberPhase = skippedMember.spine.find(
      (entry) => entry.kind === "phase" && entry.id === "phase-1",
    );
    if (skippedMemberPhase === undefined || skippedMemberPhase.kind !== "phase") {
      throw new Error("test fixture has no Phase 1");
    }
    const waveMember = skippedMemberPhase.items
      .find((item) => item.id === "p1-authority-implementation")
      ?.items?.find((item) => item.title.startsWith("2-2 · "));
    if (waveMember === undefined) throw new Error("test fixture has no Phase 1.6 wave-2 member 2");
    waveMember.title = waveMember.title.replace(/^2-2 · /, "2-3 · ");
    expect(auditPhaseThreeExecutionOrder(skippedMember).join("\n")).toContain(
      "parallel task members for ordinal 2 must be consecutive from -1; expected 2-2, found 2-3",
    );
  });
});
