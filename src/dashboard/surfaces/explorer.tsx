import { observeAsyncResource } from "../state/async-resource.js";
/**
 * The graph-inspection Workflow Explorer with DCC5's closed presentation editor
 * (ref operator-trust §5.2–§5.4; ref dashboard-surfaces §13).
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
 * FIELD-level contract table (`Wage · ucpath · $18.50/hr`); this one serves the
 * same FIELD census (D227), derived from each contract's own zod shape, but
 * draws it as one card per task arm with an Inputs and an Outputs group (D302):
 * the demo's third column carries what one run RECORDED, which varies per row,
 * while this tree's `Recorded` is a per-arm POLICY that does not — so it is
 * stated once on the group head and a row draws only its own departure.
 *
 * ## What remains read-only
 *
 * Graph nodes, contract fields, source links, evidence and every execution
 * fact stay inspection-only. DCC5 adds only DCC4's served presentation subset,
 * through draft validation and the single typed command path; it never turns
 * the graph into a workflow builder or offers a value the authority did not
 * serve as editable.
 */
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
import type { ReactElement,ReactNode } from "react";
import { useEffect,useMemo,useRef,useState } from "react";
import { systemClock } from "../../domain/clock.js";
import type {
ExplorerContractFieldWire,
ExplorerEditValidationResult,
ExplorerNodeWire,
ExplorerProseWire,
ExplorerTaskWire,
ExplorerWorkflowWire,
SourceLinkWire,
WorkflowExplorerWire,
} from "../../domain/dashboard/explorer.js";
import { describeNodeCondition } from "../../domain/workflow/node-condition.js";
import { settleCommandResult } from "../app/command-result.js";
import {
BareButton,
Badge,
Banner,
Button,
Card,
Chip,
Dialog,
DialogBody,
DialogContent,
DialogFooter,
dsClip,
dsFocus,
dsIcon,
dsMotion,
dsRadius,
dsText,
EmptyState,
Field,
IconButton,
Input,
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
Select,
Spinner,
Table,
TakeoverFrame,
TBody,
TD,
Textarea,
TH,
THead,
TR,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { loaded,LOADING,type AsyncResource } from "../state/async-resource.js";
import { useExplorerClient as useDashboardClient } from "../state/explorer-client.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import {
acceptsExplorerEditValidationTicket,
conditionalEdgesFrom,
contractFieldGroups,
correctableMarkFor,
correctableMarks,
dependsOnEdgeExists,
dryRunBoundaryNodeId,
dryRunPosture,
explorerEditProblemTitle,
explorerGraphTotals,
explorerPresentationChange,
explorerPresentationDraft,
explorerPresentationFieldLabel,
explorerPresentationFieldShortLabel,
explorerPresentationValue,
fieldKindLine,
fmtFreshness,
groupScenariosByPrefix,
makeExplorerEditValidationTicket,
matchesExplorerAppliedReadback,
matchesExplorerApplyAcknowledgement,
matchesExplorerCommandResultId,
matchesExplorerValidationDraft,
nodeBindings,
nodeLabelBeside,
scenarioSourceCell,
unplaceableEditableFields,
writeSystems,
type ContractFieldGroup,
type ContractGroupRecorded,
type DryRunPosture,
type ExplorerEditProblem,
type ExplorerEditValidationTicket,
type ExplorerPresentationField,
} from "./explorer-model.js";
import { plural } from "./format.js";
import {
groupWorkflowsByCategory,
workflowHarnessOfName,
type WorkflowGroupEntry,
type WorkflowGroupingFacts,
} from "./workflow-category.js";

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

/**
 * One label/value pair of the node panel.
 *
 * D304: the label is a caps group label in a 7rem column, not an 11px word in
 * a 9rem one — the record's values are ids and paths that want the width, and
 * a label column a third of the rail wide left them ~240px and clipping.
 */
function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)]">
      <span className={cn(dsText.caps, "w-[7rem] shrink-0 pt-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]")}>
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * The arm record as a TABLE: one label column, one value column.
 *
 * D304 drew the record as stacked `FactRow`s — a flex pair per fact with
 * nothing between the pairs — and at the record's density (eight facts, most
 * of them two or three wrapping lines of ids) the eye lost which line belonged
 * to which label. A table gives it what a key/value list is: a hairline under
 * each row, the label as a row HEADER (`<th scope="row">`, so a screen reader
 * names the fact before every value), and a fixed label column. The column is
 * wider than the node-level rows' 7rem because the record's labels are the
 * panel's longest (`Implemented by`, `Subject binding`, `UI vocabulary`) and
 * a label broken over two lines reads as two facts. The rows do not pad
 * horizontally — the record's container owns the inset, and a cell inset on
 * top of it would push the labels out of line with the rows above the cards.
 */
function RecordTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table label={label} layout="fixed">
      <colgroup>
        <col className="w-[8.5rem]" />
        <col />
      </colgroup>
      <TBody>{children}</TBody>
    </Table>
  );
}

/** One fact of a `RecordTable`: the label heads the row, the value fills it. */
function RecordRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TR className="h-auto [&:last-child>*]:border-b-0">
      <TH
        scope="row"
        className={cn(
          "border-[color:var(--ds-border-subtle)] px-0 py-[var(--ds-space-base)] pr-[var(--ds-space-base)] align-top",
          "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {label}
      </TH>
      <TD className="px-0 py-[var(--ds-space-base)] align-top">{children}</TD>
    </TR>
  );
}

interface FactItem {
  readonly key: string;
  /** the fact's name, in the muted ink; omitted when the value names itself */
  readonly label?: string;
  readonly value: string;
  readonly title?: string;
  readonly icon?: ReactNode;
}

/**
 * The record's one value treatment (D304): `label value` pairs on a WRAPPING
 * line, values in mono.
 *
 * The chips this replaced were single-line tokens by contract (`Chip`'s own
 * docstring: a fact that cannot survive truncation is not a chip), and the
 * record's facts are catalog ids, error codes and source paths — the exact
 * strings that were being cut to `kuali.action-list.match…` and recovered on
 * `title` alone. A line wraps; nothing here is reachable by pointer only.
 *
 * The first cut joined the pairs with middle dots in one run of text, and the
 * browser broke that run wherever it liked — inside a value, with the dot
 * stranded at a line end — so a six-pair fact read as a clump. The pairs are
 * now flex items: the line wraps BETWEEN pairs first, each pair stays whole
 * unless a single value is wider than the column, and the column gap is the
 * separator. No dot is needed once the seams are where the eye expects them.
 */
function FactLine({ items }: { items: readonly FactItem[] }) {
  return (
    <span className={cn(dsText.meta, "flex min-w-0 flex-wrap gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)] text-[color:var(--ds-fg-secondary)]")}>
      {items.map((item, index) => (
        <span key={item.key} className="min-w-0 max-w-full break-words">
          {/* The gap is the visual separator; a reader hears the pairs run together without one. */}
          {index > 0 && <span className="sr-only">{", "}</span>}
          {item.icon}
          {item.label !== undefined && (
            <span className="text-[color:var(--ds-fg-muted)]">{`${item.label} `}</span>
          )}
          <span className={dsText.nums} title={item.title}>{item.value}</span>
        </span>
      ))}
    </span>
  );
}

function FactLines({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">{children}</div>;
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
      <FactLine
        items={[{
          key: label,
          label,
          value: String(link.path),
          icon: <FileCode2 aria-hidden className={cn(dsIcon.sm, "mr-[var(--ds-space-tight)] inline align-[-0.15em] text-[color:var(--ds-fg-muted)]")} />,
        }]}
      />
    );
  }
  // D304 keeps the MISS as a warning chip: it is the exceptional arm, its tone
  // is the point, and the attempted path is on the chip and on its title.
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
      <BareButton
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
      </BareButton>
    );
  };

  /*
    THE GRAPH-LESS ARMS ARE DELETED, AND THAT IS THE RULING (D276 item 2 —
    "delete unreachable arms"; ledger 3 rows EX13, EX18, EX20, EX23). The demo
    keeps four of them here: a header `${drawn} of ${total} drawn`, a `disabled`
    faint row, a `serves no descriptor graph yet` title, and a `—` where the node
    count goes. Every one of them is a state THIS wire cannot produce —
    `ExplorerWorkflowWireSchema.nodes` is `.min(1)`, so a served workflow always
    has a graph — and the same `.min(1)` is asserted rather than assumed at the
    detail's fallback below (EX171), which is where a relaxed schema would show
    up first. Porting them would have put four arms on screen that can never be
    right and can never be wrong, which is the "retains unsupported states" this
    item rejects. The header's surviving arm is the demo's own first arm.

    The `aria-label` is a rebuild-only addition and STAYS (ledger 3 row EX26):
    two `Panel` landmarks sit side by side on this surface, and a landmark with
    no name is one an assistive reader cannot tell from the other. The demo's
    list is a bare `div`, so it never had two landmarks to distinguish.
  */
  return (
    <Panel className="min-h-0" aria-label="Registered workflows">
      <PanelHeader title="Workflows" headingLevel={2} meta={String(workflows.length)} />
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
      <Chip className="shrink-0" label="version">{String(workflow.version)}</Chip>
      <Chip className="shrink-0" label="shape">{workflow.surfaceShape}</Chip>
      <Chip className="shrink-0" label="enqueue">{workflow.enqueue}</Chip>
      <Chip className="shrink-0" label="subject">
        {workflow.inputSubject.state === "fixed" ? workflow.inputSubject.value : "derived from input"}
      </Chip>
      {/*
        ONE chip, however many systems (D299). `system crm` `system ucpath` spent
        the label twice on a fact the reader had already taken, and the second
        one is what pushed this band onto a second line — on the workflow with
        the FEWEST systems. The value is the set, joined; the chip's own hover
        carries it whole for the day a workflow reaches four.
      */}
      {workflow.systems.length > 0 && (
        <Chip
          className="shrink-0"
          label={workflow.systems.length === 1 ? "system" : "systems"}
          tone="info"
          title={workflow.systems.join(", ")}
        >
          {workflow.systems.join(" · ")}
        </Chip>
      )}
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
        /*
          BOTH ARMS STAY (ledger 3 row EX55, a named exception under D276 item 2).
          The demo prints `always` unconditionally because every pair in its
          fixture graph carries the back-edge; here `dependsOn` is a real
          declaration a descriptor may omit, so an unconditional `always` would
          tell the operator that the next node WAITS for this one when nothing
          says it does — on the surface whose whole subject is what waits for
          what. `no edge between them` is the served fact, and the `title` on
          each arm says which declaration produced it.
        */
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
    <BareButton
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
    </BareButton>
  );
}

function GraphPanel({
  wire,
  workflow,
  selectedNodeId,
  onSelectNode,
  onEditPresentation,
}: {
  wire: WorkflowExplorerWire;
  workflow: ExplorerWorkflowWire;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  onEditPresentation: (field: ExplorerPresentationField, trigger: HTMLButtonElement) => void;
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
        headingLevel={2}
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
        <ExplorerPresentationFields workflow={workflow} onEdit={onEditPresentation} />
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

        <ScenariosSection workflow={workflow} />
      </PanelBody>
    </Panel>
  );
}

/**
 * The scenarios registered against this workflow — one CARD per group, and a
 * table of leaves inside each (D299).
 *
 * The list this replaces put each scenario's whole source path in a chip on
 * the scenario's own row, so every row repeated `walks tests/scenario/` and
 * every id repeated its own leading segment: `separations` registers 50 across
 * three harnesses, and a run of a dozen rows was the same 27 characters over
 * and over with the part that told them apart starting after it. The segment
 * is the card's title now and the rows carry only the remainder.
 *
 * Inside a card the two columns are FIXED at 50/50. Sized to content, column
 * one is set by its longest cell and a short id ends up hundreds of pixels
 * from its own file; handing the surplus to column two instead collapses
 * column one to min-content and wraps every leaf. Equal halves put the file at
 * the same x on every row of every card. A leaf past half the card WRAPS —
 * a scenario id is the string a failure resolves to and may never be cut, and
 * `break-words` takes the `-` boundaries it already carries.
 *
 * A resolved file prints its base name and carries the whole path on the cell.
 * An UNRESOLVED one keeps its warning chip and prints the attempted path
 * whole: that arm is the one where the reader needs to know where the explorer
 * looked.
 */
function ScenariosSection({ workflow }: { workflow: ExplorerWorkflowWire }) {
  const groups = groupScenariosByPrefix(workflow.scenarios);
  return (
    <section aria-label="Scenarios" className="flex flex-col gap-[var(--ds-space-tight)]">
      <div className="flex items-baseline gap-[var(--ds-space-base)]">
        <SectionLabel>Scenarios</SectionLabel>
        {/*
          `registered`, not `scenarios` — the label two words to its left
          already said the noun, and `Scenarios · 24 scenarios` is the stutter
          the a11y tree reads out.
        */}
        {workflow.scenarios.length > 0 && (
          <span className={cn(dsText.meta, dsText.nums, "ml-auto text-[color:var(--ds-fg-faint)]")}>
            {`${String(workflow.scenarios.length)} registered`}
          </span>
        )}
      </div>
      {/*
        The empty arm is an ANSWER, and it takes the same card the groups do.
        The list this replaces rendered a heading over nothing, which reads as
        a region that failed to draw rather than as a workflow no scenario
        walks.
      */}
      {groups.length === 0 ? (
        <Card className="p-[var(--ds-space-cozy)]">
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
            No scenario walks this workflow.
          </span>
        </Card>
      ) : (
        groups.map((group) => (
          <Card
            key={group.prefix}
            className="gap-[var(--ds-space-snug)] p-[var(--ds-space-cozy)]"
          >
            <span className={cn(dsText.ui, dsText.nums, "font-semibold text-[color:var(--ds-fg)]")}>
              {group.prefix}
            </span>
            <Table label={`${group.prefix} scenarios`} layout="fixed">
              <THead>
                <TR>
                  <TH className="w-1/2">Scenario</TH>
                  <TH className="w-1/2">Walked by</TH>
                </TR>
              </THead>
              <TBody>
                {group.rows.map((row) => {
                  const source = scenarioSourceCell(row.source);
                  return (
                    <TR key={row.scenarioId}>
                      <TD numeric className="align-top">
                        <span
                          title={row.scenarioId}
                          className={cn(
                            dsText.body,
                            "block break-words text-[color:var(--ds-fg)]",
                            "pl-[1.5ch] [text-indent:-1.5ch]",
                          )}
                        >
                          {row.leaf}
                        </span>
                      </TD>
                      <TD className="align-top">
                        {source.state === "resolved" ? (
                          <span
                            title={source.title}
                            className={cn(dsText.body, dsText.nums, dsClip.text, "block min-w-0 text-[color:var(--ds-fg-muted)]")}
                          >
                            {source.text}
                          </span>
                        ) : (
                          <Chip
                            tone="warning"
                            title={source.title}
                            icon={<SquareArrowOutUpRight aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}
                          >
                            {source.text}
                          </Chip>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        ))
      )}
    </section>
  );
}

/* =========================================================================
 * PANEL THREE — the node's contract
 * ====================================================================== */

/** the read / write heading above the arms of that direction — the direction axis, once */
function DirHeading({ dir }: { dir: "read" | "write" }) {
  const Icon = dir === "read" ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <span className={cn(dsText.caps, "flex items-center gap-[var(--ds-space-tight)]", DIR_INK[dir])}>
      <Icon aria-hidden className={dsIcon.sm} />
      {dir === "read" ? "Reads" : "Writes"}
    </span>
  );
}

/**
 * One task ARM, as a CARD: its head names the contract every field beneath it
 * belongs to, and its two groups hold the fields (D302).
 *
 * The demo bands only by direction, because its rows are fields of ONE run's
 * node. Here a node owns one or two whole contracts, and a field row that did
 * not say which contract it came from would be unresolvable back to a source
 * file — which is the surface's entire job. So the card keeps the arm's id, its
 * verb, and the chips that are facts about the WHOLE contract rather than about
 * a side of it: `no implementation`, `proof`, `checkpoint`, `artifacts`. The
 * `fresh` and `from` chips that used to sit here moved onto the Outputs group
 * head, which is the side they are a fact about.
 */
function ContractArmCard({
  task,
  correctable,
}: {
  task: ExplorerTaskWire;
  /** `side path` → the Edit Data label it is allowlisted under (D275 item 6). */
  correctable: ReadonlyMap<string, string>;
}) {
  const bound = task.binding.state === "bound";
  const chips = [
    !bound && <Chip key="unbound" tone="warning">no implementation</Chip>,
    task.writeSafety !== undefined && (
      <Chip key="proof" tone="warning" label="proof">{task.writeSafety.completionKind}</Chip>
    ),
    task.checkpoint !== undefined && <Chip key="checkpoint" label="checkpoint">{task.checkpoint}</Chip>,
    task.artifacts !== undefined && <Chip key="artifacts" label="artifacts">{task.artifacts}</Chip>,
  ].filter((chip) => chip !== false);
  return (
    <Card className="overflow-hidden" aria-label={`${String(task.taskId)} contract`} role="group">
      <div className="flex flex-col gap-[var(--ds-space-snug)] px-[var(--ds-space-base)] py-[var(--ds-space-base)]">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-hair)]">
          <span className={cn(dsText.body, dsText.nums, "font-semibold text-[color:var(--ds-fg)]")}>
            {task.taskId}
          </span>
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
            {ARM_WORD[task.arm]} · {task.title}
          </span>
        </span>
        {chips.length > 0 && (
          <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">{chips}</span>
        )}
      </div>
      {contractFieldGroups(task).map((group) => (
        <ContractFieldGroupView key={group.side} task={task} group={group} correctable={correctable} />
      ))}
      <ArmRecord task={task} />
    </Card>
  );
}

/** the words a group head prints when its shared fact is not a chip */
const GROUP_RECORDED_WORD: Record<Exclude<ContractGroupRecorded["kind"], "observed" | "unknown">, string> = {
  bound: "bound by the graph",
  "not-recorded": "not recorded",
  checkpointed: "stored in the transaction checkpoint",
};

/**
 * The group head's right-hand statement — the ONE place the group's `Recorded`
 * fact is drawn.
 *
 * No run is laid over this graph (§5.7's first exclusion), so a recorded VALUE
 * is not a fact this surface holds. What the descriptor does declare is the
 * arm's provenance and freshness, and each remaining arm states the genuine
 * reason a side has no observation behind it. `unknown` is drawn as a warning
 * on purpose: a read whose provenance nothing declares is a gap in the
 * contract, not a quiet default.
 */
function GroupRecorded({ shared }: { shared: ContractGroupRecorded }) {
  switch (shared.kind) {
    case "observed":
      return (
        <>
          <Chip label="from">{shared.source}</Chip>
          <Chip label="fresh" title={`${String(shared.maxAge)} ms`}>{fmtFreshness(shared.maxAge)}</Chip>
          {shared.override !== undefined && <Chip label="override">{shared.override}</Chip>}
        </>
      );
    case "unknown":
      return <Chip tone="warning" title={shared.reason}>unknown</Chip>;
    case "bound":
    case "not-recorded":
    case "checkpointed":
      return (
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
          {GROUP_RECORDED_WORD[shared.kind]}
        </span>
      );
  }
}

/**
 * One SIDE of an arm's contract: a head that states the side, its count and
 * the fact every row shares, then the rows.
 *
 * The census is derived from the contract's zod shape by `contractSchemaLeaves`,
 * which walks the SAME schema object the arm's `inputSchemaHash` /
 * `outputSchemaHash` fingerprint. There is no authored field list anywhere
 * behind these rows.
 */
function ContractFieldGroupView({
  task,
  group,
  correctable,
}: {
  task: ExplorerTaskWire;
  group: ContractFieldGroup;
  correctable: ReadonlyMap<string, string>;
}) {
  const word = group.side === "input" ? "Inputs" : "Outputs";
  return (
    <div className="flex flex-col border-t border-[color:var(--ds-border-subtle)]">
      <div
        className={cn(
          "flex min-h-[var(--ds-h-md)] flex-wrap items-center gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)]",
          "bg-[var(--ds-surface-2)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
        )}
      >
        <span className={cn(dsText.caps, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
          {`${word} · ${String(group.fields.length)}`}
        </span>
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-[var(--ds-space-tight)]">
          {group.fields.length === 0 ? (
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>none declared</span>
          ) : (
            <GroupRecorded shared={group.shared} />
          )}
        </span>
      </div>
      {group.fields.length > 0 && (
        <ul aria-label={`${String(task.taskId)} ${word.toLowerCase()}`} className="flex flex-col">
          {group.fields.map(({ field, deviations }) => (
            <ContractFieldRow
              key={String(field.path)}
              field={field}
              deviations={deviations}
              correctableAs={correctableMarkFor(correctable, field)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One FIELD of a contract — the demo's row, over this tree's own census, as a
 * list item inside its side's group.
 */
function ContractFieldRow({
  field,
  deviations,
  correctableAs,
}: {
  field: ExplorerContractFieldWire;
  /** the chips this row draws because it does NOT share its group's fact */
  deviations: ContractFieldGroup["fields"][number]["deviations"];
  /**
   * The Edit Data label this path is allowlisted under, or `undefined` for a
   * field the descriptor does not let anyone correct.
   *
   * D275 item 6 (ledger 3 EX114): the pencil sits IN the field's own row,
   * because editability is a property of a FIELD and a mark that lives in a
   * chip row below the list is an action separated from the value it is about.
   * The rejected arms were exactly that separation (B) and restating the
   * deferred edit posture instead of drawing the fact (C).
   */
  correctableAs?: string;
}) {
  return (
    <li
      className={cn(
        "flex min-h-[var(--ds-h-row)] items-center gap-[var(--ds-space-snug)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
        "border-t border-[color:var(--ds-border-subtle)] first:border-t-0",
      )}
    >
      <span className={cn(dsText.body, dsText.nums, dsClip.text, "text-[color:var(--ds-fg)]")}>
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
      {deviations.map((deviation) => (
        <Chip
          key={`${deviation.label ?? ""}:${deviation.value}`}
          tone={deviation.tone}
          label={deviation.label}
          title={deviation.title}
          className="shrink-0"
        >
          {deviation.value}
        </Chip>
      ))}
      <span
        className={cn(dsText.meta, "ml-auto shrink-0 text-[color:var(--ds-fg-muted)]")}
        title={field.options === undefined ? undefined : field.options.join(" · ")}
      >
        {fieldKindLine(field)}
      </span>
    </li>
  );
}

/** the catalog's own kind order — the schema's enum, so a fifth kind is a typecheck failure here */
const UI_LINK_KINDS: readonly ExplorerTaskWire["ui"][number]["kind"][] = ["screen", "element", "page-state", "observation"];

/**
 * Everything about ONE task arm that its contract groups do not hold — drawn
 * INSIDE the arm's card, under the groups (D304).
 *
 * §5.2 wants each task's input/output/error/effect/freshness/provenance/
 * scenarios, its UI elements and page states, and a transaction's subject
 * binding, probe, fence and proof. The demo folds its (much smaller) equivalent
 * into a ⓘ; here the record IS the answer an operator or a code-changing AI
 * came for, so it stays on the page and the ⓘ keeps only what has to be taught.
 *
 * Three things left with D304. The record's own head (verb badge, id, title)
 * is the card head one screen up, so it is not drawn twice. `Freshness` and
 * `Provenance` are the Outputs group head and the rows' deviations, so they are
 * not drawn twice either. And the chips became lines: `Write safety` alone
 * keeps its chips, because its tones carry the fact (a warning on the proof
 * and on what happens when the proof is absent).
 */
function ArmRecord({ task }: { task: ExplorerTaskWire }) {
  const uiByKind = UI_LINK_KINDS
    .map((kind) => ({ kind, links: task.ui.filter((link) => link.kind === kind) }))
    .filter((group) => group.links.length > 0);
  return (
    <div className="flex flex-col gap-[var(--ds-space-base)] px-[var(--ds-space-base)] pb-[var(--ds-space-base)]">
      <RecordTable label={`${String(task.taskId)} record`}>
        <RecordRow label="Implemented by">
          {task.binding.state === "bound" ? (
            <FactLine
              items={[
                { key: "store", label: "store", value: task.binding.storeNamespace },
                { key: "kind", label: "kind", value: task.binding.storeKind },
                // The driver is named only when it is not the store's own name —
                // `store kuali · driver kuali` is one fact twice.
                ...(task.binding.driverSystem !== undefined && task.binding.driverSystem !== task.binding.storeNamespace
                  ? [{ key: "driver", label: "driver", value: String(task.binding.driverSystem) }]
                  : []),
              ]}
            />
          ) : (
            // A contract no store implements yet is a legitimate mid-program
            // state (D107) and it is stated, never hidden: a workflow that cannot
            // run must not read here as one that can.
            <Banner tone="warning" title="No implementation is bound yet">
              {task.binding.note}
            </Banner>
          )}
        </RecordRow>

        <RecordRow label="Subject binding">
          {task.subject.kind === "none" ? (
            <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
              {task.subject.reason ?? "none declared"}
            </span>
          ) : (
            <FactLines>
              <FactLine
                items={[
                  { key: "kind", label: "kind", value: task.subject.kind },
                  { key: "identity", label: "identity", value: task.subject.identity },
                  { key: "from", label: "from input", value: String(task.subject.fromInput) },
                ]}
              />
              <FactLine
                items={[
                  {
                    key: "observes",
                    label: "observes",
                    value: String(task.subject.observe),
                    icon: <ScanEye aria-hidden className={cn(dsIcon.sm, "mr-[var(--ds-space-tight)] inline align-[-0.15em] text-[color:var(--ds-fg-muted)]")} />,
                  },
                  { key: "match", label: "match", value: task.subject.match },
                  { key: "required", label: "required at", value: task.subject.requiredAt },
                ]}
              />
            </FactLines>
          )}
        </RecordRow>

        {task.writeSafety !== undefined && (
          <RecordRow label="Write safety">
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
          </RecordRow>
        )}

        <RecordRow label="Errors">
          <FactLine items={task.errorCodes.map((code) => ({ key: code, value: code }))} />
        </RecordRow>

        {(task.requires.length > 0 || task.providers.length > 0) && (
          <RecordRow label="Requires">
            <FactLine
              items={[
                ...task.requires.map((requirement) => ({ key: `requires:${String(requirement)}`, label: "secret", value: String(requirement) })),
                ...task.providers.map((provider) => ({ key: `provider:${String(provider)}`, label: "provider", value: String(provider) })),
              ]}
            />
          </RecordRow>
        )}

        <RecordRow label="UI vocabulary">
          {task.ui.length === 0 ? (
            <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
              No catalog entry names this contract — it reaches no browser page.
            </span>
          ) : (
            <FactLines>
              {uiByKind.map((group) => (
                <FactLine
                  key={group.kind}
                  items={group.links.map((link, index) => ({
                    key: link.catalogId,
                    ...(index === 0 ? { label: group.kind } : {}),
                    value: link.catalogId,
                    title: `${link.label} — verified ${link.verifiedAt}`,
                  }))}
                />
              ))}
            </FactLines>
          )}
        </RecordRow>

        <RecordRow label="Scenarios">
          <FactLine items={task.scenarios.map((scenario) => ({ key: String(scenario), value: String(scenario) }))} />
        </RecordRow>

        <RecordRow label="Source">
          <FactLines>
            <SourceLink label="contract" link={task.contractSource} />
            <SourceLink label="impl" link={task.implSource} />
          </FactLines>
        </RecordRow>
      </RecordTable>

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
    </div>
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
        headingLevel={2}
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


        {node.tasks.length === 0 ? (
          // EX101 (D276 item 2) — the demo's sentence. The one this replaces
          // explained what a control node IS, which is documentation; what the
          // reader of a contract table needs to know is that nothing moves.
          <MetaLine tone="faint" items={["no value moves here"]} />
        ) : (
          <section
            aria-label={`${String(node.id)} contract`}
            className="flex flex-col gap-[var(--ds-space-base)]"
          >
            {reads.length > 0 && <DirHeading dir="read" />}
            {reads.map((task) => (
              <ContractArmCard key={`r-${String(task.taskId)}`} task={task} correctable={correctable} />
            ))}
            {writes.length > 0 && <DirHeading dir="write" />}
            {writes.map((task) => (
              <ContractArmCard
                key={`w-${task.arm}-${String(task.taskId)}`}
                task={task}
                correctable={correctable}
              />
            ))}
          </section>
        )}

        {unplaceable.length > 0 && (
          <Banner tone="warning" title="An Edit Data field has no contract row on this node">
            {`${unplaceable.map((field) => `${String(field.fieldPath)} (${field.label})`).join(", ")} `
              + "— the descriptor allowlists these paths for correction and no task arm of this node "
              + "declares them, so there is no field for the pencil to mark."}
          </Banner>
        )}
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

/**
 * The only mutable controls on this page. These are field rows, rather than
 * buttons in the graph or a duplicated detail panel, because each action is
 * about exactly one served presentation value. The descriptor graph stays a
 * read-only inspection surface.
 */
export function ExplorerPresentationFields({
  workflow,
  onEdit,
}: {
  workflow: ExplorerWorkflowWire;
  onEdit: (field: ExplorerPresentationField, trigger: HTMLButtonElement) => void;
}) {
  const rows: readonly ExplorerPresentationField[] = ["workflow-label", "workflow-icon", "workflow-category"];
  return (
    <section aria-label="Editable workflow presentation" className="flex flex-col gap-[var(--ds-space-tight)] border-t border-[color:var(--ds-border-subtle)] pt-[var(--ds-space-cozy)]">
      <SectionLabel>Presentation</SectionLabel>
      {/*
        THREE FIELDS, ONE LINE (D299). Each of these carries a value of one or
        two words, and each used to get a full-width row 44px tall with the
        value stranded beside a 9rem label column and the same sentence —
        `Edit workflow <field>` — spelled out on the far right. Three of those
        was the tallest region in the panel, spent on the least of its facts.
        The pair travels together instead, in the recessed plane the rest of
        this panel already uses for a fact, and the row wraps rather than
        scrolls.
      */}
      <dl className="m-0 flex min-w-0 flex-wrap gap-[var(--ds-space-base)]">
        {rows.map((field) => (
          <div
            key={field}
            className={cn(
              "flex min-w-0 items-center gap-[var(--ds-space-snug)] border",
              dsRadius.md,
              "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)]",
              "py-[var(--ds-space-hair)] pl-[var(--ds-space-base)] pr-[var(--ds-space-hair)]",
            )}
          >
            {/*
              The SHORT name. `Workflow label` inside a section headed
              `Presentation` inside a panel headed `Person Lookup v1` said
              `workflow` a third time; the door below keeps the long name,
              because a door is read with no section around it.
            */}
            <dt className={cn(dsText.meta, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
              {explorerPresentationFieldShortLabel(field)}
            </dt>
            <dd className={cn(dsText.ui, dsClip.text, "m-0 min-w-0 text-[color:var(--ds-fg)]")}>
              {explorerPresentationValue(workflow, field)}
            </dd>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              label={`Edit ${explorerPresentationFieldLabel(field).toLowerCase()}`}
              icon={<Pencil aria-hidden className={dsIcon.sm} />}
              onClick={(event) => onEdit(field, event.currentTarget)}
            />
          </div>
        ))}
      </dl>
    </section>
  );
}

function ExplorerEditUnavailable({ workflow }: { workflow: ExplorerWorkflowWire }) {
  return (
    <section aria-label="Unavailable Explorer edit categories" className="flex flex-col gap-[var(--ds-space-tight)]">
      <div className={cn(dsText.meta, "flex flex-col gap-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]")}>
        <span>{`Timeline presentation unavailable: ${workflow.edit.presentation.timeline.reason}`}</span>
        <span>{`Notification preferences unavailable: ${workflow.edit.notificationPreferences.reason}`}</span>
      </div>
      <Banner tone="info" title="Policy and Edit Data code-change brief">
        {`${workflow.edit.operationalPolicies.reason} ${workflow.edit.editData.reason} Review the descriptor source before changing either: `}
        <SourceLink label="descriptor" link={workflow.sources.descriptor} />
      </Banner>
    </section>
  );
}

type ExplorerReviewedEdit = Readonly<{
  ticket: ExplorerEditValidationTicket;
  result: ExplorerEditValidationResult;
}>;

export function ExplorerEditDialog({
  workflow,
  field,
  actorId,
  onClose,
  onReadback,
}: {
  workflow: ExplorerWorkflowWire;
  field: ExplorerPresentationField | undefined;
  actorId: string | undefined;
  onClose: () => void;
  onReadback: (wire: WorkflowExplorerWire) => void;
}) {
  const client = useDashboardClient();
  const targetIdentity = field === undefined
    ? undefined
    : `${String(workflow.id)}:${String(workflow.version)}:${String(workflow.contractFingerprint)}:${String(workflow.edit.overrideRevision)}:${field}`;
  const servedValue = field === undefined ? "" : explorerPresentationValue(workflow, field);
  const [editor, setEditor] = useState(() => ({ targetIdentity, value: servedValue }));
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<ExplorerReviewedEdit | undefined>(undefined);
  const [busy, setBusy] = useState<"review" | "apply" | undefined>(undefined);
  const [problem, setProblem] = useState<ExplorerEditProblem | undefined>(undefined);
  const [applied, setApplied] = useState<ExplorerWorkflowWire | undefined>(undefined);
  const validationGeneration = useRef(0);
  // Only our verified readback may advance the parent basis without dismissing
  // its outcome. A new target, actor, field or external revision starts fresh.
  const completedReadback = useRef<{ targetIdentity: string; value: string; actorId: string } | undefined>(undefined);
  const value = editor.targetIdentity === targetIdentity ? editor.value : servedValue;

  useEffect(() => {
    validationGeneration.current += 1;
    const completed = completedReadback.current;
    if (completed !== undefined && completed.targetIdentity === targetIdentity
      && completed.value === servedValue && completed.actorId === actorId) {
      return () => { validationGeneration.current += 1; };
    }
    completedReadback.current = undefined;
    setEditor({ targetIdentity, value: servedValue });
    setReason("");
    setReview(undefined);
    setBusy(undefined);
    setProblem(undefined);
    setApplied(undefined);
    return () => { validationGeneration.current += 1; };
  }, [actorId, servedValue, targetIdentity]);

  if (field === undefined) return null;
  const draft = explorerPresentationDraft(workflow, explorerPresentationChange(workflow, field, value));
  const reviewedDraft = review?.result.state === "ready-to-apply" ? review.result.draft : draft;
  const validationBases = `Descriptor v${String(reviewedDraft.baseDescriptorVersion)} · contract ${String(reviewedDraft.baseContractFingerprint)} · override r${String(reviewedDraft.baseOverrideRevision)}`;
  const canReview = actorId !== undefined && value.trim() === value && value.length > 0 && reason.trim() === reason && reason.length > 0;
  const readbackUncertain = problem?.kind === "result-unknown" || problem?.kind === "applied-but-unverified";

  const invalidateReview = (): void => {
    validationGeneration.current += 1;
    setReview(undefined);
    setBusy(undefined);
  };

  const changeValue = (next: string): void => {
    invalidateReview();
    setEditor({ targetIdentity, value: next });
    setProblem(undefined);
  };

  const changeReason = (next: string): void => {
    invalidateReview();
    setReason(next);
    setProblem(undefined);
  };

  const close = (): void => {
    completedReadback.current = undefined;
    invalidateReview();
    onClose();
  };

  const reviewDraft = (): void => {
    if (actorId === undefined) return;
    const ticket = makeExplorerEditValidationTicket(++validationGeneration.current, draft, reason, actorId);
    setBusy("review");
    setProblem(undefined);
    client.validateExplorerEdit(draft).then(
      (result) => {
        if (!acceptsExplorerEditValidationTicket(ticket, validationGeneration.current, draft, reason, actorId)) return;
        if (!matchesExplorerValidationDraft(result, draft) && result.state === "ready-to-apply") {
          setProblem({ kind: "validation", message: "Explorer validation returned a different draft or descriptor basis; it cannot be applied." });
          setBusy(undefined);
          return;
        }
        setReview({ ticket, result });
        setBusy(undefined);
      },
      (error: unknown) => {
        if (!acceptsExplorerEditValidationTicket(ticket, validationGeneration.current, draft, reason, actorId)) return;
        setProblem({ kind: "validation", message: error instanceof Error ? error.message : String(error) });
        setBusy(undefined);
      },
    );
  };

  const apply = (): void => {
    const reviewed = review?.result;
    if (review === undefined || reviewed === undefined || reviewed.state !== "ready-to-apply") return;
    if (actorId === undefined) {
      setProblem({ kind: "validation", message: "The operator identity is still loading; this edit cannot be applied yet." });
      return;
    }
    if (!acceptsExplorerEditValidationTicket(review.ticket, validationGeneration.current, draft, reason, actorId)) {
      setProblem({ kind: "validation", message: "The reviewed Explorer change no longer matches this editor. Review it again before applying." });
      return;
    }
    const generation = ++validationGeneration.current;
    const isCurrent = (): boolean => generation === validationGeneration.current;
    const request = {
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: "workflow-explorer",
      reason,
      family: "explorer" as const,
      type: "apply-explorer-edit" as const,
      target: {
        workflowId: workflow.id,
        expectedVersion: workflow.version,
        contractFingerprint: workflow.contractFingerprint,
        expectedOverrideRevision: workflow.edit.overrideRevision,
      },
      payload: { changes: reviewed.draft.changes },
    };
    setBusy("apply");
    setProblem(undefined);
    void (async () => {
      let acknowledgedCommandId: string | undefined;
      try {
        const result = await client.executeCommand(request);
        if (!isCurrent()) return;
        if (!matchesExplorerCommandResultId(result, request.commandId)) {
          throw new Error("Explorer command result did not name this generated command");
        }
        const settlement = settleCommandResult(result);
        if (settlement.kind === "refused") {
          setProblem({ kind: "not-applied", message: settlement.problem, commandId: result.commandId });
          setBusy(undefined);
          return;
        }
        switch (result.state) {
          case "applied":
          case "already-applied":
            break;
          case "confirmation-required":
          case "conflict":
          case "rejected":
            throw new Error("Explorer command settlement disagreed with its result state");
        }
        if (!matchesExplorerApplyAcknowledgement(
          result,
          request.commandId,
          String(request.target.workflowId),
          request.target.expectedOverrideRevision + 1,
        )) {
          throw new Error("Explorer command acknowledgement did not name this command and exact target revision");
        }
        acknowledgedCommandId = result.commandId;
        const fresh = await client.workflowExplorer();
        if (!isCurrent()) return;
        const readback = fresh.workflows.find((entry) => String(entry.id) === String(workflow.id));
        if (!matchesExplorerAppliedReadback(workflow, reviewed.draft, reviewed.override, readback)) {
          throw new Error(`Explorer apply ${result.commandId} did not return the exact reviewed presentation readback`);
        }
        completedReadback.current = {
          targetIdentity: `${String(readback.id)}:${String(readback.version)}:${String(readback.contractFingerprint)}:${String(readback.edit.overrideRevision)}:${field}`,
          value: explorerPresentationValue(readback, field),
          actorId,
        };
        onReadback(fresh);
        setBusy(undefined);
        setApplied(readback);
      } catch (error: unknown) {
        if (!isCurrent()) return;
        completedReadback.current = undefined;
        const message = error instanceof Error ? error.message : String(error);
        setProblem(acknowledgedCommandId === undefined
          ? { kind: "result-unknown", message }
          : { kind: "applied-but-unverified", commandId: acknowledgedCommandId, message });
        setBusy(undefined);
      }
    })();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        title={`Edit ${explorerPresentationFieldLabel(field).toLowerCase()}`}
        description="Review the served descriptor and override bases before applying this presentation-only change."
        size="lg"
      >
        <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
          {review === undefined ? (
            <>
              <Field
              label={explorerPresentationFieldLabel(field)}
              description={field === "workflow-label" ? "A trimmed, normalized presentation label only." : "Choose only a value the server served as allowed."}
              error={value.trim() !== value || value.length === 0 ? "Use a non-empty value without surrounding whitespace." : undefined}
            >
              {field === "workflow-label" ? (
                <Input value={value} maxLength={120} onChange={(event) => changeValue(event.target.value)} autoFocus />
              ) : (
                <Select value={value} onChange={(event) => changeValue(event.target.value)} autoFocus>
                  {(field === "workflow-icon" ? workflow.edit.presentation.iconValues : workflow.edit.presentation.categoryValues).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              )}
              </Field>
              <Field
              label="Operator reason"
              required
              description="Recorded in the exact command envelope reviewed and applied."
              error={reason.trim() !== reason || reason.length === 0 ? "Give a non-empty reason without surrounding whitespace." : undefined}
              >
                <Textarea value={reason} maxLength={500} rows={3} onChange={(event) => changeReason(event.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <section aria-label="Draft review" className="flex flex-col gap-[var(--ds-space-tight)]">
                <SectionLabel>Draft review</SectionLabel>
                <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{validationBases}</p>
                {(() => {
                  switch (review.result.state) {
                    case "ready-to-apply":
                      return (
                        <ul className={cn(dsText.body, "flex flex-col gap-[var(--ds-space-hair)] text-[color:var(--ds-fg)]")}>
                          {review.result.semanticDiff.map((change) => <li key={change.path}>{`${change.path}: ${change.before} → ${change.after}`}</li>)}
                        </ul>
                      );
                    case "conflict":
                      return <Banner tone="warning" title={`Conflict: ${review.result.conflict}`}>{review.result.message}</Banner>;
                    case "refused":
                      return <Banner tone="danger" title={`Refused: ${review.result.category}`}>{review.result.message}</Banner>;
                    case "code-change-required":
                      return (
                        <Banner tone="info" title="Reviewed code change required">
                          {`${review.result.brief.reason} Required files: ${review.result.brief.requiredFiles.join(", ")}. Obligations: ${review.result.brief.failedObligations.join("; ")}`}
                        </Banner>
                      );
                  }
                })()}
              </section>
              <ExplorerEditUnavailable workflow={workflow} />
            </>
          )}
          {problem !== undefined && <Banner tone="danger" title={explorerEditProblemTitle(problem)}>{problem.message}</Banner>}
          {applied !== undefined && (
            <Banner tone="success" title="Applied and read back exactly">
              {`Descriptor v${String(applied.version)} · contract ${String(applied.contractFingerprint)} · override r${String(applied.edit.overrideRevision)} · ${applied.label} · ${applied.icon} · ${applied.category}`}
            </Banner>
          )}
          <p aria-live="polite" className="sr-only">
            {busy === "review" ? "Validating Explorer draft" : busy === "apply" ? "Applying Explorer edit" : problem?.message ?? ""}
          </p>
        </DialogBody>
        <DialogFooter meta={validationBases}>
          <Button variant="secondary" onClick={close}>{applied === undefined ? "Cancel" : "Close"}</Button>
          {review === undefined ? (
            <Button disabled={!canReview || busy !== undefined} onClick={reviewDraft}>
              {busy === "review" ? "Validating…" : "Review change"}
            </Button>
          ) : review.result.state === "ready-to-apply" && applied === undefined && !readbackUncertain ? (
            <Button disabled={busy !== undefined || actorId === undefined} onClick={apply}>
              {busy === "apply" ? "Applying…" : "Apply presentation change"}
            </Button>
          ) : applied === undefined && !readbackUncertain ? (
            <Button onClick={invalidateReview}>Revise draft</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const bootstrap = useBootstrap();
  const [resource, setResource] = useState<AsyncResource<WorkflowExplorerWire>>(LOADING);
  const [openNodeId, setOpenNodeId] = useState<string | undefined>(undefined);
  const [editingField, setEditingField] = useState<ExplorerPresentationField | undefined>(undefined);
  const editTrigger = useRef<HTMLButtonElement | undefined>(undefined);

  useEffect(() => {
    setResource(LOADING);
    return observeAsyncResource(() => client.workflowExplorer(), setResource);
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
    /* UF-EX-2. `TakeoverFrame`'s JSDoc owns the why — geometry, arrival and
       focus, decided once for all four takeovers. This surface's demo
       container: `// ported from legacy 1ec1d870
       src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:666-667` →
       `DemoExplorerPage`, whose root is a bare `flex min-h-0 flex-1 flex-col`
       div at `DemoExplorer.tsx:165` (`:164` is the `return (`). */
    <TakeoverFrame label="Workflow explorer">
      <PageHeader
        title="Explorer"
        icon={<Workflow aria-hidden className={dsIcon.md} />}
        badge={
          <Badge tone="neutral">
            <Lock aria-hidden className={dsIcon.sm} />
            graph read-only
          </Badge>
        }
        back={
          <Button
            variant="secondary"
            size="toolbar"
            icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
            onClick={onClose}
          >
            Back to the dashboard
          </Button>
        }
        actions={
          <Button
            variant="secondary"
            size="toolbar"
            icon={<Eye aria-hidden className={dsIcon.md} />}
            onClick={onVersionRegistry}
          >
            Version registry
          </Button>
        }
      />

      {/* D340 keeps the workflow list beside the graph at the desktop floor.
          The node record gets its own column when the desktop has room. */}
      <div className="grid min-h-0 flex-1 gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)] grid-cols-[minmax(0,232px)_minmax(0,1fr)] min-[1280px]:grid-cols-[minmax(0,232px)_minmax(0,1fr)_minmax(0,420px)]">
        {resource.state === "loading" && (
          <Panel className="min-h-0 col-span-2 min-[1280px]:col-span-3">
            <PanelBody className="p-[var(--ds-space-cozy)]">
              <div className="flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]">
                <Spinner label="Loading the explorer projection" />
                <span className={dsText.body}>Reading the registry…</span>
              </div>
            </PanelBody>
          </Panel>
        )}

        {resource.state === "failed" && (
          <Panel className="min-h-0 col-span-2 min-[1280px]:col-span-3">
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
                    /*
                      The door out STAYS (ledger 3 row EX172, a named exception
                      under D276 item 2). This arm is reached by a deep link
                      naming a workflow the registry does not serve, and the
                      demo has no counterpart because its ids come from its own
                      fixture and cannot miss. Without it the operator's only
                      exit from a stale bookmark is to edit the URL. It names
                      the workflow it opens rather than saying "open a
                      workflow", so the press is not a surprise, and it is
                      suppressed the moment the registry is empty — a door onto
                      nothing is worse than no door.
                    */
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
                  onEditPresentation={(field, trigger) => {
                    editTrigger.current = trigger;
                    setEditingField(field);
                  }}
                />
                {/*
                  Between the two thresholds the record column is BELOW the
                  other two rather than beside them, so it takes the whole row.
                  Auto-placement would drop it into the 232px registry column
                  instead, where a three-column table renders its own headings
                  on top of each other — the demo's grid has the same hole and
                  its corpus never photographed that width.
                */}
                <div className="flex min-h-0 col-span-2 min-[1280px]:col-span-1">
                  <NodeDetail
                    workflow={workflow}
                    node={openNode}
                    delegatesToLabel={detailDelegatesTo}
                  />
                </div>
                <ExplorerEditDialog
                  workflow={workflow}
                  field={editingField}
                  actorId={bootstrap.state === "loaded" ? bootstrap.value.actor.id : undefined}
                  onClose={() => {
                    const trigger = editTrigger.current;
                    setEditingField(undefined);
                    window.setTimeout(() => trigger?.focus(), 0);
                  }}
                  onReadback={(next) => {
                    setResource(loaded(next));
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </TakeoverFrame>
  );
}
