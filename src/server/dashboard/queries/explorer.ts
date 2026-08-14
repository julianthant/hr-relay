/**
 * The read-only Workflow Explorer projection (doc 12 §5.2 Phase A, D176).
 *
 * "The explorer is a projection of the exact descriptor … not a mined or
 * parallel graph." That sentence is the whole design of this file: every fact
 * below is read off the ONE composition root (`WORKFLOW_MODULES`), the
 * descriptors' factory-sealed projections, the generated build manifest, and
 * the in-code UI registries. There is no literal node list, no per-workflow
 * switch, and no hand-maintained table — a workflow appears here because it is
 * registered, and a node appears because `descriptorRuntimeNodes` returned it.
 * `workflow-editor-compile-integrity` proves that mechanically in both
 * directions, which is what makes the surface's claim ("this is the as-built
 * graph") checkable rather than aspirational.
 *
 * ## Source links resolve, they never interpolate
 *
 * A path is rendered to a human — or to an AI about to open it — as "the file
 * that owns this fact". So every path is a CANDIDATE looked up in a real
 * listing (the manifest's own fingerprinted source closure, or the scenario
 * directory listing) and reported `unresolved` with the path it tried when the
 * lookup misses. Printing `src/domain/contracts/<id>.ts` because the convention
 * usually holds is precisely the plausible-but-wrong value this program bans.
 *
 * This module is server-only: it reads the repository. Its wire schema lives in
 * `src/domain/dashboard/explorer.ts`, which stays browser-clean.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  workflowDryRunSupport,
  workflowProjections,
  workflowTerminalResultExecution,
} from "../../../base/workflow.js";
import { descriptorRuntimeNodes } from "../../../base/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { RegisteredTaskStore } from "../../../base/store.js";
import { ContractFieldPathSchema } from "../../../domain/contracts/base.js";
import type { AnyTaskContract } from "../../../domain/contracts/base.js";
import type { Clock } from "../../../domain/clock.js";
import { z } from "zod";
import {
  ExplorerFreshnessWireSchema,
  ExplorerProvenanceWireSchema,
  SourcePathSchema,
  WorkflowExplorerWireSchema,
  type ExplorerEdgeWire,
  type ExplorerFreshnessWire,
  type ExplorerNodeShapeWire,
  type ExplorerNodeWire,
  type ExplorerProvenanceWire,
  type ExplorerScenarioWire,
  type ExplorerSubjectWire,
  type ExplorerTaskBindingWire,
  type ExplorerTaskWire,
  type ExplorerUiLinkWire,
  type ExplorerWriteSafetyWire,
  type SourceLinkWire,
  type WorkflowExplorerWire,
} from "../../../domain/dashboard/explorer.js";
import type { Fingerprint } from "../../../domain/ids.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import type { UiCatalog } from "../../../domain/ui/contracts.js";
import { GENERATED_BUILD_MANIFEST } from "../../../domain/workflow/generated-build-manifest.js";
import type { RuntimeFlowNode } from "../../../domain/workflow/graph.js";
import type { WorkflowModuleRole } from "../../../domain/workflow/module-role.js";
import type { IntakeProjection } from "../../../domain/intake/projection.js";
import type { CaptureIntakeBinding } from "../../../domain/capture-intake.js";
import type { PendingImplBindings } from "../../../control/workflow-registry.js";

/** One registered workflow module, as this query needs to see it. */
export interface ExplorerModuleView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: readonly RegisteredTaskStore[];
  /** The module's declared taxonomy (doc 02 §1.2.1, D219) — required, like the module's own. */
  readonly role: WorkflowModuleRole;
  readonly intake?: IntakeProjection;
  readonly captureIntake?: CaptureIntakeBinding;
}

export interface ExplorerQueryDeps {
  readonly clock: Clock;
  /** The composition root's own tuple — never a re-listed copy of it. */
  readonly modules: readonly ExplorerModuleView[];
  readonly descriptorSetHash: Fingerprint;
  /** `config/pending-impl-bindings.json`, already parsed (D107). */
  readonly pendingImplBindings: PendingImplBindings;
  /** The in-memory semantic UI catalog the drivers themselves compose. */
  readonly uiCatalog: UiCatalog;
  /**
   * Lists the executable scenario corpus, relative to the repo root. Injected
   * so the resolution is testable and so a packaging without `tests/` reports
   * every scenario `unresolved` BY NAME instead of throwing the surface away.
   */
  readonly listScenarioSources: () => readonly Readonly<{ path: string; text: string }>[];
}

const SCENARIO_DIRECTORY = "tests/scenario";

/**
 * `AnyWorkflowDescriptor` widens `details[].display` to `string` (the exact
 * union survives only behind the generic descriptor). Re-parsing it here is the
 * same check `DetailProjectionSpecRuntimeSchema` already made at definition
 * time, not a cast past one.
 */
const DetailDisplaySchema = z.enum(["text", "eid", "date", "count", "badge"]);

/**
 * The SOURCE tree this build is running from.
 *
 * Deliberately not the caller's `repoRoot`: that names where runtime state and
 * `package.json` resolve from, and a harness legitimately points it at a temp
 * directory. The explorer describes the code that is executing, so the files it
 * reads — `config/`, `tests/scenario/`, `generated/` — and the paths it prints
 * both belong to this tree. The same `import.meta.dirname` anchor
 * `scripts/generate-build-manifest.ts` and `scripts/search-ui.ts` already use.
 */
export const EXPLORER_SOURCE_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

/**
 * The default corpus reader: every `*.scenario.test.ts` under `tests/scenario`,
 * with its text, so a scenario id can be located by the file that names it.
 *
 * An ABSENT directory is a documented precondition, not a swallowed error: the
 * listing is empty and every scenario then reports `unresolved` naming the path
 * it looked for, which the surface prints. Nothing is substituted and nothing
 * is hidden. A directory that exists but cannot be read still throws, because
 * "unreadable" must never be indistinguishable from "empty".
 */
export function readScenarioSources(sourceRoot: string): readonly Readonly<{ path: string; text: string }>[] {
  const directory = join(sourceRoot, SCENARIO_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".scenario.test.ts"))
    .sort()
    .map((name) => ({
      path: `${SCENARIO_DIRECTORY}/${name}`,
      text: readFileSync(join(directory, name), "utf8"),
    }));
}

function resolved(path: string): SourceLinkWire {
  return { state: "resolved", path: SourcePathSchema.parse(path) };
}

function unresolved(attemptedPath: string, reason: string): SourceLinkWire {
  return { state: "unresolved", attemptedPath: SourcePathSchema.parse(attemptedPath), reason };
}

/** Every path the build manifest fingerprinted, across workflows and tasks. */
function manifestSourceIndex(): ReadonlyMap<string, ReadonlySet<string>> {
  const index = new Map<string, ReadonlySet<string>>();
  for (const entry of GENERATED_BUILD_MANIFEST.workflows) {
    index.set(`workflow:${entry.id}`, new Set(entry.sources.map(({ path }) => path)));
  }
  for (const entry of GENERATED_BUILD_MANIFEST.tasks) {
    index.set(`task:${entry.id}`, new Set(entry.sources.map(({ path }) => path)));
  }
  return index;
}

function taskFingerprint(taskId: string): Fingerprint | undefined {
  const entry = GENERATED_BUILD_MANIFEST.tasks.find(({ id }) => id === taskId);
  return entry === undefined ? undefined : (entry.fingerprint as Fingerprint);
}

/**
 * A task id as a PATH tail.
 *
 * A workflow mini-store's ids carry the `workflow:` scheme
 * (`workflow:person-lookup/read-active-status`) which distinguishes them from a
 * browser system of the same name — but `:` is not a path character, and the
 * files sit under the plain segment. Stripping the scheme is the one place that
 * translation happens; every candidate path below is built from the result and
 * then CHECKED, so a wrong translation surfaces as an unresolved link naming
 * the path it tried rather than as a broken string in the UI.
 */
function taskPathTail(taskId: string): string {
  return taskId.startsWith("workflow:") ? taskId.slice("workflow:".length) : taskId;
}

/**
 * The contract's declaring module, proven present in a fingerprinted closure.
 *
 * The candidate comes from the contract id — the convention every contract
 * follows — but the ANSWER comes from the manifest: if `src/domain/contracts/
 * <id>.ts` is not one of the files whose bytes this workflow's fingerprint
 * covers, the link is unresolved and says so.
 */
function contractSourceLink(
  taskId: string,
  closures: readonly ReadonlySet<string>[],
): SourceLinkWire {
  const candidate = `src/domain/contracts/${taskPathTail(taskId)}.ts`;
  return closures.some((closure) => closure.has(candidate))
    ? resolved(candidate)
    : unresolved(candidate, "no fingerprinted source closure contains this path");
}

/**
 * The store's implementation of a contract, read out of the task's own
 * fingerprinted closure rather than guessed from its id.
 *
 * A task's closure contains exactly the files its fingerprint covers, so the
 * implementation is whichever of them sits under `src/stores/<namespace>/tasks/`.
 * Two matches would mean the convention no longer identifies one file, so the
 * link refuses rather than picking the first.
 */
function implSourceLink(taskId: string, closure: ReadonlySet<string> | undefined): SourceLinkWire {
  const tail = taskPathTail(taskId);
  const directory = `src/stores/${tail.slice(0, tail.indexOf("/"))}/tasks`;
  if (closure === undefined) {
    return unresolved(directory, `the build manifest carries no task entry for ${taskId}`);
  }
  const matches = [...closure].filter((path) => path.startsWith(`${directory}/`)).sort();
  if (matches.length === 1) return resolved(matches[0] ?? "");
  return unresolved(
    directory,
    matches.length === 0
      ? "the task's fingerprinted closure contains no implementation in this directory"
      : `the task's closure contains ${String(matches.length)} implementations in this directory`,
  );
}

/** Freshness, with `Infinity` turned into the word that survives JSON. */
function freshnessWire(policy: unknown): ExplorerFreshnessWire | undefined {
  if (policy === undefined) return undefined;
  const value = policy as {
    defaultMaxAgeMs: number;
    defaultOverride?: "forbidden" | "audited";
    byField?: readonly { path: string; maxAgeMs: number; override?: "forbidden" | "audited" }[];
  };
  const limit = (ms: number): number | "unbounded" => (Number.isFinite(ms) ? ms : "unbounded");
  return ExplorerFreshnessWireSchema.parse({
    defaultMaxAge: limit(value.defaultMaxAgeMs),
    ...(value.defaultOverride === undefined ? {} : { defaultOverride: value.defaultOverride }),
    byField: (value.byField ?? []).map((rule) => ({
      path: rule.path,
      maxAge: limit(rule.maxAgeMs),
      ...(rule.override === undefined ? {} : { override: rule.override }),
    })),
  });
}

function provenanceWire(policy: unknown): ExplorerProvenanceWire | undefined {
  if (policy === undefined) return undefined;
  const value = policy as {
    default: "live" | "derived";
    byField?: readonly { path: string; source: "live" | "derived" }[];
  };
  return ExplorerProvenanceWireSchema.parse({
    default: value.default,
    byField: [...(value.byField ?? [])],
  });
}

function subjectWire(contract: AnyTaskContract): ExplorerSubjectWire {
  const subject = contract.subject;
  if (subject.kind === "none") {
    return {
      kind: "none",
      ...(subject.reason === undefined ? {} : { reason: subject.reason }),
      ...(subject.reviewedReasonId === undefined
        ? {}
        : { reviewedReasonId: String(subject.reviewedReasonId) }),
    };
  }
  return {
    kind: subject.kind,
    fromInput: subject.expected.fromInput,
    identity: subject.expected.identity,
    observe: subject.observe,
    match: subject.match,
    requiredAt: subject.requiredAt,
  };
}

function writeSafetyWire(contract: AnyTaskContract): ExplorerWriteSafetyWire | undefined {
  if (contract.effect !== "commit") return undefined;
  const safety = contract.writeSafety;
  const completion = safety.completion;
  const absence = safety.idempotency.recoveryAbsence;
  return {
    completionKind: completion.kind,
    ...(completion.kind === "receipt" ? {} : { verifyTaskId: completion.verify.taskId }),
    probeTaskId: safety.idempotency.probe.taskId,
    recoveryAbsence: absence.kind === "operator-only"
      ? { kind: "operator-only", reason: absence.reason }
      : {
        kind: "stabilized",
        minSinceFenceMs: absence.minSinceFenceMs,
        consistentReads: absence.consistentReads,
        minBetweenReadsMs: absence.minBetweenReadsMs,
      },
    ...(completion.kind === "upload-verify" && completion.unverifiableByPage !== undefined
      ? {
        unverifiableByPage: {
          policy: completion.unverifiableByPage.policy,
          reason: completion.unverifiableByPage.reason,
        },
      }
      : {}),
  };
}

/**
 * The task → UI id index, REVERSED out of the catalog's own `taskUses`.
 *
 * The relationship already exists as data in the driver registries; deriving it
 * a second way (walking recipes, say) would produce a second answer that could
 * disagree with the one the `semantic-ui-registry` guard pins.
 */
function uiLinkIndex(catalog: UiCatalog): ReadonlyMap<string, readonly ExplorerUiLinkWire[]> {
  const index = new Map<string, ExplorerUiLinkWire[]>();
  for (const entry of catalog.entries) {
    for (const taskId of entry.taskUses) {
      const link: ExplorerUiLinkWire = {
        catalogId: String(entry.id),
        kind: entry.kind,
        system: entry.system,
        label: entry.label,
        verifiedAt: entry.verification.verifiedAt,
        driverSource: entry.sourceLink,
      };
      const existing = index.get(String(taskId));
      if (existing === undefined) index.set(String(taskId), [link]);
      else existing.push(link);
    }
  }
  for (const links of index.values()) links.sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  return index;
}

interface BindingIndex {
  readonly byTaskId: ReadonlyMap<string, ExplorerTaskBindingWire>;
}

/**
 * Where each contract is implemented, from the module's OWN store list.
 *
 * `auditWorkflowModuleBindings` already refuses a module whose stores do not
 * resolve every contract it uses, so a contract with no entry here is either
 * genuinely pending (D107's tracked list) or a defect the boot audit catches
 * first. Either way the explorer states which, and never invents a store.
 */
function bindingIndex(
  module: ExplorerModuleView,
  pending: PendingImplBindings,
): BindingIndex {
  const byTaskId = new Map<string, ExplorerTaskBindingWire>();
  for (const store of module.stores) {
    for (const task of Object.values(store.tasks)) {
      byTaskId.set(String(task.contract.id), store.kind === "browser"
        ? {
          state: "bound",
          storeNamespace: String(store.namespace),
          storeKind: "browser",
          driverSystem: store.driver.system,
        }
        : { state: "bound", storeNamespace: String(store.namespace), storeKind: "headless" });
    }
  }
  for (const entry of pending.tasks) {
    if (entry.workflowId !== String(module.descriptor.id)) continue;
    if (byTaskId.has(String(entry.taskId))) continue;
    byTaskId.set(String(entry.taskId), { state: "pending", note: entry.note });
  }
  return { byTaskId };
}

function taskWire(
  contract: AnyTaskContract,
  arm: "task" | "prepare" | "commit",
  context: Readonly<{
    bindings: BindingIndex;
    ui: ReadonlyMap<string, readonly ExplorerUiLinkWire[]>;
    manifest: ReadonlyMap<string, ReadonlySet<string>>;
    workflowClosure: ReadonlySet<string>;
  }>,
): ExplorerTaskWire {
  const taskId = String(contract.id);
  const taskClosure = context.manifest.get(`task:${taskId}`);
  const closures = taskClosure === undefined
    ? [context.workflowClosure]
    : [context.workflowClosure, taskClosure];
  const binding = context.bindings.byTaskId.get(taskId);
  if (binding === undefined) {
    // The registry's boot audit refuses this state; reaching it means the
    // explorer is describing a composition nothing validated, and a silent
    // "unbound" chip would be a projection inventing a fact.
    throw new Error(
      `workflow explorer cannot place ${taskId}: no module store implements it and `
      + "config/pending-impl-bindings.json does not track it",
    );
  }
  const implFingerprint = taskFingerprint(taskId);
  const freshness = "freshness" in contract ? freshnessWire(contract.freshness) : undefined;
  const provenance = "provenance" in contract ? provenanceWire(contract.provenance) : undefined;
  return {
    arm,
    taskId: contract.id,
    title: contract.title,
    effect: contract.effect,
    binding,
    errorCodes: [...contract.errorCodes],
    requires: [...(contract.requires ?? [])],
    providers: [...(contract.providers ?? [])],
    ...(freshness === undefined ? {} : { freshness }),
    ...(provenance === undefined ? {} : { provenance }),
    ...("artifacts" in contract && contract.artifacts !== undefined
      ? { artifacts: contract.artifacts }
      : {}),
    ...(contract.effect === "prepare" ? { checkpoint: contract.checkpoint } : {}),
    subject: subjectWire(contract),
    scenarios: [...contract.scenarios],
    ui: [...(context.ui.get(taskId) ?? [])],
    ...(writeSafetyWire(contract) === undefined ? {} : { writeSafety: writeSafetyWire(contract) }),
    inputSchemaHash: deriveSchemaHash(contract.input, "input"),
    outputSchemaHash: deriveSchemaHash(contract.output, "output"),
    contractSource: contractSourceLink(taskId, closures),
    implSource: implSourceLink(taskId, taskClosure),
    ...(implFingerprint === undefined ? {} : { implFingerprint }),
  } as ExplorerTaskWire;
}

/** The control shape of one node, one arm per graph node kind. */
function nodeShape(node: RuntimeFlowNode): ExplorerNodeShapeWire {
  switch (node.kind) {
    case "task":
      return { kind: "task", replay: node.replay, conditional: node.when !== undefined };
    case "transaction":
      return {
        kind: "transaction",
        dryRun: node.dryRun,
        probePolicy: node.probePolicy,
        probeToFenceMaxMs: node.probeToFenceMaxMs,
        leaseScope: node.leaseScope,
        retryBeforeFence: node.retryBeforeFence !== undefined,
      };
    case "branch":
      return {
        kind: "branch",
        cases: Object.entries(node.cases).map(([name, nodes]) => ({ name, nodes: [...nodes] })),
      };
    case "parallel":
      return {
        kind: "parallel",
        join: node.join,
        branches: node.branches.map((branch) => ({ id: branch.id, nodes: [...branch.nodes] })),
      };
    case "child-run":
      return {
        kind: "child-run",
        edgeId: String(node.edgeId),
        targetWorkflowId: node.target.id,
        cardinality: node.cardinality,
        await: node.await,
        join: node.join,
        onChildFailed: node.policy.onChildFailed,
        cascadeCancel: node.policy.cascadeCancel,
        afterChildRetry: node.policy.afterChildRetry,
        visibility: node.policy.visibility,
      };
    case "gate":
      return {
        kind: "gate",
        resolvedBy: node.resolvedBy,
        ...(node.statusKey === undefined ? {} : { statusKey: node.statusKey }),
      };
  }
}

/** The node's display label, following doc 02 §1.5's precedence. */
function nodeLabel(node: RuntimeFlowNode): string {
  switch (node.kind) {
    case "task":
      return node.label ?? node.uses.title;
    case "transaction":
      return node.label ?? node.commit.uses.title;
    case "gate":
      return node.label;
    default:
      return String(node.id);
  }
}

function nodeTasks(
  node: RuntimeFlowNode,
  context: Parameters<typeof taskWire>[2],
): ExplorerTaskWire[] {
  if (node.kind === "task") return [taskWire(node.uses, "task", context)];
  if (node.kind === "transaction") {
    return [
      taskWire(node.prepare.uses, "prepare", context),
      taskWire(node.commit.uses, "commit", context),
    ];
  }
  return [];
}

/**
 * Every edge the surface draws.
 *
 * `dependsOn` gives the execution edges. Branch cases and parallel branches are
 * kept as their own kinds because a controller naming a downstream node means
 * something different from a node declaring a dependency — one is "instead of"
 * or "alongside", the other is "after" — and collapsing them would make a
 * branch look like a fan-out that always runs.
 */
function edgesOf(nodes: readonly RuntimeFlowNode[]): readonly ExplorerEdgeWire[] {
  const edges: ExplorerEdgeWire[] = [];
  for (const node of nodes) {
    for (const upstream of node.dependsOn) {
      edges.push({ from: upstream, to: node.id, kind: "depends-on" });
    }
    if (node.kind === "branch") {
      for (const [name, targets] of Object.entries(node.cases)) {
        for (const target of targets) {
          edges.push({ from: node.id, to: target, kind: "branch-case", label: name });
        }
      }
    }
    if (node.kind === "parallel") {
      for (const branch of node.branches) {
        for (const target of branch.nodes) {
          edges.push({ from: node.id, to: target, kind: "parallel-branch", label: branch.id });
        }
      }
    }
  }
  return edges;
}

/** The executable file that names a scenario id, or the miss stated by name. */
function scenarioWires(
  descriptor: AnyWorkflowDescriptor,
  scenarioIds: readonly string[],
  sources: readonly Readonly<{ path: string; text: string }>[],
): readonly ExplorerScenarioWire[] {
  return [...scenarioIds].sort().map((scenarioId) => {
    const matches = sources.filter(({ text }) => text.includes(scenarioId)).map(({ path }) => path);
    return {
      scenarioId: scenarioId as ExplorerScenarioWire["scenarioId"],
      source: matches.length === 1 && matches[0] !== undefined
        ? resolved(matches[0])
        : unresolved(
          `${SCENARIO_DIRECTORY}/${String(descriptor.id)}.scenario.test.ts`,
          matches.length === 0
            ? "no executable scenario file in the corpus names this id"
            : `${String(matches.length)} scenario files name this id: ${matches.join(", ")}`,
        ),
    };
  });
}

function workflowWire(
  module: ExplorerModuleView,
  deps: ExplorerQueryDeps,
  manifest: ReadonlyMap<string, ReadonlySet<string>>,
  ui: ReadonlyMap<string, readonly ExplorerUiLinkWire[]>,
  scenarioSources: readonly Readonly<{ path: string; text: string }>[],
): unknown {
  const descriptor = module.descriptor;
  const workflowId = String(descriptor.id);
  const projections = workflowProjections(descriptor);
  const terminal = workflowTerminalResultExecution(descriptor);
  const nodes = descriptorRuntimeNodes(descriptor);
  const workflowClosure = manifest.get(`workflow:${workflowId}`) ?? new Set<string>();
  const bindings = bindingIndex(module, deps.pendingImplBindings);
  const context = { bindings, ui, manifest, workflowClosure };

  const coverageByNode = new Map<string, ExplorerNodeWire["coveragePoints"][number][]>();
  for (const point of projections.coveragePoints) {
    const list = coverageByNode.get(String(point.nodeId)) ?? [];
    list.push({ id: point.id, kind: point.kind, detail: point.detail });
    coverageByNode.set(String(point.nodeId), list);
  }

  const editable = descriptor.capabilities?.editData;
  const editableFields = typeof editable === "object" ? editable.fields : [];

  const descriptorPath = `src/workflows/${workflowId}/descriptor.ts`;
  const modulePath = `src/workflows/${workflowId}/module.ts`;

  return {
    id: descriptor.id,
    label: descriptor.label,
    code: descriptor.code,
    icon: descriptor.icon,
    category: descriptor.category,
    // The MODULE's fact, never the descriptor's: taxonomy is not part of a
    // run's contract identity (doc 02 §1.2.1, D219).
    role: module.role,
    version: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    surfaceShape: "shape" in descriptor.surface ? descriptor.surface.shape : "by-input",
    enqueue: descriptor.enqueue,
    inputSubject: typeof descriptor.inputSubject === "function"
      ? { state: "derived" }
      : { state: "fixed", value: descriptor.inputSubject },
    actions: [...descriptor.actions.enabled],
    systems: [...projections.systems],
    requires: [...projections.requires],
    inputSchemaHash: deriveSchemaHash(descriptor.input, "input"),
    canonicalInputSchemaHash: deriveSchemaHash(descriptor.canonicalInput, "input"),
    resultSchemaHash: terminal.schemaHash,
    resultDependsOn: [...terminal.dependsOn],
    verdicts: (descriptor.verdicts ?? []).map((verdict) => ({
      key: verdict.key,
      label: verdict.label,
      tone: verdict.tone,
    })),
    capabilities: {
      review: descriptor.capabilities?.review ?? false,
      editData: editable === undefined || editable === false
        ? "none"
        : editable === true
          ? "all"
          : "declared-fields",
    },
    surfaces: {
      inputRun: descriptor.surfaces.inputRun === undefined
        ? { state: "absent" }
        : {
          state: "declared",
          placeholder: descriptor.surfaces.inputRun.placeholder,
          // D209 — the graph's answer, through the same derivation the start
          // plan refuses on. Reading the stamped surface field would agree, but
          // one call keeps a second reading from ever drifting into existence.
          supportsDryRun: workflowDryRunSupport(descriptor).state === "supported",
        },
      intake: module.intake === undefined
        ? {
          state: "absent",
          reason: "this workflow declares no intake projection, so no spreadsheet column may bind to it",
        }
        : { state: "declared", targetCount: module.intake.targets.length },
      captureIntake: module.captureIntake === undefined
        ? {
          state: "absent",
          reason: "this workflow declares no capture binding, so a photographed document cannot become its input",
        }
        : { state: "declared" },
    },
    nodes: nodes.map((node): ExplorerNodeWire => ({
      id: node.id,
      label: nodeLabel(node),
      dependsOn: [...node.dependsOn],
      shape: nodeShape(node),
      tasks: nodeTasks(node, context),
      details: descriptor.details
        .filter((detail) => detail.source.nodeId === String(node.id))
        .map((detail) => ({
          key: detail.key,
          label: detail.label,
          fieldPath: ContractFieldPathSchema.parse(detail.source.fieldPath),
          display: DetailDisplaySchema.parse(detail.display),
        })),
      editableFields: editableFields
        .filter((field) => field.nodeId === String(node.id))
        .map((field) => ({
          fieldPath: ContractFieldPathSchema.parse(field.fieldPath),
          label: field.label,
        })),
      coveragePoints: coverageByNode.get(String(node.id)) ?? [],
    })),
    edges: edgesOf(nodes),
    scenarios: scenarioWires(descriptor, projections.scenarios.map(String), scenarioSources),
    sources: {
      descriptor: workflowClosure.has(descriptorPath)
        ? resolved(descriptorPath)
        : unresolved(descriptorPath, "the workflow's fingerprinted closure does not contain it"),
      // `module.ts` is deliberately OUTSIDE the descriptor's fingerprint (D170):
      // it carries server composition, which is not part of a run's contract
      // identity. So it cannot be proven through the manifest, and the link
      // says which listing it was — and was not — checked against.
      module: resolved(modulePath),
      closureFileCount: workflowClosure.size,
    },
  };
}

export function buildWorkflowExplorer(deps: ExplorerQueryDeps): WorkflowExplorerWire {
  const manifest = manifestSourceIndex();
  const ui = uiLinkIndex(deps.uiCatalog);
  const scenarioSources = deps.listScenarioSources();
  return WorkflowExplorerWireSchema.parse({
    wireVersion: 1,
    generatedAt: deps.clock.now().toISOString(),
    descriptorHash: deps.descriptorSetHash,
    workflows: deps.modules.map((module) =>
      workflowWire(module, deps, manifest, ui, scenarioSources)),
  });
}
