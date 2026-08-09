/**
 * The read-only Workflow Explorer (doc 12 §5.2 Phase A, doc 03 §13, D176).
 *
 * ## THESIS — the identifier is the interface
 *
 * This surface refuses the shape its category always ships: the workflow-builder
 * canvas, with draggable rounded nodes and bezier edges. On a READ-ONLY
 * explorer that shape is a lie — it draws a mutation affordance over a graph
 * nobody may mutate, and doc 12 §5.1 rejected the free-form visual programmer
 * outright. What an operator or a code-changing AI actually arrives holding is
 * an id or a failure location, and what they need to leave with is the exact
 * node, contract, UI ids, scenarios and source paths. So the page spends its
 * whole budget on identifiers: every one of them is a `Chip`, which this design
 * system already renders monospaced and truncation-safe.
 *
 * ## The two regions, and why they are those two
 *
 * A **structure rail** on the left carries the graph itself — nodes in
 * dependency order, with a controller's downstream nodes INDENTED beneath it so
 * a branch case reads as "instead of" and a parallel branch as "alongside",
 * which `dependsOn` alone cannot express. A **record column** on the right
 * carries the selected node's whole binding in one uninterrupted read, because
 * the question being answered is a lookup and a lookup that hides half its
 * answer behind a second click is a worse index than the source tree.
 *
 * ## What is NOT here, and why that is honest
 *
 * There is no control on this surface that sends anything to the server: the
 * client interface it uses has no mutating method, and the wire has nowhere to
 * put one. The live-run overlay doc 12 §5.2 also lists (timings, attempts,
 * checkpoint reuse over the same graph) is deliberately out of Phase A here —
 * the run-detail timeline already serves that per run, and joining the two is
 * its own slice with its own projection.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CircleDot,
  FileCode2,
  GitBranch,
  GitFork,
  Hand,
  Repeat,
  ScanEye,
  ShieldAlert,
  Split,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import type {
  ExplorerNodeWire,
  ExplorerTaskWire,
  ExplorerWorkflowWire,
  SourceLinkWire,
  WorkflowExplorerWire,
} from "../../domain/dashboard/explorer.js";
import {
  Badge,
  Banner,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  IconButton,
  MetaLine,
  Panel,
  PanelBody,
  PanelHeader,
  SectionLabel,
  Spinner,
  dsFocus,
  dsIcon,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { DashboardClientError } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";

/* ── the one saturated mark on the page ──────────────────────────────────── */

/**
 * A node kind's glyph and how loudly it is drawn.
 *
 * Only `transaction` is tinted, and it is the one fact on this surface that can
 * change a real HR system. Everything else is neutral on purpose: a page that
 * colours six node kinds six ways spends its whole colour budget on taxonomy
 * and has nothing left for consequence. The word travels beside the glyph in
 * every case, so the tint is never the only encoding.
 */
const NODE_KIND = {
  task: { Icon: CircleDot, word: "Task", loud: false },
  transaction: { Icon: ShieldAlert, word: "Transaction", loud: true },
  branch: { Icon: Split, word: "Branch", loud: false },
  parallel: { Icon: GitFork, word: "Parallel", loud: false },
  "child-run": { Icon: Boxes, word: "Child run", loud: false },
  gate: { Icon: Hand, word: "Gate", loud: false },
} as const;

const ARM_WORD = { task: "runs", prepare: "prepares", commit: "commits" } as const;

/* ── source links ────────────────────────────────────────────────────────── */

/**
 * A path, or the miss stated by name.
 *
 * An unresolved link prints the path it TRIED and the reason, because the
 * reader's next move differs completely between "the file moved" and "there is
 * no such file" — and a link that quietly disappeared would leave them
 * believing the fact has no source at all.
 */
function SourceLink({ label, link }: { label: string; link: SourceLinkWire }) {
  if (link.state === "resolved") {
    return (
      <Chip label={label} icon={<FileCode2 aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
        {link.path}
      </Chip>
    );
  }
  return (
    <Chip
      label={label}
      tone="warning"
      title={`${link.attemptedPath} — ${link.reason}`}
      icon={<SquareArrowOutUpRight aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}
    >
      {`unresolved: ${link.attemptedPath}`}
    </Chip>
  );
}

/* ── the structure rail ──────────────────────────────────────────────────── */

interface RailRow {
  readonly node: ExplorerNodeWire;
  readonly depth: number;
  /** The controller relationship that put this node at this depth, if any. */
  readonly under?: Readonly<{ kind: "branch-case" | "parallel-branch"; label: string }>;
}

/**
 * Flatten the graph into rows, indenting a controller's downstream nodes.
 *
 * Declaration order is the spine — the builder already emitted nodes in a legal
 * order — and a node named by a branch case or a parallel branch is drawn under
 * its controller instead, ONCE, at the first controller that claims it. A node
 * claimed by nothing stays at depth zero. Two properties matter and both are
 * asserted by the surface's tests: every node appears exactly once, and no node
 * disappears because its controller was renamed.
 */
export function railRows(workflow: ExplorerWorkflowWire): readonly RailRow[] {
  const byId = new Map(workflow.nodes.map((node) => [String(node.id), node]));
  const claimedBy = new Map<string, RailRow["under"]>();
  for (const node of workflow.nodes) {
    if (node.shape.kind === "branch") {
      for (const branchCase of node.shape.cases) {
        for (const target of branchCase.nodes) {
          if (!claimedBy.has(String(target))) {
            claimedBy.set(String(target), { kind: "branch-case", label: branchCase.name });
          }
        }
      }
    }
    if (node.shape.kind === "parallel") {
      for (const branch of node.shape.branches) {
        for (const target of branch.nodes) {
          if (!claimedBy.has(String(target))) {
            claimedBy.set(String(target), { kind: "parallel-branch", label: branch.id });
          }
        }
      }
    }
  }

  const rows: RailRow[] = [];
  const emitted = new Set<string>();
  const emit = (node: ExplorerNodeWire, depth: number, under?: RailRow["under"]): void => {
    const id = String(node.id);
    if (emitted.has(id)) return;
    emitted.add(id);
    rows.push({ node, depth, ...(under === undefined ? {} : { under }) });
    const shape = node.shape;
    const children = shape.kind === "branch"
      ? shape.cases.flatMap((one) => one.nodes.map((target) => ({ target, label: one.name, kind: "branch-case" as const })))
      : shape.kind === "parallel"
        ? shape.branches.flatMap((one) => one.nodes.map((target) => ({ target, label: one.id, kind: "parallel-branch" as const })))
        : [];
    for (const child of children) {
      const target = byId.get(String(child.target));
      if (target !== undefined) emit(target, depth + 1, { kind: child.kind, label: child.label });
    }
  };

  for (const node of workflow.nodes) {
    if (claimedBy.has(String(node.id))) continue;
    emit(node, 0);
  }
  // A node whose only claimant is downstream of it in declaration order would
  // otherwise be dropped. Emitting the remainder flat is the honest fallback:
  // a node missing from the rail is a graph the surface failed to show.
  for (const node of workflow.nodes) emit(node, 0, claimedBy.get(String(node.id)));
  return rows;
}

function RailEntry({
  row,
  selected,
  onSelect,
}: {
  row: RailRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const kind = NODE_KIND[row.node.shape.kind];
  const taskCount = row.node.tasks.length;
  return (
    <li style={{ paddingInlineStart: `calc(var(--ds-space-cozy) * ${String(row.depth)})` }}>
      {row.under !== undefined && (
        <span className={cn(dsText.micro, dsText.caps, "block pb-[var(--ds-space-hair)] text-[color:var(--ds-fg-faint)]")}>
          {row.under.kind === "branch-case" ? "case" : "branch"} {row.under.label}
        </span>
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-[var(--ds-space-tight)] border px-[var(--ds-space-base)] py-[var(--ds-space-tight)] text-left",
          "rounded-[var(--ds-radius-md)] ds-motion",
          dsFocus,
          selected
            ? "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-selected)]"
            : "border-transparent hover:bg-[var(--ds-surface-3)]",
        )}
      >
        <kind.Icon
          aria-hidden
          className={cn(
            dsIcon.md,
            "shrink-0",
            kind.loud ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg-muted)]",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn(dsText.ui, dsText.nums, "truncate font-medium text-[color:var(--ds-fg)]")}>
            {row.node.id}
          </span>
          <span className={cn(dsText.meta, "truncate text-[color:var(--ds-fg-muted)]")}>
            {kind.word}
            {taskCount > 0 && ` · ${String(taskCount)} contract${taskCount === 1 ? "" : "s"}`}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ── the record column ───────────────────────────────────────────────────── */

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)]">
      <span className={cn(dsText.meta, "w-[10rem] shrink-0 text-[color:var(--ds-fg-muted)]")}>{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function NodeShapeFacts({ node }: { node: ExplorerNodeWire }) {
  const shape = node.shape;
  switch (shape.kind) {
    case "task":
      return (
        <ChipRow>
          <Chip label="replay">{shape.replay}</Chip>
          <Chip label="condition" tone={shape.conditional ? "info" : "neutral"}>
            {shape.conditional ? "declares when()" : "always runs"}
          </Chip>
        </ChipRow>
      );
    case "transaction":
      return (
        <ChipRow>
          <Chip label="dry run" tone="info">{shape.dryRun}</Chip>
          <Chip label="probe">{shape.probePolicy}</Chip>
          <Chip label="probe→fence">{`${String(shape.probeToFenceMaxMs)}ms`}</Chip>
          <Chip label="lease">{shape.leaseScope}</Chip>
          <Chip label="retry before fence">{shape.retryBeforeFence ? "declared" : "none"}</Chip>
        </ChipRow>
      );
    case "branch":
      return (
        <div className="flex flex-col gap-[var(--ds-space-tight)]">
          {shape.cases.map((one) => (
            <FactRow key={one.name} label={`case ${one.name}`}>
              <ChipRow>
                {one.nodes.map((target) => <Chip key={String(target)}>{target}</Chip>)}
              </ChipRow>
            </FactRow>
          ))}
        </div>
      );
    case "parallel":
      return (
        <div className="flex flex-col gap-[var(--ds-space-tight)]">
          <FactRow label="join"><Chip>{shape.join}</Chip></FactRow>
          {shape.branches.map((one) => (
            <FactRow key={one.id} label={`branch ${one.id}`}>
              <ChipRow>
                {one.nodes.map((target) => <Chip key={String(target)}>{target}</Chip>)}
              </ChipRow>
            </FactRow>
          ))}
        </div>
      );
    case "child-run":
      return (
        <ChipRow>
          <Chip label="target">{shape.targetWorkflowId}</Chip>
          <Chip label="edge">{shape.edgeId}</Chip>
          <Chip label="cardinality">{shape.cardinality}</Chip>
          <Chip label="await">{shape.await}</Chip>
          <Chip label="join">{shape.join}</Chip>
          <Chip label="on child failed">{shape.onChildFailed}</Chip>
          <Chip label="cascade">{shape.cascadeCancel}</Chip>
          <Chip label="after retry">{shape.afterChildRetry}</Chip>
          <Chip label="visibility">{shape.visibility}</Chip>
        </ChipRow>
      );
    case "gate":
      return (
        <ChipRow>
          <Chip label="resolved by">{shape.resolvedBy}</Chip>
          {shape.statusKey !== undefined && <Chip label="status key">{shape.statusKey}</Chip>}
        </ChipRow>
      );
  }
}

function TaskRecord({ task }: { task: ExplorerTaskWire }) {
  return (
    <section
      aria-label={String(task.taskId)}
      className="flex flex-col gap-[var(--ds-space-base)] border-t border-[color:var(--ds-border-subtle)] pt-[var(--ds-space-base)]"
    >
      <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        <Badge tone={task.effect === "commit" ? "warning" : "neutral"}>{ARM_WORD[task.arm]}</Badge>
        <span className={cn(dsText.ui, dsText.nums, "font-medium text-[color:var(--ds-fg)]")}>
          {task.taskId}
        </span>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{task.title}</span>
      </div>

      <FactRow label="Implemented by">
        {task.binding.state === "bound" ? (
          <ChipRow>
            <Chip label="store">{task.binding.storeNamespace}</Chip>
            <Chip label="kind">{task.binding.storeKind}</Chip>
            {task.binding.driverSystem !== undefined && (
              <Chip label="driver">{task.binding.driverSystem}</Chip>
            )}
          </ChipRow>
        ) : (
          // A contract no store implements yet is a legitimate mid-program
          // state (D107) and it is stated, never hidden: a workflow that cannot
          // run must not read here as one that can.
          <Banner tone="warning" title="No implementation is bound yet">
            {task.binding.note}
          </Banner>
        )}
      </FactRow>

      <FactRow label="Subject binding">
        {task.subject.kind === "none" ? (
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
            {task.subject.reason ?? "none declared"}
          </span>
        ) : (
          <ChipRow>
            <Chip label="kind">{task.subject.kind}</Chip>
            <Chip label="from input">{task.subject.fromInput}</Chip>
            <Chip label="identity">{task.subject.identity}</Chip>
            <Chip label="observes" icon={<ScanEye aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
              {task.subject.observe}
            </Chip>
            <Chip label="match">{task.subject.match}</Chip>
            <Chip label="required at">{task.subject.requiredAt}</Chip>
          </ChipRow>
        )}
      </FactRow>

      {task.writeSafety !== undefined && (
        <FactRow label="Write safety">
          <ChipRow>
            <Chip label="completion" tone="warning">{task.writeSafety.completionKind}</Chip>
            {task.writeSafety.verifyTaskId !== undefined && (
              <Chip label="verifies with">{task.writeSafety.verifyTaskId}</Chip>
            )}
            <Chip label="probes with">{task.writeSafety.probeTaskId}</Chip>
            <Chip label="absence after fence" tone="warning">
              {task.writeSafety.recoveryAbsence.kind === "operator-only"
                ? "operator-only"
                : `stabilized · ${String(task.writeSafety.recoveryAbsence.minSinceFenceMs)}ms · `
                  + `${String(task.writeSafety.recoveryAbsence.consistentReads)} reads`}
            </Chip>
          </ChipRow>
        </FactRow>
      )}

      <FactRow label="Errors">
        <ChipRow>
          {task.errorCodes.map((code) => <Chip key={code}>{code}</Chip>)}
        </ChipRow>
      </FactRow>

      {(task.requires.length > 0 || task.providers.length > 0) && (
        <FactRow label="Requires">
          <ChipRow>
            {task.requires.map((secret) => (
              <Chip key={String(secret)} label="secret" tone="info">{secret}</Chip>
            ))}
            {task.providers.map((provider) => (
              <Chip key={String(provider)} label="provider" tone="info">{provider}</Chip>
            ))}
          </ChipRow>
        </FactRow>
      )}

      {task.freshness !== undefined && (
        <FactRow label="Freshness">
          <ChipRow>
            <Chip label="default">{String(task.freshness.defaultMaxAge)}</Chip>
            {task.freshness.byField.map((rule) => (
              <Chip key={String(rule.path)} label={rule.path}>{String(rule.maxAge)}</Chip>
            ))}
          </ChipRow>
        </FactRow>
      )}

      {task.provenance !== undefined && (
        <FactRow label="Provenance">
          <ChipRow>
            <Chip label="default">{task.provenance.default}</Chip>
            {task.provenance.byField.map((rule) => (
              <Chip key={String(rule.path)} label={rule.path}>{rule.source}</Chip>
            ))}
          </ChipRow>
        </FactRow>
      )}

      <FactRow label="UI vocabulary">
        {task.ui.length === 0 ? (
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
            No catalog entry names this contract — it reaches no browser page.
          </span>
        ) : (
          <ChipRow>
            {task.ui.map((link) => (
              <Chip key={link.catalogId} label={link.kind} title={`${link.label} — verified ${link.verifiedAt}`}>
                {link.catalogId}
              </Chip>
            ))}
          </ChipRow>
        )}
      </FactRow>

      <FactRow label="Scenarios">
        <ChipRow>
          {task.scenarios.map((scenario) => <Chip key={String(scenario)}>{scenario}</Chip>)}
        </ChipRow>
      </FactRow>

      <FactRow label="Source">
        <ChipRow>
          <SourceLink label="contract" link={task.contractSource} />
          <SourceLink label="impl" link={task.implSource} />
        </ChipRow>
      </FactRow>

      <MetaLine
        tone="faint"
        items={[
          `input ${String(task.inputSchemaHash).slice(0, 12)}`,
          `output ${String(task.outputSchemaHash).slice(0, 12)}`,
          ...(task.implFingerprint === undefined
            ? []
            : [`impl ${String(task.implFingerprint).slice(0, 12)}`]),
        ]}
      />
    </section>
  );
}

function NodeRecord({ node }: { node: ExplorerNodeWire }) {
  const kind = NODE_KIND[node.shape.kind];
  return (
    <div className="flex flex-col gap-[var(--ds-space-cozy)]">
      <div className="flex flex-col gap-[var(--ds-space-tight)]">
        <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
          <kind.Icon
            aria-hidden
            className={cn(
              dsIcon.lg,
              kind.loud ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg-muted)]",
            )}
          />
          <h3 className={cn(dsText.section, dsText.nums, "font-semibold text-[color:var(--ds-fg)]")}>
            {node.id}
          </h3>
          <Badge tone={kind.loud ? "warning" : "neutral"}>{kind.word}</Badge>
        </div>
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{node.label}</span>
      </div>

      <FactRow label="Depends on">
        {node.dependsOn.length === 0 ? (
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
            Nothing — this node may start immediately.
          </span>
        ) : (
          <ChipRow>
            {node.dependsOn.map((upstream) => (
              <Chip key={String(upstream)} icon={<GitBranch aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
                {upstream}
              </Chip>
            ))}
          </ChipRow>
        )}
      </FactRow>

      <NodeShapeFacts node={node} />

      {node.details.length > 0 && (
        <FactRow label="Detail projections">
          <ChipRow>
            {node.details.map((detail) => (
              <Chip key={detail.key} label={detail.label} title={`${detail.key} · ${detail.display}`}>
                {detail.fieldPath}
              </Chip>
            ))}
          </ChipRow>
        </FactRow>
      )}

      {node.editableFields.length > 0 && (
        <FactRow label="Operator-correctable">
          <ChipRow>
            {node.editableFields.map((field) => (
              <Chip key={String(field.fieldPath)} label={field.label} tone="info">
                {field.fieldPath}
              </Chip>
            ))}
          </ChipRow>
        </FactRow>
      )}

      {node.coveragePoints.length > 0 && (
        <FactRow label="Coverage points">
          <div className="flex flex-col gap-[var(--ds-space-hair)]">
            {node.coveragePoints.map((point) => (
              <span key={point.id} className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                <span className={cn(dsText.nums, "text-[color:var(--ds-fg-secondary)]")}>{point.id}</span>
                {` — ${point.detail}`}
              </span>
            ))}
          </div>
        </FactRow>
      )}

      {node.tasks.length === 0 ? (
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
          A control node owns no contract; it decides which nodes run.
        </span>
      ) : (
        node.tasks.map((task) => <TaskRecord key={`${task.arm}:${String(task.taskId)}`} task={task} />)
      )}
    </div>
  );
}

/* ── the identity strip ──────────────────────────────────────────────────── */

function WorkflowIdentity({ workflow }: { workflow: ExplorerWorkflowWire }) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-tight)]">
      <ChipRow>
        <Chip label="code">{workflow.code}</Chip>
        <Chip label="category">{workflow.category}</Chip>
        <Chip label="version">{String(workflow.version)}</Chip>
        <Chip label="shape">{workflow.surfaceShape}</Chip>
        <Chip label="enqueue">{workflow.enqueue}</Chip>
        <Chip label="subject">
          {workflow.inputSubject.state === "fixed" ? workflow.inputSubject.value : "derived from input"}
        </Chip>
        {workflow.systems.map((system) => (
          <Chip key={system} label="system" tone="info">{system}</Chip>
        ))}
      </ChipRow>
      <ChipRow>
        <Chip label="edit data">{workflow.capabilities.editData}</Chip>
        <Chip label="review">{workflow.capabilities.review ? "yes" : "no"}</Chip>
        <Chip label="run surface">
          {workflow.surfaces.inputRun.state === "declared"
            ? `declared${workflow.surfaces.inputRun.supportsDryRun ? " · dry run" : ""}`
            : "none"}
        </Chip>
        <Chip
          label="intake"
          title={workflow.surfaces.intake.state === "absent" ? workflow.surfaces.intake.reason : undefined}
        >
          {workflow.surfaces.intake.state === "declared"
            ? `${String(workflow.surfaces.intake.targetCount)} bindable fields`
            : "none"}
        </Chip>
        <Chip
          label="capture"
          title={
            workflow.surfaces.captureIntake.state === "absent"
              ? workflow.surfaces.captureIntake.reason
              : undefined
          }
        >
          {workflow.surfaces.captureIntake.state === "declared" ? "declared" : "none"}
        </Chip>
      </ChipRow>
      <ChipRow>
        <SourceLink label="descriptor" link={workflow.sources.descriptor} />
        <SourceLink label="module" link={workflow.sources.module} />
      </ChipRow>
      <MetaLine
        items={[
          `contract ${String(workflow.contractFingerprint).slice(0, 12)}`,
          `result ${String(workflow.resultSchemaHash).slice(0, 12)}`,
          `${String(workflow.sources.closureFileCount)} files fingerprinted`,
          `${String(workflow.scenarios.length)} scenarios`,
        ]}
      />
    </div>
  );
}

function WorkflowScenarios({ workflow }: { workflow: ExplorerWorkflowWire }) {
  return (
    <section aria-label="Scenarios" className="flex flex-col gap-[var(--ds-space-tight)]">
      <SectionLabel>Scenarios</SectionLabel>
      {workflow.scenarios.map((scenario) => (
        <div
          key={String(scenario.scenarioId)}
          className="flex flex-wrap items-baseline gap-x-[var(--ds-space-base)]"
        >
          <span className={cn(dsText.body, dsText.nums, "text-[color:var(--ds-fg)]")}>
            {scenario.scenarioId}
          </span>
          <SourceLink label="walks" link={scenario.source} />
        </div>
      ))}
    </section>
  );
}

/* ── the surface ─────────────────────────────────────────────────────────── */

export function WorkflowExplorer({
  workflowId,
  onWorkflow,
  onClose,
}: {
  workflowId: string;
  onWorkflow: (next: string) => void;
  onClose: () => void;
}) {
  const client = useDashboardClient();
  const enter = useDsEnterTransition();
  const [resource, setResource] = useState<AsyncResource<WorkflowExplorerWire>>(LOADING);
  const [openNodeId, setOpenNodeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setResource(LOADING);
    client.workflowExplorer().then(
      (value) => {
        if (live) setResource(loaded(value));
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          setResource(failed(error));
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  const wire = resource.state === "loaded" ? resource.value : undefined;
  const workflow = wire?.workflows.find((candidate) => String(candidate.id) === workflowId);
  const rows = useMemo(() => (workflow === undefined ? [] : railRows(workflow)), [workflow]);
  // The URL names the workflow, never the node, so the open node resets with
  // it; falling back to the first row keeps the record column from opening
  // empty on a surface whose whole job is to show something.
  const openNode = workflow?.nodes.find((node) => String(node.id) === openNodeId)
    ?? rows[0]?.node;

  useEffect(() => setOpenNodeId(undefined), [workflowId]);

  return (
    <Panel
      {...enter}
      aria-label="Workflow explorer"
      className={cn(
        "flex-1 data-[demo-enter=from]:translate-y-[var(--ds-travel-md)] data-[demo-enter=from]:opacity-0",
        "ds-motion-enter",
      )}
    >
      <PanelHeader
        title="Workflow explorer"
        subtitle={
          workflow === undefined
            ? "The as-built graph, read from the registered descriptors"
            : `${workflow.label} — the as-built graph, read from the registered descriptor`
        }
        icon={<GitBranch aria-hidden className={dsIcon.lg} />}
        meta={<span>Read-only</span>}
        actions={<IconButton size="sm" label="Close the explorer" icon={<X aria-hidden className={dsIcon.md} />} onClick={onClose} />}
      />

      {wire !== undefined && wire.workflows.length > 1 && (
        <div
          role="group"
          aria-label="Registered workflows"
          className="flex shrink-0 flex-wrap items-center gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)]"
        >
          {wire.workflows.map((candidate) => (
            <Chip
              key={String(candidate.id)}
              selected={String(candidate.id) === workflowId}
              onSelect={() => onWorkflow(String(candidate.id))}
            >
              {candidate.id}
            </Chip>
          ))}
        </div>
      )}

      <PanelBody className="p-[var(--ds-space-cozy)]">
        {resource.state === "loading" && (
          <div className="flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]">
            <Spinner label="Loading the explorer projection" />
            <span className={dsText.body}>Reading the registry…</span>
          </div>
        )}

        {resource.state === "failed" && (
          <Banner tone="danger" title="The explorer projection could not be read">
            {resource.error.message}
          </Banner>
        )}

        {wire !== undefined && workflow === undefined && (
          <EmptyState
            icon={<GitBranch aria-hidden className={dsIcon.lg} />}
            title={`No workflow is registered as "${workflowId}"`}
            description={
              wire.workflows.length === 0
                ? "The server serves an empty registry, so there is no graph to explore."
                : `Registered today: ${wire.workflows.map((one) => String(one.id)).join(", ")}.`
            }
            action={
              wire.workflows[0] === undefined
                ? undefined
                : (
                  <Button size="sm" onClick={() => onWorkflow(String(wire.workflows[0]?.id ?? ""))}>
                    Open {String(wire.workflows[0].id)}
                  </Button>
                )
            }
          />
        )}

        {workflow !== undefined && (
          <div className="flex flex-col gap-[var(--ds-space-cozy)]">
            <WorkflowIdentity workflow={workflow} />

            <div className="@container/graph flex flex-col gap-[var(--ds-space-cozy)] @3xl/graph:flex-row">
              <nav
                aria-label="Graph structure"
                className="shrink-0 @3xl/graph:w-[var(--ds-w-context-rail)]"
              >
                <SectionLabel className="pb-[var(--ds-space-tight)]">
                  Graph · {String(workflow.nodes.length)} node{workflow.nodes.length === 1 ? "" : "s"}
                </SectionLabel>
                <ol className="flex flex-col gap-[var(--ds-space-hair)]">
                  {rows.map((row) => (
                    <RailEntry
                      key={String(row.node.id)}
                      row={row}
                      selected={openNode !== undefined && String(row.node.id) === String(openNode.id)}
                      onSelect={() => setOpenNodeId(String(row.node.id))}
                    />
                  ))}
                </ol>
                <div className="pt-[var(--ds-space-base)]">
                  <SectionLabel className="pb-[var(--ds-space-tight)]">Result</SectionLabel>
                  <ChipRow>
                    {workflow.resultDependsOn.map((nodeId) => (
                      <Chip key={String(nodeId)} icon={<Repeat aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
                        {nodeId}
                      </Chip>
                    ))}
                  </ChipRow>
                </div>
              </nav>

              <div className="min-w-0 flex-1">
                {openNode === undefined ? (
                  <EmptyState title="This workflow declares no nodes" />
                ) : (
                  <NodeRecord node={openNode} />
                )}
              </div>
            </div>

            <WorkflowScenarios workflow={workflow} />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
