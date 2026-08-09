/**
 * The generated UI catalog surface (doc 12 §1.3, doc 03 §13, D177).
 *
 * ## What this is, and why it is worth a surface
 *
 * `generated/ui-catalog.json` is the canonical answer to "what does this system
 * know how to see and touch on a page, and when was that last verified against
 * the live system". Until now it was reachable only from a CLI
 * (`npm run selector:search`) and from two markdown projections. The operator
 * who needs it most is the one already in the dashboard looking at a failed
 * run, and the ONE thing that would make them distrust it is a catalog that
 * disagrees with the drivers — so the server refuses to serve a stale artifact
 * at all, and this surface renders that refusal in the generator's own words.
 *
 * ## THESIS — provenance sits beside the id, not behind it
 *
 * A selector catalog read without its verification date is worse than no
 * catalog: it invites acting on a mapping that may have rotted, and doc 12 §10
 * says plainly that the registry "cannot make a stale live verification
 * current". So every row carries its `verifiedAt` and both evidence refs on the
 * same line as its id, at the same weight — never folded into a details
 * disclosure that a hurried reader will skip.
 *
 * It is strictly read-only: there is no control here that writes anything, and
 * regenerating is deliberately not offered. `npm run ui:catalog` is the one
 * writer, and a surface that regenerated on demand would silently heal a stale
 * checkout — the exact failure the 2026-08-03 tracked-artifact lesson records.
 */
import { useEffect, useMemo, useState } from "react";
import { BookMarked, CircleAlert, ScanEye, X } from "lucide-react";
import type { UiCatalogWire } from "../../domain/dashboard/explorer.js";
import { matchesUiCatalogQuery } from "../../domain/dashboard/explorer.js";
import type { UiCatalogEntry } from "../../domain/ui/contracts.js";
import {
  Badge,
  Banner,
  Chip,
  EmptyState,
  IconButton,
  MetaLine,
  Panel,
  PanelBody,
  PanelHeader,
  PanelToolbar,
  SearchInput,
  SectionLabel,
  Spinner,
  dsIcon,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { DashboardClientError } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";

/**
 * How loudly each entry kind is drawn.
 *
 * `observation` is the only tinted one: an observation is what a subject
 * binding and a write's completion proof are checked against (doc 12 §1.1), so
 * it is the kind whose staleness has consequences beyond a failed read.
 */
const ENTRY_KIND = {
  screen: { word: "Screen", tone: "neutral" },
  element: { word: "Element", tone: "neutral" },
  "page-state": { word: "Page state", tone: "neutral" },
  observation: { word: "Observation", tone: "info" },
} as const;

/**
 * A wrapping row of chips, packed rather than tracked.
 *
 * The DS's `ChipRow` lays chips on an equal-width GRID so a wrapped set ends on
 * one edge instead of leaving an orphan — which is exactly right in the queue's
 * ~400px column, where it was designed. These two surfaces are the other case:
 * a ~700px record column holding a dozen SHORT facts (`code pl`, `version 1`),
 * where `auto-fit` cuts seven 160px tracks and every chip sits alone at the
 * left of one. The shared ending edge is bought with gaps wide enough that the
 * set stops reading as a set. So the facts pack, and the ragged right edge is
 * the deliberate cost — the DS's own note already says a row that is not a
 * track of peers "is a flex row, and the chip is one item in it".
 */
function FactChips({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
      {children}
    </div>
  );
}

function CatalogRow({ entry }: { entry: UiCatalogEntry }) {
  const kind = ENTRY_KIND[entry.kind];
  return (
    <li className="flex flex-col gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border-subtle)] py-[var(--ds-space-base)] last:border-b-0">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        <Badge tone={kind.tone}>{kind.word}</Badge>
        <span className={cn(dsText.ui, dsText.nums, "font-medium text-[color:var(--ds-fg)]")}>
          {entry.id}
        </span>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")}>{entry.label}</span>
      </div>

      <FactChips>
        <Chip label="system">{entry.system}</Chip>
        {"screen" in entry && <Chip label="screen">{entry.screen}</Chip>}
        {"role" in entry && <Chip label="role">{entry.role}</Chip>}
        {"effect" in entry && (
          // `effect` is the one field that separates reading a page from
          // acting on it, so a non-observing element is marked rather than
          // sitting in a row of identical neutral chips.
          <Chip label="effect" tone={entry.effect === "observe" ? "neutral" : "warning"}>
            {entry.effect}
          </Chip>
        )}
        {"authoritativeFor" in entry && (
          <Chip label="authoritative for" tone="info">
            {entry.authoritativeFor.join(", ")}
          </Chip>
        )}
        <Chip label="sensitivity" tone={entry.sensitivity === "hr" ? "warning" : "neutral"}>
          {entry.sensitivity}
        </Chip>
      </FactChips>

      <FactChips>
        <Chip label="verified" icon={<ScanEye aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
          {entry.verification.verifiedAt}
        </Chip>
        <Chip label="fixture">{entry.verification.fixtureEvidenceRef}</Chip>
        <Chip label="live">{entry.verification.liveReadOnlyEvidenceRef}</Chip>
        <Chip label="owner">{entry.sourceLink}</Chip>
      </FactChips>

      {entry.taskUses.length > 0 && (
        <FactChips>
          {entry.taskUses.map((taskId) => (
            <Chip key={String(taskId)} label="used by">{taskId}</Chip>
          ))}
        </FactChips>
      )}

      <MetaLine
        tone="faint"
        items={[
          `search: ${entry.searchTerms.join(" · ")}`,
          `${String(entry.verification.scenarios.length)} verification scenario`
          + `${entry.verification.scenarios.length === 1 ? "" : "s"}`,
        ]}
      />
    </li>
  );
}

export function UiCatalogWorkspace({
  query,
  onQuery,
  onClose,
}: {
  query: string;
  onQuery: (next: string) => void;
  onClose: () => void;
}) {
  const client = useDashboardClient();
  const enter = useDsEnterTransition();
  const [resource, setResource] = useState<AsyncResource<UiCatalogWire>>(LOADING);

  useEffect(() => {
    let live = true;
    setResource(LOADING);
    client.uiCatalog().then(
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
  /**
   * Grouped by system, in the catalog's own order within each group.
   *
   * Grouping is not decoration: an operator debugging a Kuali page has no use
   * for a CRM element between two of theirs, and the systems ARE the top-level
   * partition of the registries the catalog is composed from.
   */
  const groups = useMemo(() => {
    if (wire === undefined) return [];
    const bySystem = new Map<string, UiCatalogEntry[]>();
    for (const entry of wire.entries) {
      if (!matchesUiCatalogQuery(entry, query)) continue;
      const list = bySystem.get(entry.system) ?? [];
      list.push(entry);
      bySystem.set(entry.system, list);
    }
    return [...bySystem.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [wire, query]);

  const shown = groups.reduce((total, [, entries]) => total + entries.length, 0);

  return (
    <Panel
      {...enter}
      aria-label="UI catalog"
      className={cn(
        // The SAME arrival the intake takeover uses — same slot, same
        // direction, same distance. Two takeovers that occupy one region and
        // arrive from opposite edges read as two different products.
        "flex-1 data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <PanelHeader
        title="UI catalog"
        subtitle="The committed selector-semantics catalog, exactly as generated"
        icon={<BookMarked aria-hidden className={dsIcon.lg} />}
        meta={wire === undefined ? undefined : <span>{wire.sourcePath}</span>}
        actions={
          <IconButton
            size="sm"
            label="Close the UI catalog"
            icon={<X aria-hidden className={dsIcon.md} />}
            onClick={onClose}
          />
        }
      />

      <PanelToolbar label="Search the UI catalog">
        <SearchInput
          className="w-full max-w-[28rem]"
          value={query}
          aria-label="Search the UI catalog by id, label, system or search term"
          placeholder="kuali save · observation · ucpath person org"
          onChange={(event) => onQuery(event.currentTarget.value)}
          onClear={() => onQuery("")}
        />
        {wire !== undefined && (
          <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
            {shown === wire.entries.length
              ? `${String(wire.entries.length)} entries`
              : `${String(shown)} of ${String(wire.entries.length)} entries`}
          </span>
        )}
      </PanelToolbar>

      <PanelBody className="px-[var(--ds-space-cozy)] [&>*]:max-w-[var(--ds-w-explorer-measure)]">
        {resource.state === "loading" && (
          <div className="flex items-center gap-[var(--ds-space-tight)] py-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]">
            <Spinner label="Loading the UI catalog" />
            <span className={dsText.body}>Reading the committed catalog…</span>
          </div>
        )}

        {resource.state === "failed" && (
          // A stale artifact arrives here, carrying the generator's own
          // remediation. It is a refusal, not an outage: serving the stale
          // bytes would describe selectors this build does not use.
          <div className="py-[var(--ds-space-base)]">
            <Banner tone="danger" title="The committed UI catalog could not be served">
              {resource.error.message}
            </Banner>
          </div>
        )}

        {wire !== undefined && shown === 0 && (
          <EmptyState
            icon={<CircleAlert aria-hidden className={dsIcon.lg} />}
            title={`Nothing in the catalog matches “${query}”`}
            description={
              `All ${String(wire.entries.length)} entries were searched by id, label, system, kind `
              + "and registered search terms. Try one word — a system (kuali), a kind (observation), "
              + "or part of an id (timekeeper)."
            }
          />
        )}

        {groups.map(([system, entries]) => (
          <section key={system} aria-label={system} className="pt-[var(--ds-space-base)]">
            <SectionLabel>
              {system} · {String(entries.length)} entr{entries.length === 1 ? "y" : "ies"}
            </SectionLabel>
            <ul>
              {entries.map((entry) => <CatalogRow key={String(entry.id)} entry={entry} />)}
            </ul>
          </section>
        ))}
      </PanelBody>
    </Panel>
  );
}
