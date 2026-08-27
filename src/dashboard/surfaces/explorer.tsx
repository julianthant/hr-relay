/**
 * The read-only Workflow Explorer (ref operator-trust §5.2 Phase A, §5.7 D176; ref dashboard-surfaces §13).
 *
 * ## PROVENANCE
 *
 * Ported from the operator's rebuild demo — legacy `hr-automation`
 * @1bffbd658db34ce84a08e69484db3a40b3658d6e,
 * `src/dashboard/components/dev/rebuild-demo/DemoExplorer.tsx` (with
 * `demo-explorer-wire.ts` for `dryRunPosture`, `contractTotals` and `NODE_KIND_LABEL` —
 * `explorer-model.ts` exports none of `laneOf`'s connector rule or `skippedAboveBoundary`; no lane
 * concept exists here (`Connector` draws between every consecutive pair, ledger 3 EX181) and no
 * per-node dry-run-skip mark is drawn (ledger 3 EX77/EX180; `docs/findings/explorer.md`)).
 * Copied with provenance and adapted to THIS repository's served wire; nothing
 * here reaches the legacy repository at runtime and nothing may (D93/D94).
 *
 * ## The three panels, and why they are those three
 *
 * The demo's answer, kept: **what you are looking at · its shape · one part of
 * that shape in detail.** A registry column on the left, grouped by each
 * descriptor's own `category` through the SAME projection the workflow rail
 * reads (`groupWorkflowsByCategory`) so the explorer cannot bin a workflow
 * under a heading the product does not use; the graph in the middle, in
 * declaration order with the conditional edges drawn BETWEEN the rows they
 * decide; and the selected node's whole binding on the right, because the
 * question being answered is a lookup and a lookup that hides half its answer
 * behind a second click is a worse index than the source tree.
 *
 * ## What the demo shows that this wire cannot serve — stated, never faked
 *
 * The demo lays a RUN over the graph (a run picker, per-node timings, attempts,
 * recorded values, provenance marks). That overlay is ref operator-trust §5.7's first named
 * exclusion — the run-detail timeline already serves those facts per run — so
 * it is absent here rather than approximated, and the toolbar band it occupied
 * carries the workflow's identity instead. The demo's node panel is a
 * FIELD-level contract table (`Wage · ucpath · $18.50/hr`); this one is too
 * (D227), over a census derived from each contract's own zod shape — with the
 * third column carrying how the field is RECORDED rather than what one run
 * recorded, because no run is laid over this graph.
 *
 * ## What is NOT here, and why that is honest
 *
 * There is no control on this surface that sends anything to the server: the
 * client interface it uses has no mutating method and the wire has nowhere to
 * put one. Phase B — the editor — is DEFERRED out of Phase 2 by D186, so an
 * edit affordance would be a control with no protocol behind it.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Eye,
  FileCode2,
  Info,
  Lock,
  Pencil,
  ScanEye,
  ShieldAlert,
  SquareArrowOutUpRight,
  Workflow,
} from "lucide-react";
import type {
  ExplorerContractFieldWire,
  ExplorerNodeWire,
  ExplorerProseWire,
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
  EmptyState,
  IconButton,
  MetaLine,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  PanelToolbar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionLabel,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  dsClip,
  dsFocus,
  dsIcon,
  dsMotion,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { DashboardClientError } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";
import {
  groupWorkflowsByCategory,
  workflowHarnessOfName,
  type WorkflowGroupEntry,
  type WorkflowGroupingFacts,
} from "./workflow-category.js";
import { describeNodeCondition } from "../../domain/workflow/node-condition.js";
import { plural } from "./format.js";
import {
  type DryRunPosture,
  conditionalEdgesFrom,
  correctableMarkFor,
  correctableMarks,
  dependsOnEdgeExists,
  dryRunBoundaryNodeId,
  dryRunPosture,
  explorerGraphTotals,
  fieldShapeLine,
  fmtFreshness,
  nodeBindings,
  nodeLabelBeside,
  taskSystemLabel,
  unplaceableEditableFields,
  writeSystems,
} from "./explorer-model.js";

/* ── the node vocabulary ─────────────────────────────────────────────────── */

/**
 * A node kind's word and how loudly it is drawn.
 *
 * The demo's `NODE_KIND_LABEL`/`KIND_TONE` pair over THIS tree's closed kind
 * union. Only `transaction` is tinted, and it is the one shape on this surface
 * that can change a real HR system — the demo tints its `write` the same way
 * and for the same reason. The word travels beside the tint in every case, so
 * colour is never the only encoding.
 */
const NODE_KIND: Record<
  ExplorerNodeWire["shape"]["kind"],
  { readonly word: string; readonly tone: "neutral" | "info" | "warning" | "danger" }
> = {
  task: { word: "Task", tone: "neutral" },
  transaction: { word: "Transaction", tone: "danger" },
  branch: { word: "Branch", tone: "neutral" },
  parallel: { word: "Parallel", tone: "neutral" },
  "child-run": { word: "Delegation", tone: "info" },
  gate: { word: "Gate", tone: "warning" },
};

/** what each task arm DOES, in the demo's verb form */
const ARM_WORD = { task: "runs", prepare: "prepares", commit: "commits" } as const;

/** the read / write ink, from the demo's `DIR_INK` */
const DIR_INK = {
  read: "text-[color:var(--ds-read-fg)]",
  write: "text-[color:var(--ds-write-fg)]",
} as const;

/* ── small parts ─────────────────────────────────────────────────────────── */

/**
 * A wrapping row of chips, packed rather than tracked.
 *
 * The DS's `ChipRow` lays chips on an equal-width GRID so a wrapped set ends on
 * one edge instead of leaving an orphan — which is exactly right in the queue's
 * ~400px column, where it was designed. This surface is the other case: short
 * facts (`code pl`, `version 1`) where `auto-fit` cuts tracks wide enough that
 * the set stops reading as a set. So the facts pack, and the ragged right edge
 * is the deliberate cost — the DS's own note already says a row that is not a
 * track of peers "is a flex row, and the chip is one item in it".
 */
function FactChips({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
      {children}
    </div>
  );
}

function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)]">
      <span className={cn(dsText.meta, "w-[9rem] shrink-0 text-[color:var(--ds-fg-muted)]")}>{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

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

/* =========================================================================
 * PANEL ONE — the registry
 * ====================================================================== */

/** the explorer's list view-model: the served wire plus the facts the ONE rule reads */
interface ExplorerListEntry extends WorkflowGroupingFacts {
  readonly workflow: ExplorerWorkflowWire;
}

/**
 * Every workflow the registry serves, grouped by its OWN category and with each
 * chunk harness nested under its composition.
 *
 * The grouping is `groupWorkflowsByCategory`, the same projection the workflow
 * rail and the Run Modal's picker read, so the explorer cannot bin a workflow
 * under a heading the product does not use, and cannot show as a peer workflow
 * something those surfaces show as a step (D219). The demo's two-character codes are deliberately absent from the
 * row: they are the trace id's first component and they mean something there,
 * but in a list whose every row already carries the full unambiguous label they
 * are a column of noise in the narrowest panel on the page. (They stay one
 * click away, on the identity band.)
 */
function WorkflowListPanel({
  workflows,
  selected,
  onSelect,
}: {
  workflows: readonly ExplorerWorkflowWire[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const groups = useMemo(
    () =>
      groupWorkflowsByCategory(
        workflows.map((workflow) => ({
          workflow,
          id: String(workflow.id),
          label: workflow.label,
          categoryId: workflow.category,
          role: workflow.role,
        })),
      ),
    [workflows],
  );

  /**
   * ONE row. The Explorer is the registry-INSPECTION surface and its panel has
   * room for a sentence, so a harness states what it is a harness OF in
   * secondary text rather than in a token — the same fact the rail affixes,
   * at the density this surface affords. It sits inside the button, so the
   * relationship is part of the row's accessible name too.
   */
  const row = (node: WorkflowGroupEntry<ExplorerListEntry>): ReactElement => {
    const workflow = node.entry.workflow;
    const id = String(workflow.id);
    const active = id === selected;
    return (
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(id)}
        title={`${workflow.label} v${String(workflow.version)} — ${plural(workflow.nodes.length, "node")}`}
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-[var(--ds-space-snug)]",
          "px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)] text-left",
          dsText.ui,
          dsFocus,
          dsMotion.base,
          active
            ? "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]"
            : "text-[color:var(--ds-fg-secondary)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("min-w-0", dsClip.text)}>{workflow.label}</span>
          {node.harness !== undefined && (
            <span className={cn(dsText.micro, "min-w-0 font-normal text-[color:var(--ds-fg-muted)]", dsClip.text)}>
              {`a proving harness of ${workflowHarnessOfName(node.harness)}`}
            </span>
          )}
        </span>
        <span className={cn(dsText.micro, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
          {workflow.nodes.length}
        </span>
      </button>
    );
  };

  return (
    <Panel className="min-h-0" aria-label="Registered workflows">
      <PanelHeader title="Workflows" meta={String(workflows.length)} />
      <PanelBody>
        {groups.map((group) => (
          <div key={group.label} className="border-b border-[color:var(--ds-border-subtle)] last:border-b-0">
            <SectionLabel className="block px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]">
              {group.label}
            </SectionLabel>
            <ul>
              {group.entries.map((node) => (
                <li key={String(node.entry.id)}>
                  {row(node)}
                  {/* The registry's own hierarchy, as a real nested list: this
                      is the surface an operator inspects the registration on,
                      so a step that looked like a peer here would contradict
                      every other listing surface (D219). */}
                  {node.members.length > 0 && (
                    <ul
                      aria-label={`Proving harnesses of ${node.entry.label}`}
                      className="pl-[var(--ds-space-cozy)]"
                    >
                      {node.members.map((member) => (
                        <li key={String(member.entry.id)}>{row(member)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}

/* =========================================================================
 * PANEL TWO — the graph
 * ====================================================================== */

/**
 * The identity band, in the slot the demo gives the run picker.
 *
 * The run overlay is §5.7's named exclusion, so the toolbar row under the graph
 * header would otherwise be an empty bar. What goes there instead is the
 * workflow's IDENTITY — the half of §5.2 no other region carries — kept to the
 * demo's ONE toolbar row so the node list below it starts at the height it
 * starts at in the demo. The rest of the registration (capabilities, declared
 * surfaces, source links, fingerprints) is a click away in the graph's ⓘ, which
 * is the region this design already gives to "what is this graph".
 */
function WorkflowIdentityBand({ workflow }: { workflow: ExplorerWorkflowWire }) {
  return (
    <PanelToolbar
      label={`${workflow.label} identity`}
      /*
        WRAPS rather than scrolls, and every chip is `shrink-0`. The toolbar's
        own default is a scrolling row, which cost this band two defects at
        once: a chip free to shrink hits `dsClip.token` first — the first draft
        clipped `version 1` down to the word `version`, a fact rendered as its
        own label — and the chips past the right edge sat behind a scrollbar
        nobody would look for on a band of standing facts.
      */
      className="flex-wrap gap-y-[var(--ds-space-tight)] py-[var(--ds-space-snug)]"
    >
      <Chip className="shrink-0" label="code">{workflow.code}</Chip>
      <Chip className="shrink-0" label="category">{workflow.category}</Chip>
      <Chip className="shrink-0" label="version">{String(workflow.version)}</Chip>
      <Chip className="shrink-0" label="shape">{workflow.surfaceShape}</Chip>
      <Chip className="shrink-0" label="enqueue">{workflow.enqueue}</Chip>
      <Chip className="shrink-0" label="subject">
        {workflow.inputSubject.state === "fixed" ? workflow.inputSubject.value : "derived from input"}
      </Chip>
      {workflow.systems.map((system) => (
        <Chip className="shrink-0" key={system} label="system" tone="info">{system}</Chip>
      ))}
    </PanelToolbar>
  );
}

/** the registration half of §5.2, inside the graph's ⓘ */
function WorkflowRegistration({ workflow }: { workflow: ExplorerWorkflowWire }) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-tight)]">
      <SectionLabel>Registered as</SectionLabel>
      <FactChips>
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
      </FactChips>
      <FactChips>
        <SourceLink label="descriptor" link={workflow.sources.descriptor} />
        <SourceLink label="module" link={workflow.sources.module} />
      </FactChips>
      <MetaLine
        tone="faint"
        items={[
          `contract ${String(workflow.contractFingerprint).slice(0, 12)}`,
          `result ${String(workflow.resultSchemaHash).slice(0, 12)}`,
          `${String(workflow.sources.closureFileCount)} files fingerprinted`,
          `result from ${workflow.resultDependsOn.map((nodeId) => String(nodeId)).join(", ")}`,
        ]}
      />
    </div>
  );
}

function DryRunBoundary() {
  return (
    <div className="my-[var(--ds-space-snug)] flex items-center gap-[var(--ds-space-snug)]">
      <span aria-hidden className="h-px flex-1 border-t border-dashed border-[color:var(--ds-danger-border)]" />
      <span className={cn(dsText.caps, "flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-danger)]")}>
        <ShieldAlert aria-hidden className={dsIcon.sm} />
        a dry run stops here
      </span>
      <span aria-hidden className="h-px flex-1 border-t border-dashed border-[color:var(--ds-danger-border)]" />
    </div>
  );
}

function Connector({
  conditions,
  linked,
}: {
  conditions: readonly Readonly<{ to: string; condition: string }>[];
  /** the next row declares a `depends-on` edge back to this one */
  linked: boolean;
}) {
  return (
    <div className="ml-[18px] flex flex-col gap-[var(--ds-space-hair)] border-l border-[color:var(--ds-border-strong)] py-[var(--ds-space-tight)] pl-[var(--ds-space-cozy)]">
      {conditions.map((edge) => (
        <span key={`${edge.to}-${edge.condition}`} className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
          → {edge.to}: <span className="text-[color:var(--ds-fg-faint)]">{edge.condition}</span>
        </span>
      ))}
      {conditions.length === 0 && (
        <span
          className={cn(dsText.micro, "text-[color:var(--ds-fg-faint)]")}
          title={
            linked
              ? "the next node declares this one in its dependsOn"
              : "declaration order put these next to each other; neither waits for the other"
          }
        >
          {linked ? "always" : "no edge between them"}
        </span>
      )}
    </div>
  );
}

function GraphNodeRow({
  node,
  delegatesToLabel,
  selected,
  onSelect,
}: {
  node: ExplorerNodeWire;
  delegatesToLabel?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const kind = NODE_KIND[node.shape.kind];
  const bindings = nodeBindings(node);
  const contracts = node.tasks.length;
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-[var(--ds-space-base)] border text-left",
        "rounded-[var(--ds-radius-md)] p-[var(--ds-space-base)]",
        dsFocus,
        dsMotion.base,
        "active:translate-y-px",
        selected
          ? "border-[color:var(--ds-border-loud)] bg-[var(--ds-surface-selected)]"
          : "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] hover:bg-[var(--ds-surface-2)]",
      )}
    >
      {/*
        The demo's run dot, with no run over the graph: the descriptor-only
        state it already draws. It is a rhythm mark, not a status — nothing on
        this surface knows whether a node ever ran.
      */}
      <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-[var(--ds-border-strong)]" />
      <span className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]">
        <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
          {/*
            EX66 — ref operator-trust §5.2.1 item 1 (D275 item 5). The demo
            prints ONE name because its node ids are prose. Here the id is the
            stable identifier a failure resolves to and the label is the
            operator's word for it, so both travel — the id first and loud,
            because that is the half somebody arrives holding.
          */}
          <span className={cn(dsText.ui, dsText.nums, "font-semibold text-[color:var(--ds-fg)]")}>
            {node.id}
          </span>
          {nodeLabelBeside(node) !== undefined && (
            <span className={cn(dsText.meta, dsClip.text, "min-w-0 text-[color:var(--ds-fg-muted)]")}>
              {nodeLabelBeside(node)}
            </span>
          )}
          <Badge tone={kind.tone}>{kind.word}</Badge>
          {bindings.map((binding) => (
            <Chip key={`${binding.label}-${binding.value}`} label={binding.label}>{binding.value}</Chip>
          ))}
          {delegatesToLabel !== undefined && (
            <Chip tone="info" label="to">{delegatesToLabel}</Chip>
          )}
          {node.shape.kind === "transaction" && node.shape.dryRun === "unsupported" && (
            <Chip tone="danger">a dry run does not stop this</Chip>
          )}
        </span>
        {node.shape.kind === "task" && node.shape.condition !== undefined && (
          <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
            {describeNodeCondition(node.shape.condition)}
          </span>
        )}
        {/*
          EX87/EX88 — ref operator-trust §5.2.1 items 2 and 3 (D275 item 5).
          The count is §5.9's own census printed where the node is CHOSEN, and
          `always-rerun` is the one replay value that has to be legible before
          the retry rather than after it.
        */}
        <span className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
          {contracts > 0 && (
            <span className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
              {plural(contracts, "contract")}
            </span>
          )}
          {node.shape.kind === "task" && node.shape.replay === "always-rerun" && (
            <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>re-runs on every attempt</span>
          )}
          {node.shape.kind === "gate" && (
            <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
              resolved by {node.shape.resolvedBy}
            </span>
          )}
          {node.editableFields.length > 0 && (
            <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
              {plural(node.editableFields.length, "correctable field")}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function GraphPanel({
  wire,
  workflow,
  selectedNodeId,
  onSelectNode,
}: {
  wire: WorkflowExplorerWire;
  workflow: ExplorerWorkflowWire;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}) {
  const posture = dryRunPosture(workflow);
  const totals = explorerGraphTotals(workflow);
  const boundaryNodeId = dryRunBoundaryNodeId(workflow);
  const labelOf = (targetId: string): string | undefined =>
    wire.workflows.find((candidate) => String(candidate.id) === targetId)?.label;

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title={`${workflow.label} v${String(workflow.version)}`}
        meta={[
          plural(totals.nodes, "node"),
          plural(totals.reads, "read"),
          totals.writes > 0 ? plural(totals.writes, "write") : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(" · ")}
        actions={<GraphInfo workflow={workflow} posture={posture} totals={totals} />}
      />

      <WorkflowIdentityBand workflow={workflow} />

      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        {/* A HAZARD, not teaching: this workflow changes a system of record and
            has no rehearsal, so there is no safe way to try it. */}
        {posture === "no-rehearsal" && (
          <Banner
            tone="warning"
            title={`${workflow.label} writes to ${writeSystems(workflow).join(", ")} and honours no dry run — there is no rehearsal of this workflow.`}
          />
        )}

        {/* A FACT about this graph. The absence of a boundary line has to be
            readable as an answer rather than as a rendering that did not
            happen. */}
        {posture === "no-system-write" && (
          <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
            <Chip label="changes">no system of record</Chip>
            <Chip label="dry run">nothing to stop short of</Chip>
          </div>
        )}

        <ol className="flex flex-col">
          {workflow.nodes.map((node, index) => {
            const id = String(node.id);
            const shape = node.shape;
            return (
              <li key={id} className="flex flex-col">
                {boundaryNodeId === id && <DryRunBoundary />}
                <GraphNodeRow
                  node={node}
                  delegatesToLabel={
                    shape.kind === "child-run" ? labelOf(String(shape.targetWorkflowId)) : undefined
                  }
                  selected={id === selectedNodeId}
                  onSelect={() => onSelectNode(id)}
                />
                {index < workflow.nodes.length - 1 && (
                  <Connector
                    conditions={conditionalEdgesFrom(workflow, id)}
                    linked={dependsOnEdgeExists(workflow, id, String(workflow.nodes[index + 1]?.id ?? ""))}
                  />
                )}
              </li>
            );
          })}
        </ol>

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
      </PanelBody>
    </Panel>
  );
}

/* =========================================================================
 * PANEL THREE — the node's contract
 * ====================================================================== */

/** the read / write band inside the contract table — the direction axis, once */
function DirHeaderRow({ dir }: { dir: "read" | "write" }) {
  const Icon = dir === "read" ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <TR className="h-auto">
      <TD colSpan={3} className="bg-[var(--ds-surface-2)] py-[var(--ds-space-tight)]">
        <span className={cn(dsText.caps, "flex items-center gap-[var(--ds-space-tight)]", DIR_INK[dir])}>
          <Icon aria-hidden className={dsIcon.sm} />
          {dir === "read" ? "Reads" : "Writes"}
        </span>
      </TD>
    </TR>
  );
}

/**
 * One task ARM, as a sub-band naming the contract every field row beneath it
 * belongs to.
 *
 * The demo bands only by direction, because its rows are fields of ONE run's
 * node. Here a node owns one or two whole contracts, and a field row that did
 * not say which contract it came from would be unresolvable back to a source
 * file — which is the surface's entire job. So the arm keeps its id, its verb,
 * and the policy chips that are facts about the WHOLE contract rather than
 * about any one field.
 */
function ContractArmBand({ task }: { task: ExplorerTaskWire }) {
  const bound = task.binding.state === "bound";
  return (
    <TR className="h-auto align-top">
      <TD colSpan={3} className="py-[var(--ds-space-snug)]">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)]">
          <span className={cn(dsText.meta, dsText.nums, "font-semibold text-[color:var(--ds-fg)]")}>
            {task.taskId}
          </span>
          <span className={cn(dsText.micro, "text-[color:var(--ds-fg-faint)]")}>
            {ARM_WORD[task.arm]} · {task.title}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
            {!bound && <Chip tone="warning">no implementation</Chip>}
            {task.freshness !== undefined && (
              <Chip label="fresh" title={`${String(task.freshness.defaultMaxAge)} ms`}>
                {fmtFreshness(task.freshness.defaultMaxAge)}
              </Chip>
            )}
            {task.provenance !== undefined && <Chip label="from">{task.provenance.default}</Chip>}
            {task.writeSafety !== undefined && (
              <Chip tone="warning" label="proof">{task.writeSafety.completionKind}</Chip>
            )}
            {task.checkpoint !== undefined && <Chip label="checkpoint">{task.checkpoint}</Chip>}
            {task.artifacts !== undefined && <Chip label="artifacts">{task.artifacts}</Chip>}
          </span>
        </span>
      </TD>
    </TR>
  );
}

/**
 * The `Recorded` cell — how THIS field gets recorded, never what a run recorded.
 *
 * No run is laid over this graph (§5.7's first exclusion), so a recorded VALUE
 * is not a fact this surface holds. What the descriptor does declare is the
 * field's provenance and its freshness bound, and each remaining arm states the
 * genuine reason a field has no observation behind it. `unknown` is drawn as a
 * warning on purpose: a read whose provenance nothing declares is a gap in the
 * contract, not a quiet default.
 */
function FieldRecorded({ recorded }: { recorded: ExplorerContractFieldWire["recorded"] }) {
  switch (recorded.state) {
    case "observed":
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
          <Chip label="from">{recorded.source}</Chip>
          <Chip label="fresh" title={`${String(recorded.maxAge)} ms`}>{fmtFreshness(recorded.maxAge)}</Chip>
          {recorded.override !== undefined && <Chip label="override">{recorded.override}</Chip>}
        </span>
      );
    case "checkpointed":
      return <Chip label="stored" title={recorded.reason}>transaction checkpoint</Chip>;
    case "unknown":
      return <Chip tone="warning" title={recorded.reason}>unknown</Chip>;
    case "bound":
    case "not-recorded":
      return (
        <span className={cn(dsText.micro, "text-[color:var(--ds-fg-faint)]")} title={recorded.reason}>
          {recorded.state === "bound" ? "bound by the graph" : "not recorded"}
        </span>
      );
  }
}

/**
 * One FIELD of a contract — the demo's row, over this tree's own census.
 *
 * The census is derived from the contract's zod shape by `contractSchemaLeaves`,
 * which walks the SAME schema object the arm's `inputSchemaHash` /
 * `outputSchemaHash` fingerprint. There is no authored field list anywhere
 * behind this row.
 */
function ContractFieldRow({
  field,
  system,
  correctableAs,
}: {
  field: ExplorerContractFieldWire;
  system: string;
  /**
   * The Edit Data label this path is allowlisted under, or `undefined` for a
   * field the descriptor does not let anyone correct.
   *
   * D275 item 6 (ledger 3 EX114): the pencil sits IN the field's own cell,
   * because editability is a property of a FIELD and a mark that lives in a
   * chip row below the table is an action separated from the value it is about.
   * The rejected arms were exactly that separation (B) and restating the
   * deferred edit posture instead of drawing the fact (C).
   */
  correctableAs?: string;
}) {
  return (
    <TR className="h-auto align-top">
      <TD className="py-[var(--ds-space-hair)] pl-[var(--ds-space-base)]">
        <span className={cn(dsText.meta, dsText.nums, dsClip.text, "block text-[color:var(--ds-fg)]")}>
          {correctableAs !== undefined && (
            /*
              `role="img"` is load-bearing: HTML-AAM computes no accessible name
              for a bare <svg>, so `aria-label` on one names nothing and the mark
              this whole ruling is about would reach no screen reader (the
              generic-element lesson, `src/dashboard/CLAUDE.md`).
            */
            <Pencil
              role="img"
              aria-label={`correctable at a checkpoint as ${correctableAs}`}
              className={cn(dsIcon.sm, "mr-[var(--ds-space-tight)] inline shrink-0 align-[-0.15em] text-[color:var(--ds-info-fg)]")}
            />
          )}
          {field.path}
        </span>
        <span
          className={cn(dsText.micro, "block text-[color:var(--ds-fg-faint)]")}
          title={field.options === undefined ? undefined : field.options.join(" · ")}
        >
          {fieldShapeLine(field)}
        </span>
      </TD>
      <TD className="py-[var(--ds-space-hair)]">
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{system}</span>
      </TD>
      <TD className="py-[var(--ds-space-hair)]">
        <FieldRecorded recorded={field.recorded} />
      </TD>
    </TR>
  );
}

/** An arm's sub-band followed by every field its contract owns, in order. */
function ContractArmRows({
  task,
  correctable,
}: {
  task: ExplorerTaskWire;
  /** `side path` → the Edit Data label it is allowlisted under (D275 item 6). */
  correctable: ReadonlyMap<string, string>;
}) {
  const system = taskSystemLabel(task);
  return (
    <>
      <ContractArmBand task={task} />
      {task.fields.map((field) => (
        <ContractFieldRow
          key={`${field.side}:${String(field.path)}`}
          field={field}
          system={system}
          correctableAs={correctableMarkFor(correctable, field)}
        />
      ))}
    </>
  );
}

/**
 * Everything about ONE task arm that the contract row could not hold.
 *
 * §5.2 wants each task's input/output/error/effect/freshness/provenance/
 * scenarios, its UI elements and page states, and a transaction's subject
 * binding, probe, fence and proof. The demo folds its (much smaller) equivalent
 * into a ⓘ; here the record IS the answer an operator or a code-changing AI
 * came for, so it stays on the page and the ⓘ keeps only what has to be taught.
 */
function TaskRecord({ task }: { task: ExplorerTaskWire }) {
  return (
    <section
      aria-label={String(task.taskId)}
      className="flex flex-col gap-[var(--ds-space-base)] border-t border-[color:var(--ds-border-subtle)] pt-[var(--ds-space-base)]"
    >
      <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        <Badge tone={task.effect === "commit" ? "danger" : "neutral"}>{ARM_WORD[task.arm]}</Badge>
        <span className={cn(dsText.ui, dsText.nums, "font-medium text-[color:var(--ds-fg)]")}>
          {task.taskId}
        </span>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{task.title}</span>
      </div>

      <FactRow label="Implemented by">
        {task.binding.state === "bound" ? (
          <FactChips>
            <Chip label="store">{task.binding.storeNamespace}</Chip>
            <Chip label="kind">{task.binding.storeKind}</Chip>
            {task.binding.driverSystem !== undefined && (
              <Chip label="driver">{task.binding.driverSystem}</Chip>
            )}
          </FactChips>
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
          <FactChips>
            <Chip label="kind">{task.subject.kind}</Chip>
            <Chip label="from input">{task.subject.fromInput}</Chip>
            <Chip label="identity">{task.subject.identity}</Chip>
            <Chip label="observes" icon={<ScanEye aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
              {task.subject.observe}
            </Chip>
            <Chip label="match">{task.subject.match}</Chip>
            <Chip label="required at">{task.subject.requiredAt}</Chip>
          </FactChips>
        )}
      </FactRow>

      {task.writeSafety !== undefined && (
        <FactRow label="Write safety">
          <FactChips>
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
            {task.writeSafety.unverifiableByPage !== undefined && (
              <Chip
                label="unverifiable by page"
                tone="danger"
                title={task.writeSafety.unverifiableByPage.reason}
              >
                {task.writeSafety.unverifiableByPage.policy}
              </Chip>
            )}
          </FactChips>
        </FactRow>
      )}

      <FactRow label="Errors">
        <FactChips>
          {task.errorCodes.map((code) => <Chip key={code}>{code}</Chip>)}
        </FactChips>
      </FactRow>

      {(task.requires.length > 0 || task.providers.length > 0) && (
        <FactRow label="Requires">
          <FactChips>
            {task.requires.map((secret) => (
              <Chip key={String(secret)} label="secret" tone="info">{secret}</Chip>
            ))}
            {task.providers.map((provider) => (
              <Chip key={String(provider)} label="provider" tone="info">{provider}</Chip>
            ))}
          </FactChips>
        </FactRow>
      )}

      {task.freshness !== undefined && (
        <FactRow label="Freshness">
          <FactChips>
            <Chip label="default" title={`${String(task.freshness.defaultMaxAge)} ms`}>
              {fmtFreshness(task.freshness.defaultMaxAge)}
            </Chip>
            {task.freshness.defaultOverride !== undefined && (
              <Chip label="override">{task.freshness.defaultOverride}</Chip>
            )}
            {task.freshness.byField.map((rule) => (
              <Chip key={String(rule.path)} label={rule.path} title={`${String(rule.maxAge)} ms`}>
                {fmtFreshness(rule.maxAge)}
              </Chip>
            ))}
          </FactChips>
        </FactRow>
      )}

      {task.provenance !== undefined && (
        <FactRow label="Provenance">
          <FactChips>
            <Chip label="default">{task.provenance.default}</Chip>
            {task.provenance.byField.map((rule) => (
              <Chip key={String(rule.path)} label={rule.path}>{rule.source}</Chip>
            ))}
          </FactChips>
        </FactRow>
      )}

      <FactRow label="UI vocabulary">
        {task.ui.length === 0 ? (
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
            No catalog entry names this contract — it reaches no browser page.
          </span>
        ) : (
          <FactChips>
            {task.ui.map((link) => (
              <Chip key={link.catalogId} label={link.kind} title={`${link.label} — verified ${link.verifiedAt}`}>
                {link.catalogId}
              </Chip>
            ))}
          </FactChips>
        )}
      </FactRow>

      <FactRow label="Scenarios">
        <FactChips>
          {task.scenarios.map((scenario) => <Chip key={String(scenario)}>{scenario}</Chip>)}
        </FactChips>
      </FactRow>

      <FactRow label="Source">
        <FactChips>
          <SourceLink label="contract" link={task.contractSource} />
          <SourceLink label="impl" link={task.implSource} />
        </FactChips>
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

/**
 * The node panel, built around the ONE question an operator has when they click
 * a step: *what does this read and write, and from where*.
 *
 * The contract table is the spine, exactly as in the demo. Everything that is a
 * FACT about the node — its kind, its system, what it delegates to, that it
 * changes a system of record, that a dry run stops at it — is a chip above the
 * table; the descriptor's prose about the node lives behind the ⓘ.
 */
export function NodeDetail({
  workflow,
  node,
  delegatesToLabel,
}: {
  workflow: ExplorerWorkflowWire;
  node: ExplorerNodeWire;
  delegatesToLabel?: string;
}) {
  const kind = NODE_KIND[node.shape.kind];
  const bindings = nodeBindings(node);
  const reads = node.tasks.filter((task) => task.effect === "read");
  const writes = node.tasks.filter((task) => task.effect !== "read");
  const boundaryNodeId = dryRunBoundaryNodeId(workflow);
  const correctable = correctableMarks(node);
  const unplaceable = unplaceableEditableFields(node);

  return (
    <Panel className="min-h-0">
      <PanelHeader
        title={String(node.id)}
        meta={nodeLabelBeside(node)}
        actions={<NodeInfo workflow={workflow} node={node} />}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        {/* Facts about the node, as chips. Each of these used to be a banner or
            a card of its own in the demo's earlier drafts. */}
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
          <Badge tone={kind.tone}>{kind.word}</Badge>
          {bindings.map((binding) => (
            <Chip key={`${binding.label}-${binding.value}`} label={binding.label}>{binding.value}</Chip>
          ))}
          {delegatesToLabel !== undefined && (
            <Chip tone="info" label="delegates to">{delegatesToLabel}</Chip>
          )}
          {node.shape.kind === "transaction" && <Chip tone="danger">changes a system of record</Chip>}
          {node.shape.kind === "transaction" && node.shape.dryRun === "stop-after-prepare" && (
            <Chip tone="info">
              {boundaryNodeId === String(node.id)
                ? "a dry run stops here — the commit does not run"
                : "a dry run does not commit this"}
            </Chip>
          )}
        </div>

        {node.shape.kind === "task" && node.shape.condition !== undefined && (
          <MetaLine items={[describeNodeCondition(node.shape.condition)]} />
        )}

        {node.tasks.length === 0 ? (
          // EX101 (D276 item 2) — the demo's sentence. The one this replaces
          // explained what a control node IS, which is documentation; what the
          // reader of a contract table needs to know is that nothing moves.
          <MetaLine tone="faint" items={["no value moves here"]} />
        ) : (
          <Table label={`${String(node.id)} contract`} layout="fixed">
            {/*
              The demo's 44/20 split (EX103, D276 item 2). The 46/14 this
              replaces was bought for a longer field path, and it paid for it in
              the System column — which now carries the pencil's row-mate and
              needs its width back.
            */}
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[20%]" />
              <col />
            </colgroup>
            <THead>
              <TR>
                <TH>Field</TH>
                <TH>System</TH>
                <TH>Recorded</TH>
              </TR>
            </THead>
            <TBody>
              {reads.length > 0 && <DirHeaderRow dir="read" />}
              {reads.map((task) => (
                <ContractArmRows key={`r-${String(task.taskId)}`} task={task} correctable={correctable} />
              ))}
              {writes.length > 0 && <DirHeaderRow dir="write" />}
              {writes.map((task) => (
                <ContractArmRows
                  key={`w-${task.arm}-${String(task.taskId)}`}
                  task={task}
                  correctable={correctable}
                />
              ))}
            </TBody>
          </Table>
        )}

        {unplaceable.length > 0 && (
          <Banner tone="warning" title="An Edit Data field has no contract row on this node">
            {`${unplaceable.map((field) => `${String(field.fieldPath)} (${field.label})`).join(", ")} `
              + "— the descriptor allowlists these paths for correction and no task arm of this node "
              + "declares them, so there is no field for the pencil to mark."}
          </Banner>
        )}

        <FactRow label="Depends on">
          {node.dependsOn.length === 0 ? (
            <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
              Nothing — this node may start immediately.
            </span>
          ) : (
            <FactChips>
              {node.dependsOn.map((upstream) => <Chip key={String(upstream)}>{upstream}</Chip>)}
            </FactChips>
          )}
        </FactRow>

        <NodeShapeFacts node={node} />

        {/*
          EX133 — ref operator-trust §5.2.1 item 5 (D275 item 5). The chips
          entered the contract; the pencil did NOT (EX114): the mark rides the
          field's own contract row, and drawing it twice would put one fact in
          two places that can disagree the moment one stops being updated.
        */}
        {node.details.length > 0 && (
          <FactRow label="Detail projections">
            <FactChips>
              {node.details.map((detail) => (
                <Chip
                  key={detail.key}
                  label={detail.label}
                  title={`${detail.key} · ${detail.display}`}
                >
                  {detail.fieldPath}
                </Chip>
              ))}
            </FactChips>
          </FactRow>
        )}

        {/*
          EX114 (D275 item 6): the `Operator-correctable` chip row is GONE.
          It listed the same paths a second time, away from the rows they are
          true of, which is the separation of the action from the value the
          ruling rejects. Nothing is lost — every path it named now marks its
          own contract row, and a path with no such row gets the Banner above
          rather than a chip that pretends the field exists.
        */}

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

        {node.tasks.map((task) => (
          <TaskRecord key={`${task.arm}:${String(task.taskId)}`} task={task} />
        ))}
      </PanelBody>
    </Panel>
  );
}

/** the control-shape facts a node kind owns, one arm each */
function NodeShapeFacts({ node }: { node: ExplorerNodeWire }) {
  const shape = node.shape;
  switch (shape.kind) {
    case "task":
      // EX127 — ref operator-trust §5.2.1 item 4 (D275 item 5): the list row's
      // two replay facts, named in full where the panel has room to name them.
      return (
        <FactRow label="Replay">
          <FactChips>
            <Chip label="checkpoint">{shape.replay}</Chip>
            <Chip
              label="condition"
              tone={shape.condition === undefined ? "neutral" : "info"}
              title={shape.condition === undefined ? undefined : describeNodeCondition(shape.condition)}
            >
              {shape.condition === undefined ? "always runs" : shape.condition.kind}
            </Chip>
          </FactChips>
        </FactRow>
      );
    case "transaction":
      return (
        <FactRow label="Write sequence">
          <FactChips>
            <Chip label="dry run" tone="info">{shape.dryRun}</Chip>
            <Chip label="probe">{shape.probePolicy}</Chip>
            <Chip label="probe→fence" title={`${String(shape.probeToFenceMaxMs)} ms`}>
              {fmtFreshness(shape.probeToFenceMaxMs)}
            </Chip>
            <Chip label="lease">{shape.leaseScope}</Chip>
            <Chip label="retry before fence">{shape.retryBeforeFence ? "declared" : "none"}</Chip>
          </FactChips>
        </FactRow>
      );
    case "branch":
      return (
        <div className="flex flex-col gap-[var(--ds-space-tight)]">
          {shape.cases.map((one) => (
            <FactRow key={one.name} label={`case ${one.name}`}>
              <FactChips>
                {one.nodes.map((target) => <Chip key={String(target)}>{target}</Chip>)}
              </FactChips>
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
              <FactChips>
                {one.nodes.map((target) => <Chip key={String(target)}>{target}</Chip>)}
              </FactChips>
            </FactRow>
          ))}
        </div>
      );
    case "child-run":
      return (
        <FactRow label="Delegation">
          <FactChips>
            <Chip label="target">{shape.targetWorkflowId}</Chip>
            <Chip label="edge">{shape.edgeId}</Chip>
            <Chip label="cardinality">{shape.cardinality}</Chip>
            <Chip label="await">{shape.await}</Chip>
            <Chip label="join">{shape.join}</Chip>
            <Chip label="on child failed">{shape.onChildFailed}</Chip>
            <Chip label="cascade">{shape.cascadeCancel}</Chip>
            <Chip label="after retry">{shape.afterChildRetry}</Chip>
            <Chip label="visibility">{shape.visibility}</Chip>
          </FactChips>
        </FactRow>
      );
    case "gate":
      return (
        <FactRow label="Gate">
          <FactChips>
            <Chip label="resolved by">{shape.resolvedBy}</Chip>
            {shape.statusKey !== undefined && <Chip label="status key">{shape.statusKey}</Chip>}
          </FactChips>
        </FactRow>
      );
  }
}

/* =========================================================================
 * The ⓘs — where everything this page has to TEACH lives
 * ====================================================================== */

/**
 * The descriptor's own words, or the gap named (D229).
 *
 * An absent sentence is drawn faint and italic and says which file owes one —
 * the reader of this surface is the person who would author it. Nothing here
 * composes prose from a label: a sentence assembled from two words would read
 * as the descriptor's own and be nobody's.
 */
function Prose({ prose }: { prose: ExplorerProseWire }) {
  if (prose.state === "absent") {
    return (
      <p className={cn(dsText.body, "italic leading-relaxed text-[color:var(--ds-fg-faint)]")}>
        {prose.reason}
      </p>
    );
  }
  return (
    <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg)]")}>{prose.text}</p>
  );
}

const POSTURE_NOTE: Record<DryRunPosture, string> = {
  boundary:
    "A dry run executes every node above the dashed line and stops after the transaction's prepare arm — the commit never runs. That line, not gated access, is the whole safety boundary of a rehearsal.",
  // EX155/EX156 (D276 item 2) — the demo's own openings. Both said what the
  // DESCRIPTOR declares; the operator's question is what the RUN does to a
  // system of record, and `no-system-write`'s last sentence — where the output
  // actually lands — had been dropped entirely.
  "no-rehearsal":
    "This workflow changes a system of record and honours no dry run, so there is no way to rehearse it. Every start of it is the real thing.",
  "no-system-write":
    "This workflow changes no system of record and has no dry-run boundary — every run of it is already a rehearsal. Anything it writes lands in a file, not in an HR record.",
};

function GraphInfo({
  workflow,
  posture,
  totals,
}: {
  workflow: ExplorerWorkflowWire;
  posture: DryRunPosture;
  totals: ReturnType<typeof explorerGraphTotals>;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label={`What is this graph? — ${workflow.label}`}
          icon={<Info aria-hidden className={dsIcon.sm} />}
          className="text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
        />
      </PopoverTrigger>
      <PopoverContent title={workflow.label} side="bottom" align="end" width="lg">
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {/*
            The descriptor's OWN sentence leads, because that is what the reader
            came for; the derivation note below it is how to trust the sentence.
            An undeclared summary names the file that owes one rather than
            composing something from the two-word label (D229).
          */}
          <Prose prose={workflow.summary} />
          <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
            This graph is the as-built descriptor, read from the one composition root at
            {" "}
            {workflow.sources.descriptor.state === "resolved"
              ? workflow.sources.descriptor.path
              : workflow.sources.descriptor.attemptedPath}
            . A node appears here because the descriptor factory returned it — there is no
            hand-maintained list anywhere behind this page.
          </p>
          <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
            {POSTURE_NOTE[posture]}
          </p>
          <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
            {`${plural(totals.reads, "read")} and ${plural(totals.writes, "write")} count FIELDS, derived from each contract's own zod shape (D227): a read is a field a read arm observes from a system, a write is a field a commit arm writes to one. A prepare arm stages the values its commit then writes, so its inputs are not counted twice.`}
          </p>
          <p
            className={cn(
              dsText.body,
              "border-l pl-[var(--ds-space-base)] leading-relaxed",
              "border-[color:var(--ds-border-loud)] text-[color:var(--ds-fg-secondary)]",
            )}
          >
            Nothing here is editable. Read-only was ratified first (ref operator-trust §5.1), and the editing
            half is deferred out of Phase 2 by D186 — an authoring surface would have to bump a
            version to mean anything.
          </p>
          <WorkflowRegistration workflow={workflow} />
          <MetaLine
            tone="faint"
            items={[
              `v${String(workflow.version)}`,
              plural(workflow.nodes.length, "node"),
              plural(workflow.edges.length, "edge"),
              workflow.systems.join(", ") || "no system",
            ]}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NodeInfo({ workflow, node }: { workflow: ExplorerWorkflowWire; node: ExplorerNodeWire }) {
  const kind = NODE_KIND[node.shape.kind];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          label={`What is this node? — ${String(node.id)}`}
          icon={<Info aria-hidden className={dsIcon.sm} />}
          className="text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]"
        />
      </PopoverTrigger>
      <PopoverContent title={String(node.id)} side="bottom" align="end" width="lg">
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          <Prose prose={node.purpose} />
          {/*
            EX165 — ref operator-trust §5.2.1 item 6 (D275 item 5): places the
            node in its graph for a reader who arrived here by deep link rather
            than by scrolling the list, where the graph is already on screen.
          */}
          <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
            {`${node.label} — a ${kind.word.toLowerCase()} node of ${workflow.label}.`}
          </p>
          {node.shape.kind === "child-run" && (
            <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
              The child keeps its own Queue Row in its own panel and is linked from here — it is
              never nested under this run, and it is never counted twice.
            </p>
          )}
          {node.shape.kind === "transaction" && (
            <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
              {node.shape.dryRun === "stop-after-prepare"
                ? `A dry run of ${workflow.label} stages this node and stops before its commit arm.`
                : `A dry run of ${workflow.label} cannot rehearse this node — it declares no dry-run behaviour at all.`}
            </p>
          )}
          <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
            A pencil on a field means the descriptor allows you to correct it at a checkpoint.
            Identity, input, idempotency, proof and provenance are structurally read-only and
            carry none.
          </p>
          <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
            Every closure this node owns — `bind`, `choose`, `derive`, the write-safety key — is
            reported as the shape it sits in plus the file that owns it. A decompiled rendering of
            what a function computes would be a second, unreviewed description of the code. A
            node&apos;s `when` is the exception because it stopped being a closure: it is a declared
            condition, and the sentence above is a projection of the same value the executor
            evaluates.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* =========================================================================
 * The surface
 * ====================================================================== */

export function WorkflowExplorer({
  workflowId,
  onWorkflow,
  onVersionRegistry,
  onClose,
}: {
  workflowId: string;
  onWorkflow: (next: string) => void;
  /** Opens Archive's real Versions & bumps view through the dashboard route. */
  onVersionRegistry: () => void;
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
  // The URL names the workflow, never the node, so the open node resets with
  // it; falling back to the first node keeps the record column from opening
  // empty on a surface whose whole job is to show something.
  /**
   * `ExplorerWorkflowWireSchema.nodes` is `.min(1)`, so a served workflow ALWAYS
   * has a first node to fall back to. That is what makes the demo's
   * "declares no nodes" arm structurally unreachable here (EX171, D276 item 2)
   * and why it is deleted rather than kept as an unsupported state — but the
   * claim is asserted rather than assumed, because a wire that relaxed `.min(1)`
   * would otherwise turn a real empty graph into a blank record column.
   */
  const openNode = workflow?.nodes.find((node) => String(node.id) === openNodeId) ?? workflow?.nodes[0];
  if (workflow !== undefined && openNode === undefined) {
    throw new Error(`explorer workflow ${String(workflow.id)} served no nodes; the wire requires at least one`);
  }

  useEffect(() => setOpenNodeId(undefined), [workflowId]);

  const detailDelegatesTo =
    openNode !== undefined && openNode.shape.kind === "child-run"
      ? wire?.workflows.find(
        (candidate) =>
          openNode.shape.kind === "child-run"
          && String(candidate.id) === String(openNode.shape.targetWorkflowId),
      )?.label
      : undefined;

  return (
    <Panel
      {...enter}
      aria-label="Workflow explorer"
      className={cn(
        // The SAME arrival the intake and archive takeovers use — same slot,
        // same direction, same distance. Two takeovers that occupy one region
        // and arrive from opposite edges read as two different products.
        "flex-1 data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <PageHeader
        title="Explorer"
        icon={<Workflow aria-hidden className={dsIcon.lg} />}
        badge={
          <Badge tone="neutral">
            <Lock aria-hidden className={dsIcon.sm} />
            read-only
          </Badge>
        }
        back={
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
            onClick={onClose}
          >
            Back to the dashboard
          </Button>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "relative touch-manipulation",
              "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
            )}
            icon={<Eye aria-hidden className={dsIcon.md} />}
            onClick={onVersionRegistry}
          >
            Version registry
          </Button>
        }
      />

      {/* The two thresholds are the demo's: the list splits off first because
          it is the cheapest column, and the node record splits off second
          because it is the one that needs width for a table. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)] min-[900px]:grid-cols-[minmax(0,232px)_minmax(0,1fr)] min-[1280px]:grid-cols-[minmax(0,232px)_minmax(0,1fr)_minmax(0,420px)]">
        {resource.state === "loading" && (
          <Panel className="min-h-0 min-[900px]:col-span-2 min-[1280px]:col-span-3">
            <PanelBody className="p-[var(--ds-space-cozy)]">
              <div className="flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]">
                <Spinner label="Loading the explorer projection" />
                <span className={dsText.body}>Reading the registry…</span>
              </div>
            </PanelBody>
          </Panel>
        )}

        {resource.state === "failed" && (
          <Panel className="min-h-0 min-[900px]:col-span-2 min-[1280px]:col-span-3">
            <PanelBody className="p-[var(--ds-space-cozy)]">
              <Banner tone="danger" title="The explorer projection could not be read">
                {resource.error.message}
              </Banner>
            </PanelBody>
          </Panel>
        )}

        {wire !== undefined && (
          <>
            <WorkflowListPanel
              workflows={wire.workflows}
              selected={workflowId}
              onSelect={(id) => {
                onWorkflow(id);
                // A new workflow is a new shape: the open node belonged to the
                // old one, so it is dropped rather than carried onto a graph
                // that has no such node.
                setOpenNodeId(undefined);
              }}
            />

            {/*
              ONE arm, because the throw above rules the other out: a defined
              workflow always has a node, so "no graph" and "no such workflow"
              are the same fact here.
            */}
            {workflow === undefined || openNode === undefined ? (
              <Panel className="min-h-0 min-[1280px]:col-span-2">
                <PanelBody>
                  <EmptyState
                    icon={<Workflow aria-hidden className={dsIcon.lg} />}
                    title={`No workflow is registered as "${workflowId}"`}
                    description={
                      wire.workflows.length === 0
                        ? "The server serves an empty registry, so there is no graph to explore."
                        : `Registered today: ${wire.workflows.map((one) => String(one.id)).join(", ")}.`
                    }
                    action={
                      wire.workflows[0] === undefined || workflow !== undefined
                        ? undefined
                        : (
                          <Button size="sm" onClick={() => onWorkflow(String(wire.workflows[0]?.id ?? ""))}>
                            Open {String(wire.workflows[0].id)}
                          </Button>
                        )
                    }
                  />
                </PanelBody>
              </Panel>
            ) : (
              <>
                <GraphPanel
                  wire={wire}
                  workflow={workflow}
                  selectedNodeId={String(openNode.id)}
                  onSelectNode={setOpenNodeId}
                />
                {/*
                  Between the two thresholds the record column is BELOW the
                  other two rather than beside them, so it takes the whole row.
                  Auto-placement would drop it into the 232px registry column
                  instead, where a three-column table renders its own headings
                  on top of each other — the demo's grid has the same hole and
                  its corpus never photographed that width.
                */}
                <div className="flex min-h-0 min-[900px]:col-span-2 min-[1280px]:col-span-1">
                  <NodeDetail
                    workflow={workflow}
                    node={openNode}
                    delegatesToLabel={detailDelegatesTo}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
