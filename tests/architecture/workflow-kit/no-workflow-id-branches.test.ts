import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { CHILD_ONLY_WORKFLOW_MODULES, WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { gitVisibleFilesIn, REPO_ROOT } from "../support/helpers/guard-files.js";

/** Generic code: a branch on a workflow id here means adding a workflow touches more than its folder. */
const GENERIC_ROOTS = [
  "src/dashboard/", "src/backend/app/", "src/backend/transports/", "src/backend/runtime/", "src/backend/logs/", "src/services/",
  "src/backend/runs/commands/", "src/backend/runs/projections/", "src/backend/runs/queries/",
  "src/backend/runs/exports/", "src/backend/runs/trust/", "src/backend/runs/start/",
  "src/backend/runs/archive/", "src/backend/runs/notifications/", "src/backend/runs/explain/",
] as const;
const GENERIC_RUN_FILES = new Set([
  "src/backend/runs/lifecycle/run-status.ts", "src/backend/runs/lifecycle/support.ts",
]);

export interface WorkflowIdSite {
  /** A file, or a directory prefix ending in `/`. */
  readonly path: string;
  readonly workflowIds: readonly string[];
  readonly reason: string;
}

const OCR_SERVICE = "OCR is the one workflow with its own record service; these files serve its records and queue.";
const PREVIEW_MOCKS = "approved dashboard preview mocks name the workflows they depict; they are fixtures, not served behavior.";

const DRY_RUN_TARGETS = "the one registration from a workflow id to its dry-run manifest and canonical-input resolver; ingress shapes differ per workflow.";

const ALLOWED_SITES: readonly WorkflowIdSite[] = [
  { path: "src/backend/app/dry-run/manifests.ts", workflowIds: ["person-lookup", "separations", "separations-kuali-finalization"], reason: DRY_RUN_TARGETS },
  { path: "src/backend/app/registries/test-target-registry.ts", workflowIds: ["person-lookup", "separations", "separations-kuali-finalization"],
    reason: "the public test-target registry names the supported workflows without dispatching production behavior." },
  { path: "src/backend/runs/projections/run-queue-projection.ts", workflowIds: ["separations"],
    reason: "queue identity uses the Separations-only canonical identity corpus that indexed Activity uses." },
  { path: "src/backend/runs/queries/activity-summaries.ts", workflowIds: ["separations"],
    reason: "the Activity distinct-person fold reads a done Separations run's terminal identity; other workflows count as foreign." },
  { path: "src/backend/app/composition/dashboard/queue.ts", workflowIds: ["ocr"], reason: OCR_SERVICE },
  { path: "src/backend/app/composition/runtime-composition.ts", workflowIds: ["ocr"], reason: OCR_SERVICE },
  { path: "src/backend/app/composition/worker/run-resources.ts", workflowIds: ["ocr", "ocr-page"], reason: OCR_SERVICE },
  { path: "src/backend/runs/commands/command-kernel.ts", workflowIds: ["ocr"], reason: OCR_SERVICE },
  { path: "src/backend/runs/queries/run-detail.ts", workflowIds: ["ocr"], reason: OCR_SERVICE },
  { path: "src/backend/runs/queries/ocr-record-members.ts", workflowIds: ["ocr", "person-lookup", "i9-lookup"],
    reason: `${OCR_SERVICE} Record members name the lookup child families OCR starts.` },
  { path: "src/dashboard/app/dashboard-app.tsx", workflowIds: ["ocr"], reason: "a manual OCR start opens its record review." },
  { path: "src/dashboard/surfaces/explorer/explorer-workflow-model.ts", workflowIds: ["ocr", "work-study"], reason: "OCR's record keys label its Explorer nodes; Work-Study's effective date is labelled as operator input." },
  { path: "src/dashboard/surfaces/shell/search/search-wiring-model.ts", workflowIds: ["ocr"], reason: "search opens an unapproved OCR run on its records." },
  { path: "src/dashboard/surfaces/sessions/sessions-fixture.ts", workflowIds: ["person-lookup", "separations"], reason: PREVIEW_MOCKS },
  { path: "src/dashboard/surfaces/explorer/explorer-spec-fixtures.ts", workflowIds: ["person-lookup"], reason: PREVIEW_MOCKS },
  { path: "src/dashboard/surfaces/workflows/mocks/", reason: PREVIEW_MOCKS, workflowIds: [
    "crm-doc-download", "emergency-contact", "i9-check-start", "i9-lookup", "ocr", "onbase", "onboarding", "person-lookup", "separations", "work-study",
  ] },
];

function inScope(path: string): boolean {
  if (!/\.tsx?$/u.test(path) || /\.(?:test|scenario|walk)\./u.test(path)) return false;
  return GENERIC_ROOTS.some((root) => path.startsWith(root)) || GENERIC_RUN_FILES.has(path);
}

function covers(site: WorkflowIdSite, path: string): boolean {
  return site.path.endsWith("/") ? path.startsWith(site.path) : path === site.path;
}

export function workflowIdBranchIssues(
  sources: ReadonlyMap<string, string>,
  ids: readonly string[],
  sites: readonly WorkflowIdSite[],
): readonly string[] {
  const issues: string[] = [];
  const used = new Set<string>();
  for (const [path, text] of sources) {
    if (!inScope(path) || !ids.some((id) => text.includes(`"${id}"`) || text.includes(`'${id}'`) || text.includes(`\`${id}\``))) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && ids.includes(node.text)) {
        const index = sites.findIndex((site) => covers(site, path) && site.workflowIds.includes(node.text));
        if (index >= 0) used.add(`${index}\u001f${node.text}`);
        else {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          issues.push(`${path}:${line} names workflow "${node.text}" in generic code; serve the fact from the workflow's own definition`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  sites.forEach((site, index) => {
    if (site.reason.trim() === "") issues.push(`${site.path}: allowed workflow-id site needs a reason`);
    for (const id of site.workflowIds) {
      if (!used.has(`${index}\u001f${id}`)) issues.push(`${site.path} / "${id}": stale allowed workflow-id site; remove it`);
    }
  });
  return issues;
}

const ids = [...WORKFLOW_MODULES, ...CHILD_ONLY_WORKFLOW_MODULES, ...STEP_PROOF_MODULES].map((module) => String(module.descriptor.id));
const sources = new Map(
  gitVisibleFilesIn(REPO_ROOT, ["src"]).filter(inScope).map((path) => [path, readFileSync(join(REPO_ROOT, path), "utf8")]),
);

describe("generic code branches on no workflow id", () => {
  it("the repository passes and the scan is not empty", () => {
    expect(ids.length).toBeGreaterThan(3);
    expect(sources.size).toBeGreaterThan(100);
    expect(workflowIdBranchIssues(sources, ids, ALLOWED_SITES)).toEqual([]);
  });

  it("refuses a new branch in generic code", () => {
    const changed = new Map(sources);
    changed.set("src/dashboard/client/new-branch.ts", `export const isLookup = (id: string) => id === "${ids[0]}";\n`);
    expect(workflowIdBranchIssues(changed, ids, ALLOWED_SITES)).toEqual([
      expect.stringContaining(`src/dashboard/client/new-branch.ts:1 names workflow "${ids[0]}"`),
    ]);
  });

  it("refuses an allowed file naming a workflow its entry does not list", () => {
    const site = ALLOWED_SITES.find((entry) => !entry.path.endsWith("/"))!;
    const other = ids.find((id) => !site.workflowIds.includes(id))!;
    const changed = new Map(sources);
    changed.set(site.path, `${sources.get(site.path)}\nexport const injected = "${other}";\n`);
    expect(workflowIdBranchIssues(changed, ids, ALLOWED_SITES)).toEqual([expect.stringContaining(`names workflow "${other}"`)]);
  });

  it("refuses a stale entry and an entry with no reason", () => {
    const stale: WorkflowIdSite = { path: "src/services/", workflowIds: ["not-a-workflow"], reason: "" };
    expect(workflowIdBranchIssues(sources, [...ids, "not-a-workflow"], [...ALLOWED_SITES, stale])).toEqual([
      "src/services/: allowed workflow-id site needs a reason",
      'src/services/ / "not-a-workflow": stale allowed workflow-id site; remove it',
    ]);
  });

  it("ignores tests and code outside the generic roots", () => {
    const changed = new Map(sources);
    changed.set("src/dashboard/client/branch.test.ts", `export const id = "${ids[0]}";\n`);
    changed.set(`src/workflows/${ids[0]}/extra.ts`, `export const id = "${ids[0]}";\n`);
    expect(workflowIdBranchIssues(changed, ids, ALLOWED_SITES)).toEqual([]);
  });
});
